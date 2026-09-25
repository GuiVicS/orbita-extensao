// E-mail marketing — dados, modelo do e-mail e público. Roda nas páginas da
// extensão (e as partes puras nos testes do Node). Expõe globalThis.OrbitaEmail.
//
// Tudo fica em chrome.storage.local (entra no backup; a chave não):
//   orbita:email:settings      { fromName, fromEmail, replyTo, company, address }
//   orbita:email:secrets       { apiKey }                      (fora do backup)
//   orbita:email:campaigns     [campanha]
//   orbita:email:rcpt:<id>     [{ email, firstName, lastName, phone, synced }]
//   orbita:email:suppressions  { "<email>": { reason, at } }  (descadastros sincronizados da Resend)
// Módulo liga/desliga: chrome.storage.local["orbita:modules"].email (padrão: desligado).
(() => {
  "use strict";
  if (globalThis.OrbitaEmail) return;

  const K = { settings: "orbita:email:settings", secrets: "orbita:email:secrets", campaigns: "orbita:email:campaigns", suppressions: "orbita:email:suppressions", rcpt: (id) => `orbita:email:rcpt:${id}` };
  const DEFAULT_SETTINGS = { fromName: "", fromEmail: "", replyTo: "", company: "", address: "" };
  const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
  const isEmail = (s) => EMAIL_RE.test(String(s || "").trim());

  const get = async (k, fallback) => (await chrome.storage.local.get(k))[k] ?? fallback;
  const set = (k, v) => chrome.storage.local.set({ [k]: v });

  async function moduleEnabled() {
    return Boolean((await get("orbita:modules", {})).email);
  }
  const loadSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await get(K.settings, {})) });
  const saveSettings = async (patch) => {
    const next = { ...(await loadSettings()), ...patch };
    await set(K.settings, next);
    return next;
  };
  const apiKey = async () => String((await get(K.secrets, {})).apiKey || "").trim();
  const setApiKey = async (key) => set(K.secrets, { ...(await get(K.secrets, {})), apiKey: String(key || "").trim() });

  // ---------------------------------------------------------- campanhas
  const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const campaigns = async () => (await get(K.campaigns, [])).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  async function saveCampaign(c) {
    const all = await get(K.campaigns, []);
    const now = Date.now();
    const next = { ...c, id: c.id || uuid(), createdAt: c.createdAt || now, updatedAt: now };
    const i = all.findIndex((x) => x.id === next.id);
    if (i >= 0) all[i] = next;
    else all.push(next);
    await set(K.campaigns, all);
    return next;
  }
  async function removeCampaign(id) {
    await set(K.campaigns, (await get(K.campaigns, [])).filter((c) => c.id !== id));
    await chrome.storage.local.remove(K.rcpt(id));
  }
  const recipients = async (id) => get(K.rcpt(id), []);
  const saveRecipients = (id, list) => set(K.rcpt(id), list);

  const suppressions = async () => get(K.suppressions, {});
  async function addSuppressions(emails, reason) {
    const cur = await suppressions();
    let added = 0;
    for (const e of emails) {
      const k = String(e).trim().toLowerCase();
      if (!k || cur[k]) continue;
      cur[k] = { reason, at: Date.now() };
      added++;
    }
    if (added) await set(K.suppressions, cur);
    return added;
  }

  // ------------------------------------------------------ modelo do e-mail
  // Variáveis da Órbita → personalização da Resend (só nome do contato existe lá).
  // Nome completo vai como first_name (primeiro nome) + last_name (o resto).
  const VAR_RE = /\{\{\s*([\w-]+)\s*(?:\|\s*([^}]*?))?\s*\}\}/g;
  const SUPPORTED = { nome: true, primeiro_nome: true };
  function unsupportedVars(...texts) {
    const bad = new Set();
    for (const t of texts) for (const m of String(t || "").matchAll(VAR_RE)) if (!SUPPORTED[m[1].toLowerCase()]) bad.add(m[1]);
    return [...bad];
  }
  function resendVars(s) {
    return String(s).replace(VAR_RE, (all, name, fb = "") => {
      const f = String(fb).replace(/[{}|]/g, "").trim();
      if (name.toLowerCase() === "primeiro_nome") return `{{{contact.first_name|${f}}}}`;
      if (name.toLowerCase() === "nome") return `{{{contact.first_name|${f}}}} {{{contact.last_name|}}}`;
      return all;
    });
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // texto simples → HTML: parágrafos, quebras, *negrito*, _itálico_ e links
  function inline(s) {
    return esc(s)
      .replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>")
      .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1<em>$2</em>")
      .replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#4f46e5">${u}</a>`);
  }

  const UNSUB = "{{{RESEND_UNSUBSCRIBE_URL}}}";
  function footerHtml(s) {
    const who = [s.company, s.address].filter(Boolean).map(esc).join(" · ");
    return `<tr><td style="padding:24px 32px;color:#6b7280;font-size:12px;line-height:1.5;text-align:center;border-top:1px solid #e5e7eb">
      ${who ? `${who}<br>` : ""}Você recebeu este e-mail por ser contato${s.company ? ` de ${esc(s.company)}` : ""}.<br>
      <a href="${UNSUB}" style="color:#6b7280;text-decoration:underline">Não quero mais receber estes e-mails</a></td></tr>`;
  }

  // Monta { html, text } prontos para a Resend. c: { subject, preheader, body, button, mode, html }
  function build(c, s) {
    const pre = c.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader)}</div>` : "";
    let html;
    if (c.mode === "html") {
      html = String(c.html || "");
      if (!html.includes("RESEND_UNSUBSCRIBE_URL")) {
        // sem o link de descadastro, acrescenta o rodapé (obrigatório)
        const foot = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${footerHtml(s)}</table>`;
        html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${foot}</body>`) : html + foot;
      }
    } else {
      const paras = String(c.body || "")
        .trim()
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((p) => `<p style="margin:0 0 16px">${inline(p).replace(/\n/g, "<br>")}</p>`)
        .join("");
      const btn = c.button?.text && c.button?.url ? `<p style="margin:24px 0"><a href="${esc(c.button.url)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600">${esc(c.button.text)}</a></p>` : "";
      html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6">${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111827;font-size:16px;line-height:1.6">
<tr><td style="padding:32px 32px 8px">${paras}${btn}</td></tr>
${footerHtml(s)}
</table></td></tr></table></body></html>`;
    }
    const text = [
      c.mode === "html" ? String(c.html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim() : String(c.body || "").trim(),
      c.button?.text && c.button?.url && c.mode !== "html" ? `${c.button.text}: ${c.button.url}` : "",
      "—",
      [s.company, s.address].filter(Boolean).join(" · "),
      `Para não receber mais: ${UNSUB}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    return { subject: resendVars(c.subject || ""), html: resendVars(pre && c.mode === "html" ? html.replace(/<body[^>]*>/i, (b) => b + pre) : html), text: resendVars(text) };
  }

  // Prévia na tela: as variáveis com um contato de exemplo.
  function sample(str, contact = { firstName: "Maria", lastName: "Souza" }) {
    return String(str)
      .replace(/\{\{\{contact\.first_name\|([^}]*)\}\}\}/g, (a, f) => contact.firstName || f)
      .replace(/\{\{\{contact\.last_name\|([^}]*)\}\}\}/g, (a, f) => contact.lastName || f)
      .replace(/\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/g, "#descadastro");
  }

  // ------------------------------------------------------------ público
  const splitName = (name) => {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
  };
  const emailOfVars = (vars = {}) => Object.entries(vars).find(([k, v]) => /^e-?mail$/i.test(k.trim()) && isEmail(v))?.[1];

  // Lê as listas e o CRM do banco "orbita". audience: { lists: "all" | [ids], stageIds?: [ids] }
  async function collect(audience) {
    const db = await globalThis.OrbitaChat.openMainDbReadOnly();
    if (!db) throw new Error("O banco da Órbita ainda não existe. Abra o painel uma vez.");
    const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
    try {
      const has = (n) => db.objectStoreNames.contains(n);
      const tx = db.transaction(["listContacts", "crmClients"].filter(has));
      const contacts = has("listContacts") ? await req(tx.objectStore("listContacts").getAll()) : [];
      const crm = new Map((has("crmClients") ? await req(tx.objectStore("crmClients").getAll()) : []).map((c) => [c.phone, c]));
      const wantLists = audience.lists === "all" ? null : new Set(audience.lists || []);
      const wantStages = audience.stageIds?.length ? new Set(audience.stageIds) : null;
      const byEmail = new Map();
      let noEmail = 0;
      const seenPhones = new Set();
      for (const c of contacts) {
        if (wantLists && !wantLists.has(c.listId)) continue;
        const rec = crm.get(c.phone);
        if (wantStages && !wantStages.has(rec?.stageId)) continue;
        const email = String(emailOfVars(c.vars) || rec?.lead?.email || "").trim().toLowerCase();
        if (!isEmail(email)) {
          if (!seenPhones.has(c.phone)) noEmail++;
          seenPhones.add(c.phone);
          continue;
        }
        seenPhones.add(c.phone);
        if (!byEmail.has(email)) byEmail.set(email, { email, ...splitName(c.name), phone: c.phone });
      }
      const sup = await suppressions();
      const out = [];
      let suppressed = 0;
      for (const r of byEmail.values()) sup[r.email] ? suppressed++ : out.push(r);
      return { recipients: out, noEmail, suppressed };
    } finally {
      db.close();
    }
  }

  globalThis.OrbitaEmail = {
    K, DEFAULT_SETTINGS, isEmail, moduleEnabled, loadSettings, saveSettings, apiKey, setApiKey,
    campaigns, saveCampaign, removeCampaign, recipients, saveRecipients, suppressions, addSuppressions,
    unsupportedVars, resendVars, build, sample, splitName, emailOfVars, collect, UNSUB,
  };
})();
