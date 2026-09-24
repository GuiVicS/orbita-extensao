// Testes de js/group-lists.js (parte pura). Rodar: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import "../js/group-lists.js";
const G = globalThis.OrbitaGroupLists;

test("participantes da lista: sem você, sem número oculto, sem repetição, com grupo e admin", () => {
  const info = {
    chatId: "1@g.us",
    subject: "Clientes VIP",
    participants: [
      { id: "5511000000000@c.us", phone: "5511000000000", isMe: true },
      { id: "5511999998888@c.us", phone: "5511999998888", name: "John", isAdmin: true },
      { id: "88@lid", phone: "5521988887777", pushname: "Pedro" },
      { id: "99@lid", phone: null, pushname: "Oculto" },
      { id: "x@c.us", phone: "5511999998888", name: "John de novo" },
    ],
  };
  const { contacts, hidden } = G.contactsOf(info);
  assert.equal(hidden, 1);
  assert.deepEqual(contacts, [
    { phone: "5511999998888", name: "John", vars: { grupo: "Clientes VIP", admin: "sim" } },
    { phone: "5521988887777", name: "Pedro", vars: { grupo: "Clientes VIP", admin: "não" } },
  ]);
  assert.equal(G.defaultName(info), "Grupo: Clientes VIP");
});
