// Ficha do lead no CRM: dados do lead, oportunidade, atividades e marketing.
//
// Tudo fica no mesmo registro do CRM (IndexedDB "orbita", store crmClients),
// em campos novos que o painel minificado preserva (o upsertClient dele lê o
// registro inteiro, altera e grava de volta):
//   lead  { email, company, source, owner, status, temperature, product,
//           potentialValue, notes }
//   deal  { value, expectedCloseAt ("AAAA-MM-DD"), probability (0–100), lostReason }
//   utm   { source, medium, campaign, landingPage }
// Nome e WhatsApp continuam onde já estavam (contatos das listas / telefone), e a
// etapa da oportunidade é a etapa do funil (Kanban).
// Atividades são entradas do histórico com um objeto extra `activity`, e com
// kind "call" / "message" / "note" — os únicos que o histórico do painel sabe
// desenhar — para aparecerem lá também:
//   { id, ts, kind, text, activity: { type, owner, description, result, nextAction, nextAt } }
//
// Expõe globalThis.OrbitaLead:
//   mount(el, phone, { identity })  monta a ficha editável dentro de el
//   cardBadges(el, client)          selos de temperatura e valor no card do Kanban
// Roda em páginas da extensão (painel e Conversas). Usa OrbitaChat.openMainDbReadOnly.
(() => {
  "use strict";
  if (globalThis.OrbitaLead) return;

  const STATUS = [
    ["novo", "Novo"],
    ["contato", "Em contato"],
    ["qualificado", "Qualificado"],
    ["ganho", "Ganho (virou cliente)"],
    ["perdido", "Perdido"],
    ["desqualificado", "Desqualificado"],
  ];
  const TEMPERATURE = [
    ["frio", "Frio", "#0ea5e9"],
    ["morno", "Morno", "#f59e0b"],
    ["quente", "Quente", "#dc2626"],
  ];
  const ACTIVITY = [
    ["ligacao", "Ligação", "call"],
    ["whatsapp", "WhatsApp", "message"],
    ["email", "E-mail", "message"],
    ["reuniao", "Reunião", "note"],
    ["visita", "Visita", "note"],
    ["tarefa", "Tarefa", "note"],
  ];
  const SOURCES = ["Instagram", "Facebook", "Google", "Site", "WhatsApp", "Indicação", "Evento", "Loja física"];
  const RESULTS = ["Sem resposta", "Interessado", "Pediu proposta", "Agendou reunião", "Fechou negócio", "Sem interesse"];
  const LEAD_KEYS = ["email", "company", "source", "owner", "status", "temperature", "product", "potentialValue", "notes"];
  const DEAL_KEYS = ["value", "expectedCloseAt", "probability", "lostReason"];
  const UTM_KEYS = ["source", "medium", "campaign", "landingPage"];
  const OWNER_KEY = "orbita-lead-owner";
  const OPEN_KEY = "orbita-lead-open";

  const label = (list, v) => list.find((x) => x[0] === v)?.[1] ?? "";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  const done = (tx) => new Promise((res, rej) => ((tx.oncomplete = res), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error || new Error("Operação cancelada.")))));
  const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const fmtWhen = (ts) => new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const pad = (n) => String(n).padStart(2, "0");
  const toLocalInput = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fromLocalInput = (v) => (v ? new Date(v).getTime() : NaN);
  const fmtDate = (v) => (v ? new Date(`${v}T12:00`).toLocaleDateString("pt-BR") : "");

  // "R$ 1.500,50", "1500.5", "1.500" → número (formato brasileiro primeiro)
  function parseMoney(v) {
    let s = String(v ?? "").replace(/[^\d,.-]/g, "");
    if (!s) return undefined;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
  }
  const fmtMoney = (n) => (typeof n === "number" ? money.format(n) : "");

  function parseProbability(v) {
    if (String(v ?? "").trim() === "") return undefined;
    const n = Math.round(Number(String(v).replace(",", ".").replace("%", "")));
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : undefined;
  }

  function lsGet(k, fallback) {
    try {
      return JSON.parse(localStorage.getItem(k)) ?? fallback;
    } catch {
      return fallback;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  }

  // ------------------------------------------------------------------ dados
  let channel = null;
  const mounts = new Set();
  // identifica os avisos desta página, para quem mostra a ficha não se redesenhar à toa
  const pageId = uuid();
  function getChannel() {
    if (channel) return channel;
    try {
      channel = new BroadcastChannel("orbita-data");
      // alterações feitas em outra tela (ou no próprio painel) aparecem aqui
      channel.onmessage = (ev) => {
        const { topic, id } = ev.data || {};
        if (topic !== "crm" && topic !== "lists") return;
        for (const m of mounts) {
          if (!m.el.isConnected) mounts.delete(m);
          else if ((topic === "lists" || !id || id === m.phone) && !m.el.contains(document.activeElement)) m.reload();
        }
      };
    } catch {}
    return channel;
  }
  function notify(topic, id) {
    try {
      getChannel()?.postMessage({ topic, id, page: pageId });
    } catch {}
  }

  async function withDb(fn) {
    const db = await globalThis.OrbitaChat.openMainDbReadOnly(); // abre sem nunca criar o banco
    if (!db) throw new Error("O banco da Órbita ainda não existe. Abra o painel uma vez.");
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  }

  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0);

  async function load(phone) {
    return withDb(async (db) => {
      const has = (n) => db.objectStoreNames.contains(n);
      const tx = db.transaction(["crmStages", "crmClients", "listContacts"].filter(has));
      const stages = has("crmStages") ? (await req(tx.objectStore("crmStages").getAll())).sort(byOrder) : [];
      const all = has("crmClients") ? await req(tx.objectStore("crmClients").getAll()) : [];
      const contacts = has("listContacts") ? (await req(tx.objectStore("listContacts").getAll())).filter((c) => c.phone === phone) : [];
      const rec = all.find((c) => c.phone === phone) ?? null;
      // sugestões: valores já usados em outros clientes
      const seen = {};
      const add = (k, v) => {
        v = String(v ?? "").trim();
        if (!v) return;
        const m = (seen[k] ||= new Map());
        const key = v.toLowerCase();
        m.set(key, { v: m.get(key)?.v ?? v, n: (m.get(key)?.n ?? 0) + 1 });
      };
      for (const c of all) {
        add("source", c.lead?.source);
        add("owner", c.lead?.owner);
        add("product", c.lead?.product);
        add("lostReason", c.deal?.lostReason);
        for (const k of UTM_KEYS) add(`utm.${k}`, c.utm?.[k]);
        for (const h of c.history ?? []) {
          add("owner", h.activity?.owner);
          add("result", h.activity?.result);
        }
      }
      const suggest = (k, base = []) => {
        const used = [...(seen[k]?.values() ?? [])].sort((a, b) => b.n - a.n).map((x) => x.v);
        const out = [...used];
        for (const b of base) if (!out.some((x) => x.toLowerCase() === b.toLowerCase())) out.push(b);
        return out;
      };
      const stage = rec && stages.find((s) => s.id === rec.stageId);
      return {
        inLists: contacts.length > 0,
        name: contacts.find((c) => c.name)?.name || "",
        stage: stage || stages[0] || null, // etapa inválida conta como a primeira, igual ao painel
        lead: { ...(rec?.lead ?? {}) },
        deal: { ...(rec?.deal ?? {}) },
        utm: { ...(rec?.utm ?? {}) },
        activities: (rec?.history ?? []).filter((h) => h.activity).sort((a, b) => b.ts - a.ts),
        suggest: {
          source: suggest("source", SOURCES),
          owner: suggest("owner"),
          product: suggest("product"),
          result: suggest("result", RESULTS),
          lostReason: suggest("lostReason", ["Preço", "Sem retorno", "Escolheu concorrente", "Sem orçamento", "Não era o momento"]),
          utm: Object.fromEntries(UTM_KEYS.map((k) => [k, suggest(`utm.${k}`)])),
        },
      };
    });
  }

  // Mesmo comportamento do upsertClient do painel (cria o registro se faltar).
  async function upsert(phone, fn) {
    const rec = await withDb(async (db) => {
      const tx = db.transaction(["crmStages", "crmClients"], "readwrite");
      const stages = (await req(tx.objectStore("crmStages").getAll())).sort(byOrder);
      const store = tx.objectStore("crmClients");
      const r = (await req(store.get(phone))) ?? { phone, stageId: stages[0]?.id ?? "", history: [], updatedAt: Date.now() };
      r.history ||= [];
      fn(r);
      r.updatedAt = Date.now();
      store.put(r);
      await done(tx);
      return r;
    });
    notify("crm", phone);
    return rec;
  }

  // Grava um campo: group = "lead" | "deal" | "utm". Valor vazio apaga o campo.
  function setField(phone, group, key, value) {
    const keys = { lead: LEAD_KEYS, deal: DEAL_KEYS, utm: UTM_KEYS }[group];
    if (!keys?.includes(key)) throw new Error(`Campo desconhecido: ${group}.${key}`);
    return upsert(phone, (r) => {
      const g = { ...(r[group] ?? {}) };
      if (value === undefined || value === null || value === "") delete g[key];
      else g[key] = typeof value === "string" ? value.trim() : value;
      if (Object.keys(g).length) r[group] = g;
      else delete r[group];
    });
  }

  function activityText(a) {
    const lines = [`${label(ACTIVITY, a.type) || "Atividade"}${a.description ? `: ${a.description}` : ""}`];
    if (a.result) lines.push(`Resultado: ${a.result}`);
    if (a.nextAction || a.nextAt) lines.push(`Próxima ação: ${a.nextAction || "—"}${a.nextAt ? ` (${fmtWhen(a.nextAt)})` : ""}`);
    if (a.owner) lines.push(`Responsável: ${a.owner}`);
    return lines.join("\n");
  }

  function addActivity(phone, input) {
    const type = ACTIVITY.find((t) => t[0] === input.type);
    if (!type) throw new Error("Escolha o tipo da atividade.");
    const ts = Number.isFinite(input.at) ? input.at : Date.now();
    const activity = { type: type[0] };
    for (const k of ["owner", "description", "result", "nextAction"]) {
      const v = String(input[k] ?? "").trim();
      if (v) activity[k] = v;
    }
    if (Number.isFinite(input.nextAt)) activity.nextAt = input.nextAt;
    if (!activity.description && !activity.result) throw new Error("Descreva a atividade ou informe o resultado.");
    const e = { id: uuid(), ts, kind: type[2], text: activityText(activity), activity };
    return upsert(phone, (r) => {
      // mantém o histórico em ordem de data (o painel mostra na ordem gravada)
      const i = r.history.findIndex((h) => h.ts > ts);
      if (i < 0) r.history.push(e);
      else r.history.splice(i, 0, e);
      const last = Math.min(ts, Date.now());
      if (!(r.lastInteractionAt >= last)) r.lastInteractionAt = last;
    });
  }

  // Mesmo comportamento do removeInteraction do painel.
  const removeActivity = (phone, id) =>
    upsert(phone, (r) => {
      r.history = r.history.filter((h) => h.id !== id);
      r.lastInteractionAt = r.history.filter((h) => h.kind !== "stage").at(-1)?.ts;
    });

  // Nome do cliente: fica nos contatos das listas (todas as listas em que ele está).
  async function rename(phone, name) {
    const n = String(name || "").trim();
    if (!n) throw new Error("Informe um nome.");
    await withDb(async (db) => {
      const tx = db.transaction("listContacts", "readwrite");
      const store = tx.objectStore("listContacts");
      for (const c of await req(store.getAll())) if (c.phone === phone && c.name !== n) store.put({ ...c, name: n });
      await done(tx);
    });
    notify("lists");
    notify("crm", phone);
  }

  // -------------------------------------------------------------------- UI
  const CSS = `
    .olf { display: grid; gap: 10px; font-size: 13px; color: var(--foreground); }
    .olf details { border: 1px solid var(--border); border-radius: 12px; background: var(--card); }
    .olf summary { display: flex; align-items: center; gap: 8px; padding: 9px 12px; cursor: pointer; font-weight: 600; list-style: none; user-select: none; }
    .olf summary::-webkit-details-marker { display: none; }
    .olf summary::before { content: ""; width: 6px; height: 6px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(-45deg); transition: transform .15s; opacity: .6; flex: none; }
    .olf details[open] > summary::before { transform: rotate(45deg); }
    .olf summary .olf-sum { margin-left: auto; display: flex; gap: 6px; align-items: center; font-weight: 500; font-size: 12px; color: var(--muted-foreground); }
    .olf .olf-body { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; padding: 2px 12px 12px; }
    .olf .olf-body > .wide { grid-column: 1 / -1; }
    .olf label.f { display: grid; gap: 4px; min-width: 0; }
    .olf label.f > span { font-size: 11.5px; font-weight: 500; color: var(--muted-foreground); }
    .olf input, .olf select, .olf textarea { width: 100%; box-sizing: border-box; min-width: 0; font: inherit; color: inherit; background: var(--background);
      border: 1px solid var(--input); border-radius: 9px; padding: 6px 9px; outline: 0; }
    .olf input:focus, .olf select:focus, .olf textarea:focus { border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in oklch, var(--ring) 18%, transparent); }
    .olf input[readonly] { background: var(--muted); color: var(--muted-foreground); }
    .olf textarea { resize: vertical; min-height: 56px; }
    .olf .olf-hint { font-size: 11.5px; color: var(--muted-foreground); }
    .olf .olf-temp { display: flex; gap: 6px; }
    .olf .olf-temp button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 6px 4px; border-radius: 9px; border: 1px solid var(--input);
      background: var(--background); color: inherit; font: inherit; cursor: pointer; }
    .olf .olf-temp button[aria-pressed="true"] { border-color: var(--c); background: color-mix(in oklch, var(--c) 14%, transparent); font-weight: 600; }
    .olf i.dot { display: inline-block; width: 8px; height: 8px; border-radius: 99px; background: var(--c); flex: none; }
    .olf .chip { display: inline-flex; align-items: center; gap: 4px; border-radius: 99px; padding: 1px 8px; background: var(--muted); color: var(--foreground); font-size: 11.5px; }
    .olf .olf-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: 9px; border: 0; cursor: pointer;
      font: inherit; font-weight: 600; color: #fff; background: linear-gradient(135deg, var(--orbit-from, var(--primary)), var(--orbit-to, var(--primary))); justify-self: start; }
    .olf .olf-btn:disabled { opacity: .55; cursor: default; }
    .olf .olf-acts { grid-column: 1 / -1; display: grid; gap: 8px; }
    .olf .olf-act { display: grid; gap: 3px; border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; }
    .olf .olf-act header { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted-foreground); }
    .olf .olf-act header b { color: var(--foreground); }
    .olf .olf-act header button { margin-left: auto; border: 0; background: none; color: var(--muted-foreground); cursor: pointer; font: inherit; text-decoration: underline; padding: 0; }
    .olf .olf-act header button:hover { color: var(--destructive); }
    .olf .olf-act p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .olf .olf-act small { color: var(--muted-foreground); }
    .olf .olf-next { grid-column: 1 / -1; border-radius: 10px; padding: 8px 10px; background: color-mix(in oklch, var(--primary) 8%, transparent); border: 1px solid color-mix(in oklch, var(--primary) 25%, transparent); }
    .olf .olf-sep { grid-column: 1 / -1; height: 1px; background: var(--border); margin: 2px 0; }
    .olf .olf-err { grid-column: 1 / -1; color: var(--destructive); font-size: 12px; }
    .olf .saved { animation: olf-saved 1s ease; }
    @keyframes olf-saved { 0% { border-color: var(--success, #16a34a); box-shadow: 0 0 0 3px color-mix(in oklch, var(--success, #16a34a) 25%, transparent); } }
    .olf-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .olf-badges:empty { display: none; }
    .olf-badges span { display: inline-flex; align-items: center; gap: 4px; border-radius: 6px; padding: 1px 6px; font-size: 10.5px; font-weight: 600;
      background: color-mix(in oklch, var(--c, var(--muted-foreground)) 13%, transparent); color: color-mix(in oklch, var(--c, var(--foreground)) 80%, var(--foreground)); }
    .olf-badges i { width: 6px; height: 6px; border-radius: 99px; background: var(--c); }
  `;
  function ensureCss() {
    if (document.getElementById("orbita-lead-css")) return;
    const s = document.createElement("style");
    s.id = "orbita-lead-css";
    s.textContent = CSS;
    document.head.append(s);
  }

  let listSeq = 0;
  const datalist = (id, values) => `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`;
  const tempChip = (t) => {
    const x = TEMPERATURE.find((y) => y[0] === t);
    return x ? `<span class="chip" style="--c:${x[2]}"><i class="dot"></i>${x[1]}</span>` : "";
  };

  function section(key, title, summary, body) {
    const open = lsGet(OPEN_KEY, { lead: true })[key];
    return `<details data-sec="${key}" ${open ? "open" : ""}><summary>${title}<span class="olf-sum">${summary}</span></summary><div class="olf-body">${body}</div></details>`;
  }

  function field(group, key, title, value, { type = "text", list, cls = "", ph = "", attrs = "" } = {}) {
    const id = `olf-${group}-${key}`;
    const common = `data-g="${group}" data-k="${key}" id="${id}${listSeq}" placeholder="${esc(ph)}" ${attrs}`;
    const input =
      type === "textarea"
        ? `<textarea ${common} rows="2">${esc(value)}</textarea>`
        : `<input ${common} type="${type}" value="${esc(value)}" ${list ? `list="${list}"` : ""}>`;
    return `<label class="f ${cls}" for="${id}${listSeq}"><span>${title}</span>${input}</label>`;
  }

  function select(group, key, title, value, options, cls = "") {
    const id = `olf-${group}-${key}${listSeq}`;
    return `<label class="f ${cls}" for="${id}"><span>${title}</span><select id="${id}" data-g="${group}" data-k="${key}">
      <option value="">—</option>${options.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  }

  function render(m) {
    const d = m.data;
    const L = d.lead;
    const D = d.deal;
    const U = d.utm;
    listSeq++;
    const ls = (k) => `olf-dl-${k}-${listSeq}`;
    const lost = L.status === "perdido" || Boolean(D.lostReason);
    const weighted = typeof D.value === "number" && typeof D.probability === "number" ? D.value * (D.probability / 100) : null;
    const next = d.activities.find((a) => a.activity.nextAction || a.activity.nextAt)?.activity;
    const lastOwner = lsGet(OWNER_KEY, "") || L.owner || "";

    const leadBody = `
      ${m.identity ? `${field("id", "name", "Nome", d.name, { ph: "Nome do cliente", attrs: d.inLists ? "" : 'readonly title="Adicione o contato a uma lista para editar o nome"' })}
      ${field("id", "phone", "WhatsApp", globalThis.OrbitaChat?.formatPhone?.(m.phone) || m.phone, { attrs: "readonly" })}` : ""}
      ${field("lead", "email", "E-mail", L.email, { type: "email", ph: "nome@empresa.com" })}
      ${field("lead", "company", "Empresa", L.company)}
      ${field("lead", "source", "Origem", L.source, { list: ls("source"), ph: "Instagram, Indicação…" })}
      ${field("lead", "owner", "Responsável", L.owner, { list: ls("owner"), ph: "Quem atende" })}
      ${select("lead", "status", "Status", L.status, STATUS)}
      <label class="f"><span>Temperatura</span><div class="olf-temp" role="group" aria-label="Temperatura">${TEMPERATURE.map(
        ([v, l, c]) => `<button type="button" data-temp="${v}" style="--c:${c}" aria-pressed="${L.temperature === v}"><i class="dot"></i>${l}</button>`,
      ).join("")}</div></label>
      ${field("lead", "product", "Produto/serviço de interesse", L.product, { list: ls("product") })}
      ${field("lead", "potentialValue", "Valor potencial", fmtMoney(L.potentialValue), { ph: "R$ 0,00", attrs: 'inputmode="decimal" data-money' })}
      ${field("lead", "notes", "Observações", L.notes, { type: "textarea", cls: "wide" })}
      ${datalist(ls("source"), d.suggest.source)}${datalist(ls("owner"), d.suggest.owner)}${datalist(ls("product"), d.suggest.product)}`;

    const dealBody = `
      <label class="f"><span>Etapa</span><input readonly value="${esc(d.stage?.name || "—")}" title="A etapa é a do funil do CRM"></label>
      ${field("deal", "value", "Valor", fmtMoney(D.value), { ph: "R$ 0,00", attrs: 'inputmode="decimal" data-money' })}
      ${field("deal", "expectedCloseAt", "Previsão de fechamento", D.expectedCloseAt, { type: "date" })}
      ${field("deal", "probability", "Probabilidade (%)", D.probability ?? "", { type: "number", ph: "0–100", attrs: 'min="0" max="100" step="5"' })}
      ${weighted !== null ? `<div class="olf-hint wide">Valor ponderado: <b>${fmtMoney(weighted)}</b></div>` : ""}
      ${lost ? `${field("deal", "lostReason", "Motivo de perda", D.lostReason, { list: ls("lost"), cls: "wide", ph: "Por que não fechou?" })}${datalist(ls("lost"), d.suggest.lostReason)}` : `<div class="olf-hint wide">O motivo de perda aparece quando o status do lead for “Perdido”.</div>`}`;

    const acts = d.activities
      .slice(0, m.showAll ? undefined : 5)
      .map(({ id, ts, activity: a }) => `<div class="olf-act"><header><b>${esc(label(ACTIVITY, a.type) || "Atividade")}</b>· ${esc(fmtWhen(ts))}${a.owner ? ` · ${esc(a.owner)}` : ""}
        <button type="button" data-del="${esc(id)}">excluir</button></header>
        ${a.description ? `<p>${esc(a.description)}</p>` : ""}${a.result ? `<small>Resultado: ${esc(a.result)}</small>` : ""}
        ${a.nextAction || a.nextAt ? `<small>Próxima ação: ${esc(a.nextAction || "—")}${a.nextAt ? ` (${esc(fmtWhen(a.nextAt))})` : ""}</small>` : ""}</div>`)
      .join("");
    const actBody = `
      ${next ? `<div class="olf-next"><small class="olf-hint">Próxima ação</small><div><b>${esc(next.nextAction || "—")}</b>${next.nextAt ? ` · ${esc(fmtWhen(next.nextAt))}` : ""}</div></div>` : ""}
      <label class="f"><span>Tipo</span><select data-a="type">${ACTIVITY.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
      <label class="f"><span>Data/hora</span><input type="datetime-local" data-a="at" value="${toLocalInput(Date.now())}"></label>
      <label class="f"><span>Responsável</span><input data-a="owner" list="${ls("owner")}" value="${esc(lastOwner)}"></label>
      <label class="f wide"><span>Descrição</span><textarea data-a="description" rows="2" placeholder="O que foi feito ou conversado"></textarea></label>
      <label class="f"><span>Resultado</span><input data-a="result" list="${ls("result")}"></label>
      <label class="f"><span>Próxima ação</span><input data-a="nextAction" placeholder="Ex.: enviar proposta"></label>
      <label class="f"><span>Quando (próxima ação)</span><input type="datetime-local" data-a="nextAt"></label>
      <div class="wide"><button type="button" class="olf-btn" data-act="add">Registrar atividade</button></div>
      ${datalist(ls("result"), d.suggest.result)}
      ${d.activities.length ? `<div class="olf-sep"></div><div class="olf-acts">${acts}${d.activities.length > 5 && !m.showAll ? `<button type="button" class="olf-hint" data-act="all" style="border:0;background:none;cursor:pointer;justify-self:start;text-decoration:underline">Ver todas (${d.activities.length})</button>` : ""}</div>` : `<div class="olf-hint wide">Nenhuma atividade registrada.</div>`}`;

    const mkBody = UTM_KEYS.map((k) => {
      const t = { source: "UTM Source", medium: "UTM Medium", campaign: "UTM Campaign", landingPage: "Landing page" }[k];
      return `${field("utm", k, t, U[k], { list: ls(`utm-${k}`), cls: k === "landingPage" ? "wide" : "", ph: k === "landingPage" ? "https://…" : { source: "instagram, google…", medium: "cpc, social…", campaign: "black-friday…" }[k] })}${datalist(ls(`utm-${k}`), d.suggest.utm[k])}`;
    }).join("");

    const utmCount = UTM_KEYS.filter((k) => U[k]).length;
    m.el.innerHTML = `<div class="olf">
      ${m.error ? `<div class="olf-err">${esc(m.error)}</div>` : ""}
      ${section("lead", "Lead", `${tempChip(L.temperature)}${L.status ? `<span class="chip">${esc(label(STATUS, L.status))}</span>` : ""}`, leadBody)}
      ${section("deal", "Oportunidade", typeof D.value === "number" ? esc(fmtMoney(D.value)) : "", dealBody)}
      ${section("act", "Atividades", d.activities.length ? String(d.activities.length) : "", actBody)}
      ${section("utm", "Marketing", utmCount ? `${utmCount}/4` : "", mkBody)}
    </div>`;
  }

  async function reload(m) {
    try {
      m.data = await load(m.phone);
      m.error = "";
    } catch (e) {
      m.error = e.message;
      m.data ||= null;
    }
    if (m.data) render(m);
    else m.el.innerHTML = `<div class="olf"><div class="olf-err">${esc(m.error)}</div></div>`;
  }

  function flash(el) {
    el.classList.remove("saved");
    void el.offsetWidth;
    el.classList.add("saved");
  }

  async function saveInput(m, el) {
    const { g, k } = el.dataset;
    let v = el.value;
    if (g === "id") {
      if (k !== "name" || el.readOnly) return;
      if (!v.trim()) return (el.value = m.data.name);
      if (v.trim() === m.data.name) return;
      await rename(m.phone, v);
      m.data.name = v.trim();
      return flash(el);
    }
    if ("money" in el.dataset) {
      v = parseMoney(v);
      el.value = fmtMoney(v);
    } else if (k === "probability") {
      v = parseProbability(v);
      el.value = v ?? "";
    } else v = v.trim();
    const cur = m.data[g][k];
    if ((cur ?? "") === (v ?? "")) return;
    await setField(m.phone, g, k, v);
    if (v === undefined || v === "") delete m.data[g][k];
    else m.data[g][k] = v;
    flash(el);
    // campos que mudam outras partes da ficha
    if ((g === "lead" && k === "status") || (g === "deal" && (k === "value" || k === "probability"))) render(m);
    else if (g === "lead" && k === "owner" && v && !lsGet(OWNER_KEY, "")) lsSet(OWNER_KEY, v);
  }

  function bind(m) {
    const run = async (fn) => {
      try {
        await fn();
      } catch (e) {
        m.error = e.message;
        render(m);
      }
    };
    m.el.addEventListener("change", (e) => {
      const el = e.target;
      if (el.dataset?.g) run(() => saveInput(m, el));
    });
    m.el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches?.("input[data-g]")) e.target.blur();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target.closest?.("[data-sec=act]")) m.el.querySelector('[data-act="add"]')?.click();
    });
    m.el.addEventListener("toggle", (e) => {
      const sec = e.target.dataset?.sec;
      if (sec) lsSet(OPEN_KEY, { ...lsGet(OPEN_KEY, { lead: true }), [sec]: e.target.open });
    }, true);
    m.el.addEventListener("click", (e) => {
      const t = e.target.closest("[data-temp],[data-act],[data-del]");
      if (!t) return;
      if (t.dataset.temp)
        return run(async () => {
          const v = m.data.lead.temperature === t.dataset.temp ? undefined : t.dataset.temp; // clicar de novo desmarca
          await setField(m.phone, "lead", "temperature", v);
          if (v) m.data.lead.temperature = v;
          else delete m.data.lead.temperature;
          render(m);
        });
      if (t.dataset.del)
        return run(async () => {
          if (!confirm("Excluir esta atividade?")) return;
          await removeActivity(m.phone, t.dataset.del);
          await reload(m);
        });
      if (t.dataset.act === "all") {
        m.showAll = true;
        return render(m);
      }
      if (t.dataset.act === "add")
        return run(async () => {
          const val = (k) => m.el.querySelector(`[data-a="${k}"]`)?.value ?? "";
          const input = { type: val("type"), at: fromLocalInput(val("at")), owner: val("owner"), description: val("description"), result: val("result"), nextAction: val("nextAction"), nextAt: fromLocalInput(val("nextAt")) };
          t.disabled = true;
          try {
            await addActivity(m.phone, input);
          } finally {
            t.disabled = false;
          }
          if (input.owner.trim()) lsSet(OWNER_KEY, input.owner.trim());
          m.error = "";
          await reload(m);
        });
    });
  }

  // Monta a ficha em el. Chamar de novo com o mesmo el e telefone não faz nada
  // (o painel React chama a cada renderização).
  function mount(el, phone, opts = {}) {
    if (!el || !phone) return;
    if (el.__orbitaLead?.phone === phone) return;
    ensureCss();
    getChannel();
    let m = el.__orbitaLead;
    if (!m) {
      m = { el, identity: opts.identity !== false, data: null, error: "", showAll: false };
      m.reload = () => reload(m);
      el.__orbitaLead = m;
      bind(m);
      mounts.add(m);
    }
    m.phone = phone;
    m.data = null;
    m.showAll = false;
    reload(m);
  }

  // Selos no card do Kanban: temperatura e valor da oportunidade (ou potencial).
  function cardBadges(el, client) {
    if (!el) return;
    ensureCss();
    el.className = "olf-badges";
    const t = TEMPERATURE.find((x) => x[0] === client?.lead?.temperature);
    const value = client?.deal?.value ?? client?.lead?.potentialValue;
    const html = `${t ? `<span style="--c:${t[2]}"><i></i>${t[1]}</span>` : ""}${typeof value === "number" ? `<span>${esc(fmtMoney(value))}</span>` : ""}`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  globalThis.OrbitaLead = { pageId, mount, cardBadges, load, setField, addActivity, removeActivity, parseMoney, parseProbability, activityText, STATUS, TEMPERATURE, ACTIVITY };
})();
