// Teste: provedor OpenCode Zen nas Opções (Nemotron sugerido), chaves dos outros
// provedores preservadas ao salvar, e variações das campanhas pelo OpenCode.
// Rodar: node tests/e2e/ai-providers.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const profile = here + ".profile-aiprov";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
await sw.evaluate(() => {
  globalThis.__ai = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    globalThis.__ai.push({ url, model: body.model, auth: init.headers?.Authorization });
    if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "nemotron-3-ultra-free" }, { id: "big-pickle" }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "Oi, tudo certo por aí? Seu pedido já saiu!" } }] }), { status: 200 });
  };
});
const errors = [];
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(e.message));
await p.goto(`chrome-extension://${id}/options.html`);
// OpenCode Zen na lista, com o Nemotron sugerido
await p.selectOption("#provider", "opencode");
assert.equal(await p.inputValue("#model"), "nemotron-3-ultra-free");
assert.match(await p.locator("#providerHelp").innerText(), /opencode\.ai\/auth/);
await p.fill("#apiKey", "sk-oc");
await p.check("#enabled");
await p.click("#save");
await p.waitForSelector("#saveStatus.ok");
// trocar para Groq e salvar não apaga a chave do OpenCode
await p.selectOption("#provider", "groq");
await p.fill("#apiKey", "gsk_x");
await p.click("#save");
await p.waitForSelector("#saveStatus.ok");
let ai = await p.evaluate(async () => (await chrome.storage.local.get("orbita:ai"))["orbita:ai"]);
console.log("chaves salvas:", ai.keys);
assert.deepEqual([ai.provider, ai.keys.groq, ai.keys.opencode, ai.models.opencode], ["groq", "gsk_x", "sk-oc", "nemotron-3-ultra-free"]);
// voltar para o OpenCode: chave e modelo aparecem de novo
await p.selectOption("#provider", "opencode");
assert.equal(await p.inputValue("#apiKey"), "sk-oc");
assert.equal(await p.inputValue("#model"), "nemotron-3-ultra-free");
await p.click("#save");
await p.waitForSelector("#saveStatus.ok");
// "Gerar variação" (motor das campanhas, código minificado) vai pelo OpenCode
await sw.evaluate(() => (globalThis.__ai = []));
await p.fill("#sample", "Olá! Seu pedido já foi enviado.");
await p.click("#test");
await p.waitForSelector("#testStatus.ok", { timeout: 20000 });
const calls = await sw.evaluate(() => globalThis.__ai.filter((c) => /chat\/completions/.test(c.url)));
console.log("variação:", calls, "|", await p.locator("#testOut").innerText());
assert.equal(calls.at(-1).url, "https://opencode.ai/zen/v1/chat/completions");
assert.equal(calls.at(-1).model, "nemotron-3-ultra-free");
assert.equal(calls.at(-1).auth, "Bearer sk-oc");
// seção "Nemotron (NVIDIA)": OpenRouter grátis (padrão) ou OpenCode; Testar mostra o motivo real
const p2 = await ctx.newPage();
p2.on("pageerror", (e) => errors.push(e.message));
await p2.addInitScript(() => {
  const real = window.fetch.bind(window);
  window.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith("https://opencode.ai/")) return new Response(JSON.stringify({ type: "error", error: { type: "FreeTierError", message: "OpenCode's free tier can only be used from within OpenCode" } }), { status: 403 });
    if (u.startsWith("https://openrouter.ai/")) {
      const ok = init.headers?.Authorization === "Bearer sk-or-bom" && JSON.parse(init.body).model === "nvidia/nemotron-3-ultra-550b-a55b:free";
      return new Response(JSON.stringify(ok ? { choices: [{ message: { content: "ok" } }] } : { error: { message: "No auth credentials found" } }), { status: ok ? 200 : 401 });
    }
    return real(url, init);
  };
});
await p2.goto(`chrome-extension://${id}/options.html`);
assert.equal(await p2.inputValue("#nmProvider"), "openrouter");
assert.equal(await p2.inputValue("#nmModel"), "nvidia/nemotron-3-ultra-550b-a55b:free");
// OpenCode: a mesma chave do provedor principal aparece; o Testar explica a restrição do plano gratuito
await p2.selectOption("#nmProvider", "opencode");
assert.equal(await p2.inputValue("#nmKey"), "sk-oc");
assert.equal(await p2.inputValue("#nmModel"), "nemotron-3-ultra-free");
await p2.click("#nmTest");
await p2.waitForSelector('#nmStatus.err:has-text("só funciona dentro do app OpenCode")');
// OpenRouter: chave ruim → inválida; chave boa → funcionando
await p2.selectOption("#nmProvider", "openrouter");
await p2.fill("#nmKey", "sk-or-ruim");
await p2.click("#nmTest");
await p2.waitForSelector('#nmStatus.err:has-text("inválida")');
await p2.fill("#nmKey", "sk-or-bom");
await p2.click("#nmTest");
await p2.waitForSelector('#nmStatus.ok:has-text("respondeu")');
await p2.check("#nmSummary");
await p2.click("#nmSave");
await p2.waitForSelector('#nmStatus.ok:has-text("Resumo vai usar o Nemotron")');
ai = await p2.evaluate(async () => (await chrome.storage.local.get(["orbita:ai", "orbita:summary:ai"])));
console.log("depois da seção Nemotron:", ai["orbita:ai"].provider, ai["orbita:ai"].keys, ai["orbita:summary:ai"]);
assert.equal(ai["orbita:ai"].provider, "opencode"); // o provedor principal não mudou
assert.deepEqual([ai["orbita:ai"].keys.openrouter, ai["orbita:ai"].keys.opencode, ai["orbita:ai"].keys.groq], ["sk-or-bom", "sk-oc", "gsk_x"]);
assert.deepEqual(ai["orbita:summary:ai"], { engine: "nemotron", provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" });
// salvar a seção principal de IA depois não apaga a chave do OpenRouter
await p2.selectOption("#provider", "groq");
await p2.click("#save");
await p2.waitForSelector("#saveStatus.ok");
ai = await p2.evaluate(async () => (await chrome.storage.local.get("orbita:ai"))["orbita:ai"]);
assert.deepEqual([ai.provider, ai.keys.openrouter], ["groq", "sk-or-bom"]);
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("PROVEDORES DE IA OK");
