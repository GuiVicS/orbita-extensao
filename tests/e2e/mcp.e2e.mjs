// Teste: Agente local (MCP) de ponta a ponta — um "agente" (este teste) inicia o
// servidor mcp/orbita-mcp.mjs e fala MCP com ele; a extensão real conecta e
// executa as ferramentas com o WhatsApp simulado. Rodar: node tests/e2e/mcp.e2e.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-mcp";
fs.rmSync(profile, { recursive: true, force: true });
const PORT = 17000 + Math.floor(Math.random() * 900);
const errors = [];
let last = "";
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { last = e.message; } if (Date.now() > end) throw new Error("timeout: " + last); await new Promise((r) => setTimeout(r, 200)); } };

// ---- "agente": cliente MCP por stdio
class Agent {
  constructor(token) {
    this.p = spawn(process.execPath, [`${ext}/mcp/orbita-mcp.mjs`], { env: { ...process.env, ORBITA_MCP_TOKEN: token, ORBITA_MCP_PORT: String(PORT) }, stdio: ["pipe", "pipe", "pipe"] });
    this.next = 1;
    this.waiting = new Map();
    this.notes = [];
    this.stderr = "";
    let buf = "";
    this.p.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const m = JSON.parse(line);
        if (m.id !== undefined && this.waiting.has(m.id)) {
          this.waiting.get(m.id)(m);
          this.waiting.delete(m.id);
        } else this.notes.push(m);
      }
    });
    this.p.stderr.on("data", (d) => (this.stderr += d));
  }
  request(method, params) {
    const id = this.next++;
    this.p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((res) => this.waiting.set(id, res));
  }
  notify(method, params) {
    this.p.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) })}\n`);
  }
  async tool(name, args = {}) {
    const r = await this.request("tools/call", { name, arguments: args });
    const text = r.result.content[0].text;
    if (r.result.isError) return { error: text };
    return JSON.parse(text);
  }
  close() {
    this.p.stdin.end();
    this.p.kill();
  }
}

const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1200, height: 1000 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push("dash: " + e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.waitForTimeout(1500);
// dados: funil, listas, leads e agenda
await dash.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("orbita");
  r.onsuccess = () => {
    const tx = r.result.transaction(["crmStages", "crmClients", "lists", "listContacts", "appointments"], "readwrite");
    const now = Date.now();
    for (const s of [{ id: "s1", name: "Novo Lead", color: "#0ea5e9", order: 0 }, { id: "s2", name: "Em Contato", color: "#6366f1", order: 1 }, { id: "s3", name: "Negociação", color: "#f59e0b", order: 2 }]) tx.objectStore("crmStages").put({ ...s, createdAt: now });
    tx.objectStore("lists").put({ id: "L1", name: "Clientes", count: 3, variableKeys: ["cidade"], createdAt: now, updatedAt: now });
    tx.objectStore("listContacts").put({ id: "L1:5511999998888", listId: "L1", phone: "5511999998888", name: "John Smith", vars: { cidade: "SP" }, order: 0 });
    tx.objectStore("listContacts").put({ id: "L1:5511977776666", listId: "L1", phone: "5511977776666", name: "Maria Lima", vars: { cidade: "RJ" }, order: 1 });
    tx.objectStore("listContacts").put({ id: "L1:5521955554444", listId: "L1", phone: "5521955554444", name: "Pedro Alves", vars: { cidade: "RJ" }, order: 2 });
    tx.objectStore("crmClients").put({ phone: "5511977776666", stageId: "s1", tags: ["VIP"], history: [{ id: "h1", ts: now - 40 * 864e5, kind: "note", text: "Pediu catálogo" }], lastInteractionAt: now - 40 * 864e5, lead: { temperature: "frio" }, updatedAt: now });
    tx.objectStore("crmClients").put({ phone: "5521955554444", stageId: "s1", tags: [], history: [], lastInteractionAt: now - 2 * 864e5, updatedAt: now });
    tx.objectStore("appointments").put({ id: "a1", phone: "5511977776666", clientName: "Maria Lima", title: "Ligar para Maria", start: now + 3600e3, durationMin: 30, reminderMin: 15, status: "scheduled", createdAt: now, updatedAt: now });
    tx.oncomplete = res;
  };
}));
await dash.evaluate(() => chrome.storage.local.set({ "orbita:chat:settings": { privacyAccepted: true }, "orbita:modules": { crm: true, agenda: true, conversas: true } }));
const wa = await ctx.newPage();
wa.on("pageerror", (e) => errors.push("wa: " + e.message));
await wa.goto("https://web.whatsapp.com/");
await waitFor(() => dash.evaluate(async () => (await chrome.runtime.sendMessage({ channel: "orbita:chat", op: "wa.status" })).data.ready));
await waitFor(async () => (await dash.evaluate(async () => (await chrome.runtime.sendMessage({ channel: "orbita:chat", op: "chat.list" })).data.length)) >= 3);

// ---- Opções: ligar o agente, porta, pasta e configuração pronta
const opt = await ctx.newPage();
opt.on("pageerror", (e) => errors.push("opt: " + e.message));
opt.on("dialog", (d) => d.accept());
await opt.goto(`chrome-extension://${id}/options.html#mcpSec`);
await opt.waitForFunction(() => document.getElementById("mcpToken").value.length > 20);
assert.equal(await opt.isChecked("#mcpSend"), false, "enviar começa desligado");
await opt.check("#mcpEnabled");
await opt.fill("#mcpPort", String(PORT));
await opt.locator("#mcpPort").dispatchEvent("change");
await opt.fill("#mcpFolder", "C:\\Orbita\\orbita-extensao");
const token = await opt.inputValue("#mcpToken");
const cfgJson = JSON.parse(await opt.textContent("#mcpCfg"));
assert.deepEqual(cfgJson.mcpServers.orbita, { command: "node", args: ["C:\\Orbita\\orbita-extensao\\mcp\\orbita-mcp.mjs"], env: { ORBITA_MCP_TOKEN: token, ORBITA_MCP_PORT: String(PORT) } });
await opt.selectOption("#mcpCfgKind", "code");
assert.match(await opt.textContent("#mcpCfg"), new RegExp(`^claude mcp add orbita --scope user --env ORBITA_MCP_TOKEN=${token} --env ORBITA_MCP_PORT=${PORT} -- node "C:\\\\Orbita\\\\orbita-extensao\\\\mcp\\\\orbita-mcp.mjs"$`));

