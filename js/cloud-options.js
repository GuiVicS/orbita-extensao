// Opções → "Órbita Cloud (Supabase)": botão "Habilitar Cloud" e o assistente
//   1 conta no Supabase → 2 URL + chave publicável → 3 usuário (entrar/criar)
//   → 4 tabela (automático com token pessoal, ou SQL manual) → 5 primeira
//   sincronização (mesclar / usar os da nuvem / enviar os daqui) + intervalo.
// Depois de ligado mostra o estado, "Sincronizar agora" e as opções de desligar.
// A lógica fica em js/cloud-sync.js (OrbitaCloud), a mesma do service worker.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  if (!$("cloudSec") || !globalThis.OrbitaCloud) return;
  const C = globalThis.OrbitaCloud;
  // os testes trocam o endereço da API de gerenciamento
  const mgmtBase = () => globalThis.__orbitaCloudMgmt || undefined;

  let step = 1;
  let draft = {}; // url/key/email antes de ligar
  let busy = false;

  const say = (id, text, ok = true) => {
    const el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.className = `status ${ok === null ? "" : ok ? "ok" : "err"}`;
  };
  const fmt = (t) => (t ? new Date(t).toLocaleString("pt-BR") : "nunca");

  function show(mode) {
    $("cloOff").hidden = mode !== "off";
    $("cloWizard").hidden = mode !== "wizard";
    $("cloOn").hidden = mode !== "on";
  }
  function go(n) {
    step = n;
    for (const el of $("cloWizard").querySelectorAll("[data-step]")) el.hidden = Number(el.dataset.step) !== n;
    $("cloStepLabel").textContent = `Passo ${n} de 5`;
    if (n === 4) {
      const ref = C.projectRef(draft.url);
      $("cloSqlLink").href = ref ? `https://supabase.com/dashboard/project/${ref}/sql/new` : "https://supabase.com/dashboard";
    }
  }
  async function guard(btn, fn) {
    if (busy) return;
    busy = true;
    const btns = [...$("cloudSec").querySelectorAll("button")];
    btns.forEach((b) => (b.disabled = true));
    try {
      await fn();
    } finally {
      busy = false;
      btns.forEach((b) => (b.disabled = false));
    }
  }

  async function paint() {
    const cfg = await C.loadConfig();
    if (!cfg.enabled) {
      if ($("cloWizard").hidden) show("off");
      return;
    }
    show("on");
    $("cloInfo").innerHTML = "";
    $("cloInfo").append("Conectado ao projeto ", Object.assign(document.createElement("b"), { textContent: cfg.url.replace(/^https?:\/\//, "") }), " como ", Object.assign(document.createElement("b"), { textContent: cfg.email || "?" }), ".");
    $("cloInterval2").value = String(cfg.intervalMin ?? 5);
    const s = cfg.lastStats;
    const last = `Última sincronização: ${fmt(cfg.lastSyncAt)}${s ? ` — ${s.down} recebidos, ${s.up} enviados${s.skippedFiles ? `, ${s.skippedFiles} arquivos ficaram só aqui` : ""}` : ""}.`;
    if (cfg.lastError && (cfg.lastErrorAt || 0) > (cfg.lastSyncAt || 0)) say("cloLast", `${last} Erro na última tentativa: ${cfg.lastError}`, false);
    else say("cloLast", last, null);
  }

  // ---------- passo 1
  $("cloEnable").onclick = async () => {
    const cfg = await C.loadConfig();
    draft = { url: cfg.url || "", key: cfg.key || "", email: cfg.email || "" };
    $("cloUrl").value = draft.url;
    $("cloKey").value = draft.key;
    $("cloEmail").value = draft.email;
    $("cloSql").textContent = C.SQL;
    show("wizard");
    go(cfg.url && cfg.key ? 2 : 1);
  };
  $("cloHaveAccount").onclick = () => go(2);
  $("cloCancel").onclick = () => {
    show("off");
    paint();
  };

  // ---------- passo 2
  $("cloKeyToggle").onclick = () => {
    const i = $("cloKey");
    i.type = i.type === "password" ? "text" : "password";
    $("cloKeyToggle").textContent = i.type === "password" ? "Mostrar" : "Ocultar";
  };
  $("cloBack2").onclick = () => go(1);
  $("cloNext2").onclick = () =>
    guard($("cloNext2"), async () => {
      say("cloStatus2", "");
      let url;
      try {
        url = C.normalizeUrl($("cloUrl").value);
      } catch (e) {
        return say("cloStatus2", e.message, false);
      }
      const key = $("cloKey").value.trim();
      if (!key) return say("cloStatus2", "Cole a chave publicável.", false);
      if (/^sb_secret_/i.test(key) || /service_role/.test(atobSafe(key.split(".")[1]))) return say("cloStatus2", "Essa é a chave SECRETA (acesso total) — ela não pode ficar na extensão. Use a chave publishable (ou anon).", false);
      // projeto fora do supabase.co (self-hosted): pede permissão para o endereço
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
        const ok = await chrome.permissions.request({ origins: [`${url}/*`] }).catch(() => false);
        if (!ok) return say("cloStatus2", "Sem permissão para acessar esse endereço.", false);
      }
      say("cloStatus2", "Conferindo…", null);
      try {
        const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
        if (r.status === 401 || r.status === 403) return say("cloStatus2", "O Supabase recusou a chave. Confira se copiou a chave publishable deste projeto.", false);
        if (!r.ok) return say("cloStatus2", `Não consegui falar com o projeto (HTTP ${r.status}). Confira o Project URL.`, false);
      } catch {
        return say("cloStatus2", "Não consegui falar com o projeto. Confira o Project URL (e se o projeto não está pausado).", false);
      }
      draft.url = url;
      draft.key = key;
      say("cloStatus2", "");
      go(3);
    });
  function atobSafe(s) {
    try {
      return atob(String(s || "").replace(/-/g, "+").replace(/_/g, "/"));
    } catch {
      return "";
    }
  }

  // ---------- passo 3
  $("cloBack3").onclick = () => go(2);
  async function afterLogin(user) {
    const cfg = await C.loadConfig();
    const changed = cfg.url !== draft.url || cfg.userId !== user.userId;
    await C.saveConfig({ url: draft.url, key: draft.key, email: user.email, userId: user.userId });
    if (changed) await chrome.storage.local.remove(C.K.state); // outro projeto/usuário: começa do zero
    $("cloPass").value = "";
    say("cloStatus3", "");
    await toTableStep();
  }
  $("cloLogin").onclick = () =>
    guard($("cloLogin"), async () => {
      const email = $("cloEmail").value.trim();
      const pass = $("cloPass").value;
      if (!email || !pass) return say("cloStatus3", "Preencha e-mail e senha.", false);
      say("cloStatus3", "Entrando…", null);
      try {
        await afterLogin(await C.signIn(draft, email, pass));
      } catch (e) {
        const msg = /invalid login|invalid_grant|credentials/i.test(e.message) ? "E-mail ou senha incorretos (ou o usuário ainda não existe — use “Criar usuário”)." : /not confirmed/i.test(e.message) ? "Confirme o e-mail pelo link que o Supabase enviou e clique em Entrar de novo." : e.message;
        say("cloStatus3", msg, false);
      }
    });
  $("cloSignup").onclick = () =>
    guard($("cloSignup"), async () => {
      const email = $("cloEmail").value.trim();
      const pass = $("cloPass").value;
      if (!email || pass.length < 6) return say("cloStatus3", "Informe o e-mail e uma senha com pelo menos 6 caracteres.", false);
      say("cloStatus3", "Criando…", null);
      try {
        const u = await C.signUp(draft, email, pass);
        if (u.confirmed) return afterLogin(u);
        say("cloStatus3", `Usuário criado. O Supabase enviou um link de confirmação para ${email} — confirme e clique em Entrar.`, true);
      } catch (e) {
        say("cloStatus3", /already registered|already exists/i.test(e.message) ? "Esse e-mail já tem usuário neste projeto — use Entrar." : e.message, false);
      }
    });

  // ---------- passo 4
  async function toTableStep() {
    const cfg = await C.loadConfig();
    say("cloStatus4", "");
    if (await C.checkTable(cfg)) return toDataStep();
    go(4);
  }
  $("cloBack4").onclick = () => go(3);
  $("cloCreate").onclick = () =>
    guard($("cloCreate"), async () => {
      const pat = $("cloPat").value.trim();
      if (!pat) return say("cloStatus4", "Cole o token de acesso pessoal (sbp_…), ou use o modo manual.", false);
      say("cloStatus4", "Criando a tabela…", null);
      try {
        await C.createSchema(await C.loadConfig(), pat, { mgmtBase: mgmtBase() });
        $("cloPat").value = "";
        await waitTable();
      } catch (e) {
        say("cloStatus4", e.code === "AUTH" ? "O Supabase recusou o token. Gere um novo em Account → Access Tokens (ele começa com sbp_) — ou use o modo manual." : e.message, false);
      }
    });
  // a API de dados demora um instante para enxergar a tabela nova
  async function waitTable() {
    const cfg = await C.loadConfig();
    for (let i = 0; i < 6; i++) {
      if (await C.checkTable(cfg)) return toDataStep();
      await new Promise((r) => setTimeout(r, 1500));
    }
    say("cloStatus4", "A tabela ainda não aparece para a extensão. Espere alguns segundos e clique em “Já rodei, conferir”.", false);
  }
  $("cloCopySql").onclick = async () => {
    try {
      await navigator.clipboard.writeText(C.SQL);
      say("cloStatus4", "SQL copiado. Cole no SQL Editor e clique em Run.", true);
    } catch {
      $("cloSql").closest("details").open = true;
      say("cloStatus4", "Não consegui copiar — selecione o SQL abaixo.", false);
    }
  };
  $("cloCheck").onclick = () =>
    guard($("cloCheck"), async () => {
      say("cloStatus4", "Conferindo…", null);
      try {
        if (await C.checkTable(await C.loadConfig())) return toDataStep();
        say("cloStatus4", "Ainda não encontrei a tabela orbita_records. Rodou o SQL inteiro, no projeto certo?", false);
      } catch (e) {
        say("cloStatus4", e.message, false);
      }
    });

  // ---------- passo 5
  let remoteTotal = 0;
  async function toDataStep() {
    go(5);
    say("cloStatus5", "");
    const cfg = await C.loadConfig();
    $("cloInterval").value = String(cfg.intervalMin ?? 5);
    $("cloCounts").textContent = "Contando os dados…";
    const [remote, { local, skipped }] = await Promise.all([C.remoteCount(cfg), C.collectLocal().catch(() => ({ local: new Map(), skipped: 0 }))]);
    remoteTotal = remote;
    const here = [...local.values()].reduce((n, m) => n + m.size, 0);
    $("cloModes").hidden = remote === 0;
    $("cloCounts").textContent =
      remote === 0
        ? `A nuvem está vazia. Os ${here} registros deste computador serão enviados.${skipped ? ` (${skipped} arquivos ficam só aqui.)` : ""}`
        : `A nuvem já tem ${remote} registros e este computador tem ${here}. O que fazer?`;
    document.querySelector("input[name=cloMode][value=merge]").checked = true; // sempre volta para a opção segura
    $("cloBackup").checked = remote > 0;
  }
  $("cloBack5").onclick = () => go(4);
  $("cloStart").onclick = () =>
    guard($("cloStart"), async () => {
      const mode = remoteTotal === 0 ? "push" : document.querySelector("input[name=cloMode]:checked").value;
      if (mode === "pull" && !confirm("Os dados deste computador serão SUBSTITUÍDOS pelos da nuvem. Continuar?")) return;
      if (mode === "push" && remoteTotal > 0 && !confirm("Os dados da nuvem serão SUBSTITUÍDOS pelos deste computador (inclusive o que outros computadores enviaram). Continuar?")) return;
      try {
        if ($("cloBackup").checked && globalThis.OrbitaBackup) {
          say("cloStatus5", "Baixando o backup…", null);
          await globalThis.OrbitaBackup.download().catch(() => {});
        }
        const intervalMin = Number($("cloInterval").value);
        await C.saveConfig({ intervalMin });
        const stats = await C.sync({ mode, onProgress: (p) => say("cloStatus5", p.step, null) });
        await C.saveConfig({ enabled: true });
        await C.schedule();
        say("cloStatus5", "");
        show("on");
        await paint();
        say("cloStatusOn", `Pronto! ${stats.down} recebidos, ${stats.up} enviados.`, true);
      } catch (e) {
        say("cloStatus5", e.message, false);
      }
    });

  // ---------- ligado
  $("cloInterval2").onchange = async () => {
    await C.saveConfig({ intervalMin: Number($("cloInterval2").value) });
    await C.schedule();
    say("cloStatusOn", "Intervalo salvo.", true);
  };
  $("cloSyncNow").onclick = () =>
    guard($("cloSyncNow"), async () => {
      try {
        const s = await C.sync({ onProgress: (p) => say("cloStatusOn", p.step, null) });
        await paint();
        say("cloStatusOn", `Sincronizado: ${s.down} recebidos, ${s.up} enviados.`, true);
      } catch (e) {
        await paint();
        say("cloStatusOn", e.message, false);
        if (e.code === "LOGIN") reopenWizard(3);
      }
    });
  async function reopenWizard(n) {
    await $("cloEnable").onclick();
    if (n >= 5) {
      try {
        await toDataStep();
      } catch (e) {
        go(3);
        say("cloStatus3", e.message, false);
      }
    } else go(n);
  }
  $("cloRedo").onclick = () => reopenWizard(5);
  $("cloRelogin").onclick = async () => {
    await C.saveConfig({ enabled: false });
    await C.schedule();
    reopenWizard(2);
  };
  $("cloDisable").onclick = async () => {
    if (!confirm("Desligar a sincronização? Os dados continuam aqui e no Supabase.")) return;
    await C.disconnect();
    show("off");
    say("cloOffStatus", "Cloud desligada. Clique em Habilitar Cloud para ligar de novo.", true);
  };
  $("cloForget").onclick = async () => {
    if (!confirm("Desconectar e esquecer o projeto, o usuário e o estado da sincronização neste computador? (Os dados na nuvem e aqui continuam.)")) return;
    await C.disconnect({ forget: true });
    show("off");
    say("cloOffStatus", "Desconectado.", true);
  };

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "local" && ch[C.K.config] && !busy && !$("cloOn").hidden) paint();
  });
  paint();
})();
