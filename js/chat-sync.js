// Conversas — sincronização no service worker (carregado por js/background.js).
//
//   aba do WhatsApp ──porta "orbita-chat"──▶ aqui ──▶ banco "orbita-chat"
//                                             │
//   painel (conversas.html) ◀──porta "orbita-chat-ui" (eventos ao vivo)
//   painel ──chrome.runtime.sendMessage({channel:"orbita:chat"})──▶ aqui
//
// Regra: o painel nunca fala direto com a aba do WhatsApp; tudo passa por aqui.
// Nenhum estado importante fica só em memória: o service worker do MV3 pode
// ser encerrado a qualquer momento e tudo o que importa está no IndexedDB.
// Não registrar conteúdo de mensagens em logs.
(() => {
  "use strict";
  const C = globalThis.OrbitaChat;
  const WA_URL = "https://web.whatsapp.com/";
  const HISTORY_PAGE = 50;

  // ------------------------------------------------------ abas e comandos
  const tabs = new Map(); // tabId → { port, ready }
  const pending = new Map(); // reqId → { resolve, reject, timer, tabId }
  const uiPorts = new Map(); // porta do painel → chatId aberto nela (ou null)
  let status = { connected: false, ready: false };

  function broadcast(event, data) {
    for (const port of uiPorts.keys()) {
      try {
        port.postMessage({ event, data });
      } catch {}
    }
  }

  function refreshStatus() {
    const list = [...tabs.values()];
    const next = { connected: list.length > 0, ready: list.some((t) => t.ready) };
    if (next.connected !== status.connected || next.ready !== status.ready) {
      status = next;
      broadcast(C.EVENTS.STATUS_CHANGED, status);
    }
  }

  function exec(command, timeoutMs = 60000) {
    const entry = [...tabs.entries()].find(([, t]) => t.ready);
    if (!entry) {
      return Promise.reject(new Error(tabs.size ? "O WhatsApp Web ainda está carregando. Aguarde alguns segundos." : "Abra o WhatsApp Web em uma aba do Chrome para usar as Conversas."));
    }
    const [tabId, tab] = entry;
    const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error("Tempo esgotado aguardando o WhatsApp Web."));
      }, timeoutMs);
      pending.set(reqId, { resolve, reject, timer, tabId });
      tab.port.postMessage({ kind: "exec", reqId, command, timeoutMs });
    });
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === C.PORT_TAB) {
      const tabId = port.sender?.tab?.id;
      if (tabId == null || !port.sender?.url?.startsWith(WA_URL) || port.sender.id !== chrome.runtime.id) return port.disconnect();
      const entry = { port, ready: false };
      tabs.set(tabId, entry);
      port.onMessage.addListener((msg) => onTabMessage(entry, msg).catch((e) => console.warn("[Órbita] conversas:", e?.message)));
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        if (tabs.get(tabId) === entry) tabs.delete(tabId);
        for (const [id, p] of pending) {
          if (p.tabId !== tabId) continue;
          pending.delete(id);
          clearTimeout(p.timer);
          p.reject(new Error("A aba do WhatsApp foi fechada ou recarregada."));
        }
        refreshStatus();
      });
      refreshStatus();
    } else if (port.name === C.PORT_UI) {
      if (port.sender?.id !== chrome.runtime.id || !port.sender?.url?.startsWith(chrome.runtime.getURL(""))) return port.disconnect();
      uiPorts.set(port, null);
      port.onMessage.addListener((msg) => {
        if (msg?.kind === "focus") uiPorts.set(port, msg.chatId || null);
      });
      port.onDisconnect.addListener(() => uiPorts.delete(port));
      port.postMessage({ event: C.EVENTS.STATUS_CHANGED, data: status });
    }
  });

  async function onTabMessage(entry, msg) {
    if (msg?.kind === "result") {
      const p = pending.get(msg.reqId);
      if (!p) return;
      pending.delete(msg.reqId);
      clearTimeout(p.timer);
      return msg.ok ? p.resolve(msg.data) : p.reject(new Error(msg.error));
    }
    if (msg?.kind !== "event") return;
    const d = msg.data || {};
    switch (msg.event) {
      case "status": {
        const was = entry.ready;
        entry.ready = Boolean(d.ready);
        refreshStatus();
        if (!was && entry.ready) scheduleResync();
        return;
      }
      case "message.new":
        return onIncoming(d.message, d.chat);
      case "message.edit":
        return onIncoming(d.message, null);
      case "message.ack":
        for (const id of d.ids || []) {
          const m = await C.patchMessage(id, (m) => (d.ack > (m.ack ?? 0) ? { ...m, ack: d.ack } : null));
          if (m) broadcast(C.EVENTS.MESSAGE_UPDATED, { message: m });
        }
        return;
      case "message.revoke": {
        const m = await C.patchMessage(d.id, (m) => (m.revoked ? null : { ...m, revoked: true }));
        if (m) {
          broadcast(C.EVENTS.MESSAGE_UPDATED, { message: m });
          const chat = await touchChat({ chatId: m.chatId }, { lastMsg: m });
          broadcast(C.EVENTS.CHAT_UPDATED, { chat });
        }
      }
    }
  }

  const isOpenSomewhere = (chatId) => [...uiPorts.values()].includes(chatId);

  async function onIncoming(message, chatInfo) {
    if (!message?.id) return;
    const [change] = await C.upsertMessages([message]);
    if (!change) return;
    const chat = await touchChat(chatInfo || { chatId: message.chatId }, {
      lastMsg: change.message,
      incUnread: change.isNew && !message.fromMe && !isOpenSomewhere(message.chatId),
    });
    broadcast(change.isNew ? C.EVENTS.MESSAGE_NEW : C.EVENTS.MESSAGE_UPDATED, { message: change.message });
    broadcast(C.EVENTS.CHAT_UPDATED, { chat });
  }

  // ------------------------------------------------------ chats e CRM
  let clientIndex = null;
  let clientIndexAt = 0;
  async function clients() {
    if (!clientIndex || Date.now() - clientIndexAt > 60000) {
      clientIndex = await C.loadClientIndex().catch(() => new Map());
      clientIndexAt = Date.now();
    }
    return clientIndex;
  }

  // Cria/atualiza o registro do chat. Nunca apaga campos só nossos (tradução…).
  async function touchChat(info, { lastMsg, incUnread = false, unreadFromWa } = {}) {
    const index = await clients();
    return C.updateChat(info.chatId, (cur) => {
      const next = {
        translation: { enabled: false, contactLang: "en", tone: "informal" },
        unreadCount: 0,
        lastMessageAt: 0,
        ...cur,
      };
      if (info.name) next.name = info.name;
      if (info.pushname) next.pushname = info.pushname;
      if (info.phone) next.phone = info.phone;
      if (lastMsg && lastMsg.ts >= (next.lastMessageAt || 0)) {
        next.lastMessageAt = lastMsg.ts;
        next.lastPreview = C.previewOf(lastMsg);
        next.lastFromMe = lastMsg.fromMe;
        next.lastMessageId = lastMsg.id;
      } else if (lastMsg && lastMsg.id === next.lastMessageId) {
        next.lastPreview = C.previewOf(lastMsg); // a última foi apagada/editada
      } else if ((info.lastMessageAt || 0) > next.lastMessageAt) next.lastMessageAt = info.lastMessageAt;
      if (unreadFromWa !== undefined) next.unreadCount = unreadFromWa;
      if (incUnread) next.unreadCount = (next.unreadCount || 0) + 1;
      const client = C.findClient(index, next.phone);
      next.client = client ? { phone: client.phone, name: client.name, stageId: client.stageId, tags: client.tags || [] } : null;
      return next;
    });
  }

  // Busca uma página de histórico no WhatsApp e grava. Devolve quantas vieram.
  async function fetchHistory(chatId, beforeId) {
    const list = await exec({ op: C.TAB_CMDS.GET_MESSAGES, chatId, count: HISTORY_PAGE, beforeId }, 60000);
    await C.upsertMessages(list);
    return list;
  }

  // Ressincroniza a lista de conversas e fecha lacunas (mensagens que chegaram
  // enquanto o service worker dormia ou a aba estava fechada).
  let resyncTimer = null;
  let resyncRunning = null;
  function scheduleResync(delay = 1500) {
    clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => resync().catch((e) => console.warn("[Órbita] conversas: ressincronização falhou:", e?.message)), delay);
  }

  async function resync() {
    if (resyncRunning) return resyncRunning;
    resyncRunning = (async () => {
      clientIndex = null; // recarrega vínculos com o CRM
      const chats = await exec({ op: C.TAB_CMDS.LIST_CHATS, count: 300 }, 90000);
      for (const info of chats) {
        const before = await C.getChat(info.chatId);
        if (info.last) await C.upsertMessages([info.last]);
        await touchChat(info, { lastMsg: info.last, unreadFromWa: info.unreadCount });
        // só completa o histórico de conversas que já foram abertas no painel
        if (before?.opened && info.lastMessageAt > (before.syncedUntil || 0)) {
          const got = await fetchHistory(info.chatId).catch(() => []);
          if (got.length) await C.updateChat(info.chatId, (c) => ({ ...c, syncedUntil: Math.max(...got.map((m) => m.ts)) }));
        }
      }
      await C.setMeta("lastResyncAt", Date.now());
      broadcast(C.EVENTS.CHAT_UPDATED, { all: true });
    })();
    try {
      return await resyncRunning;
    } finally {
      resyncRunning = null;
    }
  }

  // ------------------------------------------------------ pedidos do painel
  async function handle(req) {
    switch (req.op) {
      case C.OPS.STATUS:
        return status;

      case C.OPS.LIST:
        return C.listChats();

      case C.OPS.REFRESH:
        await resync();
        return C.listChats();

      case C.OPS.OPEN: {
        const chatId = String(req.chatId || "");
        if (!chatId) throw new Error("Conversa inválida.");
        let warning = null;
        // o WhatsApp é a fonte da verdade: busca as últimas mensagens se estiver pronto
        if (status.ready) {
          try {
            const got = await fetchHistory(chatId);
            await C.updateChat(chatId, (c) => ({
              ...(c || { chatId, unreadCount: 0, lastMessageAt: 0 }),
              opened: true,
              historyComplete: c?.historyComplete || got.length < HISTORY_PAGE - 1,
              syncedUntil: Math.max(c?.syncedUntil || 0, ...got.map((m) => m.ts)),
            }));
          } catch (e) {
            warning = e.message;
          }
        } else warning = tabs.size ? "O WhatsApp Web ainda está carregando: mostrando o que já estava salvo." : "WhatsApp Web fechado: mostrando o que já estava salvo.";
        const messages = await C.messagesPage(chatId, { limit: HISTORY_PAGE });
        return { chat: await C.getChat(chatId), messages, warning };
      }

      case C.OPS.LOAD_MORE: {
        const { chatId, beforeTs, beforeId } = req;
        let messages = await C.messagesPage(chatId, { beforeTs, limit: HISTORY_PAGE });
        let chat = await C.getChat(chatId);
        if (messages.length < HISTORY_PAGE && !chat?.historyComplete && status.ready) {
          const anchor = messages[0]?.id || beforeId;
          const got = await fetchHistory(chatId, anchor);
          if (got.filter((m) => m.ts < beforeTs).length < HISTORY_PAGE - 1) chat = await C.updateChat(chatId, (c) => ({ ...c, historyComplete: true }));
          messages = await C.messagesPage(chatId, { beforeTs, limit: HISTORY_PAGE });
        }
        return { messages, complete: Boolean(chat?.historyComplete) && messages.length < HISTORY_PAGE };
      }

      case C.OPS.SEND_TEXT: {
        const text = String(req.text || "");
        if (!text.trim()) throw new Error("Mensagem vazia.");
        if (text.length > 65000) throw new Error("Mensagem longa demais.");
        const msg = await exec({ op: C.TAB_CMDS.SEND_TEXT, chatId: req.chatId, text }, 60000);
        if (req.extra) Object.assign(msg, req.extra); // ex.: texto original em PT (Fase 4)
        await onIncoming(msg, { chatId: req.chatId });
        return msg;
      }

      case C.OPS.MARK_READ: {
        const chat = await C.updateChat(req.chatId, (c) => (c ? { ...c, unreadCount: 0 } : null));
        if (chat) broadcast(C.EVENTS.CHAT_UPDATED, { chat });
        return true;
      }

      default:
        throw new Error(`Operação desconhecida: ${req.op}`);
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.channel !== C.CHANNEL) return false;
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
    handle(msg)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  });
})();
