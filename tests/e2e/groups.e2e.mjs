// Teste: grupos nas Conversas (lista, remetentes, participantes) e listas de
// contatos criadas a partir dos grupos. Rodar: node tests/e2e/groups.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-groups";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
const G = "120363000000000001@g.us";
// o painel cria o banco "orbita" (onde ficam as listas)
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push(e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/contatos`);
await dash.waitForTimeout(1200);
const lists = () => dash.evaluate(() => new Promise((res) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const tx = r.result.transaction(["lists", "listContacts"]); const a = tx.objectStore("lists").getAll(); const b = tx.objectStore("listContacts").getAll(); tx.oncomplete = () => res(a.result.map((l) => ({ ...l, contacts: b.result.filter((c) => c.listId === l.id) }))); }; }));
const wa = await ctx.newPage();
await wa.addInitScript(() => (window.__groups = true));
await wa.goto("https://web.whatsapp.com/");
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/conversas.html`);
await page.waitForSelector(".status.ready", { timeout: 15000 });

// ---- lista: grupos junto com as conversas, com a prévia "Nome: …"
await page.waitForSelector('.item:has-text("Clientes VIP")');
const prev = await page.locator('.item:has-text("Clientes VIP") .prev').innerText();
console.log("prévia do grupo:", prev);
assert.equal(prev.trim(), "Pedro: Quero ver também");
await page.click('.filters [data-filter="groups"]');
const names = await page.locator(".item .name").allInnerTexts();
console.log("filtro Grupos:", names);
assert.deepEqual(names.sort(), ["Clientes VIP", "Família"]);

// ---- conversa do grupo: quem mandou cada mensagem
await page.click('.item:has-text("Clientes VIP")');
await page.waitForSelector(".b .who");
const who = await page.locator(".b .who").allInnerTexts();
console.log("remetentes:", who.map((w) => w.replace(/\n/g, " ")));
assert.equal(who.length, 3); // John aparece uma vez para as duas seguidas
assert.match(who[0], /^John Smith/);
assert.match(who[1], /^Maria Souza/);
assert.match(who[2], /^Pedro/);
assert.match(await page.locator("#thead small").innerText(), /Grupo/);

// ---- painel do grupo: participantes, números e lista de contatos
await page.waitForSelector(".side .gp");
await page.waitForFunction(() => /5 participantes/.test(document.querySelector("#thead small").textContent));
const people = await page.locator(".side .gp").allInnerTexts();
console.log("participantes:", people.map((p) => p.replace(/\n/g, " · ")));
assert.equal(people.length, 5);
assert.match(people[0], /Você/);
assert.ok(people.some((p) => /Pedro[\s\S]*\+55 \(21\) 98888-7777/.test(p)), "@lid com número conhecido mostra o número");
assert.ok(people.some((p) => /Número oculto/.test(p)));
assert.match(await page.locator('[data-grp="save"]').innerText(), /3 contatos/);
assert.match(await page.locator(".side .card").innerText(), /1 participante está com o número oculto/);
await page.screenshot({ path: shots + "/grupo-painel.png" });
await page.click('[data-grp="save"]');
await page.waitForSelector('.toast:has-text("criada com 3 contatos")');
let L = (await lists()).find((l) => l.groupId === G);
console.log("lista:", L.name, L.source, L.count, L.variableKeys, L.contacts.map((c) => `${c.name}/${c.phone}/${c.vars.admin}`));
assert.deepEqual([L.name, L.source, L.count], ["Grupo: Clientes VIP", "whatsapp-group", 3]);
assert.deepEqual(L.contacts.map((c) => c.phone).sort(), ["5511977776666", "5511999998888", "5521988887777"]);
assert.equal(L.contacts.find((c) => c.phone === "5511999998888").vars.admin, "sim");
assert.equal(L.contacts.find((c) => c.phone === "5511999998888").vars.grupo, "Clientes VIP");
await page.waitForSelector('[data-grp="save"]:has-text("Atualizar lista")');

// entrou alguém no grupo: "Atualizar lista" acrescenta só o novo
await wa.evaluate(() => { window.__contacts["5541933332222@c.us"] = { name: "Novo Cliente" }; window.__parts["120363000000000001@g.us"].push({ id: { _serialized: "5541933332222@c.us" } }); });
await page.click('.side h3 [data-grp="reload"]');
await page.waitForFunction(() => document.querySelectorAll(".side .gp").length === 6);
await page.click('[data-grp="save"]');
await page.waitForSelector('.toast:has-text("1 contato novo")');
L = (await lists()).find((l) => l.groupId === G);
assert.equal(L.count, 4);

// ---- enviar mensagem no grupo
await page.fill("#text", "Olá, grupo!");
await page.press("#text", "Enter");
await wa.waitForFunction((g) => __store[g].some((m) => m.body === "Olá, grupo!" && m.id.fromMe), G);

// ---- vários grupos de uma vez
await page.click("#grpImport");
await page.waitForSelector(".girow");
assert.equal(await page.locator(".girow").count(), 2);
await page.check("#giAll");
await page.click('.dialog [data-a="go"]');
await page.waitForSelector('.toast:has-text("2 listas prontas")');
const all = (await lists()).filter((l) => l.source === "whatsapp-group");
console.log("listas de grupos:", all.map((l) => `${l.name} (${l.count})`));
assert.equal(all.length, 2); // Clientes VIP não duplica
assert.equal(all.find((l) => l.name === "Grupo: Família").count, 2);

// as listas aparecem em Contatos, com o ícone de grupo
await dash.bringToFront();
await dash.reload();
await dash.waitForSelector('text=Grupo: Família');
await dash.screenshot({ path: shots + "/grupo-listas-contatos.png" });
await page.bringToFront();

// participante com conversa aberta: clique abre a conversa dele
await page.click('.item:has-text("Clientes VIP")');
await page.waitForSelector('.side .gp.link');
await page.click('.side .gp.link:has-text("John Smith")');
await page.waitForFunction(() => document.querySelector("#thead b")?.textContent === "John Smith");
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("GRUPOS OK");
