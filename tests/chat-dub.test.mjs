// Testes da dublagem da ElevenLabs (js/chat-dub.js) com a API simulada.
// Rodar: node --test tests/*.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

let storage = {};
globalThis.chrome = { storage: { local: { get: async (k) => ({ [k]: storage[k] }), set: async (o) => Object.assign(storage, o) } } };
await import("../js/chat-dub.js");
const D = globalThis.OrbitaDub;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const audio = new Blob([new Uint8Array(3000).fill(1)], { type: "audio/wav" });
let calls;
let statuses; // respostas do GET de status, em ordem
let clock;
function api(overrides = {}) {
  return async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ url, method, init });
    for (const [re, fn] of Object.entries(overrides)) if (new RegExp(re).test(`${method} ${url}`)) return fn(url, init);
    if (method === "POST" && url.endsWith("/v1/dubbing")) return json({ dubbing_id: "dub_123", expected_duration_sec: 12 });
    if (method === "GET" && /\/v1\/dubbing\/dub_123$/.test(url)) return json(statuses.shift() ?? { status: "dubbing" });
    if (method === "GET" && /\/v1\/dubbing\/dub_123\/audio\/en$/.test(url)) return new Response(new Uint8Array(5000).fill(2), { status: 200, headers: { "content-type": "audio/mpeg" } });
    if (method === "DELETE") return json({ status: "ok" });
    return json({ detail: "não esperado" }, 500);
  };
}
const run = (extra = {}, overrides) =>
  D.dub({ blob: audio, sourceLang: "pt", targetLang: "en", apiKey: "sk_test", durationSec: 8, fetch: api(overrides), sleep: async (ms) => (clock += ms), now: () => clock, ...extra });

beforeEach(() => {
  calls = [];
  statuses = [{ status: "dubbing" }, { status: "dubbed" }];
  clock = 0;
  storage = {};
});

test("cria o projeto com a gravação, espera ficar pronta, baixa o áudio e apaga o projeto", async () => {
  const progress = [];
  const r = await run({ onProgress: (p) => progress.push(p.stage) });
  assert.equal(r.dubbingId, "dub_123");
  assert.equal(r.mime, "audio/mpeg");
  assert.equal(r.blob.size, 5000);
  const create = calls[0];
  assert.equal(create.method, "POST");
  assert.equal(create.init.headers["xi-api-key"], "sk_test");
  const f = create.init.body;
  assert.equal(f.get("target_lang"), "en");
  assert.equal(f.get("source_lang"), "pt");
  assert.equal(f.get("num_speakers"), "1");
  assert.equal(f.get("disable_voice_cloning"), "false");
  assert.equal(f.get("drop_background_audio"), "true");
  assert.equal((await f.get("file").arrayBuffer()).byteLength, 3000);
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace("https://api.elevenlabs.io", "")}`), [
    "POST /v1/dubbing",
    "GET /v1/dubbing/dub_123",
    "GET /v1/dubbing/dub_123",
    "GET /v1/dubbing/dub_123/audio/en",
    "DELETE /v1/dubbing/dub_123",
  ]);
  assert.deepEqual([...new Set(progress)], ["uploading", "dubbing", "downloading"]);
  // nenhum serviço de transcrição/tradução/TTS foi chamado
  assert.ok(calls.every((c) => c.url.startsWith("https://api.elevenlabs.io/v1/dubbing")));
});

test("idioma de origem automático não é enviado; chave vem das preferências", async () => {
  storage["orbita:chat:secrets"] = { elevenApiKey: "sk_salva" };
  await run({ sourceLang: "auto", apiKey: undefined });
  assert.equal(calls[0].init.body.get("source_lang"), null);
  assert.equal(calls[0].init.headers["xi-api-key"], "sk_salva");
});

test("status failed: erro claro, e o projeto é apagado", async () => {
  statuses = [{ status: "failed", error: "no speech detected" }];
  await assert.rejects(run(), (e) => e.code === "FAILED" && /no speech detected/.test(e.message));
  assert.equal(calls.at(-1).method, "DELETE");
});

test("polling passa do tempo máximo: TIMEOUT", async () => {
  statuses = Array(100).fill({ status: "dubbing" });
  await assert.rejects(run({ timeoutSec: 20 }), (e) => e.code === "TIMEOUT" && /20 s/.test(e.message));
  assert.ok(calls.filter((c) => c.method === "GET").length <= 5);
});

test("sem créditos / cota: erro QUOTA com orientação", async () => {
  await assert.rejects(run({}, { "POST .*/v1/dubbing$": () => json({ detail: { status: "quota_exceeded", message: "This request exceeds your quota." } }, 401) }), (e) => e.code === "QUOTA" && /créditos/.test(e.message));
  await assert.rejects(run({}, { "POST .*/v1/dubbing$": () => json({ detail: { status: "payment_required" } }, 402) }), { code: "QUOTA" });
});

test("chave inválida, erro de validação e falha na criação", async () => {
  await assert.rejects(run({}, { "POST .*/v1/dubbing$": () => json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, 401) }), { code: "AUTH" });
  await assert.rejects(run({}, { "POST .*/v1/dubbing$": () => json({ detail: { status: "invalid_file", message: "File type not supported" } }, 422) }), (e) => e.code === "PROVIDER" && /File type not supported/.test(e.message));
  await assert.rejects(run({}, { "POST .*/v1/dubbing$": () => json({}) }), (e) => /identificador/.test(e.message));
});

test("limite de uso (429) e instabilidade (5xx): tenta mais uma vez", async () => {
  let n = 0;
  const r = await run({}, { "POST .*/v1/dubbing$": () => (++n === 1 ? json({ detail: { status: "too_many_concurrent_requests" } }, 429) : json({ dubbing_id: "dub_123" })) });
  assert.equal(r.dubbingId, "dub_123");
  await assert.rejects(run({}, { "POST .*/v1/dubbing$": () => json({}, 503) }), { code: "PROVIDER" });
});

test("valida antes de enviar: idioma, mesmo idioma, tamanho, duração, chave", async () => {
  await assert.rejects(run({ targetLang: "he" }), (e) => e.code === "UNSUPPORTED_LANG" && /inglês/.test(e.message));
  await assert.rejects(run({ targetLang: "pt" }), { code: "SAME_LANG" });
  await assert.rejects(run({ durationSec: 3 * 3600 }), { code: "TOO_LONG" });
  await assert.rejects(run({ blob: { size: D.MAX_BYTES + 1 } }), { code: "TOO_LARGE" });
  await assert.rejects(run({ apiKey: "" }), { code: "NOT_CONFIGURED" });
  assert.equal(calls.length, 0); // nada foi enviado
  assert.ok(D.supports("fil") && D.supports("ZH") && !D.supports("he"));
});

test("checkKey mostra plano e créditos restantes", async () => {
  const r = await D.checkKey("sk_test", { fetch: async () => json({ tier: "creator", character_count: 1000, character_limit: 100000, next_character_count_reset_unix: 1790000000 }) });
  assert.deepEqual(r, { tier: "creator", creditsLeft: 99000, resetAt: 1790000000000 });
  await assert.rejects(D.checkKey("sk_ruim", { fetch: async () => json({ detail: { status: "invalid_api_key" } }, 401) }), { code: "AUTH" });
});
