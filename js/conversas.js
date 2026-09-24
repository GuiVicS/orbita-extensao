// Conversas — tela de chat do painel (conversas.html, aberta em #/conversas).
// Só fala com o service worker (js/chat-sync.js): pedidos por
// chrome.runtime.sendMessage no canal "orbita:chat" e eventos ao vivo pela
// porta "orbita-chat-ui". Nunca fala direto com a aba do WhatsApp.
(() => {
  "use strict";
  const C = globalThis.OrbitaChat;
  const params = new URLSearchParams(location.search);
  const EMBED = params.has("embed");
  if (EMBED) document.body.classList.add("embed");

  // ------------------------------------------------------------------ tema
  const mq = matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    let dark;
    if (EMBED) {
      try {
        dark = parent.document.documentElement.classList.contains("dark");
      } catch {}
    }
    if (dark === undefined) {
      let t = "system";
      try {
        t = localStorage.getItem("orbita-theme") || "system";
      } catch {}
      dark = t === "dark" || (t === "system" && mq.matches);
    }
    document.documentElement.classList.toggle("dark", dark);
  }
  applyTheme();
  mq.addEventListener("change", applyTheme);
  if (EMBED) {
    try {
      new MutationObserver(applyTheme).observe(parent.document.documentElement, { attributes: true, attributeFilter: ["class"] });
    } catch {}
  }

  // ----------------------------------------------------------------- ícones (Lucide, ISC)
  const PATHS = {
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checks: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    spinner: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    speaker: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    spellcheck: '<path d="m6 16 6-12 6 12"/><path d="M8 12h8"/><path d="m16 20 2 2 4-4"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  };
  // nomes dos idiomas em português, para a interface
  const LANG_PT = { pt: "português", en: "inglês", es: "espanhol", fr: "francês", de: "alemão", it: "italiano", nl: "holandês", ru: "russo", zh: "chinês", ja: "japonês", ko: "coreano", ar: "árabe", hi: "hindi", tr: "turco", pl: "polonês", uk: "ucraniano", he: "hebraico", id: "indonésio" };
  const langLabel = (code) => LANG_PT[code] || code || "?";
  const icon = (n, s = 16, extra = "") => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${PATHS[n]}</svg>`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ----------------------------------------------------------------- formatação
  const timeFmt = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const longFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const dayKey = (ts) => new Date(ts).toDateString();
  function listTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return timeFmt.format(d);
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Ontem";
    return dateFmt.format(d);
  }
  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return "Hoje";
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Ontem";
    return longFmt.format(d);
  }
  // formatação do WhatsApp: *negrito* _itálico_ ~tachado~ ```mono``` e links
  function waFormat(text) {
    return esc(text)
      .replace(/```([^`]+)```/g, "<code>$1</code>")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, "$1<b>$2</b>")
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, "$1<i>$2</i>")
      .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?]|$)/g, "$1<s>$2</s>")
      .replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  }
  const PALETTE = ["#7c6cf0", "#0ea5e9", "#14b8a6", "#f59e0b", "#ec4899", "#6366f1", "#22c55e", "#ef4444"];
  function avatarColor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }
  const displayName = (c) => c?.client?.name || c?.name || c?.pushname || C.formatPhone(c?.phone) || "Contato";
  const initials = (name) => name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "#";
  // Foto de perfil do WhatsApp quando existir; senão, as iniciais coloridas.
  // Os links de foto do WhatsApp expiram: se a imagem falhar, pede um novo.
  const avatar = (c, stage) =>
    `<span class="av" style="background:${avatarColor(c.chatId)}">${esc(initials(displayName(c)))}${
      c.avatarUrl ? `<img class="avimg" src="${esc(c.avatarUrl)}" alt="" referrerpolicy="no-referrer" loading="lazy" data-chat="${esc(c.chatId)}">` : ""
    }${stage ? `<i class="stage" style="background:${esc(stage.color)}" title="${esc(stage.name)}"></i>` : ""}</span>`;
  function tick(m) {
    if (!m.fromMe || m.revoked) return ""; // como no WhatsApp: apagada não tem tique
    if (m._pending) return `<span class="tick">${icon("clock", 12)}</span>`;
    if (m.ack >= 3) return `<span class="tick read" aria-label="Lida">${icon("checks", 15)}</span>`;
    if (m.ack === 2) return `<span class="tick" aria-label="Entregue">${icon("checks", 15)}</span>`;
    return `<span class="tick" aria-label="Enviada">${icon("check", 14)}</span>`;
  }

  // ---------------------------------------------------------------- estado
  const S = {
    status: { connected: false, ready: false },
    chats: [],
    filter: "all",
    query: "",
    current: null, // chat aberto
    messages: [], // mensagens carregadas do chat aberto (ordem cronológica)
    attach: null, // anexos na prévia: { items, sel, caption, approved, sending, progress }
    complete: false,
    loadingOlder: false,
    stages: new Map(),
    sideOpen: true,
    unseenBelow: 0,
    settings: null, // preferências das Conversas (C.loadSettings)
    showOriginal: new Set(), // mensagens com o original expandido
    preview: null, // prévia da tradução antes de enviar
    trOpen: false, // popover de tradução aberto
    voiceMode: false, // a próxima mensagem vai como áudio gerado (Fish Audio)
    voice: null, // painel de voz: gravando / transcrevendo / gerando / pronto / erro
  };
  try {
    S.sideOpen = localStorage.getItem("orbita-chat-side") !== "0";
  } catch {}

  const $ = (sel) => document.querySelector(sel);
  const app = document.getElementById("app");

  function toast(text, kind = "") {
    const box = $(".toasts");
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.setAttribute("role", "status");
    el.textContent = text;
    box.append(el);
    setTimeout(() => el.remove(), kind === "err" ? 6000 : 3000);
  }

  async function call(op, extra = {}) {
    const r = await chrome.runtime.sendMessage({ channel: C.CHANNEL, op, ...extra });
    if (!r) throw new Error("A extensão não respondeu. Recarregue a página.");
    if (!r.ok) throw new Error(r.error);
    return r.data;
  }

  // etapas do funil (cor e nome) direto do banco do CRM, só leitura
  async function loadStages() {
    const db = await C.openMainDbReadOnly();
    if (!db) return;
    try {
      if (!db.objectStoreNames.contains("crmStages")) return;
      const all = await new Promise((res, rej) => {
        const r = db.transaction("crmStages").objectStore("crmStages").getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      S.stages = new Map(all.map((s) => [s.id, s]));
    } finally {
      db.close();
    }
  }
  const stageOf = (c) => (c?.client ? S.stages.get(c.client.stageId) : null);

  // ================================================================ layout
  app.innerHTML = `<div class="app">
    <section class="list" aria-label="Conversas">
      <header><h1>Conversas</h1><span class="status" id="status" role="status"><i></i><span>…</span></span>
        <button class="ibtn" id="refresh" aria-label="Atualizar lista de conversas" title="Atualizar">${icon("refresh", 17)}</button>
        <button class="ibtn" id="prefs" aria-label="Preferências de tradução e voz" title="Tradução e voz">${icon("gear", 17)}</button>
        <button class="ibtn" id="fullBtn" aria-label="Tela cheia" title="Tela cheia (Esc para sair)">${icon("maximize", 17)}</button></header>
      <div class="search">${icon("search", 15)}<input id="q" type="search" placeholder="Buscar nome ou número" aria-label="Buscar conversas"></div>
      <div class="filters" role="tablist" aria-label="Filtrar">
        <button data-filter="all" class="on" role="tab">Todas</button><button data-filter="unread" role="tab">Não lidas</button><button data-filter="crm" role="tab">Clientes do CRM</button></div>
      <div class="items" id="items" role="listbox" aria-label="Lista de conversas"></div>
    </section>
    <section class="thread" id="thread" aria-label="Conversa aberta"></section>
    <aside class="side" id="side" aria-label="Dados do cliente" hidden></aside>
  </div><div class="toasts" aria-live="polite"></div>`;

  // ---------------------------------------------------------------- lista
  function filteredChats() {
    const q = S.query.trim().toLowerCase();
    const qd = C.digits(q);
    return S.chats.filter((c) => {
      if (S.filter === "unread" && !c.unreadCount) return false;
      if (S.filter === "crm" && !c.client) return false;
      if (!q) return true;
      return displayName(c).toLowerCase().includes(q) || (qd && (c.phone || "").includes(qd));
    });
  }

  function renderStatus() {
    const el = $("#status");
    const s = S.status;
    el.className = `status ${s.ready ? "ready" : s.connected ? "loading" : ""}`;
    el.querySelector("span").textContent = s.ready ? "WhatsApp conectado" : s.connected ? "Carregando…" : "WhatsApp fechado";
    el.title = s.ready ? "A aba do WhatsApp Web está aberta e pronta." : s.connected ? "A aba do WhatsApp Web está carregando." : "Abra o WhatsApp Web em uma aba do Chrome para receber e enviar mensagens.";
  }

  function itemHtml(c) {
    const on = S.current?.chatId === c.chatId;
    return `<button class="item ${on ? "on" : ""} ${c.unreadCount ? "unread" : ""}" data-chat="${esc(c.chatId)}" role="option" aria-selected="${on}">
      ${avatar(c, stageOf(c))}
      <span class="main"><span class="row1"><span class="name">${esc(displayName(c))}</span><time>${esc(listTime(c.lastMessageAt))}</time></span>
      <span class="row2"><span class="prev">${c.lastFromMe ? `<span class="tick">${icon("check", 13)}</span>` : ""}<span>${esc((c.lastPreview || "").replace(/([*_~])([^*_~\n]+)\1/g, "$2"))}</span></span>
      ${c.unreadCount ? `<span class="badge" aria-label="${c.unreadCount} não lidas">${c.unreadCount > 99 ? "99+" : c.unreadCount}</span>` : ""}</span></span></button>`;
  }

  // pede as fotos que faltam (ou venceram) das conversas da lista, sem pressa
  const avatarAsked = new Set();
  function requestAvatars(list) {
    if (!S.status.ready) return;
    for (const c of list.slice(0, 60)) {
      if (avatarAsked.has(c.chatId)) continue;
      if (c.avatarAt && Date.now() - c.avatarAt < 864e5) continue;
      avatarAsked.add(c.chatId);
      call(C.OPS.AVATAR, { chatId: c.chatId }).catch(() => {});
    }
  }
  const avatarRetried = new Set();
  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.classList.contains("avimg")) return;
      img.remove(); // mostra as iniciais
      const chatId = img.dataset.chat;
      if (chatId && !avatarRetried.has(chatId) && S.status.ready) {
        avatarRetried.add(chatId);
        call(C.OPS.AVATAR, { chatId, force: true }).catch(() => {});
      }
    },
    true,
  );

  function renderList() {
    const items = $("#items");
    const list = filteredChats();
    requestAvatars(list);
    items.innerHTML = list.length
      ? list.map(itemHtml).join("")
      : `<div class="empty">${S.chats.length ? "Nenhuma conversa com esse filtro." : S.status.ready ? "Nenhuma conversa ainda." : "As conversas aparecem aqui quando o WhatsApp Web estiver aberto numa aba."}</div>`;
  }

  async function loadChats() {
    S.chats = await call(C.OPS.LIST);
    if (S.current) S.current = S.chats.find((c) => c.chatId === S.current.chatId) || S.current;
    renderList();
  }

  $("#items").addEventListener("click", (e) => {
    const b = e.target.closest("[data-chat]");
    if (b) openChat(b.dataset.chat);
  });
  $("#q").addEventListener("input", (e) => {
    S.query = e.target.value;
    renderList();
  });
  document.querySelector(".filters").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    S.filter = b.dataset.filter;
    document.querySelectorAll(".filters button").forEach((x) => x.classList.toggle("on", x === b));
    renderList();
  });
  // ---- tela cheia na página: o chat cobre toda a aba do painel (some o menu
  // e o cabeçalho), sem entrar no modo tela cheia do navegador/monitor.
  // A página das Conversas está num iframe do painel (mesma origem), então
  // expandimos o próprio iframe. Esc ou o botão voltam ao normal.
  const frame = EMBED ? window.frameElement : null;
  const EXP_KEY = "orbita-chat-expanded";
  let expanded = false;
  function setExpanded(on, { remember = true } = {}) {
    if (!frame) return;
    expanded = on;
    if (on) {
      frame.dataset.orbitaStyle = frame.getAttribute("style") || "";
      frame.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;margin:0;border:0;z-index:2147483000;display:block;";
      parent.document.documentElement.style.overflow = "hidden"; // o painel atrás não rola
    } else {
      frame.setAttribute("style", frame.dataset.orbitaStyle || "");
      parent.document.documentElement.style.overflow = "";
    }
    document.body.classList.toggle("expanded", on);
    if (remember) {
      try {
        localStorage.setItem(EXP_KEY, on ? "1" : "0");
      } catch {}
    }
    const b = $("#fullBtn");
    b.innerHTML = icon(on ? "minimize" : "maximize", 17);
    b.setAttribute("aria-label", on ? "Sair da tela cheia" : "Tela cheia");
    b.setAttribute("aria-pressed", String(on));
    b.title = on ? "Sair da tela cheia (Esc)" : "Tela cheia: só o chat na página (Esc para sair)";
    b.classList.toggle("on", on);
  }
  if (!frame) $("#fullBtn").hidden = true; // aberto sozinho numa aba, o chat já ocupa a página
  $("#fullBtn").addEventListener("click", () => setExpanded(!expanded));
  // se o painel trocar de página (outro item do menu), o iframe some; nada a desfazer.
  try {
    if (frame && localStorage.getItem(EXP_KEY) === "1") setExpanded(true, { remember: false });
  } catch {}
  $("#prefs").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("options.html#conversas") }));
  $("#refresh").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.innerHTML = icon("spinner", 17, 'class="spin"');
    try {
      S.chats = await call(C.OPS.REFRESH);
      renderList();
    } catch (err) {
      toast(err.message, "err");
    } finally {
      b.innerHTML = icon("refresh", 17);
    }
  });

  // --------------------------------------------------------------- conversa
  function welcome() {
    $("#thread").innerHTML = `<div class="welcome"><div><div class="z">${icon("chat", 30)}</div><b>Suas conversas do WhatsApp</b>
      Escolha uma conversa à esquerda. As mensagens chegam em tempo real enquanto a aba do WhatsApp Web estiver aberta.</div></div>`;
    $("#side").hidden = true;
  }

  const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  const TR_ERRORS = { NOT_CONFIGURED: "configure a IA nas Opções", AUTH: "chave da IA inválida", RATE_LIMIT: "limite da IA atingido", TIMEOUT: "a IA demorou demais", INVALID_OUTPUT: "tradução descartada por segurança", REFUSED: "a IA recusou" };

  // Texto do balão com a camada de tradução:
  // - recebida: português em destaque e o original recolhível;
  // - enviada pela tradução: o texto que saiu e, abaixo, o que você escreveu.
  function textBlock(m) {
    if (m.fromMe) {
      if (!m.textPt || same(m.textPt, m.text)) return waFormat(m.text);
      return `${waFormat(m.text)}<span class="orig pt" title="O que você escreveu">${icon("languages", 12)}<span>${waFormat(m.textPt)}</span></span>`;
    }
    const st = m.translationStatus;
    if (st === "done" && m.translatedText && !same(m.translatedText, m.text)) {
      const open = S.showOriginal.has(m.id);
      return `${waFormat(m.translatedText)}<span class="trmeta">${icon("languages", 12)} Traduzido${m.lang ? ` do ${esc(langLabel(m.lang))}` : ""} ·
        <button class="link" data-orig="${esc(m.id)}" aria-expanded="${open}">${open ? "ocultar original" : "mostrar original"}</button></span>${open ? `<span class="orig">${waFormat(m.text)}</span>` : ""}`;
    }
    if (st === "pending" || st === "stale") return `${waFormat(m.text)}<span class="trmeta">${icon("spinner", 12, 'class="spin"')} ${st === "stale" ? "Mensagem editada, traduzindo de novo…" : "Traduzindo…"}</span>`;
    if (st === "failed")
      return `${waFormat(m.text)}<span class="trmeta err" title="${esc(m.translationError || "")}">${icon("alert", 12)} Não traduzida (${esc(TR_ERRORS[m.translationErrorCode] || "erro")}) · <button class="link" data-retry="${esc(m.id)}">tentar de novo</button></span>`;
    return waFormat(m.text);
  }

  const fmtDur = (sec) => `${Math.floor((sec || 0) / 60)}:${String(Math.round((sec || 0) % 60)).padStart(2, "0")}`;
  const TX_ERRORS = { NOT_CONFIGURED: "configure a chave da Groq ou da OpenAI nas Opções", AUTH: "chave inválida", RATE_LIMIT: "limite atingido", TIMEOUT: "demorou demais", TOO_LARGE: "áudio grande demais" };

  // Balão de áudio: player + transcrição (e a tradução da transcrição).
  function audioBlock(m) {
    const a = m.audio || {};
    const playing = player.id === m.id;
    const pct = playing && player.el.duration ? (player.el.currentTime / player.el.duration) * 100 : 0;
    const btn = playing && player.loading ? icon("spinner", 16, 'class="spin"') : icon(playing && !player.el.paused ? "pause" : "play", 16);
    const head = `<div class="player" data-player="${esc(m.id)}"><button type="button" class="play" data-play="${esc(m.id)}" aria-label="${playing && !player.el.paused ? "Pausar" : "Ouvir"} áudio">${btn}</button>
      <div class="bar"><i style="width:${pct}%"></i></div><span class="dur">${fmtDur(playing && player.el.currentTime ? player.el.currentTime : a.duration)}</span>${a.ptt ? `<span class="mic" title="Mensagem de voz">${icon("mic", 13)}</span>` : ""}</div>`;
    const transcribeBtn = (label) => `<button class="link" data-transcribe="${esc(m.id)}">${label}</button>`;
    let tx;
    switch (a.transcriptStatus) {
      case "pending":
        tx = `<span class="trmeta">${icon("spinner", 12, 'class="spin"')} Transcrevendo…</span>`;
        break;
      case "done":
        tx = `<span class="transcript">${textBlock({ ...m, text: a.transcript })}</span>`;
        break;
      case "empty":
        tx = `<span class="trmeta">${icon("mic", 12)} Sem fala detectada</span>`;
        break;
      case "failed":
        tx = `<span class="trmeta err" title="${esc(a.transcriptError || "")}">${icon("alert", 12)} Não transcrito (${esc(TX_ERRORS[a.transcriptErrorCode] || "erro")}) · ${transcribeBtn("tentar de novo")}</span>`;
        break;
      case "skipped":
        tx = `<span class="trmeta">Áudio longo · ${transcribeBtn("transcrever")}</span>`;
        break;
      default:
        tx = `<span class="trmeta">${transcribeBtn("Transcrever")}</span>`;
    }
    const ai = a.generated ? `<span class="aibadge" title="Áudio criado com voz sintética (Fish Audio)">${icon("speaker", 11)} Voz gerada por IA</span>` : "";
    return `${head}${tx}${m.text ? `<span class="cap">${waFormat(m.text)}</span>` : ""}${ai}`;
  }

  // ---- player: um só elemento <audio> para a tela toda
  const player = { el: new Audio(), id: null, url: null, loading: false };
  function paintPlayer() {
    document.querySelectorAll("[data-player]").forEach((box) => {
      const on = box.dataset.player === player.id;
      const btn = box.querySelector(".play");
      btn.innerHTML = on && player.loading ? icon("spinner", 16, 'class="spin"') : icon(on && !player.el.paused ? "pause" : "play", 16);
      btn.setAttribute("aria-label", on && !player.el.paused ? "Pausar áudio" : "Ouvir áudio");
      box.querySelector(".bar i").style.width = on && player.el.duration ? `${(player.el.currentTime / player.el.duration) * 100}%` : "0%";
      if (on && player.el.currentTime) box.querySelector(".dur").textContent = fmtDur(player.el.currentTime);
    });
  }
  ["timeupdate", "play", "pause", "ended"].forEach((ev) => player.el.addEventListener(ev, paintPlayer));
  player.el.addEventListener("ended", () => {
    player.el.currentTime = 0;
    paintPlayer();
  });

  async function togglePlay(id) {
    if (player.id === id && !player.loading) return player.el.paused ? player.el.play() : player.el.pause();
    player.el.pause();
    if (player.url) URL.revokeObjectURL(player.url);
    Object.assign(player, { id, url: null, loading: true });
    paintPlayer();
    try {
      await call(C.OPS.MEDIA_FETCH, { messageId: id }); // baixa da aba do WhatsApp se ainda não está no cache
      const media = await C.getMedia(id);
      if (player.id !== id) return;
      player.url = URL.createObjectURL(media.blob);
      player.el.src = player.url;
      player.loading = false;
      await player.el.play();
    } catch (e) {
      if (player.id === id) Object.assign(player, { id: null, loading: false });
      toast(`Não foi possível tocar o áudio: ${e.message}`, "err");
    }
    paintPlayer();
  }

  // ---- mídias: miniatura no balão; clique abre o visualizador
  const fmtSize = (n) => (!n ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1).replace(".", ",")} MB`);
  const extOf = (m) => ((m.filename || "").match(/\.([a-z0-9]{1,5})$/i)?.[1] || (m.media.mime.split("/")[1] || "").split(/[;+.-]/)[0] || "arq").toUpperCase().slice(0, 4);
  const isPdf = (m) => /pdf/i.test(m.media?.mime || "") || /\.pdf$/i.test(m.filename || "");

  // o balão preserva quebras de linha (texto das mensagens): o HTML da mídia vai sem elas
  const tight = (html) => html.replace(/>\s+</g, "><").trim();

  function mediaBlock(m) {
    return tight(mediaHtml(m));
  }

  function mediaHtml(m) {
    const md = m.media;
    const cap = m.text ? `<span class="cap">${textBlock(m)}</span>` : "";
    if (md.kind === "document") {
      const info = [isPdf(m) ? "PDF" : extOf(m), md.pages ? `${md.pages} página${md.pages > 1 ? "s" : ""}` : "", fmtSize(md.size)].filter(Boolean).join(" · ");
      return `<div class="doccard"><span class="dico ${isPdf(m) ? "pdf" : ""}">${esc(isPdf(m) ? "PDF" : extOf(m))}</span>
        <span class="dinfo"><b title="${esc(m.filename || "")}">${esc(m.filename || "Documento")}</b><small>${esc(info)}</small></span></div>
        <div class="dact"><button class="link" data-view="${esc(m.id)}">${isPdf(m) ? "Abrir" : "Ver"}</button><button class="link" data-dl="${esc(m.id)}">Baixar</button></div>${cap}`;
    }
    const w = md.width && md.height ? Math.min(260, md.width) : 240;
    const ratio = md.width && md.height ? Math.min(1.6, Math.max(0.5, md.height / md.width)) : 0.75;
    const thumb = md.thumb ? `<img src="data:image/jpeg;base64,${md.thumb}" alt="">` : `<span class="noth">${icon(md.kind === "video" ? "play" : "clip", 26)}</span>`;
    const label = md.kind === "video" ? (md.gif ? "GIF" : fmtDur(md.duration || 0)) : "";
    const cls = `mthumb ${md.kind} ${md.round ? "round" : ""}`;
    const style = md.kind === "sticker" || md.round ? "" : `style="width:${w}px;height:${Math.round(w * ratio)}px"`;
    return `<button class="${cls}" data-view="${esc(m.id)}" aria-label="Abrir ${md.kind === "video" ? "vídeo" : md.kind === "sticker" ? "figurinha" : "foto"}" ${style}>${thumb}
      ${md.kind === "video" ? `<span class="playov">${icon("play", 22)}</span>` : ""}${label ? `<span class="mlabel">${esc(label)}</span>` : ""}</button>${cap}`;
  }

  // ---- visualizador (foto, vídeo, PDF; outros arquivos: baixar)
  const mediaUrls = new Map(); // id → blob URL (vale enquanto a página estiver aberta)
  const viewer = { open: false, list: [], i: 0 };

  async function mediaUrl(id) {
    if (mediaUrls.has(id)) return mediaUrls.get(id);
    await call(C.OPS.MEDIA_FETCH, { messageId: id }); // baixa da aba do WhatsApp se ainda não está no cache
    const rec = await C.getMedia(id);
    if (!rec?.blob) throw new Error("Arquivo não encontrado.");
    const url = URL.createObjectURL(rec.blob);
    mediaUrls.set(id, url);
    return url;
  }

  function fileName(m) {
    if (m.filename) return m.filename;
    const ext = (m.media?.mime.split("/")[1] || "bin").split(/[;+]/)[0].replace("jpeg", "jpg");
    return `whatsapp-${new Date(m.ts).toISOString().slice(0, 19).replace(/[T:]/g, "-")}.${ext}`;
  }

  async function download(id) {
    const m = S.messages.find((x) => x.id === id);
    if (!m) return;
    try {
      const a = Object.assign(document.createElement("a"), { href: await mediaUrl(id), download: fileName(m) });
      document.body.append(a);
      a.click();
      a.remove();
    } catch (e) {
      toast(`Não foi possível baixar: ${e.message}`, "err");
    }
  }

  function openViewer(id) {
    viewer.list = S.messages.filter((x) => x.media && !x.revoked);
    viewer.i = Math.max(0, viewer.list.findIndex((x) => x.id === id));
    viewer.open = true;
    renderViewer();
  }

  function closeViewer() {
    viewer.open = false;
    document.querySelector(".viewer")?.remove();
  }

  async function renderViewer() {
    let box = document.querySelector(".viewer");
    if (!viewer.open) return box?.remove();
    const m = viewer.list[viewer.i];
    if (!box) {
      box = document.createElement("div");
      box.className = "viewer";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      document.body.append(box);
      box.addEventListener("click", (e) => {
        const b = e.target.closest("[data-v]");
        if (!b) return e.target === box || e.target.classList.contains("vstage") ? closeViewer() : undefined;
        if (b.dataset.v === "close") closeViewer();
        if (b.dataset.v === "prev") nav(-1);
        if (b.dataset.v === "next") nav(1);
        if (b.dataset.v === "dl") download(viewer.list[viewer.i].id);
        if (b.dataset.v === "tab") mediaUrl(viewer.list[viewer.i].id).then((u) => chrome.tabs.create({ url: u }));
      });
    }
    const n = viewer.list.length;
    const title = m.filename || (m.media.kind === "video" ? "Vídeo" : m.media.kind === "sticker" ? "Figurinha" : "Foto");
    box.innerHTML = `<div class="vbar"><div class="vtitle"><b>${esc(title)}</b><small>${esc(m.fromMe ? "Você" : displayName(S.current))} · ${esc(new Date(m.ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))}${m.media.size ? ` · ${fmtSize(m.media.size)}` : ""}</small></div>
      ${isPdf(m) ? `<button class="ibtn" data-v="tab" aria-label="Abrir em nova aba" title="Abrir em nova aba">${icon("external", 18)}</button>` : ""}
      <button class="ibtn" data-v="dl" aria-label="Baixar" title="Baixar">${icon("download", 18)}</button>
      <button class="ibtn" data-v="close" aria-label="Fechar (Esc)" title="Fechar (Esc)">${icon("x", 20)}</button></div>
      <div class="vstage"><div class="vload">${icon("spinner", 26, 'class="spin"')}<span>Baixando do WhatsApp…</span></div></div>
      ${n > 1 ? `<button class="vnav prev" data-v="prev" aria-label="Anterior" ${viewer.i === 0 ? "disabled" : ""}>${icon("left", 26)}</button><button class="vnav next" data-v="next" aria-label="Próxima" ${viewer.i === n - 1 ? "disabled" : ""}>${icon("right", 26)}</button><span class="vcount">${viewer.i + 1} / ${n}</span>` : ""}
      ${m.text ? `<div class="vcap">${esc(m.translationStatus === "done" && m.translatedText ? m.translatedText : m.text)}</div>` : ""}`;
    box.querySelector("[data-v=close]").focus();
    const stage = box.querySelector(".vstage");
    try {
      const url = await mediaUrl(m.id);
      if (!viewer.open || viewer.list[viewer.i] !== m) return;
      if (m.media.kind === "video") stage.innerHTML = `<video src="${url}" controls autoplay ${m.media.gif ? "loop muted" : ""} playsinline></video>`;
      else if (m.media.kind === "document" && isPdf(m)) stage.innerHTML = `<iframe src="${url}" title="${esc(title)}"></iframe>`;
      else if (m.media.kind === "document") stage.innerHTML = `<div class="vfile"><span class="dico big">${esc(extOf(m))}</span><b>${esc(title)}</b><small>Sem pré-visualização para este tipo de arquivo.</small><button class="btn primary" data-v="dl">${icon("download", 15)} Baixar</button></div>`;
      else stage.innerHTML = `<img src="${url}" alt="${esc(m.text || title)}">`;
    } catch (e) {
      if (viewer.list[viewer.i] === m) stage.innerHTML = `<div class="vfile"><b>Não foi possível abrir</b><small>${esc(e.message)}</small></div>`;
    }
  }

  function nav(d) {
    const j = viewer.i + d;
    if (j < 0 || j >= viewer.list.length) return;
    viewer.i = j;
    renderViewer();
  }

  function bubbleHtml(m, prev) {
    let head = "";
    if (!prev || dayKey(prev.ts) !== dayKey(m.ts)) head += `<div class="day">${esc(dayLabel(m.ts))}</div>`;
    const first = !prev || prev.fromMe !== m.fromMe || head;
    const meta = `<span class="meta">${m.edited ? "editada · " : ""}${esc(timeFmt.format(new Date(m.ts)))}${tick(m)}</span>`;
    let body;
    if (m.revoked && m.fromMe) body = `${icon("ban", 14, 'style="display:inline;vertical-align:-2px"')} Você apagou esta mensagem`;
    else if (m.revoked) body = `${icon("ban", 14, 'style="display:inline;vertical-align:-2px"')} Mensagem apagada${m.text ? `<span class="cap" style="opacity:.7">“${esc(m.text)}”</span>` : ""}`;
    else if (m.type === "audio") body = audioBlock(m);
    else if (m.type === "other" && m.media) body = mediaBlock(m);
    else if (m.type === "other") body = `<span class="kind">${icon("clip", 14)} ${esc(m.label || "Mídia")}${m.filename ? `: ${esc(m.filename)}` : ""}</span>${m.text ? `<span class="cap">${textBlock(m)}</span>` : ""}`;
    else body = textBlock(m);
    const cls = ["b", m.fromMe ? "me" : "", first ? "first" : "", m.revoked ? "revoked" : "", m._pending ? "pending" : "", m._new ? "new" : ""].filter(Boolean).join(" ");
    // menu do balão (apagar); não aparece em mensagens ainda sendo enviadas
    const menu = m._pending ? "" : `<button class="bmenu" data-menu="${esc(m.id)}" aria-label="Opções da mensagem" title="Opções">${icon("down", 16)}</button>`;
    return `${head}<div class="${cls}" data-id="${esc(m.id)}">${menu}${body}${meta}</div>`;
  }

  // ---- apagar mensagem (para mim / para todos)
  function openMsgMenu(btn) {
    closeMsgMenu();
    const m = S.messages.find((x) => x.id === btn.dataset.menu);
    if (!m) return;
    const revocable = C.canRevoke(m);
    const why = !m.fromMe ? "Só dá para apagar para todos as mensagens que você enviou." : m.revoked ? "Já foi apagada para todos." : "Passou o prazo do WhatsApp (cerca de 2 dias e meio).";
    const box = document.createElement("div");
    box.className = "msgmenu";
    box.setAttribute("role", "menu");
    box.innerHTML = `<button role="menuitem" data-del="me">${icon("trash", 14)} Apagar para mim</button>
      <button role="menuitem" data-del="all" ${revocable ? "" : `disabled title="${esc(why)}"`}>${icon("ban", 14)} Apagar para todos</button>`;
    const r = btn.getBoundingClientRect();
    box.style.top = `${Math.min(window.innerHeight - 110, r.bottom + 4)}px`;
    box.style.left = `${Math.max(8, Math.min(window.innerWidth - 220, m.fromMe ? r.right - 210 : r.left))}px`;
    document.body.append(box);
    box.querySelector("button:not([disabled])")?.focus();
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-del]");
      if (!b || b.disabled) return;
      closeMsgMenu();
      deleteMessage(m, b.dataset.del === "all");
    });
    setTimeout(() => document.addEventListener("mousedown", onMenuOutside, true), 0);
  }
  function onMenuOutside(e) {
    if (!e.target.closest(".msgmenu")) closeMsgMenu();
  }
  function closeMsgMenu() {
    document.querySelector(".msgmenu")?.remove();
    document.removeEventListener("mousedown", onMenuOutside, true);
  }

  function confirmDialog(title, text, okLabel) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "modal";
      wrap.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="cdT"><h2 id="cdT">${esc(title)}</h2><p class="muted">${esc(text)}</p>
        <div class="pvact"><button class="btn" data-a="no">Cancelar</button><button class="btn danger" data-a="yes">${esc(okLabel)}</button></div></div>`;
      document.body.append(wrap);
      wrap.querySelector('[data-a="no"]').focus();
      const close = (ok) => (wrap.remove(), resolve(ok));
      wrap.addEventListener("click", (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a) close(a === "yes");
        else if (e.target === wrap) close(false);
      });
      wrap.addEventListener("keydown", (e) => e.key === "Escape" && (e.stopPropagation(), close(false)));
    });
  }

  async function deleteMessage(m, forEveryone) {
    const ok = await confirmDialog(
      forEveryone ? "Apagar para todos?" : "Apagar para mim?",
      forEveryone ? `A mensagem será apagada para você e para ${displayName(S.current)}. No lugar dela aparece “mensagem apagada”.` : "A mensagem some só para você (aqui e no seu WhatsApp). A outra pessoa continua vendo.",
      forEveryone ? "Apagar para todos" : "Apagar para mim",
    );
    if (!ok) return;
    try {
      await call(C.OPS.DELETE_MESSAGE, { chatId: m.chatId, messageId: m.id, forEveryone });
      toast(forEveryone ? "Apagada para todos." : "Apagada para você.", "ok");
    } catch (e) {
      toast(`Não foi possível apagar: ${e.message}`, "err");
    }
  }

  function renderMessages({ keepScroll = false, toBottom = false } = {}) {
    const box = $("#msgs");
    if (!box) return;
    const fromBottom = box.scrollHeight - box.scrollTop;
    const top = S.complete ? `<div class="older">Início da conversa</div>` : `<div class="older" id="sentinel">${S.loadingOlder ? `${icon("spinner", 14, 'class="spin"')} Carregando mensagens antigas…` : "Role para ver mensagens antigas"}</div>`;
    box.innerHTML = top + S.messages.map((m, i) => bubbleHtml(m, S.messages[i - 1])).join("");
    S.messages.forEach((m) => delete m._new);
    if (toBottom) box.scrollTop = box.scrollHeight;
    else if (keepScroll) box.scrollTop = box.scrollHeight - fromBottom; // mantém a posição ao carregar antigas
    observeSentinel();
  }

  let sentinelObs = null;
  function observeSentinel() {
    sentinelObs?.disconnect();
    const s = $("#sentinel");
    if (!s) return;
    sentinelObs = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadOlder(), { root: $("#msgs"), rootMargin: "200px 0px 0px 0px" });
    sentinelObs.observe(s);
  }

  async function loadOlder() {
    if (S.loadingOlder || S.complete || !S.current || !S.messages.length) return;
    S.loadingOlder = true;
    const chatId = S.current.chatId;
    renderMessages({ keepScroll: true });
    try {
      const oldest = S.messages[0];
      const r = await call(C.OPS.LOAD_MORE, { chatId, beforeTs: oldest.ts, beforeId: oldest.id });
      if (S.current?.chatId !== chatId) return;
      const known = new Set(S.messages.map((m) => m.id));
      S.messages = [...r.messages.filter((m) => !known.has(m.id)), ...S.messages];
      S.complete = r.complete || r.messages.length === 0;
    } catch (e) {
      toast(e.message, "err");
    } finally {
      S.loadingOlder = false;
      if (S.current?.chatId === chatId) renderMessages({ keepScroll: true });
    }
  }

  const translating = () => Boolean(S.current?.translation?.enabled);

  function composerState() {
    if (!S.status.connected) return { ok: false, why: "Abra o WhatsApp Web em uma aba para enviar mensagens." };
    if (!S.status.ready) return { ok: false, why: "O WhatsApp Web ainda está carregando…" };
    return { ok: true };
  }

  function renderComposer() {
    const ta = $("#text");
    if (!ta) return;
    const st = composerState();
    ta.disabled = !st.ok;
    ta.placeholder = !st.ok ? st.why : translating() ? `Escreva em ${langLabel(S.settings.myLang)}: vai em ${langLabel(C.contactLangOf(S.current, S.settings))}` : "Digite uma mensagem";
    ta.title = st.ok ? "Enter envia · Shift+Enter quebra a linha" : st.why;
    $("#sendBtn").disabled = !st.ok || !ta.value.trim() || Boolean(S.voice);
    $("#micBtn").disabled = !st.ok || Boolean(S.voice) || Boolean(S.preview);
    $("#attachBtn").disabled = !st.ok || Boolean(S.voice);
    const fb = $("#fixBtn");
    const fixOn = Boolean(S.settings?.autoCorrect);
    fb.classList.toggle("on", fixOn && !translating());
    fb.setAttribute("aria-pressed", String(fixOn));
    fb.title = translating()
      ? "Corretor automático: não é usado com a tradução ligada (a IA já ajusta o texto ao traduzir)"
      : `Corretor automático ${fixOn ? "ligado" : "desligado"}: ${fixOn ? "a IA corrige ortografia e gramática antes de enviar. Clique para desligar." : "clique para a IA corrigir ortografia e gramática antes de enviar."}`;
    fb.setAttribute("aria-label", fb.title);
    const vb = $("#voiceBtn");
    vb.disabled = !st.ok;
    vb.classList.toggle("on", S.voiceMode);
    vb.setAttribute("aria-pressed", String(S.voiceMode));
    $("#sendBtn").setAttribute("aria-label", S.voiceMode ? "Gerar áudio" : "Enviar mensagem");
    $("#sendBtn").innerHTML = icon(S.voiceMode ? "speaker" : "send", 18);
    if (S.voiceMode && st.ok) ta.placeholder = `Escreva em ${langLabel(S.settings.myLang)}: vai como áudio${translating() ? ` em ${langLabel(C.contactLangOf(S.current, S.settings))}` : ""}`;
  }

  function trButton(c) {
    const t = c.translation || {};
    const on = Boolean(t.enabled);
    const to = S.settings ? C.contactLangOf(c, S.settings) : "en";
    return `<button class="trbtn ${on ? "on" : ""}" id="trBtn" aria-haspopup="dialog" aria-expanded="${S.trOpen}" title="Tradução desta conversa">${icon("languages", 16)}
      <span>${on ? `${esc((S.settings?.myLang || "pt").toUpperCase())} ⇄ ${esc(to.toUpperCase())}` : "Traduzir"}</span></button>
      ${S.trOpen ? trPopover(c, to) : ""}`;
  }

  function trPopover(c, to) {
    const t = c.translation || {};
    const langs = Object.keys(LANG_PT).filter((l) => l !== S.settings.myLang);
    const detected = t.detectedLang && t.detectedLang !== S.settings.myLang ? langLabel(t.detectedLang) : null;
    return `<div class="trpop" role="dialog" aria-label="Tradução da conversa">
      <label class="swrow"><span><b>Traduzir esta conversa</b><small>Você lê e escreve em ${esc(langLabel(S.settings.myLang))}.</small></span>
        <input type="checkbox" id="trEnabled" ${t.enabled ? "checked" : ""}></label>
      <label class="field"><span>Idioma do contato</span><select id="trLang">
        <option value="auto" ${!t.contactLang || t.contactLang === "auto" ? "selected" : ""}>Automático${detected ? ` (detectado: ${esc(detected)})` : ` (padrão: ${esc(langLabel(S.settings.defaultContactLang))})`}</option>
        ${langs.map((l) => `<option value="${l}" ${t.contactLang === l ? "selected" : ""}>${esc(langLabel(l)[0].toUpperCase() + langLabel(l).slice(1))}</option>`).join("")}</select></label>
      <label class="field"><span>Tom das mensagens enviadas</span><select id="trTone">
        <option value="" ${!t.tone ? "selected" : ""}>Padrão (${S.settings.tone === "formal" ? "formal" : "informal"})</option>
        <option value="informal" ${t.tone === "informal" ? "selected" : ""}>Informal</option><option value="formal" ${t.tone === "formal" ? "selected" : ""}>Formal</option></select></label>
      <p class="hint">${icon("shield", 12)} O texto das mensagens desta conversa vai para o provedor de IA configurado nas Opções.</p></div>`;
  }

  function renderHeader() {
    const c = S.current;
    const h = $("#thead");
    if (!c || !h) return;
    h.innerHTML = `${avatar(c, stageOf(c))}<div class="who"><b>${esc(displayName(c))}</b>
      <small>${esc(C.formatPhone(c.phone) || "Número oculto pelo WhatsApp")}${c.client ? `<span class="chip crm">Cliente do CRM</span>` : `<span class="chip">Fora do CRM</span>`}</small></div>
      ${trButton(c)}
      <button class="ibtn ${S.sideOpen ? "on" : ""}" id="sideBtn" aria-label="${S.sideOpen ? "Esconder" : "Mostrar"} dados do cliente" aria-pressed="${S.sideOpen}" title="Dados do cliente">${icon("panel", 18)}</button>`;
  }

  async function openChat(chatId) {
    const c = S.chats.find((x) => x.chatId === chatId) || { chatId };
    S.current = c;
    S.preview = null;
    S.trOpen = false;
    closeQrPick();
    if (S.voice) cancelVoice();
    closeAttach();
    S.voiceMode = false;
    S.messages = [];
    S.complete = false;
    S.unseenBelow = 0;
    renderList();
    $("#thread").innerHTML = `<div class="thead" id="thead"></div><div id="notice"></div>
      <div class="msgs" id="msgs" role="log" aria-live="polite" aria-label="Mensagens"><div class="older">${icon("spinner", 14, 'class="spin"')} Carregando…</div></div>
      <button class="jump" id="jump" hidden aria-label="Ir para a última mensagem">${icon("down", 20)}</button>
      <div id="preview"></div>
      <div id="attach"></div>
      <div class="dropzone" id="dropzone" hidden><div>${icon("clip", 30)}<b>Solte para anexar</b><small>Fotos, vídeos, áudios e documentos</small></div></div>
      <form class="composer" id="composer">
        <button class="cbtn" id="attachBtn" type="button" aria-label="Anexar arquivo" title="Anexar (ou cole um print com Ctrl+V, ou arraste o arquivo)">${icon("clip", 18)}</button>
        <input type="file" id="fileIn" multiple hidden>
        <button class="cbtn" id="micBtn" type="button" aria-label="Gravar em ${esc(langLabel(S.settings?.myLang || "pt"))} (vira texto para revisar)" title="Gravar sua fala: vira texto para você revisar">${icon("mic", 18)}</button>
        <button class="cbtn" id="voiceBtn" type="button" aria-pressed="false" aria-label="Enviar como áudio com voz gerada" title="Enviar como áudio (voz gerada pelo Fish Audio)">${icon("speaker", 18)}</button>
        <button class="cbtn" id="fixBtn" type="button" aria-pressed="false" aria-label="Corretor automático">${icon("spellcheck", 18)}</button>
        <label class="sr" for="text">Mensagem</label><textarea id="text" rows="1"></textarea>
        <button class="send" id="sendBtn" type="submit" aria-label="Enviar mensagem" disabled>${icon("send", 18)}</button></form>
      <div class="qrbar" id="qrbar" aria-label="Respostas rápidas"></div>`;
    renderHeader();
    renderComposer();
    renderSide();
    bindThread();
    port?.postMessage({ kind: "focus", chatId });
    history.replaceState(null, "", `?${EMBED ? "embed=1&" : ""}chat=${encodeURIComponent(chatId)}`);
    try {
      const r = await call(C.OPS.OPEN, { chatId });
      if (S.current?.chatId !== chatId) return;
      if (r.chat) S.current = { ...S.current, ...r.chat };
      S.messages = r.messages;
      S.complete = Boolean(r.chat?.historyComplete) && r.messages.length < 50;
      renderHeader();
      renderSide();
      $("#notice").innerHTML = r.warning ? `<div class="notice">${icon("alert", 14)} ${esc(r.warning)}</div>` : "";
      renderMessages({ toBottom: true });
      if (S.current.unreadCount) call(C.OPS.MARK_READ, { chatId }).catch(() => {});
    } catch (e) {
      $("#notice").innerHTML = `<div class="notice err">${icon("alert", 14)} ${esc(e.message)}</div>`;
      renderMessages();
    }
    $("#text")?.focus();
  }

  function nearBottom() {
    const box = $("#msgs");
    return !box || box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  }

  function bindThread() {
    const ta = $("#text");
    const grow = () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(160, ta.scrollHeight + 2)}px`;
    };
    ta.addEventListener("input", () => {
      grow();
      renderComposer();
      qrSlash(ta.value);
    });
    $("#qrbar").addEventListener("click", onQrBarClick);
    renderQrBar();
    ta.addEventListener("keydown", (e) => {
      if (qrPickKeys(e)) return; // setas/Enter/Tab/Esc no seletor de respostas rápidas ("/")
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        $("#composer").requestSubmit();
      }
    });
    $("#micBtn").addEventListener("click", () => startRecording());
    $("#fixBtn").addEventListener("click", toggleAutoCorrect);
    bindAttach();
    $("#voiceBtn").addEventListener("click", () => {
      S.voiceMode = !S.voiceMode;
      if (S.preview) closePreview(false);
      renderComposer();
      $("#text").focus();
    });
    $("#composer").addEventListener("submit", (e) => {
      e.preventDefault();
      submitComposer();
    });
    $("#msgs").addEventListener("click", (e) => {
      const orig = e.target.closest("[data-orig]");
      if (orig) {
        const id = orig.dataset.orig;
        S.showOriginal.has(id) ? S.showOriginal.delete(id) : S.showOriginal.add(id);
        return renderMessages({ keepScroll: true });
      }
      const menuBtn = e.target.closest("[data-menu]");
      if (menuBtn) return openMsgMenu(menuBtn);
      const view = e.target.closest("[data-view]");
      if (view) return openViewer(view.dataset.view);
      const dl = e.target.closest("[data-dl]");
      if (dl) return download(dl.dataset.dl);
      const play = e.target.closest("[data-play]");
      if (play) return togglePlay(play.dataset.play);
      const tr = e.target.closest("[data-transcribe]");
      if (tr) return call(C.OPS.TRANSCRIBE, { messageId: tr.dataset.transcribe }).catch((err) => toast(err.message, "err"));
      const retry = e.target.closest("[data-retry]");
      if (retry) call(C.OPS.RETRANSLATE, { messageId: retry.dataset.retry }).catch((err) => toast(err.message, "err"));
    });
    $("#thead").addEventListener("change", (e) => {
      if (e.target.id === "trEnabled") setTranslation({ enabled: e.target.checked });
      if (e.target.id === "trLang") setTranslation({ contactLang: e.target.value });
      if (e.target.id === "trTone") setTranslation({ tone: e.target.value });
    });
    $("#msgs").addEventListener("scroll", () => {
      const nb = nearBottom();
      $("#jump").hidden = nb;
      if (nb && S.unseenBelow) {
        S.unseenBelow = 0;
        updateJump();
      }
    });
    $("#jump").addEventListener("click", () => {
      $("#msgs").scrollTop = $("#msgs").scrollHeight;
    });
    $("#thead").addEventListener("click", (e) => {
      if (e.target.closest("#trBtn")) {
        S.trOpen = !S.trOpen;
        return renderHeader();
      }
      if (!e.target.closest("#sideBtn")) return;
      S.sideOpen = !S.sideOpen;
      try {
        localStorage.setItem("orbita-chat-side", S.sideOpen ? "1" : "0");
      } catch {}
      renderHeader();
      renderSide();
    });
  }

  function updateJump() {
    const j = $("#jump");
    if (!j) return;
    j.innerHTML = icon("down", 20) + (S.unseenBelow ? `<span class="badge">${S.unseenBelow}</span>` : "");
  }

  // ---- prévia da tradução (tradução ligada)
  function renderPreview() {
    const box = $("#preview");
    if (!box) return;
    if (S.voice) return renderVoice(box);
    const p = S.preview;
    if (!p) return void (box.innerHTML = "");
    if (p.kind === "fix") return renderFix(box, p);
    let body;
    if (p.status === "loading") body = `<div class="pvline">${icon("spinner", 14, 'class="spin"')} Traduzindo para ${esc(langLabel(C.contactLangOf(S.current, S.settings)))}…</div>`;
    else if (p.status === "error") body = `<div class="pvline err">${icon("alert", 14)} <span>Não foi possível traduzir: ${esc(p.error.replace(/\.$/, ""))}. <b>Nada foi enviado.</b></span></div>`;
    else
      body = `<div class="pvsec"><small>Vai ser enviado em ${esc(langLabel(p.result.to))}</small><div class="pvtext">${waFormat(p.result.translated)}</div></div>
        <div class="pvsec back"><small>Conferência: a tradução de volta para ${esc(langLabel(S.settings.myLang))}</small><div>${waFormat(p.result.backTranslated)}</div></div>`;
    box.innerHTML = `<div class="pv" role="region" aria-label="Prévia da tradução">${body}
      <div class="pvact"><button class="btn" id="pvCancel" type="button">Cancelar</button><button class="btn" id="pvEdit" type="button">Editar</button>
      ${p.status === "error" ? `<button class="btn primary" id="pvRetry" type="button">Tentar de novo</button>` : `<button class="btn primary" id="pvSend" type="button" ${p.status !== "ready" ? "disabled" : ""}>${S.voiceMode ? `${icon("speaker", 14)} Gerar voz` : `${icon("send", 14)} Enviar`}</button>`}</div></div>`;
    $("#pvCancel").onclick = () => closePreview(true);
    $("#pvEdit").onclick = () => closePreview(false);
    if ($("#pvRetry")) $("#pvRetry").onclick = () => requestPreview(p.textPt);
    if ($("#pvSend")) {
      $("#pvSend").onclick = () => (S.voiceMode ? generateVoice(p.textPt) : sendText());
      $("#pvSend").focus();
    }
  }

  function closePreview(clear) {
    S.preview = null;
    renderPreview();
    const ta = $("#text");
    ta.readOnly = false;
    if (clear) ta.value = "";
    renderComposer();
    ta.focus();
  }

  async function requestPreview(textPt) {
    const chatId = S.current.chatId;
    S.preview = { textPt, status: "loading" };
    $("#text").readOnly = true;
    renderPreview();
    try {
      const result = await call(C.OPS.TRANSLATE_PREVIEW, { chatId, textPt });
      if (S.current?.chatId !== chatId || S.preview?.textPt !== textPt) return;
      S.preview = { textPt, status: "ready", result };
    } catch (e) {
      if (S.current?.chatId !== chatId || S.preview?.textPt !== textPt) return;
      S.preview = { textPt, status: "error", error: e.message };
    }
    renderPreview();
  }

  // ---- corretor automático (opcional, sem tradução): a IA corrige
  // ortografia e gramática; a prévia mostra o que mudou antes de enviar.
  async function toggleAutoCorrect() {
    const on = !S.settings.autoCorrect;
    if (on && !S.settings.privacyAccepted) {
      if (!(await privacyDialog("corretor"))) return;
      S.settings = await C.saveSettings({ privacyAccepted: true });
    }
    S.settings = await C.saveSettings({ autoCorrect: on });
    renderComposer();
    toast(on ? "Corretor ligado: o texto é corrigido antes de enviar." : "Corretor desligado.");
    $("#text")?.focus();
  }

  async function requestCorrection(text) {
    const chatId = S.current.chatId;
    S.preview = { kind: "fix", textPt: text, status: "loading" };
    $("#text").readOnly = true;
    renderPreview();
    renderComposer();
    let r;
    try {
      r = await call(C.OPS.CORRECT, { text });
    } catch (e) {
      if (S.current?.chatId !== chatId || S.preview?.kind !== "fix" || S.preview.textPt !== text) return;
      S.preview = { kind: "fix", textPt: text, status: "error", error: e.message };
      return renderPreview();
    }
    if (S.current?.chatId !== chatId || S.preview?.kind !== "fix" || S.preview.textPt !== text) return;
    if (!r.changed || !S.settings.autoCorrectReview) return sendFixed(r.text); // nada a corrigir, ou envio direto
    S.preview = { kind: "fix", textPt: text, status: "ready", fixed: r.text };
    renderPreview();
  }

  function sendFixed(text) {
    const ta = $("#text");
    ta.value = text;
    S.fixedText = text; // já passou pelo corretor: não corrige de novo
    sendText();
  }

  function renderFix(box, p) {
    let body;
    let acts = `<button class="btn" id="fxCancel" type="button">Cancelar</button><button class="btn" id="fxEdit" type="button">Editar</button>`;
    if (p.status === "loading") {
      body = `<div class="pvline">${icon("spinner", 14, 'class="spin"')} Corrigindo o texto…</div>`;
      acts += `<button class="btn" id="fxOrig" type="button">Enviar sem corrigir</button>`;
    } else if (p.status === "error") {
      body = `<div class="pvline err">${icon("alert", 14)} <span>Não foi possível corrigir: ${esc(p.error.replace(/\.$/, ""))}. <b>Nada foi enviado.</b></span></div>`;
      acts += `<button class="btn" id="fxRetry" type="button">Tentar de novo</button><button class="btn primary" id="fxOrig" type="button">${icon("send", 14)} Enviar sem corrigir</button>`;
    } else {
      body = `<div class="pvsec"><small>Corrigido · as mudanças estão destacadas</small><div class="pvtext fixd">${C.diffWords(p.textPt, p.fixed)
        .map((w) => (w.changed ? `<mark>${esc(w.t)}</mark>` : esc(w.t)))
        .join("")}</div></div>
        <div class="pvsec back"><small>Você escreveu</small><div>${esc(p.textPt)}</div></div>`;
      acts += `<button class="btn" id="fxOrig" type="button">Enviar original</button><button class="btn primary" id="fxSend" type="button">${icon("send", 14)} Enviar corrigido</button>`;
    }
    box.innerHTML = `<div class="pv" role="region" aria-label="Correção do texto">${body}<div class="pvact">${acts}</div></div>`;
    $("#fxCancel").onclick = () => closePreview(true);
    $("#fxEdit").onclick = () => {
      const t = p.fixed ?? p.textPt;
      closePreview(false);
      $("#text").value = t;
      S.fixedText = p.fixed; // editar o corrigido e enviar não passa pelo corretor de novo
      renderComposer();
    };
    if ($("#fxRetry")) $("#fxRetry").onclick = () => requestCorrection(p.textPt);
    if ($("#fxOrig")) $("#fxOrig").onclick = () => sendFixed(p.textPt);
    const primary = $("#fxSend") || (p.status === "error" ? $("#fxOrig") : null);
    if (primary) {
      if ($("#fxSend")) $("#fxSend").onclick = () => sendFixed(p.fixed);
      primary.focus();
    }
  }

  function submitComposer() {
    const text = $("#text").value;
    if (!text.trim() || !composerState().ok || !S.current || S.voice) return;
    if (S.voiceMode) {
      if (text.length > S.settings.maxTtsChars) return toast(`Texto longo demais para um áudio (máx. ${S.settings.maxTtsChars} caracteres).`, "err");
      if (!translating()) return generateVoice(text);
      if (S.preview) return S.preview.status === "ready" ? generateVoice(text) : undefined;
      return requestPreview(text); // confere a tradução antes de gastar com voz
    }
    if (S.preview?.kind === "fix") return S.preview.status === "ready" ? sendFixed(S.preview.fixed) : undefined;
    if (!translating() && S.settings.autoCorrect && text !== S.fixedText) return requestCorrection(text);
    if (!translating()) return sendText();
    if (S.preview) return S.preview.status === "ready" ? sendText() : undefined;
    if (!S.settings.requirePreview) return sendText({ skipPreview: true });
    requestPreview(text);
  }

  async function sendText({ skipPreview = false } = {}) {
    const ta = $("#text");
    const chatId = S.current.chatId;
    const tr = translating();
    const textPt = ta.value;
    const p = S.preview;
    if (tr && !skipPreview && p?.status !== "ready") return; // nunca envia sem tradução aprovada
    const text = tr ? (skipPreview ? "" : p.result.translated) : textPt;
    // bolha provisória até a confirmação do WhatsApp
    const temp = { id: `pending-${Date.now()}`, chatId, fromMe: true, ts: Date.now(), type: "text", text: text || "Traduzindo…", textPt: tr ? textPt : undefined, ack: 0, _pending: true, _new: true };
    S.messages.push(temp);
    S.preview = null;
    renderPreview();
    ta.readOnly = false;
    ta.value = "";
    ta.style.height = "auto";
    renderComposer();
    renderMessages({ toBottom: true });
    try {
      const msg = await call(C.OPS.SEND_TEXT, tr ? { chatId, text, textPt, skipPreview } : { chatId, text: textPt });
      const i = S.messages.indexOf(temp);
      if (i >= 0) {
        if (S.messages.some((m) => m.id === msg.id)) S.messages.splice(i, 1); // o evento chegou antes
        else S.messages[i] = msg;
      }
    } catch (e) {
      S.messages = S.messages.filter((m) => m !== temp);
      if (!ta.value) ta.value = textPt; // devolve o texto para não perder
      renderComposer();
      toast(`Não foi enviada: ${e.message}`, "err");
    }
    if (S.current?.chatId === chatId) renderMessages({ toBottom: true });
  }

  // ---- voz: gravar (vira texto), gerar com o Fish Audio, ouvir e enviar
  const A = globalThis.OrbitaAudio;
  const blobToB64 = (blob) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).slice(String(r.result).indexOf(",") + 1));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });

  function renderVoice(box) {
    const v = S.voice;
    let body;
    let acts = `<button class="btn" id="vcCancel" type="button">Cancelar</button>`;
    if (v.stage === "recording") {
      body = `<div class="rec"><span class="led"></span><span class="time" id="vcTime">0:00</span><div class="meter" id="vcMeter"></div><small>Fale em ${esc(langLabel(S.settings.myLang))}. Vira texto para você revisar.</small></div>`;
      acts = `<button class="btn" id="vcCancel" type="button">Descartar</button><button class="btn primary" id="vcStop" type="button">${icon("stop", 13)} Concluir</button>`;
    } else if (v.stage === "transcribing") body = `<div class="pvline">${icon("spinner", 14, 'class="spin"')} Transcrevendo sua fala…</div>`;
    else if (v.stage === "generating") body = `<div class="pvline">${icon("spinner", 14, 'class="spin"')} Gerando a voz${v.lang && v.lang !== S.settings.myLang ? ` em ${esc(langLabel(v.lang))}` : ""}…</div>`;
    else if (v.stage === "error") body = `<div class="pvline err">${icon("alert", 14)} <span>${esc(v.error)} <b>Nada foi enviado.</b></span></div>`;
    else if (v.stage === "ready") {
      body = `<div class="pvsec"><small>Ouça antes de enviar · ${fmtDur(v.duration)} · voz gerada por IA</small><audio controls src="${v.url}"></audio>
        <div class="pvtext">${waFormat(v.text)}</div></div>`;
      acts += `<button class="btn" id="vcRegen" type="button">Regenerar</button><button class="btn primary" id="vcSend" type="button">${icon("send", 14)} Enviar áudio</button>`;
    }
    box.innerHTML = `<div class="pv" role="region" aria-label="Áudio">${body}<div class="pvact">${acts}</div></div>`;
    $("#vcCancel").onclick = () => cancelVoice();
    if ($("#vcStop")) $("#vcStop").onclick = () => stopRecording();
    if ($("#vcRegen")) $("#vcRegen").onclick = () => generateVoice(v.textPt, true);
    if ($("#vcSend")) {
      $("#vcSend").onclick = () => sendVoice();
      $("#vcSend").focus();
    }
  }

  function setVoice(v) {
    if (S.voice?.url && S.voice.url !== v?.url) URL.revokeObjectURL(S.voice.url);
    S.voice = v;
    renderPreview();
    renderComposer();
  }

  function cancelVoice() {
    if (S.voice?.rec) S.voice.rec.cancel();
    clearInterval(S.voice?.timer);
    setVoice(null);
    $("#text").readOnly = false;
  }

  async function startRecording() {
    if (S.voice || !A) return;
    let rec;
    const v = { stage: "recording", levels: [], level: 0, start: Date.now() };
    try {
      rec = await A.startRecording((l) => (v.level = l));
    } catch (e) {
      return toast(`Não foi possível usar o microfone: ${e.name === "NotAllowedError" ? "permissão negada." : e.message}`, "err");
    }
    v.rec = rec;
    v.timer = setInterval(() => {
      v.levels.push(v.level);
      if (v.levels.length > 60) v.levels.shift();
      const t = $("#vcTime");
      if (!t) return;
      t.textContent = fmtDur((Date.now() - v.start) / 1000);
      $("#vcMeter").innerHTML = v.levels.map((l) => `<i style="height:${Math.max(8, Math.min(100, l * 160))}%"></i>`).join("");
      if (Date.now() - v.start > 120000) stopRecording(); // no máximo 2 min
    }, 100);
    setVoice(v);
  }

  async function stopRecording() {
    const v = S.voice;
    if (v?.stage !== "recording") return;
    clearInterval(v.timer);
    const blob = await v.rec.stop();
    setVoice({ stage: "transcribing" });
    try {
      const r = await call(C.OPS.TRANSCRIBE_DRAFT, { data: await blobToB64(blob), mime: blob.type });
      const ta = $("#text");
      ta.value = ta.value.trim() ? `${ta.value.trim()} ${r.text}` : r.text;
      ta.dispatchEvent(new Event("input"));
      S.voiceMode = true; // quem grava geralmente quer mandar áudio; dá para desligar no botão
      setVoice(null);
      ta.focus();
      toast("Revise o texto e envie. Ele vai como áudio com a sua voz gerada.");
    } catch (e) {
      setVoice({ stage: "error", error: e.message });
    }
  }

  async function generateVoice(textPt, fresh = false) {
    const chatId = S.current.chatId;
    S.preview = null;
    $("#text").readOnly = true;
    setVoice({ stage: "generating", textPt, lang: translating() ? C.contactLangOf(S.current, S.settings) : S.settings.myLang });
    try {
      const g = await call(C.OPS.VOICE_PREVIEW, { chatId, textPt, fresh });
      if (g.notice) toast(g.notice);
      // o Fish devolve MP3; aqui vira OGG/Opus, o formato da mensagem de voz do WhatsApp
      const mp3 = await C.getMedia(g.mp3Key);
      const ogg = await A.toOggOpus(mp3.blob);
      if (ogg.duration > g.maxVoiceSec) throw new Error(`O áudio ficou com ${fmtDur(ogg.duration)}, acima do limite de ${fmtDur(g.maxVoiceSec)}. Encurte o texto.`);
      await C.putMedia(`gen:${g.genId}`, ogg.blob, { text: g.text, chatId, duration: ogg.duration });
      if (S.current?.chatId !== chatId) return;
      setVoice({ stage: "ready", textPt, genId: g.genId, text: g.text, duration: ogg.duration, url: URL.createObjectURL(ogg.blob) });
    } catch (e) {
      if (S.current?.chatId !== chatId) return;
      setVoice({ stage: "error", textPt, error: e.message });
    }
  }

  async function sendVoice() {
    const v = S.voice;
    if (v?.stage !== "ready") return;
    const chatId = S.current.chatId;
    const ta = $("#text");
    const temp = { id: `pending-${Date.now()}`, chatId, fromMe: true, ts: Date.now(), type: "audio", text: "", textPt: translating() ? v.textPt : undefined, audio: { ptt: true, duration: v.duration, generated: true, transcript: v.text, transcriptStatus: "done" }, ack: 0, _pending: true, _new: true };
    S.messages.push(temp);
    setVoice(null);
    ta.readOnly = false;
    ta.value = "";
    S.voiceMode = false;
    renderComposer();
    renderMessages({ toBottom: true });
    try {
      const msg = await call(C.OPS.SEND_AUDIO, { chatId, genId: v.genId });
      const i = S.messages.indexOf(temp);
      if (i >= 0) {
        if (S.messages.some((m) => m.id === msg.id)) S.messages.splice(i, 1);
        else S.messages[i] = msg;
      }
    } catch (e) {
      S.messages = S.messages.filter((m) => m !== temp);
      ta.value = v.textPt;
      S.voiceMode = true;
      renderComposer();
      toast(`Áudio não enviado: ${e.message}`, "err");
    }
    if (S.current?.chatId === chatId) renderMessages({ toBottom: true });
  }

  // ---- respostas rápidas (as mesmas do WhatsApp Web, em js/qr-common.js)
  const Q = globalThis.OrbitaQR;
  const qr = { data: null, cat: "all", progress: null, pick: null };
  async function loadQuickReplies() {
    try {
      qr.data = await Q.load();
    } catch {
      qr.data = null;
    }
    renderQrBar();
  }
  chrome.storage.onChanged.addListener((ch, area) => area === "local" && Q.KEY in ch && loadQuickReplies());

  function qrItems(cat = qr.cat, query = "") {
    if (!qr.data) return [];
    let items = qr.data.items.filter((i) => i.steps.length);
    if (cat === "fav") items = items.filter((i) => i.favorite);
    else if (cat !== "all") items = items.filter((i) => i.categoryId === cat);
    const q = query.trim().toLowerCase().replace(/^\//, "");
    if (q) items = items.filter((i) => i.shortcut.startsWith(q) || i.title.toLowerCase().includes(q)).sort((a, b) => Number(b.shortcut.startsWith(q)) - Number(a.shortcut.startsWith(q)));
    else if (qr.data.settings.favoritesFirst) items = [...items].sort((a, b) => Number(b.favorite) - Number(a.favorite));
    return items;
  }
  const qrColor = (it) => qr.data?.categories.find((c) => c.id === it.categoryId)?.color || "#7c6cf0";
  const qrTextOnly = (it) => it.steps.every((s) => s.type === "text");
  const qrTypeIcons = (it) => [...new Set(it.steps.filter((s) => s.type !== "text").map((s) => (s.type === "audio" ? "mic" : s.type === "image" ? "image" : s.type === "video" ? "play" : "clip")))].map((k) => icon(k, 11)).join("");

  function renderQrBar() {
    const bar = $("#qrbar");
    if (!bar) return;
    if (qr.progress && qr.progress.chatId === S.current?.chatId) {
      const p = qr.progress;
      bar.innerHTML = `<div class="qrprog">${icon("spinner", 15, 'class="spin"')}<span><b>${esc(p.title)}</b> · ${Math.min(p.index + 1, p.total)}/${p.total} · ${esc(p.label || "")}</span>
        <i class="qrtrack"><i style="width:${Math.round(((p.index + 0.5) / p.total) * 100)}%"></i></i><button class="btn sm" data-qr="cancel">${icon("x", 12)} Cancelar</button></div>`;
      return;
    }
    if (!qr.data?.settings.enabled) return void (bar.innerHTML = "");
    const items = qrItems();
    const cats = [["all", "Todas"], ["fav", "Favoritas"], ...qr.data.categories.map((c) => [c.id, c.name])];
    bar.innerHTML = `<button class="qrz" data-qr="pick" title="Respostas rápidas (ou digite / no campo)" aria-label="Buscar resposta rápida">${icon("zap", 14)}</button>
      <select class="qrcat" aria-label="Categoria das respostas rápidas">${cats.map(([v, l]) => `<option value="${esc(v)}" ${qr.cat === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <div class="qrchips">${items.length ? items.map((it) => `<button class="qrchip" data-qr="send" data-id="${esc(it.id)}" style="--c:${esc(qrColor(it))}" title="${esc(it.title)}${it.shortcut ? ` · /${esc(it.shortcut)}` : ""}${qrTextOnly(it) ? " · Shift+clique põe no campo" : ""}"><span class="em">${it.emoji ? esc(it.emoji) : icon("zap", 11)}</span>${esc(it.title)}<span class="ti">${qrTypeIcons(it)}</span></button>`).join("") : `<button class="qrchip empty" data-qr="manage">${icon("zap", 11)} Criar respostas rápidas</button>`}</div>`;
    bar.querySelector(".qrcat").onchange = (e) => {
      qr.cat = e.target.value;
      renderQrBar();
    };
  }

  function onQrBarClick(e) {
    const b = e.target.closest("[data-qr]");
    if (!b) return;
    if (b.dataset.qr === "cancel") return call(C.OPS.QR_CANCEL, { chatId: S.current.chatId }).catch(() => {});
    if (b.dataset.qr === "manage") return EMBED ? ((expanded && setExpanded(false)), (parent.location.hash = "#/respostas-rapidas")) : chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html#/respostas-rapidas") });
    if (b.dataset.qr === "pick") return openQrPick("");
    const item = qr.data.items.find((i) => i.id === b.dataset.id);
    if (item) useQuickReply(item, { insert: e.shiftKey });
  }

  // Texto da resposta com as variáveis preenchidas (para colocar no campo).
  function qrInsert(item) {
    const c = S.current;
    const ctx = { name: c.client?.name || c.name || "", phone: c.phone || "", me: "" };
    const ta = $("#text");
    ta.value = item.steps.map((s) => Q.renderVars(s.text, ctx)).join("\n\n");
    ta.dispatchEvent(new Event("input"));
    ta.focus();
  }

  async function useQuickReply(item, { insert = false } = {}) {
    closeQrPick();
    if (!S.current || !composerState().ok) return toast(composerState().why || "Abra uma conversa.", "err");
    if (insert && qrTextOnly(item)) return qrInsert(item);
    if (qr.progress) return toast("Aguarde: uma resposta rápida ainda está sendo enviada.");
    const chatId = S.current.chatId;
    try {
      let approvalId;
      if (translating()) {
        // tradução ligada: prévia com os textos traduzidos antes de enviar
        const p = await call(C.OPS.QR_PREPARE, { chatId, itemId: item.id });
        if (!(await qrPreview(p))) return;
        approvalId = p.approvalId;
      } else if (qr.data.settings.confirmSend && !(await qrPreview({ title: item.title, steps: item.steps }))) return;
      await call(C.OPS.QR_RUN, { chatId, itemId: item.id, approvalId });
    } catch (e) {
      toast(`Resposta rápida não enviada: ${e.message}`, "err");
    }
  }

  function qrPreview(p) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "modal";
      const stepHtml = (s) => {
        if (s.type === "text") return `<div class="qrs"><div class="pvtext">${waFormat(s.text || "")}</div>${s.textPt && s.textPt !== s.text ? `<small>${esc(s.textPt)}</small>` : ""}</div>`;
        const label = { audio: s.ptt ? "Áudio de voz (vai como foi gravado, sem tradução)" : "Áudio", image: "Foto", video: "Vídeo", document: `Documento${s.name ? `: ${s.name}` : ""}`, sticker: "Figurinha", location: "Localização", contact: "Contato", poll: `Enquete: ${s.pollName || ""}` }[s.type] || "Mídia";
        return `<div class="qrs"><span class="qrk">${icon(s.type === "audio" ? "mic" : "clip", 13)} ${esc(label)}</span>${s.caption ? `<div class="pvtext">${waFormat(s.caption)}</div>${s.captionPt && s.captionPt !== s.caption ? `<small>${esc(s.captionPt)}</small>` : ""}` : ""}</div>`;
      };
      wrap.innerHTML = `<div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="qrpt"><div class="dz">${icon("zap", 22)}</div>
        <h2 id="qrpt">${esc(p.title)}</h2><p class="muted">${p.toName ? `Vai ser enviada em ${esc(langLabel(p.to))}. Abaixo de cada texto, o original.` : "Confira antes de enviar."}</p>
        <div class="qrsteps">${p.steps.map(stepHtml).join("")}</div>
        <div class="pvact"><button class="btn" data-a="no">Cancelar</button><button class="btn primary" data-a="yes">${icon("send", 14)} Enviar</button></div></div>`;
      document.body.append(wrap);
      wrap.querySelector('[data-a="yes"]').focus();
      const close = (ok) => (wrap.remove(), resolve(ok));
      wrap.addEventListener("click", (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a) close(a === "yes");
        else if (e.target === wrap) close(false);
      });
      wrap.addEventListener("keydown", (e) => e.key === "Escape" && (e.stopPropagation(), close(false)));
    });
  }

  function onQrProgress(p) {
    if (p.done) {
      if (p.chatId === qr.progress?.chatId || !qr.progress) qr.progress = null;
      if (p.error) toast(`Falha na resposta “${p.title}” (${p.sent} de ${p.total} enviadas): ${p.error}`, "err");
      else if (p.canceled) toast(`Envio cancelado (${p.sent} de ${p.total} enviadas).`);
      else toast(`“${p.title}” enviada.`, "ok");
    } else qr.progress = p;
    renderQrBar();
  }

  // ---- seletor: "/" no campo ou o botão ⚡
  function qrSlash(value) {
    if (!qr.data?.settings.slash) return;
    const m = value.match(/^\/(\S*)$/);
    if (m) openQrPick(m[1], true);
    else if (qr.pick?.slash) closeQrPick();
  }

  function openQrPick(query, slash = false) {
    qr.pick = { query, slash, active: qr.pick?.query === query ? qr.pick.active : 0, results: qrItems("all", query) };
    let box = $("#qrpick");
    if (!box) {
      box = document.createElement("div");
      box.id = "qrpick";
      box.className = "qrpick";
      $("#thread").append(box);
      box.addEventListener("mousedown", (e) => e.preventDefault()); // não tira o foco do campo
      box.addEventListener("click", (e) => {
        const row = e.target.closest("[data-i]");
        if (row) pickChoose(Number(row.dataset.i), e.shiftKey);
      });
    }
    const r = qr.pick.results;
    qr.pick.active = Math.min(qr.pick.active, Math.max(0, r.length - 1));
    box.innerHTML = `<div class="qph">${icon("zap", 13)} Respostas rápidas <small>↑↓ escolher · Enter enviar · Shift+Enter pôr no campo · Esc fechar</small></div>
      ${r.length ? r.slice(0, 40).map((it, i) => `<div class="qprow ${i === qr.pick.active ? "on" : ""}" data-i="${i}" style="--c:${esc(qrColor(it))}"><span class="em">${it.emoji ? esc(it.emoji) : icon("zap", 12)}</span><span class="qpt"><b>${esc(it.title)}</b>${it.shortcut ? ` <code>/${esc(it.shortcut)}</code>` : ""}<small>${esc(it.steps.map(Q.stepSummary).join(" · ").slice(0, 110))}</small></span><span class="ti">${qrTypeIcons(it)}</span></div>`).join("") : `<div class="qpempty">Nenhuma resposta rápida${query ? ` para “/${esc(query)}”` : ""}.</div>`}`;
    box.querySelector(".qprow.on")?.scrollIntoView({ block: "nearest" });
    if (!slash) $("#text").focus();
  }

  function closeQrPick() {
    qr.pick = null;
    $("#qrpick")?.remove();
  }

  function pickChoose(i, insert) {
    const it = qr.pick?.results[i];
    if (!it) return;
    const wasSlash = qr.pick.slash;
    closeQrPick();
    if (wasSlash) {
      $("#text").value = "";
      $("#text").dispatchEvent(new Event("input"));
    }
    useQuickReply(it, { insert });
  }

  function qrPickKeys(e) {
    if (!qr.pick) return false;
    const n = qr.pick.results.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      qr.pick.active = (qr.pick.active + (e.key === "ArrowDown" ? 1 : -1) + n) % Math.max(1, n);
      openQrPick(qr.pick.query, qr.pick.slash);
    } else if ((e.key === "Enter" || e.key === "Tab") && n) pickChoose(qr.pick.active, e.shiftKey);
    else if (e.key === "Escape") closeQrPick();
    else return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  // ---- aviso de privacidade (primeira vez que a tradução é ligada)
  function privacyDialog(what = "tradução") {
    const fix = what === "corretor";
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "modal";
      wrap.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="pvTitle">
        <div class="dz">${icon("shield", 22)}</div><h2 id="pvTitle">${fix ? "Antes de ligar o corretor" : "Antes de ligar a tradução"}</h2>
        <ul><li>${fix ? "O texto que você escreve é enviado ao <b>provedor de IA configurado nas Opções</b> para ser corrigido, antes de ir ao contato." : "O texto das mensagens desta conversa (e algumas mensagens anteriores, como contexto) é enviado ao <b>provedor de IA configurado nas Opções</b> para ser traduzido."}</li>
        <li>Nada é enviado ao contato sem você revisar e clicar em Enviar.</li>
        <li>As traduções ficam salvas só neste computador. A chave da IA não entra no backup.</li>
        <li>Use com clientes que concordaram em ser atendidos por você (LGPD).</li></ul>
        <div class="pvact"><button class="btn" data-a="no">Agora não</button><button class="btn primary" data-a="yes">Entendi, ligar ${fix ? "o corretor" : "tradução"}</button></div></div>`;
      document.body.append(wrap);
      wrap.querySelector('[data-a="yes"]').focus();
      wrap.addEventListener("click", (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (!a) return;
        wrap.remove();
        resolve(a === "yes");
      });
    });
  }

  async function setTranslation(patch) {
    const chatId = S.current.chatId;
    if (patch.enabled && !S.settings.privacyAccepted) {
      if (!(await privacyDialog())) return renderHeader();
      S.settings = await C.saveSettings({ privacyAccepted: true });
    }
    try {
      const chat = await call(C.OPS.SET_TRANSLATION, { chatId, ...patch });
      if (S.current?.chatId !== chatId) return;
      S.current = { ...S.current, ...chat };
      if (!chat.translation.enabled && S.preview) closePreview(false);
    } catch (e) {
      toast(e.message, "err");
    }
    renderHeader();
    renderComposer();
    renderMessages({ keepScroll: true });
  }

  // ------------------------------------------------------- painel do cliente
  // Resumo do CRM editável: nome, etapa, tags, notas, IA e alerta. As gravações
  // seguem o formato do CRM do painel (js/crm-edit.js).
  const CRM = globalThis.OrbitaCrm;
  const fmtWhen = (ts) => new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  let side = { phone: null, data: null, editingName: false };

  async function renderSide() {
    const box = $("#side");
    const c = S.current;
    if (!c || !S.sideOpen) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const phone = c.client?.phone || c.phone || null;
    let d = null;
    let err = null;
    if (phone) {
      try {
        d = await CRM.load(phone);
      } catch (e) {
        err = e.message;
      }
    }
    if (S.current?.chatId !== c.chatId) return;
    side = { ...side, phone, data: d };
    const stage = d?.stages.find((s) => s.id === d.stageId);
    const name = d?.name || displayName(c);
    let body = "";
    if (!phone) body = `<div class="sec"><span class="muted">O WhatsApp não mostra o número deste contato, então não dá para ligá-lo ao CRM.</span></div>`;
    else if (err) body = `<div class="sec"><span class="muted">${esc(err)}</span></div>`;
    else if (!d.inLists)
      body = `<div class="sec card"><h3>Fora do CRM</h3><span class="muted">Adicione para usar etapa, tags e notas. Entra na lista “${esc(CRM.WHATSAPP_LIST)}”.</span>
        <input class="in" id="crmNewName" value="${esc(name)}" placeholder="Nome do cliente" aria-label="Nome do cliente">
        <button class="btn primary" data-crm="add">${icon("check", 14)} Adicionar ao CRM</button></div>`;
    else if (!d.modules.crm) body = `<div class="sec"><span class="muted">Ative o módulo CRM nas Opções da extensão para editar etapa, tags e notas por aqui.</span></div>`;
    else {
      const notes = d.history.filter((h) => h.kind === "note");
      body = `${d.attention ? `<div class="sec alert"><b>${icon("alert", 13)} Precisa de atenção</b><span>${esc(d.attention.reason || "")}</span><button class="btn" data-crm="resolve">Resolvido</button></div>` : ""}
        <div class="sec"><h3>Etapa do funil</h3><div class="stagesel"><i style="background:${esc(stage?.color || "#999")}"></i>
          <select id="crmStage" aria-label="Etapa do funil">${d.stages.map((s) => `<option value="${esc(s.id)}" ${s.id === d.stageId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div></div>
        <div class="sec"><h3>Tags</h3><div class="tags edit">${d.tags.map((t) => `<span>${esc(t)}<button data-crm="untag" data-tag="${esc(t)}" aria-label="Remover tag ${esc(t)}">${icon("x", 11)}</button></span>`).join("") || `<span class="muted">Sem tags</span>`}</div>
          <input class="in" id="crmTag" list="crmTags" placeholder="Adicionar tag e Enter" aria-label="Adicionar tag"><datalist id="crmTags">${d.knownTags.filter((t) => !d.tags.some((x) => x.toLowerCase() === t.toLowerCase())).map((t) => `<option value="${esc(t)}">`).join("")}</datalist></div>
        <div class="sec"><h3>Ficha do lead</h3><div id="leadForm"></div></div>
        <div class="sec"><label class="swrow2"><span><b>IA responde este cliente</b><small>${d.autoReply ? "Ligada: se você responder, ela desliga sozinha." : "Desligada."}</small></span><input type="checkbox" id="crmAuto" ${d.autoReply ? "checked" : ""}></label></div>
        <div class="sec"><h3>Notas</h3><textarea class="in" id="crmNote" rows="2" placeholder="Nova nota sobre o cliente…"></textarea>
          <button class="btn" data-crm="note">${icon("check", 14)} Adicionar nota</button>
          ${notes.slice(0, 20).map((n) => `<div class="note"><small>${esc(fmtWhen(n.ts))}<button class="link del" data-crm="delnote" data-id="${esc(n.id)}" aria-label="Excluir nota">excluir</button></small>${esc(n.text)}</div>`).join("") || `<span class="muted">Nenhuma nota</span>`}</div>
        ${d.modules.agenda ? `<div class="sec"><h3>Próximos compromissos</h3>${d.appointments.length ? d.appointments.map((a) => `<div class="appt"><b>${esc(a.title || "Compromisso")}</b><small>${esc(fmtWhen(a.start))}</small></div>`).join("") : `<span class="muted">Nenhum</span>`}</div>` : ""}
        <details class="sec hist"><summary>Histórico (${d.history.length})</summary>${d.history.slice(0, 15).map((h) => `<div class="note"><small>${esc(fmtWhen(h.ts))} · ${h.kind === "stage" ? "etapa" : h.kind === "note" ? "nota" : esc(h.kind)}</small>${esc(h.text)}</div>`).join("") || `<span class="muted">Vazio</span>`}</details>
        <button class="btn" data-crm="open">${icon("external", 14)} Abrir no CRM</button>`;
    }
    const nameHtml = side.editingName
      ? `<div class="namerow"><input class="in" id="crmName" value="${esc(name)}" aria-label="Nome do cliente"><button class="ibtn" data-crm="savename" aria-label="Salvar nome">${icon("check", 16)}</button></div>`
      : `<b>${esc(name)}${d?.inLists ? ` <button class="ibtn inline" data-crm="editname" aria-label="Editar nome" title="Editar nome">${icon("pencil", 13)}</button>` : ""}</b>`;
    box.innerHTML = `<div class="top">${avatar(c, stage)}${nameHtml}<small>${esc(C.formatPhone(c.phone) || "")}</small>
      ${c.pushname && c.pushname !== name ? `<small style="display:block">~${esc(c.pushname)}</small>` : ""}
      ${d?.lists?.length ? `<small style="display:block">Listas: ${esc(d.lists.join(", "))}</small>` : ""}</div>${body}`;
    if ($("#leadForm")) globalThis.OrbitaLead?.mount($("#leadForm"), phone, { identity: false }); // nome e número já estão no topo
    if (side.editingName) $("#crmName")?.focus();
  }

  // Executa uma edição do CRM e atualiza o chat (vínculo, cor da etapa) e o painel.
  async function crmDo(fn, ok) {
    const chatId = S.current?.chatId;
    try {
      await fn(side.phone);
      const chat = await call(C.OPS.CRM_CHANGED, { chatId });
      if (S.current?.chatId === chatId && chat) S.current = { ...S.current, ...chat };
      await loadStages().catch(() => {});
      renderHeader();
      if (ok) toast(ok);
    } catch (e) {
      toast(e.message, "err");
    }
    await renderSide();
  }

  $("#side").addEventListener("click", (e) => {
    const b = e.target.closest("[data-crm]");
    if (!b || !side.phone) return;
    const d = side.data;
    switch (b.dataset.crm) {
      case "add":
        return crmDo((p) => CRM.addToCrm(p, $("#crmNewName").value || displayName(S.current)), "Adicionado ao CRM.");
      case "editname":
        side.editingName = true;
        return renderSide();
      case "savename":
        side.editingName = false;
        return crmDo((p) => CRM.rename(p, $("#crmName").value), "Nome atualizado.");
      case "untag":
        return crmDo((p) => CRM.setTags(p, d.tags.filter((t) => t !== b.dataset.tag)));
      case "note": {
        const text = $("#crmNote").value;
        if (!text.trim()) return $("#crmNote").focus();
        return crmDo((p) => CRM.addNote(p, text), "Nota adicionada.");
      }
      case "delnote":
        if (!confirm("Excluir esta nota?")) return;
        return crmDo((p) => CRM.removeHistory(p, b.dataset.id));
      case "resolve":
        return crmDo((p) => CRM.clearAttention(p));
      case "open": {
        const url = `#/crm?phone=${encodeURIComponent(side.phone)}`;
        if (EMBED) {
          if (expanded) setExpanded(false);
          parent.location.hash = url;
        } else location.href = `dashboard.html${url}`;
      }
    }
  });
  $("#side").addEventListener("change", (e) => {
    if (!side.phone) return;
    if (e.target.id === "crmStage") crmDo((p) => CRM.setStage(p, e.target.value), "Etapa atualizada.");
    if (e.target.id === "crmAuto") crmDo((p) => CRM.setAutoReply(p, e.target.checked));
  });
  $("#side").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "crmTag" && e.target.value.trim()) {
      e.preventDefault();
      const t = e.target.value;
      crmDo((p) => CRM.setTags(p, [...side.data.tags, t]));
    } else if (e.key === "Enter" && e.target.id === "crmName") {
      e.preventDefault();
      side.editingName = false;
      crmDo((p) => CRM.rename(p, e.target.value), "Nome atualizado.");
    } else if (e.key === "Escape" && side.editingName) {
      e.stopPropagation();
      side.editingName = false;
      renderSide();
    }
  });
  // alterações feitas no CRM do painel aparecem aqui na hora
  try {
    new BroadcastChannel("orbita-data").onmessage = (ev) => {
      if (ev.data?.page && ev.data.page === globalThis.OrbitaLead?.pageId) return; // a ficha do lead já se atualizou
      if (["crm", "lists"].includes(ev.data?.topic) && S.current && S.sideOpen && !side.editingName && !document.activeElement?.closest?.("#side")) renderSide();
    };
  } catch {}

  // ------------------------------------------------------------ ao vivo
  let port = null;
  function connect() {
    port = chrome.runtime.connect({ name: C.PORT_UI });
    port.onMessage.addListener(onEvent);
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(() => {
        connect();
        if (S.current) port?.postMessage({ kind: "focus", chatId: S.current.chatId });
        loadChats().catch(() => {});
      }, 1000);
    });
  }

  let listTimer = null;
  const scheduleList = () => {
    clearTimeout(listTimer);
    listTimer = setTimeout(() => loadChats().catch(() => {}), 150);
  };

  function onEvent({ event, data }) {
    switch (event) {
      case C.EVENTS.QR_PROGRESS:
        return onQrProgress(data);
      case C.EVENTS.STATUS_CHANGED:
        S.status = data;
        renderStatus();
        renderComposer();
        if (data.ready) scheduleList();
        return;
      case C.EVENTS.CHAT_UPDATED:
        if (data.all || !data.chat) return scheduleList();
        {
          const i = S.chats.findIndex((c) => c.chatId === data.chat.chatId);
          if (i >= 0) S.chats.splice(i, 1);
          S.chats.unshift(data.chat);
          S.chats.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
          if (S.current?.chatId === data.chat.chatId) {
            const trChanged = JSON.stringify(S.current.translation) !== JSON.stringify(data.chat.translation);
            S.current = { ...S.current, ...data.chat };
            if (trChanged) {
              renderHeader();
              renderComposer();
            }
            if (data.chat.unreadCount) call(C.OPS.MARK_READ, { chatId: data.chat.chatId }).catch(() => {});
          }
          renderList();
        }
        return;
      case C.EVENTS.MESSAGE_DELETED:
        if (S.current?.chatId === data.chatId) {
          S.messages = S.messages.filter((x) => x.id !== data.id);
          renderMessages({ keepScroll: true });
        }
        return;
      case C.EVENTS.MESSAGE_NEW:
      case C.EVENTS.MESSAGE_UPDATED: {
        const m = data.message;
        if (!S.current || m.chatId !== S.current.chatId) return;
        const i = S.messages.findIndex((x) => x.id === m.id);
        if (i >= 0) S.messages[i] = m;
        else {
          // uma bolha provisória com o mesmo texto é substituída
          const p = S.messages.findIndex((x) => x._pending && m.fromMe && x.text === m.text);
          if (p >= 0) S.messages[p] = m;
          else {
            const wasBottom = nearBottom();
            S.messages.push({ ...m, _new: true });
            S.messages.sort((a, b) => a.ts - b.ts);
            if (!wasBottom && !m.fromMe) {
              S.unseenBelow++;
              updateJump();
            }
            return renderMessages({ toBottom: wasBottom, keepScroll: !wasBottom });
          }
        }
        return renderMessages({ keepScroll: true });
      }
    }
  }

  // ------------------------------------------------------------- anexos
  // Igual ao WhatsApp: cole um print (Ctrl+V), arraste arquivos para a conversa
  // ou use o clipe. Abre uma prévia com legenda; Enter envia. Os arquivos vão
  // para o cache de mídia ("up:<id>") e o service worker os manda em pedaços
  // para a aba do WhatsApp (OPS.SEND_FILE).
  const ATTACH_MAX = 100 * 1024 * 1024;
  const fmtBytes = (n) => globalThis.OrbitaQR?.formatBytes?.(n) ?? `${Math.max(1, Math.round(n / 1024))} KB`;
  const ATTACH_LABEL = { image: "Foto", video: "Vídeo", audio: "Áudio", document: "Documento" };

  function attachType(file) {
    const t = (file.type || "").toLowerCase();
    if (/^image\/(jpeg|png|webp)$/.test(t)) return "image";
    if (/^video\/(mp4|3gpp|quicktime)$/.test(t)) return "video";
    if (/^audio\//.test(t)) return "audio";
    return "document";
  }

  // prints colados chegam como "image.png": dá um nome com data e hora
  function attachName(file) {
    if (file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file.name;
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    return `print-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
  }

  // miniatura JPEG (base64), para o balão aparecer na hora
  async function imageThumb(file) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 96 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(bmp.width * k));
      cv.height = Math.max(1, Math.round(bmp.height * k));
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      const r = { thumb: cv.toDataURL("image/jpeg", 0.7).split(",")[1], width: bmp.width, height: bmp.height };
      bmp.close?.();
      return r;
    } catch {
      return {};
    }
  }

  async function addAttachments(files) {
    files = [...files].filter((f) => f && f.size >= 0);
    if (!files.length || !S.current) return;
    if (!composerState().ok) return toast(composerState().why, "err");
    if (S.voice) return toast("Termine ou cancele o áudio antes de anexar.", "err");
    S.attach ||= { items: [], sel: 0, caption: "", approved: null, sending: false, progress: "" };
    const a = S.attach;
    for (const f of files) {
      if (f.size > ATTACH_MAX) {
        toast(`${f.name || "Arquivo"} é grande demais (${fmtBytes(f.size)}). O limite aqui é 100 MB.`, "err");
        continue;
      }
      if (!f.size) {
        toast(`${f.name || "Arquivo"} está vazio.`, "err");
        continue;
      }
      const type = attachType(f);
      const item = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, file: f, name: attachName(f), type, size: f.size, url: URL.createObjectURL(f) };
      if (type === "image") Object.assign(item, await imageThumb(f));
      if (S.attach !== a) return URL.revokeObjectURL(item.url); // fechou enquanto preparava
      a.items.push(item);
      a.sel = a.items.length - 1;
    }
    if (!a.items.length) return closeAttach();
    renderAttach();
    $("#attachCaption")?.focus();
  }

  function closeAttach() {
    for (const i of S.attach?.items || []) URL.revokeObjectURL(i.url);
    S.attach = null;
    const box = $("#attach");
    if (box) box.innerHTML = "";
  }

  function renderAttach() {
    const box = $("#attach");
    const a = S.attach;
    if (!box) return;
    if (!a) return void (box.innerHTML = "");
    a.sel = Math.min(a.sel, a.items.length - 1);
    const cur = a.items[a.sel];
    const big =
      cur.type === "image"
        ? `<img src="${cur.url}" alt="${esc(cur.name)}">`
        : cur.type === "video"
          ? `<video src="${cur.url}" controls playsinline></video>`
          : cur.type === "audio"
            ? `<div class="afile">${icon("speaker", 40)}<b>${esc(cur.name)}</b><small>${esc(fmtBytes(cur.size))}</small><audio src="${cur.url}" controls></audio></div>`
            : `<div class="afile"><span class="dico big">${esc((cur.name.split(".").pop() || "arq").slice(0, 4).toUpperCase())}</span><b>${esc(cur.name)}</b><small>${esc(fmtBytes(cur.size))}</small></div>`;
    const hasCaptionTarget = a.items.some((i) => i.type !== "audio");
    const tr = translating() && a.caption.trim() && hasCaptionTarget;
    const ok = a.approved && a.approved.textPt === a.caption.trim();
    const sendLabel = tr && S.settings.requirePreview && !ok ? "Ver tradução" : "Enviar";
    const enter = !box.firstElementChild; // a animação de entrada só na abertura
    box.innerHTML = `<div class="attach ${enter ? "enter" : ""}" role="dialog" aria-label="Enviar anexos">
      <div class="ahead"><button class="ibtn" data-at="close" aria-label="Cancelar anexos" ${a.sending ? "disabled" : ""}>${icon("x", 18)}</button>
        <b>${a.items.length === 1 ? esc(cur.name) : `${a.items.length} arquivos`}</b><small>${esc(ATTACH_LABEL[cur.type])} · ${esc(fmtBytes(cur.size))}</small></div>
      <div class="astage">${big}</div>
      ${
        hasCaptionTarget
          ? `<div class="acap"><input class="in" id="attachCaption" maxlength="1024" placeholder="${tr || translating() ? `Legenda em ${esc(langLabel(S.settings.myLang))} (vai traduzida)` : "Adicione uma legenda…"}" value="${esc(a.caption)}" ${a.sending ? "disabled" : ""}>
             ${ok && tr ? `<div class="atr"><small>Vai assim (${esc(a.approved.toName || "")}):</small> ${esc(a.approved.translated)}</div>` : ""}
             ${a.items.length > 1 ? `<small class="muted">A legenda vai com o primeiro arquivo${a.items[0].type === "audio" ? " que não é áudio" : ""}.</small>` : ""}</div>`
          : ""
      }
      <div class="afoot"><div class="astrip">${a.items
        .map(
          (i, n) => `<div class="athumb ${n === a.sel ? "sel" : ""}"><button data-at="sel" data-n="${n}" aria-label="Ver ${esc(i.name)}" title="${esc(i.name)}">${i.type === "image" ? `<img src="${i.url}" alt="">` : icon(i.type === "video" ? "play" : i.type === "audio" ? "speaker" : "file", 20)}</button>
            ${a.sending ? "" : `<button class="arm" data-at="rm" data-n="${n}" aria-label="Remover ${esc(i.name)}">${icon("x", 11)}</button>`}</div>`,
        )
        .join("")}
        ${a.sending ? "" : `<button class="athumb add" data-at="add" aria-label="Adicionar arquivos" title="Adicionar arquivos">${icon("plus", 20)}</button>`}</div>
        ${a.sending ? `<span class="aprog">${icon("spinner", 14, 'class="spin"')} ${esc(a.progress)}</span>` : ""}
        <button class="send" data-at="send" aria-label="${sendLabel}" title="${sendLabel} (Enter)" ${a.sending ? "disabled" : ""}>${icon("send", 18)}</button></div></div>`;
  }

  async function sendAttachments() {
    const a = S.attach;
    if (!a || a.sending || !a.items.length) return;
    const chatId = S.current.chatId;
    const captionPt = a.caption.trim();
    const captionAt = a.items.findIndex((i) => i.type !== "audio");
    const extra = {};
    if (captionPt && captionAt >= 0) {
      if (!translating()) extra.caption = captionPt;
      else if (!S.settings.requirePreview) Object.assign(extra, { captionPt, skipPreview: true });
      else if (a.approved?.textPt === captionPt) Object.assign(extra, { caption: a.approved.translated, captionPt });
      else {
        a.sending = true;
        a.progress = "Traduzindo a legenda…";
        renderAttach();
        try {
          a.approved = await call(C.OPS.TRANSLATE_PREVIEW, { chatId, textPt: captionPt });
        } catch (e) {
          toast(e.message, "err");
        }
        if (S.attach !== a) return;
        a.sending = false;
        renderAttach();
        return $("#attachCaption")?.focus();
      }
    }
    a.sending = true;
    const total = a.items.length;
    let n = 0;
    try {
      while (a.items.length) {
        const it = a.items[0];
        n++;
        a.sel = 0;
        a.progress = total > 1 ? `Enviando ${n} de ${total}…` : "Enviando…";
        renderAttach();
        const uploadId = it.id;
        await C.putMedia(`up:${uploadId}`, it.file, { chatId });
        await call(C.OPS.SEND_FILE, { chatId, uploadId, type: it.type, filename: it.name, thumb: it.thumb, width: it.width, height: it.height, ...(n - 1 === captionAt ? extra : {}) });
        URL.revokeObjectURL(it.url);
        a.items.shift();
        if (n - 1 === captionAt) {
          a.caption = "";
          a.approved = null;
        }
      }
      if (S.attach === a) closeAttach();
      $("#text")?.focus();
    } catch (e) {
      toast(e.message, "err");
      if (S.attach !== a) return;
      a.sending = false;
      renderAttach();
    }
  }

  function bindAttach() {
    const fileIn = $("#fileIn");
    $("#attachBtn").addEventListener("click", () => fileIn.click());
    fileIn.addEventListener("change", () => {
      addAttachments(fileIn.files);
      fileIn.value = "";
    });
    const box = $("#attach");
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-at]");
      if (!b || !S.attach) return;
      const a = S.attach;
      switch (b.dataset.at) {
        case "close":
          return closeAttach();
        case "add":
          return fileIn.click();
        case "sel":
          a.sel = Number(b.dataset.n);
          return renderAttach();
        case "rm":
          URL.revokeObjectURL(a.items[Number(b.dataset.n)]?.url);
          a.items.splice(Number(b.dataset.n), 1);
          return a.items.length ? renderAttach() : closeAttach();
        case "send":
          return sendAttachments();
      }
    });
    box.addEventListener("input", (e) => {
      if (e.target.id !== "attachCaption" || !S.attach) return;
      const hadApproval = Boolean(S.attach.approved);
      S.attach.caption = e.target.value;
      if (hadApproval && S.attach.approved.textPt !== S.attach.caption.trim()) {
        S.attach.approved = null; // a legenda mudou: a tradução vista não vale mais
        const pos = e.target.selectionStart;
        renderAttach();
        const inp = $("#attachCaption");
        inp.focus();
        inp.setSelectionRange(pos, pos);
      }
    });
    box.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.target.id === "attachCaption") {
        e.preventDefault();
        sendAttachments();
      }
    });
    // arrastar arquivos para a conversa
    const thread = $("#thread");
    const zone = $("#dropzone");
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    thread.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      zone.hidden = !composerState().ok;
    });
    thread.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = composerState().ok ? "copy" : "none";
    });
    thread.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      if (--depth <= 0) (depth = 0), (zone.hidden = true);
    });
    thread.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      zone.hidden = true;
      if (!S.attach?.sending) addAttachments(e.dataTransfer.files);
    });
  }

  // colar print ou arquivo (Ctrl+V) em qualquer lugar da conversa aberta
  document.addEventListener("paste", (e) => {
    if (!S.current || !$("#composer") || e.target.closest?.("#side, .trpop, dialog")) return;
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
    if (!files.length || S.attach?.sending) return;
    e.preventDefault();
    addAttachments(files);
  });

  // Esc fecha o popover de tradução ou a prévia (registrado uma vez só)
  document.addEventListener("keydown", (e) => {
    if (viewer.open) {
      if (e.key === "Escape") closeViewer();
      else if (e.key === "ArrowLeft") nav(-1);
      else if (e.key === "ArrowRight") nav(1);
      else return;
      e.preventDefault();
      return;
    }
    if (e.key !== "Escape") return;
    if (S.attach) {
      if (!S.attach.sending) closeAttach();
    } else if (S.current && S.trOpen) {
      S.trOpen = false;
      renderHeader();
    } else if (S.current && S.preview) closePreview(false);
    else if (expanded) setExpanded(false);
  });

  // ----------------------------------------------------------------- início
  // módulo desligado em Opções → Módulos
  chrome.storage.onChanged.addListener((ch, area) => {
    const c = area === "local" && ch["orbita:modules"];
    if (c && (c.oldValue?.conversas !== false) !== (c.newValue?.conversas !== false)) location.reload();
  });

  (async () => {
    if (!(await C.moduleEnabled())) {
      app.innerHTML = `<div class="app off"><div class="welcome"><div><div class="z">${icon("chat", 30)}</div><b>As Conversas estão desligadas</b>
        Ligue em <a href="#" id="openOpts">Opções da extensão → Módulos</a> para ver e responder seus contatos por aqui.</div></div></div>`;
      $("#openOpts").onclick = (e) => (e.preventDefault(), chrome.runtime.openOptionsPage());
      return;
    }
    welcome();
    connect();
    S.settings = await C.loadSettings();
    await loadQuickReplies();
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && C.SETTINGS_KEY in ch) C.loadSettings().then((st) => ((S.settings = st), renderHeader(), renderComposer()));
    });
    await loadStages().catch(() => {});
    try {
      S.status = await call(C.OPS.STATUS);
    } catch {}
    renderStatus();
    await loadChats().catch((e) => toast(e.message, "err"));
    const want = params.get("chat") || (params.get("phone") && S.chats.find((c) => C.phoneVariants(params.get("phone")).includes(c.phone))?.chatId);
    if (want) openChat(want);
  })();
})();
