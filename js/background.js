// Service worker da extensão: carrega o build original e acrescenta os
// handlers das respostas rápidas sem alterar o bundle minificado.
importScripts("service_worker.js", "chat-common.js", "chat-translate.js", "chat-transcribe.js", "chat-voice.js", "chat-sync.js");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.channel !== "orbita:qr" || sender.id !== chrome.runtime.id) return false;
  (async () => {
    switch (msg.op) {
      case "openDashboard": {
        const url = chrome.runtime.getURL(`dashboard.html#/respostas-rapidas${msg.edit ? `?edit=${encodeURIComponent(msg.edit)}` : ""}`);
        const [tab] = await chrome.tabs.query({ url: chrome.runtime.getURL("dashboard.html") + "*" });
        if (tab?.id !== undefined) {
          await chrome.tabs.update(tab.id, { url, active: true });
          if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
        } else {
          await chrome.tabs.create({ url });
        }
        return null;
      }
      default:
        throw new Error(`Operação desconhecida: ${msg.op}`);
    }
  })()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true;
});
