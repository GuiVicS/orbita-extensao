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
    };
  }

  async function chatFor(chatId) {
    try {
      return serializeChat(WPP().chat.get(chatId));
    } catch {
      return null;
    }
  }

  // ---- comandos vindos do service worker
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
    const s = { ready: ready() };
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
