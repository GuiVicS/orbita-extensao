// Conversas — lado da página do WhatsApp Web (world MAIN). Usa o WA-JS
// (window.WPP) que o js/wa-js.js injeta para:
//   - escutar mensagens novas, confirmações (ack), apagadas e editadas;
//   - atender comandos (listar conversas, buscar histórico, enviar texto).
// Conversa com js/chat-content.js por window.postMessage (namespace NS).
// Toda chamada ao WA-JS da feature de Conversas fica neste arquivo: se o
// WhatsApp mudar, é aqui que se conserta.
(() => {
  "use strict";
  if (window.__orbitaChatPage) return;
  window.__orbitaChatPage = true;

  const NS = "__orbita_chat__";
  const WPP = () => window.WPP;
  const post = (msg) => window.postMessage({ ns: NS, ...msg }, window.location.origin);

  const get = (o, k) => {
    try {
      return o?.[k] ?? o?.attributes?.[k] ?? o?.get?.(k);
    } catch {
      return undefined;
    }
  };
  const ser = (id) => id?._serialized || (typeof id === "string" ? id : id ? String(id) : "");
  const PHONE = /^(\d{8,15})@c\.us$/;
  const USER_CHAT = /@(c\.us|lid)$/; // conversas 1:1
  const CHAT = /@(c\.us|lid|g\.us)$/; // 1:1 e grupos (canais, status e listas de transmissão ficam de fora)
  const isGroup = (chatId) => /@g\.us$/.test(chatId);

  // Opções de envio: responder (citar) uma mensagem e mencionar (@) participantes.
  function replyOpts(cmd) {
    const o = {};
    if (cmd.quotedMsg) o.quotedMsg = cmd.quotedMsg;
    if (cmd.mentionedList?.length) o.mentionedList = cmd.mentionedList;
    return o;
  }

  // Nome de um contato como o WhatsApp mostra (salvo > nome do perfil).
  function contactName(contact) {
    for (const k of ["name", "formattedName", "verifiedName", "pushname", "notifyName"]) {
      const v = get(contact, k);
      if (typeof v === "string" && v.trim() && !/^\+?[\d\s()-]+$/.test(v)) return v.trim();
    }
    return "";
  }
  const contactOf = (id) => {
    try {
      return WPP()?.contact?.get?.(id);
    } catch {
      return undefined;
    }
  };

  // tipos internos do WhatsApp que não são mensagens de conversa
  const SKIP = new Set(["e2e_notification", "notification_template", "notification", "gp2", "protocol", "ciphertext", "call_log", "broadcast_notification", "pinned_message", "keep_in_chat"]);
  // mídias que dá para ver/baixar nas Conversas
  const MEDIA_KINDS = { image: "image", video: "video", ptv: "video", sticker: "sticker", document: "document" };
  const LABELS = { image: "Foto", video: "Vídeo", document: "Documento", sticker: "Figurinha", location: "Localização", vcard: "Contato", multi_vcard: "Contatos", poll_creation: "Enquete", ptv: "Vídeo redondo" };

  function ready() {
    try {
      if (typeof WPP()?.conn?.isMainReady === "function") return WPP().conn.isMainReady();
    } catch {}
    return Boolean(WPP()?.isReady);
  }

  function phoneOf(chatId, contact) {
    const direct = chatId.match(PHONE)?.[1];
    if (direct) return direct;
    try {
      const c = contact ?? WPP()?.contact?.get?.(chatId);
      return ser(get(c, "phoneNumber")).match(PHONE)?.[1];
    } catch {
      return undefined;
    }
  }

  // Modelo de mensagem do WhatsApp → objeto simples que vai para o banco.
  function serializeMessage(m) {
    if (!m) return null;
    const idObj = get(m, "id");
    const id = ser(idObj);
    const fromMe = Boolean(idObj?.fromMe ?? get(m, "fromMe"));
    const chatId = ser(idObj?.remote ?? get(m, fromMe ? "to" : "from"));
    if (!id || !CHAT.test(chatId)) return null;
    const rawType = String(get(m, "type") || "");
    if (SKIP.has(rawType)) return null;
    const isAudio = rawType === "ptt" || rawType === "audio";
    const type = rawType === "chat" ? "text" : isAudio ? "audio" : rawType === "revoked" ? "text" : "other";
    const msg = {
      id,
      chatId,
      fromMe,
      ts: 1000 * Number(get(m, "t") || 0) || Date.now(),
      type,
      rawType,
      text: String((rawType === "chat" ? get(m, "body") : get(m, "caption")) || ""),
      ack: Number(get(m, "ack") ?? 0),
      revoked: rawType === "revoked",
    };
    if (isAudio) msg.audio = { duration: Number(get(m, "duration") || 0), ptt: rawType === "ptt" };
    // resposta: a mensagem citada (o WhatsApp guarda o id curto e um resumo dela)
    const qStanza = String(get(m, "quotedStanzaID") || "");
    if (qStanza) {
      const q = get(m, "quotedMsg") || {};
      const qType = String(get(q, "type") || "");
      const qPart = ser(get(m, "quotedParticipant"));
      let me = "";
      try {
        me = ser(WPP()?.conn?.getMyUserId?.());
      } catch {}
      const qContact = qPart ? contactOf(qPart) : null;
      msg.quoted = {
        stanza: qStanza,
        text: String((qType === "chat" ? get(q, "body") : get(q, "caption")) || "").slice(0, 500),
        type: qType === "chat" ? "text" : qType,
        label: LABELS[qType] || (qType === "ptt" || qType === "audio" ? "Áudio" : ""),
        fromMe: Boolean(qPart && me && qPart === me),
        authorName: qContact ? contactName(qContact) : "",
        authorPhone: qPart ? phoneOf(qPart, qContact) : undefined,
      };
    }
    // menções (@) no texto: quem foi citado, para mostrar o nome no lugar do número
    const mentioned = get(m, "mentionedJidList");
    if (mentioned?.length) {
      msg.mentions = [...mentioned].map(ser).filter(Boolean).slice(0, 50).map((jid) => {
        const c = contactOf(jid);
        return { id: jid, phone: phoneOf(jid, c) || jid.split("@")[0], name: contactName(c) };
      });
    }
    // grupo: quem mandou (id do participante, nome e número, quando o WhatsApp mostra)
    if (isGroup(chatId) && !fromMe) {
      const author = ser(get(m, "author") || get(m, "sender"));
      if (author) {
        const contact = contactOf(author);
        msg.author = author;
        msg.authorName = contactName(contact) || String(get(m, "notifyName") || "").trim();
        msg.authorPhone = phoneOf(author, contact);
      }
    }
    if (type === "other") msg.label = LABELS[rawType] || "Mídia";
    if (rawType === "document") msg.filename = String(get(m, "filename") || "");
    const kind = MEDIA_KINDS[rawType];
    if (kind) {
      // nas fotos/vídeos o WhatsApp guarda uma miniatura JPEG (base64) em "body"
      const body = get(m, "body");
      const thumb = typeof body === "string" && body.length > 100 && body.length < 120000 && /^[A-Za-z0-9+/]+=*$/.test(body.slice(0, 200)) ? body : undefined;
      const num = (k) => Number(get(m, k) || 0) || undefined;
      msg.media = { kind, mime: String(get(m, "mimetype") || ""), size: num("size"), width: num("width"), height: num("height"), duration: num("duration"), pages: num("pageCount"), gif: Boolean(get(m, "isGif")), round: rawType === "ptv", thumb };
    }
    return msg;
  }

  function serializeChat(c) {
    if (!c) return null;
    const chatId = ser(get(c, "id"));
    if (!CHAT.test(chatId)) return null;
    const group = isGroup(chatId);
    const contact = group ? null : get(c, "contact");
    const meta = group ? get(c, "groupMetadata") : null;
    let name = group ? String(get(meta, "subject") || get(c, "formattedTitle") || get(c, "name") || "").trim() : contactName(contact);
    if (!name) name = String(get(c, "formattedTitle") || "");
    let last = null;
    try {
      last = serializeMessage(get(c, "msgs")?.last?.());
    } catch {}
    if (group) {
      const parts = get(meta, "participants");
      const count = Number(parts?.length ?? parts?.models?.length ?? get(meta, "size") ?? 0);
      return { chatId, isGroup: true, name, participantsCount: count || undefined, unreadCount: Math.max(0, Number(get(c, "unreadCount") || 0)), lastMessageAt: 1000 * Number(get(c, "t") || 0) || last?.ts || 0, last, avatarUrl: cachedAvatar(chatId) };
    }
    return {
      chatId,
      phone: phoneOf(chatId, contact),
      name,
      pushname: String(get(contact, "pushname") || ""),
      unreadCount: Math.max(0, Number(get(c, "unreadCount") || 0)),
      lastMessageAt: 1000 * Number(get(c, "t") || 0) || last?.ts || 0,
      last,
      avatarUrl: cachedAvatar(chatId), // só se o WhatsApp já tiver a foto em memória (sem ir à rede)
    };
  }

  // Foto de perfil já carregada pelo WhatsApp Web (não faz pedido ao servidor).
  function cachedAvatar(chatId) {
    try {
      const t = WPP()?.whatsapp?.ProfilePicThumbStore?.get?.(chatId);
      return String(get(t, "imgFull") || get(t, "img") || "") || undefined;
    } catch {
      return undefined;
    }
  }

  async function chatFor(chatId) {
    try {
      return serializeChat(WPP().chat.get(chatId));
    } catch {
      return null;
    }
  }

  // ---- comandos vindos do service worker
  // chamada ao script das respostas rápidas (namespace "__orbita_qr__")
  const qrPending = new Map();
  window.addEventListener("message", (ev) => {
    const m = ev.data;
    if (ev.source !== window || m?.ns !== "__orbita_qr__" || m.dir !== "fromPage" || !qrPending.has(m.reqId)) return;
    const p = qrPending.get(m.reqId);
    qrPending.delete(m.reqId);
    clearTimeout(p.timer);
    m.ok ? p.resolve(m.data) : p.reject(new Error(m.error));
  });
  function qrCall(command, timeoutMs) {
    const reqId = `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => (qrPending.delete(reqId), reject(new Error("Tempo esgotado no envio da resposta rápida."))), timeoutMs);
      qrPending.set(reqId, { resolve, reject, timer });
      window.postMessage({ ns: "__orbita_qr__", dir: "toPage", reqId, command }, window.location.origin);
    });
  }

  const CHUNK = 4 * 1024 * 1024;
  const pendingMedia = new Map(); // id → Blob, enquanto os pedaços são transferidos
  const pendingUploads = new Map(); // id → { parts: Uint8Array[] }, anexos chegando das Conversas

  async function run(cmd) {
    if (cmd.op !== "status" && !ready()) throw new Error("O WhatsApp Web ainda está carregando.");
    const chat = WPP()?.chat;
    switch (cmd.op) {
      case "status": {
        let me;
        try {
          me = ser(WPP()?.conn?.getMyUserId?.()) || undefined;
        } catch {}
        return { ready: ready(), me };
      }
      case "listChats": {
        const list = (await chat.list({ count: cmd.count || 300 })) ?? [];
        return list.map(serializeChat).filter(Boolean);
      }
      case "listGroups": {
        // todos os grupos da conta (mesmo sem mensagens recentes)
        let list = [];
        try {
          list = (await chat.list({ onlyGroups: true })) ?? [];
        } catch {}
        if (!list.length) list = ((await chat.list({})) ?? []).filter((c) => isGroup(ser(get(c, "id"))));
        return list.map(serializeChat).filter((c) => c?.isGroup);
      }
      case "groupInfo": {
        // participantes com nome e número; @lid sem número conhecido conta como oculto
        const gid = cmd.chatId;
        if (!isGroup(gid)) throw new Error("Esta conversa não é um grupo.");
        const c = chat.get?.(gid);
        const meta = get(c, "groupMetadata");
        let parts = [];
        try {
          parts = (await WPP().group.getParticipants(gid)) ?? [];
        } catch {
          parts = get(meta, "participants")?.getModelsArray?.() || get(meta, "participants") || [];
        }
        let me = "";
        try {
          me = ser(WPP()?.conn?.getMyUserId?.());
        } catch {}
        const participants = [...parts].map((p) => {
          const id = ser(get(p, "id"));
          const contact = contactOf(id);
          const phone = phoneOf(id, contact);
          return { id, phone: phone || null, name: contactName(contact), pushname: String(get(contact, "pushname") || ""), isAdmin: Boolean(get(p, "isAdmin")), isSuperAdmin: Boolean(get(p, "isSuperAdmin")), isMe: Boolean(me && (id === me || (phone && me.startsWith(`${phone}@`)))) };
        });
        const creation = Number(get(meta, "creation") || 0);
        return { chatId: gid, subject: String(get(meta, "subject") || get(c, "formattedTitle") || ""), desc: String(get(meta, "desc") || ""), createdAt: creation ? creation * 1000 : null, participants };
      }
      case "getMessages": {
        const opts = { count: cmd.count || 50, direction: "before" };
        if (cmd.beforeId) opts.id = cmd.beforeId;
        const list = (await chat.getMessages(cmd.chatId, opts)) ?? [];
        return list.map(serializeMessage).filter(Boolean);
      }
      case "sendText": {
        const res = await chat.sendTextMessage(cmd.chatId, cmd.text, { createChat: true, waitForAck: false, ...replyOpts(cmd) });
        let msg = null;
        try {
          msg = serializeMessage(WPP().chat.getMessageById ? await WPP().chat.getMessageById(ser(res?.id)) : null);
        } catch {}
        const result = await Promise.race([res?.sendMsgResult, new Promise((r) => setTimeout(() => r({ timeout: true }), 30000))]).catch(() => null);
        const code = result?.messageSendResult ?? (typeof result === "string" ? result : undefined);
        if (code !== undefined && code !== "OK" && code !== WPP()?.whatsapp?.enums?.SendMsgResult?.OK) throw new Error(`O WhatsApp recusou a mensagem (${String(code)}).`);
        return msg || { id: ser(res?.id), chatId: cmd.chatId, fromMe: true, ts: Date.now(), type: "text", rawType: "chat", text: cmd.text, ack: 0, revoked: false };
      }
      case "deleteMessage": {
        // 4º argumento = revogar ("apagar para todos"); o WA-JS só revoga as suas
        // mensagens: nas dos outros ele apaga só para você (conferido antes, no service worker)
        const res = await chat.deleteMessage(cmd.chatId, cmd.id, false, Boolean(cmd.forEveryone));
        const r = Array.isArray(res) ? res[0] : res;
        const OK = WPP()?.whatsapp?.enums?.SendMsgResult?.OK ?? "OK";
        if (r && r.sendMsgResult !== undefined && r.sendMsgResult !== OK && r.sendMsgResult !== "OK") throw new Error("O WhatsApp não conseguiu apagar a mensagem.");
        return { revoked: Boolean(r?.isRevoked), deleted: Boolean(r?.isDeleted) };
      }
      case "qr": {
        // O envio das respostas rápidas já existe em js/quick-replies-page.js
        // (mesma página); aqui só repassamos, com o arquivo remontado como Blob.
        const command = { ...cmd.command };
        if (command.file) {
          const bin = atob(command.file.b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          command.blob = new Blob([bytes], { type: command.file.mime });
          delete command.file;
        }
        return qrCall(command, cmd.timeoutMs || 300000);
      }
      case "uploadChunk": {
        // anexo das Conversas chegando em pedaços (base64), remontado no sendFile
        const bin = atob(cmd.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const up = pendingUploads.get(cmd.id) || { parts: [], timer: 0 };
        clearTimeout(up.timer);
        up.timer = setTimeout(() => pendingUploads.delete(cmd.id), 5 * 60000);
        up.parts[cmd.index] = bytes;
        pendingUploads.set(cmd.id, up);
        return true;
      }
      case "sendFile": {
        const up = pendingUploads.get(cmd.uploadId);
        pendingUploads.delete(cmd.uploadId);
        clearTimeout(up?.timer);
        const parts = up?.parts || [];
        if (parts.length !== cmd.chunks || [...parts].some((p) => !p)) throw new Error("O arquivo não chegou inteiro ao WhatsApp Web. Tente de novo.");
        const file = new File(parts, cmd.filename || "arquivo", { type: cmd.mime || "application/octet-stream" });
        const o = { createChat: true, waitForAck: false, type: cmd.type, filename: cmd.filename, mimetype: file.type, ...replyOpts(cmd) };
        if (cmd.caption && cmd.type !== "audio" && cmd.type !== "sticker") o.caption = cmd.caption;
        if (cmd.type === "audio") o.isPtt = false;
        const res = await chat.sendFileMessage(cmd.chatId, file, o);
        const result = await Promise.race([res?.sendMsgResult, new Promise((r) => setTimeout(() => r({ timeout: true }), 120000))]).catch(() => null);
        const code = result?.messageSendResult ?? (typeof result === "string" ? result : undefined);
        if (code !== undefined && code !== "OK" && code !== WPP()?.whatsapp?.enums?.SendMsgResult?.OK) throw new Error(`O WhatsApp recusou o arquivo (${String(code)}).`);
        let msg = null;
        try {
          msg = serializeMessage(chat.getMessageById ? await chat.getMessageById(ser(res?.id)) : null);
        } catch {}
        if (msg) return msg;
        const fallback = { id: ser(res?.id), chatId: cmd.chatId, fromMe: true, ts: Date.now(), type: cmd.type === "audio" ? "audio" : "other", rawType: cmd.type, text: cmd.caption || "", ack: 0, revoked: false };
        if (cmd.type === "audio") fallback.audio = { duration: 0, ptt: false };
        else fallback.label = LABELS[cmd.type] || "Mídia";
        if (cmd.type === "document") fallback.filename = cmd.filename || "";
        if (MEDIA_KINDS[cmd.type]) fallback.media = { kind: MEDIA_KINDS[cmd.type], mime: file.type, size: file.size };
        return fallback;
      }
      case "profilePic": {
        // pode ir ao servidor do WhatsApp; devolve null quando a pessoa não tem foto
        // (ou a esconde pela privacidade)
        const url = await WPP().contact.getProfilePictureUrl(cmd.chatId, true).catch(() => null);
        return { url: url || cachedAvatar(cmd.chatId) || null };
      }
      case "sendVoice": {
        // isPtt = mensagem de voz com forma de onda, igual a um áudio gravado na hora
        // Vai como File: em texto (data URL), o WA-JS recusa o tipo
        // "audio/ogg; codecs=opus" com "invalid_data_url".
        const bin = atob(cmd.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const voice = new File([bytes], "audio.ogg", { type: cmd.mime });
        const res = await chat.sendFileMessage(cmd.chatId, voice, { createChat: true, waitForAck: false, type: "audio", isPtt: true, mimetype: cmd.mime, waveform: true, ...replyOpts(cmd) });
        const result = await Promise.race([res?.sendMsgResult, new Promise((r) => setTimeout(() => r({ timeout: true }), 60000))]).catch(() => null);
        const code = result?.messageSendResult ?? (typeof result === "string" ? result : undefined);
        if (code !== undefined && code !== "OK" && code !== WPP()?.whatsapp?.enums?.SendMsgResult?.OK) throw new Error(`O WhatsApp recusou o áudio (${String(code)}).`);
        let msg = null;
        try {
          msg = serializeMessage(chat.getMessageById ? await chat.getMessageById(ser(res?.id)) : null);
        } catch {}
        return msg || { id: ser(res?.id), chatId: cmd.chatId, fromMe: true, ts: Date.now(), type: "audio", rawType: "ptt", text: "", ack: 0, revoked: false, audio: { ptt: true, duration: cmd.duration || 0 } };
      }
      case "downloadMedia": {
        // A porta do Chrome só transporta JSON e tem limite de tamanho: o arquivo
        // fica guardado aqui e vai em pedaços (mediaChunk), em base64.
        const blob = await WPP().chat.downloadMedia(cmd.id);
        if (!blob?.size) throw new Error("O WhatsApp não entregou o arquivo desta mensagem.");
        if (cmd.maxBytes && blob.size > cmd.maxBytes) throw new Error(`Arquivo grande demais (${Math.round(blob.size / 1048576)} MB). Abra pelo WhatsApp.`);
        pendingMedia.set(cmd.id, blob);
        setTimeout(() => pendingMedia.delete(cmd.id), 5 * 60000);
        return { mime: blob.type || "application/octet-stream", size: blob.size, chunks: Math.ceil(blob.size / CHUNK) };
      }
      case "mediaChunk": {
        const blob = pendingMedia.get(cmd.id);
        if (!blob) throw new Error("O download expirou. Tente de novo.");
        const part = blob.slice(cmd.index * CHUNK, (cmd.index + 1) * CHUNK);
        const dataUrl = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result));
          r.onerror = () => rej(r.error);
          r.readAsDataURL(part);
        });
        if ((cmd.index + 1) * CHUNK >= blob.size) pendingMedia.delete(cmd.id);
        return { data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
      }
      default:
        throw new Error(`Comando desconhecido: ${cmd.op}`);
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    const m = ev.data;
    if (!m || m.ns !== NS || m.dir !== "toPage") return;
    try {
      post({ dir: "fromPage", reqId: m.reqId, ok: true, data: await run(m.command) });
    } catch (e) {
      post({ dir: "fromPage", reqId: m.reqId, ok: false, error: e?.message || String(e) });
    }
  });

  // ---- eventos do WhatsApp → content script
  const emit = (event, data) => post({ dir: "event", event, data });
  let hooked = false;

  function hook() {
    const w = WPP();
    if (hooked || typeof w?.on !== "function" || !ready()) return false;
    hooked = true;
    w.on("chat.new_message", async (m) => {
      try {
        if (get(m, "isNewMsg") === false) return;
        const msg = serializeMessage(m);
        if (msg) emit("message.new", { message: msg, chat: await chatFor(msg.chatId) });
      } catch (e) {
        console.warn("[Órbita] conversas: nova mensagem", e?.message);
      }
    });
    w.on("chat.msg_ack_change", (e) => {
      try {
        const ids = (e?.ids || []).map(ser).filter(Boolean);
        if (ids.length) emit("message.ack", { ids, ack: Number(e.ack) });
      } catch {}
    });
    w.on("chat.msg_revoke", (e) => {
      try {
        const id = ser(e?.refId);
        if (id) emit("message.revoke", { id });
      } catch {}
    });
    w.on("chat.msg_edited", (e) => {
      try {
        const msg = serializeMessage(e?.msg);
        if (msg) emit("message.edit", { message: msg });
      } catch {}
    });
    emitStatus(true);
    return true;
  }

  let lastStatus = "";
  function emitStatus(force = false) {
    let me;
    try {
      me = ready() ? ser(WPP()?.conn?.getMyUserId?.()) || undefined : undefined;
    } catch {}
    const s = { ready: ready(), me }; // "me" separa as conversas de contas diferentes
    const key = JSON.stringify(s);
    if (force || key !== lastStatus) {
      lastStatus = key;
      emit("status", s);
    }
  }

  // o WA-JS fica pronto alguns segundos depois do carregamento da página
  const timer = setInterval(() => {
    hook();
    emitStatus();
  }, 1500);
  window.addEventListener("pagehide", () => clearInterval(timer));
})();
