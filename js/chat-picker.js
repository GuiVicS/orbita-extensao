// Conversas — painel de emojis e figurinhas (como o do WhatsApp Web).
//
// Emojis: busca em português (nome e palavras-chave), categorias com rolagem e
// destaque da atual, recentes, tom de pele, prévia do emoji sob o cursor. Só
// aparecem os emojis que este computador sabe desenhar.
// Figurinhas: biblioteca local (js/chat-stickers.js) — recentes e favoritas,
// criar a partir de uma imagem, favoritar e remover.
//
// Expõe globalThis.OrbitaPicker.create(box, { icon, onEmoji, onSticker, onClose, toast })
// e OrbitaPicker.search(texto, limite) (usado pelas sugestões ao digitar ":").
(() => {
  "use strict";
  if (globalThis.OrbitaPicker) return;
  const DATA = globalThis.OrbitaEmojiData;
  const ST = globalThis.OrbitaStickers;
  const RECENT_KEY = "orbita:emoji:recent";
  const TONE_KEY = "orbita:emoji:tone";
  const TAB_KEY = "orbita-picker-tab";
  const MAX_RECENT = 32;
  const TONE_SAMPLES = ["👋", "👋🏻", "👋🏼", "👋🏽", "👋🏾", "👋🏿"];
  const TONE_NAMES = ["Padrão", "Pele clara", "Pele morena clara", "Pele morena", "Pele morena escura", "Pele escura"];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // ------------------------------------------------ que emojis este PC desenha
  // Testa um emoji de cada versão do Unicode (do mais novo ao mais antigo): o
  // primeiro que sai colorido e numa peça só define até onde mostrar.
  const PROBES = [[16, "🫩"], [15.1, "🙂‍↔️"], [15, "🫨"], [14, "🫠"], [13.1, "😮‍💨"], [13, "🥲"], [12.1, "🧑‍🦰"], [12, "🥱"], [11, "🥰"]];
  function supportedVersion() {
    const key = `orbita-emoji-max:${navigator.userAgent}`;
    try {
      const hit = localStorage.getItem(key);
      if (hit) return Number(hit);
    } catch {}
    let max = Infinity;
    try {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 40;
      const g = cv.getContext("2d", { willReadFrequently: true });
      g.font = '28px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      g.textBaseline = "top";
      const colored = (e) => {
        g.clearRect(0, 0, 40, 40);
        g.fillText(e, 0, 0);
        const d = g.getImageData(0, 0, 40, 40).data;
        for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 50 && (Math.abs(d[i] - d[i + 1]) > 20 || Math.abs(d[i + 1] - d[i + 2]) > 20)) return true;
        return false;
      };
      const base = g.measureText("😀").width;
      // sem fonte de emoji colorida (ex.: testes) não dá para saber: mostra tudo
      if (colored("😀")) {
        max = 5;
        for (const [v, e] of PROBES)
          if (g.measureText(e).width < base * 1.5 && colored(e)) {
            max = v;
            break;
          }
      }
    } catch {}
    try {
      if (Number.isFinite(max)) localStorage.setItem(key, String(max));
    } catch {}
    return max;
  }

  // ------------------------------------------------------------- índice
  let INDEX = null; // [{ e, label, key, group, tones, n }]
  function index() {
    if (INDEX) return INDEX;
    const max = supportedVersion();
    INDEX = [];
    let n = 0;
    for (const g of DATA.groups)
      for (const [e, label, tags, ver, tones] of g.emojis) {
        // bandeiras: a fonte "Twemoji Country Flags" (css) desenha todas
        if (ver > max && g.key !== "flags") continue;
        INDEX.push({ e, label, key: ` ${norm(`${label} ${tags}`)}`, group: g.key, tones, n: n++ });
      }
    return INDEX;
  }
  const byEmoji = () => (index().byE ||= new Map(index().map((x) => [x.e, x])));

  // Busca: todas as palavras precisam aparecer (no começo de alguma palavra);
  // nome que começa com o que foi digitado vem primeiro.
  function search(q, limit = 200) {
    const words = norm(q).split(/[\s:_-]+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const x of index()) if (words.every((w) => x.key.includes(` ${w}`))) out.push(x);
    const first = norm(words[0]);
    const rank = (x) => (norm(x.label).startsWith(first) ? 0 : norm(x.label).includes(` ${first}`) ? 1 : 2);
    return out.sort((a, b) => rank(a) - rank(b) || a.n - b.n).slice(0, limit);
  }

  // ------------------------------------------------------------ estado salvo
  async function getStored(k, fallback) {
    try {
      return (await chrome.storage.local.get(k))[k] ?? fallback;
    } catch {
      return fallback;
    }
  }
  const setStored = (k, v) => chrome.storage.local.set({ [k]: v }).catch(() => {});

  function create(box, opts) {
    const icon = opts.icon;
    const P = { tab: "emoji", tone: 0, recent: [], built: false, stickers: [], stkFilter: "all", urls: new Map(), sending: null, open: false };
    try {
      P.tab = localStorage.getItem(TAB_KEY) === "sticker" ? "sticker" : "emoji";
    } catch {}

    const withTone = (x) => (P.tone && x.tones ? x.tones[P.tone - 1] : x.e);
    const cell = (x) => `<button type="button" class="pk-e" data-e="${esc(x.e)}" aria-label="${esc(x.label)}">${withTone(x)}</button>`;

    function shell() {
      box.innerHTML = `<div class="pk" role="dialog" aria-label="Emojis e figurinhas">
        <div class="pk-top"><div class="pk-tabs" role="tablist">
          <button type="button" role="tab" data-tab="emoji" aria-selected="false">${icon("smile", 16)} Emojis</button>
          <button type="button" role="tab" data-tab="sticker" aria-selected="false">${icon("sticker", 16)} Figurinhas</button></div>
          <button type="button" class="ibtn pk-x" aria-label="Fechar (Esc)" title="Fechar (Esc)">${icon("x", 16)}</button></div>
        <div class="pk-body" data-body="emoji" hidden>
          <div class="pk-bar"><label class="pk-search">${icon("search", 15)}<input type="search" placeholder="Pesquisar emoji" aria-label="Pesquisar emoji" autocomplete="off" spellcheck="false"></label>
            <div class="pk-tonewrap"><button type="button" class="pk-tone" aria-haspopup="true" aria-expanded="false" title="Tom de pele"></button><div class="pk-tones" hidden role="menu"></div></div></div>
          <nav class="pk-cats" aria-label="Categorias"></nav>
          <div class="pk-grid" tabindex="-1"></div>
          <div class="pk-foot" aria-hidden="true"><span class="pk-big"></span><span class="pk-name"></span></div>
        </div>
        <div class="pk-body" data-body="sticker" hidden>
          <div class="pk-bar"><div class="pk-seg" role="group" aria-label="Mostrar"><button type="button" data-f="all" aria-pressed="true">Recentes</button><button type="button" data-f="fav" aria-pressed="false">${icon("star", 13)} Favoritas</button></div>
            <button type="button" class="btn pk-create">${icon("plus", 15)} Criar figurinha</button><input type="file" accept="image/*" class="pk-file" hidden></div>
          <div class="pk-sgrid"></div>
        </div></div>`;
      bind();
    }

    // ---------------------------------------------------------- emojis
    function buildEmoji() {
      const all = index();
      const cats = [{ key: "recent", label: "Recentes", icon: icon("clock", 17) }, ...DATA.groups.map((g) => ({ key: g.key, label: g.label, icon: `<span class="pk-ce">${g.icon}</span>` }))];
      box.querySelector(".pk-cats").innerHTML = cats.map((c) => `<button type="button" data-cat="${c.key}" title="${esc(c.label)}" aria-label="${esc(c.label)}">${c.icon}</button>`).join("");
      const recent = P.recent.map((e) => byEmoji().get(e)).filter(Boolean);
      box.querySelector(".pk-grid").innerHTML =
        `<section data-sec="recent" ${recent.length ? "" : "hidden"}><h4>Recentes</h4><div class="pk-cells">${recent.map(cell).join("")}</div></section>` +
        DATA.groups
          .map((g) => {
            const list = all.filter((x) => x.group === g.key);
            return list.length ? `<section data-sec="${g.key}"><h4>${esc(g.label)}</h4><div class="pk-cells">${list.map(cell).join("")}</div></section>` : "";
          })
          .join("") +
        `<section data-sec="results" hidden><h4>Resultados</h4><div class="pk-cells"></div><p class="pk-empty" hidden>Nenhum emoji encontrado.</p></section>`;
      P.built = true;
      paintTone();
      spy();
    }

    function paintTone() {
      box.querySelector(".pk-tone").textContent = TONE_SAMPLES[P.tone];
      box.querySelector(".pk-tone").setAttribute("aria-label", `Tom de pele: ${TONE_NAMES[P.tone]}`);
      box.querySelector(".pk-tones").innerHTML = TONE_SAMPLES.map((t, i) => `<button type="button" role="menuitemradio" aria-checked="${i === P.tone}" data-tone="${i}" title="${TONE_NAMES[i]}">${t}</button>`).join("");
    }

    function setTone(t) {
      P.tone = t;
      setStored(TONE_KEY, t);
      paintTone();
      for (const b of box.querySelectorAll(".pk-grid .pk-e")) {
        const x = byEmoji().get(b.dataset.e);
        if (x?.tones) b.textContent = withTone(x);
      }
    }

    function renderRecent() {
      const sec = box.querySelector('[data-sec="recent"]');
      if (!sec) return;
      const recent = P.recent.map((e) => byEmoji().get(e)).filter(Boolean);
      sec.hidden = !recent.length || Boolean(box.querySelector(".pk-search input").value.trim());
      sec.querySelector(".pk-cells").innerHTML = recent.map(cell).join("");
    }

    function doSearch(q) {
      const grid = box.querySelector(".pk-grid");
      const res = grid.querySelector('[data-sec="results"]');
      const searching = Boolean(q.trim());
      for (const s of grid.querySelectorAll("section")) s.hidden = searching ? s !== res : s === res || (s.dataset.sec === "recent" && !P.recent.length);
      box.querySelector(".pk-cats").classList.toggle("off", searching);
      if (searching) {
        const found = search(q);
        res.querySelector(".pk-cells").innerHTML = found.map(cell).join("");
        res.querySelector(".pk-empty").hidden = found.length > 0;
      }
      grid.scrollTop = 0;
      spy();
    }

    // categoria atual (a última cujo título já passou do topo)
    function spy() {
      const grid = box.querySelector(".pk-grid");
      let cur = null;
      for (const s of grid.querySelectorAll("section:not([hidden])")) if (s.offsetTop - grid.offsetTop <= grid.scrollTop + 8) cur = s.dataset.sec;
      cur ||= grid.querySelector("section:not([hidden])")?.dataset.sec;
      for (const b of box.querySelectorAll(".pk-cats button")) b.classList.toggle("on", b.dataset.cat === cur);
    }

    function pick(e, keepOpen = true) {
      const base = [...byEmoji().values()].find((x) => x.e === e || x.tones?.includes(e))?.e || e;
      const x = byEmoji().get(base);
      const out = x ? withTone(x) : e;
      P.recent = [base, ...P.recent.filter((r) => r !== base)].slice(0, MAX_RECENT);
      setStored(RECENT_KEY, P.recent);
      opts.onEmoji(out);
      if (!keepOpen) close();
    }

    function hover(e) {
      const x = e && byEmoji().get(e);
      box.querySelector(".pk-big").textContent = x ? withTone(x) : "";
      box.querySelector(".pk-name").textContent = x ? x.label : "";
      box.querySelector(".pk-foot").classList.toggle("on", Boolean(x));
    }

    // ------------------------------------------------------- figurinhas
    async function loadStickers() {
      try {
        P.stickers = await ST.list();
      } catch {
        P.stickers = [];
      }
      renderStickers();
    }

    function renderStickers() {
      const grid = box.querySelector(".pk-sgrid");
      if (!grid) return;
      const list = P.stkFilter === "fav" ? P.stickers.filter((s) => s.fav) : P.stickers;
      const keep = new Set(list.map((s) => s.id));
      for (const [id, u] of P.urls) if (!keep.has(id)) (URL.revokeObjectURL(u), P.urls.delete(id));
      for (const b of box.querySelectorAll(".pk-seg button")) b.setAttribute("aria-pressed", String(b.dataset.f === P.stkFilter));
      if (!list.length) {
        grid.innerHTML = `<div class="pk-none">${icon("sticker", 34)}<b>${P.stkFilter === "fav" ? "Nenhuma favorita ainda" : "Sua coleção de figurinhas"}</b>
          <span>${P.stkFilter === "fav" ? "Passe o mouse numa figurinha e clique na estrela para guardar aqui." : "As figurinhas que chegarem nas suas conversas aparecem aqui sozinhas. Você também pode criar uma a partir de qualquer imagem."}</span>
          ${P.stkFilter === "fav" ? "" : `<button type="button" class="btn primary pk-create2">${icon("plus", 15)} Criar figurinha</button>`}</div>`;
        return;
      }
      grid.innerHTML = list
        .map((s) => {
          if (!P.urls.has(s.id)) P.urls.set(s.id, URL.createObjectURL(s.blob));
          return `<div class="pk-st ${P.sending === s.id ? "sending" : ""}"><button type="button" class="pk-sb" data-stk="${s.id}" aria-label="Enviar figurinha${s.animated ? " animada" : ""}" title="Enviar"><img src="${P.urls.get(s.id)}" alt="" loading="lazy" draggable="false"></button>
            <button type="button" class="pk-fav ${s.fav ? "on" : ""}" data-fav="${s.id}" aria-pressed="${s.fav}" aria-label="${s.fav ? "Tirar das favoritas" : "Favoritar"}" title="${s.fav ? "Tirar das favoritas" : "Favoritar"}">${icon("star", 13)}</button>
            <button type="button" class="pk-rm" data-rm="${s.id}" aria-label="Remover da coleção" title="Remover da coleção">${icon("x", 12)}</button>
            ${P.sending === s.id ? `<span class="pk-spin">${icon("spinner", 18, 'class="spin"')}</span>` : ""}</div>`;
        })
        .join("");
    }

    async function sendSticker(id) {
      const s = P.stickers.find((x) => x.id === id);
      if (!s || P.sending) return;
      P.sending = id;
      renderStickers();
      try {
        await opts.onSticker(s);
        ST.touch(id).catch(() => {});
      } catch (e) {
        opts.toast?.(`Figurinha não enviada: ${e.message}`, "err");
      } finally {
        P.sending = null;
        renderStickers();
      }
    }

    async function createFrom(file) {
      try {
        const rec = await ST.fromImage(file);
        if (!rec) throw new Error("A imagem ficou grande demais.");
        P.stkFilter = "all";
        await loadStickers();
        opts.toast?.("Figurinha criada. Clique nela para enviar.", "ok");
      } catch (e) {
        opts.toast?.(e.message, "err");
      }
    }

    // ------------------------------------------------------------ geral
    function setTab(tab) {
      P.tab = tab;
      try {
        localStorage.setItem(TAB_KEY, tab);
      } catch {}
      for (const b of box.querySelectorAll("[data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
      for (const b of box.querySelectorAll("[data-body]")) b.hidden = b.dataset.body !== tab;
      if (tab === "emoji") {
        if (!P.built) buildEmoji();
        box.querySelector(".pk-search input").focus({ preventScroll: true });
      } else loadStickers();
    }

    function bind() {
      const root = box.querySelector(".pk");
      // cliques no painel não tiram o cursor do campo de mensagem (exceto a busca)
      root.addEventListener("mousedown", (e) => {
        if (e.target.closest("button")) e.preventDefault();
      });
      root.addEventListener("click", (e) => {
        const t = e.target.closest("button, [data-stk]");
        if (!t) return;
        if (t.dataset.tab) return setTab(t.dataset.tab);
        if (t.classList.contains("pk-x")) return close();
        if (t.dataset.e) return pick(t.dataset.e, true);
        if (t.dataset.cat) {
          const sec = box.querySelector(`[data-sec="${t.dataset.cat}"]`);
          const grid = box.querySelector(".pk-grid");
          if (sec && !sec.hidden) grid.scrollTo({ top: sec.offsetTop - grid.offsetTop, behavior: "smooth" });
          return;
        }
        if (t.classList.contains("pk-tone")) {
          const m = box.querySelector(".pk-tones");
          m.hidden = !m.hidden;
          t.setAttribute("aria-expanded", String(!m.hidden));
          return;
        }
        if (t.dataset.tone !== undefined) {
          setTone(Number(t.dataset.tone));
          box.querySelector(".pk-tones").hidden = true;
          box.querySelector(".pk-tone").setAttribute("aria-expanded", "false");
          return;
        }
        if (t.dataset.f) {
          P.stkFilter = t.dataset.f;
          return renderStickers();
        }
        if (t.classList.contains("pk-create") || t.classList.contains("pk-create2")) return box.querySelector(".pk-file").click();
        if (t.dataset.fav) {
          const s = P.stickers.find((x) => x.id === t.dataset.fav);
          return ST.setFav(t.dataset.fav, !s?.fav).then(loadStickers);
        }
        if (t.dataset.rm) return ST.remove(t.dataset.rm).then(loadStickers);
        if (t.dataset.stk) return sendSticker(t.dataset.stk);
      });
      box.querySelector(".pk-file").addEventListener("change", (e) => {
        const f = e.target.files[0];
        e.target.value = "";
        if (f) createFrom(f);
      });
      const input = box.querySelector(".pk-search input");
      input.addEventListener("input", () => doSearch(input.value));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const first = box.querySelector('[data-sec="results"]:not([hidden]) .pk-e');
          if (first) pick(first.dataset.e, true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (input.value) {
            input.value = "";
            doSearch("");
          } else close();
        }
      });
      const grid = box.querySelector(".pk-grid");
      grid.addEventListener("scroll", () => requestAnimationFrame(spy), { passive: true });
      grid.addEventListener("mouseover", (e) => hover(e.target.closest(".pk-e")?.dataset.e));
      grid.addEventListener("mouseleave", () => hover(null));
      root.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !e.target.closest("input")) {
          e.stopPropagation();
          close();
        }
      });
      ST.onChange(() => P.open && P.tab === "sticker" && loadStickers());
    }

    async function open(tab) {
      if (!box.querySelector(".pk")) shell();
      [P.recent, P.tone] = await Promise.all([getStored(RECENT_KEY, []), getStored(TONE_KEY, 0)]);
      if (P.built) {
        renderRecent();
        paintTone();
        const input = box.querySelector(".pk-search input");
        if (input.value) (input.value = ""), doSearch("");
      }
      P.open = true;
      box.hidden = false;
      setTab(tab || P.tab);
    }

    function close() {
      if (!P.open) return;
      P.open = false;
      box.hidden = true;
      opts.onClose?.();
    }

    return { open, close, toggle: (tab) => (P.open ? close() : open(tab)), get isOpen() { return P.open; } };
  }

  globalThis.OrbitaPicker = { create, search, supportedVersion, _index: index };
})();
