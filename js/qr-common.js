// Respostas rápidas — código compartilhado entre o painel (quick-replies.html)
// e o content script do WhatsApp Web. Expõe globalThis.OrbitaQR.
(() => {
  "use strict";
  if (globalThis.OrbitaQR) return;

  const KEY = "orbita:qr";
  const STATS_KEY = "orbita:qr:stats";
  const UI_KEY = "orbita:qr:ui";
  const MEDIA_PREFIX = "orbita:qr:media:";

  const DEFAULT_SETTINGS = {
    enabled: true, // barra no WhatsApp Web
    slash: true, // atalhos "/atalho" no campo de mensagem
    hotkeys: true, // Alt+1…9
    simulate: true, // "digitando…" / "gravando áudio…" antes de enviar
    typingCps: 16, // caracteres por segundo da simulação de digitação
    maxTypingSec: 6,
    maxRecordingSec: 12,
    stepDelaySec: 1.5, // intervalo entre as mensagens de uma sequência
    confirmSend: false, // mostrar prévia antes de enviar
    textAction: "send", // "send" | "insert" (respostas só de texto)
    favoritesFirst: true,
    showTypeIcons: true,
  };

  const STEP_TYPES = {
    text: { label: "Texto", icon: "text", media: false },
    image: { label: "Foto", icon: "image", media: true, accept: "image/*" },
    video: { label: "Vídeo", icon: "video", media: true, accept: "video/*" },
    audio: { label: "Áudio", icon: "mic", media: true, accept: "audio/*,video/webm,.ogg,.opus,.m4a,.mp3,.wav,.aac,.amr" },
    document: { label: "Documento", icon: "file", media: true, accept: "*/*" },
    sticker: { label: "Figurinha", icon: "sticker", media: true, accept: "image/*" },
    location: { label: "Localização", icon: "pin", media: false },
    contact: { label: "Contato", icon: "contact", media: false },
    poll: { label: "Enquete", icon: "poll", media: false },
  };

  const COLORS = ["#7c6cf0", "#25d366", "#0ea5e9", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#64748b"];

  const VARIABLES = [
    ["saudacao", "Bom dia / Boa tarde / Boa noite"],
    ["nome", "Nome do contato"],
    ["primeiro_nome", "Primeiro nome"],
    ["telefone", "Telefone do contato"],
    ["meu_nome", "Seu nome no WhatsApp"],
    ["data", "Data de hoje"],
    ["hora", "Hora atual"],
    ["dia_semana", "Dia da semana"],
  ];

  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  function seed() {
    const cat = (name, color) => ({ id: uid(), name, color });
    const cats = [cat("Atendimento", "#7c6cf0"), cat("Vendas", "#25d366"), cat("Financeiro", "#f59e0b")];
    const text = (t) => ({ id: uid(), type: "text", text: t, delaySec: 0 });
    const now = Date.now();
    const item = (title, shortcut, emoji, categoryId, steps, favorite = false) => ({
      id: uid(), title, shortcut, emoji, categoryId, favorite, steps, createdAt: now, updatedAt: now,
    });
    return {
      version: 1,
      settings: { ...DEFAULT_SETTINGS },
      categories: cats,
      items: [
        item("Boas-vindas", "oi", "👋", cats[0].id, [
          text("{{saudacao}}, {{primeiro_nome|tudo bem}}! 😊"),
          text("Obrigado por falar com a gente. Como posso te ajudar hoje?"),
        ], true),
        item("Um instante", "aguarde", "⏳", cats[0].id, [text("Só um instante, {{primeiro_nome|}} — já te respondo!")]),
        item("Horário", "horario", "🕘", cats[0].id, [
          text("Nosso horário de atendimento é de segunda a sexta, das 9h às 18h, e sábado das 9h às 13h."),
        ]),
        item("Chave Pix", "pix", "💸", cats[2].id, [
          text("Segue nossa chave Pix (CNPJ):"),
          text("00.000.000/0001-00"),
          text("Assim que pagar, me mande o comprovante por aqui, por favor 🙏"),
        ], true),
        item("Obrigado", "obg", "🙏", cats[1].id, [text("Muito obrigado pela preferência, {{primeiro_nome|}}! Qualquer coisa, é só chamar.")]),
      ],
    };
  }

  function normalizeStep(s) {
    const type = STEP_TYPES[s?.type] ? s.type : "text";
    const step = { ...s, id: s?.id || uid(), type, delaySec: Math.max(0, Number(s?.delaySec) || 0) };
    if (type === "audio" && step.ptt === undefined) step.ptt = true;
    return step;
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return seed();
    return {
      version: 1,
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      categories: (raw.categories || []).filter((c) => c && c.id).map((c) => ({ id: c.id, name: String(c.name || "Categoria"), color: c.color || COLORS[0] })),
      items: raw.items.filter((i) => i && i.id).map((i) => ({
        id: i.id,
        title: String(i.title || "Sem título"),
        shortcut: String(i.shortcut || "").toLowerCase(),
        emoji: i.emoji || "",
        categoryId: i.categoryId || "",
        favorite: Boolean(i.favorite),
        steps: (i.steps || []).map(normalizeStep),
        createdAt: i.createdAt || Date.now(),
        updatedAt: i.updatedAt || Date.now(),
      })),
    };
  }

  async function load() {
    const r = await chrome.storage.local.get(KEY);
    if (!r[KEY]) {
      const data = seed();
      await chrome.storage.local.set({ [KEY]: data });
      return data;
    }
    return normalize(r[KEY]);
  }

  const save = (data) => chrome.storage.local.set({ [KEY]: data });

  async function loadStats() {
    return (await chrome.storage.local.get(STATS_KEY))[STATS_KEY] || {};
  }

  async function bumpStats(id) {
    const stats = await loadStats();
    const cur = stats[id] || { n: 0, last: 0 };
    stats[id] = { n: cur.n + 1, last: Date.now() };
    await chrome.storage.local.set({ [STATS_KEY]: stats });
  }

  // ---- mídia (base64 em chrome.storage.local, uma chave por arquivo) ----

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
      r.onerror = () => reject(r.error || new Error("Falha ao ler o arquivo."));
      r.readAsDataURL(blob);
    });
  }

  async function putMedia(id, blob, meta) {
    const data = await blobToBase64(blob);
    await chrome.storage.local.set({ [MEDIA_PREFIX + id]: { ...meta, mime: meta.mime || blob.type, size: blob.size, data } });
  }

  async function getMediaRecord(id) {
    return (await chrome.storage.local.get(MEDIA_PREFIX + id))[MEDIA_PREFIX + id] || null;
  }

  async function getMediaBlob(id) {
    const rec = await getMediaRecord(id);
    if (!rec) throw new Error("Arquivo da resposta rápida não encontrado. Edite a resposta e anexe de novo.");
    return { blob: new Blob([base64ToBytes(rec.data)], { type: rec.mime }), record: rec };
  }

  const removeMedia = (ids) => ids.length ? chrome.storage.local.remove(ids.map((id) => MEDIA_PREFIX + id)) : Promise.resolve();

  const mediaIdsOf = (item) => item.steps.map((s) => s.mediaId).filter(Boolean);

  // ---- variáveis ----

  function greeting(d = new Date()) {
    const h = d.getHours();
    return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  }

  function renderVars(text, ctx = {}) {
    const now = new Date();
    const name = (ctx.name || "").trim();
    const values = {
      saudacao: greeting(now),
      nome: name,
      primeiro_nome: name.split(/\s+/)[0] || "",
      telefone: ctx.phone ? `+${ctx.phone}` : "",
      meu_nome: ctx.me || "",
      data: now.toLocaleDateString("pt-BR"),
      hora: now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      dia_semana: now.toLocaleDateString("pt-BR", { weekday: "long" }),
    };
    return String(text || "").replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (m, key, fallback) => {
      const k = key.toLowerCase();
      if (!(k in values)) return m;
      return values[k] || (fallback ?? "");
    });
  }

  // ---- utilidades de exibição ----

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function formatBytes(n) {
    if (!n) return "0 B";
    const u = ["B", "KB", "MB", "GB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / 1024 ** i).toFixed(i ? 1 : 0).replace(".", ",")} ${u[i]}`;
  }

  function formatDuration(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function stepSummary(s) {
    switch (s.type) {
      case "text": return s.text || "";
      case "audio": return s.ptt ? `Áudio gravado · ${formatDuration(s.duration)}` : `Áudio · ${s.name || ""}`;
      case "image": return s.caption || "Foto";
      case "video": return s.caption || (s.ptv ? "Vídeo redondo" : s.gif ? "GIF" : "Vídeo");
      case "document": return s.name || "Documento";
      case "sticker": return "Figurinha";
      case "location": return s.name || s.address || "Localização";
      case "contact": return `Contato: ${s.contactName || s.contactPhone || ""}`;
      case "poll": return `Enquete: ${s.pollName || ""}`;
      default: return "";
    }
  }

  // Ícones (Lucide, licença ISC)
  const PATHS = {
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    text: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    sticker: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/><path d="M8 13h.01"/><path d="M16 13h.01"/><path d="M10 16s.8 1 2 1c1.3 0 2-1 2-1"/>',
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    contact: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    poll: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 16h8"/><path d="M7 11h12"/><path d="M7 6h3"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sliders: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    spinner: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    grip: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
    once: '<circle cx="12" cy="12" r="10" stroke-dasharray="4 3"/><path d="M11 9l2-1v8"/>',
    keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
  };

  function icon(name, size = 16, extra = "") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${PATHS[name] || ""}</svg>`;
  }

  const stepIcon = (s) => (s.type === "audio" && !s.ptt ? "music" : STEP_TYPES[s.type]?.icon || "text");

  globalThis.OrbitaQR = {
    KEY, STATS_KEY, UI_KEY, MEDIA_PREFIX, DEFAULT_SETTINGS, STEP_TYPES, COLORS, VARIABLES,
    uid, seed, normalize, load, save, loadStats, bumpStats,
    base64ToBytes, blobToBase64, putMedia, getMediaRecord, getMediaBlob, removeMedia, mediaIdsOf,
    greeting, renderVars, esc, formatBytes, formatDuration, stepSummary, icon, stepIcon,
  };
})();
