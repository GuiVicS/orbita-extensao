// Teste: ficha do lead (lead, oportunidade, atividades, marketing) no card do
// CRM do painel e no painel lateral das Conversas.
// Rodar: node tests/e2e/lead-form.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-lead";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 1000 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
const PHONE = "5511999998888";
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push(e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.waitForTimeout(1200);
await dash.evaluate(() => chrome.storage.local.set({ "orbita:modules": { crm: true, agenda: false } }));
await dash.evaluate((phone) => new Promise((res) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const tx = r.result.transaction(["listContacts", "lists", "crmStages", "crmClients"], "readwrite");
  tx.objectStore("crmStages").clear(); tx.objectStore("crmStages").put({ id: "s1", name: "Novo", color: "#0ea5e9", order: 0 }); tx.objectStore("crmStages").put({ id: "s2", name: "Negociação", color: "#f59e0b", order: 1 });
  tx.objectStore("lists").put({ id: "l1", name: "Clientes", count: 1, variableKeys: [], createdAt: 1, updatedAt: 1 });
  tx.objectStore("listContacts").put({ id: `l1:${phone}`, listId: "l1", phone, name: "John Smith", vars: {}, order: 0 });
  tx.objectStore("crmClients").put({ phone, stageId: "s2", tags: ["importado"], history: [{ id: "h0", ts: 1000, kind: "note", text: "nota antiga" }], autoReply: true, updatedAt: 1 });
  tx.oncomplete = res; }; }), PHONE);
