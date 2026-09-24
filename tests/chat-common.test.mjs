// Testes das partes puras de js/chat-common.js. Rodar: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import "../js/chat-common.js";
const C = globalThis.OrbitaChat;

test("variantes do 9º dígito", () => {
  assert.deepEqual(C.phoneVariants("551199998888"), ["551199998888", "5511999998888"]);
  assert.deepEqual(C.phoneVariants("+55 (11) 99999-8888"), ["5511999998888", "551199998888"]);
  assert.deepEqual(C.phoneVariants("14155550100"), ["14155550100"]);
  assert.deepEqual(C.phoneVariants(""), []);
});

test("mergeMessage é idempotente e preserva campos próprios", () => {
  const a = { id: "1", text: "Hi", ack: 1, translatedText: "Oi", translationStatus: "done" };
  const b = { id: "1", text: "Hi", ack: 3 };
  const m = C.mergeMessage(a, b);
  assert.equal(m.ack, 3);
  assert.equal(m.translatedText, "Oi");
  assert.deepEqual(C.mergeMessage(m, b), m);
});

test("ack nunca regride e apagada continua apagada", () => {
  const m = C.mergeMessage({ id: "1", text: "x", ack: 3, revoked: true }, { id: "1", text: "", ack: 1, revoked: false });
  assert.equal(m.ack, 3);
  assert.equal(m.revoked, true);
  assert.equal(m.text, "x");
});

test("edição invalida a tradução", () => {
  const m = C.mergeMessage({ id: "1", text: "Hi", translatedText: "Oi", translationStatus: "done" }, { id: "1", text: "Hello" });
  assert.equal(m.edited, true);
  assert.equal(m.translationStatus, "stale");
});

test("prévia por tipo", () => {
  assert.equal(C.previewOf({ type: "audio", audio: { duration: 400 } }), "🎤 Áudio (6:40)");
  assert.equal(C.previewOf({ type: "audio", audio: { transcript: "Hi" } }), "🎤 “Hi”");
  assert.equal(C.previewOf({ type: "audio", fromMe: true, textPt: "Oi", audio: { transcript: "Hi", generated: true } }), "🎤 “Oi”");
  assert.equal(C.previewOf({ revoked: true }), "🚫 Mensagem apagada");
  assert.equal(C.previewOf({ type: "other", label: "Foto" }), "📎 Foto");
});
