// Conversas — biblioteca de figurinhas (store "stickers" do banco orbita-chat).
//
// Entram sozinhas as figurinhas que aparecem nas conversas (recebidas ou
// enviadas) e as criadas a partir de uma imagem. Sem repetição: o id é o hash
// do arquivo. Favoritas nunca são apagadas; das outras ficam as 300 mais recentes.
//   { id, blob, mime, size, animated, source: "received"|"created", fav, addedAt, usedAt }
// Expõe globalThis.OrbitaStickers. Roda em páginas da extensão.
(() => {
  "use strict";
  if (globalThis.OrbitaStickers) return;
  const C = globalThis.OrbitaChat;
  const STORE = "stickers";
  const MAX_RECENT = 300;
  const MAX_BYTES = 1024 * 1024; // figurinha do WhatsApp: até ~500 KB (animadas); acima disso não é figurinha
  const SIZE = 512;

  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  const done = (tx) => new Promise((res, rej) => ((tx.oncomplete = res), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error))));

  let channel = null;
  const listeners = new Set();
  function notify() {
    for (const fn of listeners) fn();
    try {
      (channel ||= new BroadcastChannel("orbita-stickers")).postMessage("changed");
    } catch {}
  }
  function onChange(fn) {
    listeners.add(fn);
    try {
      channel ||= new BroadcastChannel("orbita-stickers");
      channel.onmessage = () => listeners.forEach((f) => f());
    } catch {}
    return () => listeners.delete(fn);
  }

  async function hashOf(blob) {
    const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // WEBP animado tem o bloco "ANIM" logo no começo do arquivo
  async function isAnimated(blob) {
    if (!/webp/i.test(blob.type)) return /gif/i.test(blob.type);
    const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
    for (let i = 12; i < head.length - 4; i++) if (head[i] === 0x41 && head[i + 1] === 0x4e && head[i + 2] === 0x49 && head[i + 3] === 0x4d) return true;
    return false;
  }

  async function store(mode = "readonly") {
    const db = await C.openDb();
    const tx = db.transaction(STORE, mode);
    return { tx, st: tx.objectStore(STORE) };
  }

  // Todas: favoritas primeiro, depois as usadas/recebidas mais recentemente.
  async function list() {
    const { st } = await store();
    const all = await req(st.getAll());
    const last = (s) => Math.max(s.usedAt || 0, s.addedAt || 0);
    return all.sort((a, b) => Number(b.fav) - Number(a.fav) || last(b) - last(a));
  }

  async function add(blob, { source = "received", fav = false } = {}) {
    if (!blob?.size || blob.size > MAX_BYTES) return null;
    const id = await hashOf(blob);
    const animated = await isAnimated(blob);
    const { tx, st } = await store("readwrite");
    let rec = await req(st.get(id));
    const isNew = !rec;
    if (isNew) {
      rec = { id, blob, mime: blob.type || "image/webp", size: blob.size, animated, source, fav, addedAt: Date.now(), usedAt: 0 };
      st.put(rec);
    }
    await done(tx);
    if (isNew) {
      await prune();
      notify();
    }
    return rec;
  }

  async function prune() {
    const all = (await list()).filter((s) => !s.fav);
    if (all.length <= MAX_RECENT) return;
    const { tx, st } = await store("readwrite");
    for (const s of all.slice(MAX_RECENT)) st.delete(s.id);
    await done(tx);
  }

  async function patch(id, fn) {
    const { tx, st } = await store("readwrite");
    const rec = await req(st.get(id));
    if (rec) st.put({ ...rec, ...fn(rec) });
    await done(tx);
    notify();
    return rec;
  }
  const setFav = (id, fav) => patch(id, () => ({ fav: Boolean(fav) }));
  const touch = (id) => patch(id, () => ({ usedAt: Date.now() }));
  async function remove(id) {
    const { tx, st } = await store("readwrite");
    st.delete(id);
    await done(tx);
    notify();
  }

  // Imagem qualquer → figurinha: 512×512 com fundo transparente, a imagem
  // inteira centralizada (sem cortar), WEBP de até ~100 KB como o WhatsApp pede.
  async function fromImage(file) {
    if (!/^image\//.test(file?.type || "")) throw new Error("Escolha uma imagem (PNG, JPG, WEBP ou GIF).");
    let bmp;
    try {
      bmp = await createImageBitmap(file);
    } catch {
      throw new Error("Não foi possível ler esta imagem.");
    }
    const cv = document.createElement("canvas");
    cv.width = cv.height = SIZE;
    const k = Math.min(SIZE / bmp.width, SIZE / bmp.height);
    const w = Math.round(bmp.width * k);
    const h = Math.round(bmp.height * k);
    const g = cv.getContext("2d");
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    bmp.close?.();
    let out = null;
    for (const q of [0.92, 0.8, 0.65, 0.5, 0.35]) {
      out = await new Promise((res) => cv.toBlob(res, "image/webp", q));
      if (!out || !/webp/.test(out.type)) throw new Error("Este navegador não gera figurinhas (WEBP).");
      if (out.size <= 100 * 1024) break;
    }
    return add(out, { source: "created" });
  }

  globalThis.OrbitaStickers = { list, add, setFav, touch, remove, fromImage, isAnimated, onChange, SIZE };
})();
