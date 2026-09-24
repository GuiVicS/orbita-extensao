// Respostas rápidas — tela de gerenciamento (quick-replies.html), aberta dentro
// do painel da Órbita (#/respostas-rapidas) ou sozinha.
(() => {
  "use strict";
  const Q = globalThis.OrbitaQR;
  const A = globalThis.OrbitaAudio;
  const { esc, icon, STEP_TYPES } = Q;

  const params = new URLSearchParams(location.search);
  const EMBED = params.has("embed");
  if (EMBED) document.body.classList.add("embed");

  // ------------------------------------------------------------------ tema
  const mq = matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    let dark;
    if (EMBED) {
      try {
        dark = parent.document.documentElement.classList.contains("dark");
      } catch {}
    }
    if (dark === undefined) {
      let t = "system";
      try {
        t = localStorage.getItem("orbita-theme") || "system";
      } catch {}
      dark = t === "dark" || (t === "system" && mq.matches);
    }
    document.documentElement.classList.toggle("dark", dark);
  }
  applyTheme();
  mq.addEventListener("change", applyTheme);
  addEventListener("storage", applyTheme);
  if (EMBED) {
    try {
      new MutationObserver(applyTheme).observe(parent.document.documentElement, { attributes: true, attributeFilter: ["class"] });
    } catch {}
  }

  // ---------------------------------------------------------------- estado
  const S = { data: null, stats: {}, tab: "items", search: "", cat: "all", editor: null, lastWrite: "", dragId: null };
  const app = document.getElementById("app");
  const modalRoot = document.createElement("div");
  const toasts = document.createElement("div");
  toasts.className = "toasts";
  document.body.append(modalRoot, toasts);

  const SAMPLE = { name: "Maria Silva", phone: "5511999998888", me: "Você" };
  const EMOJIS = "👋 😊 🙏 ✅ ⏳ 🕘 📍 📞 💸 💳 🧾 📦 🚚 🎁 🔥 ⭐ 💬 📄 📎 🎧 🎥 📸 🗓️ ⚠️ ❤️ 👍 🤝 💡 🏷️ 🛒 💰 📢 🎉 😉 🙌 ☕ 🔑 🏠 🛠️ 📌".split(" ");

  function toast(text, kind = "") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.innerHTML = `${icon(kind === "err" ? "x" : kind === "ok" ? "check" : "zap", 16)}<span>${esc(text)}</span>`;
    toasts.append(el);
    setTimeout(() => el.remove(), kind === "err" ? 6000 : 3000);
  }

  function relTime(ts) {
    if (!ts) return "";
    const d = Math.floor((Date.now() - ts) / 864e5);
    if (d <= 0) return "hoje";
    if (d === 1) return "ontem";
    if (d < 30) return `há ${d} dias`;
    const m = Math.floor(d / 30);
    return m < 12 ? `há ${m} ${m === 1 ? "mês" : "meses"}` : `há ${Math.floor(m / 12)} ano(s)`;
  }

  async function persist() {
    S.lastWrite = JSON.stringify(S.data);
    await Q.save(S.data);
  }

  const catById = (id) => S.data.categories.find((c) => c.id === id);
  const colorOf = (item) => catById(item.categoryId)?.color || "#7c6cf0";
  const emojiOf = (item, size = 18) => (item.emoji ? esc(item.emoji) : icon(Q.stepIcon(item.steps[0] || { type: "text" }), size));

  // ========================================================== tela principal
  function render() {
    const d = S.data;
    const withMedia = d.items.filter((i) => i.steps.some((s) => STEP_TYPES[s.type].media)).length;
    const top = [...d.items].sort((a, b) => (S.stats[b.id]?.n || 0) - (S.stats[a.id]?.n || 0))[0];
    const totalUses = Object.values(S.stats).reduce((a, s) => a + (s.n || 0), 0);
    app.innerHTML = `<div class="page">
      <div class="head">
        <div><h1><span class="z">${icon("zap", 22)}</span>Respostas rápidas</h1>
          <p>Mensagens prontas (texto, áudio gravado, foto, vídeo, documento e mais) que aparecem logo abaixo do campo de mensagem no WhatsApp Web. Clique para enviar ou digite <span class="sc">/atalho</span> no campo.</p></div>
        <div class="actions">
          <button class="btn" data-act="import">${icon("upload", 15)} Importar</button>
          <button class="btn" data-act="export">${icon("download", 15)} Exportar</button>
          <button class="btn primary" data-act="new">${icon("plus", 16)} Nova resposta</button>
        </div>
      </div>
      <div class="stats">
        <div class="stat"><div class="ic">${icon("zap", 18)}</div><div class="txt"><b>${d.items.length}</b><span>respostas rápidas</span></div></div>
        <div class="stat"><div class="ic">${icon("image", 18)}</div><div class="txt"><b>${withMedia}</b><span>com mídia</span></div></div>
        <div class="stat"><div class="ic">${icon("send", 18)}</div><div class="txt"><b>${totalUses}</b><span>envios pela barra</span></div></div>
        <div class="stat"><div class="ic">${icon("star", 18)}</div><div class="txt"><b class="sm">${top && S.stats[top.id]?.n ? esc(top.title) : "—"}</b><span>mais usada</span></div></div>
      </div>
      <nav class="tabs">
        <button data-tab="items" class="${S.tab === "items" ? "on" : ""}">${icon("grid", 15)} Respostas <span class="count">${d.items.length}</span></button>
        <button data-tab="categories" class="${S.tab === "categories" ? "on" : ""}">${icon("tag", 15)} Categorias <span class="count">${d.categories.length}</span></button>
        <button data-tab="settings" class="${S.tab === "settings" ? "on" : ""}">${icon("sliders", 15)} Preferências</button>
      </nav>
      <div id="tabbody"></div>
    </div>
    <input type="file" id="importFile" accept="application/json,.json" hidden>`;
    renderTab();
  }

  function renderTab() {
    const body = document.getElementById("tabbody");
    if (!body) return;
    if (S.tab === "items") {
      const cats = [["all", "Todas", ""], ["fav", "Favoritas", "star"], ...S.data.categories.map((c) => [c.id, c.name, c.color])];
      body.innerHTML = `<div class="toolbar">
          <div class="search">${icon("search", 16)}<input class="input" id="q" placeholder="Buscar por título, atalho ou texto" value="${esc(S.search)}"></div>
          <div class="chips">${cats
            .map(([id, name, extra]) => `<button class="chip ${S.cat === id ? "on" : ""}" data-cat="${esc(id)}">${extra === "star" ? icon("star", 13) : extra ? `<span class="dot" style="background:${esc(extra)}"></span>` : ""}${esc(name)}</button>`)
            .join("")}</div>
        </div><div id="gridwrap"></div>`;
      renderGrid();
    } else if (S.tab === "categories") body.innerHTML = categoriesHtml();
    else {
      body.innerHTML = settingsHtml();
      updateStorageInfo();
    }
  }

  function filteredItems() {
    const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const q = norm(S.search.trim().replace(/^\//, ""));
    return S.data.items.filter((i) => {
      if (S.cat === "fav" && !i.favorite) return false;
      if (S.cat !== "all" && S.cat !== "fav" && i.categoryId !== S.cat) return false;
      if (!q) return true;
      return norm(i.title).includes(q) || i.shortcut.includes(q) || i.steps.some((s) => norm(Q.stepSummary(s)).includes(q));
    });
  }

  function cardHtml(it, i) {
    const cat = catById(it.categoryId);
    const st = S.stats[it.id];
    const firstText = it.steps.find((s) => s.type === "text")?.text || it.steps.map(Q.stepSummary).join(" · ");
    const tags = it.steps
      .slice(0, 6)
      .map((s) => {
        const extra = s.type === "audio" && s.duration ? ` ${Q.formatDuration(s.duration)}` : "";
        const label = s.type === "audio" ? (s.ptt ? "Voz" : "Áudio") : s.type === "video" && s.ptv ? "Vídeo redondo" : s.type === "video" && s.gif ? "GIF" : STEP_TYPES[s.type].label;
        return `<span class="tag">${icon(Q.stepIcon(s), 12)}${esc(label)}${extra}</span>`;
      })
      .join("");
    return `<article class="card" draggable="${S.search ? "false" : "true"}" data-id="${esc(it.id)}" style="--c:${esc(colorOf(it))};animation-delay:${Math.min(i, 12) * 25}ms">
      <div class="top"><div class="em">${emojiOf(it, 20)}</div>
        <div class="ttl"><b>${esc(it.title)}</b><div class="meta">${it.shortcut ? `<span class="sc">/${esc(it.shortcut)}</span>` : ""}${cat ? `<span class="dot" style="background:${esc(cat.color)}"></span>${esc(cat.name)}` : ""}</div></div>
        <button class="ibtn star ${it.favorite ? "on" : ""}" data-act="fav" title="${it.favorite ? "Remover das favoritas" : "Marcar como favorita"}">${icon("star", 16)}</button></div>
      <div class="snip">${esc(Q.renderVars(firstText, SAMPLE).replace(/([*_~])([^*_~\n]+)\1/g, "$2"))}</div>
      <div class="steps">${tags}${it.steps.length > 6 ? `<span class="tag">+${it.steps.length - 6}</span>` : ""}</div>
      <footer><span class="muted">${st?.n ? `Usada ${st.n}× · ${relTime(st.last)}` : "Ainda não usada"}</span>
        <span class="grip" title="Arraste para reordenar">${icon("grip", 16)}</span>
        <button class="ibtn" data-act="dup" title="Duplicar">${icon("copy", 15)}</button>
        <button class="ibtn danger" data-act="del" title="Excluir">${icon("trash", 15)}</button></footer>
    </article>`;
  }

  function renderGrid() {
    const wrap = document.getElementById("gridwrap");
    if (!wrap) return;
    const items = filteredItems();
    if (!S.data.items.length) {
      wrap.innerHTML = `<div class="emptybox"><p><b>Nenhuma resposta rápida ainda.</b></p><p>Crie mensagens prontas com texto, áudio, fotos, vídeos e documentos.</p><button class="btn primary" data-act="new">${icon("plus", 16)} Criar a primeira</button></div>`;
      return;
    }
    wrap.innerHTML = `<div class="grid">${items.map(cardHtml).join("")}
      ${S.search ? "" : `<button class="newcard" data-act="new"><span>${icon("plus", 26)}Nova resposta rápida</span></button>`}</div>
      ${!items.length ? `<p class="muted" style="text-align:center;padding:30px">Nada encontrado com esse filtro.</p>` : ""}`;
  }

  // ---------------------------------------------------------- categorias
  function categoriesHtml() {
    const count = (id) => S.data.items.filter((i) => i.categoryId === id).length;
    const rows = S.data.categories
      .map(
        (c, i) => `<div class="catrow" data-cid="${esc(c.id)}">
        <span class="dot" style="background:${esc(c.color)};width:12px;height:12px"></span>
        <input class="input" data-catname value="${esc(c.name)}" maxlength="30">
        <div class="swatches">${Q.COLORS.map((col) => `<button data-color="${col}" class="${col === c.color ? "on" : ""}" style="background:${col}" title="${col}"></button>`).join("")}</div>
        <span class="cnt">${count(c.id)} resposta(s)</span>
        <button class="ibtn" data-act="catup" ${i === 0 ? "disabled" : ""} title="Subir">${icon("arrowUp", 15)}</button>
        <button class="ibtn" data-act="catdown" ${i === S.data.categories.length - 1 ? "disabled" : ""} title="Descer">${icon("arrowDown", 15)}</button>
        <button class="ibtn danger" data-act="catdel" title="Excluir categoria">${icon("trash", 15)}</button></div>`,
      )
      .join("");
    return `<div class="panel"><h3>Categorias</h3><p class="desc">Organizam a barra do WhatsApp: escolha a categoria no seletor ao lado do raio. A cor aparece em cada resposta.</p>
      <div class="inner">${rows || `<p class="muted" style="padding:8px 20px">Nenhuma categoria.</p>`}</div>
      <div class="addcat"><input class="input" id="newcat" placeholder="Nova categoria (ex.: Pós-venda)" maxlength="30"><button class="btn" data-act="addcat">${icon("plus", 15)} Adicionar</button></div></div>`;
  }

  function addCategory(name) {
    const n = name.trim();
    if (!n) return null;
    const c = { id: Q.uid(), name: n, color: Q.COLORS[S.data.categories.length % Q.COLORS.length] };
    S.data.categories.push(c);
    return c;
  }

  // --------------------------------------------------------- preferências
  const SETTINGS_UI = [
    { group: "No WhatsApp Web" },
    { k: "enabled", type: "bool", t: "Mostrar a barra de respostas rápidas", d: "Fica logo abaixo do campo de mensagem de cada conversa." },
    { k: "slash", type: "bool", t: "Atalhos com /", d: "Digite / no campo de mensagem (ex.: /pix) para buscar; Enter ou Tab envia, Shift+Enter põe o texto no campo." },
    { k: "hotkeys", type: "bool", t: "Teclas Alt+1 a Alt+9", d: "Enviam as nove primeiras respostas da barra. Segure Alt para ver os números." },
    { k: "confirmSend", type: "bool", t: "Revisar antes de enviar", d: "Ao clicar numa resposta, mostra a prévia com o botão Enviar. Shift+clique continua enviando direto." },
    { k: "textAction", type: "select", t: "Respostas só de texto", d: "Enviar na hora ou colocar o texto no campo para você revisar e apertar Enter.", options: [["send", "Enviar direto"], ["insert", "Colocar no campo para eu revisar"]] },
    { k: "favoritesFirst", type: "bool", t: "Favoritas primeiro", d: "As respostas marcadas com estrela aparecem no começo da barra." },
    { k: "showTypeIcons", type: "bool", t: "Ícones de mídia nos botões", d: "Mostra quando a resposta tem áudio, foto, vídeo etc." },
    { group: "Envio" },
    { k: "simulate", type: "bool", t: "Parecer feito na hora", d: "O contato vê “digitando…” antes dos textos e “gravando áudio…” antes das mensagens de voz." },
    { k: "typingCps", type: "num", sub: "simulate", t: "Velocidade de digitação", unit: "caract./s", min: 4, max: 60, step: 1 },
    { k: "maxTypingSec", type: "num", sub: "simulate", t: "Máximo de “digitando…”", unit: "s", min: 1, max: 30, step: 1 },
    { k: "maxRecordingSec", type: "num", sub: "simulate", t: "Máximo de “gravando áudio…”", d: "Usa a duração do áudio até este limite.", unit: "s", min: 1, max: 120, step: 1 },
    { k: "stepDelaySec", type: "num", t: "Intervalo entre as mensagens", d: "Pausa entre uma mensagem e a próxima de uma mesma resposta (além da simulação).", unit: "s", min: 0, max: 60, step: 0.5 },
  ];

  function settingsHtml() {
    const st = S.data.settings;
    let html = "";
    let open = false;
    for (const row of SETTINGS_UI) {
      if (row.group) {
        if (open) html += "</div></div>";
        html += `<div class="panel"><h3>${esc(row.group)}</h3><div class="inner">`;
        open = true;
        continue;
      }
      const off = row.sub && !st[row.sub];
      let control = "";
      if (row.type === "bool") control = `<label class="switch"><input type="checkbox" data-set="${row.k}" ${st[row.k] ? "checked" : ""}></label>`;
      else if (row.type === "select") control = `<select class="select wide" data-set="${row.k}">${row.options.map(([v, l]) => `<option value="${v}" ${st[row.k] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
      else control = `<input class="input" type="number" data-set="${row.k}" value="${st[row.k]}" min="${row.min}" max="${row.max}" step="${row.step}"><span class="muted small" style="width:64px">${esc(row.unit)}</span>`;
      html += `<div class="setrow ${row.sub ? "sub" : ""} ${off ? "off" : ""}"><div class="txt"><b>${esc(row.t)}</b>${row.d ? `<span>${esc(row.d)}</span>` : ""}</div>${control}</div>`;
    }
    html += "</div></div>";
    html += `<div class="panel"><h3>Atalhos no WhatsApp Web</h3><div class="kbdrow">
      <span><kbd>/</kbd> + atalho — buscar no campo de mensagem</span><span><kbd>Enter</kbd> / <kbd>Tab</kbd> enviar</span>
      <span><kbd>Shift</kbd>+<kbd>Enter</kbd> ou Shift+clique — pôr o texto no campo</span><span><kbd>Alt</kbd>+<kbd>1…9</kbd> enviar da barra</span>
      <span>Botão direito numa resposta — prévia</span></div></div>
      <div class="panel"><h3>Armazenamento</h3><p class="desc">Os arquivos ficam só neste navegador, junto com os dados da extensão.</p>
      <div class="setrow" style="border-top:0"><div class="txt"><b id="storageInfo">Calculando…</b><span>Arquivos que não pertencem a nenhuma resposta podem ser removidos.</span></div>
      <button class="btn" data-act="cleanup">${icon("trash", 15)} Limpar arquivos órfãos</button></div></div>`;
    return html;
  }

  async function allMediaKeys() {
    const keys = typeof chrome.storage.local.getKeys === "function" ? await chrome.storage.local.getKeys() : Object.keys(await chrome.storage.local.get(null));
    return keys.filter((k) => k.startsWith(Q.MEDIA_PREFIX));
  }

  async function updateStorageInfo() {
    try {
      const keys = await allMediaKeys();
      const bytes = keys.length ? await chrome.storage.local.getBytesInUse(keys) : 0;
      const el = document.getElementById("storageInfo");
      if (el) el.textContent = `${keys.length} arquivo(s) · ${Q.formatBytes(bytes)}`;
    } catch {}
  }

  async function cleanupOrphans() {
    const used = new Set(S.data.items.flatMap(Q.mediaIdsOf).map((id) => Q.MEDIA_PREFIX + id));
    const orphans = (await allMediaKeys()).filter((k) => !used.has(k));
    if (orphans.length) await chrome.storage.local.remove(orphans);
    toast(orphans.length ? `${orphans.length} arquivo(s) removido(s).` : "Nenhum arquivo órfão.", "ok");
    updateStorageInfo();
  }

  // -------------------------------------------------- ações na tela principal
  async function duplicateItem(item) {
    const copy = structuredClone(item);
    copy.id = Q.uid();
    copy.title = `${item.title} (cópia)`;
    copy.shortcut = "";
    copy.createdAt = copy.updatedAt = Date.now();
    for (const s of copy.steps) {
      s.id = Q.uid();
      if (s.mediaId) {
        const rec = await Q.getMediaRecord(s.mediaId);
        s.mediaId = rec ? Q.uid() : undefined;
        if (rec) await chrome.storage.local.set({ [Q.MEDIA_PREFIX + s.mediaId]: rec });
      }
    }
    S.data.items.splice(S.data.items.indexOf(item) + 1, 0, copy);
    await persist();
    render();
    toast("Resposta duplicada.", "ok");
  }

  async function deleteItem(item) {
    if (!confirm(`Excluir a resposta “${item.title}”? Os arquivos dela também serão apagados.`)) return;
    S.data.items = S.data.items.filter((i) => i.id !== item.id);
    await Q.removeMedia(Q.mediaIdsOf(item));
    await persist();
    render();
    toast("Resposta excluída.");
  }

  async function exportAll() {
    const ids = S.data.items.flatMap(Q.mediaIdsOf);
    const r = ids.length ? await chrome.storage.local.get(ids.map((id) => Q.MEDIA_PREFIX + id)) : {};
    const media = {};
    for (const id of ids) if (r[Q.MEDIA_PREFIX + id]) media[id] = r[Q.MEDIA_PREFIX + id];
    const payload = { format: "orbita-respostas-rapidas", version: 1, exportedAt: new Date().toISOString(), settings: S.data.settings, categories: S.data.categories, items: S.data.items, media };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `orbita-respostas-rapidas-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`${S.data.items.length} resposta(s) exportada(s).`, "ok");
  }

  async function importFile(file) {
    let json;
    try {
      json = JSON.parse(await file.text());
    } catch {
      return toast("Arquivo inválido.", "err");
    }
    if (json?.format !== "orbita-respostas-rapidas" || !Array.isArray(json.items)) return toast("Este arquivo não é uma exportação de respostas rápidas da Órbita.", "err");
    const catMap = new Map();
    for (const c of json.categories || []) {
      const found = S.data.categories.find((x) => x.name.toLowerCase() === String(c.name).toLowerCase());
      catMap.set(c.id, found?.id || (S.data.categories.push({ id: Q.uid(), name: String(c.name), color: c.color || Q.COLORS[0] }), S.data.categories.at(-1).id));
    }
    const shortcuts = new Set(S.data.items.map((i) => i.shortcut).filter(Boolean));
    let n = 0;
    for (const raw of Q.normalize({ items: json.items }).items) {
      const item = { ...raw, id: Q.uid(), categoryId: catMap.get(raw.categoryId) || "", createdAt: Date.now(), updatedAt: Date.now() };
      if (item.shortcut && shortcuts.has(item.shortcut)) item.shortcut = "";
      if (item.shortcut) shortcuts.add(item.shortcut);
      for (const s of item.steps) {
        s.id = Q.uid();
        if (s.mediaId) {
          const rec = json.media?.[s.mediaId];
          s.mediaId = rec?.data ? Q.uid() : undefined;
          if (s.mediaId) await chrome.storage.local.set({ [Q.MEDIA_PREFIX + s.mediaId]: rec });
        }
      }
      S.data.items.push(item);
      n++;
    }
    await persist();
    render();
    toast(`${n} resposta(s) importada(s).`, "ok");
  }

  // eventos da tela principal
  app.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act],[data-tab],[data-cat],[data-color],.card");
    if (!t) return;
    if (t.dataset.tab) {
      S.tab = t.dataset.tab;
      return render();
    }
    if (t.dataset.cat) {
      S.cat = t.dataset.cat;
      document.querySelectorAll(".chips .chip").forEach((c) => c.classList.toggle("on", c.dataset.cat === S.cat));
      return renderGrid();
    }
    if (t.dataset.color) {
      const c = catById(t.closest("[data-cid]").dataset.cid);
      c.color = t.dataset.color;
      persist();
      return renderTab();
    }
    const card = t.closest(".card");
    const item = card && S.data.items.find((i) => i.id === card.dataset.id);
    const act = t.dataset.act;
    if (!act && item) return openEditor(item);
    const cid = t.closest("[data-cid]")?.dataset.cid;
    switch (act) {
      case "new":
        return openEditor(null);
      case "fav":
        item.favorite = !item.favorite;
        persist();
        return renderGrid();
      case "dup":
        return duplicateItem(item);
      case "del":
        return deleteItem(item);
      case "export":
        return exportAll();
      case "import":
        return document.getElementById("importFile").click();
      case "addcat": {
        const inp = document.getElementById("newcat");
        if (!addCategory(inp.value)) return inp.focus();
        persist();
        return render();
      }
      case "catup":
      case "catdown": {
        const arr = S.data.categories;
        const i = arr.findIndex((c) => c.id === cid);
        const j = act === "catup" ? i - 1 : i + 1;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        persist();
        return renderTab();
      }
      case "catdel": {
        const c = catById(cid);
        const n = S.data.items.filter((i) => i.categoryId === cid).length;
        if (!confirm(`Excluir a categoria “${c.name}”?${n ? ` ${n} resposta(s) ficarão sem categoria.` : ""}`)) return;
        S.data.categories = S.data.categories.filter((x) => x.id !== cid);
        S.data.items.forEach((i) => i.categoryId === cid && (i.categoryId = ""));
        if (S.cat === cid) S.cat = "all";
        persist();
        return render();
      }
      case "cleanup":
        return cleanupOrphans();
    }
  });

  app.addEventListener("input", (e) => {
    if (e.target.id === "q") {
      S.search = e.target.value;
      renderGrid();
    }
  });

  app.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "importFile" && t.files[0]) {
      importFile(t.files[0]);
      t.value = "";
    } else if (t.dataset.catname !== undefined) {
      const c = catById(t.closest("[data-cid]").dataset.cid);
      c.name = t.value.trim() || c.name;
      persist();
    } else if (t.dataset.set) {
      const row = SETTINGS_UI.find((r) => r.k === t.dataset.set);
      let v = row.type === "bool" ? t.checked : row.type === "num" ? Number(t.value) : t.value;
      if (row.type === "num") v = Math.min(row.max, Math.max(row.min, Number.isFinite(v) ? v : Q.DEFAULT_SETTINGS[row.k]));
      S.data.settings[row.k] = v;
      persist();
      if (row.type === "bool" || row.type === "num") renderTab();
      toast("Preferência salva.", "ok");
    }
  });

  app.addEventListener("keydown", (e) => {
    if (e.target.id === "newcat" && e.key === "Enter") document.querySelector('[data-act="addcat"]').click();
  });

  // reordenar arrastando
  app.addEventListener("dragstart", (e) => {
    const card = e.target.closest?.(".card");
    if (!card) return;
    S.dragId = card.dataset.id;
    card.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  app.addEventListener("dragend", () => {
    S.dragId = null;
    document.querySelectorAll(".card.dragging,.card.drop").forEach((c) => c.classList.remove("dragging", "drop"));
  });
  app.addEventListener("dragover", (e) => {
    const card = e.target.closest?.(".card");
    if (!S.dragId || !card || card.dataset.id === S.dragId) return;
    e.preventDefault();
    document.querySelectorAll(".card.drop").forEach((c) => c !== card && c.classList.remove("drop"));
    card.classList.add("drop");
  });
  app.addEventListener("drop", (e) => {
    const card = e.target.closest?.(".card");
    if (!S.dragId || !card) return;
    e.preventDefault();
    const items = S.data.items;
    const from = items.findIndex((i) => i.id === S.dragId);
    const [moved] = items.splice(from, 1);
    items.splice(items.findIndex((i) => i.id === card.dataset.id), 0, moved);
    persist();
    renderGrid();
  });

  // ================================================================ editor
  const newStep = (type) => {
    const s = { id: Q.uid(), type, delaySec: 0 };
    if (type === "text") s.text = "";
    if (type === "audio") s.ptt = true;
    if (type === "poll") Object.assign(s, { pollName: "", pollOptions: ["", ""], pollMultiple: false });
    return s;
  };

  function openEditor(item) {
    const it = item
      ? structuredClone(item)
      : { id: Q.uid(), title: "", shortcut: "", emoji: "", categoryId: S.cat !== "all" && S.cat !== "fav" ? S.cat : "", favorite: S.cat === "fav", steps: [newStep("text")], createdAt: Date.now() };
    S.editor = { item: it, original: item, pending: new Map(), urls: new Map(), busy: new Set(), rec: null, dirty: false, emoji: false, errStep: null, saving: false };
    renderEditor();
    setTimeout(() => modalRoot.querySelector(item ? "textarea" : '[data-f="title"]')?.focus(), 30);
  }

  function closeEditor(force = false) {
    const E = S.editor;
    if (!E) return;
    if (!force && E.dirty && !confirm("Descartar as alterações desta resposta?")) return;
    E.rec?.handle?.cancel();
    clearInterval(E.rec?.timer);
    E.urls.forEach((u) => URL.revokeObjectURL(u));
    S.editor = null;
    modalRoot.innerHTML = "";
    if (EMBED) try { parent.history.replaceState(null, "", "#/respostas-rapidas"); } catch {}
  }

  function renderEditor() {
    const E = S.editor;
    const it = E.item;
    const cats = S.data.categories;
    modalRoot.innerHTML = `<div class="overlay" data-overlay>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Editar resposta rápida">
        <header><h2>${E.original ? "Editar resposta rápida" : "Nova resposta rápida"}</h2><span class="muted small">Ctrl+S salva · Esc fecha</span>
          <button class="ibtn" data-act="close" title="Fechar">${icon("x", 18)}</button></header>
        <div class="mbody">
          <div class="form" id="form">
            <div class="ident">
              <div class="field" style="position:relative"><label>Ícone</label>
                <button class="emojibtn" data-act="emoji" title="Escolher emoji">${it.emoji ? esc(it.emoji) : icon("plus", 20)}</button>
                ${E.emoji ? `<div class="emojis">${EMOJIS.map((em) => `<button data-emoji="${em}">${em}</button>`).join("")}<button class="clear" data-emoji="">Sem ícone</button></div>` : ""}</div>
              <div class="field"><label for="f-title">Título *</label><input id="f-title" class="input" data-f="title" value="${esc(it.title)}" maxlength="60" placeholder="Ex.: Boas-vindas, Chave Pix, Catálogo"></div>
              <div class="field"><label for="f-sc">Atalho</label><div class="prefix"><span>/</span><input id="f-sc" class="input" data-f="shortcut" value="${esc(it.shortcut)}" maxlength="24" placeholder="oi" spellcheck="false"></div></div>
              <div class="field"><label for="f-cat">Categoria</label><select id="f-cat" class="select" data-f="categoryId"><option value="">Sem categoria</option>
                ${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === it.categoryId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}<option value="__new">+ Nova categoria…</option></select></div>
            </div>
            <div class="optsrow"><label class="switch"><input type="checkbox" data-f="favorite" ${it.favorite ? "checked" : ""}> Favorita — aparece primeiro na barra</label>
              <span class="err" id="formErr"></span></div>
            <div class="sectitle">Mensagens <span class="n" id="stepCount">${it.steps.length}</span><span class="muted small" style="font-weight:400">Enviadas nesta ordem. Arraste arquivos para cá ou cole uma imagem (Ctrl+V).</span></div>
            <div id="steps" style="display:grid;gap:12px"></div>
            <div class="addbar"><span class="lbl">Adicionar</span>
              ${Object.entries(STEP_TYPES).map(([k, v]) => `<button class="btn sm" data-add="${k}"><span class="ic">${icon(v.icon, 15)}</span>${v.label}</button>`).join("")}</div>
          </div>
          <aside class="pv"><div class="pvh">${icon("text", 14)} Prévia no WhatsApp</div>
            <div class="phone"><div class="bar"><div class="av">${icon("contact", 18)}</div><div><b>${esc(SAMPLE.name)}</b><small>online</small></div></div><div class="thread" id="thread"></div></div>
            <p class="pvnote">Variáveis preenchidas com um contato de exemplo. As pausas mostradas não incluem a simulação de digitação.</p></aside>
        </div>
        <footer>${E.original ? `<button class="btn danger" data-act="delete">${icon("trash", 15)} Excluir</button>` : ""}<span class="sp"></span>
          <button class="btn" data-act="close">Cancelar</button>
          <button class="btn primary" data-act="save" ${E.saving ? "disabled" : ""}>${E.saving ? icon("spinner", 15, 'class="spin"') : icon("check", 15)} Salvar</button></footer>
      </div><div class="dropall">Solte para adicionar à resposta</div></div>`;
    renderSteps();
  }

  // ---- passos
  function stepHtml(s, i, n) {
    const E = S.editor;
    const t = STEP_TYPES[s.type];
    const bad = E.errStep === s.id ? ' style="outline:2px solid var(--destructive);outline-offset:2px"' : "";
    return `<div class="step" data-sid="${esc(s.id)}"${bad}>
      <header><span class="num">${i + 1}</span><span class="type"><span class="ic">${icon(Q.stepIcon(s), 15)}</span>${esc(t.label)}</span>
        <label class="delay" title="Espera extra antes desta mensagem">${icon("clock", 13)} aguardar <input class="input" type="number" min="0" max="600" step="0.5" data-s="delaySec" value="${s.delaySec || 0}"> s</label>
        <button class="ibtn" data-act="up" ${i === 0 ? "disabled" : ""} title="Subir">${icon("arrowUp", 15)}</button>
        <button class="ibtn" data-act="down" ${i === n - 1 ? "disabled" : ""} title="Descer">${icon("arrowDown", 15)}</button>
        <button class="ibtn" data-act="dupstep" title="Duplicar">${icon("copy", 15)}</button>
        <button class="ibtn danger" data-act="rmstep" title="Remover">${icon("trash", 15)}</button></header>
      <div class="sbody">${stepBody(s)}</div></div>`;
  }

  const varsBar = (withFmt, count) => `<div class="vars">${withFmt ? `<button class="fmt" data-fmt="*" title="Negrito"><b>B</b></button><button class="fmt" data-fmt="_" title="Itálico"><i>I</i></button><button class="fmt" data-fmt="~" title="Tachado"><s>S</s></button><span style="width:6px"></span>` : ""}
    ${Q.VARIABLES.map(([k, d]) => `<button data-var="${k}" title="${esc(d)}">{{${k}}}</button>`).join("")}<span class="sp"></span>${count !== undefined ? `<span class="muted small" data-count>${count} caracteres</span>` : ""}</div>`;

  const captionField = (s, label = "Legenda (opcional)") =>
    `<div class="field"><label>${label}</label><textarea class="textarea" rows="2" style="min-height:60px" data-s="caption" placeholder="Aceita variáveis como {{primeiro_nome}}">${esc(s.caption || "")}</textarea>${varsBar(true)}</div>`;

  function mediaBlock(s) {
    const E = S.editor;
    const t = STEP_TYPES[s.type];
    if (E.rec?.stepId === s.id)
      return `<div class="rec" data-rec><span class="led"></span><span class="time">0:00</span><div class="meter"></div>
        <button class="btn sm" data-act="recCancel">Descartar</button><button class="btn sm primary" data-act="recStop">${icon("stop", 13)} Concluir</button></div>`;
    if (E.busy.has(s.id)) return `<div class="mediarow"><span class="busy">${icon("spinner", 16, 'class="spin"')} ${s.type === "audio" && s.ptt ? "Convertendo para áudio de voz (OGG/Opus)…" : "Processando arquivo…"}</span></div>`;
    if (!s.mediaId) {
      const what = { image: "uma foto", video: "um vídeo", audio: "um áudio", document: "um documento (PDF, planilha, ZIP…)", sticker: "uma imagem para virar figurinha" }[s.type];
      return `<div class="drop" data-act="pick">${icon(s.type === "audio" ? "mic" : "upload", 22)}<div><b>Arraste ${what} ou clique para escolher</b></div>
        ${s.type === "audio" ? `<div class="row"><button class="btn sm" data-act="pick">${icon("upload", 13)} Escolher arquivo</button><button class="btn sm primary" data-act="rec">${icon("mic", 13)} Gravar agora</button></div><span class="small">MP3, M4A, WAV, OGG, WEBM… Convertemos para o formato de voz do WhatsApp.</span>` : ""}
        <input type="file" hidden accept="${esc(t.accept)}" data-file></div>`;
    }
    const round = s.type === "video" && s.ptv ? "round" : s.type === "sticker" ? "contain" : "";
    const th = s.thumb ? `<img src="${esc(s.thumb)}" alt="">` : icon(Q.stepIcon(s), 24);
    const url = E.urls.get(s.mediaId);
    if (s.type === "audio" && !url) ensureUrl(s.mediaId);
    const meta = [Q.formatBytes(s.size), s.duration ? Q.formatDuration(s.duration) : "", s.width ? `${s.width}×${s.height}` : ""].filter(Boolean).join(" · ");
    const okBadge = s.type === "audio" && s.ptt ? (/ogg|opus/i.test(s.mime || "") ? `<span class="ok">${icon("check", 12)} pronto para voz</span>` : `<span class="err">formato original — pode não tocar como voz</span>`) : "";
    return `<div class="mediarow"><div class="th ${round}">${th}</div>
      <div class="info"><b title="${esc(s.name)}">${esc(s.name || "arquivo")}</b><span class="muted small">${meta} ${okBadge}</span>
        ${s.type === "audio" ? `${s.peaks ? `<div class="wave">${s.peaks.map((p) => `<i style="height:${Math.max(8, p)}%"></i>`).join("")}</div>` : ""}${url ? `<audio controls preload="metadata" src="${url}"></audio>` : ""}` : ""}</div>
      <div style="display:grid;gap:6px">${s.type === "audio" ? `<button class="btn sm" data-act="rec">${icon("mic", 13)} Regravar</button>` : ""}<button class="btn sm" data-act="pick">${icon("upload", 13)} Trocar</button>
      <button class="btn sm ghost danger" data-act="unmedia">${icon("trash", 13)} Remover</button></div>
      <input type="file" hidden accept="${esc(t.accept)}" data-file></div>`;
  }

  function stepBody(s) {
    const chk = (k, label, extra = "") => `<label class="switch"><input type="checkbox" data-s="${k}" ${s[k] ? "checked" : ""} ${extra}> ${label}</label>`;
    switch (s.type) {
      case "text":
        return `<textarea class="textarea" rows="3" data-s="text" placeholder="Digite a mensagem… *negrito*, _itálico_, ~tachado~ e variáveis como {{primeiro_nome}}">${esc(s.text || "")}</textarea>
          ${varsBar(true, (s.text || "").length)}
          <div class="optsrow">${chk("noLinkPreview", "Sem prévia de links")}</div>`;
      case "image":
        return `${mediaBlock(s)}${captionField(s)}<div class="optsrow">${chk("hd", "Enviar em HD")}${chk("viewOnce", "Visualização única")}</div>`;
      case "video":
        return `${mediaBlock(s)}${s.ptv ? "" : captionField(s)}<div class="optsrow">${chk("ptv", "Vídeo redondo (recado de vídeo)")}${chk("gif", "Enviar como GIF (sem som, em loop)", s.ptv ? "disabled" : "")}${chk("viewOnce", "Visualização única", s.ptv ? "disabled" : "")}</div>`;
      case "audio":
        return `${mediaBlock(s)}<div class="optsrow">${chk("ptt", "Enviar como áudio gravado na hora (mensagem de voz)")}${s.ptt ? chk("viewOnce", "Ouvir uma vez") : ""}</div>
          <p class="hint">${s.ptt ? "Chega como mensagem de voz com microfone e forma de onda, e o contato vê “gravando áudio…” antes (se a simulação estiver ligada)." : "Chega como arquivo de áudio, com nome e player de música."}</p>`;
      case "document":
        return `${mediaBlock(s)}${s.mediaId ? `<div class="field"><label>Nome do arquivo que o cliente verá</label><input class="input" data-s="name" value="${esc(s.name || "")}"></div>` : ""}${captionField(s)}`;
      case "sticker":
        return `${mediaBlock(s)}<p class="hint">A imagem é ajustada para 512×512 (WebP) com fundo transparente, como uma figurinha.</p>`;
      case "location":
        return `<div class="field"><label>Colar link do Google Maps (opcional)</label><input class="input" data-maps placeholder="https://maps.google.com/…@-23.55,-46.63,17z"></div>
          <div class="grid2"><div class="field"><label>Latitude *</label><input class="input" data-s="lat" value="${esc(s.lat ?? "")}" placeholder="-23.5505"></div>
          <div class="field"><label>Longitude *</label><input class="input" data-s="lng" value="${esc(s.lng ?? "")}" placeholder="-46.6333"></div></div>
          <div class="grid2"><div class="field"><label>Nome do local</label><input class="input" data-s="name" value="${esc(s.name || "")}" placeholder="Nossa loja"></div>
          <div class="field"><label>Endereço</label><input class="input" data-s="address" value="${esc(s.address || "")}" placeholder="Rua Exemplo, 123 — Centro"></div></div>`;
      case "contact":
        return `<div class="grid2"><div class="field"><label>Nome *</label><input class="input" data-s="contactName" value="${esc(s.contactName || "")}" placeholder="Suporte Financeiro"></div>
          <div class="field"><label>Telefone com DDI e DDD *</label><input class="input" data-s="contactPhone" value="${esc(s.contactPhone || "")}" placeholder="55 11 99999-8888"></div></div>
          <p class="hint">Envia um cartão de contato que o cliente pode salvar ou abrir a conversa.</p>`;
      case "poll":
        return `<div class="field"><label>Pergunta *</label><input class="input" data-s="pollName" value="${esc(s.pollName || "")}" placeholder="Qual o melhor horário para você?"></div>
          <div class="field"><label>Opções (2 a 12)</label><div class="polls">${(s.pollOptions || [])
            .map((o, i) => `<div class="r"><input class="input" data-poll="${i}" value="${esc(o)}" placeholder="Opção ${i + 1}"><button class="ibtn danger" data-act="pollrm" data-i="${i}" ${(s.pollOptions || []).length <= 2 ? "disabled" : ""}>${icon("x", 14)}</button></div>`)
            .join("")}</div>${(s.pollOptions || []).length < 12 ? `<button class="btn sm" data-act="polladd" style="justify-self:start;margin-top:4px">${icon("plus", 13)} Opção</button>` : ""}</div>
          <div class="optsrow">${chk("pollMultiple", "Permitir mais de uma resposta")}</div>`;
    }
    return "";
  }

  function renderSteps() {
    const E = S.editor;
    const box = modalRoot.querySelector("#steps");
    if (!box) return;
    const n = E.item.steps.length;
    box.innerHTML = n ? E.item.steps.map((s, i) => stepHtml(s, i, n)).join("") : `<div class="emptybox" style="padding:28px">Adicione pelo menos uma mensagem abaixo.</div>`;
    modalRoot.querySelector("#stepCount").textContent = n;
    renderPreview();
  }

  async function ensureUrl(mediaId) {
    const E = S.editor;
    if (!E || E.urls.has(mediaId)) return;
    E.urls.set(mediaId, "");
    try {
      const blob = E.pending.get(mediaId) || (await Q.getMediaBlob(mediaId)).blob;
      if (S.editor !== E) return;
      E.urls.set(mediaId, URL.createObjectURL(blob));
      renderSteps();
    } catch {}
  }

  // ---- prévia
  function waFormat(text) {
    return esc(text)
      .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
      .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<i>$2</i>")
      .replace(/~([^~\n]+)~/g, "<s>$1</s>");
  }

  function renderPreview() {
    const E = S.editor;
    const thread = modalRoot.querySelector("#thread");
    if (!E || !thread) return;
    const now = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const tm = `<span class="tm">${now} ${icon("check", 13)}</span>`;
    const cap = (t) => (t ? `<div class="cap">${waFormat(Q.renderVars(t, SAMPLE))}</div>` : "");
    const ph = (s) => `<div class="ph">${icon(Q.stepIcon(s), 30)}</div>`;
    const stepDelay = S.data.settings.stepDelaySec;
    thread.innerHTML =
      E.item.steps
        .map((s, i) => {
          const gap = (i > 0 ? stepDelay : 0) + (Number(s.delaySec) || 0);
          const gapHtml = i > 0 || s.delaySec ? `<span class="gapmark">${icon("clock", 11)} ${String(gap).replace(".", ",")} s</span>` : "";
          let b = "";
          switch (s.type) {
            case "text":
              b = s.text?.trim() ? `<div class="bub">${waFormat(Q.renderVars(s.text, SAMPLE))}${tm}</div>` : "";
              break;
            case "image":
              b = `<div class="bub media ${s.caption ? "" : "nocap"}">${s.thumb ? `<img src="${esc(s.thumb)}" alt="">` : ph(s)}${cap(s.caption)}${tm}</div>`;
              break;
            case "video":
              b = s.ptv
                ? `<div class="bub round">${s.thumb ? `<img src="${esc(s.thumb)}" alt="">` : ph(s)}${tm}</div>`
                : `<div class="bub media ${s.caption ? "" : "nocap"}">${s.thumb ? `<img src="${esc(s.thumb)}" alt="">` : ph(s)}${cap(s.caption)}${tm}</div>`;
              break;
            case "sticker":
              b = `<div class="bub sticker">${s.thumb ? `<img src="${esc(s.thumb)}" alt="">` : ph(s)}${tm}</div>`;
              break;
            case "audio": {
              const peaks = s.peaks || Array.from({ length: 40 }, (_, k) => 25 + ((k * 37) % 60));
              const bars = peaks.filter((_, k) => k % Math.ceil(peaks.length / 40) === 0).map((p) => `<i style="height:${Math.max(10, p)}%"></i>`).join("");
              b = s.ptt
                ? `<div class="bub"><div class="voice"><div class="vav">${icon("contact", 20)}<i>${icon("mic", 12)}</i></div>${icon("play", 18)}<div class="vw">${bars}</div></div><span class="vd">${Q.formatDuration(s.duration)}</span>${tm}</div>`
                : `<div class="bub media"><div class="doc"><div class="fi" style="background:#f59e0b">${icon("music", 15)}</div><div><b>${esc(s.name || "áudio")}</b><small>${Q.formatDuration(s.duration)} · ${Q.formatBytes(s.size)}</small></div></div>${tm}</div>`;
              break;
            }
            case "document": {
              const ext = ((s.name || "").includes(".") ? s.name.split(".").pop() : "DOC").slice(0, 4).toUpperCase();
              b = `<div class="bub media"><div class="doc"><div class="fi">${esc(ext)}</div><div><b>${esc(s.name || "documento")}</b><small>${Q.formatBytes(s.size)}</small></div></div>${cap(s.caption)}${tm}</div>`;
              break;
            }
            case "location":
              b = `<div class="bub media"><div class="ph" style="height:110px">${icon("pin", 30)}</div>${cap([s.name, s.address].filter(Boolean).join("\n") || (s.lat ? `${s.lat}, ${s.lng}` : "Localização"))}${tm}</div>`;
              break;
            case "contact":
              b = `<div class="bub"><div style="display:flex;gap:10px;align-items:center;min-width:200px"><div class="phone" style="margin:0;border:0;box-shadow:none;flex:none"><div class="av" style="width:40px;height:40px">${icon("contact", 20)}</div></div><div><b>${esc(s.contactName || "Contato")}</b><div style="font-size:12px;opacity:.7">${esc(s.contactPhone || "")}</div></div></div>${tm}</div>`;
              break;
            case "poll":
              b = `<div class="bub poll"><b>${esc(Q.renderVars(s.pollName || "Enquete", SAMPLE))}</b><div style="font-size:11.5px;opacity:.65;margin:2px 0 4px">${s.pollMultiple ? "Selecione uma ou mais opções" : "Selecione uma opção"}</div>${(s.pollOptions || []).filter((o) => o.trim()).map((o) => `<div class="po ${s.pollMultiple ? "multi" : ""}"><i></i>${esc(o)}</div>`).join("")}${tm}</div>`;
              break;
          }
          return b ? gapHtml + b : "";
        })
        .join("") || `<p style="margin:auto;color:var(--wa-fg);opacity:.5;font-size:13px">A prévia aparece aqui.</p>`;
  }

  let pvTimer = null;
  const schedulePreview = () => {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(renderPreview, 120);
  };

  // ---- arquivos
  const MAX_BYTES = 100 * 1024 * 1024;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
      img.src = src;
    });
  }

  async function withObjectUrl(blob, fn) {
    const url = URL.createObjectURL(blob);
    try {
      return await fn(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function canvasThumb(source, sw, sh, max = 320, type = "image/jpeg", quality = 0.72) {
    const scale = Math.min(1, max / Math.max(sw, sh));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(sw * scale));
    c.height = Math.max(1, Math.round(sh * scale));
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL(type, quality);
  }

  async function imageInfo(file) {
    return withObjectUrl(file, async (url) => {
      const img = await loadImage(url);
      return { thumb: canvasThumb(img, img.naturalWidth, img.naturalHeight), width: img.naturalWidth, height: img.naturalHeight };
    });
  }

  async function videoInfo(file) {
    return withObjectUrl(file, (url) =>
      new Promise((resolve) => {
        const v = document.createElement("video");
        v.muted = true;
        v.preload = "auto";
        v.src = url;
        const done = (info) => {
          v.removeAttribute("src");
          v.load();
          resolve(info);
        };
        const timer = setTimeout(() => done({}), 8000);
        v.onloadedmetadata = () => {
          v.currentTime = Math.min(0.5, (v.duration || 1) / 3);
        };
        v.onseeked = () => {
          clearTimeout(timer);
          let thumb;
          try {
            thumb = canvasThumb(v, v.videoWidth, v.videoHeight);
          } catch {}
          done({ thumb, duration: v.duration, width: v.videoWidth, height: v.videoHeight });
        };
        v.onerror = () => {
          clearTimeout(timer);
          done({});
        };
      }),
    );
  }

  async function toSticker(file) {
    return withObjectUrl(file, async (url) => {
      const img = await loadImage(url);
      const c = document.createElement("canvas");
      c.width = c.height = 512;
      const scale = Math.min(512 / img.naturalWidth, 512 / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      c.getContext("2d").drawImage(img, (512 - w) / 2, (512 - h) / 2, w, h);
      const blob = await new Promise((r) => c.toBlob(r, "image/webp", 0.9));
      if (!blob) throw new Error("Falha ao gerar a figurinha.");
      return { blob, thumb: canvasThumb(c, 512, 512, 160, "image/webp", 0.8), width: 512, height: 512 };
    });
  }

  const baseName = (name) => (name || "arquivo").replace(/\.[^.]+$/, "");

  async function processFile(s, file) {
    if (file.size > MAX_BYTES) throw new Error(`Arquivo grande demais (${Q.formatBytes(file.size)}). O limite aqui é 100 MB.`);
    const out = { blob: file, name: file.name || "arquivo", thumb: undefined, duration: undefined, peaks: undefined, width: undefined, height: undefined };
    switch (s.type) {
      case "image":
        if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
        Object.assign(out, await imageInfo(file));
        break;
      case "sticker":
        if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
        Object.assign(out, await toSticker(file), { name: `${baseName(file.name)}.webp` });
        break;
      case "video":
        if (!file.type.startsWith("video/")) throw new Error("Escolha um arquivo de vídeo.");
        Object.assign(out, await videoInfo(file));
        if (file.size > 64 * 1024 * 1024) toast("Vídeos acima de 64 MB podem ser recusados pelo WhatsApp. Se falhar, envie como documento.");
        break;
      case "audio":
        if (s.ptt) {
          try {
            const r = await A.toOggOpus(file);
            Object.assign(out, { blob: r.blob, duration: r.duration, peaks: r.peaks, name: `${baseName(file.name)}.ogg` });
          } catch (e) {
            toast(`Não deu para converter para voz: ${e.message} O arquivo original será usado.`, "err");
            try {
              Object.assign(out, await A.analyze(file));
            } catch {}
          }
        } else {
          try {
            Object.assign(out, await A.analyze(file));
          } catch {}
        }
        break;
      case "document":
        break;
    }
    return out;
  }

  async function attach(stepId, file) {
    const E = S.editor;
    const s = E?.item.steps.find((x) => x.id === stepId);
    if (!s) return;
    E.busy.add(s.id);
    renderSteps();
    try {
      const r = await processFile(s, file);
      if (S.editor !== E) return;
      if (s.mediaId && E.pending.has(s.mediaId)) E.pending.delete(s.mediaId);
      const mediaId = Q.uid();
      E.pending.set(mediaId, r.blob);
      Object.assign(s, { mediaId, name: r.name, mime: r.blob.type || file.type || "application/octet-stream", size: r.blob.size, thumb: r.thumb, duration: r.duration, peaks: r.peaks, width: r.width, height: r.height });
      E.dirty = true;
      if (E.errStep === s.id) E.errStep = null;
    } catch (e) {
      toast(e.message, "err");
    } finally {
      E.busy.delete(s.id);
      if (S.editor === E) renderSteps();
    }
  }

  // converte um áudio já anexado quando "mensagem de voz" é ligada
  async function convertExistingToVoice(s) {
    const E = S.editor;
    if (!s.mediaId || /ogg|opus/i.test(s.mime || "")) return;
    const blob = E.pending.get(s.mediaId) || (await Q.getMediaBlob(s.mediaId)).blob;
    await attach(s.id, new File([blob], s.name || "audio", { type: s.mime || blob.type }));
  }

  const typeForFile = (f) => (f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : f.type.startsWith("audio/") ? "audio" : "document");

  function addFilesAsSteps(files) {
    const E = S.editor;
    for (const f of files) {
      const s = newStep(typeForFile(f));
      const last = E.item.steps.at(-1);
      // troca um texto vazio inicial pelo arquivo
      if (E.item.steps.length === 1 && last.type === "text" && !last.text?.trim()) E.item.steps = [];
      E.item.steps.push(s);
      attach(s.id, f);
    }
    E.dirty = true;
    renderSteps();
  }

  // ---- gravação
  async function startRec(s) {
    const E = S.editor;
    if (E.rec) return;
    E.rec = { stepId: s.id, start: Date.now(), levels: [], level: 0, handle: null, timer: null };
    renderSteps();
    try {
      E.rec.handle = await A.startRecording((l) => E.rec && (E.rec.level = l));
    } catch (e) {
      E.rec = null;
      renderSteps();
      return toast(`Não foi possível usar o microfone: ${e.name === "NotAllowedError" ? "permissão negada." : e.message}`, "err");
    }
    E.rec.start = Date.now();
    E.rec.timer = setInterval(() => {
      const r = E.rec;
      const box = modalRoot.querySelector("[data-rec]");
      if (!r || !box) return;
      r.levels.push(r.level);
      if (r.levels.length > 90) r.levels.shift();
      box.querySelector(".time").textContent = Q.formatDuration((Date.now() - r.start) / 1000);
      box.querySelector(".meter").innerHTML = r.levels.map((l) => `<i style="height:${Math.max(8, Math.min(100, l * 160))}%"></i>`).join("");
    }, 100);
  }

  async function stopRec(save) {
    const E = S.editor;
    const r = E?.rec;
    if (!r?.handle) return;
    clearInterval(r.timer);
    E.rec = null;
    if (!save) {
      r.handle.cancel();
      return renderSteps();
    }
    const blob = await r.handle.stop();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    await attach(r.stepId, new File([blob], `gravacao-${stamp}.webm`, { type: blob.type }));
  }

  // ---- salvar
  function validate(it) {
    const sc = it.shortcut;
    if (!it.title.trim()) return { msg: "Dê um título para a resposta.", field: "title" };
    if (sc && !/^[a-z0-9_-]+$/.test(sc)) return { msg: "O atalho só pode ter letras sem acento, números, - e _.", field: "shortcut" };
    if (sc && S.data.items.some((i) => i.id !== it.id && i.shortcut === sc)) return { msg: `O atalho /${sc} já é usado por outra resposta.`, field: "shortcut" };
    if (!it.steps.length) return { msg: "Adicione pelo menos uma mensagem." };
    for (const s of it.steps) {
      const bad = (msg) => ({ msg, step: s.id });
      if (s.type === "text" && !s.text?.trim()) return bad("Há uma mensagem de texto vazia.");
      if (STEP_TYPES[s.type].media && !s.mediaId) return bad(`Falta anexar o arquivo em “${STEP_TYPES[s.type].label}”.`);
      if (s.type === "location") {
        const lat = Number(String(s.lat).replace(",", "."));
        const lng = Number(String(s.lng).replace(",", "."));
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || s.lat === "" || s.lng === "") return bad("Informe latitude e longitude válidas.");
      }
      if (s.type === "contact" && (!s.contactName?.trim() || String(s.contactPhone || "").replace(/\D/g, "").length < 8)) return bad("O contato precisa de nome e telefone com DDI e DDD.");
      if (s.type === "poll" && (!s.pollName?.trim() || (s.pollOptions || []).filter((o) => o.trim()).length < 2)) return bad("A enquete precisa de pergunta e pelo menos 2 opções.");
    }
    return null;
  }

  async function saveEditor() {
    const E = S.editor;
    if (!E || E.saving) return;
    if (E.busy.size || E.rec) return toast("Aguarde o arquivo terminar de ser processado.");
    const it = E.item;
    it.title = it.title.trim();
    it.shortcut = it.shortcut.trim().replace(/^\/+/, "").toLowerCase();
    for (const s of it.steps) {
      if (s.type === "location") {
        s.lat = Number(String(s.lat).replace(",", "."));
        s.lng = Number(String(s.lng).replace(",", "."));
      }
      if (s.type === "text") s.linkPreview = !s.noLinkPreview;
      if (s.type === "poll") s.pollOptions = (s.pollOptions || []).map((o) => o.trim()).filter(Boolean);
    }
    const err = validate(it);
    const errEl = modalRoot.querySelector("#formErr");
    if (err) {
      errEl.textContent = err.msg;
      E.errStep = err.step || null;
      renderSteps();
      if (err.field) modalRoot.querySelector(`[data-f="${err.field}"]`)?.focus();
      if (err.step) modalRoot.querySelector(`[data-sid="${err.step}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    E.saving = true;
    const btn = modalRoot.querySelector('[data-act="save"]');
    btn.disabled = true;
    btn.innerHTML = `${icon("spinner", 15, 'class="spin"')} Salvando…`;
    try {
      const used = new Set(Q.mediaIdsOf(it));
      for (const [id, blob] of E.pending) {
        if (!used.has(id)) continue;
        const s = it.steps.find((x) => x.mediaId === id);
        await Q.putMedia(id, blob, { name: s.name, mime: s.mime || blob.type, duration: s.duration });
      }
      if (E.original) await Q.removeMedia(Q.mediaIdsOf(E.original).filter((id) => !used.has(id)));
      it.updatedAt = Date.now();
      const idx = S.data.items.findIndex((x) => x.id === it.id);
      if (idx >= 0) S.data.items[idx] = it;
      else S.data.items.push(it);
      await persist();
      closeEditor(true);
      render();
      toast(`“${it.title}” salva. Já aparece no WhatsApp Web.`, "ok");
    } catch (e) {
      E.saving = false;
      btn.disabled = false;
      btn.innerHTML = `${icon("check", 15)} Salvar`;
      toast(`Falha ao salvar: ${e.message}`, "err");
    }
  }

  // ---- eventos do editor
  const stepOf = (el) => {
    const sid = el.closest("[data-sid]")?.dataset.sid;
    return sid && S.editor?.item.steps.find((s) => s.id === sid);
  };

  function insertAtCursor(el, text) {
    const { selectionStart: a, selectionEnd: b, value } = el;
    el.value = value.slice(0, a) + text + value.slice(b);
    el.selectionStart = el.selectionEnd = a + text.length;
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function wrapSelection(el, mark) {
    const { selectionStart: a, selectionEnd: b, value } = el;
    const sel = value.slice(a, b) || "texto";
    el.value = value.slice(0, a) + mark + sel + mark + value.slice(b);
    el.selectionStart = a + 1;
    el.selectionEnd = a + 1 + sel.length;
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  modalRoot.addEventListener("click", async (e) => {
    const E = S.editor;
    if (!E) return;
    if (e.target.matches("[data-overlay]")) return closeEditor();
    const t = e.target.closest("[data-act],[data-add],[data-emoji],[data-var],[data-fmt]");
    if (!t) {
      if (E.emoji && !e.target.closest(".emojis")) {
        E.emoji = false;
        modalRoot.querySelector(".emojis")?.remove();
      }
      return;
    }
    const s = stepOf(t);
    const steps = E.item.steps;
    if (t.dataset.add) {
      const ns = newStep(t.dataset.add);
      steps.push(ns);
      E.dirty = true;
      renderSteps();
      const el = modalRoot.querySelector(`[data-sid="${ns.id}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (STEP_TYPES[ns.type].media && ns.type !== "audio") el?.querySelector("[data-file]")?.click();
      else el?.querySelector("textarea,input:not([type=number])")?.focus();
      return;
    }
    if (t.dataset.emoji !== undefined) {
      E.item.emoji = t.dataset.emoji;
      E.emoji = false;
      E.dirty = true;
      modalRoot.querySelector(".emojibtn").innerHTML = E.item.emoji || icon("plus", 20);
      modalRoot.querySelector(".emojis")?.remove();
      return renderPreview();
    }
    if (t.dataset.var || t.dataset.fmt) {
      const ta = t.closest(".field, .sbody")?.querySelector("textarea");
      if (!ta) return;
      return t.dataset.var ? insertAtCursor(ta, `{{${t.dataset.var}}}`) : wrapSelection(ta, t.dataset.fmt);
    }
    switch (t.dataset.act) {
      case "close":
        return closeEditor();
      case "save":
        return saveEditor();
      case "delete":
        if (!confirm(`Excluir a resposta “${E.original.title}”?`)) return;
        S.data.items = S.data.items.filter((i) => i.id !== E.original.id);
        await Q.removeMedia(Q.mediaIdsOf(E.original));
        await persist();
        closeEditor(true);
        render();
        return toast("Resposta excluída.");
      case "emoji":
        E.emoji = !E.emoji;
        return renderEditorKeepingScroll();
      case "up":
      case "down": {
        const i = steps.indexOf(s);
        const j = t.dataset.act === "up" ? i - 1 : i + 1;
        [steps[i], steps[j]] = [steps[j], steps[i]];
        E.dirty = true;
        return renderSteps();
      }
      case "dupstep": {
        const copy = { ...structuredClone(s), id: Q.uid() };
        if (copy.mediaId) {
          // o mesmo arquivo é gravado de novo com outro id
          const blob = E.pending.get(s.mediaId) || (await Q.getMediaBlob(s.mediaId)).blob;
          copy.mediaId = Q.uid();
          E.pending.set(copy.mediaId, blob);
        }
        steps.splice(steps.indexOf(s) + 1, 0, copy);
        E.dirty = true;
        return renderSteps();
      }
      case "rmstep":
        if (s.mediaId && E.pending.has(s.mediaId)) E.pending.delete(s.mediaId);
        E.item.steps = steps.filter((x) => x !== s);
        E.dirty = true;
        return renderSteps();
      case "pick":
        return t.closest(".sbody").querySelector("[data-file]")?.click();
      case "unmedia":
        if (E.pending.has(s.mediaId)) E.pending.delete(s.mediaId);
        for (const k of ["mediaId", "name", "mime", "size", "thumb", "duration", "peaks", "width", "height"]) delete s[k];
        E.dirty = true;
        return renderSteps();
      case "rec":
        return startRec(s);
      case "recStop":
        return stopRec(true);
      case "recCancel":
        return stopRec(false);
      case "polladd":
        s.pollOptions.push("");
        renderSteps();
        return modalRoot.querySelector(`[data-sid="${s.id}"] [data-poll="${s.pollOptions.length - 1}"]`)?.focus();
      case "pollrm":
        s.pollOptions.splice(Number(t.dataset.i), 1);
        E.dirty = true;
        return renderSteps();
    }
  });

  function renderEditorKeepingScroll() {
    const top = modalRoot.querySelector("#form")?.scrollTop || 0;
    renderEditor();
    modalRoot.querySelector("#form").scrollTop = top;
  }

  function parseMapsLink(text) {
    const m = text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) || text.match(/[?&](?:q|query|ll|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/) || text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) || text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const place = text.match(/\/place\/([^/@]+)/)?.[1];
    return { lat: m[1], lng: m[2], name: place ? decodeURIComponent(place.replace(/\+/g, " ")) : "" };
  }

  modalRoot.addEventListener("input", (e) => {
    const E = S.editor;
    if (!E) return;
    const t = e.target;
    if (t.dataset.f && t.type !== "checkbox" && t.tagName !== "SELECT") {
      E.item[t.dataset.f] = t.dataset.f === "shortcut" ? t.value.replace(/^\/+/, "").toLowerCase().replace(/\s+/g, "-") : t.value;
      if (t.dataset.f === "shortcut" && t.value !== E.item.shortcut) t.value = E.item.shortcut;
      E.dirty = true;
      modalRoot.querySelector("#formErr").textContent = "";
      return;
    }
    const s = stepOf(t);
    if (!s) return;
    if (t.dataset.maps !== undefined) {
      const loc = parseMapsLink(t.value);
      if (!loc) return;
      Object.assign(s, { lat: loc.lat, lng: loc.lng, url: t.value.trim() }, loc.name && !s.name ? { name: loc.name } : {});
      E.dirty = true;
      renderSteps();
      return toast("Coordenadas preenchidas pelo link.", "ok");
    }
    if (t.dataset.poll !== undefined) s.pollOptions[Number(t.dataset.poll)] = t.value;
    else if (t.dataset.s && t.type !== "checkbox") s[t.dataset.s] = t.dataset.s === "delaySec" ? Math.max(0, Number(t.value) || 0) : t.value;
    if (t.dataset.s === "text") {
      const c = t.closest(".sbody").querySelector("[data-count]");
      if (c) c.textContent = `${t.value.length} caracteres`;
    }
    E.dirty = true;
    schedulePreview();
  });

  modalRoot.addEventListener("change", async (e) => {
    const E = S.editor;
    if (!E) return;
    const t = e.target;
    if (t.dataset.f === "favorite") {
      E.item.favorite = t.checked;
      E.dirty = true;
      return;
    }
    if (t.dataset.f === "categoryId") {
      if (t.value === "__new") {
        const c = addCategory(prompt("Nome da nova categoria:") || "");
        if (c) {
          E.item.categoryId = c.id;
          await persist();
        }
        return renderEditorKeepingScroll();
      }
      E.item.categoryId = t.value;
      E.dirty = true;
      return;
    }
    const s = stepOf(t);
    if (!s) return;
    if (t.dataset.file !== undefined && t.files[0]) {
      attach(s.id, t.files[0]);
      t.value = "";
      return;
    }
    if (t.type === "checkbox" && t.dataset.s) {
      s[t.dataset.s] = t.checked;
      if (t.dataset.s === "ptv" && t.checked) Object.assign(s, { gif: false, viewOnce: false });
      if (t.dataset.s === "ptt" && !t.checked) s.viewOnce = false;
      E.dirty = true;
      renderSteps();
      if (t.dataset.s === "ptt" && t.checked) {
        try {
          await convertExistingToVoice(s);
        } catch (err) {
          toast(err.message, "err");
        }
      }
    }
  });

  // arrastar arquivos para o editor
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  modalRoot.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    dragDepth++;
    modalRoot.querySelector(".overlay")?.classList.add("filedrag");
  });
  modalRoot.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) {
      dragDepth = 0;
      modalRoot.querySelector(".overlay")?.classList.remove("filedrag");
    }
  });
  modalRoot.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    modalRoot.querySelectorAll(".drop.over").forEach((d) => d.classList.remove("over"));
    e.target.closest?.(".drop")?.classList.add("over");
  });
  modalRoot.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    modalRoot.querySelector(".overlay")?.classList.remove("filedrag");
    const files = [...e.dataTransfer.files];
    const s = stepOf(e.target);
    if (s && STEP_TYPES[s.type].media && files.length === 1) return attach(s.id, files[0]);
    addFilesAsSteps(files);
  });
  modalRoot.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!S.editor || !files.length) return;
    e.preventDefault();
    addFilesAsSteps(files);
  });

  document.addEventListener("keydown", (e) => {
    if (!S.editor) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveEditor();
    } else if (e.key === "Escape") {
      if (S.editor.emoji) {
        S.editor.emoji = false;
        modalRoot.querySelector(".emojis")?.remove();
      } else if (!S.editor.rec) closeEditor();
    }
  });

  // ----------------------------------------------------------------- início
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (Q.STATS_KEY in changes) {
      S.stats = changes[Q.STATS_KEY].newValue || {};
      if (!S.editor && S.tab === "items") render();
    }
    if (Q.KEY in changes) {
      const nv = changes[Q.KEY].newValue;
      if (!nv || JSON.stringify(nv) === S.lastWrite) return;
      S.data = Q.normalize(nv);
      if (!S.editor) render();
    }
  });

  (async () => {
    S.data = await Q.load();
    S.stats = await Q.loadStats();
    render();
    const edit = params.get("edit");
    const item = edit && S.data.items.find((i) => i.id === edit);
    if (item) openEditor(item);
    else if (params.has("new")) openEditor(null);
  })();
})();
