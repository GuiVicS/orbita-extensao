// Teste: Órbita Cloud com um Supabase simulado (assistente completo, criação da
// tabela, primeira sincronização, outro computador, remoções, "usar os da nuvem",
// alarme e desligar). Rodar: node tests/e2e/cloud.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-cloud";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 900, height: 1100 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
ctx.setDefaultTimeout(15000);

// ---- Supabase simulado
const URL_ = "https://abcdefghijklmnop.supabase.co";
const sb = { users: {}, table: false, rows: new Map(), clock: 0, calls: [] };
const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++sb.clock * 1000).toISOString();
const userOf = (h) => Object.values(sb.users).find((u) => h.authorization === `Bearer tok-${u.id}`);
await ctx.route("https://api.supabase.com/**", async (r) => {
  const req = r.request();
  sb.calls.push({ url: req.url(), auth: req.headers().authorization });
  if (req.headers().authorization !== "Bearer sbp_certo") return r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Unauthorized" }) });
  assert.match(JSON.parse(req.postData()).query, /create table if not exists public.orbita_records/);
  sb.table = true;
  return r.fulfill({ status: 201, contentType: "application/json", body: "[]" });
});
await ctx.route(`${URL_}/**`, async (r) => {
  const req = r.request();
  const u = new URL(req.url());
  const h = req.headers();
  const json = (o, status = 200, headers = {}) => r.fulfill({ status, contentType: "application/json", headers, body: JSON.stringify(o) });
  if (h.apikey !== "sb_publishable_teste") return json({ message: "Invalid API key" }, 401);
  if (u.pathname === "/auth/v1/settings") return json({ external: { email: true } });
  if (u.pathname === "/auth/v1/signup") {
    const { email, password } = JSON.parse(req.postData());
    if (sb.users[email]) return json({ msg: "User already registered" }, 422);
    const user = (sb.users[email] = { id: `u${Object.keys(sb.users).length + 1}`, email, password });
    return json({ access_token: `tok-${user.id}`, refresh_token: `ref-${user.id}`, expires_in: 3600, user: { id: user.id, email } });
  }
  if (u.pathname === "/auth/v1/token") {
    const body = JSON.parse(req.postData());
    const user = u.searchParams.get("grant_type") === "password" ? sb.users[body.email] : Object.values(sb.users).find((x) => body.refresh_token === `ref-${x.id}`);
    if (!user || (body.password !== undefined && user.password !== body.password)) return json({ error: "invalid_grant", error_description: "Invalid login credentials" }, 400);
    return json({ access_token: `tok-${user.id}`, refresh_token: `ref-${user.id}`, expires_in: 3600, user: { id: user.id, email: user.email } });
  }
  if (u.pathname === "/rest/v1/orbita_records") {
    const user = userOf(h);
    if (!user) return json({ message: "JWT expired" }, 401);
    if (!sb.table) return json({ code: "PGRST205", message: "Could not find the table 'public.orbita_records' in the schema cache" }, 404);
    if (req.method() === "POST") {
      assert.match(h.prefer, /resolution=merge-duplicates/);
      assert.equal(u.searchParams.get("on_conflict"), "user_id,store,id");
      for (const row of JSON.parse(req.postData())) {
        assert.equal(row.user_id, user.id);
        sb.rows.set(`${user.id}|${row.store}|${row.id}`, { ...row, updated_at: stamp() });
      }
      return r.fulfill({ status: 201, body: "" });
    }
    let rows = [...sb.rows.values()].filter((x) => x.user_id === user.id);
    const gt = u.searchParams.get("updated_at");
    if (gt) rows = rows.filter((x) => x.updated_at > gt.slice(3));
    if (u.searchParams.get("deleted") === "eq.false") rows = rows.filter((x) => !x.deleted);
    const desc = /updated_at\.desc/.test(u.searchParams.get("order") || "");
    rows.sort((a, b) => (a.updated_at < b.updated_at ? -1 : 1) * (desc ? -1 : 1));
    const total = rows.length;
    const off = Number(u.searchParams.get("offset") || 0);
    rows = rows.slice(off, off + Number(u.searchParams.get("limit") || 1000));
    const fields = (u.searchParams.get("select") || "*").split(",");
    const out = rows.map((x) => Object.fromEntries(fields.map((f) => [f, x[f]])));
    return json(out, 200, /count=exact/.test(h.prefer || "") ? { "content-range": `0-${out.length - 1}/${total}`, "access-control-expose-headers": "content-range" } : {});
  }
  return json({ message: "not found" }, 404);
});
const remote = (store, rid) => [...sb.rows.values()].find((x) => x.store === store && x.id === rid);

