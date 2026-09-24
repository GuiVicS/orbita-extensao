// Respostas rápidas — lado da página (world MAIN). Recebe comandos do content
// script por window.postMessage e envia para a conversa aberta usando o WA-JS
// (window.WPP), que o js/wa-js.js já injeta.
(() => {
  "use strict";
  if (window.__orbitaQrPage) return;
  window.__orbitaQrPage = true;

  const NS = "__orbita_qr__";
  const WPP = () => window.WPP;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = (o, k) => {
    try {
      return o?.[k] ?? o?.attributes?.[k] ?? o?.get?.(k);
    } catch {
      return undefined;
    }
  };
  const ser = (id) => id?._serialized || (typeof id === "string" ? id : id ? String(id) : "");
  const PHONE = /^(\d{8,15})@c\.us$/;

  function ready() {
    const w = WPP();
    try {
      if (typeof w?.conn?.isMainReady === "function") return w.conn.isMainReady();
    } catch {}
    return Boolean(w?.isReady);
  }

  function assertReady() {
    if (!ready()) throw new Error("O WhatsApp Web ainda está carregando. Tente de novo em instantes.");
  }

  function context() {
    if (!ready()) return null;
    let chat;
    try {
      chat = WPP().chat.getActiveChat();
    } catch {}
    if (!chat) return null;
    const chatId = ser(get(chat, "id"));
    const contact = get(chat, "contact");
    let phone = chatId.match(PHONE)?.[1];
    if (!phone) phone = ser(get(contact, "phoneNumber")).match(PHONE)?.[1];
    const pick = (...keys) => {
      for (const k of keys) {
        const v = get(contact, k) ?? get(chat, k);
        if (typeof v === "string" && v.trim() && !/^\+?[\d\s()-]+$/.test(v)) return v.trim();
      }
      return "";
    };
    let me = "";
    try {
      me = WPP().profile?.getMyProfileName?.() || "";
    } catch {}
    return {
      chatId,
      isGroup: chatId.endsWith("@g.us"),
      phone,
      name: chatId.endsWith("@g.us") ? "" : pick("name", "formattedName", "verifiedName", "pushname", "notifyName", "formattedTitle"),
      me,
    };
  }

  async function confirmSent(res) {
    const OK = WPP()?.whatsapp?.enums?.SendMsgResult?.OK;
    let r = res;
    if (res?.sendMsgResult?.then) {
      r = await Promise.race([res.sendMsgResult, sleep(30000).then(() => ({ timeout: true }))]);
    }
    const id = ser(res?.id) || undefined;
    if (r?.timeout) return { id, unconfirmed: true };
    const s = r?.messageSendResult ?? (typeof r === "string" ? r : undefined);
    if (s !== undefined && s !== OK && s !== "OK") throw new Error(`O WhatsApp recusou a mensagem (${String(s)}).`);
    return { id };
  }

  const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error || new Error("Falha ao ler o arquivo."));
      r.readAsDataURL(blob);
    });

  const chatApi = () => {
    const c = WPP()?.chat;
    if (!c) throw new Error("WA-JS indisponível nesta aba. Recarregue o WhatsApp Web.");
    return c;
  };

  const opts = { createChat: true, waitForAck: false };

  async function run(cmd) {
    switch (cmd.op) {
      case "context":
        return context();

      case "presence": {
        assertReady();
        const c = chatApi();
        const fn = cmd.kind === "recording" ? c.markIsRecording : cmd.kind === "paused" ? c.markIsPaused : c.markIsComposing;
        // sem duração: o WA-JS só resolveria a promessa depois do tempo todo
        try {
          await fn?.call(c, cmd.chatId);
        } catch {}
        return true;
      }

      case "sendText": {
        assertReady();
        return confirmSent(await chatApi().sendTextMessage(cmd.chatId, cmd.text, { ...opts, linkPreview: cmd.linkPreview !== false }));
      }

      case "sendFile": {
        assertReady();
        const c = chatApi();
        const mimetype = cmd.mimetype || cmd.blob.type || "application/octet-stream";
        if (cmd.type === "audio" && cmd.isPtt) {
          // mesmo caminho do disparo de campanhas: data URL + isPtt gera a
          // mensagem de voz com forma de onda, igual a um áudio gravado na hora
          const dataUrl = await blobToDataUrl(new Blob([cmd.blob], { type: mimetype }));
          return confirmSent(
            await c.sendFileMessage(cmd.chatId, dataUrl, {
              ...opts,
              type: "audio",
              isPtt: true,
              isViewOnce: cmd.isViewOnce || undefined,
              mimetype,
              waveform: true,
            }),
          );
        }
        const file = new File([cmd.blob], cmd.filename || "arquivo", { type: mimetype });
        const o = { ...opts, type: cmd.type, filename: cmd.filename, mimetype };
        if (cmd.type !== "audio" && cmd.type !== "sticker") o.caption = cmd.caption || undefined;
        if (cmd.type === "audio") o.isPtt = false;
        if (cmd.type === "image") Object.assign(o, { isHD: Boolean(cmd.isHD), isViewOnce: cmd.isViewOnce || undefined });
        if (cmd.type === "video") Object.assign(o, { isGif: Boolean(cmd.isGif), isPtv: Boolean(cmd.isPtv), isViewOnce: cmd.isViewOnce || undefined });
        if (o.isPtv) delete o.caption;
        return confirmSent(await c.sendFileMessage(cmd.chatId, file, o));
      }

      case "sendLocation": {
        assertReady();
        return confirmSent(
          await chatApi().sendLocationMessage(cmd.chatId, {
            ...opts,
            lat: Number(cmd.lat),
            lng: Number(cmd.lng),
            name: cmd.name || undefined,
            address: cmd.address || undefined,
            url: cmd.url || undefined,
          }),
        );
      }

      case "sendContact": {
        assertReady();
        const digits = String(cmd.phone || "").replace(/\D/g, "");
        if (!digits) throw new Error("Contato sem telefone.");
        return confirmSent(await chatApi().sendVCardContactMessage(cmd.chatId, { id: `${digits}@c.us`, name: cmd.name || digits }, opts));
      }

      case "sendPoll": {
        assertReady();
        return confirmSent(
          await chatApi().sendCreatePollMessage(cmd.chatId, cmd.name, cmd.options, {
            ...opts,
            selectableCount: cmd.multiple ? 0 : 1,
          }),
        );
      }

      default:
        throw new Error(`Comando desconhecido: ${cmd.op}`);
    }
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    const msg = ev.data;
    if (!msg || msg.ns !== NS || msg.dir !== "toPage") return;
    let reply;
    try {
      reply = { ns: NS, dir: "fromPage", reqId: msg.reqId, ok: true, data: await run(msg.command) };
    } catch (e) {
      const text = e?.message || String(e);
      reply = { ns: NS, dir: "fromPage", reqId: msg.reqId, ok: false, error: /file_too_large/i.test(e?.code || "") ? `Arquivo grande demais para o WhatsApp. ${text}` : text };
    }
    window.postMessage(reply, window.location.origin);
  });

  // avisa o content script quando a conversa ativa muda
  const emitChat = () => window.postMessage({ ns: NS, dir: "event", event: "activeChat", chat: context() }, window.location.origin);
  const hook = () => {
    const w = WPP();
    if (!w?.on) return setTimeout(hook, 1000);
    const start = () => {
      try {
        w.on("chat.active_chat", () => setTimeout(emitChat, 0));
      } catch {}
      emitChat();
    };
    if (w.isFullReady || ready()) start();
    else (w.loader ?? w.webpack)?.onReady?.(start);
  };
  hook();
})();
