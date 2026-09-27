// Servidor MCP local: protocolo por stdio e a porta WebSocket fechada para sites.
// Rodar: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import crypto from "node:crypto";

const server = new URL("../mcp/orbita-mcp.mjs", import.meta.url).pathname;
const PORT = 18000 + Math.floor(Math.random() * 900);

function spawnAt(env) {
  return start(env);
}
function start(env = {}) {
  const p = spawn(process.execPath, [server], { env: { ...process.env, ORBITA_MCP_PORT: String(PORT), ...env }, stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  const got = [];
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      got.push(JSON.parse(buf.slice(0, i)));
      buf = buf.slice(i + 1);
    }
  });
  const send = (m) => p.stdin.write(`${JSON.stringify(m)}\n`);
  const wait = async (id) => {
    for (let i = 0; i < 100; i++) {
      const r = got.find((m) => m.id === id);
      if (r) return r;
      await new Promise((res) => setTimeout(res, 30));
    }
    throw new Error("sem resposta");
  };
  return { p, send, wait };
}
// handshake WebSocket "na mão", com a origem escolhida
function upgrade(origin) {
  return new Promise((resolve) => {
    const s = net.connect(PORT, "127.0.0.1", () => {
      s.write(`GET /orbita HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nOrigin: ${origin}\r\n\r\n`);
    });
    let data = Buffer.alloc(0);
    s.on("data", (d) => (data = Buffer.concat([data, d])));
    setTimeout(() => {
      s.destroy();
      resolve(data);
    }, 400);
  });
}
function frame(obj) {
  const payload = Buffer.from(JSON.stringify(obj));
  const mask = crypto.randomBytes(4);
  const head = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 255]);
  return Buffer.concat([head, mask, Buffer.from(payload.map((b, i) => b ^ mask[i % 4]))]);
}

test("protocolo MCP: initialize, tools, prompts e erro amigável sem a extensão", async () => {
  const s = start({ ORBITA_MCP_TOKEN: "tok" });
  s.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", clientInfo: { name: "x", version: "1" } } });
  const init = await s.wait(1);
  assert.equal(init.result.protocolVersion, "2024-11-05");
  assert.deepEqual(init.result.capabilities, { tools: { listChanged: true }, prompts: {} });
  s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  s.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (await s.wait(2)).result.tools;
  assert.equal(tools.length, 36);
  const send = tools.find((t) => t.name === "send_message");
  assert.equal(send.annotations.destructiveHint, true);
  assert.equal(tools.find((t) => t.name === "list_leads").annotations.readOnlyHint, true);
  s.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_leads", arguments: {} } });
  const r = (await s.wait(3)).result;
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /não está conectada/);
  s.send({ jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "organizar_leads", arguments: { limite: "5" } } });
  assert.match((await s.wait(4)).result.messages[0].content.text, /Liste até 5 leads/);
  s.send({ jsonrpc: "2.0", id: 5, method: "resources/list" });
  assert.equal((await s.wait(5)).error.code, -32601);
  s.send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "nao_existe" } });
  assert.equal((await s.wait(6)).error.code, -32602);
  s.p.kill();
});

test("WebSocket: sites (outra origem) são recusados; token errado derruba; token certo libera", async () => {
  const s = start({ ORBITA_MCP_TOKEN: "certo" });
  await new Promise((r) => setTimeout(r, 400));
  assert.match((await upgrade("https://site-malicioso.com")).toString(), /^HTTP\/1\.1 403/);
  // token errado → close 4001
  const bad = await new Promise((resolve) => {
    const sock = net.connect(PORT, "127.0.0.1", () => sock.write(`GET /orbita HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nOrigin: chrome-extension://abc\r\n\r\n`));
    let data = Buffer.alloc(0);
    sock.on("data", (d) => {
      data = Buffer.concat([data, d]);
      if (data.includes("101 Switching")) sock.write(frame({ type: "hello", token: "errado", version: "1", extensionId: "abc", allowed: [] }));
    });
    sock.on("close", () => resolve(data));
  });
  const close = bad.subarray(bad.indexOf("\r\n\r\n") + 4);
  assert.equal(close[0], 0x88);
  assert.equal(close.readUInt16BE(2), 4001);
  // token certo → a lista de ferramentas passa a respeitar as permissões da extensão
  const sock = net.connect(PORT, "127.0.0.1", () => sock.write(`GET /orbita HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nOrigin: chrome-extension://abc\r\n\r\n`));
  await new Promise((r) => sock.on("data", (d) => d.includes("101 Switching") && r()));
  sock.write(frame({ type: "hello", token: "certo", version: "1.22.3", extensionId: "abc", allowed: ["orbita_status", "list_leads"] }));
  await new Promise((r) => setTimeout(r, 300));
  s.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual((await s.wait(1)).result.tools.map((t) => t.name), ["orbita_status", "list_leads"]);
  s.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "send_message", arguments: { text: "x" } } });
  assert.match((await s.wait(2)).result.content[0].text, /sem permissão/);
  sock.destroy();
  s.p.kill();
});

