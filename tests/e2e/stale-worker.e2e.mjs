// Teste: service worker com código antigo (arquivos atualizados sem recarregar
// a extensão). A página avisa, recarrega a extensão e reabre a conversa.
// Rodar: node tests/e2e/stale-worker.e2e.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
const ext = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const here = new URL(".", import.meta.url).pathname;
const shots = process.env.SHOTS || here + ".shots";
fs.mkdirSync(shots, { recursive: true });
const profile = here + ".profile-stale";
fs.rmSync(profile, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1280, height: 800 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
await ctx.route("https://web.whatsapp.com/**", (r) => r.fulfill({ contentType: "text/html", body: fs.readFileSync(here + "fake-whatsapp.html", "utf8") }));
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = sw.url().split("/")[2];
const errors = [];
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`chrome-extension://${id}/conversas.html`);
await page.waitForSelector(".status");
assert.equal(await page.locator('[aria-labelledby="stTitle"]').count(), 0); // tudo em dia: sem aviso

// simula o service worker antigo: não conhece "chat.sendFile"
await sw.evaluate(() => (globalThis.OrbitaChat.OPS.SEND_FILE = "__removida__"));
const r = await page.evaluate(() => chrome.runtime.sendMessage({ channel: "orbita:chat", op: "chat.sendFile" }));
console.log("resposta do antigo:", r.error);
await page.reload();
await page.waitForSelector('[aria-labelledby="stTitle"]');
console.log("aviso:", (await page.locator(".dialog h2").innerText()));
await page.waitForTimeout(400); // fim da animação de entrada
await page.screenshot({ path: shots + "/sw-desatualizado.png" });
// "Recarregar agora": guarda a tela para reabrir e recarrega a extensão
// (no Chromium de teste o reload desliga extensões carregadas por linha de
// comando, então ele é simulado)
await page.evaluate(() => (chrome.runtime.reload = () => (window.__reloaded = true)));
await page.click('.dialog [data-a="yes"]');
await page.waitForFunction(() => window.__reloaded === true);
let flag = await page.evaluate(async () => (await chrome.storage.local.get("orbita:reopen"))["orbita:reopen"]);
console.log("para reabrir:", flag.urls.map((u) => u.replace(/^chrome-extension:\/\/[^/]+/, "")));
assert.deepEqual(flag.urls, [page.url()]);

// ao iniciar, o service worker reabre as telas guardadas
const reopened = ctx.waitForEvent("page", { predicate: (p) => p.url().includes("/conversas.html"), timeout: 10000 });
await sw.evaluate(() => globalThis.__orbitaSelfCheck.reopenTabs());
await reopened;
flag = await page.evaluate(async () => (await chrome.storage.local.get("orbita:reopen"))["orbita:reopen"]);
assert.equal(flag, undefined);

// conferência automática ao iniciar: detecta o código antigo, guarda as abas e recarrega (uma vez só)
const auto = await sw.evaluate(async () => {
  let reloads = 0;
  chrome.runtime.reload = () => reloads++;
  const S = globalThis.__orbitaSelfCheck;
  const stale = await S.isStale();
  const first = await S.selfCheck();
  const second = await S.selfCheck(); // logo em seguida: não entra em laço
  const saved = (await chrome.storage.local.get("orbita:reopen"))["orbita:reopen"];
  globalThis.OrbitaChat.OPS.SEND_FILE = "chat.sendFile";
  return { stale, first, second, reloads, tabs: saved.urls.length, fresh: !(await S.isStale()) };
});
console.log("conferência automática:", auto);
assert.deepEqual([auto.stale, auto.first, auto.second, auto.reloads, auto.fresh], [true, true, false, 1, true]);
assert.ok(auto.tabs >= 2);
console.log("ERRORS", errors);
assert.equal(errors.length, 0);
await ctx.close();
console.log("SW DESATUALIZADO OK");
