// Teste: responder (citar) mensagens e mencionar (@) participantes em grupos.
// Rodar: node tests/e2e/reply-mention.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-reply";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
const wa = await ctx.newPage();
await wa.addInitScript(() => ((window.__replies = true), (window.__groups = true)));
await wa.goto("https://web.whatsapp.com/");
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/conversas.html`);
await page.waitForSelector(".status.ready", { timeout: 15000 });
const J = "5511999998888@c.us";
const G = "120363000000000001@g.us";
const opts = () => wa.evaluate(() => window.__sendOpts || []);

// ---- mensagem recebida que responde a outra: citação no balão; clique leva à original
await page.click(".item >> text=John Smith");
const reply = page.locator('.b:has-text("Sim, pode mandar o preço")');
await reply.locator(".quote").waitFor();
console.log("citação recebida:", (await reply.locator(".quote").innerText()).replace(/\n/g, " | "));
assert.match(await reply.locator(".quote").innerText(), /Você[\s\S]*Olá!/);
await reply.locator(".quote").click();
await page.waitForSelector('.b.flash:has-text("Olá!")');

// ---- responder pelo menu do balão
const target = page.locator('.b[data-id="false_5511999998888@c.us_3"]');
await target.hover();
await target.locator(".bmenu").click();
await page.click('.msgmenu [data-reply]');
await page.waitForSelector("#replybar:not([hidden])");
console.log("faixa:", (await page.locator("#replybar").innerText()).replace(/\n/g, " | "));
assert.match(await page.locator("#replybar").innerText(), /Respondendo a John Smith[\s\S]*Can you send the price\?/);
await page.screenshot({ path: shots + "/responder.png" });
// Esc cancela
await page.keyboard.press("Escape");
assert.equal(await page.isHidden("#replybar"), true);
await target.hover();
await target.locator(".bmenu").click();
await page.click('.msgmenu [data-reply]');
await page.fill("#text", "Custa R$ 150.");
await page.press("#text", "Enter");
await wa.waitForFunction((j) => __store[j].some((m) => m.body === "Custa R$ 150." && m.quotedStanzaID), J);
const sent = (await opts()).at(-1);
console.log("enviado com:", sent);
assert.equal(sent.quotedMsg, `false_${J}_3`);
assert.equal(await page.isHidden("#replybar"), true);
await page.waitForSelector('.b.me:has-text("Custa R$ 150.") .quote');
assert.match(await page.locator('.b.me:has-text("Custa R$ 150.") .quote').innerText(), /John Smith[\s\S]*Can you send the price/);

// ---- figurinha/anexo também podem responder: anexo com a faixa aberta
await target.hover();
await target.locator(".bmenu").click();
await page.click('.msgmenu [data-reply]');
await page.setInputFiles("#fileIn", { name: "tabela.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 tabela") });
await page.waitForSelector("#attachCaption");
await page.press("#attachCaption", "Enter");
await wa.waitForFunction((j) => __store[j].some((m) => m.filename === "tabela.pdf" && m.quotedStanzaID), J);
assert.equal((await opts()).at(-1).quotedMsg, `false_${J}_3`);

// ---- grupo: @ mostra participantes; menção sai marcada; recebidas mostram o nome
await page.click(".item >> text=Clientes VIP");
await page.waitForSelector('.b:has-text("pode enviar para mim?") .mention');
const shown = await page.locator('.b:has-text("pode enviar para mim?") .mention').innerText();
console.log("menção recebida:", shown);
assert.equal(shown, "@John Smith");
await page.focus("#text");
await page.keyboard.type("Oi @ma");
await page.waitForSelector("#emsug .msug");
console.log("sugestões @:", await page.locator("#emsug .msug").allInnerTexts());
assert.match(await page.locator("#emsug .msug").first().innerText(), /Maria Souza/);
await page.screenshot({ path: shots + "/mencionar.png" });
await page.keyboard.press("Enter");
assert.equal(await page.inputValue("#text"), "Oi @5511977776666 ");
await page.keyboard.type("tudo certo?");
await page.keyboard.press("Enter");
await wa.waitForFunction((g) => __store[g].some((m) => m.body === "Oi @5511977776666 tudo certo?"), G);
const g = (await opts()).at(-1);
console.log("menção enviada:", g);
assert.deepEqual(g.mentionedList, ["5511977776666@c.us"]);
await page.waitForSelector('.b.me:has-text("tudo certo?") .mention');
assert.equal(await page.locator('.b.me:has-text("tudo certo?") .mention').innerText(), "@Maria Souza");
// sem "@" no texto final, a menção não vai
await page.keyboard.type("@ped");
await page.waitForSelector("#emsug .msug");
await page.keyboard.press("Enter");
await page.fill("#text", "mudei de ideia");
await page.keyboard.press("Enter");
await wa.waitForFunction((g) => __store[g].some((m) => m.body === "mudei de ideia"), G);
assert.equal((await opts()).at(-1).mentionedList, undefined);
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("RESPONDER E MENCIONAR OK");
