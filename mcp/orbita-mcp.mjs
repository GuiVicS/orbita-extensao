#!/usr/bin/env node
// Órbita — servidor MCP local (Model Context Protocol).
//
// O agente (Claude Desktop, Claude Code, Cursor, …) inicia este arquivo e fala
// MCP com ele pelo stdin/stdout. A extensão da Órbita, no Chrome, conecta num
// WebSocket local (127.0.0.1) com um token; cada ferramenta pedida pelo agente
// é repassada para a extensão, que executa com as permissões das Opções.
//
//   node orbita-mcp.mjs            (token e porta pelas variáveis abaixo)
//   node orbita-mcp.mjs --check    diagnóstico: Node, token, porta e conexão da extensão
//   ORBITA_MCP_TOKEN  token copiado de Opções → Agente local (obrigatório)
//   ORBITA_MCP_PORT   porta local (padrão 17345; a mesma das Opções)
//
// Sem dependências: só Node 18+. Nada sai do seu computador por aqui.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TOKEN = String(arg("token") || process.env.ORBITA_MCP_TOKEN || "").trim();
const PORT = Number(arg("port") || process.env.ORBITA_MCP_PORT || 17345);
const CALL_TIMEOUT_MS = Number(process.env.ORBITA_MCP_TIMEOUT_MS || 180000);
const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const CHECK = process.argv.includes("--check");
// O agente esconde o stderr: tudo vai também para um arquivo (%TEMP%\orbita-mcp.log)
const LOG_FILE = path.join(os.tmpdir(), "orbita-mcp.log");
try {
  if (fs.statSync(LOG_FILE).size > 512 * 1024) fs.writeFileSync(LOG_FILE, "");
} catch {}
function log(...a) {
  const line = `[orbita-mcp] ${a.join(" ")}`;
  process.stderr.write(`${line}\n`); // stdout é só do protocolo
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} pid ${process.pid} ${line}\n`);
  } catch {}
}
process.on("uncaughtException", (e) => log("erro inesperado:", e?.stack || e?.message || e));
process.on("unhandledRejection", (e) => log("erro inesperado (promessa):", e?.stack || e?.message || e));
log(`iniciando (Node ${process.version}, ${process.platform}, ${fileURLToPath(import.meta.url)})`);
if (Number(process.versions.node.split(".")[0]) < 18) log("ATENÇÃO: é preciso o Node.js 18 ou mais novo (nodejs.org).");

// ---------------------------------------------------------------- catálogo (o mesmo da extensão)
function loadCatalog() {
  const sandbox = { globalThis: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(here, "..", "js", "mcp-tools.js"), "utf8"), sandbox, { filename: "mcp-tools.js" });
  return sandbox.OrbitaMcpTools;
}
let CATALOG;
try {
  CATALOG = loadCatalog();
} catch (e) {
  log(`não consegui ler ${path.join(here, "..", "js", "mcp-tools.js")}: ${e.message}. Este arquivo precisa estar dentro da pasta mcp da extensão Órbita.`);
  process.exit(1);
}
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, "..", "manifest.json"), "utf8")).version;
  } catch {
    return "0.0.0";
  }
})();

// ---------------------------------------------------------------- WebSocket (RFC 6455, mínimo)
function encodeFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x81, len]) : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255]) : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(len)); return b; })()]);
  return Buffer.concat([head, payload]);
}
function control(op, data = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([0x80 | op, data.length]), data]);
}

class Peer {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.parts = [];
    this.onText = () => {};
    this.onClose = () => {};
    this.closed = false;
    socket.on("data", (d) => this.feed(d));
    socket.on("close", () => this.finish());
    socket.on("error", () => this.finish());
  }
  finish() {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }
  send(obj) {
    if (!this.closed) this.socket.write(encodeFrame(JSON.stringify(obj)));
  }
  close(code = 1000, reason = "") {
    if (this.closed) return;
    const r = Buffer.from(reason.slice(0, 100), "utf8");
    const data = Buffer.concat([Buffer.from([code >> 8, code & 255]), r]);
    try {
      this.socket.write(control(0x8, data));
      this.socket.end();
    } catch {}
    this.finish();
  }
  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > 16 * 1024 * 1024) return this.close(1009, "grande demais");
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let data = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        data = Buffer.from(data.map((x, i) => x ^ mask[i % 4]));
      }
      this.buf = this.buf.subarray(need);
      if (op === 0x8) return this.close(1000);
      if (op === 0x9) {
        this.socket.write(control(0xa, data));
        continue;
      }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x0) {
        this.parts.push(data);
        if (fin) {
          const text = Buffer.concat(this.parts).toString("utf8");
          this.parts = [];
          this.onText(text);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- extensão conectada
let ext = null; // { peer, allowed: Set, version }
let checkRejected = false;
let mcpClient = null; // clientInfo do agente
const pending = new Map(); // id → { resolve, reject, timer }

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(`Órbita MCP ${VERSION}: ${ext ? "extensão conectada" : "aguardando a extensão"}\n`);
});
server.on("upgrade", (req, socket) => {
  const origin = String(req.headers.origin || "");
  const key = req.headers["sec-websocket-key"];
  // só a extensão (chrome-extension://…): sites abertos no navegador não conseguem conectar
  if (!origin.startsWith("chrome-extension://") || !key || new URL(req.url, "http://x").pathname !== "/orbita") {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const peer = new Peer(socket);
  let authed = false;
  const helloTimer = setTimeout(() => !authed && peer.close(4001, "sem apresentação"), 5000);
  peer.onText = (text) => {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!authed) {
      if (msg.type !== "hello" || !TOKEN || !safeEqual(msg.token, TOKEN)) {
        log("conexão recusada: token inválido (a extensão está com outro token)");
        checkRejected = true;
        return peer.close(4001, "token inválido");
      }
      authed = true;
      clearTimeout(helloTimer);
      if (ext) ext.peer.close(4002, "substituída por outra conexão");
      ext = { peer, allowed: new Set(msg.allowed || []), version: msg.version };
      log(`extensão conectada (v${msg.version}, ${ext.allowed.size} ferramentas liberadas)`);
      peer.send({ type: "welcome", server: { name: "orbita-mcp", version: VERSION }, client: mcpClient });
      notifyToolsChanged();
      return;
    }
    if (msg.type === "result") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      return msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || "Erro na extensão."));
    }
    if (msg.type === "allowed") {
      ext.allowed = new Set(msg.allowed || []);
      notifyToolsChanged();
    }
  };
  peer.onClose = () => {
    clearTimeout(helloTimer);
    if (ext?.peer !== peer) return;
    ext = null;
    log("extensão desconectada");
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error("A extensão desconectou durante a operação."));
      pending.delete(id);
    }
    notifyToolsChanged();
  };
});
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
// mantém o service worker da extensão acordado e detecta queda
setInterval(() => ext?.peer.send({ type: "ping" }), 20000).unref();

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") log(`a porta ${PORT} já está em uso (outro agente com a Órbita aberto?). Feche o outro ou mude a porta nas Opções e aqui (ORBITA_MCP_PORT).`);
  else log("erro no servidor local:", e.message);
  listenError = e;
});
let listenError = null;
server.listen(PORT, "127.0.0.1", () => {
  listening = true;
  log(`aguardando a extensão em ws://127.0.0.1:${PORT}/orbita`);
});
let listening = false;
if (!TOKEN) log("ATENÇÃO: defina ORBITA_MCP_TOKEN com o token de Opções → Agente local (MCP).");

