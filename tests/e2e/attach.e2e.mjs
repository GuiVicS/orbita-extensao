// Teste: anexos nas Conversas — colar print, arrastar arquivos, clipe, legenda
// (com tradução) e arquivo grande em pedaços. Rodar: node tests/e2e/attach.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-attach";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
// tradução simulada
await sw.evaluate(() => {
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const msg = body.messages.at(-1).content.replace(/^<message>\n|\n<\/message>$/g, "");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lang: "pt", translation: `[EN] ${msg}` }) } }] }), { status: 200 });
  };
});
const errors = [];
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/conversas.html`);
await page.evaluate(() => chrome.storage.local.set({ "orbita:ai": { provider: "openai", keys: { openai: "sk" }, models: { openai: "gpt-5" } }, "orbita:chat:settings": { privacyAccepted: true } }));
const wa = await ctx.newPage();
await wa.goto("https://web.whatsapp.com/");
await page.bringToFront();
await page.reload();
await page.waitForSelector(".status.ready", { timeout: 15000 });
await page.click(".item >> text=John Smith");
await page.waitForSelector("#attachBtn:not([disabled])");
const files = () => wa.evaluate(() => window.__files || []);
const waitFiles = (n) => wa.waitForFunction((n) => (window.__files || []).length >= n, n, { timeout: 20000 });

// arquivos de teste criados na própria página (PNG real, PDF e um "zip" de 9 MB)
await page.evaluate(() => {
  const png = () => new Promise((res) => { const c = document.createElement("canvas"); c.width = 320; c.height = 200; const g = c.getContext("2d"); g.fillStyle = "#4f46e5"; g.fillRect(0, 0, 320, 200); g.fillStyle = "#fff"; g.font = "40px sans-serif"; g.fillText("print", 100, 110); c.toBlob(res, "image/png"); });
  window.__mk = { png };
  window.__big = () => { const b = new Uint8Array(9 * 1024 * 1024); for (let i = 0; i < b.length; i++) b[i] = (i * 31 + 7) & 255; return new File([b], "fotos.zip", { type: "application/zip" }); };
  window.__sum = async (f) => [...new Uint8Array(await f.arrayBuffer())].reduce((a, b) => (a + b) % 1000003, 0);
});

// 1) colar um print (Ctrl+V) no campo de texto
await page.focus("#text");
await page.evaluate(async () => {
  const blob = await __mk.png();
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "image.png", { type: "image/png" }));
  document.getElementById("text").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForSelector(".attach .astage img");
const head = await page.locator(".attach .ahead").innerText();
console.log("prévia do print:", head.replace(/\n/g, " | "));
assert.match(head, /^print-\d{4}-\d\d-\d\d-\d{6}\.png/);
assert.equal(await page.evaluate(() => document.activeElement.id), "attachCaption");
await page.fill("#attachCaption", "Segue o print");
await page.screenshot({ path: shots + "/anexo-print.png" });
await page.press("#attachCaption", "Enter");
await waitFiles(1);
let f = (await files())[0];
console.log("enviado:", f.type, f.name, f.mime, f.size, JSON.stringify(f.caption));
assert.deepEqual([f.type, f.mime, f.caption], ["image", "image/png", "Segue o print"]);
await page.waitForFunction(() => !document.querySelector(".attach"));
await page.waitForSelector('.b.me:has-text("Segue o print") .mthumb img', { timeout: 10000 });
await page.waitForTimeout(800); // o evento "nova mensagem" do WhatsApp chega depois, sem miniatura
assert.equal(await page.locator('.b.me:has-text("Segue o print") .mthumb img').count(), 1);
console.log("balão com miniatura: ok");

// 2) arrastar dois arquivos (PDF + 9 MB, vai em 3 pedaços) para a conversa
const dropped = await page.evaluate(async () => {
  const dt = new DataTransfer();
  dt.items.add(new File(["%PDF-1.4\n% teste\n"], "Proposta.pdf", { type: "application/pdf" }));
  const big = __big();
  dt.items.add(big);
  const msgs = document.getElementById("msgs");
  msgs.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true, cancelable: true }));
  const zoneShown = !document.getElementById("dropzone").hidden;
  msgs.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true, cancelable: true }));
  msgs.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  return { zoneShown, zoneAfter: !document.getElementById("dropzone").hidden, bigSum: await __sum(big) };
});
console.log("área de soltar:", dropped.zoneShown, "→", dropped.zoneAfter);
assert.deepEqual([dropped.zoneShown, dropped.zoneAfter], [true, false]);
await page.waitForSelector(".attach .athumb >> nth=1");
assert.match(await page.locator(".attach .ahead b").innerText(), /2 arquivos/);
await page.screenshot({ path: shots + "/anexo-arrastar.png" });
await page.click('.attach [data-at="send"]');
await waitFiles(3);
const [pdf, big] = (await files()).slice(1);
console.log("pdf:", pdf.type, pdf.name, pdf.magic, "| grande:", big.type, big.name, big.size, "íntegro:", big.sum === dropped.bigSum);
assert.deepEqual([pdf.type, pdf.name, pdf.magic], ["document", "Proposta.pdf", "%PDF"]);
assert.equal(big.size, 9 * 1024 * 1024);
assert.equal(big.sum, dropped.bigSum);
await page.waitForFunction(() => !document.querySelector(".attach"));
await page.waitForSelector('.b.me:has-text("Proposta.pdf")', { timeout: 10000 });
// o cache temporário ("up:") é apagado depois do envio
const leftovers = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("orbita-chat"); r.onsuccess = () => { const q = r.result.transaction("mediaCache").objectStore("mediaCache").getAllKeys(); q.onsuccess = () => res(q.result.filter((k) => String(k).startsWith("up:"))); }; }));
assert.deepEqual(leftovers, []);

// 3) clipe: escolher arquivo, remover, cancelar com Esc — nada é enviado
await page.setInputFiles("#fileIn", [{ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("um") }, { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("dois") }]);
await page.waitForSelector(".attach .athumb >> nth=1");
await page.hover(".attach .athumb >> nth=0");
await page.click('.attach [data-at="rm"][data-n="0"]');
assert.match(await page.locator(".attach .ahead b").innerText(), /b\.txt/);
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector(".attach"));
await page.waitForTimeout(500);
assert.equal((await files()).length, 3);

// 4) tradução ligada: a legenda passa pela prévia e sai traduzida
await page.click("#trBtn");
await page.check("#trEnabled");
await page.keyboard.press("Escape");
await page.setInputFiles("#fileIn", { name: "orcamento.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 orcamento") });
await page.waitForSelector("#attachCaption");
await page.fill("#attachCaption", "Segue o orçamento");
await page.press("#attachCaption", "Enter");
await page.waitForSelector('.attach .atr:has-text("[EN] Segue o orçamento")');
assert.equal((await files()).length, 3); // ainda não enviou
await page.screenshot({ path: shots + "/anexo-traducao.png" });
await page.press("#attachCaption", "Enter");
await waitFiles(4);
f = (await files())[3];
console.log("legenda traduzida:", JSON.stringify(f.caption));
assert.equal(f.caption, "[EN] Segue o orçamento");
// sem a prévia, o service worker recusa a legenda em português
const r = await page.evaluate(async () => {
  const k = "up:teste";
  await OrbitaChat.putMedia(k, new Blob(["x"], { type: "text/plain" }), { chatId: "5511999998888@c.us" });
  return chrome.runtime.sendMessage({ channel: "orbita:chat", op: "chat.sendFile", chatId: "5511999998888@c.us", uploadId: "teste", type: "document", filename: "x.txt", caption: "Oi em português", captionPt: "Oi em português" });
});
console.log("sem prévia:", r);
assert.equal(r.ok, false);

console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("ANEXOS OK");