const readClient = () => dash.evaluate((p) => new Promise((res) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const q = r.result.transaction("crmClients").objectStore("crmClients").get(p); q.onsuccess = () => res(q.result); }; }), PHONE);
const until = async (fn, what) => {
  for (let i = 0; i < 60; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("tempo esgotado: " + what);
};

// ---- painel: card do cliente no CRM
await dash.goto(`chrome-extension://${id}/dashboard.html#/crm`);
await dash.reload();
await dash.click(`[data-phone="${PHONE}"]`);
const form = dash.locator('[data-testid="lead-form"]');
await form.locator(".olf").waitFor();
console.log("seções:", await form.locator("summary").allInnerTexts());
// seções fechadas por padrão (exceto Lead): abre todas
for (const s of ["deal", "act", "utm"]) await form.locator(`[data-sec="${s}"] > summary`).click();

const fill = async (sel, v) => {
  await form.locator(sel).fill(v);
  await form.locator(sel).press("Tab");
};
await fill('[data-g="lead"][data-k="email"]', "john@acme.com");
await fill('[data-g="lead"][data-k="company"]', "ACME Ltda");
await fill('[data-g="lead"][data-k="source"]', "Instagram");
await fill('[data-g="lead"][data-k="owner"]', "Profeta");
await fill('[data-g="lead"][data-k="product"]', "Impressão 3D");
await fill('[data-g="lead"][data-k="potentialValue"]', "1.500,50");
await fill('[data-g="lead"][data-k="notes"]', "Quer orçamento\npara 200 peças.");
await form.locator('[data-temp="quente"]').click();
await form.locator('[data-g="lead"][data-k="status"]').selectOption("qualificado");
await fill('[data-g="deal"][data-k="value"]', "R$ 2.000");
await fill('[data-g="deal"][data-k="probability"]', "140"); // limita a 100
await fill('[data-g="deal"][data-k="probability"]', "60");
await form.locator('[data-g="deal"][data-k="expectedCloseAt"]').fill("2026-10-15");
await form.locator('[data-g="deal"][data-k="expectedCloseAt"]').dispatchEvent("change");
await fill('[data-g="utm"][data-k="source"]', "instagram");
await fill('[data-g="utm"][data-k="medium"]', "social");
await fill('[data-g="utm"][data-k="campaign"]', "setembro");
await fill('[data-g="utm"][data-k="landingPage"]', "https://stellarprint.com.br/orcamento");

let rec = await until(async () => { const r = await readClient(); return r.utm?.landingPage && r.deal?.expectedCloseAt && r; }, "campos gravados");
console.log("lead:", rec.lead, "\ndeal:", rec.deal, "\nutm:", rec.utm);
assert.deepEqual(rec.lead, { email: "john@acme.com", company: "ACME Ltda", source: "Instagram", owner: "Profeta", product: "Impressão 3D", potentialValue: 1500.5, notes: "Quer orçamento\npara 200 peças.", temperature: "quente", status: "qualificado" });
assert.deepEqual(rec.deal, { value: 2000, probability: 60, expectedCloseAt: "2026-10-15" });
assert.equal(rec.utm.campaign, "setembro");
// campos antigos do CRM preservados
assert.deepEqual([rec.stageId, rec.tags, rec.autoReply, rec.history.length], ["s2", ["importado"], true, 1]);
assert.equal((await form.locator('[data-g="lead"][data-k="potentialValue"]').inputValue()).replace(/\s/g, " "), "R$ 1.500,50");
assert.match(await form.locator('[data-sec="deal"]').innerText(), /Valor ponderado:\s*R\$\s*1\.200,00/);
assert.equal(await form.locator('[data-sec="deal"] input[readonly]').inputValue(), "Negociação");

// perdido → aparece o motivo de perda
assert.equal(await form.locator('[data-k="lostReason"]').count(), 0);
await form.locator('[data-g="lead"][data-k="status"]').selectOption("perdido");
await fill('[data-g="deal"][data-k="lostReason"]', "Preço");
rec = await until(async () => { const r = await readClient(); return r.deal?.lostReason && r; }, "motivo de perda");
assert.equal(rec.lead.status, "perdido");

// apagar um campo remove a chave
await fill('[data-g="lead"][data-k="company"]', "");
rec = await until(async () => { const r = await readClient(); return !("company" in r.lead) && r; }, "empresa apagada");

// atividade
await form.locator('[data-a="type"]').selectOption("ligacao");
await form.locator('[data-a="description"]').fill("Ligou pedindo prazo");
await form.locator('[data-a="result"]').fill("Pediu proposta");
await form.locator('[data-a="nextAction"]').fill("Enviar proposta");
await form.locator('[data-a="nextAt"]').fill("2026-10-01T10:00");
await form.locator('[data-act="add"]').click();
await form.locator(".olf-act").first().waitFor();
rec = await readClient();
const act = rec.history.find((h) => h.activity);
console.log("atividade:", act.kind, JSON.stringify(act.text), act.activity);
assert.equal(act.kind, "call");
assert.equal(act.activity.owner, "Profeta"); // responsável do lead vira o padrão
assert.equal(act.activity.nextAction, "Enviar proposta");
assert.equal(rec.lastInteractionAt, act.ts);
assert.match(await form.locator(".olf-next").innerText(), /Enviar proposta/);
// atividade sem descrição nem resultado é recusada
await form.locator('[data-act="add"]').click();
await form.locator(".olf-err").waitFor();
// o histórico do painel mostra a atividade (kind "call" = Ligação)
await dash.waitForSelector('li:has-text("Ligou pedindo prazo")');
console.log("histórico do painel:", (await dash.locator('li:has-text("Ligou pedindo prazo")').innerText()).replace(/\n/g, " | "));
await dash.screenshot({ path: shots + "/ficha-lead-painel.png", fullPage: true });

// fechar o card: selos no Kanban
await dash.keyboard.press("Escape");
const card = dash.locator(`[data-phone="${PHONE}"] .olf-badges`);
await card.locator("span").nth(1).waitFor();
console.log("selos do card:", await card.innerText());
assert.match(await card.innerText(), /Quente/);
assert.match(await card.innerText(), /2\.000,00/);

// ---- Conversas: mesma ficha no painel lateral, sem nome/número duplicados
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/conversas.html`);
await page.waitForSelector(".status.ready", { timeout: 15000 });
await page.click(".item >> text=John Smith");
await page.waitForSelector("#leadForm .olf");
assert.equal(await page.locator('#leadForm [data-g="id"]').count(), 0);
assert.equal(await page.inputValue('#leadForm [data-k="email"]'), "john@acme.com");
await page.locator('#leadForm [data-temp="morno"]').click();
rec = await until(async () => { const r = await readClient(); return r.lead.temperature === "morno" && r; }, "temperatura pela conversa");
// o painel (outra aba) recebe o aviso e atualiza o selo
await dash.bringToFront();
await until(async () => /Morno/.test(await card.innerText()), "selo atualizado no painel");
await page.bringToFront();
await page.screenshot({ path: shots + "/ficha-lead-conversas.png" });

// excluir a atividade
page.once("dialog", (d) => d.accept());
await page.locator("#leadForm [data-sec=act] > summary").click().catch(() => {});
if (!(await page.locator("#leadForm [data-del]").isVisible())) await page.locator("#leadForm [data-sec=act] > summary").click();
await page.locator("#leadForm [data-del]").first().click();
rec = await until(async () => { const r = await readClient(); return !r.history.some((h) => h.activity) && r; }, "atividade excluída");
assert.equal(rec.lastInteractionAt, 1000);

console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("FICHA DO LEAD OK");