function callExtension(name, args) {
  if (!TOKEN) return Promise.reject(new Error("Falta o token: defina ORBITA_MCP_TOKEN na configuração deste servidor MCP (copie em Opções → Agente local da Órbita)."));
  if (listenError?.code === "EADDRINUSE") return Promise.reject(new Error(`A porta ${PORT} já está em uso por outro agente conectado à Órbita. Feche o outro agente ou use outra porta (Opções → Agente local e ORBITA_MCP_PORT).`));
  if (!ext) return Promise.reject(new Error("A Órbita não está conectada. Abra o Chrome com a extensão Órbita e ligue Opções → Agente local (MCP) — a conexão é automática em alguns segundos."));
  if (!ext.allowed.has(name)) return Promise.reject(new Error(`A ferramenta ${name} está sem permissão. Libere em Opções → Agente local (MCP) da Órbita.`));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("A extensão demorou demais para responder."));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    ext.peer.send({ type: "call", id, name, args: args || {}, client: mcpClient });
  });
}

// ---------------------------------------------------------------- MCP (JSON-RPC por stdio)
const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const reply = (id, result) => out({ jsonrpc: "2.0", id, result });
const replyError = (id, code, message) => out({ jsonrpc: "2.0", id, error: { code, message } });
let initialized = false;
function notifyToolsChanged() {
  if (initialized) out({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
}

const INSTRUCTIONS = `Órbita é o CRM + WhatsApp do usuário (extensão do Chrome). Você acessa conversas, leads (CRM/Kanban), listas, agenda, campanhas e respostas rápidas.
- Comece com orbita_status. Datas em ISO 8601 com fuso do usuário.
- Para analisar uma conversa use get_messages (texto original, tradução e transcrição de áudio vêm juntos).
- Para organizar leads: list_stages, list_leads, get_lead e depois update_lead / add_lead_note / log_activity.
- Nunca envie mensagens (send_message, send_quick_reply) sem o usuário pedir ou aprovar o texto. O envio pode pedir confirmação na tela do usuário.
- Campanhas são criadas só como rascunho; o usuário revisa e inicia no painel.`;

function toolList() {
  const allowed = ext?.allowed;
  return CATALOG.TOOLS.filter((t) => !allowed || allowed.has(t.name)).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: t.level === "read", destructiveHint: t.level === "send", idempotentHint: t.level === "read", openWorldHint: t.level === "send" },
  }));
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case "initialize": {
      mcpClient = params?.clientInfo || null;
      const asked = params?.protocolVersion;
      ext?.peer.send({ type: "client", client: mcpClient });
      return reply(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: true }, prompts: {} },
        serverInfo: { name: "orbita", title: "Órbita (CRM + WhatsApp)", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "notifications/initialized":
      initialized = true;
      return;
    case "ping":
      return isRequest && reply(id, {});
    case "tools/list":
      return reply(id, { tools: toolList() });
    case "tools/call": {
      const name = params?.name;
      if (!CATALOG.TOOLS.some((t) => t.name === name)) return replyError(id, -32602, `Ferramenta desconhecida: ${name}`);
      try {
        const result = await callExtension(name, params?.arguments || {});
        return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        return reply(id, { content: [{ type: "text", text: e.message }], isError: true });
      }
    }
    case "prompts/list":
      return reply(id, { prompts: CATALOG.PROMPTS.map((p) => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments })) });
    case "prompts/get": {
      const p = CATALOG.PROMPTS.find((x) => x.name === params?.name);
      if (!p) return replyError(id, -32602, `Prompt desconhecido: ${params?.name}`);
      return reply(id, { description: p.description, messages: [{ role: "user", content: { type: "text", text: p.text(params?.arguments || {}) } }] });
    }
    default:
      if (isRequest) replyError(id, -32601, `Método não suportado: ${method}`);
  }
}

let stdinBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  if (CHECK) return;
  stdinBuf += chunk;
  let i;
  while ((i = stdinBuf.indexOf("\n")) >= 0) {
    const line = stdinBuf.slice(0, i).trim();
    stdinBuf = stdinBuf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      out({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON inválido" } });
      continue;
    }
    for (const m of Array.isArray(msg) ? msg : [msg]) handle(m).catch((e) => m.id !== undefined && replyError(m.id, -32603, e.message));
  }
});
// O agente fechou: encerra junto. Rodando à mão (sem agente, stdin vazio ou
// terminal), continua no ar para testar a conexão com a extensão.
let gotInput = false;
process.stdin.on("data", () => (gotInput = true));
process.stdin.on("end", () => {
  if (gotInput) process.exit(0);
  if (!CHECK) log("rodando sem agente (teste manual): a porta fica aberta para a extensão conectar. Ctrl+C para sair.");
});
if (process.stdin.isTTY && !CHECK) log("rodando no terminal (teste manual). No uso normal quem inicia este servidor é o agente. Ctrl+C para sair.");

// ---------------------------------------------------------------- diagnóstico (--check)
if (CHECK) {
  const out = (ok, text) => console.log(`${ok === null ? "…" : ok ? "✔" : "✖"} ${text}`);
  (async () => {
    console.log(`\nÓrbita MCP — diagnóstico (log completo: ${LOG_FILE})\n`);
    out(Number(process.versions.node.split(".")[0]) >= 18, `Node.js ${process.version} (precisa 18+)`);
    out(true, `servidor: ${fileURLToPath(import.meta.url)}`);
    out(true, `catálogo: ${CATALOG.TOOLS.length} ferramentas, ${CATALOG.PROMPTS.length} roteiros (Órbita ${VERSION})`);
    out(Boolean(TOKEN), TOKEN ? `token definido (${TOKEN.slice(0, 4)}…)` : "token NÃO definido: passe --token SEU_TOKEN ou a variável ORBITA_MCP_TOKEN (Opções → Agente local)");
    await new Promise((r) => setTimeout(r, 500));
    out(listening, listening ? `porta ${PORT} aberta em 127.0.0.1` : `porta ${PORT} não abriu: ${listenError?.code === "EADDRINUSE" ? "já está em uso (outro agente ou outro teste rodando? feche-o)" : listenError?.message || "erro desconhecido"}`);
    if (!listening || !TOKEN) process.exit(1);
    out(null, "esperando a extensão conectar (até 90 s). Confira: Chrome aberto, Opções → Agente local LIGADO, mesma porta e token…");
    const start = Date.now();
    while (!ext && Date.now() - start < Number(process.env.ORBITA_MCP_CHECK_WAIT_MS || 90000) && !checkRejected) await new Promise((r) => setTimeout(r, 500));
    if (ext) out(true, `extensão conectada (Órbita ${ext.version}, ${ext.allowed.size} ações liberadas). Tudo certo: configure o agente com este mesmo comando, sem o --check.`);
    else if (checkRejected) out(false, "a extensão tentou conectar, mas com OUTRO token. Copie a configuração de novo em Opções → Agente local.");
    else out(false, "a extensão não conectou. Verifique se o Agente local está ligado nas Opções, se a porta é a mesma e recarregue a extensão em chrome://extensions.");
    process.exit(ext ? 0 : 1);
  })();
}
