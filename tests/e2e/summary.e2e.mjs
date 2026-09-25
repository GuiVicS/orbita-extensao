// Teste: "Gerar resumo" (Visão geral → #/resumo) com a IA simulada.
// Rodar: node tests/e2e/summary.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-summary";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 1100 }, acceptDownloads: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
// IA simulada: responde conforme a conversa, citando os números das linhas certas
await sw.evaluate(() => {
  globalThis.__prompts = [];
  const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body || "{}");
    const sys = body.messages?.[0]?.content || "";
    const user = body.messages?.at(-1)?.content || "";
    const reply = (content) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    if (url.includes("/audio/transcriptions")) return new Response(JSON.stringify({ text: "", language: "portuguese" }), { status: 200 });
    if (/2 ou 3 frases/.test(sys)) return reply("Responda o John sobre o preço e confira a reunião de amanhã.");
    if (!/organiza o WhatsApp/.test(sys)) return reply("{}");
    globalThis.__prompts.push(user.split("\n")[0]);
    const n = (re) => Number((user.split("\n").find((l) => re.test(l)) || "").match(/^\[(\d+)\]/)?.[1]);
    if (/Conversa com: John Smith/.test(user))
      return reply(JSON.stringify({ summary: "John quer saber o preço.", priority: 3, items: [
        { type: "question", text: "John perguntou o preço", who: "John", sources: [n(/Can you send the price/)] },
        { type: "commitment", text: "Reunião com John", who: "John", sources: [n(/I saw your ad/)], date: tomorrow, time: "15:00", date_text: "amanhã às 15h" },
        { type: "request", text: "Pedido inventado", sources: [999] },
      ] }));
    if (/Grupo: Clientes VIP/.test(user))
      return reply(JSON.stringify({ summary: "Catálogo novo no grupo.", priority: 1, items: [{ type: "notice", text: "Chegou o catálogo novo", who: "John", sources: [n(/catálogo novo/)] }] }));
    return reply(JSON.stringify({ summary: "Nada importante.", priority: 0, items: [] }));
  };
});
const errors = [];
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push("dash: " + e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.evaluate(() => chrome.storage.local.set({ "orbita:ai": { provider: "openai", keys: { openai: "sk-test" }, models: { openai: "gpt-5" } } }));
const wa = await ctx.newPage();
await wa.addInitScript(() => (window.__groups = true));
await wa.goto("https://web.whatsapp.com/");
await dash.bringToFront();
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);

// ---- cartão na Visão geral → Gerar resumo
await dash.waitForSelector(".osc button.go");
assert.match(await dash.locator(".osc").innerText(), /Resumo do WhatsApp/);
await dash.click(".osc button.go");
await dash.waitForFunction(() => location.hash.startsWith("#/resumo"));
const f = dash.frameLocator('iframe[title="Resumo do WhatsApp"]');
await f.locator(".head .count").waitFor({ timeout: 60000 });
console.log("conversas lidas pela IA:", await sw.evaluate(() => globalThis.__prompts));
console.log("abertura:", await f.locator(".overview").innerText());
const pending = await f.locator('section:has(h2:has-text("Precisam da sua resposta")) .it').allInnerTexts();
console.log("pendências:", pending.map((t) => t.replace(/\n+/g, " | ")));
assert.equal(pending.length, 1, "o item com fonte inventada foi descartado");
assert.match(pending[0], /John perguntou o preço[\s\S]*Can you send the price\?/);
const dated = await f.locator('section:has(h2:has-text("Compromissos")) .it').allInnerTexts();
assert.match(dated[0], /15:00[\s\S]*Reunião com John[\s\S]*Hi, I saw your ad/);
assert.match(await f.locator('section:has(h2:has-text("Avisos"))').innerText(), /Chegou o catálogo novo[\s\S]*Clientes VIP · John/);
await dash.screenshot({ path: shots + "/resumo.png", fullPage: true });

// ---- calendário (.ics)
const [dl] = await Promise.all([dash.waitForEvent("download"), f.locator('[data-ics]').first().click()]);
const icsText = fs.readFileSync(await dl.path(), "utf8");
assert.match(icsText, /BEGIN:VEVENT[\s\S]*DTSTART:\d{8}T150000[\s\S]*SUMMARY:Reunião com John/);

// ---- resolvido: some da lista e do cartão
await f.locator('section:has(h2:has-text("Precisam")) [data-done]').click();
await f.locator('section:has(h2:has-text("Precisam")) >> text=Tudo resolvido').waitFor();

// ---- grupos excluídos
await f.locator('[data-a="excl"]').click();
await f.locator('[data-excl]').first().waitFor();
await f.locator('label:has-text("Clientes VIP") input').check();
await f.locator('[data-a="exclclose"]').click();
await f.locator('select[data-a="period"]').selectOption("24h");
await sw.evaluate(() => (globalThis.__prompts = []));
await f.locator('[data-a="gen"]').click();
await f.locator('[data-a="gen"]:has-text("Gerar resumo")').waitFor({ timeout: 60000 });
const second = await sw.evaluate(() => globalThis.__prompts);
console.log("com o grupo excluído:", second);
assert.ok(!second.some((p) => /Clientes VIP/.test(p)));
assert.ok(second.some((p) => /John Smith/.test(p)));

// ---- "desde o último resumo": sem mensagens novas, nada a ler
await f.locator('select[data-a="period"]').selectOption("last");
await sw.evaluate(() => (globalThis.__prompts = []));
await f.locator('[data-a="gen"]').click();
await f.locator('.overview:has-text("Nada que precise de você")').waitFor({ timeout: 30000 });
assert.deepEqual(await sw.evaluate(() => globalThis.__prompts), []);

// ---- abrir a fonte: vai para as Conversas, na mensagem exata
await f.locator('select[data-a="hist"]').selectOption({ index: 3 }); // o primeiro resumo
await f.locator('section:has(h2:has-text("Compromissos")) .src').first().click();
await dash.waitForFunction(() => location.hash.startsWith("#/conversas?chat="));
const conv = dash.frameLocator('iframe[title="Conversas"]');
await conv.locator(".b.flash").waitFor({ timeout: 20000 });
console.log("aberta na mensagem:", await conv.locator(".b.flash").innerText());
assert.match(await conv.locator(".b.flash").innerText(), /Hi, I saw your ad/);

// ---- cartão da Visão geral reflete o último resumo
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.waitForSelector(".osc");
console.log("cartão:", await dash.locator(".osc").innerText());
assert.match(await dash.locator(".osc").innerText(), /Último:/);
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("RESUMO OK");