// ---- painel: cria o banco local e alguns dados
const dash = await ctx.newPage();
dash.on("pageerror", (e) => errors.push("dash: " + e.message));
await dash.goto(`chrome-extension://${id}/dashboard.html#/`);
await dash.waitForTimeout(1200);
const idb = (op, store, arg) => dash.evaluate(([op, store, arg]) => new Promise((res, rej) => {
  const r = indexedDB.open("orbita");
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const db = r.result;
    const tx = db.transaction(store, op === "all" ? "readonly" : "readwrite");
    const st = tx.objectStore(store);
    const q = op === "put" ? st.put(arg) : op === "del" ? st.delete(arg) : st.getAll();
    tx.oncomplete = () => { db.close(); res(q.result); };
    tx.onerror = () => rej(tx.error);
  };
}), [op, store, arg]);
const put = (store, value) => idb("put", store, value);
const del = (store, key) => idb("del", store, key);
const all = (store) => idb("all", store);
await put("lists", { id: "l1", name: "Clientes", count: 1, variableKeys: [], createdAt: 1, updatedAt: 1 });
await put("crmClients", { phone: "5511999990001", name: "Ana", stageId: "novo", updatedAt: 1 });
await dash.evaluate(() => chrome.storage.local.set({ "orbita:ai": { provider: "groq", keys: { groq: "gsk_segredo" }, apiKey: "gsk_segredo" }, "orbita:email:secrets": { apiKey: "re_segredo" }, "orbita:modules": { crm: true, email: true } }));

// ---- assistente
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push("opts: " + e.message));
p.on("dialog", (d) => d.accept());
await p.goto(`chrome-extension://${id}/options.html#cloudSec`);
await p.click("#cloEnable");
assert.equal(await p.textContent("#cloStepLabel"), "Passo 1 de 5");
assert.equal(await p.getAttribute("#cloSignupLink", "href"), "https://supabase.com/dashboard/sign-up");
await p.click("#cloHaveAccount");
await p.fill("#cloUrl", "abc");
await p.click("#cloNext2");
await p.waitForSelector("#cloStatus2.err");
await p.fill("#cloUrl", `${URL_}/`);
await p.fill("#cloKey", "sb_secret_perigosa");
await p.click("#cloNext2");
await p.waitForFunction(() => /SECRETA/.test(document.getElementById("cloStatus2").textContent));
await p.fill("#cloKey", "sb_publishable_errada");
await p.click("#cloNext2");
await p.waitForFunction(() => /recusou a chave/.test(document.getElementById("cloStatus2").textContent));
await p.fill("#cloKey", "sb_publishable_teste");
await p.click("#cloNext2");
await p.waitForSelector("[data-step='3']:not([hidden])");
// entrar sem usuário → erro; criar usuário → segue
await p.fill("#cloEmail", "eu@loja.com");
await p.fill("#cloPass", "senha123");
await p.click("#cloLogin");
await p.waitForFunction(() => /incorretos/.test(document.getElementById("cloStatus3").textContent));
await p.click("#cloSignup");
await p.waitForSelector("[data-step='4']:not([hidden])");
assert.equal(await p.getAttribute("#cloSqlLink", "href"), "https://supabase.com/dashboard/project/abcdefghijklmnop/sql/new");
await p.fill("#cloPat", "sbp_errado");
await p.click("#cloCreate");
await p.waitForFunction(() => /recusou o token/.test(document.getElementById("cloStatus4").textContent));
await p.locator("#cloudSec").screenshot({ path: shots + "/cloud-tabela.png" });
await p.fill("#cloPat", "sbp_certo");
await p.click("#cloCreate");
await p.waitForSelector("[data-step='5']:not([hidden])");
await p.waitForFunction(() => /nuvem está vazia/.test(document.getElementById("cloCounts").textContent));
assert.equal(await p.isVisible("#cloModes"), false);
assert.equal(await p.inputValue("#cloPat"), "");
const stored = await p.evaluate(() => chrome.storage.local.get(null));
assert.ok(!JSON.stringify(stored).includes("sbp_certo"), "o token pessoal não é guardado");
assert.ok(!JSON.stringify(stored).includes("senha123"), "a senha não é guardada");
await p.locator("#cloudSec").screenshot({ path: shots + "/cloud-passo5.png" });
await p.click("#cloStart");
await p.waitForSelector("#cloOn:not([hidden])");
await p.waitForFunction(() => /enviados/.test(document.getElementById("cloStatusOn").textContent));
console.log("primeira sincronização:", await p.textContent("#cloStatusOn"));
assert.deepEqual(remote("orbita/lists", "l1").data.name, "Clientes");
assert.equal(remote("orbita/crmClients", "5511999990001").data.name, "Ana");
assert.equal(remote("@storage", "orbita:modules").data.email, true);
assert.deepEqual(remote("@storage", "orbita:ai").data, { provider: "groq" }, "chaves de IA não sobem");
assert.ok(![...sb.rows.values()].some((x) => /segredo|orbita:cloud:|orbita:email:secrets/.test(JSON.stringify(x))), "nenhum segredo na nuvem");
// alarme criado no intervalo escolhido
assert.equal((await sw.evaluate(() => chrome.alarms.get("orbita-cloud")))?.periodInMinutes, 5);

