// Teste: apagar mensagem para mim / para todos. Rodar: node tests/e2e/delete.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-del";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/conversas.html`);
await page.waitForSelector(".status.ready", { timeout: 15000 });
await page.click(".item >> text=John Smith");
await page.waitForSelector(".b");
const J = "5511999998888@c.us";
const inStore = (id) => wa.evaluate(([c, i]) => __store[c].find((m) => m.id._serialized === i)?.type ?? "removida", [J, id]);
const menuFor = async (text) => {
  const b = page.locator(".b", { hasText: text }).last();
  await b.hover();
  await b.locator(".bmenu").click();
  await page.waitForSelector(".msgmenu");
};

// 1) enviar e apagar PARA TODOS
await page.fill("#text", "Mensagem errada");
await page.press("#text", "Enter");
await page.waitForFunction(() => [...document.querySelectorAll(".b.me")].some((b) => b.textContent.includes("Mensagem errada") && !b.classList.contains("pending")));
await page.waitForTimeout(600);
const sentId = await page.locator(".b.me", { hasText: "Mensagem errada" }).getAttribute("data-id");
await menuFor("Mensagem errada");
console.log("menu na minha:", await page.locator(".msgmenu button").allInnerTexts(), "| para todos habilitado:", !(await page.isDisabled('[data-del="all"]')));
await page.click('[data-del="all"]');
await page.waitForSelector(".modal .dialog");
console.log("confirmação:", (await page.locator(".modal .dialog").innerText()).replace(/\s+/g, " "));
await page.screenshot({ path: shots + "/apagar-confirmar.png" });
await page.click('.modal [data-a="yes"]');
await page.waitForSelector(`.b[data-id="${sentId}"]:has-text("Você apagou esta mensagem")`);
console.log("no WhatsApp:", await inStore(sentId), "| chamadas:", JSON.stringify(await wa.evaluate(() => window.__deletes)));
assert.equal(await inStore(sentId), "revoked");

// 2) mensagem do contato: só "apagar para mim"
await menuFor("Hi, I saw your ad");
assert.equal(await page.isDisabled('[data-del="all"]'), true);
console.log("dica na do contato:", await page.getAttribute('[data-del="all"]', "title"));
await page.click('[data-del="me"]');
await page.click('.modal [data-a="yes"]');
await page.waitForFunction(() => ![...document.querySelectorAll(".b")].some((b) => b.textContent.includes("Hi, I saw your ad")));
const incomingId = `false_${J}_1`;
console.log("apagada para mim → WhatsApp:", await inStore(incomingId));
assert.equal(await inStore(incomingId), "removida");
const inDb = await page.evaluate((i) => OrbitaChat.getMessage(i), incomingId);
assert.equal(inDb, undefined, "também sai do banco");

// 3) minha mensagem antiga: fora do prazo
await menuFor("Mensagem antiga minha");
console.log("antiga → para todos:", (await page.isDisabled('[data-del="all"]')) ? "desabilitado" : "habilitado", "|", await page.getAttribute('[data-del="all"]', "title"));
assert.equal(await page.isDisabled('[data-del="all"]'), true);
await page.keyboard.press("Escape");
await page.mouse.click(700, 300);

// 4) pedidos diretos inválidos são recusados pelo service worker
const call = (x) => page.evaluate((x) => chrome.runtime.sendMessage({ channel: "orbita:chat", op: "message.delete", chatId: "5511999998888@c.us", ...x }), x);
const r1 = await call({ messageId: `false_${J}_3`, forEveryone: true });
const r2 = await call({ messageId: `true_${J}_old`, forEveryone: true });
console.log("diretos:", r1.error, "|", r2.error);
assert.equal(r1.ok, false);
assert.equal(r2.ok, false);

// 5) apagar a última mensagem para mim atualiza a prévia da lista
await wa.evaluate(() => { const m = __mk("5511999998888@c.us", "last", false, "Última do contato", Date.now() / 1000 | 0, 0); __store["5511999998888@c.us"].push(m); __fire("chat.new_message", m); });
await page.waitForSelector('.item .prev:has-text("Última do contato")');
await menuFor("Última do contato");
await page.click('[data-del="me"]');
await page.click('.modal [data-a="yes"]');
await page.waitForFunction(() => !document.querySelector(".item .prev")?.textContent.includes("Última do contato"));
console.log("prévia da lista agora:", await page.locator(".item", { hasText: "John Smith" }).locator(".prev").innerText());
await page.screenshot({ path: shots + "/apagar.png" });
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("APAGAR OK");
