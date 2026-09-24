// Teste: ver fotos, vídeos, PDFs e baixar documentos nas Conversas.
// Rodar: node tests/e2e/media.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-media";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1440, height: 900 }, acceptDownloads: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
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
await page.waitForSelector(".mthumb.image img");
await page.waitForTimeout(800);
const dl0 = await wa.evaluate(() => (window.__dlIds || []).filter((i) => !/_v\d$/.test(i)).length); // áudios (v1, v2) têm transcrição automática
console.log("balões:", await page.locator(".mthumb").count(), "miniaturas |", await page.locator(".doccard").count(), "documentos | downloads antes do clique:", dl0);
assert.equal(dl0, 0, "nada é baixado só por abrir a conversa");
console.log("PDF no balão:", (await page.locator(".doccard", { hasText: "Proposta" }).innerText()).replace(/\s+/g, " "));
await page.screenshot({ path: shots + "/midias-conversa.png" });

// foto → visualizador com a imagem grande
await page.click(".mthumb.image");
await page.waitForSelector(".viewer .vstage img");
const img = await page.evaluate(() => { const i = document.querySelector(".viewer .vstage img"); return new Promise((r) => (i.complete ? r([i.naturalWidth, i.naturalHeight]) : (i.onload = () => r([i.naturalWidth, i.naturalHeight])))); });
console.log("foto aberta:", img, "|", await page.locator(".viewer .vcount").innerText(), "| legenda:", await page.locator(".viewer .vcap").innerText());
assert.deepEqual(img, [1200, 800]);
await page.screenshot({ path: shots + "/midias-visualizador.png" });
// seta → vídeo; seta → PDF
await page.keyboard.press("ArrowRight");
await page.waitForSelector(".viewer .vstage video");
console.log("vídeo:", await page.locator(".viewer .vtitle b").innerText());
await page.keyboard.press("ArrowRight");
await page.waitForSelector(".viewer .vstage iframe");
console.log("PDF no visualizador:", (await page.getAttribute(".viewer .vstage iframe", "src")).slice(0, 18), "| botão nova aba:", await page.locator('.viewer [data-v="tab"]').count());
await page.keyboard.press("Escape");
await page.waitForSelector(".viewer", { state: "detached" });

// .docx → baixar com o nome original
const [d1] = await Promise.all([page.waitForEvent("download"), page.click('.doccard:has-text("Contrato.docx") ~ .dact [data-dl]')]);
console.log("download:", d1.suggestedFilename());
assert.equal(d1.suggestedFilename(), "Contrato.docx");

// arquivo de 9 MB: vem em pedaços e chega inteiro
const [d2] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click('.doccard:has-text("Fotos.zip") ~ .dact [data-dl]')]);
const size = fs.statSync(await d2.path()).size;
console.log("Fotos.zip:", size, "bytes");
assert.equal(size, 9 * 1024 * 1024);
// baixar de novo usa o cache (não pede à aba outra vez)
const before = await wa.evaluate(() => window.__downloads);
await page.click(".mthumb.image");
await page.waitForSelector(".viewer .vstage img");
assert.equal(await wa.evaluate(() => window.__downloads), before, "segunda vez vem do cache");
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("MÍDIAS OK");