// ---- outro computador mandou uma lista nova e mudou a Ana; aqui apagaram a l1
sb.rows.set("u1|orbita/lists|l2", { user_id: "u1", store: "orbita/lists", id: "l2", data: { id: "l2", name: "Leads do outro PC", count: 0, variableKeys: [], createdAt: 2, updatedAt: 2 }, deleted: false, device: "outro", updated_at: stamp() });
sb.rows.set("u1|orbita/crmClients|5511999990001", { ...remote("orbita/crmClients", "5511999990001"), data: { phone: "5511999990001", name: "Ana Paula", stageId: "novo", updatedAt: 3 }, device: "outro", updated_at: stamp() });
await del("lists", "l1");
await p.click("#cloSyncNow");
await p.waitForFunction(() => /Sincronizado/.test(document.getElementById("cloStatusOn").textContent));
console.log("sincronizar agora:", await p.textContent("#cloStatusOn"));
assert.deepEqual((await all("lists")).map((l) => l.name), ["Leads do outro PC"]);
assert.equal((await all("crmClients"))[0].name, "Ana Paula");
assert.equal(remote("orbita/lists", "l1").deleted, true, "a remoção sobe para a nuvem");
assert.match(await p.textContent("#cloLast"), /Última sincronização/);
// sem mudanças: nada vai nem vem
await p.click("#cloSyncNow");
await p.waitForFunction(() => /0 recebidos, 0 enviados/.test(document.getElementById("cloStatusOn").textContent));

// ---- refazer com "usar os da nuvem": o que só existe aqui some
await put("lists", { id: "l3", name: "Só aqui", count: 0, variableKeys: [], createdAt: 3, updatedAt: 3 });
await p.click("#cloOn summary");
await p.click("#cloRedo");
await p.waitForSelector("[data-step='5']:not([hidden])");
await p.waitForFunction(() => /já tem \d+ registros/.test(document.getElementById("cloCounts").textContent));
assert.equal(await p.isVisible("#cloModes"), true);
assert.equal(await p.isChecked("input[name=cloMode][value=merge]"), true);
await p.locator("#cloudSec").screenshot({ path: shots + "/cloud-mesclar.png" });
await p.check("input[name=cloMode][value=pull]");
await p.uncheck("#cloBackup");
await p.click("#cloStart");
await p.waitForSelector("#cloOn:not([hidden])");
assert.deepEqual((await all("lists")).map((l) => l.id), ["l2"]);
// e com "mesclar": o que só existe aqui sobe e nada é perdido
await put("lists", { id: "l4", name: "Nova aqui", count: 0, variableKeys: [], createdAt: 4, updatedAt: 4 });
await p.click("#cloRedo");
await p.waitForSelector("[data-step='5']:not([hidden])");
await p.waitForFunction(() => /já tem/.test(document.getElementById("cloCounts").textContent));
await p.uncheck("#cloBackup");
await p.click("#cloStart");
await p.waitForSelector("#cloOn:not([hidden])");
assert.deepEqual((await all("lists")).map((l) => l.id).sort(), ["l2", "l4"]);
assert.equal(remote("orbita/lists", "l4").deleted, false);
await p.locator("#cloudSec").screenshot({ path: shots + "/cloud-ligado.png" });

// ---- sessão perdida: pede para entrar de novo
await p.evaluate(() => chrome.storage.local.set({ "orbita:cloud:secrets": { accessToken: "x", refreshToken: "ref-invalido", expiresAt: 0 } }));
await p.click("#cloSyncNow");
await p.waitForSelector("[data-step='3']:not([hidden])");
await p.fill("#cloEmail", "eu@loja.com");
await p.fill("#cloPass", "senha123");
await p.click("#cloLogin");
await p.waitForSelector("[data-step='5']:not([hidden])"); // tabela já existe: pula o passo 4
await p.click("#cloCancel");
await p.waitForSelector("#cloOn:not([hidden])");

// ---- backup não leva a Cloud
const bk = await dash.evaluate(async () => Object.keys((await OrbitaBackup.create()).storage).filter((k) => k.startsWith("orbita:cloud:")));
assert.deepEqual(bk, []);

// ---- desligar e esquecer
await p.selectOption("#cloInterval2", "15");
await p.waitForFunction(() => /Intervalo salvo/.test(document.getElementById("cloStatusOn").textContent));
assert.equal((await sw.evaluate(() => chrome.alarms.get("orbita-cloud")))?.periodInMinutes, 15);
await p.click("#cloDisable");
await p.waitForSelector("#cloOff:not([hidden])");
assert.equal(await sw.evaluate(() => chrome.alarms.get("orbita-cloud")), undefined);
await p.click("#cloEnable");
assert.equal(await p.inputValue("#cloUrl"), URL_, "desligar mantém a conexão");
await p.click("#cloCancel");
await p.click("#cloEnable");
await p.click("#cloCancel");
assert.equal(await p.isVisible("#cloOff"), true);
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("CLOUD OK");
