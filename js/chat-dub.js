// Conversas — dublagem de voz com a ElevenLabs (áudio → áudio). Roda no
// service worker (importScripts) e nos testes do Node. Expõe globalThis.OrbitaDub.
//
// Diferente do Fish Audio (texto → voz), aqui não há transcrição nem geração a
// partir de texto: a ElevenLabs recebe a gravação e devolve a fala já traduzida,
// com a entonação, o ritmo e a voz de quem gravou.
//
// API (elevenlabs.io/docs, conferida em 09/2026), assíncrona, por "projeto":
//   1. POST /v1/dubbing (multipart: file, target_lang, source_lang, num_speakers,
//      drop_background_audio, disable_voice_cloning) → { dubbing_id, expected_duration_sec }
//   2. GET  /v1/dubbing/{id} até status "dubbed" (ou "failed")
//   3. GET  /v1/dubbing/{id}/audio/{target_lang} → o áudio dublado
//   4. DELETE /v1/dubbing/{id} (limpeza; se falhar, tudo bem)
// Limites da API: arquivo de até 1 GB e 2,5 horas.
//
// A chave fica em chrome.storage.local["orbita:chat:secrets"].elevenApiKey, fora do backup.
(() => {
  "use strict";
  if (globalThis.OrbitaDub) return;

  const BASE = "https://api.elevenlabs.io/v1";
  const SECRETS_KEY = "orbita:chat:secrets";
  const MAX_BYTES = 1024 * 1024 * 1024;
  const MAX_SECONDS = 2.5 * 3600;
  const DEFAULT_TIMEOUT_SEC = 180;
  const DEFAULT_POLL_SEC = 5;
  const REQUEST_TIMEOUT_MS = 60000;

  // Idiomas da dublagem da ElevenLabs (ISO 639-1; filipino = "fil").
  const LANGS = {
    ar: "árabe", bg: "búlgaro", zh: "chinês", hr: "croata", cs: "tcheco", da: "dinamarquês", nl: "holandês", en: "inglês",
    fi: "finlandês", fr: "francês", de: "alemão", hi: "hindi", hu: "húngaro", id: "indonésio", it: "italiano", ja: "japonês",
    ko: "coreano", ms: "malaio", no: "norueguês", fil: "filipino", pl: "polonês", pt: "português", ro: "romeno", ru: "russo",
    sk: "eslovaco", es: "espanhol", sv: "sueco", th: "tailandês", tr: "turco", uk: "ucraniano", vi: "vietnamita",
  };
  const supports = (lang) => Object.hasOwn(LANGS, String(lang || "").toLowerCase());

  const TE = globalThis.OrbitaTranslate?.TranslateError || Error;
  class DubError extends TE {
    constructor(code, message, opts = {}) {
      super(code, message, opts);
      this.name = "DubError";
      this.code = code;
      this.message = message;
      this.retryable = Boolean(opts.retryable);
    }
  }

  async function secrets() {
    return (await chrome.storage.local.get(SECRETS_KEY))[SECRETS_KEY] || {};
  }

  // Erros da ElevenLabs vêm como { detail: { status, message } } (ou detail texto).
  async function httpError(r, what) {
    let status = "";
    let message = "";
    try {
      const j = await r.json();
      status = String(j?.detail?.status || j?.status || "");
      message = String(j?.detail?.message || (typeof j?.detail === "string" ? j.detail : "") || j?.message || "");
    } catch {}
    const s = `${status} ${message}`.toLowerCase();
    if (/quota|credit|insufficient|payment|limit_reached/.test(s) || r.status === 402)
      return new DubError("QUOTA", "Sua conta da ElevenLabs está sem créditos (ou a cota do plano acabou). Recarregue ou mude de plano em elevenlabs.io para dublar.");
    if (r.status === 401 || r.status === 403 || /invalid_api_key|unauthorized/.test(s)) return new DubError("AUTH", "Chave da ElevenLabs inválida ou sem permissão para dublagem.");
    if (r.status === 429) return new DubError("RATE_LIMIT", "Limite de uso da ElevenLabs atingido (muitos pedidos ao mesmo tempo). Tente de novo em instantes.", { retryable: true });
    if (r.status === 404) return new DubError("NOT_FOUND", "A dublagem não foi encontrada na ElevenLabs (pode ter expirado).");
    if (r.status >= 500) return new DubError("PROVIDER", `A ElevenLabs está instável (HTTP ${r.status}).`, { retryable: true });
    return new DubError("PROVIDER", `A ElevenLabs recusou ${what} (HTTP ${r.status})${message ? `: ${message}` : "."}`);
  }

  async function request(url, init, { timeoutMs = REQUEST_TIMEOUT_MS, what = "o pedido", fetchImpl = fetch } = {}) {
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let r;
      try {
        r = await fetchImpl(url, { ...init, signal: ctrl.signal });
      } catch (e) {
        if (attempt === 0) continue;
        throw e?.name === "AbortError" ? new DubError("TIMEOUT", "A ElevenLabs demorou demais para responder.", { retryable: true }) : new DubError("PROVIDER", "Sem conexão com a ElevenLabs.", { retryable: true });
      } finally {
        clearTimeout(timer);
      }
      if (r.ok) return r;
      const err = await httpError(r, what);
      if (err.retryable && attempt === 0) continue;
      throw err;
    }
  }

  // Confere tudo antes de gastar créditos: chave, idiomas, tamanho e duração.
  function validate({ blob, sourceLang, targetLang, durationSec, apiKey }) {
    if (!apiKey) throw new DubError("NOT_CONFIGURED", "Configure a chave da ElevenLabs nas preferências das Conversas para dublar.");
    if (!blob?.size) throw new DubError("EMPTY", "A gravação está vazia.");
    const list = Object.values(LANGS).join(", ");
    if (!supports(targetLang)) throw new DubError("UNSUPPORTED_LANG", `A dublagem da ElevenLabs não tem o idioma do contato (${targetLang}). Idiomas disponíveis: ${list}.`);
    if (sourceLang && sourceLang !== "auto" && !supports(sourceLang)) throw new DubError("UNSUPPORTED_LANG", `A dublagem da ElevenLabs não tem o seu idioma (${sourceLang}). Idiomas disponíveis: ${list}.`);
    if (sourceLang && sourceLang === targetLang) throw new DubError("SAME_LANG", "O contato fala o mesmo idioma que você: não há o que dublar.");
    if (blob.size > MAX_BYTES) throw new DubError("TOO_LARGE", "O arquivo passa de 1 GB, o limite da dublagem da ElevenLabs.");
    if (durationSec > MAX_SECONDS) throw new DubError("TOO_LONG", "O áudio passa de 2 h 30 min, o limite da dublagem da ElevenLabs.");
  }

  // Dubla `blob` para `targetLang`. Devolve { blob, mime, dubbingId }.
  // onProgress({ stage: "uploading" | "dubbing" | "downloading", elapsedSec, expectedSec })
  async function dub(opts) {
    const { blob, filename = "gravacao.wav", sourceLang = "auto", targetLang, durationSec = 0, dropBackground = true, timeoutSec = DEFAULT_TIMEOUT_SEC, pollSec = DEFAULT_POLL_SEC, onProgress = () => {} } = opts;
    const fetchImpl = opts.fetch || ((...a) => fetch(...a));
    const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = opts.now || (() => Date.now());
    const apiKey = opts.apiKey ?? (await secrets()).elevenApiKey;
    const target = String(targetLang || "").toLowerCase();
    validate({ blob, sourceLang, targetLang: target, durationSec, apiKey });
    const headers = { "xi-api-key": apiKey };
    const started = now();
    const elapsed = () => Math.round((now() - started) / 1000);

    // 1. cria o projeto
    onProgress({ stage: "uploading", elapsedSec: 0 });
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("target_lang", target);
    if (sourceLang && sourceLang !== "auto") form.append("source_lang", sourceLang);
    form.append("num_speakers", "1"); // mensagem de voz: uma pessoa só (ajuda a clonar a voz certa)
    form.append("drop_background_audio", String(Boolean(dropBackground)));
    form.append("disable_voice_cloning", "false"); // mantém a sua voz
    const created = await (await request(`${BASE}/dubbing`, { method: "POST", headers, body: form }, { timeoutMs: 120000, what: "a dublagem", fetchImpl })).json();
    const id = created?.dubbing_id;
    if (!id) throw new DubError("PROVIDER", "A ElevenLabs não devolveu o identificador da dublagem.");
    const expectedSec = Number(created.expected_duration_sec) || undefined;

    try {
      // 2. espera ficar pronta
      for (;;) {
        onProgress({ stage: "dubbing", elapsedSec: elapsed(), expectedSec });
        await sleep(pollSec * 1000);
        const st = await (await request(`${BASE}/dubbing/${encodeURIComponent(id)}`, { headers }, { what: "a consulta da dublagem", fetchImpl })).json();
        const status = String(st?.status || "").toLowerCase();
        if (status === "dubbed") break;
        if (status === "failed") throw new DubError("FAILED", `A ElevenLabs não conseguiu dublar este áudio${st?.error ? `: ${st.error}` : "."} Nenhum crédito deveria ser cobrado por dublagens com falha.`);
        if (elapsed() >= timeoutSec) throw new DubError("TIMEOUT", `A dublagem passou de ${timeoutSec} s e foi abandonada. Tente de novo ou aumente o tempo máximo nas preferências.`, { retryable: true });
      }

      // 3. baixa o áudio dublado
      onProgress({ stage: "downloading", elapsedSec: elapsed(), expectedSec });
      const r = await request(`${BASE}/dubbing/${encodeURIComponent(id)}/audio/${encodeURIComponent(target)}`, { headers }, { timeoutMs: 120000, what: "o download da dublagem", fetchImpl });
      const out = await r.blob();
      if (!out.size) throw new DubError("PROVIDER", "A ElevenLabs devolveu um áudio vazio.");
      const mime = (r.headers?.get?.("content-type") || out.type || "audio/mpeg").split(";")[0];
      return { blob: new Blob([out], { type: mime }), mime, dubbingId: id };
    } finally {
      // 4. apaga o projeto na ElevenLabs (o áudio já está aqui); falha aqui não importa
      fetchImpl(`${BASE}/dubbing/${encodeURIComponent(id)}`, { method: "DELETE", headers }).catch(() => {});
    }
  }

  // Confere a chave e mostra os créditos restantes (tela de Opções).
  async function checkKey(apiKey, { fetch: fetchImpl = (...a) => fetch(...a) } = {}) {
    if (!apiKey) throw new DubError("NOT_CONFIGURED", "Informe a chave da ElevenLabs.");
    const j = await (await request(`${BASE}/user/subscription`, { headers: { "xi-api-key": apiKey } }, { what: "a chave", fetchImpl })).json();
    const left = Number(j.character_limit) - Number(j.character_count);
    return { tier: j.tier || "", creditsLeft: Number.isFinite(left) ? left : null, resetAt: j.next_character_count_reset_unix ? j.next_character_count_reset_unix * 1000 : null };
  }

  globalThis.OrbitaDub = { dub, checkKey, validate, supports, secrets, LANGS, DubError, MAX_BYTES, MAX_SECONDS, DEFAULT_TIMEOUT_SEC, SECRETS_KEY };
})();
