// Listas de contatos a partir de grupos do WhatsApp.
//
// Grava no banco "orbita" no mesmo formato do createList/appendContacts do
// painel (dashboard.js), e avisa pelo BroadcastChannel "orbita-data" para a
// página Contatos se atualizar sozinha:
//   lists        { id, name, source: "whatsapp-group", groupId, defaultCountry,
//                  variableKeys: ["grupo", "admin"], count, createdAt, updatedAt }
//   listContacts { id: "<lista>:<telefone>", listId, phone, name,
//                  vars: { grupo, admin: "sim" | "não" }, order }
// Uma lista por grupo: criar de novo o mesmo grupo só acrescenta quem entrou.
// Participantes sem número visível (IDs @lid) e o seu próprio número ficam de fora.
// Expõe globalThis.OrbitaGroupLists. Roda em páginas da extensão.
(() => {
  "use strict";
  if (globalThis.OrbitaGroupLists) return;
  const SOURCE = "whatsapp-group";
  const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  const done = (tx) => new Promise((res, rej) => ((tx.oncomplete = res), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error || new Error("Operação cancelada.")))));

  function notify(topic, id) {
    try {
      const ch = new BroadcastChannel("orbita-data");
      ch.postMessage({ topic, id });
      ch.close();
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

  // Participantes que podem entrar numa lista (com número, sem você), sem repetição.
  function contactsOf(info) {
    const seen = new Set();
    const out = [];
    let hidden = 0;
    for (const p of info.participants || []) {
      if (p.isMe) continue;
      const phone = String(p.phone || "").replace(/\D/g, "");
      if (!/^\d{8,15}$/.test(phone)) {
        hidden++;
        continue;
      }
      if (seen.has(phone)) continue;
      seen.add(phone);
      out.push({ phone, name: p.name || p.pushname || "", vars: { grupo: info.subject || "", admin: p.isAdmin || p.isSuperAdmin ? "sim" : "não" } });
    }
    return { contacts: out, hidden };
  }

  // Lista já criada para este grupo (ou null).
  const listFor = (groupId) => withDb(async (db) => (await req(db.transaction("lists").objectStore("lists").getAll())).find((l) => l.source === SOURCE && l.groupId === groupId) || null);

  const defaultName = (info) => `Grupo: ${info.subject || "sem nome"}`;

  // Cria a lista do grupo, ou acrescenta os participantes novos à que já existe.
  async function save(info, { name } = {}) {
    const { contacts, hidden } = contactsOf(info);
    const res = await withDb(async (db) => {
      const tx = db.transaction(["lists", "listContacts"], "readwrite");
      const lists = tx.objectStore("lists");
      const lc = tx.objectStore("listContacts");
      const now = Date.now();
      let list = (await req(lists.getAll())).find((l) => l.source === SOURCE && l.groupId === info.chatId);
      const created = !list;
      if (!list) list = { id: uuid(), name: String(name || "").trim() || defaultName(info), source: SOURCE, groupId: info.chatId, defaultCountry: "55", variableKeys: ["grupo", "admin"], count: 0, createdAt: now, updatedAt: now };
      let added = 0;
      for (const c of contacts) {
        const id = `${list.id}:${c.phone}`;
        if (await req(lc.getKey(id))) continue;
        lc.put({ id, listId: list.id, phone: c.phone, name: c.name, vars: c.vars, order: list.count + added });
        added++;
      }
      list.count += added;
      list.variableKeys = [...new Set([...(list.variableKeys || []), "grupo", "admin"])];
      list.updatedAt = now;
      lists.put(list);
      await done(tx);
      return { listId: list.id, name: list.name, created, added, total: list.count, hidden };
    });
    notify("lists", res.listId);
    return res;
  }

  // Vários grupos numa lista só (nova a cada vez), sem números repetidos.
  // {{grupo}} fica com o primeiro grupo em que a pessoa aparece.
  async function saveMerged(infos, { name } = {}) {
    const seen = new Set();
    const contacts = [];
    let hidden = 0;
    for (const info of infos) {
      const r = contactsOf(info);
      hidden += r.hidden;
      for (const c of r.contacts) if (!seen.has(c.phone)) (seen.add(c.phone), contacts.push(c));
    }
    const now = Date.now();
    const list = { id: uuid(), name: String(name || "").trim() || "Grupos do WhatsApp", source: SOURCE, groupIds: infos.map((i) => i.chatId), defaultCountry: "55", variableKeys: ["grupo", "admin"], count: contacts.length, createdAt: now, updatedAt: now };
    await withDb(async (db) => {
      const tx = db.transaction(["lists", "listContacts"], "readwrite");
      contacts.forEach((c, i) => tx.objectStore("listContacts").put({ id: `${list.id}:${c.phone}`, listId: list.id, phone: c.phone, name: c.name, vars: c.vars, order: i }));
      tx.objectStore("lists").put(list);
      await done(tx);
    });
    notify("lists", list.id);
    return { listId: list.id, name: list.name, created: true, added: contacts.length, total: contacts.length, hidden };
  }

  // Busca, um por um, o número dos participantes que vieram ocultos (@lid).
  // Com pausa entre as consultas, como quem clica contato por contato.
  // onProgress({ done, total, found })
  async function resolveHidden(infos, { onProgress = () => {}, pauseMs = 250 } = {}) {
    const hidden = [];
    for (const info of infos) for (const p of info.participants || []) if (!p.isMe && !p.phone) hidden.push(p);
    let found = 0;
    for (const [i, p] of hidden.entries()) {
      onProgress({ done: i, total: hidden.length, found });
      try {
        const r = await chrome.runtime.sendMessage({ channel: "orbita:chat", op: "group.resolvePhone", id: p.id });
        if (r?.ok && r.data?.phone) {
          p.phone = r.data.phone;
          found++;
        }
      } catch {}
      if (pauseMs && i < hidden.length - 1) await new Promise((res) => setTimeout(res, pauseMs));
    }
    onProgress({ done: hidden.length, total: hidden.length, found });
    return { total: hidden.length, found };
  }

  globalThis.OrbitaGroupLists = { save, saveMerged, resolveHidden, listFor, contactsOf, defaultName, SOURCE };
})();
