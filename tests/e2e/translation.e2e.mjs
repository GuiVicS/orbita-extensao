// Teste da Fase 4 (tradução no chat). Rodar: node tests/e2e/translation.e2e.mjs
// O provedor de IA é simulado dentro do service worker (fetch falso), sem chave real.
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-tr";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 860 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];

// tradutor falso: dicionário + marcação do idioma; mantém números
const installFakeAi = () => sw.evaluate(() => {
  const DICT = {
    "Hi, I saw your ad": "Oi, vi seu anúncio", "Can you send the price?": "Pode mandar o preço?", "Hello there": "Olá",
    "Claro! O preço é 20 dólares, com frete incluso.": "Sure! The price is 20 dollars, shipping included.",
    "Sure! The price is 20 dollars, shipping included.": "Claro! O preço é 20 dólares, frete incluso.",
    "Great, thanks! *Deal*": "Ótimo, obrigado! *Fechado*",
  };
  globalThis.__aiCalls = 0;
  globalThis.__aiFail = false;
  globalThis.fetch = async (url, init) => {
    globalThis.__aiCalls++;
    if (globalThis.__aiFail) return new Response('{"error":"down"}', { status: 503 });
    const body = JSON.parse(init.body);
    const msg = body.messages.at(-1).content.replace(/^<message>\n|\n<\/message>$/g, "");
    const to = body.messages[0].content.match(/ to ([A-Z][\w ]+?)\./)[1];
    const translation = DICT[msg] ?? `[${to}] ${msg}`;
    const lang = /[ãçõé]/.test(msg) || /Portuguese/.test(body.messages[0].content.split(" to ")[0]) ? "pt" : "en";
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lang, translation }) } }] }), { status: 200 });
  };
});
await installFakeAi();

const errors = [];
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push("dash: " + e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.evaluate(() => chrome.storage.local.set({ "orbita:ai": { provider: "openai", keys: { openai: "sk-test" }, models: { openai: "gpt-5" } } }));
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
await dash.bringToFront();
await dash.goto(`chrome-extension://${id}/dashboard.html#/conversas`);
const f = dash.frameLocator('iframe[title="Conversas"]');
await f.locator(".status.ready").waitFor({ timeout: 15000 });
await f.locator(".item", { hasText: "John Smith" }).click();
await f.locator(".b", { hasText: "Can you send the price?" }).waitFor();

// liga a tradução → aviso de privacidade
await f.locator("#trBtn").click();
await f.locator("#trEnabled").check();
await f.locator(".dialog").waitFor();
await f.locator('[data-a="yes"]').click();
await f.locator(".b", { hasText: "Pode mandar o preço?" }).waitFor({ timeout: 15000 });
console.log("botão:", await f.locator("#trBtn").innerText());
await dash.keyboard.press("Escape");
await f.locator(".b", { hasText: "Pode mandar o preço?" }).locator("[data-orig]").click();
console.log("com original:", (await f.locator(".b", { hasText: "Pode mandar o preço?" }).innerText()).replace(/\s+/g, " "));

// envio com prévia
await f.locator("#text").fill("Claro! O preço é 20 dólares, com frete incluso.");
await f.locator("#text").press("Enter");
await f.locator(".pvtext").waitFor();
console.log("prévia:", (await f.locator(".pv").innerText()).replace(/\s+/g, " "));
await dash.screenshot({ path: shots + "/traducao-previa.png" });
await f.locator("#pvSend").click();
await f.locator(".b.me", { hasText: "Sure! The price is 20 dollars" }).waitFor();
const lastSent = await wa.evaluate(() => __store["5511999998888@c.us"].at(-1).body);
console.log("WhatsApp recebeu:", lastSent);
assert.equal(lastSent, "Sure! The price is 20 dollars, shipping included.");

// recebida ao vivo traduzida
await wa.evaluate(() => { const m = __mk("5511999998888@c.us", 77, false, "Great, thanks! *Deal*", Date.now() / 1000 | 0, 0); __store["5511999998888@c.us"].push(m); __fire("chat.new_message", m); });
await f.locator(".b", { hasText: "Ótimo, obrigado!" }).waitFor({ timeout: 15000 });
await dash.waitForTimeout(500);
await dash.screenshot({ path: shots + "/traducao-conversa.png" });

// falha segura 1: envio direto sem prévia é recusado pelo service worker
const direct = await dash.evaluate(() => chrome.runtime.sendMessage({ channel: "orbita:chat", op: "chat.sendText", chatId: "5511999998888@c.us", text: "Texto em português", textPt: "Texto em português" }));
console.log("envio sem prévia:", direct);
assert.equal(direct.ok, false);
const noPt = await dash.evaluate(() => chrome.runtime.sendMessage({ channel: "orbita:chat", op: "chat.sendText", chatId: "5511999998888@c.us", text: "Oi" }));
assert.equal(noPt.ok, false);

// falha segura 2: IA fora do ar → erro na prévia e nada enviado
await installFakeAi();
await sw.evaluate(() => (globalThis.__aiFail = true));
const before = await wa.evaluate(() => __store["5511999998888@c.us"].length);
await f.locator("#text").fill("Vou te mandar o boleto amanhã.");
await f.locator("#text").press("Enter");
await f.locator(".pvline.err").waitFor({ timeout: 15000 });
console.log("falha:", (await f.locator(".pvline.err").innerText()).replace(/\s+/g, " "));
assert.equal(await f.locator("#pvSend").count(), 0, "sem botão Enviar quando a tradução falha");
assert.equal(await wa.evaluate(() => __store["5511999998888@c.us"].length), before, "nada foi enviado");
await f.locator("#pvCancel").click();

// reabrir não retraduz
await installFakeAi();
await f.locator(".item", { hasText: "Carla" }).click();
await f.locator(".item", { hasText: "John Smith" }).click();
await f.locator(".b", { hasText: "Pode mandar o preço?" }).waitFor();
await dash.waitForTimeout(1500);
const calls = await sw.evaluate(() => globalThis.__aiCalls);
console.log("chamadas à IA ao reabrir:", calls, "| prévia na lista:", await f.locator(".item", { hasText: "John Smith" }).locator(".prev").innerText());
assert.equal(calls, 0);
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("FASE 4 OK");
