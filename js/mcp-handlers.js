// Agente local (MCP) — o que cada ferramenta faz, dentro do service worker.
// Usa as mesmas camadas do resto da extensão (nada de formato novo):
//   OrbitaChat      conversas e mensagens (IndexedDB "orbita-chat")
//   OrbitaChatOps   operações das Conversas (abrir, enviar, traduzir, grupos…)
//   OrbitaCrm       CRM no formato do painel (js/crm-edit.js)
//   banco "orbita"  listas, agenda, campanhas (formato do painel minificado)
// Expõe globalThis.OrbitaMcpHandlers = { run(name, args) }.
(() => {
  "use strict";
  if (globalThis.OrbitaMcpHandlers) return;
  const C = globalThis.OrbitaChat;

  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  const done = (tx) => new Promise((res, rej) => ((tx.oncomplete = res), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error || new Error("Operação cancelada.")))));
  const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const fail = (msg) => {
    throw Object.assign(new Error(msg), { user: true });
  };
  const clamp = (n, min, max, d) => (Number.isFinite(Number(n)) ? Math.max(min, Math.min(max, Math.floor(Number(n)))) : d);
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const digits = (p) => String(p ?? "").replace(/\D/g, "");

  // horário local com fuso (o agente entende e mostra certo)
  function iso(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    const off = -d.getTimezoneOffset();
    const p = (n) => String(Math.abs(n)).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? "+" : "-"}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
  }
  function parseWhen(v, what) {
    if (v == null || v === "") return null;
    const t = typeof v === "number" ? v : Date.parse(String(v));
    if (!Number.isFinite(t)) fail(`Data inválida em ${what}: use ISO 8601, ex.: 2026-09-30T14:00:00-03:00.`);
    return t;
  }

  // ---------------------------------------------------------------- banco "orbita"
  async function withMain(fn) {
    const db = await C.openMainDbReadOnly();
    if (!db) fail("O banco da Órbita ainda não existe: abra o painel da Órbita uma vez.");
    try {
      return await fn(db, (n) => db.objectStoreNames.contains(n));
    } finally {
      db.close();
    }
  }
  const getAll = (db, has, name) => (has(name) ? req(db.transaction(name).objectStore(name).getAll()) : Promise.resolve([]));
  let channel = null;
  function notify(topic, id) {
    try {
      channel ||= new BroadcastChannel("orbita-data");
      channel.postMessage({ topic, id });
    } catch {}
  }
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0);

  // Um "lead" = contato de alguma lista e/ou registro do CRM (mesmo critério do painel).
  async function loadLeads() {
    return withMain(async (db, has) => {
      const [stages, clients, contacts, lists, appts] = await Promise.all([getAll(db, has, "crmStages"), getAll(db, has, "crmClients"), getAll(db, has, "listContacts"), getAll(db, has, "lists"), getAll(db, has, "appointments")]);
      stages.sort(byOrder);
      const listName = new Map(lists.map((l) => [l.id, l.name]));
      const map = new Map();
      for (const c of contacts) {
        const cur = map.get(c.phone) || { phone: c.phone, name: "", lists: [], vars: {} };
        if (!cur.name && c.name) cur.name = c.name;
        cur.lists.push(listName.get(c.listId) || c.listId);
        Object.assign(cur.vars, c.vars || {});
        map.set(c.phone, cur);
      }
      for (const r of clients) map.set(r.phone, { ...(map.get(r.phone) || { phone: r.phone, name: "", lists: [], vars: {} }), record: r });
      const stageOf = (r) => (r && stages.some((s) => s.id === r.stageId) ? r.stageId : stages[0]?.id);
      // última mensagem no WhatsApp também conta como interação
      const lastChat = new Map();
      for (const c of await C.listChats()) {
        if (c.isGroup || !c.lastMessageAt) continue;
        for (const v of C.phoneVariants(digits(c.phone || c.chatId))) lastChat.set(v, Math.max(lastChat.get(v) || 0, c.lastMessageAt));
      }
      const leads = [...map.values()].map((l) => ({ ...l, stageId: stageOf(l.record), chatAt: lastChat.get(l.phone) || null }));
      return { stages, leads, lists, appts };
    });
  }
  function leadSummary(l, stages) {
    const r = l.record || {};
    const last = Math.max(r.lastInteractionAt || 0, r.history?.filter((h) => h.kind !== "stage").at(-1)?.ts || 0, l.chatAt || 0) || null;
    return {
      phone: l.phone,
      name: l.name || null,
      stage: stages.find((s) => s.id === l.stageId)?.name || null,
      stageId: l.stageId || null,
      tags: r.tags || [],
      temperature: r.lead?.temperature || null,
      status: r.lead?.status || null,
      source: r.lead?.source || null,
      company: r.lead?.company || null,
      dealValue: r.deal?.value ?? null,
      lastInteraction: iso(last),
      attention: r.attention ? (typeof r.attention === "string" ? r.attention : r.attention.reason || r.attention.text || "sim") : null,
      lists: l.lists,
    };
  }

  function leadMatches({ l, s }, a) {
    const q = norm(a.query);
    const stale = a.staleDays ? Date.now() - Number(a.staleDays) * 864e5 : null;
    if (a.stageId && l.stageId !== a.stageId) return false;
    if (a.tag && !s.tags.some((t) => norm(t) === norm(a.tag))) return false;
    if (a.temperature && s.temperature !== a.temperature) return false;
    if (a.status && s.status !== a.status) return false;
    if (stale && s.lastInteraction && Date.parse(s.lastInteraction) > stale) return false;
    return !q || norm(`${s.name || ""} ${l.phone} ${s.tags.join(" ")} ${s.company || ""} ${l.record?.lead?.email || ""}`).includes(q);
  }

  // ---------------------------------------------------------------- conversas
  const ops = () => {
    if (!globalThis.OrbitaChatOps) fail("As Conversas não estão disponíveis.");
    return globalThis.OrbitaChatOps;
  };
  const waStatus = () => globalThis.OrbitaChatOps?.status?.() || { connected: false, ready: false };
  const chatName = (c) => c?.name || c?.pushname || C.formatPhone(c?.phone) || String(c?.chatId || "").split("@")[0];
  function msgText(m) {
    if (m.revoked) return m.fromMe ? "(você apagou esta mensagem)" : "(mensagem apagada)";
    if (m.type === "audio") return m.audio?.transcript ? `[áudio ${Math.round(m.audio?.duration || 0)}s] ${m.audio.transcript}` : `[áudio ${Math.round(m.audio?.duration || 0)}s sem transcrição]`;
    const label = { image: "[foto]", video: "[vídeo]", sticker: "[figurinha]", document: "[documento]", other: "[arquivo]", location: "[localização]", vcard: "[contato]" }[m.type];
    const t = m.text || m.caption || "";
    return label ? `${label}${m.filename ? ` ${m.filename}` : ""}${t ? ` ${t}` : ""}` : t;
  }
  function compact(m, chat, byId) {
    const out = { id: m.id, at: iso(m.ts), from: m.fromMe ? "Você" : chat?.isGroup ? m.authorName || C.formatPhone(m.authorPhone) || "Participante" : chatName(chat), type: m.type || "text", text: msgText(m) };
    const tr = !m.fromMe && m.translationStatus === "done" && m.translatedText;
    if (tr && tr !== m.text) out.translationPt = tr;
    if (m.fromMe && m.textPt && m.textPt !== m.text) out.writtenPt = m.textPt;
    if (m.audio?.dub?.status === "done") out.dubbed = true;
    const q = m.quotedId && byId?.get(m.quotedId);
    if (q) out.replyTo = { id: q.id, text: msgText(q).slice(0, 160) };
    else if (m.quoted?.text) out.replyTo = { text: String(m.quoted.text).slice(0, 160) };
    return out;
  }
  async function allMessages() {
    const db = await C.openDb(); // conexão compartilhada: não fechar
    return req(db.transaction("messages").objectStore("messages").getAll());
  }
  const awaiting = (c) => (c.lastFromMe === false || (c.unreadCount || 0) > 0) && c.lastMessageAt;
  async function chatsWithLeads() {
    const [chats, index] = await Promise.all([C.listChats(), C.loadClientIndex()]);
    return chats.map((c) => ({ chat: c, lead: c.isGroup ? null : C.findClient(index, c.phone || c.chatId.split("@")[0]) }));
  }
  function chatRow({ chat: c, lead }, stages) {
    return {
      chatId: c.chatId,
      name: chatName(c),
      phone: c.isGroup ? null : c.phone || c.chatId.split("@")[0],
      isGroup: Boolean(c.isGroup),
      unread: c.unreadCount || 0,
      lastMessageAt: iso(c.lastMessageAt),
      lastMessage: c.lastPreview ? `${c.lastFromMe ? "Você: " : ""}${c.lastPreview}` : null,
      awaitingReply: Boolean(!c.isGroup && awaiting(c)),
      translation: c.translation?.enabled ? c.translation.contactLang || "auto" : null,
      lead: lead ? { name: lead.name || null, stage: stages?.find((s) => s.id === lead.stageId)?.name || null, tags: lead.tags || [] } : null,
    };
  }
  async function stagesSafe() {
    try {
      return await withMain(async (db, has) => (await getAll(db, has, "crmStages")).sort(byOrder));
    } catch {
      return [];
    }
  }
  async function resolveChat(args) {
    let chatId = String(args.chatId || "").trim();
    if (!chatId && args.phone) {
      const d = digits(args.phone);
      if (!/^\d{8,15}$/.test(d)) fail("Telefone inválido.");
      const chats = await C.listChats();
      const hit = chats.find((c) => !c.isGroup && C.phoneVariants(d).some((v) => digits(c.phone || c.chatId) === v));
      chatId = hit?.chatId || `${d}@c.us`;
    }
    if (!/^[\w.-]+@(c\.us|g\.us|lid)$/.test(chatId)) fail("Informe chatId (ex.: 5511999998888@c.us) ou phone.");
    return chatId;
  }

  // ---------------------------------------------------------------- ferramentas
  const H = {
    async orbita_status() {
      const [chats, leads, modules, s] = await Promise.all([C.listChats(), loadLeads().catch(() => null), chrome.storage.local.get("orbita:modules").then((r) => r["orbita:modules"] || {}), waStatus()]);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const campaigns = await withMain(async (db, has) => getAll(db, has, "campaigns")).catch(() => []);
      return {
        extensionVersion: chrome.runtime.getManifest().version,
        now: iso(Date.now()),
        whatsapp: { connected: Boolean(s.connected), ready: Boolean(s.ready), note: s.ready ? "WhatsApp Web aberto e pronto." : "Abra o WhatsApp Web numa aba do Chrome para ler mensagens novas e enviar." },
        modules: { crm: modules.crm !== false, agenda: modules.agenda !== false, conversas: modules.conversas !== false, email: modules.email === true },
        chats: { total: chats.length, unread: chats.filter((c) => c.unreadCount > 0).length, awaitingReply: chats.filter((c) => !c.isGroup && awaiting(c)).length, groups: chats.filter((c) => c.isGroup).length },
        crm: leads ? { leads: leads.leads.length, byStage: leads.stages.map((st) => ({ stageId: st.id, stage: st.name, count: leads.leads.filter((l) => l.stageId === st.id).length })) } : null,
        lists: leads?.lists.length ?? null,
        appointmentsToday: leads ? leads.appts.filter((a) => a.status === "scheduled" && a.start >= today.getTime() && a.start < today.getTime() + 864e5).length : null,
        activeCampaigns: campaigns.filter((c) => ["SCHEDULED", "RUNNING", "BLOCKED", "READY_TO_RESUME", "PAUSED"].includes(c.status)).map((c) => ({ id: c.id, name: c.name, status: c.status, sent: c.stats?.sent || 0, total: c.stats?.total || 0 })),
      };
    },

    async list_chats(a) {
      const f = a.filter || "all";
      const q = norm(a.query);
      const [rows, stages] = await Promise.all([chatsWithLeads(), stagesSafe()]);
      const list = rows.filter(({ chat: c, lead }) => {
        if (f === "unread" && !(c.unreadCount > 0)) return false;
        if (f === "groups" && !c.isGroup) return false;
        if (f === "contacts" && c.isGroup) return false;
        if (f === "awaiting_reply" && (c.isGroup || !awaiting(c))) return false;
        if (f === "not_in_crm" && (c.isGroup || lead)) return false;
        return !q || norm(`${chatName(c)} ${c.phone || ""} ${c.lastPreview || ""} ${lead?.name || ""}`).includes(q);
      });
      const limit = clamp(a.limit, 1, 200, 50);
      return { total: list.length, chats: list.slice(0, limit).map((r) => chatRow(r, stages)) };
    },

    async get_messages(a) {
      const chatId = await resolveChat(a);
      const limit = clamp(a.limit, 1, 300, 60);
      const before = parseWhen(a.before, "before");
      const since = parseWhen(a.since, "since");
      let warning = null;
      // WhatsApp aberto: traz as mais recentes antes de ler
      if (!before && waStatus().ready) {
        try {
          const r = await ops().handle({ op: C.OPS.OPEN, chatId });
          warning = r.warning || null;
        } catch (e) {
          warning = e.message;
        }
      } else if (!waStatus().ready) warning = "WhatsApp Web fechado: mostrando só o que já estava salvo na Órbita.";
      const chat = await C.getChat(chatId);
      if (!chat) fail("Conversa não encontrada. Veja list_chats.");
      let msgs = await C.messagesPage(chatId, { beforeTs: before || undefined, limit: Math.min(300, since ? 300 : limit) });
      if (since) msgs = msgs.filter((m) => m.ts >= since);
      msgs = msgs.slice(-limit);
      const byId = new Map(msgs.map((m) => [m.id, m]));
      return {
        chat: { chatId, name: chatName(chat), isGroup: Boolean(chat.isGroup), phone: chat.isGroup ? null : chat.phone || chatId.split("@")[0], translation: chat.translation?.enabled ? chat.translation.contactLang || "auto" : null },
        warning,
        count: msgs.length,
        hasOlder: msgs.length > 0 && !(chat.historyComplete && msgs.length < limit),
        messages: msgs.map((m) => compact(m, chat, byId)),
      };
    },

    async search_messages(a) {
      const q = norm(a.query).trim();
      if (q.length < 2) fail("Busca curta demais.");
      const since = parseWhen(a.since, "since");
      const chatId = a.chatId ? String(a.chatId) : null;
      const [msgs, chats] = await Promise.all([allMessages(), C.listChats()]);
      const byChat = new Map(chats.map((c) => [c.chatId, c]));
      const hits = msgs
        .filter((m) => (!chatId || m.chatId === chatId) && (!since || m.ts >= since) && !m.revoked)
        .filter((m) => norm(`${m.text || ""} ${m.caption || ""} ${m.translatedText || ""} ${m.textPt || ""} ${m.audio?.transcript || ""}`).includes(q))
        .sort((x, y) => y.ts - x.ts);
      const limit = clamp(a.limit, 1, 200, 50);
      return { total: hits.length, results: hits.slice(0, limit).map((m) => ({ chatId: m.chatId, chat: chatName(byChat.get(m.chatId)), ...compact(m, byChat.get(m.chatId)) })) };
    },

    async awaiting_reply(a) {
      const hours = Math.max(0, Number(a.hours) || 0);
      const cutoff = Date.now() - hours * 3600e3;
      const [rows, stages] = await Promise.all([chatsWithLeads(), stagesSafe()]);
      const list = rows.filter(({ chat: c }) => (a.includeGroups || !c.isGroup) && awaiting(c) && c.lastMessageAt <= cutoff).sort((x, y) => x.chat.lastMessageAt - y.chat.lastMessageAt);
      return { total: list.length, chats: list.slice(0, clamp(a.limit, 1, 200, 50)).map((r) => ({ ...chatRow(r, stages), waitingHours: Math.round((Date.now() - r.chat.lastMessageAt) / 36e5 * 10) / 10 })) };
    },

    async chat_metrics(a) {
      const since = parseWhen(a.since, "since") ?? Date.now() - 7 * 864e5;
      const [msgs, chats] = await Promise.all([allMessages(), C.listChats()]);
      const byChat = new Map(chats.map((c) => [c.chatId, c]));
      const inPeriod = msgs.filter((m) => m.ts >= since && !m.revoked && (a.includeGroups || !String(m.chatId).endsWith("@g.us")));
      const received = inPeriod.filter((m) => !m.fromMe);
      const sent = inPeriod.filter((m) => m.fromMe);
      // primeira resposta: da 1ª mensagem do cliente (após uma sua) até a sua próxima
      const waits = [];
      const groups = new Map();
      for (const m of inPeriod) (groups.get(m.chatId) || groups.set(m.chatId, []).get(m.chatId)).push(m);
      const perChat = [];
      for (const [chatId, list] of groups) {
        list.sort((x, y) => x.ts - y.ts);
        let open = null;
        for (const m of list) {
          if (!m.fromMe && open === null) open = m.ts;
          else if (m.fromMe && open !== null) {
            waits.push(m.ts - open);
            open = null;
          }
        }
        perChat.push({ chatId, name: chatName(byChat.get(chatId)), received: list.filter((m) => !m.fromMe).length, sent: list.filter((m) => m.fromMe).length, waitingSince: open ? iso(open) : null });
      }
      waits.sort((x, y) => x - y);
      const min = (ms) => (ms == null ? null : Math.round(ms / 6e4));
      const hours = Array(24).fill(0);
      for (const m of received) hours[new Date(m.ts).getHours()]++;
      const weekdays = Array(7).fill(0);
      for (const m of received) weekdays[new Date(m.ts).getDay()]++;
      return {
        since: iso(since), until: iso(Date.now()),
        messages: { received: received.length, sent: sent.length, audiosReceived: received.filter((m) => m.type === "audio").length },
        activeChats: groups.size,
        firstResponseMinutes: { average: min(waits.length ? waits.reduce((x, y) => x + y, 0) / waits.length : null), median: min(waits.length ? waits[Math.floor(waits.length / 2)] : null), p90: min(waits.length ? waits[Math.floor(waits.length * 0.9)] : null), samples: waits.length },
        busiestHours: hours.map((n, h) => ({ hour: h, received: n })).filter((x) => x.received).sort((x, y) => y.received - x.received).slice(0, 5),
        byWeekday: ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"].map((d, i) => ({ day: d, received: weekdays[i] })),
        topChats: perChat.sort((x, y) => y.received + y.sent - (x.received + x.sent)).slice(0, 10),
        waitingNow: perChat.filter((c) => c.waitingSince).sort((x, y) => Date.parse(x.waitingSince) - Date.parse(y.waitingSince)).slice(0, 20),
      };
    },

    async list_tags() {
      const { leads } = await loadLeads();
      const count = new Map();
      for (const l of leads)
        for (const t of l.record?.tags || []) {
          const k = norm(t);
          count.set(k, { tag: count.get(k)?.tag ?? t, leads: (count.get(k)?.leads ?? 0) + 1 });
        }
      return { tags: [...count.values()].sort((x, y) => y.leads - x.leads) };
    },

    async pipeline_report() {
      const { stages, leads } = await loadLeads();
      const now = Date.now();
      const sums = leads.map((l) => ({ l, s: leadSummary(l, stages) }));
      const lastOf = (s) => (s.lastInteraction ? Date.parse(s.lastInteraction) : null);
      const tally = (list, key) => list.reduce((acc, x) => ((acc[x.s[key] || "sem"] = (acc[x.s[key] || "sem"] || 0) + 1), acc), {});
      const money = (list, f) => Math.round(list.reduce((acc, x) => acc + (Number(f(x)) || 0), 0) * 100) / 100;
      return {
        totalLeads: leads.length,
        byStage: stages.map((st) => {
          const list = sums.filter((x) => x.l.stageId === st.id);
          return { stageId: st.id, stage: st.name, leads: list.length, dealValue: money(list, (x) => x.l.record?.deal?.value), potentialValue: money(list, (x) => x.l.record?.lead?.potentialValue), hot: list.filter((x) => x.s.temperature === "quente").length, staleOver7d: list.filter((x) => !lastOf(x.s) || now - lastOf(x.s) > 7 * 864e5).length };
        }),
        byTemperature: tally(sums, "temperature"),
        byStatus: tally(sums, "status"),
        bySource: tally(sums, "source"),
        stale: { over7Days: sums.filter((x) => lastOf(x.s) && now - lastOf(x.s) > 7 * 864e5).length, over30Days: sums.filter((x) => lastOf(x.s) && now - lastOf(x.s) > 30 * 864e5).length, neverContacted: sums.filter((x) => !lastOf(x.s)).length },
        withoutProfile: sums.filter((x) => !x.l.record?.lead || !Object.values(x.l.record.lead).some(Boolean)).length,
        totalDealValue: money(sums, (x) => x.l.record?.deal?.value),
        needAttention: sums.filter((x) => x.s.attention).slice(0, 20).map((x) => ({ phone: x.s.phone, name: x.s.name, attention: x.s.attention })),
        topTags: (await H.list_tags()).tags.slice(0, 10),
      };
    },

    async list_stages() {
      const { stages, leads } = await loadLeads();
      return { stages: stages.map((s) => ({ stageId: s.id, name: s.name, color: s.color || null, leads: leads.filter((l) => l.stageId === s.id).length })) };
    },

    async list_leads(a) {
      const { stages, leads } = await loadLeads();
      let list = leads.map((l) => ({ l, s: leadSummary(l, stages) })).filter((x) => leadMatches(x, a));
      list.sort((x, y) => (Date.parse(y.s.lastInteraction || 0) || 0) - (Date.parse(x.s.lastInteraction || 0) || 0));
      const offset = clamp(a.offset, 0, 1e9, 0);
      const limit = clamp(a.limit, 1, 500, 100);
      return { total: list.length, offset, leads: list.slice(offset, offset + limit).map((x) => x.s) };
    },

    async get_lead(a) {
      const phone = digits(a.phone);
      const { stages, leads, appts } = await loadLeads();
      const l = leads.find((x) => C.phoneVariants(phone).includes(x.phone));
      if (!l) fail("Lead não encontrado. Use list_leads, ou update_lead para criar.");
      const r = l.record || {};
      const chats = await C.listChats();
      const chat = chats.find((c) => !c.isGroup && C.phoneVariants(l.phone).includes(digits(c.phone || c.chatId)));
      return {
        ...leadSummary(l, stages),
        vars: l.vars,
        lead: r.lead || {},
        deal: r.deal || {},
        utm: r.utm || {},
        autoReply: Boolean(r.autoReply),
        history: [...(r.history || [])].sort((x, y) => y.ts - x.ts).slice(0, 50).map((h) => ({ at: iso(h.ts), kind: h.kind, text: h.text, ...(h.activity ? { activity: h.activity } : {}) })),
        appointments: appts.filter((x) => x.phone === l.phone).sort((x, y) => y.start - x.start).slice(0, 20).map(apptOut),
        chat: chat ? { chatId: chat.chatId, unread: chat.unreadCount || 0, lastMessageAt: iso(chat.lastMessageAt), lastMessage: chat.lastPreview || null } : null,
      };
    },

    async list_lists() {
      return withMain(async (db, has) => ({ lists: (await getAll(db, has, "lists")).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0)).map((l) => ({ listId: l.id, name: l.name, source: l.source || null, count: l.count || 0, variables: l.variableKeys || [], updatedAt: iso(l.updatedAt) })) }));
    },

    async get_list(a) {
      return withMain(async (db, has) => {
        const list = has("lists") ? await req(db.transaction("lists").objectStore("lists").get(String(a.listId))) : null;
        if (!list) fail("Lista não encontrada. Veja list_lists.");
        const contacts = (await req(db.transaction("listContacts").objectStore("listContacts").index("byList").getAll(list.id))).sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
        const offset = clamp(a.offset, 0, 1e9, 0);
        const limit = clamp(a.limit, 1, 1000, 200);
        return { listId: list.id, name: list.name, total: contacts.length, contacts: contacts.slice(offset, offset + limit).map((c) => ({ phone: c.phone, name: c.name || null, vars: c.vars || {} })) };
      });
    },

    async list_appointments(a) {
      const from = parseWhen(a.from, "from") ?? new Date().setHours(0, 0, 0, 0);
      const to = parseWhen(a.to, "to") ?? from + 30 * 864e5;
      return withMain(async (db, has) => {
        let list = (await getAll(db, has, "appointments")).filter((x) => x.start >= from && x.start <= to);
        if (a.status) list = list.filter((x) => x.status === a.status);
        if (a.phone) list = list.filter((x) => C.phoneVariants(digits(a.phone)).includes(x.phone));
        return { from: iso(from), to: iso(to), appointments: list.sort((x, y) => x.start - y.start).map(apptOut) };
      });
    },

    async list_campaigns(a) {
      return withMain(async (db, has) => {
        const lists = new Map((await getAll(db, has, "lists")).map((l) => [l.id, l.name]));
        let list = await getAll(db, has, "campaigns");
        if (a.status) list = list.filter((c) => c.status === a.status);
        return { campaigns: list.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0)).map((c) => ({ campaignId: c.id, name: c.name, status: c.status, list: lists.get(c.listId) || null, stats: c.stats || {}, updatedAt: iso(c.updatedAt) })) };
      });
    },

    async get_campaign(a) {
      return withMain(async (db, has) => {
        const c = has("campaigns") ? await req(db.transaction("campaigns").objectStore("campaigns").get(String(a.campaignId))) : null;
        if (!c) fail("Campanha não encontrada. Veja list_campaigns.");
        const failed = has("recipients") ? (await req(db.transaction("recipients").objectStore("recipients").index("byCampaign").getAll(c.id))).filter((r) => r.status === "failed").slice(0, 50) : [];
        const list = c.listId && has("lists") ? await req(db.transaction("lists").objectStore("lists").get(c.listId)) : null;
        return {
          campaignId: c.id, name: c.name, status: c.status, list: list ? { listId: list.id, name: list.name, count: list.count } : null, stats: c.stats || {}, pacing: c.pacing || {},
          steps: (c.steps || []).map((s) => ({ kind: s.kind, text: s.text || s.caption || null })), createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt),
          failedRecipients: failed.map((r) => ({ phone: r.phone, name: r.name || null, error: r.error || r.lastError || null })),
        };
      });
    },

    async list_quick_replies(a) {
      const data = await globalThis.OrbitaQR.load();
      const q = norm(a.query).replace(/^\//, "");
      const cats = new Map((data.categories || []).map((c) => [c.id, c.name]));
      const items = (data.items || []).filter((i) => !q || norm(i.shortcut).includes(q) || norm(i.title).includes(q));
      return { quickReplies: items.map((i) => ({ quickReplyId: i.id, shortcut: i.shortcut, title: i.title, category: cats.get(i.categoryId) || null, favorite: Boolean(i.favorite), steps: (i.steps || []).map((s) => ({ type: s.type, text: s.text || s.caption || null })) })) };
    },

    async get_last_summary(a) {
      const hist = (await chrome.storage.local.get("orbita:summary:history"))["orbita:summary:history"] || [];
      const s = hist[clamp(a.index, 0, 9, 0)];
      if (!s) return { summary: null, note: "Nenhum resumo ainda. Ele é gerado no painel (Gerar resumo)." };
      const m = s.merged || {};
      const item = (i) => ({ text: i.text, who: i.who || null, chat: i.chatName || null, chatId: i.chatId || null, at: iso(i.ts), date: i.date || null, time: i.time || null });
      return { at: iso(s.at), since: iso(s.since), overview: s.overview || null, needsReply: (m.pending || []).map(item), dated: (m.dated || []).map(item), notices: (m.notices || []).map(item), links: (m.links || []).map(item), perChat: (m.chats || []).map((c) => ({ chat: c.chatName, chatId: c.chatId, summary: c.summary })), available: hist.length };
    },

    async summary_source(a) {
      if (!waStatus().ready) fail("Abra o WhatsApp Web numa aba do Chrome para montar o resumo.");
      const store = await chrome.storage.local.get(["orbita:summary:last", "orbita:summary:excluded"]);
      const period = ["last", "24h", "3d", "7d"].includes(a.period) ? a.period : "last";
      const since = parseWhen(a.since, "since") ?? (period === "last" ? store["orbita:summary:last"] || Date.now() - 864e5 : Date.now() - { "24h": 1, "3d": 3, "7d": 7 }[period] * 864e5);
      const offset = clamp(a.offset, 0, 1e6, 0);
      const limit = clamp(a.limit, 1, 40, 15);
      const includeGroups = a.includeGroups !== false;
      let ses = (await chrome.storage.local.get(SUMMARY_KEY))[SUMMARY_KEY];
      // nova sessão na primeira página (ou se o período mudou)
      const periodKey = a.since ? `since:${since}` : period;
      if (!ses || offset === 0 || ses.periodKey !== periodKey || ses.includeGroups !== includeGroups) {
        const excluded = store["orbita:summary:excluded"] || [];
        const chats = (await ops().handle({ op: C.OPS.SUMMARY_CHATS, since, excluded })).filter((c) => includeGroups || !c.isGroup);
        ses = { since, until: Date.now(), period: a.since ? "custom" : period, periodKey, includeGroups, excludedCount: excluded.length, chats, info: {}, msgs: {} };
      }
      const page = ses.chats.slice(offset, offset + limit);
      const out = [];
      for (const c of page) {
        const r = await ops().handle({ op: C.OPS.SUMMARY_RAW, since: ses.since, chatId: c.chatId, name: c.name, isGroup: c.isGroup, transcribe: Boolean(a.transcribe), maxAudioSec: 300 });
        ses.info[c.chatId] = { name: c.name, isGroup: c.isGroup, count: r.count, skippedAudio: r.skippedAudio, skippedMedia: r.skippedMedia, lastMine: r.lastMine };
        for (const m of r.messages) ses.msgs[m.id] = { chatId: c.chatId, ts: m.ts, who: m.who, text: String(m.text).slice(0, 600), fromMe: m.fromMe, context: m.context };
        if (!r.count) continue; // só contexto ou só “ok/obrigado”: nada a resumir
        out.push({
          chatId: c.chatId, name: c.name, isGroup: c.isGroup, unread: c.unreadCount || 0, newMessages: r.count,
          iRepliedLastAt: iso(r.lastMine) || null, audiosWithoutText: r.skippedAudio, mediaWithoutText: r.skippedMedia,
          messages: r.messages.map((m) => ({ id: m.id, at: iso(m.ts), who: m.who, text: m.text, ...(m.context || m.mentionsMe || m.repliesMe ? { flags: [m.context ? "contexto" : "", m.mentionsMe ? "te marcou" : "", m.repliesMe ? "respondendo você" : ""].filter(Boolean) } : {}) })),
        });
      }
      await chrome.storage.local.set({ [SUMMARY_KEY]: ses });
      const next = offset + limit < ses.chats.length ? offset + limit : null;
      return {
        since: iso(ses.since), until: iso(ses.until), period: ses.period, excludedGroups: ses.excludedCount,
        totalChats: ses.chats.length, offset, nextOffset: next, chats: out,
        next: next === null ? "Fim do material. Escreva o resumo e grave com save_summary (cada item com os ids das mensagens em sources)." : `Chame summary_source de novo com offset ${next}.`,
      };
    },

    async save_summary(a) {
      const ses = (await chrome.storage.local.get(SUMMARY_KEY))[SUMMARY_KEY];
      if (!ses) fail("Chame summary_source antes: o resumo precisa das mensagens de origem.");
      const dropped = [];
      const clean = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
      function build(it, type, extra = {}) {
        const text = clean(it?.text, 300);
        const src = [...new Set((Array.isArray(it?.sources) ? it.sources : []).map(String))].map((id) => [id, ses.msgs[id]]).filter(([, m]) => m && !m.context);
        if (!text || !src.length) {
          dropped.push(text || "(item sem texto)");
          return null;
        }
        const chatId = src[0][1].chatId;
        const info = ses.info[chatId] || {};
        const last = Math.max(...src.map(([, m]) => m.ts));
        return {
          type, text, who: clean(it.who, 80) || src.map(([, m]) => m).find((m) => !m.fromMe)?.who || "",
          date: null, time: null, dateText: null, needsReply: false, answered: (info.lastMine || 0) > last,
          chatId, chatName: info.name || "", isGroup: Boolean(info.isGroup), ts: last,
          sources: src.map(([id, m]) => ({ id, ts: m.ts, who: m.who, text: m.text.slice(0, 220) })),
          ...extra,
        };
      }
      const list = (arr, fn) => (Array.isArray(arr) ? arr : []).map(fn).filter(Boolean);
      const pendingAll = list(a.needsReply, (it) => build(it, "question"));
      const pending = pendingAll.filter((i) => !i.answered).map((i) => ({ ...i, needsReply: true })).sort((x, y) => x.ts - y.ts);
      const other = [...pendingAll.filter((i) => i.answered), ...list(a.other, (it) => build(it, "request"))].sort((x, y) => y.ts - x.ts);
      const dated = list(a.dated, (it) => {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(it?.date || "") ? it.date : null;
        return build(it, "commitment", { date, time: date && /^\d{2}:\d{2}$/.test(it?.time || "") ? it.time : null, dateText: clean(it?.dateText, 120) || null });
      }).sort((x, y) => (x.date || "9999").localeCompare(y.date || "9999") || (x.time || "99").localeCompare(y.time || "99"));
      const notices = list(a.notices, (it) => build(it, "notice")).sort((x, y) => y.ts - x.ts);
      const links = list(a.links, (it) => build(it, "link"));
      const all = [...pending, ...dated, ...notices, ...links, ...other];
      const chats = list(a.perChat, (c) => {
        const info = ses.info[String(c?.chatId)];
        if (!info) return dropped.push(`resumo de ${c?.chatId}`), null;
        return { chatId: String(c.chatId), chatName: info.name, isGroup: Boolean(info.isGroup), summary: clean(c.summary, 400), priority: clamp(c.priority, 0, 3, 0), items: all.filter((i) => i.chatId === c.chatId), count: info.count, skippedAudio: info.skippedAudio, skippedMedia: info.skippedMedia };
      }).sort((x, y) => y.priority - x.priority || y.items.length - x.items.length);
      const infos = Object.values(ses.info);
      const merged = {
        pending, dated, notices, links, other, chats,
        totals: { chats: infos.length, messages: infos.reduce((n, i) => n + (i.count || 0), 0), skippedAudio: infos.reduce((n, i) => n + (i.skippedAudio || 0), 0), skippedMedia: infos.reduce((n, i) => n + (i.skippedMedia || 0), 0) },
      };
      const partial = Boolean(a.partial) || infos.length < ses.chats.length;
      const summary = { id: String(ses.until), at: ses.until, since: ses.since, period: ses.period === "custom" ? "last" : ses.period, overview: clean(a.overview, 800), merged, failed: [], partial, by: ctxClient?.name || "Agente local" };
      const hist = (await chrome.storage.local.get("orbita:summary:history"))["orbita:summary:history"] || [];
      await chrome.storage.local.set({ "orbita:summary:history": [summary, ...hist.filter((h) => h.id !== summary.id)].slice(0, 10), ...(partial ? {} : { "orbita:summary:last": ses.until }) });
      await chrome.storage.local.remove(SUMMARY_KEY);
      return {
        ok: true, saved: { needsReply: pending.length, dated: dated.length, notices: notices.length, links: links.length, other: other.length, perChat: chats.length },
        movedToOther: pendingAll.length - pending.length, dropped,
        partial, note: partial ? (infos.length < ses.chats.length ? `Parcial: só ${infos.length} de ${ses.chats.length} conversas foram lidas (continue o summary_source até o fim na próxima vez).` : "Parcial: o “desde o último resumo” não avançou.") : "Gravado. Aparece no painel da Órbita (Resumo do WhatsApp) e no app do celular.",
      };
    },

    async download_media(a) {
      const id = String(a.messageId || "").trim();
      const m = id && (await C.getMessage(id));
      if (!m) fail("Mensagem não encontrada. Pegue o id em get_messages (a conversa precisa ter sido lida antes).");
      if (m.revoked) fail("Essa mensagem foi apagada.");
      if (!["image", "video", "audio", "sticker", "document", "other"].includes(m.type) && !m.media) fail(`Essa mensagem não tem mídia (tipo: ${m.type || "texto"}).`);
      let media;
      try {
        await ops().handle({ op: C.OPS.MEDIA_FETCH, messageId: id }); // baixa do WhatsApp se ainda não estiver no cache
        media = await C.getMedia(id);
      } catch (e) {
        fail(`Não consegui baixar a mídia: ${e.message}${waStatus().ready ? "" : " (abra o WhatsApp Web numa aba do Chrome)"}`);
      }
      if (!media?.blob) fail("A mídia não está disponível (o WhatsApp pode ter apagado o arquivo antigo do servidor).");
      if (media.blob.size > 100 * 1024 * 1024) fail("Mídia grande demais para passar pelo agente (máx. 100 MB).");
      const bytes = new Uint8Array(await media.blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const chat = await C.getChat(m.chatId);
      return {
        messageId: id, chatId: m.chatId, chat: chatName(chat), at: iso(m.ts), from: m.fromMe ? "Você" : m.authorName || chatName(chat),
        type: m.type === "other" ? m.label?.toLowerCase?.() || "documento" : m.type, mimeType: media.blob.type || media.mime || "application/octet-stream",
        originalName: m.filename || null, caption: m.caption || (m.type !== "text" ? m.text : "") || null, size: media.blob.size, fileBase64: btoa(bin),
      };
    },

    async list_groups() {
      if (!waStatus().ready) fail("Abra o WhatsApp Web numa aba do Chrome para listar os grupos.");
      const groups = await ops().handle({ op: C.OPS.GROUP_LIST });
      return { groups: groups.map((g) => ({ groupId: g.id || g.chatId, name: g.name, participants: g.size ?? g.participantsCount ?? null })) };
    },

    async get_group_members(a) {
      if (!waStatus().ready) fail("Abra o WhatsApp Web numa aba do Chrome para ver os participantes.");
      return ops().handle({ op: C.OPS.GROUP_INFO, groupId: String(a.groupId), chatId: String(a.groupId) });
    },

    async transcribe_audio(a) {
      const m = await C.getMessage(String(a.messageId));
      if (!m || m.type !== "audio") fail("Mensagem de áudio não encontrada.");
      if (m.audio?.transcript) return { messageId: m.id, transcript: m.audio.transcript, cached: true };
      await ops().handle({ op: C.OPS.TRANSCRIBE, messageId: m.id, manual: true }); // entra na fila (baixa o áudio e transcreve)
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const after = await C.getMessage(m.id);
        const st = after?.audio?.transcriptStatus;
        if (after?.audio?.transcript || ["failed", "empty", "error"].includes(st)) return { messageId: m.id, transcript: after.audio.transcript || null, status: st || "done", error: after.audio.transcriptError || null };
      }
      return { messageId: m.id, transcript: null, status: "pending", note: "Ainda transcrevendo; chame de novo em instantes." };
    },

    // ------------------------------------------------------------ organizar
    async update_lead(a) {
      const phone = digits(a.phone);
      if (!/^\d{8,15}$/.test(phone)) fail("Telefone inválido.");
      const Crm = globalThis.OrbitaCrm;
      const stages = await Crm.stages();
      let stageId = a.stageId;
      if (!stageId && a.stageName) stageId = stages.find((s) => norm(s.name) === norm(a.stageName))?.id || fail(`Etapa “${a.stageName}” não existe. Etapas: ${stages.map((s) => s.name).join(", ")}.`);
      if (stageId && !stages.some((s) => s.id === stageId)) fail("Etapa não encontrada. Veja list_stages.");
      const { leads } = await loadLeads();
      const existing = leads.find((l) => C.phoneVariants(phone).includes(l.phone));
      const target = existing?.phone || phone;
      if (!existing) await Crm.addToCrm(target, a.name || ""); // novo: entra na lista “Adicionados pelo WhatsApp”, como no painel
      else if (a.name && a.name.trim() && a.name.trim() !== existing.name) await Crm.rename(target, a.name);
      if (stageId) await Crm.setStage(target, stageId);
      const changes = [];
      await Crm.patch(target, (r) => {
        if (a.addTags?.length || a.removeTags?.length) {
          const rm = new Set((a.removeTags || []).map(norm));
          r.tags = Crm.cleanTags([...(r.tags || []).filter((t) => !rm.has(norm(t))), ...(a.addTags || [])]);
          changes.push("etiquetas");
        }
        const merge = (key, v) => {
          if (!v || typeof v !== "object") return;
          const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
          if (!Object.keys(clean).length) return;
          r[key] = { ...(r[key] || {}), ...clean };
          changes.push(key === "lead" ? "ficha" : "negócio");
        };
        merge("lead", a.lead);
        merge("deal", a.deal);
      });
      notify("crm", target);
      return { ok: true, phone: target, created: !existing, lead: (await H.get_lead({ phone: target })) };
    },

    async bulk_update_leads(a) {
      const set = a.set || {};
      const { stages, leads } = await loadLeads();
      let stageId = set.stageId;
      if (!stageId && set.stageName) stageId = stages.find((st) => norm(st.name) === norm(set.stageName))?.id || fail(`Etapa “${set.stageName}” não existe. Etapas: ${stages.map((st) => st.name).join(", ")}.`);
      if (stageId && !stages.some((st) => st.id === stageId)) fail("Etapa não encontrada. Veja list_stages.");
      const lead = Object.fromEntries(["temperature", "status", "owner"].filter((k) => set[k]).map((k) => [k, set[k]]));
      if (!stageId && !set.addTags?.length && !set.removeTags?.length && !Object.keys(lead).length && !a.note) fail("Nada para mudar: informe set (etapa, etiquetas, temperatura, situação ou responsável) ou note.");
      let targets;
      if (a.phones?.length) {
        const wanted = a.phones.map(digits);
        targets = leads.filter((l) => wanted.some((p) => C.phoneVariants(p).includes(l.phone)));
      } else if (a.filter && Object.keys(a.filter).length) targets = leads.filter((l) => leadMatches({ l, s: leadSummary(l, stages) }, a.filter));
      else fail("Informe phones ou filter (para não alterar todos os leads sem querer).");
      if (targets.length > 1000) fail(`São ${targets.length} leads: o máximo por vez é 1000. Refine o filtro.`);
      const preview = targets.map((l) => ({ phone: l.phone, name: l.name || null, from: stages.find((st) => st.id === l.stageId)?.name || null }));
      if (a.dryRun || !targets.length) return { dryRun: Boolean(a.dryRun), matched: targets.length, leads: preview.slice(0, 200) };
      const to = stages.find((st) => st.id === stageId);
      const Crm = globalThis.OrbitaCrm;
      const rm = new Set((set.removeTags || []).map(norm));
      await withMain(async (db) => {
        const tx = db.transaction("crmClients", "readwrite");
        const store = tx.objectStore("crmClients");
        for (const l of targets) {
          const r = (await req(store.get(l.phone))) ?? { phone: l.phone, stageId: stages[0]?.id ?? "", history: [], updatedAt: Date.now() };
          r.history ||= [];
          if (to && r.stageId !== to.id) {
            const from = stages.find((st) => st.id === r.stageId);
            r.stageId = to.id;
            r.history.push(Crm.entry("stage", from ? `Movido de “${from.name}” para “${to.name}”.` : `Movido para “${to.name}”.`));
          }
          if (set.addTags?.length || rm.size) r.tags = Crm.cleanTags([...(r.tags || []).filter((t) => !rm.has(norm(t))), ...(set.addTags || [])]);
          if (Object.keys(lead).length) r.lead = { ...(r.lead || {}), ...lead };
          if (a.note) {
            const e = Crm.entry("note", String(a.note).trim());
            r.history.push(e);
            r.lastInteractionAt = e.ts;
          }
          r.updatedAt = Date.now();
          store.put(r);
        }
        await done(tx);
      });
      notify("crm");
      return { ok: true, updated: targets.length, leads: preview.slice(0, 200) };
    },

    async set_auto_reply(a) {
      const r = await globalThis.OrbitaCrm.setAutoReply(await ensureLead(digits(a.phone)), Boolean(a.enabled));
      return { ok: true, phone: r.phone, autoReply: Boolean(r.autoReply), note: "A resposta automática só age se estiver ligada também na regra geral do painel (CRM → IA)." };
    },

    async add_lead_note(a) {
      const phone = digits(a.phone);
      const r = await globalThis.OrbitaCrm.addNote(await ensureLead(phone), `${String(a.text).trim()}`);
      return { ok: true, phone: r.phone, notes: r.history.length };
    },

    async log_activity(a) {
      const KIND = { ligacao: "call", whatsapp: "message", email: "message", reuniao: "note", visita: "note", tarefa: "note" };
      const LABEL = { ligacao: "Ligação", whatsapp: "WhatsApp", email: "E-mail", reuniao: "Reunião", visita: "Visita", tarefa: "Tarefa" };
      if (!KIND[a.type]) fail("Tipo de atividade inválido.");
      const nextAt = parseWhen(a.nextAt, "nextAt");
      const phone = await ensureLead(digits(a.phone));
      const r = await globalThis.OrbitaCrm.patch(phone, (rec) => {
        const e = globalThis.OrbitaCrm.entry(KIND[a.type], `${LABEL[a.type]}: ${String(a.description).trim()}${a.result ? ` — ${a.result}` : ""}`);
        e.activity = { type: a.type, owner: a.owner || "", description: String(a.description).trim(), result: a.result || "", nextAction: a.nextAction || "", nextAt: nextAt || null };
        rec.history.push(e);
        rec.lastInteractionAt = e.ts;
      });
      return { ok: true, phone: r.phone };
    },

    async create_stage(a) {
      const name = String(a.name || "").trim();
      if (!name) fail("Informe o nome da etapa.");
      const color = /^#[0-9a-f]{6}$/i.test(a.color || "") ? a.color : ["#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#16a34a", "#dc2626"][Math.floor(Math.random() * 7)];
      return withMain(async (db, has) => {
        if (!has("crmStages")) fail("O CRM ainda não foi criado: abra o CRM no painel uma vez.");
        const tx = db.transaction("crmStages", "readwrite");
        const st = tx.objectStore("crmStages");
        const all = (await req(st.getAll())).sort(byOrder);
        if (all.some((s) => norm(s.name) === norm(name))) fail(`Já existe a etapa “${name}”.`);
        const rec = { id: uuid(), name, color, order: (all.at(-1)?.order ?? -1) + 1, createdAt: Date.now() };
        st.put(rec);
        await done(tx);
        notify("crm");
        return { ok: true, stageId: rec.id, name, color };
      });
    },

    async create_appointment(a) {
      const phone = digits(a.phone);
      const start = parseWhen(a.start, "start");
      if (!start) fail("Informe o início (start).");
      const title = String(a.title || "").trim() || fail("Informe o título.");
      const { leads } = await loadLeads();
      const l = leads.find((x) => C.phoneVariants(phone).includes(x.phone));
      const now = Date.now();
      const rec = {
        id: uuid(), phone: l?.phone || phone, clientName: l?.name || "", title, start,
        durationMin: clamp(a.durationMin, 5, 1440, 30), reminderMin: a.reminderMin === null ? null : clamp(a.reminderMin, 0, 10080, 30),
        description: String(a.description || ""), status: "scheduled", createdAt: now, updatedAt: now,
      };
      await withMain(async (db, has) => {
        if (!has("appointments")) fail("A Agenda ainda não foi criada: abra a Agenda no painel uma vez.");
        const tx = db.transaction("appointments", "readwrite");
        tx.objectStore("appointments").put(rec);
        await done(tx);
      });
      await scheduleReminder(rec);
      notify("agenda", rec.id);
      return { ok: true, appointment: apptOut(rec) };
    },

    async update_appointment(a) {
      const rec = await withMain(async (db, has) => {
        if (!has("appointments")) fail("Compromisso não encontrado.");
        const tx = db.transaction("appointments", "readwrite");
        const st = tx.objectStore("appointments");
        const cur = await req(st.get(String(a.appointmentId)));
        if (!cur) fail("Compromisso não encontrado. Veja list_appointments.");
        const next = { ...cur, updatedAt: Date.now() };
        if (a.start) {
          next.start = parseWhen(a.start, "start");
          next.notifiedAt = undefined; // remarcado: avisa de novo
        }
        if (a.title) next.title = String(a.title).trim();
        if (a.durationMin) next.durationMin = clamp(a.durationMin, 5, 1440, cur.durationMin);
        if (a.description !== undefined) next.description = String(a.description);
        if (a.status) next.status = a.status;
        st.put(next);
        await done(tx);
        return next;
      });
      await scheduleReminder(rec);
      notify("agenda", rec.id);
      return { ok: true, appointment: apptOut(rec) };
    },

    async create_list(a) {
      const name = String(a.name || "").trim() || fail("Informe o nome da lista.");
      const contacts = cleanContacts(a.contacts);
      if (!contacts.length) fail("Nenhum telefone válido.");
      const now = Date.now();
      const list = { id: uuid(), name, source: "mcp", defaultCountry: "55", variableKeys: [...new Set(contacts.flatMap((c) => Object.keys(c.vars)))], count: 0, createdAt: now, updatedAt: now };
      await withMain(async (db, has) => {
        if (!has("lists")) fail("As listas ainda não foram criadas: abra o painel uma vez.");
        const tx = db.transaction(["lists", "listContacts"], "readwrite");
        contacts.forEach((c, i) => tx.objectStore("listContacts").put({ id: `${list.id}:${c.phone}`, listId: list.id, phone: c.phone, name: c.name, vars: c.vars, order: i }));
        list.count = contacts.length;
        tx.objectStore("lists").put(list);
        await done(tx);
      });
      notify("lists", list.id);
      return { ok: true, listId: list.id, name, count: list.count };
    },

    async add_to_list(a) {
      const contacts = cleanContacts(a.contacts);
      return withMain(async (db, has) => {
        if (!has("lists")) fail("Lista não encontrada.");
        const tx = db.transaction(["lists", "listContacts"], "readwrite");
        const list = await req(tx.objectStore("lists").get(String(a.listId)));
        if (!list) fail("Lista não encontrada. Veja list_lists.");
        let added = 0;
        for (const c of contacts) {
          const id = `${list.id}:${c.phone}`;
          if (await req(tx.objectStore("listContacts").getKey(id))) continue;
          tx.objectStore("listContacts").put({ id, listId: list.id, phone: c.phone, name: c.name, vars: c.vars, order: (list.count || 0) + added });
          added++;
        }
        list.count = (list.count || 0) + added;
        list.variableKeys = [...new Set([...(list.variableKeys || []), ...contacts.flatMap((c) => Object.keys(c.vars))])];
        list.updatedAt = Date.now();
        tx.objectStore("lists").put(list);
        await done(tx);
        notify("lists", list.id);
        return { ok: true, listId: list.id, added, skipped: contacts.length - added, count: list.count };
      });
    },

    async create_campaign_draft(a) {
      const msgs = (a.messages || []).map((m) => String(m || "").trim()).filter(Boolean);
      if (!msgs.length) fail("Informe ao menos uma mensagem.");
      return withMain(async (db, has) => {
        if (!has("campaigns")) fail("As campanhas ainda não foram criadas: abra o painel uma vez.");
        const list = await req(db.transaction("lists").objectStore("lists").get(String(a.listId)));
        if (!list) fail("Lista não encontrada. Veja list_lists.");
        const now = Date.now();
        const c = {
          id: uuid(), name: String(a.name || "Campanha do agente").trim(), status: "DRAFT", listId: list.id,
          steps: msgs.map((text) => ({ id: uuid(), kind: "text", text })),
          pacing: { minDelaySec: 10, maxDelaySec: 20, stepDelaySec: 2, batchSize: 25, batchPauseMin: 10, windowStart: "", windowEnd: "", weekdays: [] },
          createdAt: now, updatedAt: now, stats: { total: 0, pending: 0, processing: 0, sent: 0, failed: 0, skipped: 0 },
        };
        const tx = db.transaction("campaigns", "readwrite");
        tx.objectStore("campaigns").put(c);
        await done(tx);
        notify("campaigns", c.id);
        return { ok: true, campaignId: c.id, status: "DRAFT", list: list.name, recipients: list.count, note: "Rascunho criado. Revise e inicie no painel da Órbita → Campanhas." };
      });
    },

    async set_chat_translation(a) {
      const chat = await ops().handle({ op: C.OPS.SET_TRANSLATION, chatId: await resolveChat(a), enabled: Boolean(a.enabled), ...(a.contactLang ? { contactLang: a.contactLang } : {}) });
      return { ok: true, chatId: chat.chatId, translation: chat.translation };
    },

    async mark_chat_read(a) {
      await ops().handle({ op: C.OPS.MARK_READ, chatId: await resolveChat(a) });
      return { ok: true };
    },

    // ------------------------------------------------------------ enviar
    async send_message(a, ctx) {
      const chatId = await resolveChat(a);
      const text = String(a.text || "").trim();
      if (!text) fail("Mensagem vazia.");
      if (text.length > 4000) fail("Mensagem longa demais (máx. 4000 caracteres).");
      if (!waStatus().ready) fail("Abra o WhatsApp Web numa aba do Chrome para enviar.");
      const chat = await C.getChat(chatId);
      let out = text;
      let textPt;
      if (chat?.translation?.enabled) {
        const p = await ops().handle({ op: C.OPS.TRANSLATE_PREVIEW, chatId, textPt: text });
        out = p.translated;
        textPt = text;
      }
      await ctx.confirm({ title: `Enviar para ${chatName(chat) || chatId.split("@")[0]}?`, message: out.slice(0, 180), preview: textPt ? `Em português: ${textPt}` : "" });
      const msg = await ops().handle({ op: C.OPS.SEND_TEXT, chatId, text: out, ...(textPt ? { textPt } : {}), ...(a.replyTo ? { quotedId: String(a.replyTo) } : {}) });
      return { ok: true, chatId, messageId: msg.id, sentText: out, ...(textPt ? { translatedFrom: textPt } : {}) };
    },

    async send_voice(a, ctx) {
      const chatId = await resolveChat(a);
      const textPt = String(a.text || "").trim();
      if (!textPt) fail("Informe o texto do áudio.");
      if (!waStatus().ready) fail("Abra o WhatsApp Web numa aba do Chrome para enviar.");
      const chat = await C.getChat(chatId);
      // mesma regra das Conversas: com tradução, a voz fala o texto traduzido (a prévia fica guardada)
      if (chat?.translation?.enabled) await ops().handle({ op: C.OPS.TRANSLATE_PREVIEW, chatId, textPt });
      const g = await ops().handle({ op: C.OPS.VOICE_PREVIEW, chatId, textPt }); // Fish Audio → MP3 no cache
      const conv = await toVoiceNote({ mp3Key: g.mp3Key, genKey: `gen:${g.genId}`, text: g.text, chatId });
      if (conv.duration > g.maxVoiceSec) fail(`O áudio ficou com ${Math.round(conv.duration)} s, acima do limite de ${g.maxVoiceSec} s. Encurte o texto.`);
      await ctx.confirm({ title: `Enviar áudio para ${chatName(chat) || chatId.split("@")[0]}?`, message: `🎤 ${Math.round(conv.duration)} s: “${g.text.slice(0, 160)}”`, preview: g.text !== textPt ? `Em português: ${textPt}` : "" });
      const msg = await ops().handle({ op: C.OPS.SEND_AUDIO, chatId, genId: g.genId, ...(a.replyTo ? { quotedId: String(a.replyTo) } : {}) });
      return { ok: true, chatId, messageId: msg.id, spoken: g.text, durationSec: Math.round(conv.duration), lang: g.lang, ...(g.text !== textPt ? { translatedFrom: textPt } : {}), ...(g.notice ? { notice: g.notice } : {}) };
    },

    async send_file(a, ctx) {
      if (!a.fileBase64) fail("O servidor local não mandou o arquivo. Atualize o agente: o servidor fica em mcp/orbita-mcp.mjs, na pasta da extensão (reinicie o agente).");
      const chatId = await resolveChat(a);
      if (!waStatus().ready) fail("Abra o WhatsApp Web numa aba do Chrome para enviar.");
      const bin = atob(String(a.fileBase64));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const fileName = String(a.fileName || "arquivo");
      const blob = new Blob([bytes], { type: String(a.mimeType || "application/octet-stream") });
      const kind = ["image", "video", "audio", "document"].includes(a.kind) ? a.kind : "document";
      const chat = await C.getChat(chatId);
      let caption = kind === "audio" ? "" : String(a.caption || "").trim();
      let captionPt;
      if (caption && chat?.translation?.enabled) {
        captionPt = caption;
        caption = (await ops().handle({ op: C.OPS.TRANSLATE_PREVIEW, chatId, textPt: captionPt })).translated;
      }
      const label = { image: "🖼️ Foto", video: "🎬 Vídeo", audio: "🎵 Áudio", document: "📄 Documento" }[kind];
      const size = `${(blob.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
      await ctx.confirm({ title: `Enviar ${fileName} para ${chatName(chat) || chatId.split("@")[0]}?`, message: `${label} · ${size}${caption ? ` · “${caption.slice(0, 120)}”` : ""}`, preview: captionPt ? `Legenda em português: ${captionPt}` : a.note || "" });
      const uploadId = `mcp-${uuid()}`;
      await C.putMedia(`up:${uploadId}`, blob, { chatId, mime: blob.type });
      const msg = await ops().handle({ op: C.OPS.SEND_FILE, chatId, uploadId, type: kind, filename: fileName, ...(caption ? { caption } : {}), ...(captionPt ? { captionPt } : {}), ...(a.replyTo ? { quotedId: String(a.replyTo) } : {}) });
      return { ok: true, chatId, messageId: msg.id, fileName, sentAs: kind, sizeBytes: blob.size, ...(caption ? { caption } : {}), ...(captionPt ? { translatedFrom: captionPt } : {}), ...(a.note ? { note: a.note } : {}) };
    },

    async send_quick_reply(a, ctx) {
      const chatId = await resolveChat(a);
      if (!waStatus().ready) fail("Abra o WhatsApp Web numa aba do Chrome para enviar.");
      const data = await globalThis.OrbitaQR.load();
      const item = (data.items || []).find((i) => i.id === a.quickReplyId);
      if (!item) fail("Resposta rápida não encontrada. Veja list_quick_replies.");
      const chat = await C.getChat(chatId);
      let approvalId;
      if (chat?.translation?.enabled) approvalId = (await ops().handle({ op: C.OPS.QR_PREPARE, chatId, itemId: item.id })).approvalId;
      await ctx.confirm({ title: `Enviar a resposta rápida “${item.title}”?`, message: `Para ${chatName(chat) || chatId.split("@")[0]} (${item.steps.length} passo${item.steps.length > 1 ? "s" : ""}).`, preview: "" });
      await ops().handle({ op: C.OPS.QR_RUN, chatId, itemId: item.id, ...(approvalId ? { approvalId } : {}) });
      return { ok: true, chatId, quickReply: item.title };
    },
  };

  // ---------------------------------------------------------------- auxiliares
  // MP3 → OGG/Opus no documento offscreen (o service worker não tem AudioContext)
  async function toVoiceNote(req) {
    if (!chrome.offscreen) fail("Este Chrome não permite converter o áudio (chrome.offscreen indisponível). Atualize o Chrome.");
    const url = chrome.runtime.getURL("offscreen.html");
    const has = chrome.runtime.getContexts ? (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] })).length > 0 : false;
    if (!has) {
      try {
        await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["BLOBS"], justification: "Converter o áudio gerado (MP3) no formato de mensagem de voz do WhatsApp." });
      } catch (e) {
        if (!/single offscreen|already/i.test(e?.message || "")) throw e;
      }
    }
    const r = await chrome.runtime.sendMessage({ channel: "orbita:offscreen", op: "mp3ToOgg", ...req });
    if (!r?.ok) fail(`Não consegui converter o áudio: ${r?.error || "sem resposta"}`);
    return r.data;
  }

  // ---------------------------------------------------------------- outros auxiliares
  function apptOut(x) {
    return { appointmentId: x.id, title: x.title, phone: x.phone, client: x.clientName || null, start: iso(x.start), durationMin: x.durationMin, reminderMin: x.reminderMin ?? null, status: x.status, description: x.description || null };
  }
  // mesmo alarme do painel ("remind:<id>"): o service worker do bundle mostra o lembrete
  async function scheduleReminder(x) {
    const name = `remind:${x.id}`;
    const when = x.status !== "scheduled" || x.reminderMin == null || x.notifiedAt ? null : x.start - 60000 * x.reminderMin;
    if (when === null || when < Date.now() - 36e5) await chrome.alarms.clear(name);
    else await chrome.alarms.create(name, { when: Math.max(Date.now() + 1000, when) });
  }
  function cleanContacts(list) {
    const seen = new Set();
    const out = [];
    for (const c of Array.isArray(list) ? list : []) {
      const phone = digits(c?.phone);
      if (!/^\d{8,15}$/.test(phone) || seen.has(phone)) continue;
      seen.add(phone);
      out.push({ phone, name: String(c.name || "").trim(), vars: Object.fromEntries(Object.entries(c.vars || {}).map(([k, v]) => [String(k), String(v ?? "")])) });
    }
    return out;
  }
  async function ensureLead(phone) {
    if (!/^\d{8,15}$/.test(phone)) fail("Telefone inválido.");
    const { leads } = await loadLeads();
    const l = leads.find((x) => C.phoneVariants(phone).includes(x.phone));
    if (l) return l.phone;
    return globalThis.OrbitaCrm.addToCrm(phone, "");
  }

  const SUMMARY_KEY = "orbita:mcp:summarySource"; // material do resumo entre summary_source e save_summary
  let ctxClient = null;

  async function run(name, args, ctx) {
    const fn = H[name];
    if (!fn) fail(`Ferramenta desconhecida: ${name}`);
    ctxClient = ctx?.client || null;
    return fn(args && typeof args === "object" ? args : {}, ctx);
  }

  globalThis.OrbitaMcpHandlers = { run, iso, H };
})();
