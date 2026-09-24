// Respostas rápidas — barra abaixo do campo de mensagem do WhatsApp Web.
// Roda no mundo isolado; o envio é feito por js/quick-replies-page.js (MAIN).
(() => {
  "use strict";
  if (window.__orbitaQrContent) return;
  window.__orbitaQrContent = true;

  const Q = globalThis.OrbitaQR;
  const { esc, icon } = Q;
  const NS = "__orbita_qr__";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---------------------------------------------------------------- ponte
  const pending = new Map();
  let activeChat = null;

  function callPage(command, timeoutMs = 120000) {
    const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error("Tempo esgotado aguardando o WhatsApp Web responder."));
      }, timeoutMs);
      pending.set(reqId, { resolve, reject, timer });
      window.postMessage({ ns: NS, dir: "toPage", reqId, command }, window.location.origin);
    });
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || ev.origin !== window.location.origin) return;
    const m = ev.data;
    if (!m || m.ns !== NS) return;
    if (m.dir === "fromPage") {
      const p = pending.get(m.reqId);
      if (!p) return;
      pending.delete(m.reqId);
      clearTimeout(p.timer);
      m.ok ? p.resolve(m.data) : p.reject(new Error(m.error));
    } else if (m.dir === "event" && m.event === "activeChat") {
      activeChat = m.chat;
    }
  });

  const extAlive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };

  function openDashboard(edit) {
    if (!extAlive()) return toast("A extensão foi atualizada. Recarregue esta página.", "err");
    chrome.runtime.sendMessage({ channel: "orbita:qr", op: "openDashboard", edit }).catch(() => {});
  }

  // --------------------------------------------------------------- estado
  let data = null;
  let stats = {};
  let ui = { collapsed: false, cat: "all" };
  let running = null; // { item, index, total, label, cancel }
  const mediaCache = new Map();

  const settings = () => data?.settings || Q.DEFAULT_SETTINGS;
  const catOf = (item) => data?.categories.find((c) => c.id === item.categoryId);
  const colorOf = (item) => catOf(item)?.color || "#7c6cf0";

  function visibleItems(cat = ui.cat) {
    if (!data) return [];
    let items = data.items.filter((i) => i.steps.length);
    if (cat === "fav") items = items.filter((i) => i.favorite);
    else if (cat !== "all") items = items.filter((i) => i.categoryId === cat);
    if (settings().favoritesFirst) items = [...items].sort((a, b) => Number(b.favorite) - Number(a.favorite));
    return items;
  }

  function searchItems(query, cat) {
    const q = query.trim().toLowerCase().replace(/^\//, "");
    const items = visibleItems(cat);
    if (!q) return items;
    const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const nq = norm(q);
    const scored = [];
    for (const i of items) {
      let score = 0;
      if (i.shortcut === q) score = 100;
      else if (i.shortcut.startsWith(q)) score = 80;
      else if (norm(i.title).startsWith(nq)) score = 60;
      else if (norm(i.title).includes(nq)) score = 40;
      else if (i.steps.some((s) => norm(Q.stepSummary(s)).includes(nq))) score = 20;
      if (score) scored.push([score, i]);
    }
    return scored.sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  }

  // ------------------------------------------------------------------ CSS
  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
button { font: inherit; color: inherit; }
.root { --bg:#f0f2f5; --surface:#ffffff; --fg:#111b21; --muted:#667781; --border:#e2e6ea; --hover:#f3f5f7;
  --accent:#6d5ef0; --grad:linear-gradient(135deg,#6d5ef0 0%,#4f8df5 55%,#38bdf8 100%);
  --shadow:0 12px 32px rgba(11,20,26,.16),0 2px 6px rgba(11,20,26,.08); --bubble:#d9fdd3; --bubble-fg:#111b21;
  font: 13px/1.4 "Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif; color: var(--fg); -webkit-font-smoothing: antialiased; }
.root.dark { --bg:#202c33; --surface:#2a3942; --fg:#e9edef; --muted:#8696a0; --border:#34434c; --hover:#324048;
  --shadow:0 14px 36px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.3); --bubble:#005c4b; --bubble-fg:#e9edef; }
svg { display:block; flex:none; }
.spin { animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pop { from { opacity:0; transform: translateY(6px) scale(.98); } to { opacity:1; transform:none; } }

/* ---------- barra ---------- */
.bar { display:flex; align-items:center; gap:6px; padding:4px 12px 8px; background:var(--bg); min-height:44px; }
.brand { width:30px; height:30px; border-radius:10px; border:0; background:var(--grad); color:#fff; display:grid; place-items:center;
  cursor:pointer; flex:none; box-shadow:0 3px 10px rgba(109,94,240,.35); transition: transform .15s, box-shadow .15s; }
.brand:hover { transform: translateY(-1px) rotate(-6deg); box-shadow:0 6px 16px rgba(109,94,240,.45); }
.pill { display:inline-flex; align-items:center; gap:4px; height:30px; padding:0 8px 0 10px; border-radius:10px; border:1px solid var(--border);
  background:var(--surface); cursor:pointer; flex:none; font-weight:600; font-size:12px; color:var(--muted); max-width:140px; }
.pill span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pill:hover { color:var(--fg); }
.pill .dot, .dot { width:8px; height:8px; border-radius:50%; flex:none; }
.sep { width:1px; height:20px; background:var(--border); flex:none; margin:0 2px; }
.scroller { position:relative; flex:1; min-width:0; display:flex; align-items:center; }
.chips { display:flex; gap:6px; overflow-x:auto; scrollbar-width:none; scroll-behavior:smooth; padding:3px 2px; flex:1; min-width:0; }
.chips::-webkit-scrollbar { display:none; }
.scroller.fl .chips { -webkit-mask-image: linear-gradient(90deg,transparent 0,#000 28px); }
.scroller.fr .chips { -webkit-mask-image: linear-gradient(90deg,#000 calc(100% - 28px),transparent); }
.scroller.fl.fr .chips { -webkit-mask-image: linear-gradient(90deg,transparent 0,#000 28px,#000 calc(100% - 28px),transparent); }
.nav { position:absolute; top:50%; transform:translateY(-50%); z-index:1; width:24px; height:24px; border-radius:50%; border:1px solid var(--border);
  background:var(--surface); display:none; place-items:center; cursor:pointer; box-shadow:0 1px 4px rgba(0,0,0,.12); color:var(--muted); }
.nav.l { left:-2px; } .nav.r { right:-2px; }
.scroller.fl .nav.l, .scroller.fr .nav.r { display:grid; }
.chip { --c:#7c6cf0; display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 11px 0 5px; border-radius:999px; border:1px solid var(--border);
  background:var(--surface); cursor:pointer; white-space:nowrap; font-size:13px; font-weight:500; flex:none; position:relative;
  transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
.chip:hover { border-color: color-mix(in srgb, var(--c) 60%, var(--border)); box-shadow:0 3px 12px color-mix(in srgb, var(--c) 25%, transparent); transform:translateY(-1px); }
.chip:active { transform: translateY(0) scale(.97); }
.chip .em { width:22px; height:22px; border-radius:50%; display:grid; place-items:center; background: color-mix(in srgb, var(--c) 18%, transparent); color:var(--c); font-size:12px; }
.chip .types { display:inline-flex; gap:3px; color:var(--muted); margin-left:1px; }
.chip .star { color:#f5b301; }
.chip.busy { pointer-events:none; opacity:.55; }
.chip .kbd { position:absolute; top:-7px; right:-4px; font-size:10px; font-weight:700; background:var(--fg); color:var(--bg); border-radius:5px; padding:0 4px; line-height:15px; display:none; }
.root.alt .chip .kbd { display:block; }
.empty { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 12px; border-radius:999px; border:1px dashed var(--border); background:transparent; cursor:pointer; color:var(--muted); font-weight:600; }
.empty:hover { color:var(--accent); border-color:var(--accent); }
.ibtn { width:30px; height:30px; border-radius:10px; border:0; background:transparent; display:grid; place-items:center; cursor:pointer; color:var(--muted); flex:none; }
.ibtn:hover { background:var(--hover); color:var(--fg); }
.mini { display:flex; justify-content:center; background:var(--bg); padding:0 0 4px; }
.mini button { display:inline-flex; align-items:center; gap:6px; border:0; background:var(--surface); color:var(--muted); font-size:11px; font-weight:600;
  border-radius:0 0 10px 10px; padding:2px 12px 3px; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,.08); }
.mini button:hover { color:var(--accent); }
.mini .z { color:var(--accent); }

/* ---------- progresso ---------- */
.progress { display:flex; align-items:center; gap:10px; padding:6px 12px 8px; background:var(--bg); min-height:44px; }
.progress .ring { width:30px; height:30px; border-radius:10px; background:var(--grad); color:#fff; display:grid; place-items:center; flex:none; }
.progress .info { flex:1; min-width:0; display:grid; gap:4px; }
.progress .line { display:flex; gap:6px; align-items:baseline; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.progress .line b { overflow:hidden; text-overflow:ellipsis; }
.progress .muted { color:var(--muted); font-size:12px; }
.track { height:4px; border-radius:4px; background:var(--border); overflow:hidden; }
.track i { display:block; height:100%; background:var(--grad); border-radius:4px; transition: width .4s ease; }
.btn { display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 12px; border-radius:9px; border:1px solid var(--border); background:var(--surface); cursor:pointer; font-weight:600; font-size:12px; flex:none; }
.btn:hover { background:var(--hover); }
.btn.primary { background:var(--grad); color:#fff; border:0; box-shadow:0 2px 8px rgba(109,94,240,.35); }
.btn.primary:hover { filter:brightness(1.06); }
.btn.danger { color:#e5484d; }

/* ---------- camada flutuante ---------- */
.layer { position:fixed; inset:0; pointer-events:none; z-index:2147483000; }
.pop { position:fixed; pointer-events:auto; background:var(--surface); border:1px solid var(--border); border-radius:16px; box-shadow:var(--shadow);
  animation: pop .14s ease-out; overflow:hidden; display:flex; flex-direction:column; }
.picker { width:440px; max-height:min(480px, 70vh); }
.picker header { display:flex; align-items:center; gap:8px; padding:10px 10px 8px 14px; }
.picker header .z { width:26px; height:26px; border-radius:8px; background:var(--grad); color:#fff; display:grid; place-items:center; flex:none; }
.picker input { flex:1; min-width:0; border:0; outline:0; background:transparent; color:var(--fg); font:inherit; font-size:14px; padding:6px 2px; }
.picker input::placeholder { color:var(--muted); }
.tabs { display:flex; gap:4px; padding:0 10px 8px; overflow-x:auto; scrollbar-width:none; border-bottom:1px solid var(--border); flex:none; }
.tabs::-webkit-scrollbar { display:none; }
.tab { display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 10px; border-radius:999px; border:0; background:transparent; color:var(--muted); cursor:pointer; font-size:12px; font-weight:600; white-space:nowrap; }
.tab:hover { background:var(--hover); color:var(--fg); }
.tab.on { background: color-mix(in srgb, var(--accent) 14%, transparent); color:var(--accent); }
.root.dark .tab.on { color:#a99fff; }
.list { overflow-y:auto; padding:6px; flex:1; }
.row { display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:10px; cursor:pointer; }
.row.on { background:var(--hover); }
.row .em { width:34px; height:34px; border-radius:10px; display:grid; place-items:center; flex:none; font-size:16px; background: color-mix(in srgb, var(--c) 16%, transparent); color:var(--c); }
.row .main { flex:1; min-width:0; }
.row .t { display:flex; align-items:center; gap:6px; font-weight:600; }
.row .t span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.row .sc { font-size:11px; font-weight:600; color:var(--muted); background:var(--bg); border-radius:5px; padding:0 5px; flex:none; }
.row .s { color:var(--muted); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:1px; }
.row .acts { display:none; gap:2px; }
.row.on .acts { display:flex; }
.row .types { display:flex; gap:3px; color:var(--muted); flex:none; }
.row.on .types { display:none; }
.nores { padding:28px 16px; text-align:center; color:var(--muted); }
.picker footer { display:flex; align-items:center; gap:10px; padding:8px 12px; border-top:1px solid var(--border); color:var(--muted); font-size:11px; flex:none; }
.picker footer kbd { font:inherit; font-weight:700; background:var(--bg); border-radius:4px; padding:0 4px; }
.picker footer .link { margin-left:auto; border:0; background:none; color:var(--accent); font-weight:600; cursor:pointer; display:inline-flex; gap:4px; align-items:center; font-size:12px; }
.root.dark .picker footer .link { color:#a99fff; }

.menu { min-width:200px; padding:6px; }
.menu button { display:flex; align-items:center; gap:8px; width:100%; border:0; background:none; padding:8px 10px; border-radius:8px; cursor:pointer; text-align:left; font-size:13px; }
.menu button:hover, .menu button.on { background:var(--hover); }
.menu .n { margin-left:auto; color:var(--muted); font-size:11px; }

.preview { width:340px; max-height:min(520px, 72vh); }
.preview .head { display:flex; align-items:center; gap:10px; padding:12px 14px 10px; }
.preview .head .em { width:34px; height:34px; border-radius:10px; display:grid; place-items:center; font-size:16px; background: color-mix(in srgb, var(--c) 16%, transparent); color:var(--c); flex:none; }
.preview .head b { display:block; }
.preview .head small { color:var(--muted); }
.chat { background: var(--bg); padding:12px 12px 8px; display:flex; flex-direction:column; align-items:flex-end; gap:5px; overflow-y:auto; flex:1;
  background-image: radial-gradient(color-mix(in srgb, var(--muted) 14%, transparent) 1px, transparent 1px); background-size:14px 14px; }
.bub { max-width:88%; background:var(--bubble); color:var(--bubble-fg); border-radius:10px 10px 3px 10px; padding:6px 8px 7px; box-shadow:0 1px .5px rgba(11,20,26,.13);
  white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; }
.bub.media { padding:3px; }
.bub img { display:block; max-width:220px; max-height:180px; border-radius:7px; object-fit:cover; }
.bub .cap { padding:4px 5px 1px; }
.bub .ph { width:200px; height:110px; border-radius:7px; background: color-mix(in srgb, var(--bubble-fg) 10%, transparent); display:grid; place-items:center; color: color-mix(in srgb, var(--bubble-fg) 55%, transparent); }
.bub.round img, .bub.round .ph { width:150px; height:150px; border-radius:50%; }
.bub.sticker { background:transparent; box-shadow:none; padding:0; }
.bub.sticker img { width:110px; height:110px; object-fit:contain; }
.voice { display:flex; align-items:center; gap:8px; width:230px; padding:3px 2px; }
.voice .av { width:34px; height:34px; border-radius:50%; background:var(--grad); color:#fff; display:grid; place-items:center; flex:none; }
.voice .wave { flex:1; display:flex; align-items:center; gap:2px; height:24px; }
.voice .wave i { flex:1; background: color-mix(in srgb, var(--bubble-fg) 45%, transparent); border-radius:2px; min-height:3px; }
.voice small { font-size:11px; opacity:.7; }
.doc { display:flex; align-items:center; gap:10px; background: color-mix(in srgb, var(--bubble-fg) 7%, transparent); border-radius:7px; padding:9px 10px; min-width:200px; }
.doc .fi { width:30px; height:36px; border-radius:5px; background:#e5484d; color:#fff; display:grid; place-items:center; font-size:9px; font-weight:800; flex:none; }
.doc small { display:block; opacity:.7; font-size:11px; }
.gap { align-self:center; font-size:10.5px; color:var(--muted); background:var(--surface); border-radius:6px; padding:1px 8px; display:flex; gap:4px; align-items:center; }
.preview .foot { display:flex; gap:8px; padding:10px 12px; border-top:1px solid var(--border); align-items:center; }
.preview .foot .hint { color:var(--muted); font-size:11px; flex:1; }
.pollopt { display:flex; align-items:center; gap:8px; padding:4px 2px; }
.pollopt i { width:16px; height:16px; border-radius:50%; border:2px solid color-mix(in srgb, var(--bubble-fg) 45%, transparent); flex:none; }

.toast { position:fixed; pointer-events:auto; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:8px; padding:9px 14px; border-radius:12px;
  background:#111b21; color:#fff; box-shadow:var(--shadow); font-size:13px; font-weight:500; animation: pop .16s ease-out; max-width:min(520px, 90vw); }
.root.dark .toast { background:#e9edef; color:#111b21; }
.toast.err { background:#e5484d; color:#fff; }
.toast.ok .ic { color:#25d366; }
`;

  // ---------------------------------------------------------------- hosts
  const barHost = document.createElement("div");
  barHost.id = "orbita-qr-bar";
    const barShadow = barHost.attachShadow({ mode: "open" });
  barShadow.innerHTML = `<style>${CSS}</style><div class="root"></div>`;
  const barRoot = barShadow.querySelector(".root");

  const layerHost = document.createElement("div");
  layerHost.id = "orbita-qr-layer";
  const layerShadow = layerHost.attachShadow({ mode: "open" });
  layerShadow.innerHTML = `<style>${CSS}</style><div class="root"><div class="layer"></div></div>`;
  const layerRoot = layerShadow.querySelector(".root");
  const layer = layerShadow.querySelector(".layer");

  // o WhatsApp tem atalhos globais de teclado: não deixa as teclas vazarem
  for (const sh of [barShadow, layerShadow]) {
    for (const t of ["keydown", "keyup", "keypress"]) sh.addEventListener(t, (e) => e.stopPropagation());
  }

  const isDark = () => document.body?.classList.contains("dark") ?? false;
  function syncTheme() {
    barRoot.classList.toggle("dark", isDark());
    layerRoot.classList.toggle("dark", isDark());
  }

  // --------------------------------------------------------------- toasts
  let toastTimer = null;
  function toast(text, kind = "") {
    layer.querySelector(".toast")?.remove();
    clearTimeout(toastTimer);
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    const ic = kind === "err" ? "x" : kind === "ok" ? "check" : "zap";
    el.innerHTML = `<span class="ic">${icon(ic, 16)}</span><span>${esc(text)}</span>`;
    const footer = document.querySelector("#main footer");
    const top = footer ? footer.getBoundingClientRect().top : window.innerHeight - 80;
    el.style.bottom = `${Math.max(16, window.innerHeight - top + 70)}px`;
    const main = document.querySelector("#main")?.getBoundingClientRect();
    if (main) el.style.left = `${main.left + main.width / 2}px`;
    layer.append(el);
    toastTimer = setTimeout(() => el.remove(), kind === "err" ? 6000 : 2600);
  }

  // -------------------------------------------------------------- composer
  const composer = () => document.querySelector('#main footer div[contenteditable="true"]');

  function caretToEnd(el) {
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function clearComposer() {
    const el = composer();
    if (!el) return;
    el.focus();
    document.execCommand("selectAll", false);
    document.execCommand("delete", false);
  }

  async function insertIntoComposer(text) {
    const el = composer();
    if (!el) throw new Error("Campo de mensagem não encontrado. Abra uma conversa.");
    el.focus();
    caretToEnd(el);
    const before = el.textContent;
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(60);
    if (el.textContent === before) document.execCommand("insertText", false, text);
  }

  // ---------------------------------------------------------------- envio
  const isTextOnly = (item) => item.steps.length > 0 && item.steps.every((s) => s.type === "text");

  async function mediaBlob(id) {
    if (mediaCache.has(id)) return mediaCache.get(id);
    const { blob } = await Q.getMediaBlob(id);
    mediaCache.set(id, blob);
    if (mediaCache.size > 12) mediaCache.delete(mediaCache.keys().next().value);
    return blob;
  }

  async function wait(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (running?.cancel) throw new Error("__cancel__");
      await sleep(Math.min(150, end - Date.now()));
    }
  }

  const stepLabel = (s) =>
    ({
      text: "digitando…",
      audio: s.ptt ? "gravando áudio…" : "enviando áudio…",
      image: "enviando foto…",
      video: s.ptv ? "enviando vídeo redondo…" : "enviando vídeo…",
      document: "enviando documento…",
      sticker: "enviando figurinha…",
      location: "enviando localização…",
      contact: "enviando contato…",
      poll: "criando enquete…",
    })[s.type] || "enviando…";

  async function sendStep(step, chatId, ctx) {
    const st = settings();
    switch (step.type) {
      case "text": {
        const text = Q.renderVars(step.text, ctx).trim();
        if (!text) return;
        if (st.simulate) {
          await callPage({ op: "presence", kind: "composing", chatId });
          await wait(clamp((text.length / Math.max(4, st.typingCps)) * 1000, 700, st.maxTypingSec * 1000));
        }
        return callPage({ op: "sendText", chatId, text, linkPreview: step.linkPreview !== false });
      }
      case "audio":
      case "image":
      case "video":
      case "document":
      case "sticker": {
        const blob = await mediaBlob(step.mediaId);
        if (step.type === "audio" && step.ptt && st.simulate) {
          await callPage({ op: "presence", kind: "recording", chatId });
          await wait(clamp((step.duration || 3) * 1000, 1500, st.maxRecordingSec * 1000));
        } else if (st.simulate && step.caption) {
          await callPage({ op: "presence", kind: "composing", chatId });
          await wait(800);
        }
        return callPage(
          {
            op: "sendFile",
            chatId,
            blob,
            type: step.type,
            filename: step.name || "arquivo",
            mimetype: step.mime || blob.type,
            caption: step.caption ? Q.renderVars(step.caption, ctx) : undefined,
            isPtt: step.type === "audio" && Boolean(step.ptt),
            isPtv: Boolean(step.ptv),
            isGif: Boolean(step.gif),
            isHD: Boolean(step.hd),
            isViewOnce: Boolean(step.viewOnce),
          },
          300000,
        );
      }
      case "location":
        return callPage({ op: "sendLocation", chatId, lat: step.lat, lng: step.lng, name: Q.renderVars(step.name || "", ctx), address: step.address, url: step.url });
      case "contact":
        return callPage({ op: "sendContact", chatId, name: step.contactName, phone: step.contactPhone });
      case "poll":
        return callPage({
          op: "sendPoll",
          chatId,
          name: Q.renderVars(step.pollName || "", ctx),
          options: (step.pollOptions || []).map((o) => String(o).trim()).filter(Boolean),
          multiple: Boolean(step.pollMultiple),
        });
    }
  }

  async function runItem(item, { insert = false } = {}) {
    closePops();
    if (!extAlive()) return toast("A extensão foi atualizada. Recarregue esta página.", "err");
    if (running) return toast("Aguarde: ainda estou enviando a resposta anterior.");
    let ctx;
    try {
      ctx = await callPage({ op: "context" }, 15000);
    } catch (e) {
      return toast(e.message, "err");
    }
    if (!ctx?.chatId) return toast("Abra uma conversa para usar as respostas rápidas.", "err");

    if (isTextOnly(item) && (insert || settings().textAction === "insert")) {
      try {
        await insertIntoComposer(item.steps.map((s) => Q.renderVars(s.text, ctx)).join("\n\n"));
        Q.bumpStats(item.id).catch(() => {});
      } catch (e) {
        toast(e.message, "err");
      }
      return;
    }
    if (insert) toast("Esta resposta tem mídia: ela será enviada direto.");

    running = { item, index: 0, total: item.steps.length, label: "preparando…", cancel: false, chatName: ctx.name };
    renderBar();
    let sent = 0;
    try {
      for (let i = 0; i < item.steps.length; i++) {
        const step = item.steps[i];
        const gapSec = (i > 0 ? settings().stepDelaySec : 0) + (step.delaySec || 0);
        running.index = i;
        if (gapSec > 0) {
          running.label = step.delaySec ? `aguardando ${step.delaySec}s…` : "aguardando…";
          renderBar();
          await wait(gapSec * 1000);
        }
        running.label = stepLabel(step);
        renderBar();
        await sendStep(step, ctx.chatId, ctx);
        sent++;
      }
      Q.bumpStats(item.id).catch(() => {});
      toast(`“${item.title}” enviada${ctx.name ? ` para ${ctx.name}` : ""}.`, "ok");
    } catch (e) {
      if (e.message === "__cancel__") toast(`Envio cancelado (${sent} de ${item.steps.length} enviadas).`);
      else toast(`Falha na mensagem ${sent + 1} de ${item.steps.length}: ${e.message}`, "err");
    } finally {
      callPage({ op: "presence", kind: "paused", chatId: ctx.chatId }, 5000).catch(() => {});
      running = null;
      renderBar();
    }
  }

  // ------------------------------------------------------ prévia (bolhas)
  function waBold(text) {
    return esc(text)
      .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
      .replace(/(^|\s)_([^_\n]+)_/g, "$1<i>$2</i>")
      .replace(/~([^~\n]+)~/g, "<s>$1</s>")
      .replace(/```([^`]+)```/g, "<code>$1</code>");
  }

  function waveBars(seed, n = 34) {
    let x = seed || 7;
    let out = "";
    for (let i = 0; i < n; i++) {
      x = (x * 9301 + 49297) % 233280;
      const h = 20 + Math.round((x / 233280) * 80 * Math.sin((i / n) * Math.PI + 0.3));
      out += `<i style="height:${clamp(h, 12, 100)}%"></i>`;
    }
    return out;
  }

  function bubbleHtml(s, ctx) {
    const cap = (t) => (t ? `<div class="cap">${waBold(Q.renderVars(t, ctx))}</div>` : "");
    const thumb = (cls = "") => (s.thumb ? `<img src="${esc(s.thumb)}" alt="">` : `<div class="ph ${cls}">${icon(Q.stepIcon(s), 28)}</div>`);
    switch (s.type) {
      case "text":
        return `<div class="bub">${waBold(Q.renderVars(s.text, ctx))}</div>`;
      case "image":
        return `<div class="bub media">${thumb()}${cap(s.caption)}</div>`;
      case "video":
        return `<div class="bub media ${s.ptv ? "round" : ""}">${thumb()}${s.ptv ? "" : cap(s.caption)}</div>`;
      case "sticker":
        return `<div class="bub sticker">${thumb()}</div>`;
      case "audio":
        return s.ptt
          ? `<div class="bub"><div class="voice"><div class="av">${icon("mic", 16)}</div>${icon("play", 16)}<div class="wave">${waveBars(s.name?.length || 5)}</div><small>${Q.formatDuration(s.duration)}</small></div></div>`
          : `<div class="bub"><div class="doc"><div class="fi" style="background:#f59e0b">${icon("music", 14)}</div><div><b>${esc(s.name || "áudio")}</b><small>${Q.formatBytes(s.size)} · ${Q.formatDuration(s.duration)}</small></div></div></div>`;
      case "document": {
        const ext = (s.name || "").split(".").pop()?.slice(0, 4).toUpperCase() || "DOC";
        return `<div class="bub media"><div class="doc"><div class="fi">${esc(ext)}</div><div><b>${esc(s.name || "documento")}</b><small>${Q.formatBytes(s.size)}</small></div></div>${cap(s.caption)}</div>`;
      }
      case "location":
        return `<div class="bub media"><div class="ph" style="height:90px">${icon("pin", 26)}</div>${cap([s.name, s.address].filter(Boolean).join("\n") || `${s.lat}, ${s.lng}`)}</div>`;
      case "contact":
        return `<div class="bub"><div class="doc" style="background:none;padding:4px"><div class="voice" style="width:auto"><div class="av">${icon("contact", 16)}</div></div><div><b>${esc(s.contactName || "Contato")}</b><small>${esc(s.contactPhone || "")}</small></div></div></div>`;
      case "poll":
        return `<div class="bub"><b>${esc(Q.renderVars(s.pollName || "", ctx))}</b><div style="opacity:.7;font-size:11px;margin:2px 0 4px">${s.pollMultiple ? "Selecione uma ou mais opções" : "Selecione uma opção"}</div>${(s.pollOptions || []).filter(Boolean).map((o) => `<div class="pollopt"><i></i>${esc(o)}</div>`).join("")}</div>`;
    }
    return "";
  }

  function previewCtx() {
    return { name: activeChat?.name || "", phone: activeChat?.phone || "", me: activeChat?.me || "" };
  }

  function chatHtml(item) {
    const ctx = previewCtx();
    return item.steps
      .map((s, i) => {
        const gap = (i > 0 ? settings().stepDelaySec : 0) + (s.delaySec || 0);
        return (s.delaySec ? `<div class="gap">${icon("clock", 11)} ${esc(String(gap).replace(".", ","))}s</div>` : "") + bubbleHtml(s, ctx);
      })
      .join("");
  }

  const typeIcons = (item, size = 12) => {
    if (!settings().showTypeIcons) return "";
    const kinds = [...new Set(item.steps.filter((s) => s.type !== "text").map((s) => Q.stepIcon(s)))];
    return kinds.map((k) => icon(k, size)).join("");
  };

  const emojiHtml = (item) => (item.emoji ? esc(item.emoji) : icon(Q.stepIcon(item.steps[0] || { type: "text" }), 13));

  // ---------------------------------------------------------------- popovers
  let pop = null; // { kind, el, ... }
  function closePops() {
    pop?.el.remove();
    pop?.cleanup?.();
    pop = null;
  }

  function place(el, anchorRect, { width, alignRight = false } = {}) {
    const vw = window.innerWidth;
    const w = width || el.offsetWidth;
    let left = alignRight ? anchorRect.right - w : anchorRect.left;
    left = clamp(left, 8, vw - w - 8);
    el.style.left = `${left}px`;
    el.style.bottom = `${window.innerHeight - anchorRect.top + 8}px`;
  }

  function barAnchor() {
    const r = barHost.getBoundingClientRect();
    return r.height ? r : document.querySelector("#main footer")?.getBoundingClientRect() || new DOMRect(0, window.innerHeight - 60, 400, 60);
  }

  // ---- seletor com busca (também usado pelo "/")
  function openPicker({ query = "", slash = false } = {}) {
    closePops();
    const el = document.createElement("div");
    el.className = "pop picker";
    const state = { query, cat: slash ? "all" : ui.cat, active: 0, results: [] };
    const cats = [["all", "Todas", null], ["fav", "Favoritas", "star"], ...(data?.categories || []).map((c) => [c.id, c.name, c.color])];
    el.innerHTML = `<header><span class="z">${icon("zap", 15)}</span><input type="text" placeholder="Buscar resposta rápida ou /atalho" value="${esc(query)}" ${slash ? 'tabindex="-1"' : ""}>
        <button class="ibtn" data-act="close" title="Fechar (Esc)">${icon("x", 16)}</button></header>
      <div class="tabs">${cats
        .map(([id, name, extra]) => `<button class="tab" data-cat="${esc(id)}">${extra === "star" ? icon("star", 12) : extra ? `<span class="dot" style="background:${esc(extra)}"></span>` : ""}${esc(name)}</button>`)
        .join("")}</div>
      <div class="list"></div>
      <footer><span><kbd>↑↓</kbd> navegar</span><span><kbd>Enter</kbd> enviar</span><span><kbd>Shift+Enter</kbd> pôr no campo</span>
        <button class="link" data-act="manage">${icon("sliders", 13)} Gerenciar</button></footer>`;
    const input = el.querySelector("input");
    const list = el.querySelector(".list");

    function draw() {
      state.results = searchItems(state.query, state.cat);
      state.active = clamp(state.active, 0, Math.max(0, state.results.length - 1));
      el.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.cat === state.cat));
      list.innerHTML = state.results.length
        ? state.results
            .map(
              (it, i) => `<div class="row ${i === state.active ? "on" : ""}" data-i="${i}" style="--c:${esc(colorOf(it))}">
          <div class="em">${emojiHtml(it)}</div>
          <div class="main"><div class="t"><span>${esc(it.title)}</span>${it.shortcut ? `<span class="sc">/${esc(it.shortcut)}</span>` : ""}${it.favorite ? `<span style="color:#f5b301">${icon("star", 11)}</span>` : ""}</div>
            <div class="s">${esc(Q.renderVars(it.steps.map(Q.stepSummary).join("  ·  "), previewCtx()).slice(0, 140))}</div></div>
          <div class="types">${typeIcons(it, 13)}</div>
          <div class="acts">${isTextOnly(it) ? `<button class="ibtn" data-act="insert" data-i="${i}" title="Colocar no campo (Shift+Enter)">${icon("pencil", 15)}</button>` : ""}
            <button class="ibtn" data-act="send" data-i="${i}" title="Enviar (Enter)" style="color:var(--accent)">${icon("send", 15)}</button></div></div>`,
            )
            .join("")
        : `<div class="nores">${data?.items.length ? "Nenhuma resposta encontrada." : "Você ainda não tem respostas rápidas."}<br><br><button class="btn primary" data-act="manage">${icon("plus", 14)} Criar no painel</button></div>`;
      list.querySelector(".row.on")?.scrollIntoView({ block: "nearest" });
    }

    function choose(i, insert) {
      const it = state.results[i];
      if (!it) return;
      if (slash) clearComposer();
      runItem(it, { insert });
    }

    el.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act],[data-cat],.row");
      if (!t) return;
      if (t.dataset.cat) {
        state.cat = t.dataset.cat;
        state.active = 0;
        if (!slash) {
          ui.cat = t.dataset.cat;
          saveUi();
        }
        return draw();
      }
      if (t.dataset.act === "close") return closePops();
      if (t.dataset.act === "manage") return closePops(), openDashboard();
      if (t.dataset.act === "send" || t.dataset.act === "insert") return choose(Number(t.dataset.i), t.dataset.act === "insert");
      if (t.classList.contains("row")) choose(Number(t.dataset.i), e.shiftKey);
    });
    el.addEventListener("mousemove", (e) => {
      const row = e.target.closest(".row");
      if (row && Number(row.dataset.i) !== state.active) {
        state.active = Number(row.dataset.i);
        el.querySelectorAll(".row").forEach((r) => r.classList.toggle("on", r === row));
      }
    });
    input.addEventListener("input", () => {
      state.query = input.value;
      state.active = 0;
      draw();
    });
    const keys = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        state.active = clamp(state.active + (e.key === "ArrowDown" ? 1 : -1), 0, state.results.length - 1);
        draw();
      } else if (e.key === "Enter" || (slash && e.key === "Tab")) {
        if (!state.results.length) return false;
        choose(state.active, e.shiftKey);
      } else if (e.key === "Escape") closePops();
      else return false;
      e.preventDefault();
      return true;
    };
    input.addEventListener("keydown", keys);

    layer.append(el);
    const anchor = slash ? document.querySelector("#main footer")?.getBoundingClientRect() || barAnchor() : barAnchor();
    place(el, anchor, { width: 440 });
    draw();
    if (!slash) setTimeout(() => input.focus(), 0);
    const outside = (e) => {
      if (!e.composedPath().includes(layerHost) && !e.composedPath().includes(barHost)) closePops();
    };
    setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
    pop = {
      kind: slash ? "slash" : "picker",
      el,
      keys,
      setQuery(q) {
        state.query = q;
        input.value = q;
        state.active = 0;
        draw();
      },
      cleanup: () => document.removeEventListener("mousedown", outside, true),
    };
  }

  // ---- menu de categorias
  function openCatMenu(anchorEl) {
    closePops();
    const el = document.createElement("div");
    el.className = "pop menu";
    const count = (cat) => visibleItems(cat).length;
    const opts = [["all", "Todas", ""], ["fav", "Favoritas", "star"], ...(data?.categories || []).map((c) => [c.id, c.name, c.color])];
    el.innerHTML =
      opts
        .map(([id, name, extra]) => `<button data-cat="${esc(id)}" class="${ui.cat === id ? "on" : ""}">${extra === "star" ? `<span style="color:#f5b301">${icon("star", 13)}</span>` : extra ? `<span class="dot" style="background:${esc(extra)}"></span>` : icon("grid", 13)}${esc(name)}<span class="n">${count(id)}</span></button>`)
        .join("") + `<button data-act="manage" style="color:var(--accent)">${icon("sliders", 13)} Gerenciar categorias</button>`;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.act === "manage") return closePops(), openDashboard();
      ui.cat = b.dataset.cat;
      saveUi();
      closePops();
      renderBar();
    });
    layer.append(el);
    place(el, anchorEl.getBoundingClientRect());
    const outside = (e) => !e.composedPath().includes(layerHost) && closePops();
    setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
    pop = { kind: "menu", el, cleanup: () => document.removeEventListener("mousedown", outside, true) };
  }

  // ---- prévia ao passar o mouse / confirmação
  let hoverTimer = null;
  let hideTimer = null;
  function openPreview(item, chipEl, { confirm = false } = {}) {
    closePops();
    const el = document.createElement("div");
    el.className = "pop preview";
    el.style.setProperty("--c", colorOf(item));
    const n = item.steps.length;
    const idx = visibleItems().indexOf(item);
    const hk = settings().hotkeys && idx >= 0 && idx < 9 ? ` · Alt+${idx + 1}` : "";
    el.innerHTML = `<div class="head"><div class="em">${emojiHtml(item)}</div><div style="min-width:0;flex:1"><b>${esc(item.title)}</b>
        <small>${n} mensage${n === 1 ? "m" : "ns"}${item.shortcut ? ` · /${esc(item.shortcut)}` : ""}${hk}${stats[item.id]?.n ? ` · usada ${stats[item.id].n}×` : ""}</small></div>
        <button class="ibtn" data-act="edit" title="Editar no painel">${icon("pencil", 15)}</button></div>
      <div class="chat">${chatHtml(item)}</div>
      <div class="foot"><span class="hint">${confirm ? "Revise antes de enviar." : isTextOnly(item) ? "Clique envia · Shift+clique põe no campo" : "Clique no botão para enviar"}</span>
        ${isTextOnly(item) ? `<button class="btn" data-act="insert">${icon("pencil", 13)} Campo</button>` : ""}
        <button class="btn primary" data-act="send">${icon("send", 13)} Enviar</button></div>`;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "edit") return closePops(), openDashboard(item.id);
      runItem(item, { insert: b.dataset.act === "insert" });
    });
    el.addEventListener("mouseenter", () => clearTimeout(hideTimer));
    el.addEventListener("mouseleave", () => {
      if (!confirm) hideTimer = setTimeout(() => pop?.el === el && closePops(), 250);
    });
    layer.append(el);
    place(el, chipEl.getBoundingClientRect(), { width: 340 });
    const outside = (e) => !e.composedPath().includes(layerHost) && !e.composedPath().includes(barHost) && closePops();
    setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
    pop = { kind: confirm ? "confirm" : "preview", el, item, cleanup: () => document.removeEventListener("mousedown", outside, true) };
  }

  // ------------------------------------------------------------------ barra
  function renderBar() {
    syncTheme();
    if (!data || !settings().enabled) {
      barRoot.innerHTML = "";
      return;
    }
    if (running) {
      const pct = Math.round(((running.index + 0.5) / running.total) * 100);
      barRoot.innerHTML = `<div class="progress"><div class="ring">${icon("spinner", 16, 'class="spin"')}</div>
        <div class="info"><div class="line"><b>${esc(running.item.title)}</b><span class="muted">· ${running.index + 1}/${running.total} · ${esc(running.label)}</span></div>
        <div class="track"><i style="width:${pct}%"></i></div></div>
        <button class="btn danger" data-act="cancel">${icon("x", 13)} Cancelar</button></div>`;
      return;
    }
    if (ui.collapsed) {
      barRoot.innerHTML = `<div class="mini"><button data-act="expand" title="Mostrar respostas rápidas"><span class="z">${icon("zap", 12)}</span>Respostas rápidas${icon("up", 12)}</button></div>`;
      return;
    }
    const items = visibleItems();
    const catLabel = ui.cat === "all" ? "Todas" : ui.cat === "fav" ? "Favoritas" : data.categories.find((c) => c.id === ui.cat)?.name || "Todas";
    const catColor = ui.cat === "fav" ? "#f5b301" : data.categories.find((c) => c.id === ui.cat)?.color;
    const chips = items.length
      ? items
          .map(
            (it, i) => `<button class="chip" data-id="${esc(it.id)}" style="--c:${esc(colorOf(it))}">
        <span class="em">${emojiHtml(it)}</span>${esc(it.title)}${it.favorite ? `<span class="star">${icon("star", 11)}</span>` : ""}
        <span class="types">${typeIcons(it)}</span>${settings().hotkeys && i < 9 ? `<span class="kbd">${i + 1}</span>` : ""}</button>`,
          )
          .join("")
      : `<button class="empty" data-act="manage">${icon("plus", 14)} ${data.items.length ? "Nada nesta categoria" : "Criar respostas rápidas"}</button>`;
    barRoot.innerHTML = `<div class="bar">
      <button class="brand" data-act="picker" title="Respostas rápidas — buscar (ou digite / no campo)">${icon("zap", 16)}</button>
      <button class="pill" data-act="cats" title="Filtrar por categoria">${catColor ? `<span class="dot" style="background:${esc(catColor)}"></span>` : ""}<span>${esc(catLabel)}</span>${icon("down", 13)}</button>
      <div class="scroller"><button class="nav l" data-act="left">${icon("left", 14)}</button><div class="chips">${chips}</div><button class="nav r" data-act="right">${icon("right", 14)}</button></div>
      <button class="ibtn" data-act="manage" title="Gerenciar respostas rápidas">${icon("sliders", 16)}</button>
      <button class="ibtn" data-act="collapse" title="Recolher">${icon("down", 16)}</button></div>`;
    const scroller = barRoot.querySelector(".scroller");
    const chipsEl = barRoot.querySelector(".chips");
    const fades = () => {
      scroller.classList.toggle("fl", chipsEl.scrollLeft > 4);
      scroller.classList.toggle("fr", chipsEl.scrollLeft + chipsEl.clientWidth < chipsEl.scrollWidth - 4);
    };
    chipsEl.addEventListener("scroll", fades, { passive: true });
    chipsEl.addEventListener(
      "wheel",
      (e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
          chipsEl.scrollLeft += e.deltaY;
          e.preventDefault();
        }
      },
      { passive: false },
    );
    requestAnimationFrame(fades);
  }

  barRoot.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act],[data-id]");
    if (!t) return;
    clearTimeout(hoverTimer);
    if (t.dataset.id) {
      const item = data.items.find((i) => i.id === t.dataset.id);
      if (!item) return;
      if (settings().confirmSend && !e.shiftKey) return openPreview(item, t, { confirm: true });
      return runItem(item, { insert: e.shiftKey });
    }
    switch (t.dataset.act) {
      case "picker":
        return pop?.kind === "picker" ? closePops() : openPicker();
      case "cats":
        return pop?.kind === "menu" ? closePops() : openCatMenu(t);
      case "manage":
        return openDashboard();
      case "collapse":
      case "expand":
        ui.collapsed = t.dataset.act === "collapse";
        saveUi();
        closePops();
        return renderBar();
      case "cancel":
        if (running) {
          running.cancel = true;
          running.label = "cancelando…";
          renderBar();
        }
        return;
      case "left":
      case "right": {
        const c = barRoot.querySelector(".chips");
        c.scrollLeft += (t.dataset.act === "left" ? -1 : 1) * c.clientWidth * 0.7;
      }
    }
  });
  barRoot.addEventListener("contextmenu", (e) => {
    const chip = e.target.closest("[data-id]");
    const item = chip && data.items.find((i) => i.id === chip.dataset.id);
    if (!item) return;
    e.preventDefault();
    openPreview(item, chip, { confirm: true });
  });
  barRoot.addEventListener("mouseover", (e) => {
    const chip = e.target.closest("[data-id]");
    if (!chip || chip.contains(e.relatedTarget)) return;
    clearTimeout(hoverTimer);
    clearTimeout(hideTimer);
    if (pop && pop.kind !== "preview") return;
    const item = data.items.find((i) => i.id === chip.dataset.id);
    hoverTimer = setTimeout(() => item && openPreview(item, chip), pop?.kind === "preview" ? 120 : 550);
  });
  barRoot.addEventListener("mouseout", (e) => {
    const chip = e.target.closest("[data-id]");
    if (!chip || chip.contains(e.relatedTarget)) return;
    clearTimeout(hoverTimer);
    if (pop?.kind === "preview") hideTimer = setTimeout(() => pop?.kind === "preview" && closePops(), 250);
  });

  // ---------------------------------------------------- "/" e atalhos Alt
  document.addEventListener(
    "input",
    (e) => {
      if (!settings().slash || !data || running) return;
      const el = composer();
      if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return;
      const text = (el.innerText || "").replace(/\n+$/, "");
      const m = text.match(/^\/([\p{L}\p{N}_-]*)$/u);
      if (m) {
        if (pop?.kind === "slash") pop.setQuery(m[1]);
        else openPicker({ query: m[1], slash: true });
      } else if (pop?.kind === "slash") closePops();
    },
    true,
  );

  window.addEventListener(
    "keydown",
    (e) => {
      if (pop?.kind === "slash") {
        const el = composer();
        if (el && e.target instanceof Node && el.contains(e.target) && pop.keys(e)) {
          e.stopImmediatePropagation();
          return;
        }
      }
      if (e.key === "Alt") barRoot.classList.add("alt");
      if (!settings().hotkeys || !data || !settings().enabled || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const n = /^Digit([1-9])$/.exec(e.code)?.[1];
      if (!n || !document.querySelector("#main")) return;
      const item = visibleItems()[Number(n) - 1];
      if (!item) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      runItem(item);
    },
    true,
  );
  window.addEventListener("keyup", (e) => e.key === "Alt" && barRoot.classList.remove("alt"), true);
  window.addEventListener("blur", () => barRoot.classList.remove("alt"));

  // ---------------------------------------------------------- montagem
  // O layout do WhatsApp muda entre versões (rodapé em fluxo, absoluto, grid…).
  // Tenta cada posição e confere pela geometria se a barra ficou logo abaixo do
  // campo de mensagem e visível; se não, passa para a próxima.
  const BAR_STYLE = "display:block;flex:none;position:relative;z-index:2;width:100%;box-sizing:border-box;";
  const MODES = ["inside", "after", "float"];
  let placed = { footer: null, mode: null };

  function applyMode(footer, mode) {
    footer.style.removeProperty("flex-wrap");
    barHost.style.cssText = BAR_STYLE;
    if (mode === "inside") {
      const cs = getComputedStyle(footer);
      if (cs.display.includes("flex") && !cs.flexDirection.startsWith("column")) {
        footer.style.flexWrap = "wrap";
        barHost.style.flexBasis = "100%";
        barHost.style.order = "999";
      } else if (cs.display.includes("grid")) barHost.style.gridColumn = "1 / -1";
      footer.append(barHost);
    } else if (mode === "after") footer.after(barHost);
    else {
      barHost.style.cssText = "display:block;position:fixed;z-index:1000;box-sizing:border-box;box-shadow:0 -4px 12px rgba(11,20,26,.08);";
      document.body.append(barHost);
      positionFloat(footer);
    }
  }

  function positionFloat(footer) {
    const r = footer.getBoundingClientRect();
    barHost.style.left = `${r.left}px`;
    barHost.style.width = `${r.width}px`;
    barHost.style.bottom = `${Math.max(0, window.innerHeight - r.top)}px`;
  }

  function placementOk(footer) {
    const b = barHost.getBoundingClientRect();
    const c = (composer() || footer).getBoundingClientRect();
    if (b.height < 12 || b.width < 100) return false;
    if (b.top < c.bottom - 4 || b.bottom > window.innerHeight + 2) return false;
    const hit = document.elementFromPoint(b.left + Math.min(60, b.width / 2), b.top + b.height / 2);
    return hit === barHost || barHost.contains(hit);
  }

  function mount() {
    if (!document.documentElement.contains(layerHost) && document.body) document.body.append(layerHost);
    const footer = document.querySelector("#main footer");
    if (!footer || !data || !settings().enabled) {
      if (barHost.isConnected && (!footer || !settings().enabled)) barHost.remove();
      placed = { footer: null, mode: null };
      return;
    }
    if (placed.footer === footer && barHost.isConnected) {
      if (placed.mode === "float") positionFloat(footer);
      return;
    }
    closePops();
    renderBar();
    for (const mode of MODES) {
      applyMode(footer, mode);
      if (mode === "float" || placementOk(footer)) {
        placed = { footer, mode };
        break;
      }
    }
  }

  let mountQueued = false;
  new MutationObserver(() => {
    if (mountQueued) return;
    mountQueued = true;
    requestAnimationFrame(() => {
      mountQueued = false;
      mount();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  const saveUi = () => extAlive() && chrome.storage.local.set({ [Q.UI_KEY]: ui }).catch(() => {});

  async function reload() {
    if (!extAlive()) return;
    try {
      const r = await chrome.storage.local.get([Q.KEY, Q.STATS_KEY, Q.UI_KEY]);
      data = r[Q.KEY] ? Q.normalize(r[Q.KEY]) : await Q.load();
      stats = r[Q.STATS_KEY] || {};
      ui = { ...ui, ...(r[Q.UI_KEY] || {}) };
      if (ui.cat !== "all" && ui.cat !== "fav" && !data.categories.some((c) => c.id === ui.cat)) ui.cat = "all";
    } catch (e) {
      console.warn("[Órbita] respostas rápidas", e);
    }
    mediaCache.clear();
    mount();
    renderBar();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (Q.KEY in changes) reload();
    else if (Q.STATS_KEY in changes) stats = changes[Q.STATS_KEY].newValue || {};
  });
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, subtree: false });
  const bodyWatch = () => (document.body ? new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ["class"] }) : setTimeout(bodyWatch, 300));
  bodyWatch();
  window.addEventListener("resize", () => {
    if (pop && pop.kind !== "slash") closePops();
    placed = { footer: null, mode: null };
    mount();
  });

  reload();
})();
