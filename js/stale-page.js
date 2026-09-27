// Página aberta de uma versão anterior da extensão (atualizou ou recarregou):
// chrome.runtime deixa de responder e o Chrome lança "Extension context
// invalidated". Em vez de um erro vermelho no console, avisa e oferece recarregar.
(() => {
  "use strict";
  const STALE = /Extension context invalidated/i;
  let shown = false;
  function banner() {
    if (shown) return;
    shown = true;
    const show = () => {
      const bar = document.createElement("div");
      bar.setAttribute("role", "alert");
      bar.style.cssText =
        "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:12px;align-items:center;" +
        "max-width:calc(100% - 32px);padding:10px 14px;border-radius:12px;background:#111827;color:#fff;font:14px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.3)";
      bar.textContent = "A Órbita foi atualizada. Recarregue esta página para continuar.";
      const btn = document.createElement("button");
      btn.textContent = "Recarregar";
      btn.style.cssText = "border:0;border-radius:8px;padding:6px 12px;background:#6366f1;color:#fff;font:inherit;cursor:pointer";
      btn.onclick = () => location.reload();
      bar.append(btn);
      document.body.append(bar);
    };
    document.body ? show() : addEventListener("DOMContentLoaded", show, { once: true });
  }
  const isStale = (e) => STALE.test(String(e?.message || e || ""));
  addEventListener("unhandledrejection", (ev) => {
    if (isStale(ev.reason)) { ev.preventDefault(); banner(); }
  });
  addEventListener("error", (ev) => {
    if (isStale(ev.error || ev.message)) { ev.preventDefault(); banner(); }
  });
})();
