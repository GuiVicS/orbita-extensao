// Conversas — transcrição de áudio (Whisper via Groq ou OpenAI). Roda no
// service worker (importScripts) e nos testes do Node. Expõe
// globalThis.OrbitaTranscribe. Usa as mesmas chaves salvas em "orbita:ai".
(() => {
  "use strict";
  if (globalThis.OrbitaTranscribe) return;

  const TIMEOUT_MS = 90000;
  const MAX_BYTES = 25 * 1024 * 1024; // limite das duas APIs

  const PROVIDERS = {
    groq: { label: "Groq", url: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" },
    openai: { label: "OpenAI", url: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1" },
  };

  // O Whisper devolve o idioma por extenso ("english"); a extensão usa ISO 639-1.
  const LANG_CODES = {
    english: "en", portuguese: "pt", spanish: "es", french: "fr", german: "de", italian: "it", dutch: "nl", russian: "ru",
    chinese: "zh", japanese: "ja", korean: "ko", arabic: "ar", hindi: "hi", turkish: "tr", polish: "pl", ukrainian: "uk",
    hebrew: "he", indonesian: "id",
  };
  const toCode = (lang) => {
    const l = String(lang || "").trim().toLowerCase();
    if (!l) return null;
    if (/^[a-z]{2}$/.test(l)) return l;
    return LANG_CODES[l] || null;
  };

  const TE = globalThis.OrbitaTranslate?.TranslateError;
  class TranscribeError extends (TE || Error) {
    constructor(code, message, opts = {}) {
      super(code, message, opts);
      if (!TE) {
        this.message = message;
        this.code = code;
        this.retryable = Boolean(opts.retryable);
      }
      this.name = "TranscribeError";
    }
  }

  // Escolhe o provedor: o preferido nas configurações, ou o primeiro com chave.
  async function resolveProvider(preferred = "auto") {
    const ai = (await chrome.storage.local.get("orbita:ai"))["orbita:ai"] || {};
    const keyOf = (p) => String(ai.keys?.[p] ?? (p === "groq" ? ai.apiKey : "") ?? "").trim();
    const order = preferred === "auto" ? ["groq", "openai"] : [preferred];
    for (const p of order) if (PROVIDERS[p] && keyOf(p)) return { id: p, key: keyOf(p), ...PROVIDERS[p] };
    throw new TranscribeError("NOT_CONFIGURED", preferred === "auto" ? "Para transcrever áudios, configure uma chave da Groq ou da OpenAI nas Opções da extensão." : `Configure a chave da ${PROVIDERS[preferred]?.label || preferred} nas Opções da extensão.`);
  }

  function httpError(status, label) {
    if (status === 401 || status === 403) return new TranscribeError("AUTH", `Chave da ${label} inválida ou sem permissão.`);
    if (status === 429) return new TranscribeError("RATE_LIMIT", `Limite de uso da ${label} atingido. Tente de novo em instantes.`, { retryable: true });
    if (status === 413) return new TranscribeError("TOO_LARGE", "Áudio grande demais para transcrever.");
    if (status >= 500) return new TranscribeError("PROVIDER", `A ${label} está instável (HTTP ${status}).`, { retryable: true });
    return new TranscribeError("PROVIDER", `A ${label} recusou o áudio (HTTP ${status}).`);
  }

  const extOf = (mime) => (/ogg|opus/.test(mime) ? "ogg" : /mpeg|mp3/.test(mime) ? "mp3" : /mp4|m4a|aac/.test(mime) ? "m4a" : /webm/.test(mime) ? "webm" : /wav/.test(mime) ? "wav" : "ogg");

  // Transcreve um Blob de áudio. Devolve { text, lang }. Texto vazio = sem fala.
  async function transcribe(blob, { provider = "auto" } = {}) {
    if (!blob?.size) throw new TranscribeError("PROVIDER", "Áudio vazio.");
    if (blob.size > MAX_BYTES) throw new TranscribeError("TOO_LARGE", "Áudio grande demais para transcrever (máx. 25 MB).");
    const p = await resolveProvider(provider);
    for (let attempt = 0; ; attempt++) {
      const form = new FormData();
      form.append("file", blob, `audio.${extOf(blob.type || "")}`);
      form.append("model", p.model);
      form.append("response_format", "verbose_json");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let r;
      try {
        r = await fetch(p.url, { method: "POST", headers: { Authorization: `Bearer ${p.key}` }, body: form, signal: ctrl.signal });
      } catch (e) {
        const err = e?.name === "AbortError" ? new TranscribeError("TIMEOUT", "A transcrição demorou demais.", { retryable: true }) : new TranscribeError("PROVIDER", "Sem conexão com o serviço de transcrição.", { retryable: true });
        if (attempt === 0) continue;
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (!r.ok) {
        const err = httpError(r.status, p.label);
        if (err.retryable && attempt === 0) {
          await new Promise((res) => setTimeout(res, 1500));
          continue;
        }
        throw err;
      }
      const j = await r.json();
      // o Whisper às vezes "alucina" legendas em áudio sem fala
      const text = String(j.text || "").trim();
      const noSpeech = !text || /^(\[.*\]|\(.*\)|♪+|\.+)$/.test(text) || (Array.isArray(j.segments) && j.segments.length && j.segments.every((s) => (s.no_speech_prob ?? 0) > 0.8));
      return { text: noSpeech ? "" : text, lang: toCode(j.language), provider: p.id };
    }
  }

  globalThis.OrbitaTranscribe = { transcribe, resolveProvider, toCode, TranscribeError, MAX_BYTES };
})();
