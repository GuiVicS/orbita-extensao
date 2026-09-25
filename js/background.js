// Service worker da extensão: carrega o build original e acrescenta os
// handlers das respostas rápidas sem alterar o bundle minificado.
importScripts("service_worker.js", "qr-common.js", "chat-common.js", "chat-translate.js", "chat-transcribe.js", "chat-voice.js", "chat-dub.js", "chat-sync.js");

// ---- código antigo na memória
// O atualizador troca os arquivos da pasta, mas o Chrome pode continuar rodando
// o service worker antigo (as páginas já abrem com o código novo e pedem coisas
// que ele não conhece: "Operação desconhecida"). Ao iniciar, compara a versão e
// as operações das Conversas no disco com as carregadas; se estiverem velhas,
// recarrega a extensão e reabre as telas da Órbita que estavam abertas.
const REOPEN = "orbita:reopen";
const SELF_RELOAD = "orbita:selfReload";

async function reopenTabs() {
  const re = (await chrome.storage.local.get(REOPEN))[REOPEN];
  if (!re) return;
  await chrome.storage.local.remove(REOPEN);
  if (!(Date.now() - re.at < 120000)) return;
  const base = chrome.runtime.getURL("");
  for (const url of [...new Set(re.urls || [])]) if (String(url).startsWith(base)) await chrome.tabs.create({ url, active: false });
}

async function isStale() {
  const read = async (path) => (await fetch(chrome.runtime.getURL(path), { cache: "no-store" })).text();
  if (JSON.parse(await read("manifest.json")).version !== chrome.runtime.getManifest().version) return true;
  const text = await read("js/chat-common.js");
  const i = text.indexOf("const OPS = {");
  const onDisk = [...text.slice(i, text.indexOf("};", i)).matchAll(/:\s*"([\w.]+)"/g)].map((m) => m[1]);
  const loaded = new Set(Object.values(globalThis.OrbitaChat?.OPS || {}));
  return onDisk.some((op) => !loaded.has(op));
}

async function selfCheck() {
  try {
    if (!(await isStale())) return false;
    const last = (await chrome.storage.local.get(SELF_RELOAD))[SELF_RELOAD] || 0;
    if (Date.now() - last < 10 * 60000) return false; // nunca em laço
    const tabs = await chrome.tabs.query({ url: `${chrome.runtime.getURL("")}*` });
    await chrome.storage.local.set({ [SELF_RELOAD]: Date.now(), [REOPEN]: { urls: tabs.map((t) => t.url), at: Date.now() } });
    chrome.runtime.reload();
    return true;
  } catch (e) {
    console.warn("[Órbita] conferência de versão:", e?.message);
    return false;
  }
}

reopenTabs().catch(() => {});
selfCheck();
globalThis.__orbitaSelfCheck = { selfCheck, isStale, reopenTabs }; // para os testes

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
