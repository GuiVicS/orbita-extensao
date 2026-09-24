// Testes da transcrição (js/chat-transcribe.js). Rodar: node --test tests/*.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

let storage = {};
globalThis.chrome = { storage: { local: { get: async (k) => ({ [k]: storage[k] }), set: async (o) => Object.assign(storage, o) } } };
let calls = [];
let responder = null;
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  return responder(url, init, calls.length);
};
const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });
await import("../js/chat-translate.js");
await import("../js/chat-transcribe.js");
const W = globalThis.OrbitaTranscribe;
const audio = new Blob([new Uint8Array(1000)], { type: "audio/ogg; codecs=opus" });

beforeEach(() => {
  calls = [];
  storage = { "orbita:ai": { provider: "anthropic", keys: { anthropic: "sk-ant", groq: "gsk_x", openai: "sk-o" } } };
});

test("usa a Groq primeiro, com multipart e verbose_json", async () => {
  responder = () => json({ text: " Hi, can you call me? ", language: "English" });
  const r = await W.transcribe(audio);
  assert.deepEqual(r, { text: "Hi, can you call me?", lang: "en", provider: "groq" });
  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer gsk_x");
  const form = calls[0].init.body;
  assert.equal(form.get("model"), "whisper-large-v3-turbo");
  assert.equal(form.get("response_format"), "verbose_json");
  assert.equal(form.get("file").name, "audio.ogg");
});

test("sem chave da Groq, usa a OpenAI; sem nenhuma, erro claro", async () => {
  storage["orbita:ai"].keys = { openai: "sk-o" };
  responder = () => json({ text: "Olá", language: "portuguese" });
  assert.equal((await W.transcribe(audio)).provider, "openai");
  assert.equal(calls[0].init.body.get("model"), "whisper-1");
  storage["orbita:ai"].keys = {};
  await assert.rejects(W.transcribe(audio), { code: "NOT_CONFIGURED" });
});

test("áudio sem fala vira texto vazio", async () => {
  responder = () => json({ text: "[Música]", language: "english" });
  assert.equal((await W.transcribe(audio)).text, "");
  responder = () => json({ text: "Thanks for watching!", language: "english", segments: [{ no_speech_prob: 0.95 }] });
  assert.equal((await W.transcribe(audio)).text, "");
});

test("erros: chave inválida, limite com nova tentativa, arquivo grande", async () => {
  responder = () => json({}, 401);
  await assert.rejects(W.transcribe(audio), { code: "AUTH" });
  calls = [];
  responder = (u, i, n) => (n === 1 ? json({}, 429) : json({ text: "ok", language: "en" }));
  assert.equal((await W.transcribe(audio)).text, "ok");
  assert.equal(calls.length, 2);
  await assert.rejects(W.transcribe(new Blob([new Uint8Array(W.MAX_BYTES + 1)])), { code: "TOO_LARGE" });
});
