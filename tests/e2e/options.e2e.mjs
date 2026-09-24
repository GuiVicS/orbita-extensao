// Teste da Fase 7 (Opções → Conversas: tradução e voz). Rodar: node tests/e2e/options.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-opts";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 900, height: 1000 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
// Fish Audio simulado (a página de Opções chama a API diretamente)
const fish = [];
const wav = Buffer.from("ID3fake-mp3"); // o conteúdo não importa: só confere que o player recebe o áudio
await ctx.route("https://api.fish.audio/**", async (r) => {
  const req = r.request();
  fish.push({ url: req.url(), auth: req.headers().authorization, body: req.postDataBuffer()?.toString("latin1") });
  if (req.url().endsWith("/model")) return r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ _id: "voz-clonada-123", state: "trained" }) });
  return r.fulfill({ status: 200, contentType: "audio/mpeg", body: wav });
});
const errors = [];
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(`chrome-extension://${id}/options.html#conversas`);
await p.waitForSelector("#c-myLang option", { state: "attached" });
await p.waitForFunction(() => document.getElementById("c-myLang").value === "pt");
console.log("padrões:", await p.inputValue("#c-myLang"), await p.inputValue("#c-defaultContactLang"), await p.isChecked("#c-requirePreview"));
await p.selectOption("#c-defaultContactLang", "es");
await p.fill("#c-contextMessages", "99");
await p.uncheck("#c-requirePreview");
console.log("aviso sem prévia visível:", await p.isVisible("#previewWarn"));
await p.click("#glossaryAdd");
await p.fill(".gl:last-child input[data-k=term]", "Órbita");
await p.check(".gl:last-child input[data-k=keep]");
await p.fill("#fishKey", "fish_key_123");
await p.check("#c-aiVoiceNotice");
await p.click("#chatSave");
await p.waitForSelector("#chatStatus.ok");
const st = await p.evaluate(() => chrome.storage.local.get(["orbita:chat:settings", "orbita:chat:secrets"]));
console.log("salvo:", JSON.stringify(st["orbita:chat:settings"]), "| segredo:", JSON.stringify(st["orbita:chat:secrets"]));
const s = st["orbita:chat:settings"];
assert.equal(s.defaultContactLang, "es");
assert.equal(s.contextMessages, 12, "limite aplicado");
assert.equal(s.requirePreview, false);
assert.deepEqual(s.glossary, [{ term: "Órbita", translation: "", keep: true }]);
assert.equal(s.aiVoiceNotice, true);
assert.equal(st["orbita:chat:secrets"].fishApiKey, "fish_key_123");
assert.ok(!("fishApiKey" in s), "chave não fica nas preferências");

// criar voz: exige amostra + consentimento
await p.click("#voiceWizard summary");
assert.equal(await p.isDisabled("#wCreate"), true);
await p.setInputFiles("#wFile", { name: "amostra.ogg", mimeType: "audio/ogg", buffer: Buffer.alloc(4000, 1) });
assert.equal(await p.isDisabled("#wCreate"), true, "sem consentimento não cria");
await p.check("#wConsent");
await p.fill("#wText", "Olá, esta é a minha voz.");
await p.click("#wCreate");
await p.waitForFunction(() => /^Voz criada/.test(document.getElementById("wStatus").textContent));
console.log("criar voz:", await p.textContent("#wStatus"));
const created = fish.find((f) => f.url.endsWith("/model"));
assert.equal(created.auth, "Bearer fish_key_123");
for (const field of ['name="type"', "tts", 'name="train_mode"', "fast", 'name="voices"', 'name="texts"', 'name="visibility"', "private"]) assert.ok(created.body.includes(field), field);
assert.equal(await p.inputValue("#c-fishVoiceId"), "voz-clonada-123");
// testar voz
await p.click("#vTestBtn");
await p.waitForFunction(() => document.getElementById("vStatus").textContent === "Voz configurada.");
const tts = fish.find((f) => f.url.endsWith("/v1/tts"));
console.log("teste de voz:", tts.body.slice(0, 300));
assert.match(tts.body, /voz-clonada-123/);
// privacidade
await p.click("#privacyReset");
await p.waitForFunction(() => document.getElementById("privacyState").textContent.startsWith("ainda não"));
await p.screenshot({ path: shots + "/opcoes-conversas.png", fullPage: true });
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("FASE 7 OK");