test("rodando à mão (sem agente) continua no ar; --check aponta o que falta", async () => {
  const port = PORT + 50;
  const p = spawn(process.execPath, [server, "--token", "t", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] }); // stdin fechado, como num terminal de fundo
  await new Promise((r) => setTimeout(r, 1200));
  const r = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(await r.text(), /aguardando a extensão/);
  assert.equal(p.exitCode, null, "não encerrou");
  // --check com a porta ocupada e sem token: diz os dois problemas e sai com erro
  const c = spawn(process.execPath, [server, "--check", "--port", String(port)], { env: { ...process.env, ORBITA_MCP_TOKEN: "", ORBITA_MCP_CHECK_WAIT_MS: "300" } });
  let out = "";
  c.stdout.on("data", (d) => (out += d));
  const code = await new Promise((res) => c.on("exit", res));
  p.kill();
  assert.equal(code, 1);
  assert.match(out, /token NÃO definido/);
  assert.match(out, /porta \d+ já está com o servidor de outro agente|não abriu/);
});


// "extensão" falsa: WebSocket cru com a origem de extensão; responde às chamadas
function fakeExtension(port, { token, extensionId = "ext1", version = "1.22.3", allowed = ["orbita_status", "list_leads"], reply } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1", () => sock.write(`GET /orbita HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nOrigin: chrome-extension://${extensionId}\r\n\r\n`));
    const st = { sock, closeCode: null, calls: [] };
    let buf = Buffer.alloc(0);
    let upgraded = false;
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        const i = buf.indexOf("\r\n\r\n");
        if (i < 0) return;
        upgraded = true;
        buf = buf.subarray(i + 4);
        sock.write(frame({ type: "hello", token, version, extensionId, allowed }));
        setTimeout(() => resolve(st), 250);
      }
      while (buf.length >= 2) {
        const op = buf[0] & 15;
        let len = buf[1] & 127;
        let off = 2;
        if (len === 126) (len = buf.readUInt16BE(2)), (off = 4);
        if (buf.length < off + len) return;
        const data = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (op === 8) st.closeCode = data.readUInt16BE(0);
        if (op === 1) {
          const m = JSON.parse(data.toString());
          if (m.type === "call") {
            st.calls.push(m);
            sock.write(frame({ type: "result", id: m.id, ok: true, result: reply ? reply(m) : { from: "ext", name: m.name } }));
          }
        }
      }
    });
    sock.on("close", () => (st.closed = true));
  });
}

test("vários agentes ao mesmo tempo, sem derrubar a extensão; o segundo assume se o primeiro fechar", async () => {
  const port = PORT + 70;
  const env = { ORBITA_MCP_TOKEN: "tk", ORBITA_MCP_PORT: String(port) };
  const hub = spawnAt(env);
  await new Promise((r) => setTimeout(r, 700));
  const ext = await fakeExtension(port, { token: "tk", reply: (m) => ({ tool: m.name, client: m.client?.name }) });
  // impostor: outro "extensionId" enquanto a verdadeira responde → recusado, a verdadeira continua
  const fake = await fakeExtension(port, { token: "tk", extensionId: "impostor" });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(fake.closeCode, 4003);
  const noId = await fakeExtension(port, { token: "tk", extensionId: "" });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(noId.closeCode, 4001, "sem id de extensão não é aceito");
  assert.equal(ext.closed, undefined, "a extensão verdadeira não caiu");
  // segundo agente: porta ocupada pelo primeiro → vira retransmissor e funciona
  const relay = spawnAt(env);
  await new Promise((r) => setTimeout(r, 900));
  relay.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "Segundo", version: "1" } } });
  await relay.wait(1);
  relay.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual((await relay.wait(2)).result.tools.map((t) => t.name), ["orbita_status", "list_leads"]);
  relay.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_leads", arguments: {} } });
  assert.deepEqual(JSON.parse((await relay.wait(3)).result.content[0].text), { tool: "list_leads", client: "Segundo" });
  // o primeiro também continua funcionando
  hub.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "orbita_status", arguments: {} } });
  assert.equal(JSON.parse((await hub.wait(1)).result.content[0].text).tool, "orbita_status");
  const st = await (await fetch(`http://127.0.0.1:${port}/`)).json();
  assert.deepEqual([st.app, st.extension.connected, st.agents], ["orbita-mcp", true, 2]);
  // o primeiro fecha: o segundo assume a porta e a extensão reconecta nele
  hub.p.kill();
  let up = null;
  for (let i = 0; i < 40 && !up; i++) {
    await new Promise((r) => setTimeout(r, 150));
    up = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.json()).catch(() => null);
  }
  assert.equal(up?.app, "orbita-mcp", "o segundo agente assumiu a porta");
  await fakeExtension(port, { token: "tk" });
  relay.send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_leads", arguments: {} } });
  assert.equal(JSON.parse((await relay.wait(4)).result.content[0].text).name, "list_leads");
  relay.p.kill();
  ext.sock.destroy();
});
