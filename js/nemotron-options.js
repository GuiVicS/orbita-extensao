// Opções → "Nemotron (NVIDIA)": o modelo usado pelo Resumo do WhatsApp, pelo
// OpenRouter (grátis: nvidia/nemotron-3-ultra-550b-a55b:free) ou pelo OpenCode
// Zen. As chaves vão para orbita:ai.keys[provedor] — as mesmas usadas quando
// esse provedor é o principal (Variações com IA). A escolha do Resumo fica em
// orbita:summary:ai { engine: "nemotron" | "default", provider, model }.
// Atenção: o plano gratuito do OpenCode só funciona dentro do app OpenCode
// (a API responde 403 "FreeTierError"); por isso o OpenRouter é o padrão.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  if (!$("nemotronSec")) return;
  const AI = "orbita:ai";
  const SUM = "orbita:summary:ai";
  const P = {
    openrouter: {
      base: "https://openrouter.ai/api/v1",
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
      models: ["nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3-super-120b-a12b:free", "nvidia/nemotron-3.5-lightning:free", "nvidia/nemotron-3-ultra-550b-a55b"],
      key: "Chave da API do OpenRouter",
      placeholder: "sk-or-…",
      help: 'Crie uma conta e uma chave em <a href="https://openrouter.ai/keys" target=_blank rel=noopener>openrouter.ai/keys</a>. O modelo com “:free” é gratuito (com limite diário de pedidos).',
    },
    opencode: {
      base: "https://opencode.ai/zen/v1",
      model: "nemotron-3-ultra-free",
      models: ["nemotron-3-ultra-free", "nemotron-3.5-lightning-free"],
      key: "Chave da API do OpenCode",
      placeholder: "oc_sk_…",
      help: 'Chave em <a href="https://opencode.ai/auth" target=_blank rel=noopener>opencode.ai/auth</a>. <b>Os modelos gratuitos do OpenCode só funcionam dentro do app OpenCode</b> — fora dele a API recusa (403). Aqui só funcionam com créditos pagos.',
    },
  };
  let ai = {};
  let sum = {};
  const status = (text, ok = true) => (($("nmStatus").textContent = text), ($("nmStatus").className = `status ${ok === null ? "" : ok ? "ok" : "err"}`));
  const prov = () => P[$("nmProvider").value] || P.openrouter;

  function paint(keepModel = false) {
    const p = prov();
    const id = $("nmProvider").value;
    $("nmHelp").innerHTML = p.help;
    $("nmKeyLabel").textContent = p.key;
    $("nmKey").placeholder = p.placeholder;
    $("nmKey").value = ai.keys?.[id] || "";
    $("nmModels").innerHTML = p.models.map((m) => `<option value="${m}">`).join("");
    if (!keepModel) $("nmModel").value = (sum.provider === id && sum.model) || p.model;
  }

  async function load() {
    const r = await chrome.storage.local.get([AI, SUM]);
    ai = r[AI] || {};
    sum = r[SUM] || {};
    $("nmProvider").value = sum.provider || (sum.engine === "opencode" ? "opencode" : "openrouter");
    $("nmSummary").checked = sum.engine === "nemotron" || sum.engine === "opencode";
    paint();
  }

  $("nmProvider").addEventListener("change", () => paint());
  $("nmToggle").addEventListener("click", () => {
    const show = $("nmKey").type === "password";
    $("nmKey").type = show ? "text" : "password";
    $("nmToggle").textContent = show ? "Ocultar" : "Mostrar";
  });

  // Testar: uma pergunta mínima ao modelo; mostra o motivo real se o provedor recusar
  $("nmTest").addEventListener("click", async () => {
    const key = $("nmKey").value.trim();
    const model = $("nmModel").value.trim() || prov().model;
    if (!key) return status("Cole a chave.", false);
    status("Testando…", null);
    try {
      const r = await fetch(`${prov().base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: "user", content: "Responda só: ok" }] }) });
      const text = await r.text().catch(() => "");
      let msg = "";
      try {
        const j = JSON.parse(text);
        msg = String(j?.error?.message || j?.message || "");
      } catch {}
      if (r.ok) return status(`Funcionando — o modelo ${model} respondeu.`);
      if (/free tier can only be used from within OpenCode/i.test(text)) return status("O plano gratuito do OpenCode só funciona dentro do app OpenCode. Use o OpenRouter (grátis) ou créditos pagos do OpenCode.", false);
      if (r.status === 401) return status("Chave inválida.", false);
      if (r.status === 429) return status(`Limite de uso atingido agora${msg ? ` (${msg})` : ""}. A chave parece válida; tente de novo mais tarde.`, false);
      status(`Recusado (HTTP ${r.status})${msg ? `: ${msg}` : "."}`, false);
    } catch {
      status("Sem conexão com o provedor.", false);
    }
  });

  $("nmSave").addEventListener("click", async () => {
    const id = $("nmProvider").value;
    const key = $("nmKey").value.trim();
    const model = $("nmModel").value.trim() || prov().model;
    const r = await chrome.storage.local.get([AI, SUM]);
    const cur = r[AI] || {};
    ai = { ...cur, keys: { ...(cur.keys || {}), [id]: key } };
    sum = { ...(r[SUM] || {}), engine: $("nmSummary").checked ? "nemotron" : "default", provider: id, model };
    await chrome.storage.local.set({ [AI]: ai, [SUM]: sum });
    status(key ? `Salvo.${$("nmSummary").checked ? " O Resumo vai usar o Nemotron." : ""}` : "Salvo, mas falta a chave.", Boolean(key));
  });

  chrome.storage.onChanged.addListener((ch, area) => area === "local" && (ch[SUM] || ch[AI]) && document.activeElement?.closest?.("#nemotronSec") == null && load());
  load();
})();
