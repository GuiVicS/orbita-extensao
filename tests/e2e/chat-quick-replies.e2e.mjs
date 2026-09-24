// Teste: respostas rápidas dentro das Conversas. Rodar: node tests/e2e/chat-quick-replies.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-cqr";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
// tradução simulada (para a parte com tradução ligada)
await sw.evaluate(() => {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const msg = body.messages.at(-1).content.replace(/^<message>\n|\n<\/message>$/g, "");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lang: "pt", translation: `[EN] ${msg}` }) } }] }), { status: 200 });
  };
});
const errors = [];
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/conversas.html`);
// respostas rápidas: os exemplos padrão + uma com áudio de voz; sem simulação de digitação (teste rápido)
await page.evaluate(async () => {
  const data = await OrbitaQR.load();
  data.settings = { ...data.settings, simulate: false, stepDelaySec: 0 };
  const bytes = new Uint8Array(3000); bytes.set([79, 103, 103, 83]); // "OggS"
  let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b)));
  await chrome.storage.local.set({ "orbita:qr:media:voz1": { name: "audio.ogg", mime: "audio/ogg; codecs=opus", size: 3000, duration: 2, data: btoa(bin) } });
  data.items.push({ id: "qa", title: "Áudio de boas-vindas", shortcut: "audio", emoji: "🎤", categoryId: "", favorite: false, steps: [{ id: "s1", type: "audio", ptt: true, mediaId: "voz1", mime: "audio/ogg; codecs=opus", duration: 2, delaySec: 0 }], createdAt: 1, updatedAt: 1 });
  await OrbitaQR.save(data);
  await chrome.storage.local.set({ "orbita:ai": { provider: "openai", keys: { openai: "sk" }, models: { openai: "gpt-5" } }, "orbita:chat:settings": { privacyAccepted: true } });
});
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
await page.bringToFront();
await page.reload();
await page.waitForSelector(".status.ready", { timeout: 15000 });
await page.click(".item >> text=John Smith");
await page.waitForSelector(".qrchip");
console.log("barra:", await page.locator(".qrchip").allInnerTexts());
const sentTexts = () => wa.evaluate(() => __store["5511999998888@c.us"].filter((m) => m.id.fromMe && m.type === "chat").map((m) => m.body));

// 1) clique envia a sequência, com variáveis
await page.click('.qrchip:has-text("Boas-vindas")');
await page.waitForFunction(async () => document.querySelectorAll(".b.me").length >= 3, null, { timeout: 15000 });
await page.waitForSelector('.toast:has-text("enviada")');
let texts = await sentTexts();
console.log("enviadas:", texts.slice(-2));
assert.match(texts.at(-2), /, John! 😊$/);
// 2) "/pi" + Enter
await page.fill("#text", "/pi");
await page.dispatchEvent("#text", "input");
await page.waitForSelector(".qprow.on:has-text('Chave Pix')");
await page.screenshot({ path: shots + "/qr-chat-slash.png" });
await page.press("#text", "Enter");
await page.waitForFunction(async () => document.querySelectorAll('.toast').length >= 2 || true);
await page.waitForFunction(() => [...document.querySelectorAll(".b.me")].some((b) => b.textContent.includes("comprovante")), null, { timeout: 15000 });
console.log("campo depois do /pi:", JSON.stringify(await page.inputValue("#text")));
// 3) Shift+clique põe no campo
await page.click('.qrchip:has-text("Horário")', { modifiers: ["Shift"] });
console.log("no campo:", (await page.inputValue("#text")).slice(0, 50));
assert.match(await page.inputValue("#text"), /^Nosso horário/);
await page.fill("#text", "");
// 4) áudio como voz (arquivo, não data URL)
await page.click('.qrchip:has-text("Áudio de boas-vindas")');
await page.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => t.textContent.includes("Áudio de boas-vindas")), null, { timeout: 15000 });
const f = await wa.evaluate(() => window.__lastFile);
console.log("áudio:", f);
assert.equal(f.isPtt, true);
assert.equal(f.oggMagic, true);
// 5) tradução ligada: prévia traduzida e envio da tradução
await page.click("#trBtn");
await page.check("#trEnabled");
await page.keyboard.press("Escape");
await page.click('.qrchip:has-text("Obrigado")');
await page.waitForSelector(".dialog.wide");
console.log("prévia:", (await page.locator(".qrsteps").innerText()).replace(/\s+/g, " ").slice(0, 160));
await page.screenshot({ path: shots + "/qr-chat-previa.png" });
await page.click('.dialog.wide [data-a="yes"]');
await page.waitForFunction(() => [...document.querySelectorAll(".b.me")].some((b) => b.textContent.startsWith("[EN] Muito obrigado")), null, { timeout: 15000 });
texts = await sentTexts();
console.log("chegou ao contato:", texts.at(-1));
assert.match(texts.at(-1), /^\[EN\] Muito obrigado/);
const bubble = await page.locator(".b.me", { hasText: "[EN] Muito obrigado" }).innerText();
assert.ok(bubble.includes("Muito obrigado pela preferência, John!"), "o original em PT fica no balão");
// 6) sem aprovação, com tradução ligada, não envia
const r = await page.evaluate(() => chrome.runtime.sendMessage({ channel: "orbita:chat", op: "qr.run", chatId: "5511999998888@c.us", itemId: (window.OrbitaQR && "qa") }));
console.log("sem prévia:", r);
assert.equal(r.ok, false);
await page.screenshot({ path: shots + "/qr-chat.png" });
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("RESPOSTAS RÁPIDAS NO CHAT OK");
