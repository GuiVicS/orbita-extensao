// Testes do resumo (js/chat-summary.js): preparo, fontes conferidas e junção.
// Rodar: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
await import("../js/chat-summary.js");
const S = globalThis.OrbitaSummary;

const T0 = Date.UTC(2026, 8, 25, 12); // 25/09 (UTC)
const msg = (n, min, extra) => ({ id: `m${n}`, ts: T0 + min * 60000, type: "text", fromMe: false, text: "", ...extra });
const chat = { chatId: "c1@c.us", name: "Carla", isGroup: false };
const group = { chatId: "g1@g.us", name: "Clientes VIP", isGroup: true };

test("preparo: período, contexto, ruído, marcações e o que ficou de fora", () => {
  const p = S.prepare(group, [
    msg(1, -60, { text: "mensagem antiga", authorName: "Ana" }),
    msg(2, 5, { text: "kkkk", authorName: "Bia" }),
    msg(3, 6, { text: "@5511000000000 consegue mandar a tabela até sexta?", authorName: "Pedro", mentions: [{ id: "5511000000000@c.us" }] }),
    msg(4, 7, { type: "audio", audio: { duration: 30 } }),
    msg(5, 8, { type: "audio", audio: { transcript: "reunião amanhã às 15h" }, authorName: "Ana" }),
    msg(6, 9, { type: "other", label: "Foto" }),
    msg(7, 10, { fromMe: true, text: "Vou ver" }),
  ], { since: T0, me: "5511000000000@c.us" });
  assert.equal(p.count, 3); // mensagens 3, 5 e 7 (contexto não conta; "kkkk", áudio sem transcrição e foto sem legenda saem)
  assert.equal(p.skippedAudio, 1);
  assert.equal(p.skippedMedia, 1);
  assert.match(p.lines[0], /\[1\] .* Ana \(contexto\): mensagem antiga/);
  assert.match(p.lines.join("\n"), /Pedro \(te marcou\): @5511000000000 consegue/);
  assert.match(p.lines.join("\n"), /Ana: \(áudio\) reunião amanhã às 15h/);
  assert.match(p.lines.join("\n"), /VOCÊ: Vou ver/);
});

test("fontes: item sem fonte válida é descartado; pergunta respondida depois não é pendência", () => {
  const p = S.prepare(chat, [
    msg(1, 1, { text: "Qual o prazo da proposta?" }),
    msg(2, 2, { text: "E a reunião fica sexta 26/09 às 15h?" }),
    msg(3, 30, { fromMe: true, text: "Sexta às 15h confirmado" }),
    msg(4, 40, { text: "Pode me mandar o boleto?" }),
  ], { since: T0 });
  const r = S.parse(
    JSON.stringify({
      summary: "Carla quer prazo e boleto; reunião sexta.",
      priority: 2,
      items: [
        { type: "question", text: "Carla perguntou o prazo da proposta", who: "Carla", sources: [1] },
        { type: "commitment", text: "Reunião com Carla", sources: [2, 3], date: "2026-09-26", time: "15:00" },
        { type: "request", text: "Carla pediu o boleto", sources: [4] },
        { type: "request", text: "inventado", sources: [99] },
        { type: "notice", text: "sem fonte", sources: [] },
        { type: "commitment", text: "data ruim", sources: [2], date: "26/09", time: "25:00", date_text: "sexta" },
      ],
    }),
    chat,
    p,
  );
  assert.equal(r.items.length, 4);
  const q = r.items.find((i) => i.type === "question");
  assert.equal(q.needsReply, false); // você respondeu depois (msg 3)
  assert.equal(q.answered, true);
  const boleto = r.items.find((i) => i.text.includes("boleto"));
  assert.equal(boleto.needsReply, true);
  assert.deepEqual(boleto.sources.map((s) => s.id), ["m4"]);
  assert.equal(boleto.sources[0].who, "Carla");
  const bad = r.items.find((i) => i.text === "data ruim");
  assert.deepEqual([bad.date, bad.time, bad.dateText], [null, null, "sexta"]);
});

test("junção: pendências primeiro, compromissos por data sem repetir, fontes somadas", () => {
  const base = { chatName: "x", isGroup: false, answered: false, dateText: null };
  const merged = S.merge([
    { chatId: "a", summary: "a", priority: 1, count: 3, skippedAudio: 1, skippedMedia: 0, items: [
      { ...base, type: "commitment", text: "Reunião com João sobre orçamento", date: "2026-09-27", time: "10:00", ts: 5, needsReply: false, sources: [{ id: "a1" }] },
      { ...base, type: "question", text: "Prazo?", ts: 9, needsReply: true, sources: [{ id: "a2" }] },
    ] },
    { chatId: "b", summary: "b", priority: 3, count: 2, skippedAudio: 0, skippedMedia: 2, items: [
      { ...base, type: "commitment", text: "Reunião com João sobre orçamento amanhã", date: "2026-09-27", time: "10:00", ts: 6, needsReply: false, sources: [{ id: "b1" }] },
      { ...base, type: "deadline", text: "Entrega do pedido", date: "2026-09-26", time: null, ts: 7, needsReply: false, sources: [{ id: "b2" }] },
      { ...base, type: "request", text: "Mandar tabela", ts: 3, needsReply: true, sources: [{ id: "b3" }] },
    ] },
  ]);
  assert.deepEqual(merged.pending.map((i) => i.text), ["Mandar tabela", "Prazo?"]);
  assert.deepEqual(merged.dated.map((i) => i.text), ["Entrega do pedido", "Reunião com João sobre orçamento"]);
  assert.deepEqual(merged.dated[1].sources.map((s) => s.id), ["a1", "b1"]);
  assert.deepEqual(merged.chats.map((c) => c.chatId), ["b", "a"]);
  assert.deepEqual(merged.totals, { chats: 2, messages: 5, skippedAudio: 1, skippedMedia: 2 });
});

test("resumo de uma conversa: tenta de novo quando a IA responde fora do formato", async () => {
  let n = 0;
  const complete = async () => (++n === 1 ? "desculpe" : JSON.stringify({ summary: "ok", priority: 1, items: [{ type: "question", text: "Perguntou o preço", sources: [1] }] }));
  const r = await S.summarizeChat(chat, [msg(1, 1, { text: "Quanto custa?" })], { since: T0, complete });
  assert.equal(n, 2);
  assert.equal(r.items[0].needsReply, true);
  const none = await S.summarizeChat(chat, [msg(1, -5, { text: "antiga" })], { since: T0, complete: async () => assert.fail("não deveria chamar a IA") });
  assert.equal(none.count, 0);
});
