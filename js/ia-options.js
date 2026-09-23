// Configuração da paráfrase por IA (Groq). Lida pelo service worker em chrome.storage.local["orbita:ai"].
(() => {
  const KEY = "orbita:ai";
  const DEFAULTS = { enabled: false, apiKey: "", model: "llama-3.3-70b-versatile", temperature: 0.9, instructions: "" };
  const $ = (id) => document.getElementById(id);
  const f = {
    enabled: $("enabled"), apiKey: $("apiKey"), model: $("model"),
    temperature: $("temperature"), instructions: $("instructions"),
  };

  const setStatus = (el, text, kind) => {
    el.textContent = text;
    el.className = "status" + (kind ? " " + kind : "");
  };
  const showTemp = () => ($("tempValue").textContent = Number(f.temperature.value).toFixed(1));

  async function load() {
    const cfg = { ...DEFAULTS, ...((await chrome.storage.local.get(KEY))[KEY] ?? {}) };
    f.enabled.checked = cfg.enabled;
    f.apiKey.value = cfg.apiKey;
    f.model.value = cfg.model;
    f.temperature.value = cfg.temperature;
    f.instructions.value = cfg.instructions;
    showTemp();
    if (cfg.apiKey) loadModels(cfg.apiKey);
  }

  async function save() {
    const cfg = {
      enabled: f.enabled.checked,
      apiKey: f.apiKey.value.trim(),
      model: f.model.value.trim() || DEFAULTS.model,
      temperature: Number(f.temperature.value),
      instructions: f.instructions.value.trim(),
    };
    await chrome.storage.local.set({ [KEY]: cfg });
    if (cfg.apiKey) loadModels(cfg.apiKey);
    return cfg;
  }

  // Sugere no campo "Modelo" os modelos de texto disponíveis na conta.
  async function loadModels(apiKey) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + apiKey } });
      if (!r.ok) return;
      const ids = ((await r.json()).data ?? [])
        .map((m) => m.id)
        .filter((id) => !/whisper|tts|guard|orpheus|playai|distil/i.test(id))
        .sort();
      if (!ids.length) return;
      $("models").replaceChildren(...ids.map((id) => Object.assign(document.createElement("option"), { value: id })));
    } catch {}
  }

  f.temperature.addEventListener("input", showTemp);

  $("toggleKey").addEventListener("click", () => {
    const hidden = f.apiKey.type === "password";
    f.apiKey.type = hidden ? "text" : "password";
    $("toggleKey").textContent = hidden ? "Ocultar" : "Mostrar";
  });

  $("save").addEventListener("click", async () => {
    const cfg = await save();
    setStatus(
      $("saveStatus"),
      cfg.enabled && !cfg.apiKey ? "Salvo, mas sem chave a paráfrase fica desligada." : "Configuração salva.",
      cfg.enabled && !cfg.apiKey ? "err" : "ok",
    );
  });

  $("test").addEventListener("click", async () => {
    const btn = $("test");
    btn.disabled = true;
    $("testOut").textContent = "";
    setStatus($("testStatus"), "Gerando…");
    try {
      await save();
      // Usa a mesma função do service worker que roda nos disparos.
      const res = await chrome.runtime.sendMessage({ channel: "orbita:ai", text: $("sample").value });
      if (!res?.ok) throw new Error(res?.error || "Sem resposta do service worker.");
      $("testOut").textContent = res.data;
      setStatus($("testStatus"), "Variação gerada. Clique de novo para ver outra.", "ok");
    } catch (e) {
      setStatus($("testStatus"), "Falhou: " + (e instanceof Error ? e.message : String(e)), "err");
    } finally {
      btn.disabled = false;
    }
  });

  load();
})();
