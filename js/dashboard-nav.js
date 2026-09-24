// Menu lateral recolhível do painel. O menu é React minificado (dashboard.js);
// em vez de alterá-lo, este script acrescenta um botão e alterna a classe
// "orbita-nav-collapsed" no <html>. O CSS abaixo encolhe o menu para os ícones.
// A preferência fica no localStorage (só neste navegador). Atalho: Ctrl+B.
(() => {
  "use strict";
  const KEY = "orbita-nav-collapsed";
  const CLS = "orbita-nav-collapsed";
  const root = document.documentElement;

  const css = `
    aside { transition: width .2s ease; z-index: 45; }
    .orbita-nav-toggle { position: absolute; top: 28px; right: -13px; z-index: 40; width: 26px; height: 26px; border-radius: 999px;
      display: grid; place-items: center; cursor: pointer; border: 1px solid var(--sidebar-border); background: var(--sidebar);
      color: var(--sidebar-foreground); box-shadow: 0 2px 8px hsl(var(--shadow-color) / .35); transition: transform .2s, background .15s; }
    .orbita-nav-toggle:hover { background: var(--sidebar-accent); }
    .orbita-nav-toggle svg { transition: transform .2s; }
    html.${CLS} .orbita-nav-toggle svg { transform: rotate(180deg); }
    html.${CLS} aside { width: 4.5rem !important; }
    html.${CLS} aside .starfield { width: 4.5rem; }
    html.${CLS} aside > div.relative.px-5 { padding-left: 0; padding-right: 0; display: flex; justify-content: center; }
    html.${CLS} aside > div.relative.px-5 .leading-none { display: none; }
    html.${CLS} aside nav { padding-left: .75rem; padding-right: .75rem; }
    html.${CLS} aside nav button { font-size: 0; gap: 0; justify-content: center; padding-left: 0; padding-right: 0; }
    html.${CLS} aside nav button > span { display: none; }
    html.${CLS} aside nav button svg { width: 1.15rem; height: 1.15rem; }
    html.${CLS} aside > div.mt-auto { display: none; }
  `;

  function read() {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  }

  function apply(collapsed) {
    root.classList.toggle(CLS, collapsed);
    const btn = document.querySelector(".orbita-nav-toggle");
    if (btn) {
      btn.title = collapsed ? "Expandir menu (Ctrl+B)" : "Recolher menu (Ctrl+B)";
      btn.setAttribute("aria-label", btn.title);
      btn.setAttribute("aria-expanded", String(!collapsed));
    }
  }

  function toggle() {
    const next = !root.classList.contains(CLS);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {}
    apply(next);
  }

  // o nome da página vira dica ao passar o mouse quando o menu está recolhido
  function labelButtons(aside) {
    aside.querySelectorAll("nav button").forEach((b) => {
      const label = b.textContent.trim();
      if (label && b.title !== label) {
        b.title = label;
        b.setAttribute("aria-label", label);
      }
    });
  }

  // o React pode recriar o <aside>: garante o botão sempre que ele mudar
  function ensure() {
    const aside = document.querySelector("#root aside");
    if (!aside) return;
    labelButtons(aside);
    if (aside.querySelector(":scope > .orbita-nav-toggle")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "orbita-nav-toggle";
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
    btn.addEventListener("click", toggle);
    aside.append(btn);
    apply(root.classList.contains(CLS));
  }

  root.classList.toggle(CLS, read()); // antes da 1ª pintura, sem "piscar"
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);

  addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
      e.preventDefault();
      toggle();
    }
  });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      ensure();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
