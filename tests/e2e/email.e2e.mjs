// Teste: e-mail marketing com a Resend simulada (módulo, configuração, editor,
// público, teste, envio, retomada, agendamento, cancelamento, CRM).
// Rodar: node tests/e2e/email.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-email";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
// Resend simulada (nas páginas da extensão)
await ctx.addInitScript(() => {
  if (!location.href.startsWith("chrome-extension://")) return;
  const real = window.fetch.bind(window);
  const st = JSON.parse(sessionStorage.getItem("__rs") || "null") || { calls: [], contacts: { "ja@existe.com": { unsubscribed: false }, "sai@fora.com": { unsubscribed: true } }, failEmail: null, domainStatus: "verified", seg: 0 };
  const save = () => sessionStorage.setItem("__rs", JSON.stringify(st));
  window.__rs = st;
  window.__rsSave = save;
  const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  window.fetch = async (url, init = {}) => {
    if (!String(url).startsWith("https://api.resend.com")) return real(url, init);
    const m = init.method || "GET";
    const path = String(url).replace("https://api.resend.com", "");
    const body = init.body ? JSON.parse(init.body) : undefined;
    st.calls.push({ m, path, body, auth: init.headers?.Authorization });
    save();
    if (path === "/domains") return j({ data: [{ name: "loja.com", status: st.domainStatus }] });
    if (path.startsWith("/contacts?")) return j({ has_more: false, data: Object.entries(st.contacts).map(([email, c], i) => ({ id: `c${i}`, email, unsubscribed: c.unsubscribed })) });
    if (m === "POST" && path === "/contacts") {
      if (st.failEmail === body.email) return j({ name: "application_error", message: "boom" }, 500);
      if (st.contacts[body.email]) return j({ name: "validation_error", message: "Contact already exists" }, 422);
      st.contacts[body.email] = { unsubscribed: false };
      save();
      return j({ object: "contact", id: "x" });
    }
    if (m === "PATCH" || /\/segments\//.test(path)) return j({ id: "ok" });
    if (m === "POST" && path === "/segments") return j({ object: "segment", id: `seg${++st.seg}` });
    if (m === "POST" && path === "/broadcasts") return j({ id: `bc${st.seg}` });
    if (m === "GET" && path.startsWith("/broadcasts/")) return j({ id: path.split("/").pop(), status: "sent", sent_at: new Date().toISOString() });
    if (m === "DELETE") return j({ deleted: true });
    if (m === "POST" && path === "/emails") return j({ id: "e1" });
    return j({ name: "not_found" }, 404);
  };
});

// painel: cria o banco e os dados (listas, contatos com e sem e-mail, CRM)
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push("dash: " + e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.waitForTimeout(1200);
await dash.evaluate(() => new Promise((res) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const tx = r.result.transaction(["lists", "listContacts", "crmClients", "crmStages"], "readwrite");
  tx.objectStore("lists").put({ id: "l1", name: "Clientes", count: 4, variableKeys: ["email"], createdAt: 1, updatedAt: 1 });
  tx.objectStore("lists").put({ id: "l2", name: "Leads", count: 1, variableKeys: [], createdAt: 1, updatedAt: 1 });
  const lc = tx.objectStore("listContacts");
  lc.put({ id: "l1:5511900000001", listId: "l1", phone: "5511900000001", name: "Maria Souza", vars: { email: "maria@cliente.com" }, order: 0 });
  lc.put({ id: "l1:5511900000002", listId: "l1", phone: "5511900000002", name: "João", vars: { "E-mail": "JA@existe.com" }, order: 1 });
  lc.put({ id: "l1:5511900000003", listId: "l1", phone: "5511900000003", name: "Sem Email", vars: {}, order: 2 });
  lc.put({ id: "l1:5511900000004", listId: "l1", phone: "5511900000004", name: "Saiu", vars: { email: "sai@fora.com" }, order: 3 });
  lc.put({ id: "l2:5511900000005", listId: "l2", phone: "5511900000005", name: "Lead Ficha", vars: {}, order: 0 });
  tx.objectStore("crmClients").put({ phone: "5511900000005", stageId: "s1", history: [], lead: { email: "lead@ficha.com" }, updatedAt: 1 });
  tx.objectStore("crmClients").put({ phone: "5511900000001", stageId: "s1", history: [], updatedAt: 1 });
  tx.oncomplete = res; }; }));
