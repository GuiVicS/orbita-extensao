// Testes do motor de tradução (js/chat-translate.js). Rodar: node --test tests/*.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// --- ambiente simulado: chrome.storage + fetch
let storage = {};
globalThis.chrome = { storage: { local: { get: async (k) => ({ [k]: storage[k] }), set: async (o) => Object.assign(storage, o) } } };
let calls = [];
let responder = null;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
  return responder(url, init, calls.length);
};
const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
const oa = (content) => json({ choices: [{ message: { content } }] });

await import("../js/chat-translate.js");
const T = globalThis.OrbitaTranslate;
let cache;
beforeEach(() => {
  calls = [];
  cache = new Map();
  T._setCacheStore({ get: async (k) => cache.get(k) ?? null, set: async (k, v) => cache.set(k, v) });
  storage = { "orbita:ai": { provider: "openai", keys: { openai: "sk-test" }, models: { openai: "gpt-5" } } };
});

test("preservação: variáveis, links, números", () => {
  assert.deepEqual(T.checkPreservation("Oi {{nome}}, custa R$ 99,90: https://x.co/a", "Hi {{nome}}, it costs R$ 99,90: https://x.co/a"), []);
  assert.match(T.checkPreservation("Oi {{nome}}", "Hi {{name}}").join(), /variáveis/);
  assert.match(T.checkPreservation("Veja https://x.co/a", "See https://x.co/b").join(), /link/);
  assert.match(T.checkPreservation("São 3 itens por 20", "There are three items for 20").join(), /números/);
  assert.match(T.checkPreservation("oi", "").join(), /vazia/);
  assert.match(T.checkPreservation("ok", "x".repeat(300)).join(), /longa/);
});

test("parseOutput aceita JSON cercado por texto", () => {
  assert.deepEqual(T.parseOutput('```json\n{"lang":"EN","translation":"Olá"}\n```'), { text: "Olá", detectedLang: "en" });
  assert.throws(() => T.parseOutput("Olá"), { code: "INVALID_OUTPUT" });
});

test("prompt inclui regras, tom, glossário e contexto", () => {
  const p = T.buildPrompt({ text: "Oi", from: "pt", to: "en", tone: "formal", context: [{ fromMe: false, text: "Hello" }], glossary: [{ term: "Órbita", keep: true }] });
  assert.match(p.system, /Brazilian Portuguese to English/);
  assert.match(p.system, /formal/);
  assert.match(p.system, /"Órbita" → keep untranslated/);
  assert.match(p.system, /Customer: Hello/);
  assert.equal(p.user, "<message>\nOi\n</message>");
});

test("tradução via API compatível com OpenAI + cache", async () => {
  responder = () => oa('{"lang":"en","translation":"Oi, tudo bem?"}');
  const r = await T.translate({ text: "Hi, how are you?", to: "pt" });
  assert.equal(r.text, "Oi, tudo bem?");
  assert.equal(r.detectedLang, "en");
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
  assert.equal(calls[0].body.model, "gpt-5");
  const again = await T.translate({ text: "Hi, how are you?", to: "pt" });
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1, "segunda vez vem do cache");
});

test("requisições iguais em andamento são deduplicadas", async () => {
  responder = async () => (await new Promise((r) => setTimeout(r, 30)), oa('{"lang":"en","translation":"Olá"}'));
  const [a, b] = await Promise.all([T.translate({ text: "Hello", to: "pt" }), T.translate({ text: "Hello", to: "pt" })]);
  assert.equal(a.text, b.text);
  assert.equal(calls.length, 1);
});

test("saída que altera número é refeita e, se persistir, falha sem devolver texto", async () => {
  responder = (u, i, n) => oa(n === 1 ? '{"lang":"pt","translation":"It costs twenty"}' : '{"lang":"pt","translation":"It costs 20"}');
  assert.equal((await T.translate({ text: "Custa 20", to: "en" })).text, "It costs 20");
  assert.match(calls[1].body.messages[0].content, /rejected because: números alterados/);
  calls = [];
  responder = () => oa('{"lang":"pt","translation":"It costs twenty"}');
  await assert.rejects(T.translate({ text: "Custa 30", to: "en" }), { code: "INVALID_OUTPUT" });
  assert.equal(calls.length, 2);
});

