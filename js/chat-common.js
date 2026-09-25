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
    VOICE_DUB: "audio.dub", // dubla a gravação (ElevenLabs), áudio → áudio
    DUB_INCOMING: "audio.dubIncoming", // dubla um áudio recebido para o seu idioma (ElevenLabs), só o áudio
    SEND_AUDIO: "chat.sendAudio", // envia a voz gerada como mensagem de voz
    CRM_CHANGED: "crm.changed", // o CRM foi editado nas Conversas: refaz o vínculo da conversa
    AVATAR: "chat.avatar", // busca/atualiza a foto de perfil da conversa
    QR_PREPARE: "qr.prepare", // resposta rápida: traduz os passos para a prévia (tradução ligada)
    QR_RUN: "qr.run", // resposta rápida: envia a sequência
    QR_CANCEL: "qr.cancel",
    DELETE_MESSAGE: "message.delete", // apagar para mim / para todos
    SEND_FILE: "chat.sendFile", // anexo colado, arrastado ou escolhido (foto, vídeo, documento…)
    CORRECT: "text.correct", // corretor: ortografia e gramática do texto antes de enviar
    GROUP_LIST: "group.list", // todos os grupos da conta
    GROUP_INFO: "group.info", // participantes (nome, número, admin) de um grupo
    GROUP_RESOLVE: "group.resolvePhone", // número de um participante oculto (@lid), um por vez
  };

  // Módulo ligado/desligado em Opções → Módulos (padrão: ligado).
  async function moduleEnabled() {
    const m = (await chrome.storage.local.get("orbita:modules"))["orbita:modules"] || {};
    return m.conversas !== false;
  }

  // Preferências das Conversas (chrome.storage.local). Sem chaves de API aqui:
  // a tradução usa o provedor configurado em "orbita:ai".
  const SETTINGS_KEY = "orbita:chat:settings";
  const DEFAULT_SETTINGS = {
    myLang: "pt", // idioma em que você lê e escreve
    defaultContactLang: "en", // idioma do contato quando ainda não foi detectado
    tone: "informal",
    requirePreview: true, // mostrar a tradução antes de enviar
    autoCorrect: false, // corrigir ortografia e gramática antes de enviar (sem tradução)
    autoCorrectReview: true, // mostrar a correção antes de enviar
    contextMessages: 6, // mensagens anteriores enviadas à IA como contexto
    glossary: [], // [{ term, translation?, keep? }]
    privacyAccepted: false,
    transcriptionProvider: "auto", // "auto" (Groq, senão OpenAI) | "groq" | "openai"
    transcribeOnOpen: true, // transcrever os áudios recebidos ao abrir a conversa
    maxAudioSec: 180, // áudios mais longos só com clique
    fishVoiceId: "", // reference_id da voz no Fish Audio (a chave fica em "orbita:chat:secrets")
    fishModel: "s2.1-pro-free", // igual ao que funciona em contas sem créditos pagos
    voiceEngine: "fish", // "fish" (texto → voz) | "elevenlabs" (gravação dublada, mantém a entonação)
    dubDropBackground: true, // ElevenLabs: tira ruído e música de fundo
    dubTimeoutSec: 180, // ElevenLabs: tempo máximo esperando a dublagem ficar pronta
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
    MESSAGE_DELETED: "message.deleted", // apagada "para mim": some da conversa
    CHAT_UPDATED: "chat.updated",
    STATUS_CHANGED: "wa.status.changed",
    QR_PROGRESS: "qr.progress", // andamento do envio de uma resposta rápida
    VOICE_PROGRESS: "voice.progress", // andamento da dublagem (ElevenLabs)
  };

  // Comandos que o service worker executa na aba do WhatsApp (chat-page.js).
  const TAB_CMDS = {
    STATUS: "status",
    LIST_CHATS: "listChats",
    GET_MESSAGES: "getMessages",
    SEND_TEXT: "sendText",
    DOWNLOAD_MEDIA: "downloadMedia",
    SEND_VOICE: "sendVoice",
    PROFILE_PIC: "profilePic",
    MEDIA_CHUNK: "mediaChunk",
    QR: "qr", // repassa um comando ao envio de respostas rápidas (js/quick-replies-page.js)
    DELETE_MESSAGE: "deleteMessage",
    UPLOAD_CHUNK: "uploadChunk", // pedaço de um anexo (a porta tem limite de tamanho)
    SEND_FILE: "sendFile", // envia o anexo remontado com os pedaços
    LIST_GROUPS: "listGroups",
    GROUP_INFO: "groupInfo",
    RESOLVE_PHONE: "resolvePhone",
  };

  // O WhatsApp só deixa "apagar para todos" as suas mensagens, até cerca de
  // 2 dias e meio depois do envio (60 h).
  const REVOKE_WINDOW_MS = 60 * 3600 * 1000;
  const canRevoke = (m, now = Date.now()) => Boolean(m?.fromMe && !m.revoked && !String(m.id).startsWith("pending-") && now - (m.ts || 0) < REVOKE_WINDOW_MS);

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
    // o evento do WhatsApp pode chegar sem a miniatura que já temos (anexo enviado daqui)
    if (existing.media && incoming.media) merged.media = { ...existing.media, ...Object.fromEntries(Object.entries(incoming.media).filter(([, v]) => v !== undefined)) };
    // se o texto original mudou (mensagem editada), a tradução antiga não vale mais
    if (existing.text !== undefined && incoming.text !== undefined && existing.text !== incoming.text && !existing.revoked) {
      merged.edited = true;
      if (existing.translationStatus) merged.translationStatus = "stale";
    }
    return merged;
  }

  // Diferença por palavras: os pedaços de `b`, marcando o que não existe em `a`
  // (usado para destacar o que o corretor mudou). Textos grandes: tudo sem marca.
  function diffWords(a, b) {
    const A = String(a ?? "").split(/(\s+)/).filter(Boolean);
    const B = String(b ?? "").split(/(\s+)/).filter(Boolean);
    if (A.length * B.length > 1e6) return B.map((t) => ({ t, changed: false }));
    const L = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
    for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0;
    for (let j = 0; j < B.length; j++) {
      while (i < A.length && A[i] !== B[j] && L[i + 1][j] >= L[i][j + 1]) i++;
      if (i < A.length && A[i] === B[j]) {
        out.push({ t: B[j], changed: false });
        i++;
      } else out.push({ t: B[j], changed: !/^\s+$/.test(B[j]) });
    }
    return out;
  }

  // Mensagem só com emojis (até 3): o WhatsApp mostra grande. Devolve quantos
  // (1 a 3), ou 0 se tiver qualquer outra coisa.
  const EMOJI_RE = /^(?:\p{RI}\p{RI}|[\p{Extended_Pictographic}\p{Emoji_Presentation}](?:\uFE0F|\p{EMod})?(?:\u200D[\p{Extended_Pictographic}\p{Emoji_Presentation}](?:\uFE0F|\p{EMod})?)*|[#*0-9]\uFE0F?\u20E3)$/u;
  function emojiOnly(text) {
    const t = String(text || "").trim();
    if (!t || t.length > 60) return 0;
    const parts = [...new Intl.Segmenter("pt", { granularity: "grapheme" }).segment(t)].map((s) => s.segment).filter((s) => s.trim());
    if (!parts.length || parts.length > 3) return 0;
    return parts.every((p) => EMOJI_RE.test(p) && !/^[0-9#*]$/.test(p)) ? parts.length : 0;
  }

  // Texto que representa a mensagem para tradução: a transcrição, nos áudios.
  const sourceText = (m) => (m?.type === "audio" ? m.audio?.transcript || "" : m?.text || "");

  // Grupo: "Fulano: …" antes da prévia das mensagens dos outros.
  function previewOf(msg) {
    const p = previewBody(msg);
    if (!msg?.author || msg.fromMe || msg.revoked || !p) return p;
    const who = (msg.authorName || "").split(/\s+/)[0] || formatPhone(msg.authorPhone) || "Alguém";
    return `${who}: ${p}`;
  }
  function previewBody(msg) {
    if (!msg) return "";
    if (msg.revoked) return msg.fromMe ? "🚫 Você apagou esta mensagem" : "🚫 Mensagem apagada";
    if (msg.type === "audio") {
      const said = (msg.fromMe ? msg.textPt : msg.translationStatus === "done" && msg.translatedText) || msg.audio?.transcript;
      return `🎤 ${said ? `“${said}”` : `Áudio${msg.audio?.duration ? ` (${Math.floor(msg.audio.duration / 60)}:${String(Math.round(msg.audio.duration % 60)).padStart(2, "0")})` : ""}`}`;
    }
    // na lista, você lê no seu idioma: a tradução das recebidas e o que você escreveu nas enviadas
    const text = (msg.fromMe ? msg.textPt : msg.translationStatus === "done" && msg.translatedText) || msg.text;
    if (msg.type === "other") return text ? `📎 ${text}` : `📎 ${msg.filename || msg.label || "Mídia"}`;
    return text || "";
  }

  // ------------------------------------------------------------ banco
  const DB_NAME = "orbita-chat";
  const DB_VERSION = 2;
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
        // v2: biblioteca de figurinhas (recebidas, criadas, favoritas)
        if (ev.oldVersion < 2) db.createObjectStore("stickers", { keyPath: "id" }).createIndex("byUsed", "usedAt");
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

  async function deleteMedia(key) {
    const db = await openDb();
    const tx = db.transaction("mediaCache", "readwrite");
    tx.objectStore("mediaCache").delete(key);
    await txDone(tx);
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

  async function getMessage(id) {
    const db = await openDb();
    return req(db.transaction("messages").objectStore("messages").get(id));
  }

  async function deleteMessageRecord(id) {
    const db = await openDb();
    const tx = db.transaction(["messages", "mediaCache"], "readwrite");
    tx.objectStore("messages").delete(id);
    tx.objectStore("mediaCache").delete(id); // arquivo baixado dessa mensagem, se houver
    await txDone(tx);
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
    REVOKE_WINDOW_MS, canRevoke, getMessage, deleteMessageRecord,
    moduleEnabled, SETTINGS_KEY, DEFAULT_SETTINGS, loadSettings, saveSettings, contactLangOf, sourceText, getMedia, putMedia, deleteMedia, diffWords, emojiOnly, AI_VOICE_NOTICE,
    digits, phoneVariants, formatPhone, mergeMessage, previewOf,
    DB_NAME, openDb, getChat, listChats, updateChat, upsertMessages, patchMessage, messagesPage, countMessages, getMeta, setMeta,
    openMainDbReadOnly, loadClientIndex, findClient,
  };
})();
