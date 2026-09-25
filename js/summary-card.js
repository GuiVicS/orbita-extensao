// Cartão "Resumo do WhatsApp" na Visão geral do painel (patch 14 põe um <div>
// e chama OrbitaSummaryCard.mount). Mostra o último resumo e o botão que abre
// a página #/resumo já gerando.
(() => {
  "use strict";
  if (globalThis.OrbitaSummaryCard) return;
  const CSS = `
    .osc { margin-top: 24px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 18px 20px; border-radius: 1rem; border: 1px solid var(--border); background: var(--card); box-shadow: 0 1px 3px hsl(var(--shadow-color) / .08); }
    .osc-ic { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, var(--orbit-from), var(--orbit-to)); flex: none; }
    .osc-t { flex: 1; min-width: 220px; display: grid; gap: 2px; }
    .osc-t b { font-size: 15px; }
    .osc-t span { font-size: 13px; color: var(--muted-foreground); }
    .osc-t em { font-style: normal; color: var(--destructive); font-weight: 600; }
    .osc button { height: 38px; padding: 0 18px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--foreground); font: inherit; font-weight: 600; cursor: pointer; }
    .osc button.go { border: 0; color: #fff; background: linear-gradient(135deg, var(--orbit-from), var(--orbit-to)); box-shadow: 0 4px 14px color-mix(in oklch, var(--orbit-from) 30%, transparent); }
  `;
  const ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>';

  async function paint(el) {
    const r = await chrome.storage.local.get(["orbita:summary:history", "orbita:summary:resolved"]);
    const last = (r["orbita:summary:history"] || [])[0];
    const resolved = r["orbita:summary:resolved"] || {};
    const open = last ? last.merged.pending.filter((i) => !resolved[`${i.type}:${i.sources[0]?.id}`]).length : 0;
    const dated = last ? last.merged.dated.filter((i) => !resolved[`${i.type}:${i.sources[0]?.id}`]).length : 0;
    el.innerHTML = `<div class="osc"><div class="osc-ic">${ICON}</div>
      <div class="osc-t"><b>Resumo do WhatsApp</b><span>${last ? `Último: ${new Date(last.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · ${open ? `<em>${open} ${open === 1 ? "pessoa esperando" : "pessoas esperando"} resposta</em>` : "ninguém esperando resposta"}${dated ? ` · ${dated} compromisso${dated > 1 ? "s" : ""}` : ""}` : "Perguntas para você, compromissos e avisos dos grupos, organizados — com a fonte de cada item."}</span></div>
      ${last ? `<button type="button" data-go="ver">Ver último</button>` : ""}<button type="button" class="go" data-go="gerar">Gerar resumo</button></div>`;
  }

  function mount(el) {
    if (!el || el.__osc) return;
    el.__osc = true;
    if (!document.getElementById("orbita-osc-css")) {
      const s = document.createElement("style");
      s.id = "orbita-osc-css";
      s.textContent = CSS;
      document.head.append(s);
    }
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-go]");
      if (b) location.hash = b.dataset.go === "gerar" ? "#/resumo?gerar=1" : "#/resumo";
    });
    chrome.storage.onChanged.addListener((ch, area) => area === "local" && (ch["orbita:summary:history"] || ch["orbita:summary:resolved"]) && el.isConnected && paint(el));
    paint(el);
  }
  globalThis.OrbitaSummaryCard = { mount };
})();
