// Conversas — voz gerada (texto → fala) com o Fish Audio. Roda no service
// worker (importScripts) e nos testes do Node. Expõe globalThis.OrbitaVoice.
//
// API (docs.fish.audio, conferida em 09/2026): POST https://api.fish.audio/v1/tts
// com "Authorization: Bearer <chave>", cabeçalho "model" e corpo JSON
// { text, reference_id, format, ... }. A resposta é o áudio.
// Pedimos MP3 e a página converte para OGG/Opus (formato da mensagem de voz
// do WhatsApp) com o mesmo conversor das respostas rápidas (js/qr-audio.js).
//
// A chave fica em chrome.storage.local["orbita:chat:secrets"], fora do backup.
(() => {
  "use strict";
  if (globalThis.OrbitaVoice) return;

  const URL_TTS = "https://api.fish.audio/v1/tts";
  const SECRETS_KEY = "orbita:chat:secrets";
  const DEFAULT_MODEL = "s2.1-pro";
  const TIMEOUT_MS = 60000;

  const TE = globalThis.OrbitaTranslate?.TranslateError || Error;
  class VoiceError extends TE {
    constructor(code, message, opts = {}) {
      super(code, message, opts);
      this.name = "VoiceError";
      this.code = code;
      this.message = message;
      this.retryable = Boolean(opts.retryable);
    }
  }

  async function secrets() {
    return (await chrome.storage.local.get(SECRETS_KEY))[SECRETS_KEY] || {};
  }

  function httpError(status) {
    if (status === 401 || status === 403) return new VoiceError("AUTH", "Chave do Fish Audio inválida ou sem permissão.");
    if (status === 402) return new VoiceError("INSUFFICIENT_CREDIT", "Os créditos do Fish Audio acabaram. Recarregue a conta para gerar voz.");
    if (status === 429) return new VoiceError("RATE_LIMIT", "Limite de uso do Fish Audio atingido. Tente de novo em instantes.", { retryable: true });
    if (status === 404) return new VoiceError("VOICE_NOT_FOUND", "A voz configurada não existe mais no Fish Audio.");
    if (status >= 500) return new VoiceError("PROVIDER", `O Fish Audio está instável (HTTP ${status}).`, { retryable: true });
    return new VoiceError("PROVIDER", `O Fish Audio recusou o pedido (HTTP ${status}).`);
  }

  // Gera a fala de `text` com a voz `voiceId`. Devolve um Blob MP3.
  async function tts({ text, voiceId, model = DEFAULT_MODEL, speed = 1 }) {
    const clean = String(text || "").trim();
    if (!clean) throw new VoiceError("PROVIDER", "Texto vazio.");
    const { fishApiKey } = await secrets();
    if (!fishApiKey) throw new VoiceError("NOT_CONFIGURED", "Configure a chave do Fish Audio nas preferências das Conversas para gerar voz.");
    const body = { text: clean, format: "mp3", mp3_bitrate: 128, latency: "normal", normalize: true };
    if (voiceId) body.reference_id = voiceId;
    if (speed && speed !== 1) body.prosody = { speed: Math.min(2, Math.max(0.5, speed)) };
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let r;
      try {
        r = await fetch(URL_TTS, { method: "POST", headers: { Authorization: `Bearer ${fishApiKey}`, "Content-Type": "application/json", model: model || DEFAULT_MODEL }, body: JSON.stringify(body), signal: ctrl.signal });
      } catch (e) {
        if (attempt === 0) continue;
        throw e?.name === "AbortError" ? new VoiceError("TIMEOUT", "A geração de voz demorou demais.", { retryable: true }) : new VoiceError("PROVIDER", "Sem conexão com o Fish Audio.", { retryable: true });
      } finally {
        clearTimeout(timer);
      }
      if (!r.ok) {
        const err = httpError(r.status);
        if (err.retryable && attempt === 0) {
          await new Promise((res) => setTimeout(res, 1500));
          continue;
        }
        throw err;
      }
      const blob = await r.blob();
      if (!blob.size) throw new VoiceError("PROVIDER", "O Fish Audio devolveu um áudio vazio.");
      return new Blob([blob], { type: "audio/mpeg" });
    }
  }

  // Chave de cache: o mesmo texto com a mesma voz/modelo/velocidade não é gerado de novo.
  async function cacheKey({ text, voiceId, model = DEFAULT_MODEL, speed = 1 }) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([String(text).trim(), voiceId || "", model, speed])));
    return `tts:${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  }

  globalThis.OrbitaVoice = { tts, cacheKey, secrets, VoiceError, SECRETS_KEY, DEFAULT_MODEL };
})();
