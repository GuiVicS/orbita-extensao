// Edição do CRM a partir das Conversas (painel lateral do chat).
//
// O CRM do painel (dashboard.js, minificado) grava direto no IndexedDB
// "orbita". Este módulo segue exatamente o mesmo formato e as mesmas regras:
//   crmClients { phone, stageId, tags[], history[{id, ts, kind, text}],
//                lastInteractionAt, autoReply, attention, updatedAt }
//   - mover de etapa acrescenta { kind: "stage", text: "Movido de … para …" }
//   - nota = entrada { kind: "note" } e atualiza lastInteractionAt
//   - tags sem repetição (ignorando maiúsculas/minúsculas)
//   - "Adicionar ao CRM" = contato na lista "Adicionados pelo WhatsApp"
// e avisa as outras telas pelo BroadcastChannel "orbita-data" (o mesmo que o
// painel escuta), para o CRM e as listas se atualizarem sozinhos.
// Expõe globalThis.OrbitaCrm. Roda em páginas da extensão.
(() => {
  "use strict";
  if (globalThis.OrbitaCrm) return;

  const WHATSAPP_LIST = "Adicionados pelo WhatsApp";
  const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const entry = (kind, text) => ({ id: uuid(), ts: Date.now(), kind, text });
  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  const done = (tx) => new Promise((res, rej) => ((tx.oncomplete = res), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error || new Error("Operação cancelada.")))));

  let channel = null;
  function notify(topic, id) {
    try {
      channel ||= new BroadcastChannel("orbita-data");
      channel.postMessage({ topic, id });
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

  async function modules() {
    return (await chrome.storage.local.get("orbita:modules"))["orbita:modules"] || {};
  }

  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0);
  const stages = () => withDb(async (db) => (db.objectStoreNames.contains("crmStages") ? (await req(db.transaction("crmStages").objectStore("crmStages").getAll())).sort(byOrder) : []));

  // Tudo o que o painel lateral mostra, numa leitura só.
  async function load(phone) {
    return withDb(async (db) => {
      const has = (n) => db.objectStoreNames.contains(n);
      const tx = db.transaction(["crmStages", "crmClients", "listContacts", "lists", "appointments"].filter(has));
      const st = has("crmStages") ? (await req(tx.objectStore("crmStages").getAll())).sort(byOrder) : [];
      const record = has("crmClients") ? await req(tx.objectStore("crmClients").get(phone)) : null;
      const contacts = (await req(tx.objectStore("listContacts").getAll())).filter((c) => c.phone === phone);
      const listIds = new Set(contacts.map((c) => c.listId));
      const lists = (await req(tx.objectStore("lists").getAll())).filter((l) => listIds.has(l.id)).map((l) => l.name);
      const tagCount = new Map();
      if (has("crmClients")) {
        for (const c of await req(tx.objectStore("crmClients").getAll()))
          for (const t of c.tags ?? []) {
            const k = t.toLowerCase();
            tagCount.set(k, { tag: tagCount.get(k)?.tag ?? t, n: (tagCount.get(k)?.n ?? 0) + 1 });
          }
      }
      const appointments = has("appointments")
        ? (await req(tx.objectStore("appointments").index("byPhone").getAll(phone))).filter((a) => a.status !== "canceled" && a.start >= Date.now() - 36e5).sort((a, b) => a.start - b.start).slice(0, 5)
        : [];
      const validStage = record && st.some((s) => s.id === record.stageId) ? record.stageId : st[0]?.id;
      return {
        inLists: contacts.length > 0,
        name: contacts.find((c) => c.name)?.name || "",
        lists,
        stages: st,
        stageId: validStage,
        tags: record?.tags ?? [],
        knownTags: [...tagCount.values()].sort((a, b) => b.n - a.n).map((t) => t.tag),
        history: [...(record?.history ?? [])].sort((a, b) => b.ts - a.ts),
        autoReply: Boolean(record?.autoReply),
        attention: record?.attention || null,
        appointments,
        modules: await modules(),
      };
    });
  }

  // Mesmo comportamento do upsertClient do painel.
  async function upsert(phone, fn) {
    const st = await stages();
    const rec = await withDb(async (db) => {
      const tx = db.transaction("crmClients", "readwrite");
      const store = tx.objectStore("crmClients");
      const r = (await req(store.get(phone))) ?? { phone, stageId: st[0]?.id ?? "", history: [], updatedAt: Date.now() };
      r.history ||= [];
      fn(r, st);
      r.updatedAt = Date.now();
      store.put(r);
      await done(tx);
      return r;
    });
    notify("crm", phone);
    return rec;
  }

  const setStage = (phone, stageId) =>
    upsert(phone, (r, st) => {
      const to = st.find((s) => s.id === stageId);
      if (!to) throw new Error("Etapa não encontrada.");
      if (r.stageId === stageId) return;
      const from = st.find((s) => s.id === r.stageId);
      r.stageId = stageId;
      r.history.push(entry("stage", from ? `Movido de “${from.name}” para “${to.name}”.` : `Movido para “${to.name}”.`));
    });

  function cleanTags(tags) {
    const seen = new Set();
    return tags.map((t) => String(t).trim()).filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  }
  const setTags = (phone, tags) => upsert(phone, (r) => void (r.tags = cleanTags(tags)));

  const addNote = (phone, text) => {
    const t = String(text || "").trim();
    if (!t) throw new Error("Nota vazia.");
    return upsert(phone, (r) => {
      const e = entry("note", t);
      r.history.push(e);
      r.lastInteractionAt = e.ts;
    });
  };

  const removeHistory = (phone, id) =>
    upsert(phone, (r) => {
      r.history = r.history.filter((h) => h.id !== id);
      r.lastInteractionAt = r.history.filter((h) => h.kind !== "stage").at(-1)?.ts;
    });

  const setAutoReply = (phone, on) =>
    upsert(phone, (r) => {
      if (Boolean(r.autoReply) === on) return;
      r.autoReply = on;
      if (on) r.attention = undefined;
      r.history.push(entry("note", on ? "Resposta automática da IA ligada." : "Resposta automática da IA desligada."));
    });

  const clearAttention = (phone) => upsert(phone, (r) => void (r.attention = undefined));

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

  // Igual ao "Adicionar ao CRM" do painel no WhatsApp Web.
  async function addToCrm(phone, name) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(digits)) throw new Error("Número inválido.");
    const contact = { phone: digits, name: String(name || "").trim(), vars: {} };
    const listId = await withDb(async (db) => {
      const tx = db.transaction(["lists", "listContacts"], "readwrite");
      const lists = tx.objectStore("lists");
      const lc = tx.objectStore("listContacts");
      let list = (await req(lists.getAll())).find((l) => l.name === WHATSAPP_LIST);
      const now = Date.now();
      if (!list) {
        list = { id: uuid(), name: WHATSAPP_LIST, source: "whatsapp", defaultCountry: "55", variableKeys: [], count: 0, createdAt: now, updatedAt: now };
      }
      const id = `${list.id}:${digits}`;
      if (!(await req(lc.getKey(id)))) {
        lc.put({ id, listId: list.id, ...contact, order: list.count });
        list.count += 1;
        list.updatedAt = now;
      }
      lists.put(list);
      await done(tx);
      return list.id;
    });
    notify("lists", listId);
    notify("crm", digits);
    return digits;
  }

  globalThis.OrbitaCrm = { load, stages, setStage, setTags, addNote, removeHistory, setAutoReply, clearAttention, rename, addToCrm, WHATSAPP_LIST };
})();