// ---- token errado: recusado
const bad = new Agent("token-errado");
await waitFor(() => /recusou o token/.test(bad.stderr + "") || opt.evaluate(() => /recusou o token/.test(document.getElementById("mcpState").textContent)), 20000);
bad.close();
await new Promise((r) => setTimeout(r, 500));
await opt.evaluate(() => chrome.runtime.sendMessage({ channel: "orbita:mcp", op: "reconnect" }));

// ---- agente de verdade
const ag = new Agent(token);
const init = await ag.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Agente de Teste", version: "9.9" } });
assert.equal(init.result.serverInfo.name, "orbita");
assert.match(init.result.instructions, /orbita_status/);
ag.notify("notifications/initialized");
await opt.evaluate(() => chrome.runtime.sendMessage({ channel: "orbita:mcp", op: "reconnect" }));
await waitFor(() => opt.evaluate(() => /Conectado ao Agente de Teste 9\.9/.test(document.getElementById("mcpState").textContent)), 20000);
await opt.locator("#mcpSec").screenshot({ path: shots + "/mcp-opcoes.png" });
let tools = (await ag.request("tools/list")).result.tools.map((t) => t.name);
console.log("ferramentas liberadas:", tools.length);
assert.equal(tools.includes("send_message"), false, "sem permissão de envio, não aparece");
assert.ok(tools.includes("bulk_update_leads") && tools.includes("get_messages"));
const prompts = (await ag.request("prompts/list")).result.prompts.map((p) => p.name);
assert.deepEqual(prompts.sort(), ["analisar_conversas", "follow_up", "organizar_leads", "preparar_campanha", "qualificar_novos_contatos", "relatorio_semanal", "resumo_do_dia"]);

