// E-mail marketing — página do painel (email.html, em iframe na rota #/email).
//
// Campanhas → editor (texto simples ou HTML, prévia ao vivo, teste) → envio:
//   1. confere chave, remetente (domínio verificado) e variáveis
//   2. sincroniza os descadastros da Resend (supressão local)
//   3. monta o público (listas/etapas do CRM, só quem tem e-mail, sem repetidos)
//   4. cria um segmento na Resend e cadastra os destinatários nele (retomável)
//   5. cria o broadcast (envio imediato ou agendado) — a Resend envia
// Envio, agendamento e página de descadastro ficam na Resend (sem servidor nosso).
(() => {
  "use strict";
  const E = globalThis.OrbitaEmail;
  const R = globalThis.OrbitaResend;
  const app = document.getElementById("app");
  const EMBED = new URLSearchParams(location.search).has("embed");
  if (EMBED) document.body.classList.add("embed");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const nf = new Intl.NumberFormat("pt-BR");
  const when = (ts) => (ts ? new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "");
  const $ = (s) => app.querySelector(s);
  const MAIL = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>';

  const STATE = {
    draft: ["Rascunho", ""],
    syncing: ["Preparando envio", "warn"],
    sending: ["Enviando", "info"],
    scheduled: ["Agendada", "info"],
    sent: ["Enviada", "ok"],
    failed: ["Falhou", "err"],
    canceled: ["Cancelada", ""],
  };
  // status do broadcast na Resend → estado da campanha
  const fromResend = (s) => ({ draft: "sending", queued: "sending", sending: "sending", scheduled: "scheduled", sent: "sent", canceled: "canceled", failed: "failed" })[String(s || "").toLowerCase()];

  const S = { view: "list", campaign: null, settings: null, key: "", lists: [], stages: [], count: null, busy: "", error: "" };

  function toast(text, kind = "") {
    const el = document.createElement("div");
    el.className = `toast ${kind}`;
    el.textContent = text;
    document.body.append(el);
    setTimeout(() => el.remove(), kind === "err" ? 7000 : 3500);
  }

  function confirmBox(title, html, ok) {
    return new Promise((resolve) => {
      const w = document.createElement("div");
      w.className = "modal";
      w.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true"><h2>${esc(title)}</h2><div>${html}</div>
        <div class="actions"><span class="grow"></span><button class="btn" data-a="no">Cancelar</button><button class="btn primary" data-a="yes">${esc(ok)}</button></div></div>`;
      document.body.append(w);
      w.querySelector('[data-a="yes"]').focus();
      w.addEventListener("click", (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a || e.target === w) (w.remove(), resolve(a === "yes"));
      });
      w.addEventListener("keydown", (e) => e.key === "Escape" && (w.remove(), resolve(false)));
    });
  }

  const openOptions = () => chrome.runtime.openOptionsPage();
  const configured = () => Boolean(S.key && S.settings.fromEmail && E.isEmail(S.settings.fromEmail));
  const fromHeader = () => (S.settings.fromName ? `${S.settings.fromName.replace(/[<>"]/g, "")} <${S.settings.fromEmail}>` : S.settings.fromEmail);

  // listas e etapas do CRM, para escolher o público
  async function loadAudienceSources() {
    const db = await globalThis.OrbitaChat.openMainDbReadOnly();
    if (!db) return;
    const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
    try {
      const has = (n) => db.objectStoreNames.contains(n);
      const tx = db.transaction(["lists", "crmStages"].filter(has));
      S.lists = has("lists") ? (await req(tx.objectStore("lists").getAll())).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) : [];
      const mods = (await chrome.storage.local.get("orbita:modules"))["orbita:modules"] || {};
      S.stages = mods.crm && has("crmStages") ? (await req(tx.objectStore("crmStages").getAll())).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
    } finally {
      db.close();
    }
  }

  // ------------------------------------------------------------ lista
  async function renderList() {
    S.view = "list";
    const all = await E.campaigns();
    const sup = Object.keys(await E.suppressions()).length;
    const setup = configured()
      ? `<span class="chip ok">Resend conectada · ${esc(S.settings.fromEmail)}</span>`
      : `<span class="chip warn">Falta configurar a Resend</span>`;
    app.innerHTML = `<div class="top"><div class="grow"><h1>E-mail marketing</h1><p>Campanhas por e-mail enviadas pela Resend para as suas listas e clientes do CRM.</p></div>
        ${setup}<button class="btn" data-a="opts">Configurações</button><button class="btn primary" data-a="new">+ Nova campanha</button></div>
      ${configured() ? "" : `<div class="card pad warnbox" style="margin-bottom:14px">Para enviar, informe a chave da API da Resend e o remetente (de um domínio verificado na Resend) em <b>Opções → E-mail marketing</b>. Você já pode criar rascunhos.</div>`}
      ${
        all.length
          ? `<div class="grid">${all
              .map((c) => {
                const [label, cls] = STATE[c.state] || STATE.draft;
                return `<button class="card camp" data-open="${esc(c.id)}"><div class="row"><h3 style="flex:1">${esc(c.name || "Sem nome")}</h3><span class="chip ${cls}">${label}</span></div>
                  <div class="subj">${esc(c.subject || "Sem assunto")}</div>
                  <div class="meta">${c.recipientsCount ? `<span>${nf.format(c.recipientsCount)} destinatários</span>` : ""}<span>${c.state === "scheduled" ? `Agendada para ${when(c.scheduledAt)}` : c.sentAt ? `Enviada ${when(c.sentAt)}` : `Editada ${when(c.updatedAt)}`}</span></div></button>`;
              })
              .join("")}</div>`
          : `<div class="card empty"><div class="z">${MAIL}</div><b>Nenhuma campanha ainda</b><p>Crie a primeira: escreva o e-mail, escolha as listas e envie agora ou agende. O descadastro é automático, pela Resend.</p><button class="btn primary" data-a="new">+ Nova campanha</button></div>`
      }
      <div class="card sup"><span><b>${nf.format(sup)}</b> ${sup === 1 ? "e-mail descadastrado" : "e-mails descadastrados"} — nunca recebem campanhas.</span><span style="flex:1"></span>
        <button class="btn" data-a="sync" ${S.key ? "" : "disabled"}>Sincronizar descadastros</button></div>`;
  }

  async function syncUnsubscribes(client) {
    const contacts = await client.contacts();
    return E.addSuppressions(contacts.filter((c) => c.unsubscribed).map((c) => c.email), "descadastro");
  }

  // ----------------------------------------------------------- editor
  const blank = () => ({ name: "", subject: "", preheader: "", mode: "simple", body: "Olá {{primeiro_nome|cliente}},\n\n", html: "", button: { text: "", url: "" }, audience: { lists: "all", stageIds: [] }, scheduledAt: null, state: "draft" });

  function readForm() {
    const c = S.campaign;
    const v = (id) => $(`#${id}`)?.value ?? "";
    Object.assign(c, { name: v("fName").trim(), subject: v("fSubject"), preheader: v("fPre"), body: v("fBody"), html: v("fHtml") });
    c.button = { text: v("fBtnText").trim(), url: v("fBtnUrl").trim() };
    const all = $("#aAll")?.checked;
    c.audience = { lists: all ? "all" : [...app.querySelectorAll("[data-list]:checked")].map((i) => i.dataset.list), stageIds: [...app.querySelectorAll("[data-stage]:checked")].map((i) => i.dataset.stage) };
    const sch = $("#fSchedule")?.checked && v("fWhen");
    c.scheduledAt = sch ? new Date(v("fWhen")).getTime() : null;
  }

  function problems(c) {
    const out = [];
    if (!c.subject.trim()) out.push("Escreva o assunto.");
    if (c.mode === "html" ? !c.html.trim() : !c.body.trim()) out.push("Escreva o conteúdo do e-mail.");
    const bad = E.unsupportedVars(c.subject, c.preheader, c.mode === "html" ? c.html : c.body);
    if (bad.length) out.push(`No e-mail só funcionam {{nome}} e {{primeiro_nome}}. Tire: ${bad.map((b) => `{{${b}}}`).join(", ")}.`);
    if (c.button.text && !/^https?:\/\//.test(c.button.url)) out.push("O link do botão precisa começar com https://");
    if (c.audience.lists !== "all" && !c.audience.lists.length) out.push("Escolha pelo menos uma lista.");
    if (c.scheduledAt && c.scheduledAt < Date.now() + 60000) out.push("Agende para pelo menos 1 minuto no futuro.");
    return out;
  }

  function updatePreview() {
    const c = S.campaign;
    const b = E.build(c, S.settings);
    const f = $("#pv");
    if (f) f.srcdoc = E.sample(b.html);
    const h = $("#pvHead");
    if (h) h.innerHTML = `<b>${esc(E.sample(b.subject) || "Sem assunto")}</b><small>De: ${esc(fromHeader() || "remetente não configurado")}${c.preheader ? ` · ${esc(c.preheader)}` : ""}</small>`;
    const p = problems(c);
    const box = $("#problems");
    if (box) box.innerHTML = p.length ? `<div class="warnbox">${p.map(esc).join("<br>")}</div>` : "";
  }

  function renderEditor() {
    S.view = "edit";
    const c = S.campaign;
    const locked = c.state !== "draft" && c.state !== "failed";
    if (locked) return renderDetail();
    const lists = S.lists
      .map((l) => `<label><input type="checkbox" data-list="${esc(l.id)}" ${c.audience.lists !== "all" && c.audience.lists.includes(l.id) ? "checked" : ""}> ${esc(l.name)} <span class="muted small">${nf.format(l.count || 0)}</span></label>`)
      .join("");
    const stages = S.stages.map((s) => `<label><input type="checkbox" data-stage="${esc(s.id)}" ${c.audience.stageIds?.includes(s.id) ? "checked" : ""}> <i style="display:inline-block;width:8px;height:8px;border-radius:9px;background:${esc(s.color)}"></i> ${esc(s.name)}</label>`).join("");
    const whenVal = c.scheduledAt ? new Date(c.scheduledAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
    app.innerHTML = `<button class="back" data-a="back">← Campanhas</button>
      <div class="top"><div class="grow"><h1>${c.id ? "Editar campanha" : "Nova campanha"}</h1><p>Escreva o e-mail, confira a prévia, escolha o público e envie.</p></div></div>
      <div class="editor"><div class="form">
        <div class="card sec">
          <label class="field"><span>Nome da campanha (só para você)</span><input class="in" id="fName" value="${esc(c.name)}" placeholder="Ex.: Promoção de outubro"></label>
          <label class="field"><span>Assunto</span><input class="in" id="fSubject" value="${esc(c.subject)}" placeholder="Ex.: {{primeiro_nome}}, chegou a coleção nova" maxlength="200"></label>
          <label class="field"><span>Texto de prévia (aparece ao lado do assunto na caixa de entrada)</span><input class="in" id="fPre" value="${esc(c.preheader)}" maxlength="150"></label>
        </div>
        <div class="card sec">
          <div class="row"><h2 style="flex:1">Conteúdo</h2><div class="seg" role="group"><button type="button" data-mode="simple" aria-pressed="${c.mode !== "html"}">Texto</button><button type="button" data-mode="html" aria-pressed="${c.mode === "html"}">HTML</button></div></div>
          ${
            c.mode === "html"
              ? `<textarea class="in code" id="fHtml" rows="16" placeholder="Cole o HTML do e-mail. Use {{{RESEND_UNSUBSCRIBE_URL}}} para o link de descadastro (se faltar, o rodapé é acrescentado).">${esc(c.html)}</textarea>`
              : `<textarea class="in" id="fBody" rows="12">${esc(c.body)}</textarea>
                 <p class="muted small" style="margin:0">Linha em branco separa parágrafos. *negrito*, _itálico_ e links funcionam. Variáveis: {{primeiro_nome}}, {{nome}} (com padrão: {{primeiro_nome|cliente}}).</p>
                 <div class="row"><label class="field"><span>Botão (opcional)</span><input class="in" id="fBtnText" value="${esc(c.button?.text)}" placeholder="Ex.: Ver ofertas"></label>
                 <label class="field"><span>Link do botão</span><input class="in" id="fBtnUrl" value="${esc(c.button?.url)}" placeholder="https://"></label></div>`
          }
          <p class="muted small" style="margin:0">O rodapé com a sua empresa e o link “Não quero mais receber” entra sempre (Opções → E-mail marketing).</p>
        </div>
        <div class="card sec">
          <h2>Público</h2>
          <label class="row" style="gap:8px"><input type="checkbox" id="aAll" ${c.audience.lists === "all" ? "checked" : ""}> Todos os contatos de todas as listas</label>
          <div class="checks" id="aLists" ${c.audience.lists === "all" ? "hidden" : ""}>${lists || `<span class="muted small">Nenhuma lista ainda.</span>`}</div>
          ${stages ? `<div class="field"><span>Só destas etapas do CRM (opcional)</span><div class="checks">${stages}</div></div>` : ""}
          <p class="muted small" style="margin:0">Vai para todos que têm e-mail (coluna “email” da lista ou e-mail da ficha do lead), sem repetidos. Quem se descadastrou nunca recebe.</p>
          <div class="row"><button type="button" class="btn" data-a="count">Calcular público</button><span id="countNote" class="muted small"></span></div>
          <div id="countBox">${S.count ? countHtml(S.count) : ""}</div>
        </div>
        <div class="card sec">
          <h2>Envio</h2>
          <label class="row" style="gap:8px"><input type="checkbox" id="fSchedule" ${c.scheduledAt ? "checked" : ""}> Agendar</label>
          <input class="in" type="datetime-local" id="fWhen" value="${whenVal}" ${c.scheduledAt ? "" : "hidden"} style="max-width:260px">
          <div id="problems"></div>
          ${c.error ? `<div class="errbox">Último erro: ${esc(c.error)}</div>` : ""}
          <div class="actions"><button class="btn" data-a="save">Salvar rascunho</button><button class="btn" data-a="test" ${configured() ? "" : "disabled"}>Enviar teste</button>
            <span class="grow"></span>${c.id ? `<button class="btn danger" data-a="del">Excluir</button>` : ""}<button class="btn primary" data-a="send" ${configured() ? "" : "disabled title=\"Configure a Resend nas Opções\""}>${c.scheduledAt ? "Agendar campanha" : "Enviar campanha"}</button></div>
        </div>
      </div>
      <div class="card preview"><div class="ph" id="pvHead"></div><iframe id="pv" title="Prévia do e-mail" sandbox=""></iframe></div></div>`;
    updatePreview();
  }

  const countHtml = (n) => `<div class="count"><div><b>${nf.format(n.recipients.length)}</b><small>vão receber</small></div><div><b>${nf.format(n.noEmail)}</b><small>sem e-mail</small></div><div><b>${nf.format(n.suppressed)}</b><small>descadastrados</small></div></div>`;

  // ------------------------------------------------------------ envio
  async function sendCampaign() {
    readForm();
    const c = S.campaign;
    const p = problems(c);
    if (p.length) return toast(p[0], "err");
    const client = R.client(S.key);
    try {
      // domínio do remetente verificado?
      const domains = await client.domains();
      const dom = S.settings.fromEmail.split("@")[1]?.toLowerCase();
      const d = domains.find((x) => String(x.name).toLowerCase() === dom);
      if (!d || d.status !== "verified") throw new Error(`O domínio ${dom} não está verificado na Resend. Verifique o DNS em resend.com/domains ou troque o remetente nas Opções.`);
      const n = await E.collect(c.audience);
      if (!n.recipients.length) throw new Error("Ninguém do público escolhido tem e-mail (ou todos se descadastraram).");
      const ok = await confirmBox(
        c.scheduledAt ? "Agendar a campanha?" : "Enviar a campanha agora?",
        `<p style="margin:0 0 8px"><b>${esc(c.subject)}</b></p><p class="muted" style="margin:0">Para <b>${nf.format(n.recipients.length)}</b> ${n.recipients.length === 1 ? "pessoa" : "pessoas"}${c.scheduledAt ? `, em ${esc(when(c.scheduledAt))}` : ""}, de ${esc(fromHeader())}. ${n.noEmail ? `${nf.format(n.noEmail)} sem e-mail ficam de fora. ` : ""}O envio é feito pela Resend e gasta a cota da sua conta.</p>`,
        c.scheduledAt ? "Agendar" : "Enviar agora",
      );
      if (!ok) return;
      Object.assign(c, { state: "syncing", error: "", recipientsCount: n.recipients.length });
      S.campaign = await E.saveCampaign(c);
      await E.saveRecipients(S.campaign.id, n.recipients.map((r) => ({ ...r, synced: false })));
      await runSend(S.campaign.id);
    } catch (e) {
      toast(e.message, "err");
    }
  }

  // Etapas retomáveis: se a página fechar no meio, "Continuar envio" segue daqui.
  async function runSend(id) {
    let c = (await E.campaigns()).find((x) => x.id === id);
    const client = R.client(S.key);
    S.campaign = c;
    renderDetail();
    const step = (t) => ((S.busy = t), renderDetail());
    let list = null;
    try {
      step("Sincronizando descadastros da Resend…");
      await syncUnsubscribes(client);
      const sup = await E.suppressions();
      list = (await E.recipients(id)).filter((r) => !sup[r.email]);
      if (!c.segmentId) {
        step("Criando o segmento na Resend…");
        const seg = await client.createSegment(`Órbita · ${c.name || c.subject} · ${new Date().toLocaleDateString("pt-BR")}`);
        c = await E.saveCampaign({ ...c, segmentId: seg.id });
      }
      let done = list.filter((r) => r.synced).length;
      for (const r of list) {
        if (r.synced) continue;
        step(`Cadastrando destinatários na Resend: ${nf.format(done)} de ${nf.format(list.length)}…`);
        await client.addContact(r, c.segmentId);
        r.synced = true;
        done++;
        if (done % 20 === 0) await E.saveRecipients(id, list);
        await new Promise((res) => setTimeout(res, 120)); // bem abaixo do limite de 10 pedidos/s
      }
      await E.saveRecipients(id, list);
      step(c.scheduledAt ? "Agendando o envio…" : "Enviando…");
      const b = E.build(c, S.settings);
      const bc = await client.createBroadcast({ segmentId: c.segmentId, from: fromHeader(), subject: b.subject, html: b.html, text: b.text, replyTo: S.settings.replyTo || undefined, name: c.name || c.subject, scheduledAt: c.scheduledAt });
      c = await E.saveCampaign({ ...c, broadcastId: bc.id, state: c.scheduledAt ? "scheduled" : "sending", sentAt: c.scheduledAt ? null : Date.now(), recipientsCount: list.length });
      await logToCrm(list, c);
      toast(c.scheduledAt ? "Campanha agendada na Resend." : "Campanha enviada para a Resend.", "ok");
    } catch (e) {
      if (list) await E.saveRecipients(id, list); // guarda quem já foi cadastrado: a retomada segue daqui
      c = await E.saveCampaign({ ...c, state: c.segmentId ? "syncing" : "failed", error: e.message });
      toast(e.message, "err");
    }
    S.busy = "";
    S.campaign = c;
    renderDetail();
  }

  // Histórico do cliente no CRM: "E-mail: assunto" (tipo "Mensagem", o que o painel já desenha).
  async function logToCrm(list, c) {
    const phones = new Set(list.map((r) => r.phone).filter(Boolean));
    if (!phones.size) return;
    const db = await globalThis.OrbitaChat.openMainDbReadOnly();
    if (!db?.objectStoreNames.contains("crmClients")) return db?.close();
    const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
    try {
      const tx = db.transaction("crmClients", "readwrite");
      const st = tx.objectStore("crmClients");
      const ts = c.scheduledAt || Date.now();
      for (const rec of await req(st.getAll())) {
        if (!phones.has(rec.phone)) continue;
        rec.history = [...(rec.history || []), { id: `${c.id}:${rec.phone}`, ts, kind: "message", text: `E-mail: ${c.subject}` }];
        rec.updatedAt = Date.now();
        st.put(rec);
      }
      await new Promise((res) => (tx.oncomplete = res));
      new BroadcastChannel("orbita-data").postMessage({ topic: "crm" });
    } catch {
    } finally {
      db.close();
    }
  }

  // ------------------------------------------------------------ detalhe
  function renderDetail() {
    S.view = "detail";
    const c = S.campaign;
    const [label, cls] = STATE[c.state] || STATE.draft;
    const total = c.recipientsCount || 0;
    app.innerHTML = `<button class="back" data-a="back">← Campanhas</button>
      <div class="top"><div class="grow"><h1>${esc(c.name || c.subject)}</h1><p>${esc(c.subject)}</p></div><span class="chip ${cls}">${label}</span></div>
      <div class="card sec">
        ${S.busy ? `<div class="okbox">${esc(S.busy)}</div><div class="progress"><i style="width:${/de/.test(S.busy) ? 50 : 20}%"></i></div>` : ""}
        <div class="count"><div><b>${nf.format(total)}</b><small>destinatários</small></div><div><b>${c.state === "scheduled" ? esc(when(c.scheduledAt)) : c.sentAt ? esc(when(c.sentAt)) : "—"}</b><small>${c.state === "scheduled" ? "agendada para" : "enviada em"}</small></div><div><b>${esc(label)}</b><small>situação na Resend</small></div></div>
        ${c.error ? `<div class="errbox">${esc(c.error)}</div>` : ""}
        <p class="muted small" style="margin:0">A Resend não informa aberturas nem entregas por campanha nesta versão. Descadastros entram sozinhos na lista de supressão (ao sincronizar).</p>
        <div class="actions">
          ${c.state === "syncing" && !S.busy ? `<button class="btn primary" data-a="resume">Continuar envio</button>` : ""}
          ${c.broadcastId && !S.busy ? `<button class="btn" data-a="refresh">Atualizar situação</button>` : ""}
          ${c.state === "scheduled" && !S.busy ? `<button class="btn danger" data-a="cancel">Cancelar agendamento</button>` : ""}
          <span class="grow"></span>${S.busy ? "" : `<button class="btn" data-a="dup">Duplicar</button>`}
        </div>
      </div>`;
  }

  async function refreshStatus() {
    const c = S.campaign;
    try {
      const b = await R.client(S.key).broadcast(c.broadcastId);
      const st = fromResend(b.status) || c.state;
      S.campaign = await E.saveCampaign({ ...c, state: st, sentAt: b.sent_at ? new Date(b.sent_at).getTime() : c.sentAt, scheduledAt: b.scheduled_at ? new Date(b.scheduled_at).getTime() : c.scheduledAt });
    } catch (e) {
      toast(e.message, "err");
    }
    renderDetail();
  }

  // ------------------------------------------------------------ eventos
  app.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-a],[data-open],[data-mode]");
    if (!t) return;
    if (t.dataset.open) {
      S.campaign = (await E.campaigns()).find((c) => c.id === t.dataset.open);
      S.count = null;
      return S.campaign.state === "draft" || S.campaign.state === "failed" ? renderEditor() : (renderDetail(), S.campaign.broadcastId && refreshStatus());
    }
    if (t.dataset.mode) {
      readForm();
      S.campaign.mode = t.dataset.mode;
      if (t.dataset.mode === "html" && !S.campaign.html) S.campaign.html = E.build({ ...S.campaign, mode: "simple" }, S.settings).html;
      return renderEditor();
    }
    switch (t.dataset.a) {
      case "opts":
        return openOptions();
      case "new":
        S.campaign = blank();
        S.count = null;
        return renderEditor();
      case "back":
        return renderList();
      case "sync":
        try {
          const n = await syncUnsubscribes(R.client(S.key));
          toast(n ? `${n} ${n === 1 ? "descadastro novo" : "descadastros novos"}.` : "Nenhum descadastro novo.", "ok");
        } catch (err) {
          toast(err.message, "err");
        }
        return renderList();
      case "count":
        readForm();
        $("#countNote").textContent = "Calculando…";
        try {
          S.count = await E.collect(S.campaign.audience);
          $("#countBox").innerHTML = countHtml(S.count);
          $("#countNote").textContent = "";
        } catch (err) {
          $("#countNote").textContent = err.message;
        }
        return;
      case "save":
        readForm();
        S.campaign = await E.saveCampaign({ ...S.campaign, state: "draft" });
        return toast("Rascunho salvo.", "ok");
      case "test": {
        readForm();
        const to = prompt("Enviar o teste para qual e-mail?", S.settings.replyTo || S.settings.fromEmail);
        if (!to) return;
        if (!E.isEmail(to)) return toast("E-mail inválido.", "err");
        const b = E.build(S.campaign, S.settings);
        try {
          await R.client(S.key).sendTest({ from: fromHeader(), to, subject: E.sample(b.subject), html: E.sample(b.html), text: E.sample(b.text), replyTo: S.settings.replyTo || undefined });
          toast(`Teste enviado para ${to}.`, "ok");
        } catch (err) {
          toast(err.message, "err");
        }
        return;
      }
      case "del":
        if (!(await confirmBox("Excluir a campanha?", "<p class='muted' style='margin:0'>O rascunho some da Órbita.</p>", "Excluir"))) return;
        await E.removeCampaign(S.campaign.id);
        return renderList();
      case "send":
        return sendCampaign();
      case "resume":
        return runSend(S.campaign.id);
      case "refresh":
        return refreshStatus();
      case "cancel":
        if (!(await confirmBox("Cancelar o agendamento?", "<p class='muted' style='margin:0'>A campanha não será enviada.</p>", "Cancelar agendamento"))) return;
        try {
          await R.client(S.key).deleteBroadcast(S.campaign.broadcastId);
          S.campaign = await E.saveCampaign({ ...S.campaign, state: "canceled" });
        } catch (err) {
          toast(err.message, "err");
        }
        return renderDetail();
      case "dup": {
        const { id, broadcastId, segmentId, state, sentAt, error, recipientsCount, createdAt, updatedAt, ...rest } = S.campaign;
        S.campaign = { ...rest, name: `${rest.name || rest.subject} (cópia)`, state: "draft", scheduledAt: null };
        return renderEditor();
      }
    }
  });
  app.addEventListener("input", (e) => {
    if (S.view !== "edit" || !e.target.closest(".form")) return;
    readForm();
    updatePreview();
  });
  app.addEventListener("change", (e) => {
    if (S.view !== "edit") return;
    if (e.target.id === "aAll") $("#aLists").hidden = e.target.checked;
    if (e.target.id === "fSchedule") {
      $("#fWhen").hidden = !e.target.checked;
      if (e.target.checked && !$("#fWhen").value) $("#fWhen").value = new Date(Date.now() + 3600000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
    readForm();
    S.count = null;
    updatePreview();
    const send = app.querySelector('[data-a="send"]');
    if (send) send.textContent = S.campaign.scheduledAt ? "Agendar campanha" : "Enviar campanha";
  });

  // ------------------------------------------------------------ início
  chrome.storage.onChanged.addListener(async (ch, area) => {
    if (area !== "local") return;
    if (ch["orbita:modules"]) return location.reload();
    if (ch[E.K.settings] || ch[E.K.secrets]) {
      S.settings = await E.loadSettings();
      S.key = await E.apiKey();
      if (S.view === "list") renderList();
    }
  });

  (async () => {
    if (!(await E.moduleEnabled())) {
      app.innerHTML = `<div class="card empty"><div class="z">${MAIL}</div><b>O e-mail marketing está desligado</b><p>Ligue em Opções da extensão → Módulos para criar e enviar campanhas por e-mail pela Resend.</p><button class="btn primary" data-a="opts">Abrir opções</button></div>`;
      return;
    }
    [S.settings, S.key] = await Promise.all([E.loadSettings(), E.apiKey()]);
    await loadAudienceSources().catch(() => {});
    renderList();
  })();
})();
