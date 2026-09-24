// Conversas — código compartilhado entre o service worker (importScripts) e as
// páginas da extensão (<script>). Expõe globalThis.OrbitaChat com:
//   - o contrato de mensagens internas (nomes de operações e eventos);
//   - utilidades de telefone;
//   - o banco próprio "orbita-chat" (IndexedDB).
//
// Por que um banco separado? O banco "orbita" (v3) tem a migração duplicada
// dentro de dois bundles minificados (service_worker.js e dashboard.js). Subir
// a versão só num deles faria o outro falhar com VersionError. Um banco novo,
// criado só por este código, não mexe em nada do que já existe.
(() => {
  "use strict";
  if (globalThis.OrbitaChat) return;

  // ------------------------------------------------------------ contrato
  // Canal usado por chrome.runtime.sendMessage (painel → service worker).
  const CHANNEL = "orbita:chat";
  // Portas (chrome.runtime.connect).
  const PORT_TAB = "orbita-chat"; // aba do WhatsApp ↔ service worker
  const PORT_UI = "orbita-chat-ui"; // painel ↔ service worker (eventos ao vivo)

  // Operações que o painel pede ao service worker.
  const OPS = {
    STATUS: "wa.status",
    LIST: "chat.list",
    OPEN: "chat.open",
    LOAD_MORE: "chat.loadMore",
    SEND_TEXT: "chat.sendText",
    MARK_READ: "chat.markRead",
    REFRESH: "chat.refresh",
    SET_TRANSLATION: "chat.setTranslation", // liga/desliga e ajusta idioma/tom da conversa
    TRANSLATE_PREVIEW: "translate.preview", // PT → idioma do contato + retro-tradução
    RETRANSLATE: "message.retranslate", // tenta de novo uma tradução que falhou
    MEDIA_FETCH: "media.fetch", // baixa (se preciso) a mídia de uma mensagem para o cache
    TRANSCRIBE: "audio.transcribe", // transcreve (e traduz) um áudio
    TRANSCRIBE_DRAFT: "audio.transcribeDraft", // transcreve o que você gravou, para revisar
    VOICE_PREVIEW: "audio.generatePreview", // gera a voz (Fish Audio) do texto aprovado
    SEND_AUDIO: "chat.sendAudio", // envia a voz gerada como mensagem de voz
  };

  // Preferências das Conversas (chrome.storage.local). Sem chaves de API aqui:
  // a tradução usa o provedor configurado em "orbita:ai".
  const SETTINGS_KEY = "orbita:chat:settings";
  const DEFAULT_SETTINGS = {
    myLang: "pt", // idioma em que você lê e escreve
    defaultContactLang: "en", // idioma do contato quando ainda não foi detectado
    tone: "informal",
    requirePreview: true, // mostrar a tradução antes de enviar
    contextMessages: 6, // mensagens anteriores enviadas à IA como contexto
    glossary: [], // [{ term, translation?, keep? }]
    privacyAccepted: false,
    transcriptionProvider: "auto", // "auto" (Groq, senão OpenAI) | "groq" | "openai"
    transcribeOnOpen: true, // transcrever os áudios recebidos ao abrir a conversa
    maxAudioSec: 180, // áudios mais longos só com clique
    fishVoiceId: "", // reference_id da voz no Fish Audio (a chave fica em "orbita:chat:secrets")
    fishModel: "s2.1-pro-free", // igual ao que funciona em contas sem créditos pagos
    voiceSpeed: 1,
    maxTtsChars: 600, // texto máximo por áudio gerado
    maxVoiceSec: 60, // duração máxima do áudio gerado
    aiVoiceNotice: false, // enviar "(voz gerada por IA)" depois do áudio
  };
  // Aviso enviado depois de uma voz gerada, quando ligado nas preferências.
  const AI_VOICE_NOTICE = { pt: "(áudio com voz gerada por IA)", en: "(AI-generated voice message)", es: "(audio con voz generada por IA)", fr: "(message vocal généré par IA)", de: "(KI-generierte Sprachnachricht)", it: "(messaggio vocale generato dall'IA)" };
  async function loadSettings() {
    const r = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(r[SETTINGS_KEY] || {}) };
  }
  async function saveSettings(patch) {
    const next = { ...(await loadSettings()), ...patch };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  }
  // Idioma para o qual as mensagens deste chat são traduzidas ao enviar.
  const contactLangOf = (chat, settings) => {
    const t = chat?.translation || {};
    if (t.contactLang && t.contactLang !== "auto") return t.contactLang;
    return t.detectedLang && t.detectedLang !== settings.myLang ? t.detectedLang : settings.defaultContactLang;
  };

  // Eventos que o service worker envia ao painel pela porta PORT_UI.
  const EVENTS = {
    MESSAGE_NEW: "message.new",
    MESSAGE_UPDATED: "message.updated",
    CHAT_UPDATED: "chat.updated",
    STATUS_CHANGED: "wa.status.changed",
  };

  // Comandos que o service worker executa na aba do WhatsApp (chat-page.js).
  const TAB_CMDS = {
    STATUS: "status",
    LIST_CHATS: "listChats",
    GET_MESSAGES: "getMessages",
    SEND_TEXT: "sendText",
    DOWNLOAD_MEDIA: "downloadMedia",
    SEND_VOICE: "sendVoice",
  };

  // ------------------------------------------------------------ telefones
  const digits = (s) => String(s || "").replace(/\D/g, "");

  // Variantes brasileiras com e sem o 9º dígito (mesma regra das campanhas).
  function phoneVariants(phone) {
    const d = digits(phone);
    if (!d) return [];
    const out = [d];
    if (d.startsWith("55") && d.length === 12) out.push(`${d.slice(0, 4)}9${d.slice(4)}`);
    else if (d.startsWith("55") && d.length === 13 && d[4] === "9") out.push(`${d.slice(0, 4)}${d.slice(5)}`);
    return out;
  }

  function formatPhone(phone) {
    const d = digits(phone);
    if (!d) return "";
    if (d.startsWith("55") && d.length >= 12) return `+55 (${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}`;
    return `+${d}`;
  }

  // ------------------------------------------------------------ mensagens
  // Junta uma mensagem que chegou de novo (evento, histórico) com a que já está
  // no banco. É o que torna a gravação idempotente: o mesmo id nunca duplica, e
  // campos só nossos (tradução, transcrição) nunca são apagados.
  function mergeMessage(existing, incoming) {
    if (!existing) return { ...incoming };
    const merged = { ...existing, ...incoming };
    merged.ack = Math.max(existing.ack ?? 0, incoming.ack ?? 0);
    merged.revoked = Boolean(existing.revoked || incoming.revoked);
    if (existing.revoked) merged.text = existing.text; // mantém o que foi lido antes de apagar
    for (const k of ["translatedText", "translationStatus", "lang", "textPt"]) if (existing[k] !== undefined && incoming[k] === undefined) merged[k] = existing[k];
    if (existing.audio || incoming.audio) merged.audio = { ...(existing.audio || {}), ...(incoming.audio || {}) };
    // se o texto original mudou (mensagem editada), a tradução antiga não vale mais
    if (existing.text !== undefined && incoming.text !== undefined && existing.text !== incoming.text && !existing.revoked) {
      merged.edited = true;
      if (existing.translationStatus) merged.translationStatus = "stale";
    }
    return merged;
  }

  // Texto que representa a mensagem para tradução: a transcrição, nos áudios.
  const sourceText = (m) => (m?.type === "audio" ? m.audio?.transcript || "" : m?.text || "");

  function previewOf(msg) {
    if (!msg) return "";
    if (msg.revoked) return "🚫 Mensagem apagada";
    if (msg.type === "audio") {
      const said = (msg.fromMe ? msg.textPt : msg.translationStatus === "done" && msg.translatedText) || msg.audio?.transcript;
      return `🎤 ${said ? `“${said}”` : `Áudio${msg.audio?.duration ? ` (${Math.floor(msg.audio.duration / 60)}:${String(Math.round(msg.audio.duration % 60)).padStart(2, "0")})` : ""}`}`;
    }
    // na lista, você lê no seu idioma: a tradução das recebidas e o que você escreveu nas enviadas
    const text = (msg.fromMe ? msg.textPt : msg.translationStatus === "done" && msg.translatedText) || msg.text;
    if (msg.type === "other") return text ? `📎 ${text}` : `📎 ${msg.label || "Mídia"}`;
    return text || "";
  }

  // ------------------------------------------------------------ banco
  const DB_NAME = "orbita-chat";
  const DB_VERSION = 1;
  let dbPromise = null;

  const req = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const txDone = (tx) =>
    new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Transação cancelada."));
    });

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = (ev) => {
        const db = r.result;
        // v1 já nasce com todas as tabelas previstas no plano, para evitar migrações
        if (ev.oldVersion < 1) {
          const chats = db.createObjectStore("chats", { keyPath: "chatId" });
          chats.createIndex("byLast", "lastMessageAt");
          chats.createIndex("byPhone", "phone");
          const msgs = db.createObjectStore("messages", { keyPath: "id" });
          msgs.createIndex("byChatTs", ["chatId", "ts"]);
          db.createObjectStore("translationCache", { keyPath: "key" }).createIndex("byCreated", "createdAt");
          db.createObjectStore("mediaCache", { keyPath: "key" }).createIndex("byCreated", "createdAt");
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      r.onsuccess = () => {
        const db = r.result;
        // outra aba/versão pediu upgrade: fecha e deixa reabrir na próxima chamada
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      r.onerror = () => {
        dbPromise = null;
        reject(r.error);
      };
    });
    return dbPromise;
  }

  async function getChat(chatId) {
    const db = await openDb();
    return req(db.transaction("chats").objectStore("chats").get(chatId));
  }

  async function listChats() {
    const db = await openDb();
    const all = await req(db.transaction("chats").objectStore("chats").getAll());
    return all.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  }

  // Atualiza um chat lendo e gravando na mesma transação (sem corrida entre eventos).
  async function updateChat(chatId, fn) {
    const db = await openDb();
    const tx = db.transaction("chats", "readwrite");
    const store = tx.objectStore("chats");
    const cur = await req(store.get(chatId));
    const next = fn(cur ? { ...cur } : null);
    if (next) store.put({ ...next, chatId });
    await txDone(tx);
    return next;
  }

  // Grava várias mensagens de uma vez, mesclando com as existentes.
  // Devolve só as que são novas ou mudaram (para avisar o painel).
  async function upsertMessages(list) {
    if (!list.length) return [];
    const db = await openDb();
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    const changed = [];
    for (const m of list) {
      const cur = await req(store.get(m.id));
      const merged = mergeMessage(cur, m);
      if (!cur || JSON.stringify(cur) !== JSON.stringify(merged)) {
        store.put(merged);
        changed.push({ message: merged, isNew: !cur });
      }
    }
    await txDone(tx);
    return changed;
  }

  async function patchMessage(id, fn) {
    const db = await openDb();
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    const cur = await req(store.get(id));
    const next = cur ? fn({ ...cur }) : null;
    if (next) store.put(next);
    await txDone(tx);
    return next;
  }

  // Últimas `limit` mensagens de um chat, antes de `beforeTs` (exclusivo), em
  // ordem cronológica. Usa o índice composto [chatId, ts] com cursor reverso.
  async function messagesPage(chatId, { beforeTs = Infinity, limit = 50 } = {}) {
    const db = await openDb();
    const range = IDBKeyRange.bound([chatId, -Infinity], [chatId, beforeTs], false, true);
    const out = [];
    await new Promise((resolve, reject) => {
      const cur = db.transaction("messages").objectStore("messages").index("byChatTs").openCursor(range, "prev");
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || out.length >= limit) return resolve();
        out.push(c.value);
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
    return out.reverse();
  }

  async function countMessages(chatId) {
    const db = await openDb();
    const range = IDBKeyRange.bound([chatId, -Infinity], [chatId, Infinity]);
    return req(db.transaction("messages").objectStore("messages").index("byChatTs").count(range));
  }

  // ---- cache de mídia (áudios baixados do WhatsApp, voz gerada…)
  const MEDIA_CACHE_LIMIT = 200 * 1024 * 1024; // acima disso, apaga os mais antigos

  async function getMedia(key) {
    const db = await openDb();
    return req(db.transaction("mediaCache").objectStore("mediaCache").get(key));
  }

  async function putMedia(key, blob, extra = {}) {
    const db = await openDb();
    const tx = db.transaction("mediaCache", "readwrite");
    const store = tx.objectStore("mediaCache");
    store.put({ key, blob, mime: blob.type, size: blob.size, createdAt: Date.now(), ...extra });
    await txDone(tx);
    // limpeza: soma os tamanhos do mais novo para o mais antigo e apaga o excedente
    const tx2 = db.transaction("mediaCache", "readwrite");
    let total = 0;
    tx2.objectStore("mediaCache").index("byCreated").openCursor(null, "prev").onsuccess = (ev) => {
      const c = ev.target.result;
      if (!c) return;
      total += c.value.size || 0;
      if (total > MEDIA_CACHE_LIMIT) c.delete();
      c.continue();
    };
    await txDone(tx2);
  }

  async function getMeta(key) {
    const db = await openDb();
    return (await req(db.transaction("meta").objectStore("meta").get(key)))?.value;
  }

  async function setMeta(key, value) {
    const db = await openDb();
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put({ key, value });
    await txDone(tx);
  }

  // Abre o banco "orbita" (dos bundles) só para leitura, sem nunca criá-lo:
  // indexedDB.open sem versão criaria um banco vazio v1 se ele não existisse, e
  // aí a migração do bundle pularia a criação das tabelas.
  function openMainDbReadOnly() {
    return new Promise((resolve) => {
      const r = indexedDB.open("orbita");
      r.onupgradeneeded = () => r.transaction.abort(); // não existia: desiste
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    });
  }

  // Índice telefone → cliente (contatos das listas + etapa/tags do CRM), montado
  // numa passada só. É o mesmo critério do bundle: um "cliente" é um contato
  // de alguma lista; crmClients guarda só etapa, tags etc.
  async function loadClientIndex() {
    const index = new Map();
    const db = await openMainDbReadOnly();
    if (!db) return index;
    try {
      const has = (n) => db.objectStoreNames.contains(n);
      if (has("listContacts")) {
        for (const c of await req(db.transaction("listContacts").objectStore("listContacts").getAll())) {
          const cur = index.get(c.phone);
          if (!cur) index.set(c.phone, { phone: c.phone, name: c.name || "" });
          else if (!cur.name && c.name) cur.name = c.name;
        }
      }
      if (has("crmClients")) {
        for (const c of await req(db.transaction("crmClients").objectStore("crmClients").getAll())) {
          const cur = index.get(c.phone);
          if (cur) Object.assign(cur, { stageId: c.stageId, tags: c.tags || [] });
        }
      }
      return index;
    } finally {
      db.close();
    }
  }

  // Acha o cliente de um telefone no índice, tentando com e sem o 9º dígito.
  const findClient = (index, phone) => {
    for (const p of phoneVariants(phone)) if (index.has(p)) return index.get(p);
    return null;
  };

  globalThis.OrbitaChat = {
    CHANNEL, PORT_TAB, PORT_UI, OPS, EVENTS, TAB_CMDS,
    SETTINGS_KEY, DEFAULT_SETTINGS, loadSettings, saveSettings, contactLangOf, sourceText, getMedia, putMedia, AI_VOICE_NOTICE,
    digits, phoneVariants, formatPhone, mergeMessage, previewOf,
    DB_NAME, openDb, getChat, listChats, updateChat, upsertMessages, patchMessage, messagesPage, countMessages, getMeta, setMeta,
    openMainDbReadOnly, loadClientIndex, findClient,
  };
})();