// ---- leitura
const st = await ag.tool("orbita_status");
console.log("status:", JSON.stringify(st).slice(0, 300));
assert.equal(st.whatsapp.ready, true);
assert.deepEqual(st.crm.byStage.map((x) => x.count), [3, 0, 0]); // John está só na lista: conta na 1ª etapa, como no painel
const chats = await ag.tool("list_chats", { filter: "contacts" });
assert.ok(chats.chats.some((c) => c.chatId === "5511999998888@c.us" && c.lead?.name === "John Smith"));
const msgs = await ag.tool("get_messages", { chatId: "5511999998888@c.us" });
console.log("mensagens:", msgs.messages.slice(-3));
assert.ok(msgs.messages.some((m) => m.text === "Can you send the price?" && m.from === "John Smith"));
assert.ok(msgs.messages.some((m) => m.from === "Você"));
assert.match(msgs.messages[0].at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
const found = await ag.tool("search_messages", { query: "PRICE" });
assert.equal(found.results[0].chatId, "5511999998888@c.us");
const wait = await ag.tool("awaiting_reply", {});
assert.ok(wait.chats.some((c) => c.chatId === "5511999998888@c.us"));
const notIn = await ag.tool("list_chats", { filter: "not_in_crm" });
assert.ok(notIn.chats.every((c) => !c.lead && !c.isGroup));
const leads = await ag.tool("list_leads", { staleDays: 30 });
assert.deepEqual(leads.leads.map((l) => l.phone), ["5511977776666"]);
const maria = await ag.tool("get_lead", { phone: "5511977776666" });
assert.equal(maria.name, "Maria Lima");
assert.equal(maria.appointments[0].title, "Ligar para Maria");
const metrics = await ag.tool("chat_metrics", {});
console.log("métricas:", metrics.messages, metrics.firstResponseMinutes);
assert.ok(metrics.messages.received >= 2 && metrics.messages.sent >= 1);
assert.equal((await ag.tool("list_tags")).tags[0].tag, "VIP");
const lists = await ag.tool("get_list", { listId: "L1" });
assert.equal(lists.total, 3);

// ---- organizar
const up = await ag.tool("update_lead", { phone: "5511999998888", stageName: "Negociação", addTags: ["Importado", "quente"], lead: { temperature: "quente", source: "WhatsApp", product: "Plano anual" }, deal: { value: 2500 } });
assert.equal(up.lead.stage, "Negociação");
assert.equal(up.lead.temperature, "quente");
assert.ok(up.lead.history.some((h) => h.kind === "stage" && /para “Negociação”/.test(h.text)));
await ag.tool("add_lead_note", { phone: "5511999998888", text: "Pediu preço do plano anual." });
await ag.tool("log_activity", { phone: "5511999998888", type: "whatsapp", description: "Enviei a tabela", result: "Pediu proposta", nextAction: "Mandar proposta", nextAt: "2026-10-02T10:00:00-03:00" });
const john = await ag.tool("get_lead", { phone: "5511999998888" });
assert.ok(john.history.some((h) => h.activity?.result === "Pediu proposta"));
assert.equal(john.deal.value, 2500);
// vários de uma vez: simular, depois mover
const dry = await ag.tool("bulk_update_leads", { filter: { stageId: "s1" }, set: { stageName: "Em Contato", addTags: ["Follow-up"] }, dryRun: true });
assert.equal(dry.matched, 2);
assert.equal((await ag.tool("list_leads", { stageId: "s1" })).total, 2, "dryRun não grava");
const bulk = await ag.tool("bulk_update_leads", { filter: { stageId: "s1" }, set: { stageName: "Em Contato", addTags: ["Follow-up"], temperature: "morno" }, note: "Movido pelo agente para follow-up." });
assert.equal(bulk.updated, 2);
assert.equal((await ag.tool("list_leads", { stageId: "s2" })).total, 2);
assert.equal((await ag.tool("list_leads", { tag: "follow-up" })).total, 2);
assert.match((await ag.tool("bulk_update_leads", { set: { stageId: "s1" } })).error, /Informe phones ou filter/);
const byPhones = await ag.tool("bulk_update_leads", { phones: ["5521955554444"], set: { removeTags: ["Follow-up"], status: "qualificado" } });
assert.equal(byPhones.updated, 1);
const stage = await ag.tool("create_stage", { name: "Proposta enviada" });
assert.ok(stage.stageId);
const ap = await ag.tool("create_appointment", { phone: "5511999998888", title: "Apresentar proposta", start: new Date(Date.now() + 2 * 864e5).toISOString(), reminderMin: 60 });
assert.equal(ap.appointment.client, "John Smith");
const alarm = await sw.evaluate((id) => chrome.alarms.get(`remind:${id}`), ap.appointment.appointmentId);
assert.ok(alarm, "lembrete agendado como no painel");
await ag.tool("update_appointment", { appointmentId: "a1", status: "done" });
const list = await ag.tool("create_list", { name: "Quentes", contacts: [{ phone: "5511999998888", name: "John" }, { phone: "5511999998888" }, { phone: "abc" }] });
assert.equal(list.count, 1);
const added = await ag.tool("add_to_list", { listId: list.listId, contacts: [{ phone: "5511977776666", name: "Maria" }, { phone: "5511999998888" }] });
assert.deepEqual([added.added, added.skipped], [1, 1]);
const draft = await ag.tool("create_campaign_draft", { name: "Proposta anual", listId: list.listId, messages: ["{{saudacao}}, {{primeiro_nome}}! Posso te mandar a proposta?"] });
assert.equal(draft.status, "DRAFT");
const camps = await ag.tool("list_campaigns", { status: "DRAFT" });
assert.equal(camps.campaigns[0].list, "Quentes");
const auto = await ag.tool("set_auto_reply", { phone: "5511977776666", enabled: true });
assert.equal(auto.autoReply, true);
const rep = await ag.tool("pipeline_report");
console.log("funil:", rep.byStage);
assert.equal(rep.totalDealValue, 2500);
// os dados aparecem no painel (mesmo formato)
const inDb = await dash.evaluate(() => new Promise((res) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const q = r.result.transaction("crmClients").objectStore("crmClients").get("5511999998888"); q.onsuccess = () => res(q.result); }; }));
assert.equal(inDb.stageId, "s3");
assert.deepEqual(inDb.tags, ["Importado", "quente"]);

