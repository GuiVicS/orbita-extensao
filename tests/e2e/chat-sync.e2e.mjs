// Teste de aceite da Fase 1 (sincronização). Requer: npm i -D playwright && npx playwright install chromium
// Rodar: node tests/e2e/chat-sync.e2e.mjs
// Aceite da Fase 1: sincronização de mensagens.
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const profile = here + ".profile-chat";
fs.rmSync(profile, { recursive: true, force: true });
const errors = [];
async function launch(extra = false) {
  const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
  await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
  if (extra) await ctx.addInitScript(() => (window.__extra = true));
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const id = sw.url().split("/")[2];
  const dash = await ctx.newPage();
  dash.on("pageerror", (e) => errors.push("dash: " + e.message));
  await dash.goto(`chrome-extension://${id}/dashboard.html`);
  await dash.waitForTimeout(1500);
  return { ctx, dash, id };
}
const call = (page, op, extra = {}) => page.evaluate(async ([op, extra]) => {
  const r = await chrome.runtime.sendMessage({ channel: "orbita:chat", op, ...extra });
  if (!r?.ok) throw new Error(r?.error);
  return r.data;
}, [op, extra]);
let last = ""; const waitFor = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { last = e.message; } if (Date.now() > end) throw new Error("timeout: " + last); await new Promise((r) => setTimeout(r, 200)); } };

// ---------- 1ª sessão
let { ctx, dash } = await launch();
// cliente do CRM: contato numa lista, SEM o 9º dígito, para testar a variante
await dash.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open("orbita"); r.onsuccess = () => { const tx = r.result.transaction("listContacts", "readwrite"); tx.objectStore("listContacts").put({ id: "c1", listId: "l1", phone: "551199998888", name: "John (CRM)", vars: {} }); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }; }));
console.log("status antes do WhatsApp:", await call(dash, "wa.status"));
const wa = await ctx.newPage();
wa.on("pageerror", (e) => errors.push("wa: " + e.message));
await wa.goto("https://web.whatsapp.com/");
await waitFor(async () => (await call(dash, "wa.status")).ready);
let chats = await waitFor(async () => { const c = await call(dash, "chat.list"); return c.length === 3 && c; });
console.log("chats:", chats.map((c) => `${c.chatId} name=${c.name} phone=${c.phone ?? "-"} unread=${c.unreadCount} client=${c.client?.name ?? "-"} preview="${c.lastPreview}"`));
assert.equal(chats[0].chatId, "5511999998888@c.us");
assert.equal(chats[0].client?.name, "John (CRM)", "vínculo com CRM pela variante do 9º dígito");
assert.equal(chats.find((c) => c.chatId === "123456789@lid").client, null, "@lid sem número não liga ao CRM");

let open = await call(dash, "chat.open", { chatId: "5511999998888@c.us" });
console.log("open:", open.messages.map((m) => `${m.fromMe ? "→" : "←"} ${m.text} (ack ${m.ack})`), "warning:", open.warning);
assert.equal(open.messages.length, 11, "3 textos + 1 antiga minha + 2 mensagens de voz + 5 mídias (foto, vídeo, PDF, .docx, .zip)");

// evento: mensagem nova recebida
await wa.evaluate(() => { const m = __mk("5511999998888@c.us", 10, false, "Are you there?", Date.now() / 1000 | 0, 0); __store["5511999998888@c.us"].push(m); __fire("chat.new_message", m); });
await waitFor(async () => (await call(dash, "chat.open", { chatId: "5511999998888@c.us" })).messages.some((m) => m.text === "Are you there?"));
// ack e revogação
await wa.evaluate(() => __fire("chat.msg_ack_change", { ack: 3, chat: {}, ids: [{ _serialized: "true_5511999998888@c.us_2" }] }));
await wa.evaluate(() => __fire("chat.msg_revoke", { refId: { _serialized: "false_5511999998888@c.us_1" } }));
// envio
const sent = await call(dash, "chat.sendText", { chatId: "5511999998888@c.us", text: "Sure! It's R$ 99." });
await new Promise((r) => setTimeout(r, 1200)); // o evento do enviado chega depois
open = await call(dash, "chat.open", { chatId: "5511999998888@c.us" });
console.log("depois:", open.messages.map((m) => `${m.fromMe ? "→" : "←"} ${m.revoked ? "[apagada] " : ""}${m.text} (ack ${m.ack})`));
assert.equal(open.messages.filter((m) => m.id === sent.id).length, 1, "enviada não duplica com o evento");
assert.equal(open.messages.find((m) => m.id.endsWith("_2")).ack, 3);
assert.ok(open.messages.find((m) => m.id.endsWith("_1")).revoked);
const before = open.messages.length;
await ctx.close();

// ---------- 2ª sessão (navegador reaberto; uma mensagem chegou enquanto estava fechado)
({ ctx, dash } = await launch(true));
const wa2 = await ctx.newPage();
await wa2.goto("https://web.whatsapp.com/");
await waitFor(async () => (await call(dash, "wa.status")).ready);
await waitFor(async () => (await call(dash, "chat.list")).find((c) => c.lastPreview === "Missed while offline"), 15000);
open = await call(dash, "chat.open", { chatId: "5511999998888@c.us" });
const ids = open.messages.map((m) => m.id);
console.log("após reabrir:", open.messages.length, "mensagens (antes:", before, ")");
assert.equal(new Set(ids).size, ids.length, "sem duplicatas");
assert.ok(open.messages.some((m) => m.text === "Missed while offline"), "lacuna preenchida");
// troca de conta: outra conta do WhatsApp só mostra as conversas dela
await wa2.evaluate(() => { window.WPP.conn.getMyUserId = () => ({ _serialized: "5521888887777@c.us" }); });
await waitFor(async () => (await call(dash, "chat.list")).length === 0, 8000).catch(() => {});
const other = await call(dash, "chat.list");
console.log("conversas na outra conta (antes de sincronizar):", other.length);
assert.equal(other.length, 0);
await wa2.evaluate(() => { window.WPP.conn.getMyUserId = () => ({ _serialized: "5511000000000@c.us" }); });
await waitFor(async () => (await call(dash, "chat.list")).length === 3, 8000);
// aba do WhatsApp fechada → status e aviso
await wa2.close();
await waitFor(async () => !(await call(dash, "wa.status")).connected);
const offline = await call(dash, "chat.open", { chatId: "5511999998888@c.us" });
console.log("offline:", offline.warning, "|", offline.messages.length, "mensagens do banco");
// backup inclui conversas
const bk = await dash.evaluate(async () => { const b = await OrbitaBackup.create(); return { chats: b.chatDb?.chats?.length, messages: b.chatDb?.messages?.length }; });
console.log("backup:", bk);
assert.ok(bk.chats === 3 && bk.messages >= 5);
console.log("ERRORS", errors);
await ctx.close();
console.log("FASE 1 OK");