const history = (phone) => dash.evaluate((p) => new Promise((res) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const q = r.result.transaction("crmClients").objectStore("crmClients").get(p); q.onsuccess = () => res(q.result?.history || []); }; }), phone);

// ---- módulo desligado (padrão): menu sem "E-mail" e página avisa
assert.equal(await dash.locator("aside nav >> text=E-mail").count(), 0);
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("email: " + e.message));
await page.goto(`chrome-extension://${id}/email.html`);
await page.waitForSelector("text=O e-mail marketing está desligado");

// ---- Opções: ligar o módulo, chave e remetente
const opts = await ctx.newPage();
opts.on("pageerror", (e) => errors.push("opts: " + e.message));
await opts.goto(`chrome-extension://${id}/options.html`);
await opts.check("#mod-email");
await opts.fill("#emKey", "re_live_123");
await opts.click("#emTest");
await opts.waitForSelector("#emKeyStatus.ok");
console.log("testar chave:", await opts.locator("#emKeyStatus").innerText());
await opts.fill("#emFromName", "Loja Teste");
await opts.fill("#emFromEmail", "contato@loja.com");
await opts.fill("#emReplyTo", "atendimento@loja.com");
await opts.fill("#emCompany", "Loja Teste LTDA");
await opts.fill("#emAddress", "Rua A, 10 — São Paulo/SP");
await opts.click("#emSave");
await opts.waitForSelector('#emStatus:has-text("salva")');
const stored = await opts.evaluate(async () => chrome.storage.local.get(["orbita:email:settings", "orbita:email:secrets", "orbita:modules"]));
assert.equal(stored["orbita:email:secrets"].apiKey, "re_live_123");
assert.equal(stored["orbita:modules"].email, true);
// o menu do painel mostra "E-mail" com o módulo ligado
await dash.bringToFront();
await dash.waitForSelector("aside nav >> text=E-mail", { timeout: 10000 });

// ---- página: lista vazia e configurada
await page.bringToFront();
await page.reload();
await page.waitForSelector("text=Resend conectada");
// uma pessoa já descadastrada localmente
await page.evaluate(() => OrbitaEmail.addSuppressions(["sai@fora.com"], "descadastro"));
await page.click('[data-a="new"] >> nth=0');

// ---- editor: prévia, variável não suportada, público
await page.fill("#fName", "Outubro");
await page.fill("#fSubject", "{{primeiro_nome}}, novidades de outubro");
await page.fill("#fPre", "Só esta semana");
await page.fill("#fBody", "Olá {{primeiro_nome|cliente}},\n\nChegou a coleção *nova*. Pedido {{pedido}}.");
await page.fill("#fBtnText", "Ver coleção");
await page.fill("#fBtnUrl", "https://loja.com/colecao");
await page.waitForSelector("#problems .warnbox");
assert.match(await page.locator("#problems").innerText(), /\{\{pedido\}\}/);
await page.fill("#fBody", "Olá {{primeiro_nome|cliente}},\n\nChegou a coleção *nova*.");
await page.waitForFunction(() => !document.querySelector("#problems .warnbox"));
const pv = await page.frameLocator("#pv").locator("body").innerText();
assert.match(pv, /Olá Maria/);
assert.match(pv, /Não quero mais receber/);
assert.match(await page.locator("#pvHead").innerText(), /Maria, novidades de outubro/);
await page.click('[data-a="count"]');
await page.waitForSelector("#countBox .count");
const counts = await page.locator("#countBox .count b").allInnerTexts();
console.log("público (recebem, sem e-mail, descadastrados):", counts);
assert.deepEqual(counts, ["3", "1", "1"]);
await page.screenshot({ path: shots + "/email-editor.png", fullPage: true });

// ---- teste para um endereço
page.once("dialog", (d) => d.accept("eu@loja.com"));
await page.click('[data-a="test"]');
await page.waitForSelector('.toast:has-text("Teste enviado")');
let calls = await page.evaluate(() => window.__rs.calls);
const test1 = calls.find((c) => c.path === "/emails");
assert.deepEqual(test1.body.to, ["eu@loja.com"]);
assert.match(test1.body.subject, /^\[Teste\] Maria, novidades/);

// ---- domínio não verificado: bloqueia com explicação
await page.evaluate(() => ((window.__rs.domainStatus = "pending"), window.__rsSave()));
await page.click('[data-a="send"]');
await page.waitForSelector('.toast:has-text("não está verificado")');
await page.evaluate(() => ((window.__rs.domainStatus = "verified"), (window.__rs.calls = []), window.__rsSave()));

