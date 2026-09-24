// Conversas — ponte no content script (mundo isolado) entre a página do
// WhatsApp (js/chat-page.js, por window.postMessage) e o service worker (porta
// "orbita-chat"). Reconecta sozinha quando o service worker do MV3 reinicia.
(() => {
  "use strict";
  if (window.__orbitaChatContent) return;
  window.__orbitaChatContent = true;

  const NS = "__orbita_chat__";
  const pending = new Map();
  let port = null;
  let dead = false;
  let lastStatus = null;

  function callPage(command, timeoutMs) {
    const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error("Tempo esgotado aguardando o WhatsApp Web responder."));
      }, timeoutMs || 60000);
      pending.set(reqId, { resolve, reject, timer });
      window.postMessage({ ns: NS, dir: "toPage", reqId, command }, window.location.origin);
    });
  }

  const send = (msg) => {
    try {
      port?.postMessage(msg);
    } catch {}
  };

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    const m = ev.data;
    if (!m || m.ns !== NS) return;
    if (m.dir === "fromPage") {
      const p = pending.get(m.reqId);
      if (!p) return;
      pending.delete(m.reqId);
      clearTimeout(p.timer);
      m.ok ? p.resolve(m.data) : p.reject(new Error(m.error));
    } else if (m.dir === "event") {
      if (m.event === "status") lastStatus = m.data;
      send({ kind: "event", event: m.event, data: m.data });
    }
  });

  function connect() {
    if (dead) return;
    try {
      port = chrome.runtime.connect({ name: "orbita-chat" });
    } catch {
      dead = true; // extensão recarregada: este content script ficou órfão
      return;
    }
    port.onMessage.addListener(async (msg) => {
      if (msg?.kind !== "exec") return;
      try {
        send({ kind: "result", reqId: msg.reqId, ok: true, data: await callPage(msg.command, msg.timeoutMs) });
      } catch (e) {
        send({ kind: "result", reqId: msg.reqId, ok: false, error: e?.message || String(e) });
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      void chrome.runtime.lastError;
      setTimeout(connect, 1000);
    });
    send({ kind: "hello", url: location.href });
    if (lastStatus) send({ kind: "event", event: "status", data: lastStatus });
  }

  connect();
  // mantém o service worker acordado enquanto a aba do WhatsApp está aberta
  setInterval(() => send({ kind: "heartbeat", ts: Date.now() }), 20000);
})();
