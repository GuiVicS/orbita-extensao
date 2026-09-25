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
  const r = await V.tts({ text: " Sure, I'll call you at 10. ", voiceId: "voz123", speed: 1.1 });
  assert.equal(r.blob.type, "audio/mpeg");
  assert.equal(r.fellBack, false);
  const c = calls[0];
  assert.equal(c.url, "https://api.fish.audio/v1/tts");
  assert.equal(c.init.headers.Authorization, "Bearer fish_x");
  assert.equal(c.init.headers.model, "s2.1-pro-free", "padrão = modelo gratuito (como no n8n)");
  assert.equal(c.init.headers["Content-Type"], "application/json");
  assert.deepEqual(c.body, { text: "Sure, I'll call you at 10.", format: "mp3", mp3_bitrate: 128, latency: "normal", normalize: true, reference_id: "voz123", prosody: { speed: 1.1 } });
});

test("402 no modelo pago: tenta o gratuito e avisa", async () => {
  responder = () => audio(calls.at(-1).init.headers.model === "s2.1-pro" ? 402 : 200);
  const r = await V.tts({ text: "Oi", voiceId: "v", model: "s2.1-pro" });
  assert.deepEqual([r.model, r.fellBack], ["s2.1-pro-free", true]);
  assert.deepEqual(calls.map((c) => c.init.headers.model), ["s2.1-pro", "s2.1-pro-free"]);
  calls = [];
  responder = () => audio(402);
  await assert.rejects(V.tts({ text: "Oi", model: "s2.1-pro" }), { code: "INSUFFICIENT_CREDIT" });
  assert.equal(calls.length, 2, "tenta o gratuito uma vez e para");
});

test("erros tipados", async () => {
  for (const [status, code] of [[401, "AUTH"], [402, "INSUFFICIENT_CREDIT"], [404, "VOICE_NOT_FOUND"]]) {
    responder = () => audio(status);
    await assert.rejects(V.tts({ text: "hi" }), { code });
  }
  calls = [];
  responder = (n) => audio(n === 1 ? 429 : 200);
  assert.ok((await V.tts({ text: "hi" })).blob);
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

test("motores de voz: mesma interface; ElevenLabs recebe só o áudio (sem texto)", async () => {
  const V = globalThis.OrbitaVoice;
  for (const e of Object.values(V.ENGINES)) {
    assert.equal(typeof e.generate, "function");
    assert.ok(["text", "audio"].includes(e.input));
  }
  assert.equal(V.engine("fish").input, "text");
  assert.equal(V.engine("elevenlabs").input, "audio");
  assert.equal(V.engine("desconhecido").id, "fish"); // padrão
  let got = null;
  globalThis.OrbitaDub = { dub: async (o) => ((got = o), { blob: new Blob(["x"]) }) };
  const audio = new Blob(["gravação"]);
  await V.engine("elevenlabs").generate({ audio, sourceLang: "pt", targetLang: "en", durationSec: 5, settings: { dubDropBackground: false, dubTimeoutSec: 90 } });
  assert.deepEqual({ ...got, blob: got.blob === audio }, { blob: true, filename: undefined, sourceLang: "pt", targetLang: "en", durationSec: 5, dropBackground: false, timeoutSec: 90, onProgress: undefined });
  delete globalThis.OrbitaDub;
});
