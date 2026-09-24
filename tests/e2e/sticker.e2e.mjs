// Teste: figurinhas aparecem como no WhatsApp (imagem sem balão, baixada sozinha).
// Rodar: node tests/e2e/sticker.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-stk";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
const wa = await ctx.newPage();
await wa.addInitScript(() => (window.__stickers = true));
await wa.goto("https://web.whatsapp.com/");
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/conversas.html`);
await page.waitForSelector(".status.ready", { timeout: 15000 });
await page.click(".item >> text=John Smith");
// as duas figurinhas carregam sozinhas, sem clique
await page.waitForFunction(() => [...document.querySelectorAll(".b.sticker .stk img")].filter((i) => i.src.startsWith("blob:") && i.complete && i.naturalWidth > 0).length === 2, null, { timeout: 15000 });
const info = await page.evaluate(() =>
  [...document.querySelectorAll(".b.sticker")].map((b) => {
    const cs = getComputedStyle(b);
    const img = b.querySelector(".stk img");
    return { me: b.classList.contains("me"), bg: cs.backgroundColor, shadow: cs.boxShadow, w: img.getBoundingClientRect().width, meta: getComputedStyle(b.querySelector(".meta")).position, clickable: Boolean(b.querySelector("[data-view]")) };
  }),
);
console.log("figurinhas:", info);
assert.equal(info.length, 2);
assert.deepEqual(info.map((i) => i.me), [false, true]);
for (const i of info) {
  assert.equal(i.bg, "rgba(0, 0, 0, 0)"); // sem balão
  assert.equal(i.shadow, "none");
  assert.equal(i.w, 190);
  assert.equal(i.meta, "absolute"); // horário sobre a figurinha
  assert.equal(i.clickable, false);
}
// baixadas uma vez só; ao redesenhar a conversa não baixa de novo
const dl = () => wa.evaluate(() => (window.__dlIds || []).filter((i) => i.includes("_stk")).length);
assert.equal(await dl(), 2);
await page.evaluate(() => document.getElementById("msgs").scrollTo(0, 1e6));
await page.waitForTimeout(400);
await page.locator(".b.sticker").last().scrollIntoViewIfNeeded();
await page.screenshot({ path: shots + "/figurinhas.png" });
// trocar de conversa e voltar: vem do cache local
await page.click(".item >> text=Carla Souza");
await page.click(".item >> text=John Smith");
await page.waitForFunction(() => [...document.querySelectorAll(".b.sticker .stk img")].filter((i) => i.src.startsWith("blob:")).length === 2, null, { timeout: 10000 });
assert.equal(await dl(), 2);
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("FIGURINHAS OK");
