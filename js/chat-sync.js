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
  // Módulo desligado em Opções → Módulos: nada é sincronizado nem enviado.
  let enabled = true;
  C.moduleEnabled().then((v) => (enabled = v)).catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !("orbita:modules" in ch)) return;
    const was = enabled;
    enabled = ch["orbita:modules"].newValue?.conversas !== false;
    if (enabled && !was && status.ready) scheduleResync(500); // religado: busca o que chegou enquanto estava desligado
  });
  // Conta do WhatsApp conectada (ex.: "5511…@c.us"). Guardada no banco para a
  // lista continuar certa com a aba fechada ou o service worker reiniciado.
  let account = null;
  const accountReady = C.getMeta("account").then((a) => (account = account || a || null)).catch(() => {});

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
    if (!enabled && msg.event !== "status") return;
    switch (msg.event) {
      case "status": {
        const was = entry.ready;
        entry.ready = Boolean(d.ready);
        if (d.me && d.me !== account) {
          // outra conta do WhatsApp: a lista passa a mostrar só as conversas dela
          account = d.me;
          await C.setMeta("account", account);
          broadcast(C.EVENTS.CHAT_UPDATED, { all: true });
        }
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
    if (pendingExtra.has(message.id)) {
      message = { ...message, ...pendingExtra.get(message.id) };
      pendingExtra.delete(message.id);
    }
    const [change] = await C.upsertMessages([message]);
    if (!change) return;
    const chat = await touchChat(chatInfo || { chatId: message.chatId }, {
      lastMsg: change.message,
      incUnread: change.isNew && !message.fromMe && !isOpenSomewhere(message.chatId),
    });
    broadcast(change.isNew ? C.EVENTS.MESSAGE_NEW : C.EVENTS.MESSAGE_UPDATED, { message: change.message });
    broadcast(C.EVENTS.CHAT_UPDATED, { chat });
    if (chat?.translation?.enabled && needsTranslation(change.message)) queueTranslation(change.message.id);
    if (change.isNew && !message.fromMe && message.type === "audio" && isOpenSomewhere(message.chatId)) queueAudios([change.message]);
  }

  // ------------------------------------------------------ tradução
  const T = globalThis.OrbitaTranslate;
  const needsTranslation = (m) => !m.fromMe && !m.revoked && Boolean(C.sourceText(m).trim()) && (!m.translationStatus || m.translationStatus === "stale");

  // Fila das mensagens recebidas: no máximo 2 traduções ao mesmo tempo, e a
  // mesma mensagem nunca entra duas vezes.
  const queue = [];
  const queued = new Set();
  let active = 0;
  function queueTranslation(id, { front = false } = {}) {
    if (queued.has(id)) return;
    queued.add(id);
    front ? queue.unshift(id) : queue.push(id);
    pump();
  }
  function pump() {
    while (active < 2 && queue.length) {
      const id = queue.shift();
      active++;
      translateIncoming(id)
        .catch(() => {})
        .finally(() => {
          active--;
          queued.delete(id);
          pump();
        });
    }
  }

  async function contextFor(chatId, beforeTs, n) {
    if (!n) return [];
    const msgs = await C.messagesPage(chatId, { beforeTs, limit: n });
    return msgs.filter((m) => !m.revoked && C.sourceText(m)).map((m) => ({ fromMe: m.fromMe, text: m.textPt || m.translatedText || C.sourceText(m) }));
  }

  async function translateIncoming(id) {
    const settings = await C.loadSettings();
    let msg = await C.patchMessage(id, (m) => (needsTranslation(m) ? { ...m, translationStatus: "pending", translationError: undefined } : null));
    if (!msg) return;
    broadcast(C.EVENTS.MESSAGE_UPDATED, { message: msg });
    try {
      const r = await T.translate({ text: C.sourceText(msg), from: "auto", to: settings.myLang, tone: "neutral", context: await contextFor(msg.chatId, msg.ts, settings.contextMessages), glossary: settings.glossary });
      msg = await C.patchMessage(id, (m) => ({ ...m, translatedText: r.text, lang: r.detectedLang || m.lang, translationStatus: "done" }));
      // se for a última mensagem da conversa, a prévia da lista passa a ser a tradução
      const last = await C.updateChat(msg.chatId, (c) => (c?.lastMessageId === id ? { ...c, lastPreview: C.previewOf(msg) } : null));
      if (last) broadcast(C.EVENTS.CHAT_UPDATED, { chat: last });
      // guarda o idioma detectado do contato (usado quando o idioma está em "automático")
      if (r.detectedLang && r.detectedLang !== settings.myLang) {
        const chat = await C.updateChat(msg.chatId, (c) => (c && c.translation?.detectedLang !== r.detectedLang ? { ...c, translation: { ...c.translation, detectedLang: r.detectedLang } } : null));
        if (chat) broadcast(C.EVENTS.CHAT_UPDATED, { chat });
      }
    } catch (e) {
      msg = await C.patchMessage(id, (m) => ({ ...m, translationStatus: "failed", translationError: e.message, translationErrorCode: e.code }));
    }
    if (msg) broadcast(C.EVENTS.MESSAGE_UPDATED, { message: msg });
  }

  // ------------------------------------------------------ áudio recebido
  const W = globalThis.OrbitaTranscribe;
  const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

  const b64ToBlob = (b64, mime) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  };

  // Garante a mídia da mensagem no cache local, baixando da aba se preciso.
  async function ensureMedia(messageId) {
    const hit = await C.getMedia(messageId);
    if (hit?.blob) return hit;
    const r = await exec({ op: C.TAB_CMDS.DOWNLOAD_MEDIA, id: messageId, maxBytes: MAX_MEDIA_BYTES }, 180000);
    // o arquivo chega em pedaços de 4 MB (limite das mensagens entre as partes da extensão)
    const parts = [];
    for (let i = 0; i < r.chunks; i++) parts.push(b64ToBlob((await exec({ op: C.TAB_CMDS.MEDIA_CHUNK, id: messageId, index: i }, 60000)).data, r.mime));
    await C.putMedia(messageId, new Blob(parts, { type: r.mime }));
    return C.getMedia(messageId);
  }

  const tQueue = [];
  const tQueued = new Set();
  let tActive = 0;
  function queueTranscription(id, { front = false, manual = false } = {}) {
    if (tQueued.has(id)) return;
    tQueued.add(id);
    const job = { id, manual };
    front ? tQueue.unshift(job) : tQueue.push(job);
    tPump();
  }
  function tPump() {
    while (tActive < 1 && tQueue.length) {
      const job = tQueue.shift();
      tActive++;
      transcribeMessage(job)
        .catch(() => {})
        .finally(() => {
          tActive--;
          tQueued.delete(job.id);
          tPump();
        });
    }
  }

  const needsTranscription = (m) => m.type === "audio" && !m.revoked && (!m.audio?.transcriptStatus || m.audio.transcriptStatus === "failed");

  async function transcribeMessage({ id, manual }) {
    const settings = await C.loadSettings();
    let msg = await C.patchMessage(id, (m) => {
      if (m.type !== "audio" || m.revoked) return null;
      if (!manual && m.audio?.transcriptStatus) return null;
      if (!manual && (m.audio?.duration || 0) > settings.maxAudioSec) return { ...m, audio: { ...m.audio, transcriptStatus: "skipped" } };
      return { ...m, audio: { ...m.audio, transcriptStatus: "pending", transcriptError: undefined } };
    });
    if (!msg) return;
    broadcast(C.EVENTS.MESSAGE_UPDATED, { message: msg });
    if (msg.audio.transcriptStatus === "skipped") return;
    try {
      const media = await ensureMedia(id);
      const r = await W.transcribe(media.blob, { provider: settings.transcriptionProvider });
      msg = await C.patchMessage(id, (m) => ({
        ...m,
        lang: r.lang || m.lang,
        audio: { ...m.audio, transcript: r.text, transcriptLang: r.lang, transcriptStatus: r.text ? "done" : "empty" },
        // transcrição nova = tradução antiga (se houver) não vale mais
        translationStatus: m.translationStatus ? "stale" : undefined,
      }));
    } catch (e) {
      msg = await C.patchMessage(id, (m) => ({ ...m, audio: { ...m.audio, transcriptStatus: "failed", transcriptError: e.message, transcriptErrorCode: e.code } }));
    }
    broadcast(C.EVENTS.MESSAGE_UPDATED, { message: msg });
    const last = await C.updateChat(msg.chatId, (c) => (c?.lastMessageId === id ? { ...c, lastPreview: C.previewOf(msg) } : null));
    if (last) broadcast(C.EVENTS.CHAT_UPDATED, { chat: last });
    const chat = await C.getChat(msg.chatId);
    if (chat?.translation?.enabled && needsTranslation(msg)) queueTranslation(id, { front: true });
  }

  async function queueAudios(messages) {
    const settings = await C.loadSettings();
    if (!settings.transcribeOnOpen) return;
    for (const m of [...messages].reverse()) if (!m.fromMe && needsTranscription(m) && m.audio?.transcriptStatus !== "failed") queueTranscription(m.id);
  }

  function queueChat(messages) {
    // da mais nova para a mais antiga: o que está na tela primeiro
    for (const m of [...messages].reverse()) if (needsTranslation(m)) queueTranslation(m.id);
  }

  // Prévia do envio: PT → idioma do contato, e a volta para PT para conferir.
  // A tradução aprovada fica guardada (no banco, o service worker pode dormir);
  // só um texto idêntico a ela pode ser enviado depois.
  async function preview(chatId, textPt) {
    const settings = await C.loadSettings();
    const chat = await C.getChat(chatId);
    if (!chat?.translation?.enabled) throw new Error("A tradução não está ligada nesta conversa.");
    const to = C.contactLangOf(chat, settings);
    const tone = chat.translation.tone || settings.tone;
    const context = await contextFor(chatId, Infinity, settings.contextMessages);
    const fwd = await T.translate({ text: textPt, from: settings.myLang, to, tone, context, glossary: settings.glossary });
    const back = await T.translate({ text: fwd.text, from: to, to: settings.myLang, tone: "neutral", glossary: settings.glossary });
    const result = { textPt, translated: fwd.text, backTranslated: back.text, to, toName: T.langName(to), createdAt: Date.now() };
    await C.setMeta(`preview:${chatId}`, result);
    return result;
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
        translation: { enabled: false, contactLang: "auto", tone: "" }, // tom vazio = o padrão das preferências
        unreadCount: 0,
        lastMessageAt: 0,
        ...cur,
      };
      if (info.name) next.name = info.name;
      if (info.pushname) next.pushname = info.pushname;
      if (info.avatarUrl && info.avatarUrl !== next.avatarUrl) Object.assign(next, { avatarUrl: info.avatarUrl, avatarAt: Date.now() });
      if (info.phone) next.phone = info.phone;
      // de qual conta do WhatsApp é esta conversa (dados ao vivo vêm sempre da conta conectada)
      if (account) next.account = account;
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
    if (!enabled) return;
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

  // ------------------------------------------------------ fotos de perfil
  // Uma de cada vez (para não sobrecarregar o WhatsApp) e no máximo uma vez por
  // dia por conversa, a menos que a imagem tenha falhado ao carregar (force).
  const AVATAR_TTL = 24 * 3600 * 1000;
  let avatarChain = Promise.resolve();
  const avatarBusy = new Map();
  function fetchAvatar(chatId, force) {
    if (avatarBusy.has(chatId)) return avatarBusy.get(chatId);
    const job = (avatarChain = avatarChain.then(async () => {
      const chat = await C.getChat(chatId);
      if (!chat) return null;
      if (!force && chat.avatarAt && Date.now() - chat.avatarAt < AVATAR_TTL) return chat;
      if (!status.ready) return chat;
      const r = await exec({ op: C.TAB_CMDS.PROFILE_PIC, chatId }, 20000).catch(() => null);
      if (!r) return chat;
      const next = await C.updateChat(chatId, (c) => (c ? { ...c, avatarUrl: r.url || null, avatarAt: Date.now() } : null));
      if (next && next.avatarUrl !== chat.avatarUrl) broadcast(C.EVENTS.CHAT_UPDATED, { chat: next });
      return next;
    }));
    avatarBusy.set(chatId, job);
    job.finally(() => avatarBusy.delete(chatId));
    return job;
  }

  // ------------------------------------------------------ respostas rápidas
  // Envia uma resposta rápida (a mesma das barras do WhatsApp Web) numa conversa.
  // O envio em si é feito por js/quick-replies-page.js, na aba do WhatsApp.
  const QR = globalThis.OrbitaQR;
  const pendingExtra = new Map(); // id da mensagem → campos nossos (textPt…), aplicados quando o evento chegar
  const qrRuns = new Map(); // chatId → { cancel }
  const qrExec = (command, timeoutMs = 120000) => exec({ op: C.TAB_CMDS.QR, command, timeoutMs }, timeoutMs + 5000);

  // Passos com variáveis preenchidas e, se a conversa for traduzida, textos traduzidos.
  async function prepareQuickReply(chatId, itemId) {
    const data = await QR.load();
    const item = data.items.find((i) => i.id === itemId);
    if (!item) throw new Error("Resposta rápida não encontrada.");
    const chat = await C.getChat(chatId);
    const ctx = { name: chat?.client?.name || chat?.name || "", phone: chat?.phone || "", me: "" };
    const settings = await C.loadSettings();
    const translate = Boolean(chat?.translation?.enabled);
    const to = translate ? C.contactLangOf(chat, settings) : null;
    const tone = chat?.translation?.tone || settings.tone;
    const tr = async (text) => {
      const pt = QR.renderVars(text || "", ctx).trim();
      if (!translate || !pt) return { pt, out: pt };
      const r = await T.translate({ text: pt, from: settings.myLang, to, tone, glossary: settings.glossary });
      return { pt, out: r.text };
    };
    const steps = [];
    for (const st of item.steps) {
      const p = { ...st };
      if (st.type === "text") Object.assign(p, await tr(st.text).then((r) => ({ textPt: r.pt, text: r.out })));
      if (st.caption) Object.assign(p, await tr(st.caption).then((r) => ({ captionPt: r.pt, caption: r.out })));
      if (st.type === "poll") {
        const n = await tr(st.pollName);
        p.pollName = n.out;
        p.pollOptions = [];
        for (const o of st.pollOptions || []) p.pollOptions.push((await tr(o)).out);
      }
      if (st.type === "location" && st.name) p.name = (await tr(st.name)).out;
      steps.push(p);
    }
    return { item: { id: item.id, title: item.title }, steps, translated: translate, to, settings: data.settings };
  }

  const stepLabel = (s) => ({ text: "digitando…", audio: s.ptt ? "gravando áudio…" : "enviando áudio…", image: "enviando foto…", video: "enviando vídeo…", document: "enviando documento…", sticker: "enviando figurinha…", location: "enviando localização…", contact: "enviando contato…", poll: "criando enquete…" })[s.type] || "enviando…";

  async function runQuickReply(chatId, prep) {
    const run = { cancel: false };
    qrRuns.set(chatId, run);
    const st = prep.settings;
    const total = prep.steps.length;
    const progress = (extra) => broadcast(C.EVENTS.QR_PROGRESS, { chatId, title: prep.item.title, total, ...extra });
    const wait = async (ms) => {
      for (const end = Date.now() + ms; Date.now() < end; ) {
        if (run.cancel) throw new Error("__cancel__");
        await new Promise((r) => setTimeout(r, Math.min(150, end - Date.now())));
      }
    };
    let sent = 0;
    try {
      for (let i = 0; i < total; i++) {
        const s = prep.steps[i];
        const gap = (i > 0 ? st.stepDelaySec : 0) + (s.delaySec || 0);
        if (gap > 0) {
          progress({ index: i, label: "aguardando…" });
          await wait(gap * 1000);
        }
        progress({ index: i, label: stepLabel(s) });
        let r;
        if (s.type === "text") {
          if (!s.text.trim()) continue;
          if (st.simulate) {
            await qrExec({ op: "presence", kind: "composing", chatId });
            await wait(Math.min(st.maxTypingSec * 1000, Math.max(700, (s.text.length / Math.max(4, st.typingCps)) * 1000)));
          }
          r = await qrExec({ op: "sendText", chatId, text: s.text, linkPreview: s.linkPreview !== false });
          if (r?.id && s.textPt && s.textPt !== s.text) pendingExtra.set(r.id, { textPt: s.textPt });
        } else if (["audio", "image", "video", "document", "sticker"].includes(s.type)) {
          const rec = await QR.getMediaRecord(s.mediaId);
          if (!rec?.data) throw new Error(`Arquivo da resposta “${prep.item.title}” não encontrado. Edite a resposta e anexe de novo.`);
          if (s.type === "audio" && s.ptt && st.simulate) {
            await qrExec({ op: "presence", kind: "recording", chatId });
            await wait(Math.min(st.maxRecordingSec * 1000, Math.max(1500, (s.duration || 3) * 1000)));
          }
          r = await qrExec(
            { op: "sendFile", chatId, file: { b64: rec.data, mime: rec.mime || s.mime }, type: s.type, filename: s.name || "arquivo", mimetype: s.mime || rec.mime, caption: s.caption || undefined, isPtt: s.type === "audio" && Boolean(s.ptt), isPtv: Boolean(s.ptv), isGif: Boolean(s.gif), isHD: Boolean(s.hd), isViewOnce: Boolean(s.viewOnce) },
            300000,
          );
          if (r?.id && s.captionPt && s.captionPt !== s.caption) pendingExtra.set(r.id, { textPt: s.captionPt });
        } else if (s.type === "location") r = await qrExec({ op: "sendLocation", chatId, lat: s.lat, lng: s.lng, name: s.name, address: s.address, url: s.url });
        else if (s.type === "contact") r = await qrExec({ op: "sendContact", chatId, name: s.contactName, phone: s.contactPhone });
        else if (s.type === "poll") r = await qrExec({ op: "sendPoll", chatId, name: s.pollName, options: (s.pollOptions || []).filter(Boolean), multiple: Boolean(s.pollMultiple) });
        sent++;
      }
      await QR.bumpStats(prep.item.id).catch(() => {});
      progress({ done: true, sent });
    } catch (e) {
      progress({ done: true, sent, error: e.message === "__cancel__" ? null : e.message, canceled: e.message === "__cancel__" });
    } finally {
      qrExec({ op: "presence", kind: "paused", chatId }, 5000).catch(() => {});
      qrRuns.delete(chatId);
    }
  }

  // ------------------------------------------------------ pedidos do painel
  async function handle(req) {
    if (req.op !== C.OPS.STATUS && !(await C.moduleEnabled())) throw new Error("As Conversas estão desligadas em Opções → Módulos.");
    switch (req.op) {
      case C.OPS.STATUS:
        return status;

      case C.OPS.LIST:
        await accountReady;
        return (await C.listChats()).filter((c) => !account || !c.account || c.account === account);

      case C.OPS.REFRESH:
        await resync();
        return (await C.listChats()).filter((c) => !account || !c.account || c.account === account);

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
        const chat = await C.getChat(chatId);
        if (chat?.translation?.enabled) queueChat(messages);
        if (status.ready) queueAudios(messages);
        return { chat, messages, warning };
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
        if (chat?.translation?.enabled) queueChat(messages);
        if (status.ready) queueAudios(messages);
        return { messages, complete: Boolean(chat?.historyComplete) && messages.length < HISTORY_PAGE };
      }

      case C.OPS.SEND_TEXT: {
        let text = String(req.text || "");
        let extra;
        const chat = await C.getChat(req.chatId);
        if (chat?.translation?.enabled) {
          // Falha segura: com a tradução ligada, só sai um texto traduzido pela
          // própria extensão — nunca o português digitado, nem por engano.
          const textPt = String(req.textPt || "");
          if (!textPt.trim()) throw new Error("Tradução ligada: escreva a mensagem em português para ser traduzida.");
          if (req.skipPreview) {
            const settings = await C.loadSettings();
            if (settings.requirePreview) throw new Error("A prévia da tradução é obrigatória (veja as preferências das Conversas).");
            text = (await preview(req.chatId, textPt)).translated;
          } else {
            const p = await C.getMeta(`preview:${req.chatId}`);
            if (!p || p.textPt !== textPt || p.translated !== text) throw new Error("A tradução mudou ou expirou. Gere a prévia de novo antes de enviar.");
          }
          extra = { textPt, translatedFrom: textPt, lang: C.contactLangOf(chat, await C.loadSettings()) };
        }
        if (!text.trim()) throw new Error("Mensagem vazia.");
        if (text.length > 65000) throw new Error("Mensagem longa demais.");
        const msg = await exec({ op: C.TAB_CMDS.SEND_TEXT, chatId: req.chatId, text }, 60000);
        if (extra) Object.assign(msg, extra);
        await onIncoming(msg, { chatId: req.chatId });
        if (extra) await C.setMeta(`preview:${req.chatId}`, null); // uma prévia vale para um envio
        return msg;
      }

      case C.OPS.TRANSLATE_PREVIEW:
        if (!String(req.textPt || "").trim()) throw new Error("Mensagem vazia.");
        return preview(req.chatId, String(req.textPt));

      case C.OPS.SET_TRANSLATION: {
        const patch = {};
        if ("enabled" in req) patch.enabled = Boolean(req.enabled);
        if ("contactLang" in req) patch.contactLang = String(req.contactLang || "auto");
        if ("tone" in req) patch.tone = String(req.tone || "");
        const chat = await C.updateChat(req.chatId, (c) => (c ? { ...c, translation: { ...(c.translation || {}), ...patch } } : null));
        if (!chat) throw new Error("Conversa não encontrada.");
        broadcast(C.EVENTS.CHAT_UPDATED, { chat });
        if (chat.translation.enabled) queueChat(await C.messagesPage(req.chatId, { limit: HISTORY_PAGE }));
        return chat;
      }

      case C.OPS.MEDIA_FETCH: {
        const media = await ensureMedia(String(req.messageId));
        return { key: media.key, mime: media.mime, size: media.size };
      }

      case C.OPS.QR_PREPARE: {
        const prep = await prepareQuickReply(String(req.chatId), String(req.itemId));
        if (!prep.translated) return { translated: false };
        // prévia aprovada fica guardada: só estes textos traduzidos podem sair
        const approvalId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        await C.setMeta(`qr:${req.chatId}`, { approvalId, prep });
        return { translated: true, approvalId, to: prep.to, toName: T.langName(prep.to), title: prep.item.title, steps: prep.steps.map((s) => ({ type: s.type, text: s.text, textPt: s.textPt, caption: s.caption, captionPt: s.captionPt, pollName: s.pollName, ptt: s.ptt, name: s.name })) };
      }

      case C.OPS.QR_RUN: {
        const chatId = String(req.chatId);
        if (qrRuns.has(chatId)) throw new Error("Já há uma resposta rápida sendo enviada nesta conversa.");
        if (!status.ready) throw new Error("Abra o WhatsApp Web em uma aba para enviar.");
        const chat = await C.getChat(chatId);
        let prep;
        if (chat?.translation?.enabled) {
          // tradução ligada: só envia a versão traduzida que você viu na prévia
          const a = await C.getMeta(`qr:${chatId}`);
          if (!a || a.approvalId !== req.approvalId || a.prep.item.id !== req.itemId) throw new Error("Confira a tradução da resposta rápida antes de enviar.");
          prep = a.prep;
          await C.setMeta(`qr:${chatId}`, null);
        } else prep = await prepareQuickReply(chatId, String(req.itemId));
        runQuickReply(chatId, prep); // em segundo plano; o andamento vai pelo evento QR_PROGRESS
        return { started: true, total: prep.steps.length };
      }

      case C.OPS.QR_CANCEL: {
        const run = qrRuns.get(String(req.chatId));
        if (run) run.cancel = true;
        return Boolean(run);
      }

      case C.OPS.AVATAR:
        return fetchAvatar(String(req.chatId), Boolean(req.force));

      case C.OPS.CRM_CHANGED: {
        clientIndex = null; // relê contatos/etapas/tags do CRM
        const chat = await touchChat({ chatId: String(req.chatId) });
        broadcast(C.EVENTS.CHAT_UPDATED, { chat });
        return chat;
      }

      case C.OPS.TRANSCRIBE:
        queueTranscription(String(req.messageId), { front: true, manual: true });
        return true;

      case C.OPS.TRANSCRIBE_DRAFT: {
        const settings = await C.loadSettings();
        const blob = b64ToBlob(String(req.data || ""), String(req.mime || "audio/webm"));
        if (blob.size > 10 * 1024 * 1024) throw new Error("Gravação longa demais.");
        const r = await W.transcribe(blob, { provider: settings.transcriptionProvider, language: settings.myLang });
        if (!r.text) throw new Error("Não deu para entender a gravação. Tente de novo, mais perto do microfone.");
        return { text: r.text };
      }

      case C.OPS.VOICE_PREVIEW: {
        // Qual texto vira voz: com tradução, só o da prévia aprovada; sem, o que você digitou.
        const settings = await C.loadSettings();
        const chat = await C.getChat(req.chatId);
        const textPt = String(req.textPt || "");
        let text = textPt;
        let lang = settings.myLang;
        if (chat?.translation?.enabled) {
          const p = await C.getMeta(`preview:${req.chatId}`);
          if (!p || p.textPt !== textPt) throw new Error("Gere e confira a tradução antes de gerar a voz.");
          text = p.translated;
          lang = p.to;
        }
        if (!text.trim()) throw new Error("Mensagem vazia.");
        if (text.length > settings.maxTtsChars) throw new Error(`Texto longo demais para um áudio (máx. ${settings.maxTtsChars} caracteres).`);
        const V = globalThis.OrbitaVoice;
        const opts = { text, voiceId: settings.fishVoiceId, model: settings.fishModel || V.DEFAULT_MODEL, speed: settings.voiceSpeed };
        let mp3Key = await V.cacheKey(opts);
        let notice = null;
        if (req.fresh || !(await C.getMedia(mp3Key))?.blob) {
          const r = await V.tts(opts);
          if (r.fellBack) {
            // o modelo escolhido exige créditos pagos: passa a usar o gratuito
            await C.saveSettings({ fishModel: r.model });
            mp3Key = await V.cacheKey({ ...opts, model: r.model });
            notice = `O modelo ${opts.model} exige créditos pagos no Fish Audio; a voz foi gerada com o ${r.model}, que passa a ser o padrão.`;
          }
          await C.putMedia(mp3Key, r.blob, { text });
        }
        const genId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        await C.setMeta(`voice:${req.chatId}`, { genId, text, textPt, lang, createdAt: Date.now() });
        return { genId, mp3Key, text, textPt, lang, maxVoiceSec: settings.maxVoiceSec, notice };
      }

      case C.OPS.SEND_AUDIO: {
        // Falha segura: só sai o áudio gerado a partir da aprovação guardada aqui.
        const settings = await C.loadSettings();
        const approval = await C.getMeta(`voice:${req.chatId}`);
        if (!approval || approval.genId !== req.genId) throw new Error("A voz mudou ou expirou. Gere de novo antes de enviar.");
        const rec = await C.getMedia(`gen:${req.genId}`);
        if (!rec?.blob || rec.chatId !== req.chatId || rec.text !== approval.text) throw new Error("Áudio gerado não encontrado. Gere de novo.");
        if (!(rec.duration > 0) || rec.duration > settings.maxVoiceSec + 1) throw new Error(`O áudio gerado passou do limite de ${settings.maxVoiceSec} s.`);
        const bytes = new Uint8Array(await rec.blob.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        const msg = await exec({ op: C.TAB_CMDS.SEND_VOICE, chatId: req.chatId, data: btoa(bin), mime: rec.blob.type || "audio/ogg; codecs=opus", duration: rec.duration }, 120000);
        Object.assign(msg, { textPt: approval.textPt, lang: approval.lang, audio: { ...(msg.audio || {}), ptt: true, duration: Math.round(rec.duration), generated: true, transcript: approval.text, transcriptStatus: "done" } });
        await C.putMedia(msg.id, rec.blob); // o player toca sem baixar de novo
        await onIncoming(msg, { chatId: req.chatId });
        await C.setMeta(`voice:${req.chatId}`, null);
        await C.setMeta(`preview:${req.chatId}`, null);
        if (settings.aiVoiceNotice) {
          const notice = C.AI_VOICE_NOTICE[approval.lang] || C.AI_VOICE_NOTICE.en;
          const n = await exec({ op: C.TAB_CMDS.SEND_TEXT, chatId: req.chatId, text: notice }, 60000).catch(() => null);
          if (n) await onIncoming(n, { chatId: req.chatId });
        }
        return msg;
      }

      case C.OPS.RETRANSLATE: {
        const m = await C.patchMessage(req.messageId, (m) => (m.fromMe ? null : { ...m, translationStatus: "stale" }));
        if (m) queueTranslation(m.id, { front: true });
        return true;
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
