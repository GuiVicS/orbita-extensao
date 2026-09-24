// Teste: painel de emojis e figurinhas, sugestões ":", emojis grandes e
// coleção de figurinhas (recebidas, criadas, favoritas, envio).
// Rodar: node tests/e2e/emoji-sticker.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-emoji";
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
await page.waitForSelector("#emojiBtn");

// ---- painel de emojis
await page.click("#emojiBtn");
await page.waitForSelector(".pk-grid .pk-e");
const stats = await page.evaluate(() => ({ cats: document.querySelectorAll(".pk-cats button").length, emojis: document.querySelectorAll(".pk-grid section:not([data-sec=results]) .pk-e").length, focus: document.activeElement.getAttribute("aria-label") }));
console.log("painel:", stats);
assert.equal(stats.cats, 10);
assert.ok(stats.emojis > 1500);
assert.equal(stats.focus, "Pesquisar emoji");
await page.waitForTimeout(250);
await page.screenshot({ path: shots + "/emoji-painel.png" });
// busca em português + Enter insere o primeiro
await page.fill(".pk-search input", "polegar cima");
const res = await page.locator('[data-sec="results"] .pk-e').allInnerTexts();
console.log("busca 'polegar cima':", res.slice(0, 5).join(" "));
assert.equal(res[0], "👍");
await page.press(".pk-search input", "Enter");
assert.equal(await page.inputValue("#text"), "👍");
await page.fill(".pk-search input", "coracao"); // sem acento também acha
assert.ok((await page.locator('[data-sec="results"] .pk-e').allInnerTexts()).includes("❤️"));
await page.fill(".pk-search input", "xyzxyz");
assert.equal(await page.isVisible(".pk-empty"), true);
await page.fill(".pk-search input", "");
// tom de pele
await page.click(".pk-tone");
await page.click('.pk-tones [data-tone="3"]');
const thumb = await page.locator('.pk-grid [data-sec="people"] .pk-e[data-e="👍"]').innerText();
console.log("com tom:", thumb);
assert.equal(thumb, "👍🏽");
await page.click('.pk-grid [data-sec="people"] .pk-e[data-e="👍"]');
assert.equal(await page.inputValue("#text"), "👍👍🏽");
assert.equal(await page.evaluate(() => document.activeElement.id), "text"); // o cursor volta ao campo
// categoria: rola até as bandeiras e destaca a aba
await page.click('.pk-cats [data-cat="flags"]');
await page.waitForFunction(() => document.querySelector('.pk-cats [data-cat="flags"]').classList.contains("on"), null, { timeout: 5000 });
// recentes: reabrindo, aparecem no topo
await page.keyboard.press("Escape");
assert.equal(await page.isHidden("#picker"), true);
await page.click("#emojiBtn");
const recent = await page.locator('[data-sec="recent"] .pk-e').allInnerTexts();
console.log("recentes:", recent.join(" "));
assert.deepEqual(recent.slice(0, 1), ["👍🏽"]);
await page.click("#emojiBtn"); // fecha
await page.fill("#text", "");

// ---- ":nome" enquanto digita
await page.focus("#text");
await page.keyboard.type("oi :foguet");
await page.waitForSelector("#emsug [data-sug]");
console.log("sugestões:", (await page.locator("#emsug [data-sug] span").allInnerTexts()).join(" "));
await page.keyboard.press("Enter");
assert.equal(await page.inputValue("#text"), "oi 🚀");
assert.equal(await page.isHidden("#emsug"), true);
await page.fill("#text", "");
// horário não abre sugestão
await page.keyboard.type("às 10:30");
assert.equal(await page.isHidden("#emsug"), true);
await page.fill("#text", "");

// ---- mensagem só com emoji: grande
await page.keyboard.type("😂");
await page.keyboard.press("Enter");
await page.waitForSelector(".b.me.jumbo.j1");
await page.keyboard.type("😂 ok");
await page.keyboard.press("Enter");
await page.waitForFunction(() => [...document.querySelectorAll(".b.me")].some((b) => b.textContent.includes("😂 ok") && !b.classList.contains("jumbo")));

// ---- figurinhas: as recebidas entram sozinhas na coleção
await page.waitForFunction(() => [...document.querySelectorAll(".b.sticker .stk img")].filter((i) => i.src.startsWith("blob:")).length === 2, null, { timeout: 15000 });
await page.click("#emojiBtn");
await page.click('[data-tab="sticker"]');
await page.waitForFunction(() => document.querySelectorAll(".pk-sgrid .pk-st").length === 2, null, { timeout: 10000 });
// criar a partir de uma imagem (PNG retangular → 512×512 WEBP)
const png = await page.evaluate(() => new Promise((r) => { const c = document.createElement("canvas"); c.width = 300; c.height = 150; const g = c.getContext("2d"); g.fillStyle = "#e11d48"; g.fillRect(0, 0, 300, 150); c.toBlob((b) => b.arrayBuffer().then((a) => r([...new Uint8Array(a)])), "image/png"); }));
await page.setInputFiles(".pk-file", { name: "logo.png", mimeType: "image/png", buffer: Buffer.from(png) });
await page.waitForFunction(() => document.querySelectorAll(".pk-sgrid .pk-st").length === 3, null, { timeout: 10000 });
const created = await page.evaluate(async () => { const all = await OrbitaStickers.list(); const s = all.find((x) => x.source === "created"); const bmp = await createImageBitmap(s.blob); return { mime: s.mime, w: bmp.width, h: bmp.height, size: s.size }; });
console.log("criada:", created);
assert.deepEqual([created.mime, created.w, created.h], ["image/webp", 512, 512]);
// favoritar → filtro Favoritas
await page.hover(".pk-sgrid .pk-st >> nth=0");
await page.click(".pk-sgrid .pk-st >> nth=0 >> .pk-fav");
await page.click('.pk-seg [data-f="fav"]');
await page.waitForFunction(() => document.querySelectorAll(".pk-sgrid .pk-st").length === 1);
await page.waitForTimeout(250);
await page.screenshot({ path: shots + "/figurinhas-painel.png" });
await page.click('.pk-seg [data-f="all"]');
// enviar: clique manda como figurinha
const favId = await page.evaluate(async () => (await OrbitaStickers.list()).find((s) => s.fav).id);
await page.click(`.pk-sb[data-stk="${favId}"]`);
await wa.waitForFunction(() => (window.__files || []).some((f) => f.type === "sticker"), null, { timeout: 15000 });
const sent = (await wa.evaluate(() => window.__files)).find((f) => f.type === "sticker");
console.log("enviada:", sent.type, sent.mime, sent.caption);
assert.deepEqual([sent.type, sent.mime, sent.caption], ["sticker", "image/webp", undefined]);
await page.waitForFunction(() => document.querySelectorAll(".b.me.sticker:not(.pending) .stk img").length >= 2, null, { timeout: 10000 });
// remover da coleção
const before = await page.locator(".pk-sgrid .pk-st").count();
await page.hover(".pk-sgrid .pk-st >> nth=1");
await page.click(".pk-sgrid .pk-st >> nth=1 >> .pk-rm");
await page.waitForFunction((n) => document.querySelectorAll(".pk-sgrid .pk-st").length === n - 1, before);
await page.screenshot({ path: shots + "/figurinhas-enviada.png" });
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("EMOJIS E FIGURINHAS OK");
