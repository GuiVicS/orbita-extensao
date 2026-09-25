// Testes do e-mail marketing: cliente da Resend (API simulada) e montagem do e-mail.
// Rodar: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
await import("../js/email-resend.js");
await import("../js/email-common.js");
const R = globalThis.OrbitaResend;
const E = globalThis.OrbitaEmail;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
function api(handler) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const c = { method: init.method || "GET", path: url.replace(R.BASE, ""), body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization };
    calls.push(c);
    return handler(c);
  };
  return { calls, client: R.client("re_test", { fetch, sleep: async () => {} }) };
}

test("contato novo vai direto para o segmento; existente é atualizado e adicionado", async () => {
  const { calls, client } = api((c) => {
    if (c.method === "POST" && c.path === "/contacts") return c.body.email === "ja@existe.com" ? json({ name: "validation_error", message: "Contact already exists" }, 422) : json({ object: "contact", id: "c1" });
    return json({ id: "ok" });
  });
  await client.addContact({ email: "novo@x.com", firstName: "Ana", lastName: "Lima" }, "seg1");
  assert.deepEqual(calls[0], { method: "POST", path: "/contacts", body: { email: "novo@x.com", first_name: "Ana", last_name: "Lima", segments: [{ id: "seg1" }] }, auth: "Bearer re_test" });
  await client.addContact({ email: "ja@existe.com", firstName: "Bia" }, "seg1");
  assert.deepEqual(calls.slice(1).map((c) => `${c.method} ${c.path}`), ["POST /contacts", "PATCH /contacts/ja%40existe.com", "POST /contacts/ja%40existe.com/segments/seg1"]);
});

test("broadcast: segmento, remetente, envio imediato ou agendado", async () => {
  const { calls, client } = api(() => json({ id: "b1" }));
  await client.createBroadcast({ segmentId: "s", from: "Loja <oi@loja.com>", subject: "Oi", html: "<p>x</p>", text: "x", replyTo: "r@loja.com", name: "Camp", scheduledAt: Date.UTC(2026, 9, 1, 12) });
  assert.deepEqual(calls[0].body, { segment_id: "s", from: "Loja <oi@loja.com>", subject: "Oi", html: "<p>x</p>", text: "x", reply_to: "r@loja.com", name: "Camp", send: true, scheduled_at: "2026-10-01T12:00:00.000Z" });
});

test("contatos paginados (100 por vez) e erros em português", async () => {
  let n = 0;
  const { client } = api((c) => (c.path.startsWith("/contacts") ? json({ has_more: ++n < 3, data: [{ id: `c${n}`, email: `${n}@x.com`, unsubscribed: n === 2 }] }) : json({})));
  const all = await client.contacts();
  assert.deepEqual(all.map((c) => c.email), ["1@x.com", "2@x.com", "3@x.com"]);
  for (const [status, name, code] of [[401, "restricted_api_key", "AUTH"], [429, "monthly_quota_exceeded", "QUOTA"], [429, "daily_quota_exceeded", "QUOTA"], [403, "validation_error", "DOMAIN"]]) {
    const { client: c2 } = api(() => json({ name, message: "The domain is not verified" }, status));
    await assert.rejects(c2.domains(), (e) => e.code === code);
  }
  // limite de pedidos: tenta de novo e passa
  let k = 0;
  const { client: c3 } = api(() => (++k < 3 ? json({ name: "rate_limit_exceeded" }, 429) : json({ data: [{ name: "loja.com", status: "verified" }] })));
  assert.equal((await c3.domains())[0].status, "verified");
  await assert.rejects(R.client("").domains(), { code: "AUTH" });
});

test("variáveis: nome e primeiro nome viram personalização da Resend; outras são avisadas", () => {
  assert.equal(E.resendVars("Oi {{primeiro_nome|cliente}}!"), "Oi {{{contact.first_name|cliente}}}!");
  assert.equal(E.resendVars("{{nome}}"), "{{{contact.first_name|}}} {{{contact.last_name|}}}");
  assert.deepEqual(E.unsupportedVars("Oi {{nome}}, seu pedido {{pedido}}", "{{cidade|SP}}"), ["pedido", "cidade"]);
  assert.deepEqual(E.splitName("Maria da Silva"), { firstName: "Maria", lastName: "da Silva" });
  assert.equal(E.emailOfVars({ Nome: "x", "E-mail": "a@b.com" }), "a@b.com");
  assert.equal(E.isEmail("a@b"), false);
});

test("e-mail montado: parágrafos, botão, rodapé com descadastro e versão texto", () => {
  const s = { company: "Stellar Print", address: "Rua A, 10 — SP" };
  const { subject, html, text } = E.build({ subject: "Oferta para {{primeiro_nome}}", preheader: "Só hoje", body: "Olá {{primeiro_nome|cliente}},\n\n*Promoção* em https://loja.com", button: { text: "Ver ofertas", url: "https://loja.com/o" } }, s);
  assert.equal(subject, "Oferta para {{{contact.first_name|}}}");
  assert.match(html, /<strong>Promoção<\/strong>/);
  assert.match(html, /href="https:\/\/loja.com\/o"[^>]*>Ver ofertas/);
  assert.match(html, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  assert.match(html, /Stellar Print · Rua A, 10 — SP/);
  assert.match(html, /display:none[^>]*>Só hoje/);
  assert.match(text, /Para não receber mais: \{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  // HTML próprio sem link de descadastro: o rodapé é acrescentado
  const own = E.build({ subject: "x", mode: "html", html: "<html><body><h1>Oi</h1></body></html>" }, s);
  assert.match(own.html, /<h1>Oi<\/h1>.*RESEND_UNSUBSCRIBE_URL.*<\/body>/s);
  assert.equal(E.sample("Oi {{{contact.first_name|cliente}}}"), "Oi Maria");
});
