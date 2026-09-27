// Documento offscreen (offscreen.html): converte o MP3 gerado pelo Fish Audio em
// OGG/Opus para o Agente local (MCP). Lê e grava no mesmo cache de mídias das
// Conversas (IndexedDB "orbita-chat"), igual ao fluxo de voz da tela de Conversas.
(() => {
  "use strict";
  const C = globalThis.OrbitaChat;
  const A = globalThis.OrbitaAudio;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.channel !== "orbita:offscreen" || sender.id !== chrome.runtime.id) return false;
    (async () => {
      if (msg.op !== "mp3ToOgg") throw new Error("Operação desconhecida.");
      const src = await C.getMedia(String(msg.mp3Key));
      if (!src?.blob) throw new Error("Áudio gerado não encontrado.");
      const ogg = await A.toOggOpus(src.blob);
      await C.putMedia(String(msg.genKey), ogg.blob, { text: msg.text, chatId: msg.chatId, duration: ogg.duration });
      return { duration: ogg.duration };
    })()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  });
})();
