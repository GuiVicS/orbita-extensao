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
  const USER_CHAT = /@(c\.us|lid)$/; // só conversas 1:1 (grupos ficam de fora)

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
    if (!id || !USER_CHAT.test(chatId)) return null;
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
    if (!USER_CHAT.test(chatId)) return null;
    const contact = get(c, "contact");
    let name = "";
    for (const k of ["name", "formattedName", "verifiedName", "pushname", "notifyName"]) {
      const v = get(contact, k);
      if (typeof v === "string" && v.trim() && !/^\+?[\d\s()-]+$/.test(v)) {
        name = v.trim();
        break;
      }
    }
    if (!name) name = String(get(c, "formattedTitle") || "");
    let last = null;
    try {
      last = serializeMessage(get(c, "msgs")?.last?.());
    } catch {}
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
        const list = (await chat.list({ onlyUsers: true, count: cmd.count || 300 })) ?? [];
        return list.map(serializeChat).filter(Boolean);
      }
      case "getMessages": {
        const opts = { count: cmd.count || 50, direction: "before" };
        if (cmd.beforeId) opts.id = cmd.beforeId;
        const list = (await chat.getMessages(cmd.chatId, opts)) ?? [];
        return list.map(serializeMessage).filter(Boolean);
      }
      case "sendText": {
        const res = await chat.sendTextMessage(cmd.chatId, cmd.text, { createChat: true, waitForAck: false });
        let msg = null;
        try {
          msg = serializeMessage(WPP().chat.getMessageById ? await WPP().chat.getMessageById(ser(res?.id)) : null);
        } catch {}
        const result = await Promise.race([res?.sendMsgResult, new Promise((r) => setTimeout(() => r({ timeout: true }), 30000))]).catch(() => null);
        const code = result?.messageSendResult ?? (typeof result === "string" ? result : undefined);
        if (code !== undefined && code !== "OK" && code !== WPP()?.whatsapp?.enums?.SendMsgResult?.OK) throw new Error(`O WhatsApp recusou a mensagem (${String(code)}).`);
        return msg || { id: ser(res?.id), chatId: cmd.chatId, fromMe: true, ts: Date.now(), type: "text", rawType: "chat", text: cmd.text, ack: 0, revoked: false };
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
        const res = await chat.sendFileMessage(cmd.chatId, voice, { createChat: true, waitForAck: false, type: "audio", isPtt: true, mimetype: cmd.mime, waveform: true });
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
