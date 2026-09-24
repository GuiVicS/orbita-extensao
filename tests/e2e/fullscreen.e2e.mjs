// Teste: "tela cheia" do chat = ocupar a página inteira do painel (não o monitor).
// Rodar: node tests/e2e/fullscreen.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-full";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 860 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push(e.message));
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
await dash.bringToFront();
await dash.goto(`chrome-extension://${id}/dashboard.html#/conversas`);
const iframeRect = () => dash.evaluate(() => { const r = document.querySelector('iframe[title="Conversas"]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, browserFullscreen: Boolean(document.fullscreenElement) }; });
let frame = await (await dash.waitForSelector('iframe[title="Conversas"]')).contentFrame();
await frame.waitForSelector(".status.ready", { timeout: 15000 });
await frame.click(".item >> text=John Smith");
await frame.waitForSelector(".b");
const normal = await iframeRect();
console.log("normal:", normal);
assert.ok(normal.x > 200, "com o menu do painel ao lado");

await frame.click("#fullBtn");
await dash.waitForTimeout(300);
const exp = await iframeRect();
console.log("expandido:", exp, "| menu visível no ponto (100,300):", await dash.evaluate(() => document.elementFromPoint(100, 300)?.tagName));
assert.deepEqual([exp.x, exp.y, exp.w, exp.h], [0, 0, exp.vw, exp.vh], "o chat ocupa a página inteira");
assert.equal(exp.browserFullscreen, false, "não usa a tela cheia do navegador/monitor");
assert.equal(await dash.evaluate(() => document.elementFromPoint(100, 300)?.tagName), "IFRAME", "o menu do painel fica coberto");
await dash.screenshot({ path: shots + "/tela-cheia.png" });

// digitar continua funcionando; Esc volta ao normal
await frame.fill("#text", "Teste na página inteira");
await frame.press("#text", "Escape");
await dash.waitForTimeout(200);
const back = await iframeRect();
console.log("depois do Esc:", back, "| texto mantido:", await frame.inputValue("#text"));
assert.equal(back.x, normal.x);

// a escolha é lembrada: expandir, recarregar o painel, continua expandido
await frame.click("#fullBtn");
await dash.reload();
frame = await (await dash.waitForSelector('iframe[title="Conversas"]')).contentFrame();
await frame.waitForSelector("#fullBtn.on", { timeout: 10000 });
const again = await iframeRect();
console.log("após recarregar:", again);
assert.equal(again.w, again.vw);
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("TELA CHEIA OK");
