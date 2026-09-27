// Agente local (MCP) — ponte do service worker com o servidor local.
//
// O agente (Claude Desktop, Claude Code, Cursor…) inicia mcp/orbita-mcp.mjs, que
// fala MCP com ele (stdio) e abre um WebSocket em 127.0.0.1. Esta ponte conecta
// nesse WebSocket, se apresenta com o token e executa as ferramentas pedidas
// (js/mcp-handlers.js), respeitando as permissões das Opções.
//
// chrome.storage.local (nada disso entra no backup nem na Órbita Cloud):
//   orbita:mcp          { enabled, port, token, perms: { read, organize, send }, confirmSend }
//   orbita:mcp:status   { state: "off"|"waiting"|"connected"|"error", client, since, error }
//   orbita:mcp:log      últimas 100 chamadas { at, tool, ok, ms, error, args }
//   orbita:mcp:pending  envios esperando a sua confirmação
(() => {
  "use strict";
  if (globalThis.OrbitaMcpBridge) return;
  const { TOOLS } = globalThis.OrbitaMcpTools;
  const K = { cfg: "orbita:mcp", status: "orbita:mcp:status", log: "orbita:mcp:log", pending: "orbita:mcp:pending" };
  const CHANNEL = "orbita:mcp";
  const DEFAULTS = { enabled: false, port: 17345, token: "", perms: { read: true, organize: true, send: false }, disabled: [], confirmSend: true };
  const LEVEL = Object.fromEntries(TOOLS.map((t) => [t.name, t.level]));

  let ws = null;
  let retry = 0;
  let retryTimer = 0;
  let cfg = DEFAULTS;
  let clientInfo = null;
  const waiting = new Map(); // id → { resolve, timer }

  const get = async (k, d) => (await chrome.storage.local.get(k))[k] ?? d;
  const set = (k, v) => chrome.storage.local.set({ [k]: v });
  async function loadCfg() {
    const c = await get(K.cfg, {});
    cfg = { ...DEFAULTS, ...c, perms: { ...DEFAULTS.perms, ...(c.perms || {}) } };
    return cfg;
  }
  // liberada = o grupo (ler / organizar / enviar) ligado e a ação não desmarcada uma a uma
  const isAllowed = (name) => Boolean(cfg.perms[LEVEL[name]]) && !(cfg.disabled || []).includes(name);
  const allowed = () => TOOLS.filter((t) => isAllowed(t.name)).map((t) => t.name);
  async function setStatus(patch) {
    const cur = await get(K.status, {});
    await set(K.status, { ...cur, ...patch, at: Date.now() });
  }

  // ---------------------------------------------------------------- conexão
  function send(obj) {
    if (ws?.readyState === 1) ws.send(JSON.stringify(obj));
  }
  function scheduleRetry() {
    clearTimeout(retryTimer);
    if (!cfg.enabled) return;
    const wait = [1000, 2000, 5000, 10000, 20000, 30000][Math.min(retry++, 5)];
    retryTimer = setTimeout(connect, wait);
  }
  async function connect() {
    await loadCfg();
    if (!cfg.enabled || !cfg.token) {
      disconnect();
      return setStatus({ state: "off", client: null, error: null });
    }
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    let sock;
    try {
      sock = new WebSocket(`ws://127.0.0.1:${Number(cfg.port) || DEFAULTS.port}/orbita`);
    } catch (e) {
      await setStatus({ state: "error", error: e.message });
      return scheduleRetry();
    }
    ws = sock;
    sock.onopen = () => send({ type: "hello", token: cfg.token, version: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id, allowed: allowed() });
    sock.onmessage = (ev) => onMessage(sock, ev.data).catch((e) => console.warn("[Órbita MCP]", e?.message));
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null;
      clientInfo = null;
      const bad = ev.code === 4001;
      setStatus({ state: cfg.enabled ? (bad ? "error" : "waiting") : "off", client: null, error: bad ? "O servidor local recusou o token. Copie a configuração de novo (o token mudou?)." : null });
      if (!bad) scheduleRetry();
    };
    sock.onerror = () => {}; // o onclose cuida (servidor fechado = agente não está rodando)
  }
  function disconnect() {
    clearTimeout(retryTimer);
    const s = ws;
    ws = null;
    if (s && s.readyState <= 1) s.close(1000, "desligado");
  }

  async function onMessage(sock, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === "ping") return send({ type: "pong" });
    if (msg.type === "welcome" || msg.type === "client") {
      retry = 0;
      clientInfo = msg.client || clientInfo;
      return setStatus({ state: "connected", client: clientInfo, since: Date.now(), error: null, server: msg.server || undefined });
    }
    if (msg.type === "call") return onCall(msg);
  }

  // ---------------------------------------------------------------- ferramentas
  async function onCall({ id, name, args, client }) {
    const started = Date.now();
    await loadCfg();
    let reply;
    try {
      if (!LEVEL[name]) throw new Error(`Ferramenta desconhecida: ${name}`);
      if (!cfg.perms[LEVEL[name]]) throw new Error(`Permissão desligada: “${globalThis.OrbitaMcpTools.LEVELS[LEVEL[name]]}”. Ligue em Opções → Agente local (MCP).`);
      if (!isAllowed(name)) throw new Error(`A ação “${TOOLS.find((t) => t.name === name).title}” está desligada em Opções → Agente local (MCP).`);
      const result = await globalThis.OrbitaMcpHandlers.run(name, args, { confirm: (info) => confirmSend(info, client || clientInfo) });
      reply = { type: "result", id, ok: true, result };
    } catch (e) {
      reply = { type: "result", id, ok: false, error: e?.message || String(e) };
    }
    send(reply);
    await log({ at: started, tool: name, ok: reply.ok, ms: Date.now() - started, error: reply.ok ? null : reply.error, args: shortArgs(args), client: (client || clientInfo)?.name || null });
  }
  function shortArgs(a) {
    try {
      const s = JSON.stringify(a || {});
      return s.length > 300 ? `${s.slice(0, 297)}…` : s;
    } catch {
      return "";
    }
  }
  async function log(entry) {
    const list = await get(K.log, []);
    list.unshift(entry);
    await set(K.log, list.slice(0, 100));
  }

  // ---------------------------------------------------------------- confirmação de envio
  // Notificação com "Enviar"/"Cancelar" (e os mesmos botões nas Opções).
  // Sem resposta em 2 minutos = cancelado.
  async function confirmSend(info, client) {
    await loadCfg();
    if (!cfg.confirmSend) return;
    const id = `mcp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const item = { id, at: Date.now(), title: info.title, message: info.message, preview: info.preview || "", client: client?.name || "Agente local" };
    await set(K.pending, [...(await get(K.pending, [])), item]);
    const decision = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 120000);
      waiting.set(id, { resolve, timer });
    });
    try {
      chrome.notifications.create(id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: `${item.client}: ${info.title}`.slice(0, 120),
        message: info.message || "",
        contextMessage: info.preview || "Agente local (MCP)",
        buttons: [{ title: "Enviar" }, { title: "Cancelar" }],
        requireInteraction: true,
        priority: 2,
      });
    } catch {}
    const ok = await decision;
    clearTimeout(waiting.get(id)?.timer);
    waiting.delete(id);
    chrome.notifications.clear(id, () => void chrome.runtime.lastError);
    await set(K.pending, (await get(K.pending, [])).filter((p) => p.id !== id));
    if (!ok) throw new Error("Envio não confirmado pelo usuário (cancelado ou sem resposta em 2 minutos).");
  }
  function decide(id, ok) {
    const w = waiting.get(id);
    if (!w) return false;
    w.resolve(Boolean(ok));
    return true;
  }
  chrome.notifications.onButtonClicked.addListener((nid, idx) => nid.startsWith("mcp-") && decide(nid, idx === 0));
  chrome.notifications.onClosed.addListener((nid, byUser) => nid.startsWith("mcp-") && byUser && decide(nid, false));

  // Opções → decidir um envio pendente / reconectar
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.channel !== CHANNEL || sender.id !== chrome.runtime.id) return false;
    if (msg.op === "decide") sendResponse({ ok: decide(String(msg.id), msg.approve) });
    else if (msg.op === "reconnect") {
      retry = 0;
      disconnect();
      connect().then(() => sendResponse({ ok: true }));
      return true;
    } else sendResponse({ ok: false });
    return false;
  });

  // mudou algo nas Opções: reconecta ou avisa o servidor das permissões novas
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || !ch[K.cfg]) return;
    const before = ch[K.cfg].oldValue || {};
    const after = ch[K.cfg].newValue || {};
    loadCfg().then(() => {
      if (before.enabled !== after.enabled || before.port !== after.port || before.token !== after.token) {
        retry = 0;
        disconnect();
        connect();
      } else send({ type: "allowed", allowed: allowed() });
    });
  });

  // o service worker pode ter sido reiniciado: o alarme reconecta
  chrome.alarms.onAlarm.addListener((a) => a.name === "orbita-mcp" && connect());
  (async () => {
    await loadCfg();
    if (cfg.enabled) chrome.alarms.create("orbita-mcp", { periodInMinutes: 1 });
    else chrome.alarms.clear("orbita-mcp");
    // envios que ficaram pendentes num service worker anterior: não valem mais
    await set(K.pending, []);
    connect();
  })().catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && ch[K.cfg]) (ch[K.cfg].newValue?.enabled ? chrome.alarms.create("orbita-mcp", { periodInMinutes: 1 }) : chrome.alarms.clear("orbita-mcp"));
  });

  globalThis.OrbitaMcpBridge = { connect, disconnect, decide, K, DEFAULTS, status: () => ({ connected: ws?.readyState === 1, client: clientInfo }) };
})();
