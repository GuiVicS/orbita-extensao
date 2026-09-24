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
    languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
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
  const avatar = (c, stage) => `<span class="av" style="background:${avatarColor(c.chatId)}">${esc(initials(displayName(c)))}${stage ? `<i class="stage" style="background:${esc(stage.color)}" title="${esc(stage.name)}"></i>` : ""}</span>`;
  function tick(m) {
    if (!m.fromMe) return "";
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

  function renderList() {
    const items = $("#items");
    const list = filteredChats();
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

  function bubbleHtml(m, prev) {
    let head = "";
    if (!prev || dayKey(prev.ts) !== dayKey(m.ts)) head += `<div class="day">${esc(dayLabel(m.ts))}</div>`;
    const first = !prev || prev.fromMe !== m.fromMe || head;
    const meta = `<span class="meta">${m.edited ? "editada · " : ""}${esc(timeFmt.format(new Date(m.ts)))}${tick(m)}</span>`;
    let body;
    if (m.revoked) body = `${icon("ban", 14, 'style="display:inline;vertical-align:-2px"')} Mensagem apagada${m.text ? `<span class="cap" style="opacity:.7">“${esc(m.text)}”</span>` : ""}`;
    else if (m.type === "audio") body = audioBlock(m);
    else if (m.type === "other") body = `<span class="kind">${icon("clip", 14)} ${esc(m.label || "Mídia")}${m.filename ? `: ${esc(m.filename)}` : ""}</span>${m.text ? `<span class="cap">${textBlock(m)}</span>` : ""}`;
    else body = textBlock(m);
    const cls = ["b", m.fromMe ? "me" : "", first ? "first" : "", m.revoked ? "revoked" : "", m._pending ? "pending" : "", m._new ? "new" : ""].filter(Boolean).join(" ");
    return `${head}<div class="${cls}" data-id="${esc(m.id)}">${body}${meta}</div>`;
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
    if (S.voice) cancelVoice();
    S.voiceMode = false;
    S.messages = [];
    S.complete = false;
    S.unseenBelow = 0;
    renderList();
    $("#thread").innerHTML = `<div class="thead" id="thead"></div><div id="notice"></div>
      <div class="msgs" id="msgs" role="log" aria-live="polite" aria-label="Mensagens"><div class="older">${icon("spinner", 14, 'class="spin"')} Carregando…</div></div>
      <button class="jump" id="jump" hidden aria-label="Ir para a última mensagem">${icon("down", 20)}</button>
      <div id="preview"></div>
      <form class="composer" id="composer">
        <button class="cbtn" id="micBtn" type="button" aria-label="Gravar em ${esc(langLabel(S.settings?.myLang || "pt"))} (vira texto para revisar)" title="Gravar sua fala: vira texto para você revisar">${icon("mic", 18)}</button>
        <button class="cbtn" id="voiceBtn" type="button" aria-pressed="false" aria-label="Enviar como áudio com voz gerada" title="Enviar como áudio (voz gerada pelo Fish Audio)">${icon("speaker", 18)}</button>
        <label class="sr" for="text">Mensagem</label><textarea id="text" rows="1"></textarea>
        <button class="send" id="sendBtn" type="submit" aria-label="Enviar mensagem" disabled>${icon("send", 18)}</button></form>`;
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
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        $("#composer").requestSubmit();
      }
    });
    $("#micBtn").addEventListener("click", () => startRecording());
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

  function submitComposer() {
    const text = $("#text").value;
    if (!text.trim() || !composerState().ok || !S.current || S.voice) return;
    if (S.voiceMode) {
      if (text.length > S.settings.maxTtsChars) return toast(`Texto longo demais para um áudio (máx. ${S.settings.maxTtsChars} caracteres).`, "err");
      if (!translating()) return generateVoice(text);
      if (S.preview) return S.preview.status === "ready" ? generateVoice(text) : undefined;
      return requestPreview(text); // confere a tradução antes de gastar com voz
    }
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

  // ---- aviso de privacidade (primeira vez que a tradução é ligada)
  function privacyDialog() {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "modal";
      wrap.innerHTML = `<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="pvTitle">
        <div class="dz">${icon("shield", 22)}</div><h2 id="pvTitle">Antes de ligar a tradução</h2>
        <ul><li>O texto das mensagens desta conversa (e algumas mensagens anteriores, como contexto) é enviado ao <b>provedor de IA configurado nas Opções</b> para ser traduzido.</li>
        <li>Nada é enviado ao contato sem você revisar e clicar em Enviar.</li>
        <li>As traduções ficam salvas só neste computador. A chave da IA não entra no backup.</li>
        <li>Use com clientes que concordaram em ser atendidos por você (LGPD).</li></ul>
        <div class="pvact"><button class="btn" data-a="no">Agora não</button><button class="btn primary" data-a="yes">Entendi, ligar tradução</button></div></div>`;
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

  // Esc fecha o popover de tradução ou a prévia (registrado uma vez só)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (S.current && S.trOpen) {
      S.trOpen = false;
      renderHeader();
    } else if (S.current && S.preview) closePreview(false);
    else if (expanded) setExpanded(false);
  });

  // ----------------------------------------------------------------- início
  (async () => {
    welcome();
    connect();
    S.settings = await C.loadSettings();
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