// ---- envio: cai no meio (erro da Resend) e continua de onde parou
await page.evaluate(() => ((window.__rs.failEmail = "lead@ficha.com"), window.__rsSave()));
await page.click('[data-a="send"]');
await page.click('.dialog [data-a="yes"]');
await page.waitForSelector('[data-a="resume"]', { timeout: 30000 });
console.log("erro no meio:", await page.locator(".errbox").innerText());
await page.evaluate(() => ((window.__rs.failEmail = null), window.__rsSave()));
await page.click('[data-a="resume"]');
await page.waitForSelector('.toast:has-text("enviada para a Resend")', { timeout: 30000 });
calls = await page.evaluate(() => window.__rs.calls);
const seq = calls.map((c) => `${c.m} ${c.path.replace(/\?.*/, "")}`);
console.log("chamadas:", seq.join(" | "));
assert.equal(seq.filter((s) => s === "POST /segments").length, 1, "segmento criado uma vez só, mesmo retomando");
const bc = calls.find((c) => c.m === "POST" && c.path === "/broadcasts");
assert.equal(bc.body.segment_id, "seg1");
assert.equal(bc.body.from, "Loja Teste <contato@loja.com>");
assert.equal(bc.body.reply_to, "atendimento@loja.com");
assert.equal(bc.body.send, true);
assert.equal(bc.body.subject, "{{{contact.first_name|}}}, novidades de outubro");
assert.match(bc.body.html, /\{\{\{contact\.first_name\|cliente\}\}\}/);
assert.match(bc.body.html, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
// retomada: quem já foi cadastrado antes do erro não é cadastrado de novo
const adds = calls.filter((c) => c.m === "POST" && c.path === "/contacts").map((c) => c.body.email);
console.log("cadastros:", adds);
assert.equal(adds.filter((e) => e === "maria@cliente.com").length, 1);
const added = calls.filter((c) => c.m === "POST" && c.path === "/contacts" && c.body.segments).map((c) => c.body.email);
assert.ok(!added.includes("sai@fora.com"), "descadastrado não vai");
assert.ok(calls.some((c) => c.path === "/contacts/ja%40existe.com/segments/seg1"), "contato existente entra no segmento");
assert.ok(calls.every((c) => c.auth === "Bearer re_live_123"));
// CRM: histórico "E-mail: assunto" para quem é cliente
const h = await history("5511900000001");
assert.equal(h.at(-1).text, "E-mail: {{primeiro_nome}}, novidades de outubro");
assert.equal(h.at(-1).kind, "message");
// situação na Resend
await page.click('[data-a="refresh"]');
await page.waitForSelector('.chip.ok:has-text("Enviada")');
await page.screenshot({ path: shots + "/email-enviada.png" });

// ---- duplicar → agendar → cancelar
await page.click('[data-a="dup"]');
await page.check("#fSchedule");
await page.fill("#fWhen", new Date(Date.now() + 2 * 864e5 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
await page.dispatchEvent("#fWhen", "change");
await page.click('[data-a="send"]:has-text("Agendar")');
await page.click('.dialog [data-a="yes"]');
await page.waitForSelector('.chip:has-text("Agendada")', { timeout: 30000 });
calls = await page.evaluate(() => window.__rs.calls);
assert.ok(calls.filter((c) => c.path === "/broadcasts" && c.m === "POST").at(-1).body.scheduled_at);
await page.click('[data-a="cancel"]');
await page.click('.dialog [data-a="yes"]');
await page.waitForSelector('.chip:has-text("Cancelada")');
assert.ok((await page.evaluate(() => window.__rs.calls)).some((c) => c.m === "DELETE" && c.path.startsWith("/broadcasts/")));

// ---- lista de campanhas e descadastros sincronizados
await page.click('[data-a="back"]');
await page.waitForSelector(".camp");
console.log("campanhas:", (await page.locator(".camp").allInnerTexts()).map((t) => t.replace(/\n/g, " | ")));
assert.equal(await page.locator(".camp").count(), 2);
await page.screenshot({ path: shots + "/email-lista.png" });
// backup sem a chave
const bk = await dash.evaluate(async () => { const b = await OrbitaBackup.create(); return { key: "orbita:email:secrets" in b.storage, camps: (b.storage["orbita:email:campaigns"] || []).length }; });
assert.deepEqual(bk, { key: false, camps: 2 });
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("E-MAIL MARKETING OK");
