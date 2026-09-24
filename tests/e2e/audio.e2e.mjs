// Teste da Fase 5 (áudio recebido). Rodar: node tests/e2e/audio.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-audio";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 860 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required"] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
// Whisper e tradução simulados
await sw.evaluate(() => {
  globalThis.__tx = 0;
  globalThis.fetch = async (url, init) => {
    if (url.includes("/audio/transcriptions")) {
      globalThis.__tx++;
      const file = init.body.get("file");
      return new Response(JSON.stringify({ text: file.size > 1000 ? "Hi, can you call me tomorrow at 10?" : "", language: "english" }), { status: 200 });
    }
    const body = JSON.parse(init.body);
    const msg = body.messages.at(-1).content.replace(/^<message>\n|\n<\/message>$/g, "");
    const DICT = { "Hi, can you call me tomorrow at 10?": "Oi, pode me ligar amanhã às 10?" };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lang: "en", translation: DICT[msg] ?? `[pt] ${msg}` }) } }] }), { status: 200 });
  };
});
const errors = [];
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push("dash: " + e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.evaluate(() => chrome.storage.local.set({ "orbita:ai": { provider: "openai", keys: { openai: "sk-test", groq: "gsk_test" }, models: { openai: "gpt-5" } }, "orbita:chat:settings": { privacyAccepted: true } }));
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
await dash.bringToFront();
await dash.goto(`chrome-extension://${id}/dashboard.html#/conversas`);
const f = dash.frameLocator('iframe[title="Conversas"]');
await f.locator(".status.ready").waitFor({ timeout: 15000 });
await f.locator(".item").first().waitFor();
await dash.waitForTimeout(1500);
const before = { tx: await sw.evaluate(() => globalThis.__tx), dl: await wa.evaluate(() => window.__downloads) };
console.log("antes de abrir a conversa:", before);
assert.deepEqual(before, { tx: 0, dl: 0 }, "nenhum áudio processado sem abrir a conversa");

await f.locator(".item", { hasText: "John Smith" }).click();
// liga a tradução da conversa (o aviso já foi aceito nas preferências)
await f.locator("#trBtn").click();
await f.locator("#trEnabled").check();
await dash.keyboard.press("Escape");
await f.locator(".b", { hasText: "Oi, pode me ligar amanhã às 10?" }).waitFor({ timeout: 20000 });
const voiceBubble = f.locator(".b", { hasText: "Oi, pode me ligar amanhã às 10?" });
console.log("balão de voz:", (await voiceBubble.innerText()).replace(/\s+/g, " "));
const longBubble = f.locator(".b", { hasText: "Áudio longo" });
console.log("áudio longo:", (await longBubble.innerText()).replace(/\s+/g, " "));
assert.equal(await sw.evaluate(() => globalThis.__tx), 1, "o áudio longo não foi transcrito sozinho");

// tocar
await voiceBubble.locator(".play").click();
await f.locator('.player .play[aria-label="Pausar áudio"]').waitFor({ timeout: 10000 });
console.log("tocando: ok");
await dash.screenshot({ path: shots + "/audio.png" });
await dash.waitForTimeout(1300);
console.log("depois de terminar:", await voiceBubble.locator(".play").getAttribute("aria-label"));

// transcrever o longo pelo botão
await longBubble.locator("[data-transcribe]").click();
await f.locator(".b").filter({ hasText: "Oi, pode me ligar" }).nth(1).waitFor({ timeout: 20000 });
console.log("downloads da aba:", await wa.evaluate(() => window.__downloads), "(o áudio tocado veio do cache)");
console.log("lista:", await f.locator(".item", { hasText: "John Smith" }).locator(".prev").innerText());
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("FASE 5 OK");
