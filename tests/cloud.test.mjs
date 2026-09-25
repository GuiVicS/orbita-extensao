// Testes da Órbita Cloud: planejamento da sincronização (puro) e chamadas ao Supabase simulado.
// Rodar: node --test tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
const mem = {};
globalThis.chrome = {
  storage: { local: { get: async (k) => (typeof k === "string" ? { [k]: mem[k] } : { ...mem }), set: async (o) => Object.assign(mem, o), remove: async (ks) => [].concat(ks).forEach((k) => delete mem[k]) } },
  alarms: { clear: async () => true, create: async () => {}, get: async () => null },
};
await import("../js/cloud-sync.js");
const C = globalThis.OrbitaCloud;

const item = (v) => ({ value: v, hash: C.hash(v) });
const L = (obj) => new Map(Object.entries(obj).map(([s, items]) => [s, new Map(Object.entries(items).map(([id, v]) => [id, item(v)]))]));

test("normalizeUrl e projectRef", () => {
  assert.equal(C.normalizeUrl(" https://abc123.supabase.co/rest/v1/ "), "https://abc123.supabase.co");
  assert.equal(C.projectRef("https://abc123.supabase.co"), "abc123");
  assert.equal(C.projectRef("https://meu.servidor.com"), null);
  assert.throws(() => C.normalizeUrl("abc"), /inválido/);
});

test("hash estável e chaves compostas", () => {
  assert.equal(C.hash({ a: 1, b: [1, 2] }), C.hash({ a: 1, b: [1, 2] }));
  assert.notEqual(C.hash({ a: 1 }), C.hash({ a: 2 }));
  assert.equal(C.keyToId("x"), "x");
  assert.deepEqual(C.idToKey(C.keyToId(["a", 1])), ["a", 1]);
  assert.equal(C.hasBinary({ a: { b: new Uint8Array(2) } }), true);
  assert.equal(C.hasBinary({ a: "x" }), false);
});

test("plan: envia novos/alterados, apaga removidos, aplica o que veio de fora", () => {
  const local = L({ "orbita/lists": { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } } });
  const state = { "orbita/lists": { a: C.hash({ n: 1 }), b: C.hash({ n: 0 }), d: C.hash({ n: 4 }) } };
  const remote = [{ store: "orbita/lists", id: "e", data: { n: 5 } }];
  const p = C.plan(local, state, remote);
  assert.deepEqual(p.apply, [{ store: "orbita/lists", id: "e", data: { n: 5 } }]);
  const push = Object.fromEntries(p.push.map((x) => [x.id, x.deleted ? "del" : x.data.n]));
  assert.deepEqual(push, { b: 2, c: 3, d: "del" });
  assert.deepEqual(Object.keys(p.state["orbita/lists"]).sort(), ["a", "b", "c", "e"]);
});

test("plan: alteração local vence a remota; remoção remota apaga só se não mexeram aqui", () => {
  const local = L({ s: { a: { v: "aqui" }, b: { v: 1 } } });
  const state = { s: { a: C.hash({ v: "antes" }), b: C.hash({ v: 1 }) } };
  const remote = [
    { store: "s", id: "a", data: { v: "lá" } },
    { store: "s", id: "b", deleted: true },
  ];
  const p = C.plan(local, state, remote);
  assert.deepEqual(p.apply, [{ store: "s", id: "b", deleted: true }]);
  assert.deepEqual(p.push.map((x) => [x.id, x.data?.v]), [["a", "aqui"]]);
  assert.equal(p.state.s.b, undefined);
});

test("plan: sem mudanças não envia nada", () => {
  const local = L({ s: { a: { v: 1 } } });
  const p = C.plan(local, { s: { a: C.hash({ v: 1 }) } }, []);
  assert.equal(p.push.length + p.apply.length, 0);
});

test("planInitial merge: une e resolve conflito pelo updatedAt", () => {
  const local = L({ s: { a: { v: "aqui", updatedAt: 10 }, b: { v: "aqui", updatedAt: 50 }, só: { v: 1 } } });
  const remote = [
    { store: "s", id: "a", data: { v: "lá", updatedAt: 20 } },
    { store: "s", id: "b", data: { v: "lá", updatedAt: 30 } },
    { store: "s", id: "novo", data: { v: 2 } },
  ];
  const p = C.planInitial(local, remote, "merge");
  assert.deepEqual(p.apply.map((x) => x.id).sort(), ["a", "novo"]);
  assert.deepEqual(p.push.map((x) => x.id).sort(), ["b", "só"]);
  assert.deepEqual(Object.keys(p.state.s).sort(), ["a", "b", "novo", "só"]);
});

test("planInitial pull: a nuvem substitui; push: o local substitui", () => {
  const local = L({ s: { a: { v: 1 }, x: { v: 9 } } });
  const remote = [{ store: "s", id: "a", data: { v: 2 } }, { store: "t", id: "z", data: { v: 3 } }];
  const pull = C.planInitial(local, remote, "pull");
  assert.deepEqual(pull.apply.map((x) => `${x.store}/${x.id}:${x.deleted ? "del" : x.data.v}`).sort(), ["s/a:2", "s/x:del", "t/z:3"]);
  assert.equal(pull.push.length, 0);
  const push = C.planInitial(local, remote, "push");
  assert.deepEqual(push.push.map((x) => `${x.store}/${x.id}:${x.deleted ? "del" : x.data.v}`).sort(), ["s/a:1", "s/x:9", "t/z:del"]);
  assert.equal(push.apply.length, 0);
});

test("login, criação da tabela e erros do Supabase", async () => {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes("/auth/v1/token?grant_type=password")) return new Response(JSON.stringify(JSON.parse(init.body).password === "ok" ? { access_token: "T", refresh_token: "R", expires_in: 3600, user: { id: "u1", email: "a@b.c" } } : { error: "invalid_grant", error_description: "Invalid login credentials" }), { status: JSON.parse(init.body).password === "ok" ? 200 : 400 });
    if (url.includes("/database/query")) return new Response(init.headers.Authorization === "Bearer sbp_ok" ? "[]" : JSON.stringify({ message: "Unauthorized" }), { status: init.headers.Authorization === "Bearer sbp_ok" ? 201 : 401 });
    if (url.includes("/rest/v1/orbita_records?select=id&limit=1")) return new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.orbita_records' in the schema cache" }), { status: 404 });
    return new Response("{}", { status: 500 });
  };
  const cfg = { url: "https://abc.supabase.co", key: "sb_publishable_x" };
  await assert.rejects(C.signIn(cfg, "a@b.c", "errada"), /Invalid login credentials/);
  const u = await C.signIn(cfg, "a@b.c", "ok");
  assert.equal(u.userId, "u1");
  assert.equal(mem["orbita:cloud:secrets"].accessToken, "T");
  assert.equal(calls.at(-1).init.headers.apikey, "sb_publishable_x");
  await assert.rejects(C.createSchema(cfg, "sbp_no"), (e) => e.code === "AUTH");
  await C.createSchema(cfg, "sbp_ok");
  const q = calls.at(-1);
  assert.equal(q.url, "https://api.supabase.com/v1/projects/abc/database/query");
  assert.match(JSON.parse(q.init.body).query, /enable row level security/);
  assert.equal(await C.checkTable(cfg), false);
  assert.equal(calls.at(-1).init.headers.Authorization, "Bearer T");
});
