// Teste da Fase 6 (áudio enviado com voz gerada). Rodar: node tests/e2e/voice.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-voice";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
// Fish Audio, Whisper e tradução simulados
const installFakes = () => sw.evaluate(() => {
  const wav = (sec) => { const sr = 16000, n = sr * sec, b = new DataView(new ArrayBuffer(44 + n * 2)); const w = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, "data"); b.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.sin(i / sr * 2 * Math.PI * 220) * 9000, true); return b.buffer; };
  globalThis.__fish = [];
  globalThis.__fishStatus = 200;
  globalThis.fetch = async (url, init) => {
    if (url === "https://api.fish.audio/v1/tts") {
      globalThis.__fish.push({ headers: init.headers, body: JSON.parse(init.body) });
      if (globalThis.__fishStatus !== 200) return new Response("{}", { status: globalThis.__fishStatus });
      return new Response(wav(2), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }
    if (url.includes("/audio/transcriptions")) return new Response(JSON.stringify({ text: "Claro, te ligo amanhã às 10.", language: "portuguese" }), { status: 200 });
    const body = JSON.parse(init.body);
    const msg = body.messages.at(-1).content.replace(/^<message>\n|\n<\/message>$/g, "");
    const DICT = { "Claro, te ligo amanhã às 10.": "Sure, I'll call you tomorrow at 10.", "Sure, I'll call you tomorrow at 10.": "Claro, eu te ligo amanhã às 10." };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lang: "pt", translation: DICT[msg] ?? `[x] ${msg}` }) } }] }), { status: 200 });
  };
});
await installFakes();
const errors = [];
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push("dash: " + e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.evaluate(() => chrome.storage.local.set({
  "orbita:ai": { provider: "openai", keys: { openai: "sk-test", groq: "gsk_test" }, models: { openai: "gpt-5" } },
  "orbita:chat:settings": { privacyAccepted: true, fishVoiceId: "voz-do-joao" },
  "orbita:chat:secrets": { fishApiKey: "fish_secret" },
}));
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
await dash.bringToFront();
await dash.goto(`chrome-extension://${id}/dashboard.html#/conversas`);
const f = dash.frameLocator('iframe[title="Conversas"]');
await f.locator(".status.ready").waitFor({ timeout: 15000 });
await f.locator(".item", { hasText: "John Smith" }).click();
await f.locator("#trBtn").click();
await f.locator("#trEnabled").check();
await dash.keyboard.press("Escape");

// 1) gravar → texto para revisar
await f.locator("#micBtn").click();
await f.locator("#vcStop").waitFor();
await dash.waitForTimeout(1500);
await f.locator("#vcStop").click();
await f.locator("#voiceBtn.on").waitFor({ timeout: 15000 });
console.log("texto transcrito:", await f.locator("#text").inputValue());
assert.equal(await f.locator("#text").inputValue(), "Claro, te ligo amanhã às 10.");

// 2) prévia da tradução → gerar voz → ouvir → enviar
await f.locator("#text").press("Enter");
await f.locator("#pvSend", { hasText: "Gerar voz" }).waitFor({ timeout: 15000 });
await f.locator("#pvSend").click();
await f.locator("#vcSend").waitFor({ timeout: 20000 });
console.log("painel:", (await f.locator(".pv").innerText()).replace(/\s+/g, " "));
const fishReq = await sw.evaluate(() => globalThis.__fish[0]);
console.log("pedido ao Fish:", JSON.stringify(fishReq));
assert.equal(fishReq.body.text, "Sure, I'll call you tomorrow at 10.", "voz gerada do texto traduzido aprovado");
assert.equal(fishReq.body.reference_id, "voz-do-joao");
await dash.screenshot({ path: shots + "/voz-previa.png" });
await f.locator("#vcSend").click();
await f.locator(".b.me .aibadge").waitFor({ timeout: 15000 });
await dash.waitForTimeout(800);
const sentFile = await wa.evaluate(() => window.__lastFile);
console.log("WhatsApp recebeu:", sentFile);
assert.equal(sentFile.isPtt, true);
assert.equal(sentFile.oggMagic, true, "OGG/Opus");
assert.match(sentFile.mime, /ogg/);
console.log("balão:", (await f.locator(".b.me").last().innerText()).replace(/\s+/g, " "));
await dash.screenshot({ path: shots + "/voz-enviada.png" });

// 3) travas de segurança
const call = (extra) => dash.evaluate((x) => chrome.runtime.sendMessage({ channel: "orbita:chat", chatId: "5511999998888@c.us", ...x }), extra);
const r1 = await call({ op: "chat.sendAudio", genId: "falso" });
const r2 = await call({ op: "audio.generatePreview", textPt: "Texto que nunca foi aprovado" });
console.log("sem aprovação:", r1.error, "|", r2.error);
assert.equal(r1.ok, false);
assert.equal(r2.ok, false);

// 4) créditos esgotados: erro claro e nada enviado
await installFakes();
await sw.evaluate(() => (globalThis.__fishStatus = 402));
const sentBefore = await wa.evaluate(() => __store["5511999998888@c.us"].length);
await f.locator("#voiceBtn").click();
await f.locator("#text").fill("Outro recado curto.");
await f.locator("#text").press("Enter");
await f.locator("#pvSend", { hasText: "Gerar voz" }).waitFor({ timeout: 15000 });
await f.locator("#pvSend").click();
await f.locator(".pvline.err").waitFor({ timeout: 15000 });
console.log("402:", (await f.locator(".pvline.err").innerText()).replace(/\s+/g, " "));
assert.equal(await wa.evaluate(() => __store["5511999998888@c.us"].length), sentBefore);

// 5) backup sem a chave do Fish
const bk = await dash.evaluate(async () => { const b = await OrbitaBackup.create(); return { hasSecret: "orbita:chat:secrets" in b.storage, settings: Boolean(b.storage["orbita:chat:settings"]) }; });
console.log("backup:", bk);
assert.equal(bk.hasSecret, false);
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("FASE 6 OK");