test("Anthropic: cabeçalhos, esforço baixo, fallbacks e recusa", async () => {
  storage = { "orbita:ai": { provider: "anthropic", keys: { anthropic: "sk-ant-x" }, models: {} } };
  responder = () => json({ stop_reason: "end_turn", content: [{ type: "text", text: '{"lang":"pt","translation":"Hello!"}' }] });
  assert.equal((await T.translate({ text: "Olá!", to: "en" })).text, "Hello!");
  const c = calls[0];
  assert.equal(c.url, "https://api.anthropic.com/v1/messages");
  assert.equal(c.init.headers["x-api-key"], "sk-ant-x");
  assert.equal(c.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(c.init.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(c.body.model, "claude-opus-5");
  assert.deepEqual(c.body.output_config, { effort: "low" });
  assert.equal(c.body.fallbacks, "default");
  responder = () => json({ stop_reason: "refusal", content: [] });
  await assert.rejects(T.translate({ text: "Outro texto", to: "en" }), { code: "REFUSED" });
});

test("erros tipados: chave inválida, limite (com 1 nova tentativa), sem configuração", async () => {
  responder = () => json({ error: "bad key" }, 401);
  await assert.rejects(T.translate({ text: "a1", to: "en" }), { code: "AUTH" });
  calls = [];
  responder = () => json({ error: "slow down" }, 429);
  await assert.rejects(T.translate({ text: "a2", to: "en" }), { code: "RATE_LIMIT" });
  assert.equal(calls.length, 2, "uma nova tentativa");
  storage = { "orbita:ai": { provider: "groq", keys: {} } };
  await assert.rejects(T.translate({ text: "a3", to: "en" }), { code: "NOT_CONFIGURED" });
});

test("modelo aposentado: escolhe outro pela preferência e salva", async () => {
  responder = (url) => (url.endsWith("/models") ? json({ data: [{ id: "gpt-5" }, { id: "whisper-1" }, { id: "gpt-4.1" }] }) : JSON.parse(calls.at(-1).init.body).model === "gpt-5" ? json({ error: { message: "The model gpt-5 does not exist" } }, 404) : oa('{"lang":"pt","translation":"Hi"}'));
  assert.equal((await T.translate({ text: "Oi", to: "en" })).text, "Hi");
  assert.equal(storage["orbita:ai"].models.openai, "gpt-4.1");
});

test("pickModel ignora modelos que não são de conversa", () => {
  assert.equal(T.pickModel(["whisper-large-v3", "llama-3.3-70b-versatile", "gpt-oss-120b"], "groq"), "gpt-oss-120b");
  assert.equal(T.pickModel(["tts-1", "whisper-1"], "openai"), null);
});

test("corretor: corrige, guarda em cache e mantém espaços das pontas", async () => {
  responder = () => oa('{"corrected":"Olá, você pode vir amanhã às 10h?"}');
  const r = await T.correct({ text: "ola voce pode vir amanha as 10h? ", lang: "pt" });
  assert.deepEqual(r, { text: "Olá, você pode vir amanhã às 10h? ", changed: true });
  assert.match(calls[0].body.messages[0].content, /MINIMUM changes/);
  assert.match(calls[0].body.messages[0].content, /Brazilian Portuguese/);
  const again = await T.correct({ text: "ola voce pode vir amanha as 10h? ", lang: "pt" });
  assert.equal(again.cached, true);
  assert.equal(calls.length, 1);
});

test("corretor: sem erros devolve igual; reescrita ou número alterado é descartado", async () => {
  responder = () => oa('{"corrected":"Tudo certo."}');
  assert.equal((await T.correct({ text: "Tudo certo." })).changed, false);
  responder = () => oa('{"corrected":"Custa 25 reais."}');
  await assert.rejects(T.correct({ text: "custa 20 reais" }), { code: "INVALID_OUTPUT" });
  assert.equal(calls.length, 3); // 1 + 2 tentativas
  responder = () => oa('{"corrected":"Prezado cliente, gostaríamos de informar que o seu pedido já se encontra disponível para retirada em nossa loja."}');
  await assert.rejects(T.correct({ text: "pedido pronto, pode buscar" }), /mudou demais/);
  assert.match(T.checkCorrection("oi {{nome}}", "Oi {{name}}").join(), /variáveis/);
  assert.throws(() => T.parseCorrection("Olá"), { code: "INVALID_OUTPUT" });
});
