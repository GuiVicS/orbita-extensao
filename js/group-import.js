// Contatos → Importar → "Do WhatsApp" → Grupos.
//
// O diálogo de importação é React minificado (dashboard.js); o patch
// 12-importar-grupos.json põe um <div> no topo da aba "Do WhatsApp" e chama
// OrbitaGroupImport.mount(div). Aqui ficam: a escolha "Agenda e conversas" |
// "Grupos" (no modo Grupos o conteúdo original da aba some), a lista de grupos
// para marcar e a importação — uma lista por grupo ou tudo numa lista só,
// só com os participantes (sem você e sem números ocultos).
// Usa as operações de grupo das Conversas (service worker) e js/group-lists.js.
(() => {
  "use strict";
  if (globalThis.OrbitaGroupImport) return;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const nf = new Intl.NumberFormat("pt-BR");
  const call = async (op, extra = {}) => {
    const r = await chrome.runtime.sendMessage({ channel: "orbita:chat", op, ...extra });
    if (!r) throw new Error("A extensão não respondeu. Recarregue a página.");
    if (!r.ok) throw new Error(/Abra o WhatsApp|carregando/i.test(r.error) ? "Abra o WhatsApp Web em uma aba do Chrome e aguarde ele carregar para ver os seus grupos." : r.error);
    return r.data;
  };
  const USERS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';

  const CSS = `
    .ogi { display: grid; gap: 12px; margin-bottom: 12px; font-size: 14px; }
    .ogi-seg { display: flex; gap: 4px; padding: 4px; border-radius: 12px; background: color-mix(in oklch, var(--muted) 80%, transparent); }
    .ogi-seg button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; border: 0; border-radius: 9px; background: none; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600; color: var(--muted-foreground); }
    .ogi-seg button[aria-pressed="true"] { background: var(--card); color: var(--foreground); box-shadow: 0 1px 3px hsl(var(--shadow-color) / .15); }
    .ogi-panel { display: grid; gap: 10px; }
    .ogi-panel[hidden] { display: none; }
    .ogi-empty { display: grid; justify-items: center; gap: 8px; text-align: center; padding: 28px 16px; border: 2px dashed var(--border); border-radius: 16px; }
    .ogi-empty b { font-size: 14px; }
    .ogi-empty p { margin: 0; max-width: 420px; font-size: 12px; color: var(--muted-foreground); }
    .ogi-btn { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border-radius: 10px; border: 0; cursor: pointer; font: inherit; font-size: 13.5px; font-weight: 600; color: #fff; background: linear-gradient(135deg, var(--orbit-from), var(--orbit-to)); }
    .ogi-btn:disabled { opacity: .55; cursor: default; }
    .ogi-btn.ghost { color: var(--foreground); background: var(--card); border: 1px solid var(--border); }
    .ogi-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .ogi-bar input[type=search] { flex: 1; min-width: 160px; height: 34px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--input); background: var(--background); color: inherit; font: inherit; font-size: 13px; outline: 0; }
    .ogi-bar input[type=search]:focus { border-color: var(--ring); }
    .ogi-all { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; white-space: nowrap; }
    .ogi-list { max-height: 260px; overflow-y: auto; border: 1px solid var(--border); border-radius: 12px; }
    .ogi-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; border-top: 1px solid var(--border); }
    .ogi-row:first-child { border-top: 0; }
    .ogi-row:hover { background: color-mix(in oklch, var(--muted) 60%, transparent); }
    .ogi-row b { flex: 1; font-weight: 600; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ogi-row small, .ogi-note { color: var(--muted-foreground); font-size: 12px; }
    .ogi-av { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: #fff; flex: none; background: linear-gradient(135deg, var(--orbit-from), var(--orbit-to)); }
    .ogi input[type=checkbox], .ogi input[type=radio] { width: 16px; height: 16px; accent-color: var(--primary); }
    .ogi-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ogi-mode { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; font-size: 13px; }
    .ogi-mode:has(input:checked) { border-color: color-mix(in oklch, var(--primary) 50%, transparent); background: color-mix(in oklch, var(--primary) 6%, transparent); }
    .ogi-mode span { display: grid; gap: 2px; }
    .ogi-mode small { color: var(--muted-foreground); font-size: 12px; }
    .ogi-name { height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--input); background: var(--background); color: inherit; font: inherit; font-size: 13.5px; outline: 0; }
    .ogi-name[hidden] { display: none; }
    .ogi-done { display: grid; gap: 6px; padding: 14px; border-radius: 12px; background: color-mix(in oklch, var(--success) 10%, transparent); border: 1px solid color-mix(in oklch, var(--success) 35%, transparent); font-size: 13px; }
    .ogi-done b { color: var(--success); }
    .ogi-err { color: var(--destructive); font-size: 13px; }
    :has(> .ogi-host[data-mode="groups"]) > :not(.ogi-host) { display: none !important; }
    @media (max-width: 560px) { .ogi-modes { grid-template-columns: 1fr; } }
  `;

  function ensureCss() {
    if (document.getElementById("orbita-ogi-css")) return;
    const s = document.createElement("style");
    s.id = "orbita-ogi-css";
    s.textContent = CSS;
    document.head.append(s);
  }

  function mount(el) {
    if (!el || el.__ogi) return;
    ensureCss();
    el.classList.add("ogi-host");
    const st = { mode: "wa", groups: null, loading: false, error: "", q: "", picked: new Set(), merge: false, name: "Grupos do WhatsApp", busy: "", result: null };
    el.__ogi = st;

    // no modo Grupos, o resto da aba "Do WhatsApp" some (CSS :has, sem mexer no React)
    function setMode(mode) {
      st.mode = mode;
      el.dataset.mode = mode;
      if (mode === "groups" && !st.groups && !st.loading) load();
      render();
    }

    async function load() {
      st.loading = true;
      st.error = "";
      render();
      // o WhatsApp Web pode estar terminando de carregar: tenta algumas vezes antes de desistir
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          st.groups = await call("group.list");
          st.error = "";
          break;
        } catch (e) {
          st.error = e.message;
          if (!/Abra o WhatsApp|carregar/i.test(e.message) || st.mode !== "groups") break;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      st.loading = false;
      render();
    }

    async function run() {
      const ids = [...st.picked];
      if (!ids.length) return;
      const G = globalThis.OrbitaGroupLists;
      st.result = null;
      st.error = "";
      const infos = [];
      try {
        for (const [i, id] of ids.entries()) {
          st.busy = `Lendo participantes: ${i + 1} de ${ids.length}…`;
          render();
          infos.push(await call("group.info", { chatId: id }));
        }
        // números ocultos: um por um, como quem clica em cada contato
        await G.resolveHidden(infos, { onProgress: ({ done, total }) => total && ((st.busy = `Buscando números ocultos: ${done} de ${total}…`), render()) });
        st.busy = "Criando as listas…";
        render();
        const results = st.merge ? [await G.saveMerged(infos, { name: st.name })] : [];
        if (!st.merge) for (const info of infos) results.push(await G.save(info));
        st.result = {
          lists: results.length,
          added: results.reduce((a, r) => a + r.added, 0),
          hidden: results.reduce((a, r) => a + r.hidden, 0),
          names: results.map((r) => r.name),
        };
      } catch (e) {
        st.error = e.message;
      }
      st.busy = "";
      render();
    }

    function render() {
      const seg = `<div class="ogi-seg" role="group" aria-label="De onde importar">
        <button type="button" data-m="wa" aria-pressed="${st.mode === "wa"}">Agenda e conversas</button>
        <button type="button" data-m="groups" aria-pressed="${st.mode === "groups"}">${USERS} Grupos</button></div>`;
      let body = "";
      if (st.mode === "groups") {
        if (st.loading) body = `<div class="ogi-empty"><b>Buscando os seus grupos…</b><p>Lendo os grupos que o WhatsApp Web já carregou neste navegador.</p></div>`;
        else if (st.error && !st.groups) body = `<div class="ogi-empty"><b>Não foi possível ler os grupos</b><p>${esc(st.error)}</p><button type="button" class="ogi-btn" data-a="load">Tentar de novo</button></div>`;
        else if (st.groups && !st.groups.length) body = `<div class="ogi-empty"><b>Nenhum grupo nesta conta</b><p>Os grupos aparecem aqui quando o WhatsApp Web estiver aberto e conectado.</p><button type="button" class="ogi-btn ghost" data-a="load">Buscar de novo</button></div>`;
        else if (st.groups) {
          const q = st.q.trim().toLowerCase();
          const list = st.groups.filter((g) => !q || (g.name || "").toLowerCase().includes(q));
          const total = st.groups.filter((g) => st.picked.has(g.chatId)).reduce((a, g) => a + (g.participantsCount || 0), 0);
          const n = st.picked.size;
          body = `<div class="ogi-bar"><input type="search" data-a="q" placeholder="Buscar grupo" value="${esc(st.q)}" aria-label="Buscar grupo">
              <label class="ogi-all"><input type="checkbox" data-a="all" ${list.length && list.every((g) => st.picked.has(g.chatId)) ? "checked" : ""}> Marcar todos</label>
              <button type="button" class="ogi-btn ghost" data-a="load" title="Buscar de novo">↻</button></div>
            <div class="ogi-list" role="list">${list.map((g) => `<label class="ogi-row" role="listitem"><input type="checkbox" data-g="${esc(g.chatId)}" ${st.picked.has(g.chatId) ? "checked" : ""}><span class="ogi-av">${USERS}</span><b>${esc(g.name || "Grupo sem nome")}</b><small>${g.participantsCount ? `${nf.format(g.participantsCount)} participantes` : ""}</small></label>`).join("") || `<div class="ogi-row"><small>Nenhum grupo com esse nome.</small></div>`}</div>
            <div class="ogi-modes">
              <label class="ogi-mode"><input type="radio" name="ogi-merge" data-a="sep" ${st.merge ? "" : "checked"}><span><b>Uma lista para cada grupo</b><small>“Grupo: nome”. Se já existir, entram só os novos participantes.</small></span></label>
              <label class="ogi-mode"><input type="radio" name="ogi-merge" data-a="merge" ${st.merge ? "checked" : ""}><span><b>Tudo numa lista só</b><small>Uma lista nova com todos, sem números repetidos.</small></span></label>
            </div>
            <input class="ogi-name" data-a="name" value="${esc(st.name)}" aria-label="Nome da lista" ${st.merge ? "" : "hidden"}>
            <p class="ogi-note">Entram só os participantes dos grupos marcados, com as variáveis {{grupo}} e {{admin}}. O seu número fica de fora. Para quem aparece com o número oculto, a Órbita consulta o WhatsApp contato por contato; quem esconde o número pela privacidade continua de fora.</p>
            ${st.error ? `<p class="ogi-err">${esc(st.error)}</p>` : ""}
            ${st.result ? `<div class="ogi-done"><b>${st.result.lists === 1 ? `Lista “${esc(st.result.names[0])}” pronta` : `${st.result.lists} listas prontas`}</b><span>${nf.format(st.result.added)} ${st.result.added === 1 ? "contato novo" : "contatos novos"}${st.result.hidden ? ` · ${nf.format(st.result.hidden)} com número oculto ficaram de fora` : ""}. Elas já aparecem em Contatos.</span></div>` : ""}
            <div class="ogi-bar"><button type="button" class="ogi-btn" data-a="go" ${n && !st.busy ? "" : "disabled"}>${st.busy ? esc(st.busy) : n ? `Importar ${n} ${n === 1 ? "grupo" : "grupos"}${total ? ` (~${nf.format(total)} participantes)` : ""}` : "Marque os grupos"}</button></div>`;
        }
      }
      el.innerHTML = `<div class="ogi">${seg}<div class="ogi-panel" ${st.mode === "groups" ? "" : "hidden"}>${body}</div></div>`;
    }

    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-m],[data-a]");
      if (!b) return;
      if (b.dataset.m) return setMode(b.dataset.m);
      if (b.dataset.a === "load") return load();
      if (b.dataset.a === "go") return run();
    });
    el.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.g) t.checked ? st.picked.add(t.dataset.g) : st.picked.delete(t.dataset.g);
      else if (t.dataset.a === "all") {
        const q = st.q.trim().toLowerCase();
        for (const g of st.groups || []) if (!q || (g.name || "").toLowerCase().includes(q)) t.checked ? st.picked.add(g.chatId) : st.picked.delete(g.chatId);
      } else if (t.dataset.a === "sep" || t.dataset.a === "merge") st.merge = t.dataset.a === "merge";
      else return;
      st.result = null;
      render();
    });
    el.addEventListener("input", (e) => {
      if (e.target.dataset.a === "name") st.name = e.target.value;
      if (e.target.dataset.a !== "q") return;
      st.q = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const inp = el.querySelector('[data-a="q"]');
      inp.focus();
      inp.setSelectionRange(pos, pos);
    });
    render();
  }

  globalThis.OrbitaGroupImport = { mount };
})();
