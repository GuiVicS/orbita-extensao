// Opções → "Agente local (MCP)": liga/desliga, permissões (por grupo e ação por
// ação), token, porta, configuração pronta para o agente, envios esperando
// confirmação e o registro do que o agente fez. A conexão em si fica no
// service worker (js/mcp-bridge.js).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  if (!$("mcpSec") || !globalThis.OrbitaMcpTools) return;
  const { TOOLS, LEVELS } = globalThis.OrbitaMcpTools;
  const K = { cfg: "orbita:mcp", status: "orbita:mcp:status", log: "orbita:mcp:log", pending: "orbita:mcp:pending" };
  const DEFAULTS = { enabled: false, port: 17345, token: "", perms: { read: true, organize: true, send: false }, disabled: [], confirmSend: true, folder: "" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let cfg = DEFAULTS;

  const newToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  async function load() {
    const c = (await chrome.storage.local.get(K.cfg))[K.cfg] || {};
    cfg = { ...DEFAULTS, ...c, perms: { ...DEFAULTS.perms, ...(c.perms || {}) }, disabled: c.disabled || [] };
    if (!cfg.token) {
      cfg.token = newToken();
      await save();
    }
    return cfg;
  }
  const save = () => chrome.storage.local.set({ [K.cfg]: cfg });

  // ---------------------------------------------------------------- configuração do agente
  // pasta da extensão (aceita também a pasta mcp ou o próprio arquivo, colados por engano)
  function folder() {
    return String(cfg.folder || "")
      .trim()
      .replace(/^"+|"+$/g, "")
      .replace(/[\\/]+$/, "")
      .replace(/[\\/]orbita-mcp\.mjs$/i, "")
      .replace(/[\\/]mcp$/i, "");
  }
  function serverPath() {
    const f = folder();
    const sep = f.includes("/") && !f.includes("\\") ? "/" : "\\";
    return `${f}${sep}mcp${sep}orbita-mcp.mjs`;
  }
  function configText(kind) {
    const env = { ORBITA_MCP_TOKEN: cfg.token, ORBITA_MCP_PORT: String(cfg.port) };
    if (!folder()) return "Informe acima a pasta da extensão neste computador para gerar a configuração.";
    if (kind === "code") return `claude mcp add orbita --scope user --env ORBITA_MCP_TOKEN=${cfg.token} --env ORBITA_MCP_PORT=${cfg.port} -- node "${serverPath()}"`;
    // OpenCode: formato próprio ("type": "local", command em lista, "environment")
    if (kind === "opencode") return JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { orbita: { type: "local", command: ["node", serverPath()], enabled: true, timeout: 20000, environment: env } } }, null, 2);
    const server = { command: "node", args: [serverPath()], env };
    return JSON.stringify({ mcpServers: { orbita: server } }, null, 2);
  }
  const HINTS = {
    desktop: "Claude Desktop → Configurações → Desenvolvedor → Editar configuração: cole dentro de “mcpServers” (ou o arquivo inteiro, se estiver vazio) e reinicie o Claude Desktop.",
    code: "Rode o comando uma vez no terminal. Depois, no Claude Code, /mcp mostra a Órbita conectada.",
    opencode: "Cole em %USERPROFILE%\\.config\\opencode\\opencode.json (se o arquivo já tiver conteúdo, junte só a parte \"orbita\" dentro de \"mcp\") e reinicie o OpenCode. Confira com: opencode mcp list.",
    json: "Cole na configuração de servidores MCP do seu agente (Cursor: Settings → MCP; Windsurf: mcp_config.json).",
  };
  function paintConfig() {
    const kind = $("mcpCfgKind").value;
    $("mcpCfg").textContent = configText(kind);
    $("mcpCfgHint").textContent = folder() ? `${HINTS[kind]} O token é como uma senha: não compartilhe.` : "";
    $("mcpCopy").disabled = !folder();
    $("mcpCheckCmd").textContent = folder() ? `node "${serverPath()}" --check --token ${cfg.token} --port ${cfg.port}` : "Informe a pasta da extensão acima.";
  }

  // ---------------------------------------------------------------- ações uma a uma
  function paintTools() {
    const groups = ["read", "organize", "send"];
    $("mcpToolCount").textContent = `${TOOLS.filter((t) => cfg.perms[t.level] && !cfg.disabled.includes(t.name)).length} de ${TOOLS.length} liberadas`;
    $("mcpTools").innerHTML = groups
      .map((g) => `<h3>${esc(LEVELS[g])}${cfg.perms[g] ? "" : " — <span class=status>grupo desligado</span>"}</h3>${TOOLS.filter((t) => t.level === g)
        .map((t) => `<label class="inline sub mtool"><input type=checkbox data-tool="${esc(t.name)}" ${!cfg.disabled.includes(t.name) ? "checked" : ""} ${cfg.perms[g] ? "" : "disabled"}> <span><b>${esc(t.title)}</b> <code>${esc(t.name)}</code><br><small class=hint>${esc(t.description)}</small></span></label>`)
        .join("")}`)
      .join("");
  }
  $("mcpTools").addEventListener("change", async (e) => {
    const name = e.target.dataset.tool;
    if (!name) return;
    const set = new Set(cfg.disabled);
    if (e.target.checked) set.delete(name);
    else set.add(name);
    cfg.disabled = [...set];
    await save();
    paintTools();
  });

  // ---------------------------------------------------------------- tela
  function paint() {
    $("mcpEnabled").checked = cfg.enabled;
    $("mcpBody").classList.toggle("dim", !cfg.enabled);
    $("mcpRead").checked = cfg.perms.read;
    $("mcpOrganize").checked = cfg.perms.organize;
    $("mcpSend").checked = cfg.perms.send;
    $("mcpConfirm").checked = cfg.confirmSend;
    $("mcpConfirm").disabled = !cfg.perms.send;
    $("mcpToken").value = cfg.token;
    $("mcpPort").value = cfg.port;
    if (document.activeElement !== $("mcpFolder")) $("mcpFolder").value = cfg.folder || "";
    paintConfig();
    paintTools();
  }
  async function paintStatus() {
    const s = (await chrome.storage.local.get(K.status))[K.status] || {};
    const el = $("mcpState");
    if (!cfg.enabled) return Object.assign(el, { textContent: "Desligado.", className: "status" });
    if (s.state === "connected") return Object.assign(el, { textContent: `● Conectado${s.client?.name ? ` ao ${s.client.name}${s.client.version ? ` ${s.client.version}` : ""}` : " ao servidor local"}.`, className: "status ok" });
    if (s.state === "error") return Object.assign(el, { textContent: s.error || "Erro na conexão.", className: "status err" });
    Object.assign(el, { textContent: "Aguardando o agente: abra o Claude Desktop (ou o seu agente) com a Órbita configurada. A conexão é automática.", className: "status" });
  }
  async function paintPending() {
    const list = (await chrome.storage.local.get(K.pending))[K.pending] || [];
    $("mcpPendingBox").hidden = !list.length;
    $("mcpPending").innerHTML = list
      .map((p) => `<div class=mpend><p><b>${esc(p.client)}: ${esc(p.title)}</b></p><p>${esc(p.message)}</p>${p.preview ? `<p class=hint>${esc(p.preview)}</p>` : ""}<div class=actions><button type=button class=primary data-decide="${esc(p.id)}" data-ok=1>Enviar</button><button type=button data-decide="${esc(p.id)}" data-ok=0>Cancelar</button></div></div>`)
      .join("");
  }
  $("mcpPending").addEventListener("click", (e) => {
    const b = e.target.closest("[data-decide]");
    if (b) chrome.runtime.sendMessage({ channel: "orbita:mcp", op: "decide", id: b.dataset.decide, approve: b.dataset.ok === "1" });
  });
  async function paintLog() {
    const list = (await chrome.storage.local.get(K.log))[K.log] || [];
    const title = (n) => TOOLS.find((t) => t.name === n)?.title || n;
    $("mcpLog").innerHTML = list.length
      ? `<div class=mlog>${list
          .slice(0, 50)
          .map((l) => `<span>${esc(new Date(l.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" }))}</span><span class="${l.ok ? "ok" : "err"}">${l.ok ? "✓" : "✗"}</span><span title="${esc(l.args)}"><b>${esc(title(l.tool))}</b>${l.client ? ` · ${esc(l.client)}` : ""} · ${l.ms} ms${l.error ? ` — <span class=err>${esc(l.error)}</span>` : ""}</span>`)
          .join("")}</div>`
      : `<p class=hint>Nenhuma ação ainda.</p>`;
  }

  // ---------------------------------------------------------------- eventos
  const bind = (id, fn) => $(id).addEventListener("change", async (e) => {
    fn(e.target);
    await save();
    paint();
    paintStatus();
  });
  bind("mcpEnabled", (el) => (cfg.enabled = el.checked));
  bind("mcpRead", (el) => (cfg.perms.read = el.checked));
  bind("mcpOrganize", (el) => (cfg.perms.organize = el.checked));
  bind("mcpSend", (el) => {
    if (el.checked && !confirm("Permitir que o agente envie mensagens pelo seu WhatsApp?\n\nCom “Pedir minha confirmação” ligado, cada envio aparece para você aprovar antes.")) el.checked = false;
    cfg.perms.send = el.checked;
  });
  bind("mcpConfirm", (el) => {
    if (!el.checked && !confirm("Sem confirmação, o agente envia mensagens direto, sem você revisar. Tem certeza?")) el.checked = true;
    cfg.confirmSend = el.checked;
  });
  bind("mcpPort", (el) => (cfg.port = Math.max(1024, Math.min(65535, Number(el.value) || 17345))));
  $("mcpFolder").addEventListener("input", async (e) => {
    cfg.folder = e.target.value;
    paintConfig();
    await save();
  });
  $("mcpCfgKind").addEventListener("change", paintConfig);
  $("mcpTokenShow").onclick = () => {
    const i = $("mcpToken");
    i.type = i.type === "password" ? "text" : "password";
    $("mcpTokenShow").textContent = i.type === "password" ? "Mostrar" : "Ocultar";
  };
  $("mcpTokenNew").onclick = async () => {
    if (!confirm("Gerar um token novo? O agente atual para de funcionar até você colar a configuração nova nele.")) return;
    cfg.token = newToken();
    await save();
    paint();
  };
  $("mcpCopy").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("mcpCfg").textContent);
      Object.assign($("mcpCopyStatus"), { textContent: "Copiado.", className: "status ok" });
    } catch {
      Object.assign($("mcpCopyStatus"), { textContent: "Não consegui copiar: selecione o texto acima.", className: "status err" });
    }
  };
  $("mcpLogClear").onclick = async () => {
    await chrome.storage.local.set({ [K.log]: [] });
    paintLog();
  };
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local") return;
    if (ch[K.status]) paintStatus();
    if (ch[K.pending]) paintPending();
    if (ch[K.log]) paintLog();
  });

  load().then(() => {
    paint();
    paintStatus();
    paintPending();
    paintLog();
  });
})();
