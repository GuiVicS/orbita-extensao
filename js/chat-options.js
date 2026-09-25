// Opções → "Conversas: tradução e voz". Lê e grava as preferências das
// Conversas (chrome.storage.local["orbita:chat:settings"]) e a chave do Fish
// Audio (["orbita:chat:secrets"], fora do backup). Também cria a voz clonada.
(() => {
  "use strict";
  const C = globalThis.OrbitaChat;
  const V = globalThis.OrbitaVoice;
  const A = globalThis.OrbitaAudio;
  const $ = (id) => document.getElementById(id);
  if (!$("conversas")) return;

  const LANGS = { pt: "Português", en: "Inglês", es: "Espanhol", fr: "Francês", de: "Alemão", it: "Italiano", nl: "Holandês", ru: "Russo", zh: "Chinês", ja: "Japonês", ko: "Coreano", ar: "Árabe", hi: "Hindi", tr: "Turco", pl: "Polonês", uk: "Ucraniano", he: "Hebraico", id: "Indonésio" };
  for (const sel of ["c-myLang", "c-defaultContactLang"]) $(sel).innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");

  // campos simples: id "c-<chave>" ↔ settings[chave]
  const FIELDS = ["myLang", "defaultContactLang", "tone", "contextMessages", "requirePreview", "autoCorrect", "autoCorrectReview", "voiceEngine", "dubDropBackground", "dubTimeoutSec", "transcriptionProvider", "maxAudioSec", "transcribeOnOpen", "fishVoiceId", "fishModel", "voiceSpeed", "maxVoiceSec", "maxTtsChars", "aiVoiceNotice"];
  const LIMITS = { contextMessages: [0, 12], maxAudioSec: [10, 900], voiceSpeed: [0.5, 2], maxVoiceSec: [5, 300], maxTtsChars: [50, 3000], dubTimeoutSec: [30, 900] };
  let glossary = [];

  // kind: true = sucesso, false = erro, null = em andamento (neutro)
  const setStatus = (id, text, ok = true) => {
    $(id).textContent = text;
    $(id).className = `status ${ok === null ? "" : ok ? "ok" : "err"}`;
  };

  function renderGlossary() {
    $("glossary").innerHTML = glossary.length
      ? glossary.map((g, i) => `<div class="gl" data-i="${i}"><input type="text" data-k="term" placeholder="Termo" value="${esc(g.term)}"><input type="text" data-k="translation" placeholder="Tradução preferida" value="${esc(g.translation || "")}" ${g.keep ? "disabled" : ""}>
          <label><input type="checkbox" data-k="keep" ${g.keep ? "checked" : ""}> não traduzir</label><button type="button" data-rm="${i}" aria-label="Remover termo">×</button></div>`).join("")
      : `<p class="hint">Nenhum termo.</p>`;
  }
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  $("glossary").addEventListener("input", (e) => {
    const row = e.target.closest("[data-i]");
    if (!row) return;
    const g = glossary[Number(row.dataset.i)];
    const k = e.target.dataset.k;
    g[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (k === "keep") renderGlossary();
  });
  $("glossary").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (!rm) return;
    glossary.splice(Number(rm.dataset.rm), 1);
    renderGlossary();
  });
  $("glossaryAdd").addEventListener("click", () => {
    glossary.push({ term: "", translation: "", keep: false });
    renderGlossary();
    $("glossary").querySelector(".gl:last-child input")?.focus();
  });

  async function load() {
    const s = await C.loadSettings();
    for (const k of FIELDS) {
      const el = $(`c-${k}`);
      if (el.type === "checkbox") el.checked = Boolean(s[k]);
      else el.value = s[k];
    }
    glossary = (s.glossary || []).map((g) => ({ ...g }));
    renderGlossary();
    const sec = await V.secrets();
    $("fishKey").value = sec.fishApiKey || "";
    $("elevenKey").value = sec.elevenApiKey || "";
    $("elevenBox").classList.toggle("dim", s.voiceEngine !== "elevenlabs");
    $("previewWarn").hidden = s.requirePreview;
    $("privacyState").textContent = s.privacyAccepted ? "aceito neste navegador." : "ainda não aceito (aparece ao ligar a tradução numa conversa).";
    const ai = (await chrome.storage.local.get("orbita:ai"))["orbita:ai"] || {};
    const has = (p) => Boolean(String(ai.keys?.[p] ?? (p === "groq" ? ai.apiKey : "") ?? "").trim());
    $("txStatus").textContent = has("groq") || has("openai") ? `Chave disponível para transcrever: ${[has("groq") && "Groq", has("openai") && "OpenAI"].filter(Boolean).join(" e ")}.` : "Para transcrever áudios, configure uma chave da Groq ou da OpenAI em “Variações com IA”, acima.";
  }

  $("c-requirePreview").addEventListener("change", (e) => ($("previewWarn").hidden = e.target.checked));
  $("c-voiceEngine").addEventListener("change", (e) => $("elevenBox").classList.toggle("dim", e.target.value !== "elevenlabs"));
  $("toggleEleven").addEventListener("click", () => {
    const show = $("elevenKey").type === "password";
    $("elevenKey").type = show ? "text" : "password";
    $("toggleEleven").textContent = show ? "Ocultar" : "Mostrar";
  });
  $("elevenTest").addEventListener("click", async () => {
    setStatus("elevenStatus", "Conferindo…", null);
    try {
      const r = await globalThis.OrbitaDub.checkKey($("elevenKey").value.trim());
      setStatus("elevenStatus", `Chave válida${r.tier ? ` (plano ${r.tier})` : ""}${r.creditsLeft !== null ? ` · ${r.creditsLeft.toLocaleString("pt-BR")} créditos restantes` : ""}.`);
    } catch (e) {
      setStatus("elevenStatus", e.message, false);
    }
  });
  $("toggleFish").addEventListener("click", () => {
    const show = $("fishKey").type === "password";
    $("fishKey").type = show ? "text" : "password";
    $("toggleFish").textContent = show ? "Ocultar" : "Mostrar";
  });

  async function save() {
    const patch = {};
    for (const k of FIELDS) {
      const el = $(`c-${k}`);
      let v = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value.trim();
      if (LIMITS[k]) v = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Number.isFinite(v) ? v : C.DEFAULT_SETTINGS[k]));
      patch[k] = v;
    }
    patch.glossary = glossary.filter((g) => g.term.trim()).map((g) => ({ term: g.term.trim(), translation: g.keep ? "" : (g.translation || "").trim(), keep: Boolean(g.keep) }));
    await C.saveSettings(patch);
    const secrets = await V.secrets();
    await chrome.storage.local.set({ [V.SECRETS_KEY]: { ...secrets, fishApiKey: $("fishKey").value.trim(), elevenApiKey: $("elevenKey").value.trim() } });
    await load();
    setStatus("chatStatus", "Preferências das Conversas salvas.");
  }
  $("chatSave").addEventListener("click", () => save().catch((e) => setStatus("chatStatus", `Falha ao salvar: ${e.message}`, false)));

  $("privacyReset").addEventListener("click", async () => {
    await C.saveSettings({ privacyAccepted: false });
    await load();
    setStatus("chatStatus", "O aviso de privacidade vai aparecer de novo.");
  });

  // ---- testar a voz
  $("vTestBtn").addEventListener("click", async () => {
    await save().catch(() => {});
    const s = await C.loadSettings();
    $("vStatus").textContent = "Gerando…";
    try {
      const r = await V.tts({ text: $("vTest").value, voiceId: s.fishVoiceId, model: s.fishModel, speed: s.voiceSpeed });
      if (r.fellBack) {
        await C.saveSettings({ fishModel: r.model });
        $("c-fishModel").value = r.model;
      }
      $("vAudio").src = URL.createObjectURL(r.blob);
      $("vAudio").hidden = false;
      $("vAudio").play().catch(() => {});
      $("vStatus").textContent = (s.fishVoiceId ? "Voz configurada." : "Sem ID de voz: o Fish Audio usou uma voz padrão.") + (r.fellBack ? ` O modelo ${s.fishModel} exige créditos pagos; troquei para o ${r.model}.` : "");
    } catch (e) {
      $("vStatus").textContent = e.message;
    }
  });

  // ---- criar a minha voz
  let sample = null; // Blob da amostra
  let recording = null;
  const refreshCreate = () => ($("wCreate").disabled = !(sample && $("wConsent").checked && $("fishKey").value.trim()));
  $("wConsent").addEventListener("change", refreshCreate);
  $("fishKey").addEventListener("input", refreshCreate);

  function setSample(blob, label) {
    sample = blob;
    $("wAudio").src = URL.createObjectURL(blob);
    $("wAudio").hidden = false;
    $("wRecStatus").textContent = label;
    refreshCreate();
  }

  $("wFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) setSample(f, `${f.name} (${Math.round(f.size / 1024)} KB)`);
  });

  $("wRec").addEventListener("click", async () => {
    if (recording) {
      const blob = await recording.handle.stop();
      clearInterval(recording.timer);
      const sec = (Date.now() - recording.start) / 1000;
      recording = null;
      $("wRec").textContent = "● Gravar de novo";
      setSample(blob, `${Math.round(sec)} s gravados${sec < 10 ? " (curto demais: grave pelo menos 10 s)" : ""}`);
      return;
    }
    try {
      const handle = await A.startRecording();
      recording = { handle, start: Date.now() };
      recording.timer = setInterval(() => {
        const sec = Math.round((Date.now() - recording.start) / 1000);
        $("wRecStatus").textContent = `Gravando… ${sec} s${sec >= 30 ? " (já pode parar)" : ""}`;
      }, 250);
      $("wRec").textContent = "■ Parar";
    } catch (e) {
      $("wRecStatus").textContent = `Microfone indisponível: ${e.name === "NotAllowedError" ? "permissão negada" : e.message}`;
    }
  });

  $("wCreate").addEventListener("click", async () => {
    const key = $("fishKey").value.trim();
    if (!sample || !key || !$("wConsent").checked) return;
    $("wCreate").disabled = true;
    setStatus("wStatus", "Enviando a amostra ao Fish Audio…", null);
    try {
      // POST https://api.fish.audio/model (multipart): type=tts, train_mode=fast, voices, texts
      const form = new FormData();
      form.append("type", "tts");
      form.append("title", $("wTitle").value.trim() || "Minha voz (Órbita)");
      form.append("train_mode", "fast");
      form.append("visibility", "private");
      form.append("voices", sample, sample.name || "amostra.webm");
      if ($("wText").value.trim()) form.append("texts", $("wText").value.trim());
      const r = await fetch("https://api.fish.audio/model", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
      if (r.status === 401) throw new Error("Chave do Fish Audio inválida.");
      if (r.status === 402) throw new Error("Sem créditos no Fish Audio.");
      if (!r.ok) throw new Error(`O Fish Audio recusou a amostra (HTTP ${r.status}).`);
      const model = await r.json();
      if (!model._id) throw new Error("O Fish Audio não devolveu o ID da voz.");
      $("c-fishVoiceId").value = model._id;
      await save();
      setStatus("wStatus", `Voz criada (${model._id}) e selecionada. Use “Testar a voz” para ouvir.`);
    } catch (e) {
      setStatus("wStatus", e.message, false);
    } finally {
      refreshCreate();
    }
  });

  load();
  if (location.hash === "#conversas") setTimeout(() => $("conversas").scrollIntoView(), 50);
})();
