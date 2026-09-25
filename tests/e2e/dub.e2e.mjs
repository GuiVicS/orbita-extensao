// Teste: voz traduzida pela dublagem da ElevenLabs (áudio → áudio, opcional).
// Rodar: node tests/e2e/dub.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-dub";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true, viewport: { width: 1440, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
// ElevenLabs simulada (o resto da internet não pode ser chamado: nem Fish, nem transcrição, nem tradução)
await sw.evaluate(() => {
  const wav = (sec) => { const sr = 16000, n = sr * sec, b = new DataView(new ArrayBuffer(44 + n * 2)); const w = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, sr, true); b.setUint32(28, sr * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, "data"); b.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.sin(i / sr * 2 * Math.PI * 330) * 9000, true); return b.buffer; };
  globalThis.__calls = [];
  globalThis.__quota = false;
  globalThis.__polls = 0;
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    const entry = { method, url };
    if (init.body instanceof FormData) {
      entry.form = {};
      for (const [k, v] of init.body.entries()) entry.form[k] = typeof v === "string" ? v : `${v.type}:${v.size}:${v.name}`;
      const f = init.body.get("file");
      entry.head = new TextDecoder().decode(new Uint8Array(await f.slice(0, 4).arrayBuffer()));
    }
    globalThis.__calls.push(entry);
    // fluxo original (Fish Audio): a gravação vira texto pela transcrição
    if (url.includes("/audio/transcriptions")) return new Response(JSON.stringify({ text: "Te ligo amanhã.", language: "portuguese" }), { status: 200 });
    if (!url.startsWith("https://api.elevenlabs.io/")) return new Response("{}", { status: 500 });
    if (method === "POST") return globalThis.__quota ? new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "exceeds your quota" } }), { status: 401 }) : new Response(JSON.stringify({ dubbing_id: "d1", expected_duration_sec: 6 }), { status: 200 });
    if (method === "DELETE") return new Response("{}", { status: 200 });
    if (url.endsWith("/v1/dubbing/d1")) return new Response(JSON.stringify({ status: ++globalThis.__polls >= 2 ? "dubbed" : "dubbing" }), { status: 200 });
    if (url.endsWith("/audio/en")) return new Response(wav(2), { status: 200, headers: { "content-type": "audio/wav" } });
    return new Response("{}", { status: 404 });
  };
  // polling rápido no teste (padrão: a cada 5 s)
  const dub = globalThis.OrbitaDub.dub;
  globalThis.OrbitaDub.dub = (o) => dub({ ...o, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 300))) });
});
const errors = [];
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push("dash: " + e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.evaluate(() => chrome.storage.local.set({
  "orbita:ai": { provider: "openai", keys: { openai: "sk-test", groq: "gsk_test" }, models: { openai: "gpt-5" } },
  "orbita:chat:settings": { privacyAccepted: true, voiceEngine: "elevenlabs", defaultContactLang: "en" },
  "orbita:chat:secrets": { elevenApiKey: "sk_eleven" },
}));
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
await dash.bringToFront();
await dash.goto(`chrome-extension://${id}/dashboard.html#/conversas`);
const f = dash.frameLocator('iframe[title="Conversas"]');
await f.locator(".status.ready").waitFor({ timeout: 15000 });
await f.locator(".item", { hasText: "John Smith" }).click();

// modo áudio com a ElevenLabs configurada: o campo mostra as duas formas
await f.locator("#voiceBtn").click();
assert.match(await f.locator("#text").getAttribute("placeholder"), /Escreva, ou grave para dublar em inglês/);

// gravar → dublar → ouvir → enviar
// ElevenLabs principal: a gravação vai direto para a dublagem (sem escolha, sem texto)
await dash.waitForTimeout(1500); // as vozes recebidas do John são transcritas ao abrir; espera e zera o registro
await sw.evaluate(() => (globalThis.__calls = []));
await f.locator("#micBtn").click();
await f.locator("#vcStop").waitFor();
await dash.waitForTimeout(1500);
await f.locator("#vcStop").click();
await f.locator("#vcDub").waitFor({ timeout: 10000 });
assert.equal(await f.locator("#vcDubGo").count(), 0);
console.log("andamento:", await f.locator("#vcDub").innerText());
await f.locator("#vcSend").waitFor({ timeout: 30000 });
console.log("prévia:", (await f.locator(".pv").innerText()).replace(/\s+/g, " "));
assert.match(await f.locator(".pv").innerText(), /dublado em inglês pela ElevenLabs/i);
await dash.screenshot({ path: shots + "/dublagem-previa.png" });
const calls = await sw.evaluate(() => globalThis.__calls);
console.log("chamadas:", calls.map((c) => `${c.method} ${c.url.replace("https://api.elevenlabs.io", "")}`));
assert.ok(calls.every((c) => c.url.startsWith("https://api.elevenlabs.io/v1/dubbing")), "só a ElevenLabs: sem transcrição, tradução ou Fish Audio");
const create = calls[0];
console.log("envio:", create.form, create.head);
assert.equal(create.form.target_lang, "en");
assert.equal(create.form.source_lang, "pt");
assert.equal(create.form.num_speakers, "1");
assert.equal(create.form.disable_voice_cloning, "false");
assert.match(create.form.file, /^audio\/wav:\d+:gravacao\.wav$/);
assert.equal(create.head, "RIFF");
assert.ok(calls.some((c) => c.method === "DELETE"), "projeto apagado na ElevenLabs depois do download");
await f.locator("#vcSend").click();
await f.locator(".b.me .aibadge").waitFor({ timeout: 15000 });
await dash.waitForTimeout(800);
const sent = await wa.evaluate(() => window.__lastFile);
console.log("WhatsApp recebeu:", sent);
assert.equal(sent.isPtt, true);
assert.equal(sent.oggMagic, true);

// sem créditos: erro claro, nada enviado e "Tentar de novo" com a mesma gravação
await sw.evaluate(() => { globalThis.__quota = true; globalThis.__calls = []; });
const before = await wa.evaluate(() => __store["5511999998888@c.us"].length);
await f.locator("#voiceBtn").click();
await f.locator("#micBtn").click();
await f.locator("#vcStop").waitFor();
await dash.waitForTimeout(1000);
await f.locator("#vcStop").click();
await f.locator(".pvline.err").waitFor({ timeout: 15000 });
console.log("sem créditos:", (await f.locator(".pvline.err").innerText()).replace(/\s+/g, " "));
assert.match(await f.locator(".pvline.err").innerText(), /sem créditos/);
assert.equal(await wa.evaluate(() => __store["5511999998888@c.us"].length), before);
await sw.evaluate(() => { globalThis.__quota = false; globalThis.__polls = 0; });
await f.locator("#vcRegen", { hasText: "Tentar de novo" }).click();
await f.locator("#vcSend").waitFor({ timeout: 30000 });
await f.locator("#vcCancel").click();

// fora do modo áudio também: gravação → dublagem direto, só o áudio
await f.locator("#text").fill("");
if (await f.locator("#voiceBtn.on").count()) await f.locator("#voiceBtn").click();
await sw.evaluate(() => { globalThis.__calls = []; globalThis.__polls = 0; });
await f.locator("#micBtn").click();
await f.locator("#vcStop").waitFor();
await dash.waitForTimeout(800);
await f.locator("#vcStop").click();
await f.locator("#vcSend").waitFor({ timeout: 30000 });
const outside = await sw.evaluate(() => globalThis.__calls.map((c) => c.url));
console.log("fora do modo áudio:", outside.map((u) => u.replace("https://api.elevenlabs.io", "")));
assert.ok(outside.length && outside.every((u) => u.startsWith("https://api.elevenlabs.io/v1/dubbing")), "só áudio para a ElevenLabs, sem transcrição");
await f.locator("#vcCancel").click();

// Fish Audio como principal (com a chave da ElevenLabs): depois de gravar, as duas opções
await dash.evaluate(async () => OrbitaChat.saveSettings({ voiceEngine: "fish" }));
await dash.waitForTimeout(300);
await f.locator("#voiceBtn.on").waitFor({ timeout: 1000 }).catch(() => f.locator("#voiceBtn").click());
await f.locator("#micBtn").click();
await f.locator("#vcStop").waitFor();
await dash.waitForTimeout(800);
await f.locator("#vcStop").click();
await f.locator("#vcDubGo").waitFor();
assert.match(await f.locator("#vcFishGo").innerText(), /Fish Audio/);
assert.equal(await f.locator("#vcFishGo").evaluate((b) => b === document.activeElement), true); // Enter = a principal
await dash.waitForTimeout(300);
await dash.screenshot({ path: shots + "/dublagem-escolha.png" });
await f.locator("#vcCancel").click();

// a forma original continua: gravar → "Transcrever e usar o Fish Audio" → texto para revisar
await sw.evaluate(() => (globalThis.__calls = []));
await f.locator("#voiceBtn.on").waitFor().catch(() => f.locator("#voiceBtn").click());
await f.locator("#micBtn").click();
await f.locator("#vcStop").waitFor();
await dash.waitForTimeout(1000);
await f.locator("#vcStop").click();
await f.locator("#vcFishGo").click();
await dash.waitForFunction(() => true);
await f.locator("#text").waitFor();
await (async () => { for (let i = 0; i < 50; i++) { if ((await f.locator("#text").inputValue()) === "Te ligo amanhã.") return; await dash.waitForTimeout(200); } throw new Error("transcrição não chegou ao campo"); })();
const orig = await sw.evaluate(() => globalThis.__calls.map((c) => c.url));
console.log("fluxo original:", orig);
assert.ok(orig.some((u) => u.includes("/audio/transcriptions")) && !orig.some((u) => u.includes("elevenlabs")));



// sem a chave da ElevenLabs: gravar no modo áudio vai direto para a transcrição, como antes
await dash.evaluate(() => chrome.storage.local.set({ "orbita:chat:secrets": {} }));
await f.locator("#text").fill("");
await dash.waitForTimeout(300);
await f.locator("#micBtn").click();
await f.locator("#vcStop").waitFor();
await dash.waitForTimeout(800);
await f.locator("#vcStop").click();
await (async () => { for (let i = 0; i < 50; i++) { if ((await f.locator("#text").inputValue()) === "Te ligo amanhã.") return; await dash.waitForTimeout(200); } throw new Error("sem a chave, deveria transcrever direto"); })();
assert.equal(await f.locator("#vcDubGo").count(), 0);

// motor padrão continua o Fish Audio (opcional)
const def = await dash.evaluate(() => OrbitaChat.DEFAULT_SETTINGS.voiceEngine);
assert.equal(def, "fish");
// a chave da ElevenLabs não entra no backup
const bk = await dash.evaluate(async () => { const b = await OrbitaBackup.create(); return "orbita:chat:secrets" in b.storage; });
assert.equal(bk, false);
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("DUBLAGEM OK");
