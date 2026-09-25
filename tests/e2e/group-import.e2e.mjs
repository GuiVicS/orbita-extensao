// Teste: Contatos → Importar → Do WhatsApp → Grupos (só os participantes dos grupos).
// Rodar: node tests/e2e/group-import.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-gimport";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 950 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push(e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/contatos`);
await dash.waitForTimeout(1000);
// funciona mesmo com as Conversas desligadas
await dash.evaluate(() => chrome.storage.local.set({ "orbita:modules": { conversas: false } }));
const wa = await ctx.newPage();
await wa.addInitScript(() => ((window.__groups = true), (window.__lidResolve = true)));
await wa.goto("https://web.whatsapp.com/");
await dash.bringToFront();
const lists = () => dash.evaluate(() => new Promise((res) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const tx = r.result.transaction(["lists", "listContacts"]); const a = tx.objectStore("lists").getAll(); const b = tx.objectStore("listContacts").getAll(); tx.oncomplete = () => res(a.result.map((l) => ({ ...l, contacts: b.result.filter((c) => c.listId === l.id) }))); }; }));

await dash.getByRole("button", { name: /Importar contatos/ }).first().click();
await dash.getByRole("tab", { name: /Do WhatsApp/ }).click();
await dash.waitForSelector(".ogi-seg");
assert.equal(await dash.getByText("Importar da agenda e das conversas do WhatsApp Web").isVisible(), true);
// Grupos: o conteúdo original some e aparecem os grupos
await dash.click('.ogi-seg [data-m="groups"]');
await dash.waitForSelector(".ogi-row input[data-g]", { timeout: 20000 });
assert.equal(await dash.getByText("Importar da agenda e das conversas do WhatsApp Web").isVisible(), false);
const rows = await dash.locator(".ogi-row b").allInnerTexts();
console.log("grupos:", rows);
assert.deepEqual(rows, ["Clientes VIP", "Família"]);
await dash.fill('.ogi [data-a="q"]', "vip");
assert.deepEqual(await dash.locator(".ogi-row b").allInnerTexts(), ["Clientes VIP"]);
await dash.fill('.ogi [data-a="q"]', "");

// uma lista por grupo
await dash.check('.ogi-row:has-text("Clientes VIP") input');
assert.match(await dash.locator('.ogi [data-a="go"]').innerText(), /Importar 1 grupo \(~5 participantes\)/);
await dash.screenshot({ path: shots + "/importar-grupos.png" });
await dash.click('.ogi [data-a="go"]');
await dash.waitForSelector(".ogi-done");
console.log("resultado:", (await dash.locator(".ogi-done").innerText()).replace(/\n/g, " | "));
let L = (await lists()).find((l) => l.name === "Grupo: Clientes VIP");
// o participante oculto foi consultado um por um e o número apareceu
console.log("consultas de número:", await wa.evaluate(() => window.__pnCalls));
assert.deepEqual(await wa.evaluate(() => window.__pnCalls), ["99999@lid"]);
assert.equal(L.count, 4);
assert.deepEqual(L.contacts.map((c) => c.phone).sort(), ["5511977776666", "5511999998888", "5521988887777", "5548911112222"]);

// tudo numa lista só, sem repetidos (Maria está nos dois grupos)
await dash.check("#giAll, .ogi-all input");
await dash.check('.ogi [data-a="merge"]');
await dash.fill('.ogi [data-a="name"]', "Todos os grupos");
await dash.click('.ogi [data-a="go"]');
await dash.waitForSelector('.ogi-done:has-text("Todos os grupos")');
L = (await lists()).find((l) => l.name === "Todos os grupos");
console.log("lista única:", L.count, L.contacts.map((c) => `${c.name} (${c.vars.grupo})`));
assert.equal(L.count, 5);
assert.equal(L.source, "whatsapp-group");
assert.equal(new Set(L.contacts.map((c) => c.phone)).size, 5);
await dash.screenshot({ path: shots + "/importar-grupos-pronto.png" });

// voltar para "Agenda e conversas": o conteúdo original volta
await dash.click('.ogi-seg [data-m="wa"]');
assert.equal(await dash.getByText("Importar da agenda e das conversas do WhatsApp Web").isVisible(), true);
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("IMPORTAR GRUPOS OK");
