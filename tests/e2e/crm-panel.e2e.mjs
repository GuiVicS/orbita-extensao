// Teste: resumo do CRM editável no painel lateral das Conversas.
// Rodar: node tests/e2e/crm-panel.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-crm";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push(e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.waitForTimeout(1200);
await dash.evaluate(() => chrome.storage.local.set({ "orbita:modules": { crm: true, agenda: true } }));
await dash.evaluate(() => new Promise((res) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const tx = r.result.transaction(["listContacts", "lists", "crmStages", "crmClients"], "readwrite");
  tx.objectStore("crmStages").clear(); tx.objectStore("crmStages").put({ id: "s1", name: "Novo", color: "#0ea5e9", order: 0 }); tx.objectStore("crmStages").put({ id: "s2", name: "Negociação", color: "#f59e0b", order: 1 });
  tx.objectStore("lists").put({ id: "l1", name: "Clientes", count: 1, variableKeys: [], createdAt: 1, updatedAt: 1 });
  tx.objectStore("listContacts").put({ id: "l1:5511999998888", listId: "l1", phone: "5511999998888", name: "John Smith", vars: {}, order: 0 });
  tx.objectStore("crmClients").put({ phone: "5511999998888", stageId: "s1", tags: ["importado"], history: [], updatedAt: 1 });
  tx.oncomplete = res; }; }));
// quantos avisos "orbita-data" o painel recebe (o CRM do painel escuta este canal)
await dash.evaluate(() => { window.__notes = []; new BroadcastChannel("orbita-data").onmessage = (e) => window.__notes.push(e.data); });
const readClient = (phone) => dash.evaluate((p) => new Promise((res) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const q = r.result.transaction("crmClients").objectStore("crmClients").get(p); q.onsuccess = () => res(q.result); }; }), phone);
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
await dash.bringToFront();
const page = await ctx.newPage(); // o chat aberto sozinho numa aba (mesma página do iframe)
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/conversas.html`);
await page.waitForSelector(".status.ready", { timeout: 15000 });
await page.click(".item >> text=John Smith");
await page.waitForSelector("#crmStage");
console.log("etapa inicial:", await page.inputValue("#crmStage"));

await page.selectOption("#crmStage", "s2");
await page.waitForFunction(() => document.getElementById("crmStage")?.value === "s2" && document.querySelector(".stagesel i").style.background.includes("245"));
let rec = await readClient("5511999998888");
console.log("etapa gravada:", rec.stageId, "|", rec.history.at(-1).text);
assert.equal(rec.stageId, "s2");
assert.equal(rec.history.at(-1).text, "Movido de “Novo” para “Negociação”.");

await page.fill("#crmTag", "VIP");
await page.press("#crmTag", "Enter");
await page.waitForSelector('.tags.edit span:has-text("VIP")');
await page.fill("#crmTag", "vip"); // repetida (maiúsculas diferentes) não entra
await page.press("#crmTag", "Enter");
await page.waitForTimeout(600);
rec = await readClient("5511999998888");
console.log("tags:", rec.tags);
assert.deepEqual(rec.tags, ["importado", "VIP"]);
await page.click('[data-crm="untag"][data-tag="importado"]');
await page.waitForFunction(() => !document.querySelector('[data-tag="importado"]'));

await page.fill("#crmNote", "Pediu desconto à vista.");
await page.click('[data-crm="note"]');
await page.waitForSelector('.note:has-text("Pediu desconto à vista.")');
rec = await readClient("5511999998888");
const note = rec.history.find((h) => h.kind === "note");
console.log("nota:", note.text, "| lastInteractionAt:", rec.lastInteractionAt === note.ts);
assert.equal(rec.lastInteractionAt, note.ts);

await page.check("#crmAuto");
for (let i = 0; i < 50 && !(rec = await readClient("5511999998888")).autoReply; i++) await new Promise((r) => setTimeout(r, 100));
console.log("IA ligada:", rec.autoReply, "|", rec.history.at(-1).text);
assert.equal(rec.autoReply, true);

await page.click('[data-crm="editname"]');
await page.fill("#crmName", "John Smith Jr.");
await page.press("#crmName", "Enter");
await page.waitForSelector('.side .top b:has-text("John Smith Jr.")');
console.log("nome na lista de conversas:", await page.locator(".item .name").first().innerText());
await page.screenshot({ path: shots + "/crm-painel.png" });

page.once("dialog", (d) => d.accept());
await page.locator('.note:has-text("Pediu desconto à vista.") [data-crm="delnote"]').click();
await page.waitForFunction(() => ![...document.querySelectorAll(".side .note")].some((n) => n.textContent.includes("Pediu desconto")));
rec = await readClient("5511999998888");
console.log("notas restantes:", rec.history.filter((h) => h.kind === "note").map((h) => h.text));
assert.ok(!rec.history.some((h) => h.text === "Pediu desconto à vista."));

// contato fora das listas → Adicionar ao CRM
await page.click(".item >> text=Carla Souza");
await page.waitForSelector('[data-crm="add"]');
await page.click('[data-crm="add"]');
await page.waitForSelector("#crmStage");
const carla = await dash.evaluate(() => new Promise((res) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const tx = r.result.transaction(["lists", "listContacts"]); const a = tx.objectStore("lists").getAll(); const b = tx.objectStore("listContacts").getAll(); tx.oncomplete = () => res({ list: a.result.find((l) => l.name === "Adicionados pelo WhatsApp"), contact: b.result.find((c) => c.phone === "5511912345678") }); }; }));
console.log("adicionada:", carla.list?.name, carla.list?.count, "|", carla.contact?.id === `${carla.list?.id}:5511912345678`, carla.contact?.name);
assert.equal(carla.contact.name, "Carla Souza");
console.log("selo:", await page.locator(".thead .chip").innerText());

// contato sem número e módulo desligado
await page.click(".item >> text=Anna");
await page.waitForSelector('.side:has-text("não mostra o número")');
await dash.evaluate(() => chrome.storage.local.set({ "orbita:modules": { crm: false } }));
await page.click(".item >> text=John Smith");
await page.waitForSelector('.side:has-text("Ative o módulo CRM")');
const notes = await dash.evaluate(() => window.__notes);
console.log("avisos orbita-data:", notes.length, [...new Set(notes.map((n) => n.topic))]);
assert.ok(notes.some((n) => n.topic === "crm" && n.id === "5511999998888"));
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("CRM EDITÁVEL OK");
