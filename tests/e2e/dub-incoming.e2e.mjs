// Teste: áudio recebido em outro idioma é dublado para o português pela
// ElevenLabs (só o áudio vai; a transcrição acontece, mas não é enviada).
// Rodar: node tests/e2e/dub-incoming.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-dubin";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required"] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
await sw.evaluate(() => {
  const wav = (sec) => { const sr = 16000, n = sr * sec, b = new DataView(new ArrayBuffer(44 + n * 2)); const w = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, "data"); b.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.sin(i / sr * 2 * Math.PI * 300) * 9000, true); return b.buffer; };
  globalThis.__eleven = [];
  globalThis.__tx = 0;
  globalThis.__polls = 0;
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    if (url.includes("/audio/transcriptions")) {
      globalThis.__tx++;
      return new Response(JSON.stringify({ text: "I'll call you tomorrow.", language: "english" }), { status: 200 });
    }
    if (!url.startsWith("https://api.elevenlabs.io/")) return new Response("{}", { status: 500 });
    const e = { method, url };
    if (init.body instanceof FormData) {
      e.form = {};
      for (const [k, v] of init.body.entries()) e.form[k] = typeof v === "string" ? v : `${v.type}:${v.name}`;
      e.head = new TextDecoder().decode(new Uint8Array(await init.body.get("file").slice(0, 4).arrayBuffer()));
    }
    globalThis.__eleven.push(e);
    if (method === "POST") return new Response(JSON.stringify({ dubbing_id: "d9", expected_duration_sec: 4 }), { status: 200 });
    if (method === "DELETE") return new Response("{}", { status: 200 });
    if (url.endsWith("/v1/dubbing/d9")) return new Response(JSON.stringify({ status: ++globalThis.__polls % 2 === 0 ? "dubbed" : "dubbing" }), { status: 200 });
    if (url.endsWith("/audio/pt")) return new Response(wav(1), { status: 200, headers: { "content-type": "audio/wav" } });
    return new Response("{}", { status: 404 });
  };
  const dub = globalThis.OrbitaDub.dub;
  globalThis.OrbitaDub.dub = (o) => dub({ ...o, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 300))) });
});
const errors = [];
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/conversas.html`);
await page.evaluate(() => chrome.storage.local.set({
  "orbita:ai": { provider: "openai", keys: { openai: "sk-test", groq: "gsk_test" }, models: { openai: "gpt-5" } },
  "orbita:chat:settings": { privacyAccepted: true, voiceEngine: "elevenlabs" },
  "orbita:chat:secrets": { elevenApiKey: "sk_eleven" },
}));
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
await page.bringToFront();
await page.reload();
await page.waitForSelector(".status.ready", { timeout: 15000 });
await page.click(".item >> text=John Smith");

// 1) áudio curto em inglês: transcrito (sempre) e dublado sozinho para o português
const v1 = '[data-id$="_v1"]';
await page.waitForSelector(`${v1} .transcript`, { timeout: 20000 });
console.log("transcrição:", await page.locator(`${v1} .transcript`).innerText());
await page.waitForSelector(`${v1} .dubin [data-play^="dub:"]`, { timeout: 30000 });
console.log("dublado:", (await page.locator(`${v1} .dubin`).innerText()).trim());
const first = (await sw.evaluate(() => globalThis.__eleven)).find((c) => c.method === "POST");
console.log("para a ElevenLabs:", first.form, first.head);
assert.deepEqual(Object.keys(first.form).sort(), ["disable_voice_cloning", "drop_background_audio", "file", "num_speakers", "source_lang", "target_lang"]);
assert.equal(first.form.target_lang, "pt");
assert.equal(first.form.source_lang, "en");
assert.equal(first.form.file, "audio/wav:audio.wav");
assert.equal(first.head, "RIFF", "o áudio (WAV), não texto");
assert.ok(!JSON.stringify(first.form).includes("call you"), "a transcrição não vai para a ElevenLabs");
assert.ok((await sw.evaluate(() => globalThis.__tx)) >= 1, "a transcrição aconteceu");
// ouvir a versão dublada
await page.click(`${v1} .dubin [data-play^="dub:"]`);
await page.waitForFunction((sel) => document.querySelector(`${sel} .dubin .play`)?.getAttribute("aria-label") === "Pausar áudio", v1, { timeout: 10000 });
await page.screenshot({ path: shots + "/dublagem-recebida.png" });

// 2) áudio longo (acima da duração automática): não dubla sozinho; o botão dubla
const v2 = '[data-id$="_v2"]';
const posts = () => sw.evaluate(() => globalThis.__eleven.filter((c) => c.method === "POST").length);
assert.equal(await posts(), 1);
await page.waitForSelector(`${v2} [data-dubin]`);
await page.click(`${v2} [data-dubin]`);
await page.waitForSelector(`${v2} .dubin [data-play^="dub:"]`, { timeout: 30000 });
assert.equal(await posts(), 2);

// 3) com o Fish Audio como principal, nada é dublado nem oferecido
await page.evaluate(() => OrbitaChat.saveSettings({ voiceEngine: "fish" }));
await page.waitForFunction(() => !document.querySelector(".dubin"), null, { timeout: 5000 });
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("DUBLAGEM DE RECEBIDOS OK");