// ---- permissões: ação desligada uma a uma
await opt.click("#mcpSec details:has(#mcpTools) summary"); // a lista de ações começa recolhida
await opt.uncheck('[data-tool="create_list"]');
await waitFor(async () => !(await ag.request("tools/list")).result.tools.some((t) => t.name === "create_list"));
assert.ok(ag.notes.some((n) => n.method === "notifications/tools/list_changed"));
assert.match((await ag.tool("create_list", { name: "X", contacts: [{ phone: "5511999998888" }] })).error, /sem permissão|desligada/);

// ---- enviar: liga, pede confirmação, envia no WhatsApp
assert.match((await ag.tool("send_message", { chatId: "5511999998888@c.us", text: "Oi" })).error, /sem permissão/);
await opt.check("#mcpSend");
await waitFor(async () => (await ag.request("tools/list")).result.tools.some((t) => t.name === "send_message"));
const before = await wa.evaluate(() => __store["5511999998888@c.us"].length);
const sending = ag.tool("send_message", { phone: "5511999998888", text: "Olá John, segue a proposta!" });
await opt.waitForSelector("#mcpPending [data-decide]", { timeout: 15000 });
assert.match(await opt.textContent("#mcpPending"), /Agente de Teste: Enviar para John Smith\?[\s\S]*Olá John, segue a proposta!/);
await opt.locator("#mcpSec").screenshot({ path: shots + "/mcp-confirmar.png" });
await opt.click('#mcpPending [data-ok="1"]');
const sent = await sending;
console.log("enviado:", sent);
assert.equal(sent.ok, true);
await waitFor(async () => (await wa.evaluate(() => __store["5511999998888@c.us"].length)) > before);
assert.equal(await wa.evaluate(() => __store["5511999998888@c.us"].at(-1).body), "Olá John, segue a proposta!");
// cancelar = nada sai
const count = await wa.evaluate(() => __store["5511999998888@c.us"].length);
const cancel = ag.tool("send_message", { chatId: "5511999998888@c.us", text: "Não deve sair" });
await opt.waitForSelector("#mcpPending [data-decide]", { timeout: 15000 });
await opt.click('#mcpPending [data-ok="0"]');
assert.match((await cancel).error, /não confirmado/);
assert.equal(await wa.evaluate(() => __store["5511999998888@c.us"].length), count);

// ---- registro de atividade
await opt.click("#mcpSec details:has(#mcpLog) summary");
await opt.waitForFunction(() => /Enviar mensagem no WhatsApp/.test(document.getElementById("mcpLog").textContent));
const log = await opt.evaluate(async () => (await chrome.storage.local.get("orbita:mcp:log"))["orbita:mcp:log"]);
assert.ok(log.some((l) => l.tool === "update_lead" && l.ok && l.client === "Agente de Teste"));
// token e registro ficam fora do backup
const bk = await dash.evaluate(async () => Object.keys((await OrbitaBackup.create()).storage).filter((k) => k.startsWith("orbita:mcp")));
assert.deepEqual(bk, []);

// ---- desligar: o agente perde a conexão e recebe o aviso
await opt.uncheck("#mcpEnabled");
await waitFor(async () => /não está conectada/.test((await ag.tool("orbita_status")).error || ""));
ag.close();
console.log("ERRORS", errors);
assert.deepEqual(errors, []);
await ctx.close();
console.log("AGENTE LOCAL (MCP) OK");
