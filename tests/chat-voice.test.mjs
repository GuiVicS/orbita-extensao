// Testes do cliente do Fish Audio (js/chat-voice.js). Rodar: node --test tests/*.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

let storage = {};
globalThis.chrome = { storage: { local: { get: async (k) => ({ [k]: storage[k] }), set: async (o) => Object.assign(storage, o) } } };
let calls = [];
let responder = null;
globalThis.fetch = async (url, init) => (calls.push({ url, init, body: JSON.parse(init.body) }), responder(calls.length));
const audio = (status = 200) => ({ ok: status < 400, status, blob: async () => new Blob([new Uint8Array(status < 400 ? 500 : 0)]) });
await import("../js/chat-translate.js");
await import("../js/chat-voice.js");
const V = globalThis.OrbitaVoice;

beforeEach(() => {
  calls = [];
  storage = { "orbita:chat:secrets": { fishApiKey: "fish_x" } };
});

test("requisição conforme a documentação do Fish Audio", async () => {
  responder = () => audio();
  const blob = await V.tts({ text: " Sure, I'll call you at 10. ", voiceId: "voz123", speed: 1.1 });
  assert.equal(blob.type, "audio/mpeg");
  const c = calls[0];
  assert.equal(c.url, "https://api.fish.audio/v1/tts");
  assert.equal(c.init.headers.Authorization, "Bearer fish_x");
  assert.equal(c.init.headers.model, "s2.1-pro");
  assert.equal(c.init.headers["Content-Type"], "application/json");
  assert.deepEqual(c.body, { text: "Sure, I'll call you at 10.", format: "mp3", mp3_bitrate: 128, latency: "normal", normalize: true, reference_id: "voz123", prosody: { speed: 1.1 } });
});

test("erros tipados", async () => {
  for (const [status, code] of [[401, "AUTH"], [402, "INSUFFICIENT_CREDIT"], [404, "VOICE_NOT_FOUND"]]) {
    responder = () => audio(status);
    await assert.rejects(V.tts({ text: "hi" }), { code });
  }
  calls = [];
  responder = (n) => audio(n === 1 ? 429 : 200);
  assert.ok(await V.tts({ text: "hi" }));
  assert.equal(calls.length, 2, "uma nova tentativa no 429");
  storage = {};
  await assert.rejects(V.tts({ text: "hi" }), { code: "NOT_CONFIGURED" });
});

test("chave de cache depende de texto, voz, modelo e velocidade", async () => {
  const a = await V.cacheKey({ text: "Hi", voiceId: "v" });
  assert.equal(a, await V.cacheKey({ text: " Hi ", voiceId: "v" }));
  assert.notEqual(a, await V.cacheKey({ text: "Hi", voiceId: "w" }));
  assert.notEqual(a, await V.cacheKey({ text: "Hi", voiceId: "v", speed: 1.2 }));
  assert.match(a, /^tts:[0-9a-f]{64}$/);
});
