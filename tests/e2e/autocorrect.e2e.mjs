// Teste: corretor automático nas Conversas (opcional). Rodar: node tests/e2e/autocorrect.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-fix";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
// IA simulada: corretor troca algumas palavras; "erro" no texto = falha do provedor
await sw.evaluate(() => {
  globalThis.__aiCalls = 0;
  const FIX = { ola: "Olá,", voce: "você", amanha: "amanhã", as: "às", "10h": "10h?" };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init?.body || "{}");
    if (!body.messages) return new Response("{}", { status: 404 });
    const msg = body.messages.at(-1).content.replace(/^<message>\n|\n<\/message>$/g, "");
    if (msg.includes("provedor-fora")) return new Response("{}", { status: 500 });
    if (/proofreader/.test(body.messages[0].content)) {
      globalThis.__aiCalls++;
      const corrected = msg.split(" ").map((w) => FIX[w] ?? w).join(" ");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ corrected }) } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lang: "pt", translation: `[EN] ${msg}` }) } }] }), { status: 200 });
  };
});
const errors = [];
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/conversas.html`);
await page.evaluate(() => chrome.storage.local.set({ "orbita:ai": { provider: "openai", keys: { openai: "sk" }, models: { openai: "gpt-5" } } }));
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
await page.bringToFront();
await page.reload();
await page.waitForSelector(".status.ready", { timeout: 15000 });
await page.click(".item >> text=John Smith");
await page.waitForSelector("#fixBtn");
const sentTexts = () => wa.evaluate(() => __store["5511999998888@c.us"].filter((m) => m.id.fromMe && m.type === "chat").map((m) => m.body));
const aiCalls = () => sw.evaluate(() => globalThis.__aiCalls);
const type = async (t) => {
  await page.fill("#text", t);
  await page.dispatchEvent("#text", "input");
};

// desligado (padrão): envia direto, sem chamar a IA
assert.equal(await page.getAttribute("#fixBtn", "aria-pressed"), "false");
await type("sem corretor");
await page.press("#text", "Enter");
await page.waitForFunction(() => [...document.querySelectorAll(".b.me")].some((b) => b.textContent.includes("sem corretor")));
assert.equal(await aiCalls(), 0);

// ligar: aviso de privacidade na primeira vez
await page.click("#fixBtn");
await page.click('.modal [data-a="yes"]');
await page.waitForFunction(() => document.getElementById("fixBtn").getAttribute("aria-pressed") === "true");
const st = await page.evaluate(async () => (await chrome.storage.local.get("orbita:chat:settings"))["orbita:chat:settings"]);
assert.equal(st.autoCorrect, true);

// com erros: prévia com destaque; Enter envia o corrigido
await type("ola voce pode vir amanha as 10h");
await page.press("#text", "Enter");
await page.waitForSelector(".pv .fixd mark");
const marks = await page.locator(".pv .fixd mark").allInnerTexts();
console.log("destacado:", marks);
assert.deepEqual(marks, ["Olá,", "você", "amanhã", "às", "10h?"]);
await page.screenshot({ path: shots + "/corretor-previa.png" });
assert.equal(await page.evaluate(() => document.activeElement.id), "fxSend");
await page.keyboard.press("Enter");
await page.waitForFunction(() => !document.querySelector(".pv"));
await wa.waitForFunction(() => __store["5511999998888@c.us"].some((m) => m.body === "Olá, você pode vir amanhã às 10h?"));
console.log("enviado:", (await sentTexts()).at(-1));

// sem nada a corrigir: envia direto, sem prévia
await type("Tudo certo por aqui");
await page.press("#text", "Enter");
await wa.waitForFunction(() => __store["5511999998888@c.us"].some((m) => m.body === "Tudo certo por aqui"));
assert.equal(await page.locator(".pv").count(), 0);

// enviar original
await type("ola de novo");
await page.press("#text", "Enter");
await page.waitForSelector("#fxOrig");
await page.click("#fxOrig");
await wa.waitForFunction(() => __store["5511999998888@c.us"].some((m) => m.body === "ola de novo"));

// editar: o corrigido vai para o campo e o envio seguinte não corrige de novo
await type("voce viu?");
await page.press("#text", "Enter");
await page.waitForSelector("#fxEdit");
await page.click("#fxEdit");
assert.equal(await page.inputValue("#text"), "você viu?");
const before = await aiCalls();
await page.press("#text", "Enter");
await wa.waitForFunction(() => __store["5511999998888@c.us"].some((m) => m.body === "você viu?"));
assert.equal(await aiCalls(), before);

// falha da IA: nada é enviado; dá para enviar sem corrigir
await type("provedor-fora ola");
await page.press("#text", "Enter");
await page.waitForSelector(".pv .pvline.err");
console.log("erro:", await page.locator(".pv .pvline.err").innerText());
const n = (await sentTexts()).length;
await page.click("#fxOrig");
await wa.waitForFunction((n) => __store["5511999998888@c.us"].filter((m) => m.id.fromMe && m.type === "chat").length > n, n);
assert.equal((await sentTexts()).at(-1), "provedor-fora ola");

// sem revisão: corrige e envia direto
await page.evaluate(async () => OrbitaChat.saveSettings({ autoCorrectReview: false }));
await type("ola direto");
await page.press("#text", "Enter");
await wa.waitForFunction(() => __store["5511999998888@c.us"].some((m) => m.body === "Olá, direto"));

// com a tradução ligada o corretor não é usado
await page.click("#trBtn");
await page.check("#trEnabled");
await page.keyboard.press("Escape");
assert.equal(await page.evaluate(() => document.getElementById("fixBtn").classList.contains("on")), false);

// desligar pelo botão
await page.click("#trBtn");
await page.uncheck("#trEnabled");
await page.keyboard.press("Escape");
await page.click("#fixBtn");
await page.waitForFunction(() => document.getElementById("fixBtn").getAttribute("aria-pressed") === "false");
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("CORRETOR OK");
