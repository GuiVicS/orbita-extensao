// Teste da Fase 2 (tela de Conversas). Rodar: node tests/e2e/conversas-ui.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-ui";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 860 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push("dash: " + e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.waitForTimeout(1200);
await dash.evaluate(() => new Promise((res) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const tx = r.result.transaction(["listContacts", "crmStages", "crmClients"], "readwrite"); tx.objectStore("listContacts").put({ id: "c1", listId: "l1", phone: "5511999998888", name: "John Smith", vars: {} }); tx.objectStore("crmStages").put({ id: "s2", name: "Negociação", color: "#f59e0b", order: 2 }); tx.objectStore("crmClients").put({ phone: "5511999998888", stageId: "s2", tags: ["importado", "EUA"], notes: [{ ts: Date.now() - 864e5, text: "Quer preço em dólar." }] }); tx.oncomplete = res; }; }));
const wa = await ctx.newPage();
wa.on("pageerror", (e) => errors.push("wa: " + e.message));
await wa.goto("https://web.whatsapp.com/");
await dash.bringToFront();
await dash.goto(`chrome-extension://${id}/dashboard.html#/conversas`);
const f = dash.frameLocator('iframe[title="Conversas"]');
await f.locator(".status.ready").waitFor({ timeout: 15000 });
await f.locator(".item").nth(2).waitFor();
console.log("lista:", await f.locator(".item .name").allInnerTexts());
await f.locator(".item", { hasText: "John Smith" }).click();
await f.locator(".b", { hasText: "Can you send the price?" }).waitFor();
await dash.waitForTimeout(400);
await dash.screenshot({ path: shots + "/conversas-light.png" });
console.log("painel:", (await f.locator("#side").innerText()).replace(/\s+/g, " ").slice(0, 160));
// enviar com Enter
await f.locator("#text").fill("Sure! The price is US$ 20.\nShipping included.");
await f.locator("#text").press("Enter");
await f.locator(".b.me", { hasText: "Shipping included." }).waitFor();
await dash.waitForTimeout(800);
assert.equal(await f.locator(".b.me", { hasText: "Shipping included." }).count(), 1, "sem bolha duplicada");
// recebida ao vivo
await wa.evaluate(() => { const m = __mk("5511999998888@c.us", 50, false, "Great, thanks! *Deal*", Date.now() / 1000 | 0, 0); __store["5511999998888@c.us"].push(m); __fire("chat.new_message", m); });
await f.locator(".b", { hasText: "Great, thanks!" }).waitFor();
// não lida em outra conversa
await wa.evaluate(() => { const m = __mk("123456789@lid", 9, false, "Hello again", Date.now() / 1000 | 0, 0); __store["123456789@lid"].push(m); __fire("chat.new_message", m); });
await f.locator(".item", { hasText: "Anna" }).locator(".badge").waitFor();
console.log("badge Anna:", await f.locator(".item", { hasText: "Anna" }).locator(".badge").innerText(), "| topo da lista:", await f.locator(".item .name").first().innerText());
// rolagem com mensagens antigas
await f.locator(".item", { hasText: "Carla Souza" }).click();
await f.locator(".b", { hasText: "Mensagem número 120" }).waitFor();
const n1 = await f.locator(".b").count();
await f.locator("#msgs").evaluate((el) => (el.scrollTop = 0));
await f.locator(".b", { hasText: "Mensagem número 1" }).first().waitFor({ timeout: 10000 }).catch(() => {});
await dash.waitForTimeout(1500);
await f.locator("#msgs").evaluate((el) => (el.scrollTop = 0));
await dash.waitForTimeout(1500);
const n2 = await f.locator(".b").count();
console.log("rolagem:", n1, "→", n2, "| início:", await f.locator(".older").first().innerText());
assert.ok(n2 > n1);
// tema escuro
await dash.evaluate(() => document.documentElement.classList.add("dark"));
await f.locator(".item", { hasText: "John Smith" }).click();
await f.locator(".b", { hasText: "Great, thanks!" }).waitFor();
await dash.waitForTimeout(500);
await dash.screenshot({ path: shots + "/conversas-dark.png" });
// WhatsApp fechado
await wa.close();
await f.locator(".status:not(.ready)").waitFor();
console.log("composer desativado:", await f.locator("#text").isDisabled(), "|", await f.locator("#text").getAttribute("placeholder"));
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("FASE 2 OK");
