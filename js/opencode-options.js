// Opções → "OpenCode Zen (Nemotron)": chave e modelo do OpenCode Zen, e se o
// Resumo do WhatsApp usa o OpenCode. A chave vai para orbita:ai.keys.opencode —
// a mesma usada quando o OpenCode é o provedor principal (Variações com IA).
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  if (!$("opencodeSec")) return;
  const AI = "orbita:ai";
  const SUM = "orbita:summary:ai";
  const BASE = "https://opencode.ai/zen/v1";
  const DEFAULT_MODEL = "nemotron-3-ultra-free";
  const status = (text, ok = true) => (($("ocStatus").textContent = text), ($("ocStatus").className = `status ${ok === null ? "" : ok ? "ok" : "err"}`));

  async function load() {
    const r = await chrome.storage.local.get([AI, SUM]);
    const ai = r[AI] || {};
    $("ocKey").value = ai.keys?.opencode || "";
    $("ocModel").value = ai.models?.opencode || DEFAULT_MODEL;
    $("ocSummary").checked = (r[SUM] || {}).engine === "opencode";
  }

  $("ocToggle").addEventListener("click", () => {
    const show = $("ocKey").type === "password";
    $("ocKey").type = show ? "text" : "password";
    $("ocToggle").textContent = show ? "Ocultar" : "Mostrar";
  });

  // Testar: uma pergunta mínima ao modelo escolhido
  $("ocTest").addEventListener("click", async () => {
    const key = $("ocKey").value.trim();
    const model = $("ocModel").value.trim() || DEFAULT_MODEL;
    if (!key) return status("Cole a chave do OpenCode.", false);
    status("Testando…", null);
    try {
      const r = await fetch(`${BASE}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, max_tokens: 20, messages: [{ role: "user", content: "Responda só: ok" }] }) });
      if (r.status === 401 || r.status === 403) return status("Chave do OpenCode inválida.", false);
      if (r.status === 429) return status("Limite de uso do OpenCode atingido agora. A chave parece válida; tente de novo mais tarde.", false);
      if (!r.ok) return status(`O OpenCode respondeu HTTP ${r.status}${r.status === 404 ? " (modelo não encontrado?)" : ""}.`, false);
      status(`Chave válida — o modelo ${model} respondeu.`);
    } catch {
      status("Sem conexão com o OpenCode.", false);
    }
  });

  $("ocSave").addEventListener("click", async () => {
    const r = await chrome.storage.local.get([AI, SUM]);
    const ai = r[AI] || {};
    const key = $("ocKey").value.trim();
    const model = $("ocModel").value.trim() || DEFAULT_MODEL;
    await chrome.storage.local.set({
      [AI]: { ...ai, keys: { ...(ai.keys || {}), opencode: key }, models: { ...(ai.models || {}), opencode: model } },
      [SUM]: { ...(r[SUM] || {}), engine: $("ocSummary").checked ? "opencode" : "default" },
    });
    status(key ? `Salvo.${$("ocSummary").checked ? " O Resumo vai usar o OpenCode." : ""}` : "Salvo (sem chave).", Boolean(key) || !$("ocSummary").checked);
  });

  // mudanças feitas em outra tela (ex.: IA do resumo trocada na página do Resumo)
  chrome.storage.onChanged.addListener((ch, area) => area === "local" && (ch[SUM] || ch[AI]) && document.activeElement?.closest?.("#opencodeSec") == null && load());
  load();
})();
