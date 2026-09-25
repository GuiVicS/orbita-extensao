// Órbita Cloud — sincronização com o Supabase do próprio usuário.
// Roda nas Opções (assistente) e no service worker (sincronização automática).
// Expõe globalThis.OrbitaCloud.
//
// Segurança: a chave secreta do Supabase não funciona em navegador (o Supabase
// responde 401), então usamos a chave PUBLICÁVEL + um usuário do Supabase Auth
// (e-mail e senha) + RLS: cada linha tem o user_id do dono e só ele lê/grava.
//
// Uma tabela genérica guarda tudo (não quebra quando a Órbita ganhar dados novos):
//   orbita_records (user_id, store, id, data jsonb, hash, deleted, device, updated_at)
//   store = "orbita/<store>" (banco do painel), "orbita-chat/<store>" (Conversas)
//           ou "@storage" (preferências do chrome.storage — nunca as chaves).
// updated_at é carimbado pelo servidor (gatilho), e serve de cursor para puxar
// só o que mudou. Arquivos (mídias, figurinhas) ficam de fora nesta versão.
//
// chrome.storage.local:
//   orbita:cloud:config   { url, key (publicável), email, userId, enabled, intervalMin, device, lastSyncAt, lastError, lastStats }
//   orbita:cloud:secrets  { accessToken, refreshToken, expiresAt }   (fora do backup)
//   orbita:cloud:state    { hashes: { "<store>": { "<id>": hash } }, pulledUntil }
(() => {
  "use strict";
  if (globalThis.OrbitaCloud) return;

  const TABLE = "orbita_records";
  const K = { config: "orbita:cloud:config", secrets: "orbita:cloud:secrets", state: "orbita:cloud:state", lock: "orbita:cloud:lock" };
  const MGMT = "https://api.supabase.com/v1";
  const BATCH = 200;
  const MAIN_DB = "orbita";
  const CHAT_DB = "orbita-chat";
  const CHAT_STORES = ["chats", "messages", "meta", "stickers"];
  const MAIN_SKIP = ["media", "logs"]; // arquivos e registro técnico ficam só aqui
  // chaves do chrome.storage que NUNCA vão para a nuvem
  const STORAGE_SKIP = /^orbita:(cloud:|chat:secrets|email:secrets|qr:media:|reopen$|selfReload$)/;

  const SQL = `-- Órbita Cloud: tabela única com RLS por usuário (rode uma vez)
create table if not exists public.${TABLE} (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  store text not null,
  id text not null,
  data jsonb,
  hash text,
  deleted boolean not null default false,
  device text,
  updated_at timestamptz not null default now(),
  primary key (user_id, store, id)
);
create index if not exists ${TABLE}_updated on public.${TABLE} (user_id, updated_at);
alter table public.${TABLE} enable row level security;
drop policy if exists "orbita_dono" on public.${TABLE};
create policy "orbita_dono" on public.${TABLE} for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.${TABLE} to authenticated;
create or replace function public.${TABLE}_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists ${TABLE}_touch on public.${TABLE};
create trigger ${TABLE}_touch before insert or update on public.${TABLE} for each row execute function public.${TABLE}_touch();
notify pgrst, 'reload schema';`;

  class CloudError extends Error {
    constructor(code, message, status = 0) {
      super(message);
      this.name = "CloudError";
      this.code = code;
      this.status = status;
    }
  }

  const get = async (k, d) => (await chrome.storage.local.get(k))[k] ?? d;
  const set = (k, v) => chrome.storage.local.set({ [k]: v });
  const loadConfig = async () => ({ intervalMin: 5, enabled: false, ...(await get(K.config, {})) });
  const saveConfig = async (patch) => {
    const next = { ...(await loadConfig()), ...patch };
    await set(K.config, next);
    return next;
  };
  const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  // ------------------------------------------------------------ partes puras
  function normalizeUrl(u) {
    const s = String(u || "").trim().replace(/\/+$/, "").replace(/\/(rest|auth)\/v1$/, "");
    if (!/^https?:\/\/[^/\s]+$/i.test(s)) throw new CloudError("CONFIG", "Endereço do projeto inválido. Use o “Project URL”, como https://abcdxyz.supabase.co");
    return s;
  }
  const projectRef = (url) => (String(url).match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/i) || [])[1] || null;

  // hash estável e rápido (cyrb53) do JSON do registro
  function hash(value) {
    const str = JSON.stringify(value) ?? "";
    let h1 = 0xdeadbeef ^ 0;
    let h2 = 0x41c6ce57 ^ 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  // Blob/ArrayBuffer não vão para a nuvem nesta versão (mídias, figurinhas)
  function hasBinary(v, depth = 0) {
    if (v == null || typeof v !== "object" || depth > 6) return false;
    if ((typeof Blob !== "undefined" && v instanceof Blob) || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return true;
    return Object.values(v).some((x) => hasBinary(x, depth + 1));
  }

  // chave do IndexedDB ↔ id de texto
  const keyToId = (k) => (typeof k === "string" ? k : `j:${JSON.stringify(k)}`);
  const idToKey = (id) => (id.startsWith("j:") ? JSON.parse(id.slice(2)) : id);

  // Planeja uma sincronização normal. local/state/remote → o que aplicar aqui e o que enviar.
  //   local:  Map<store, Map<id, { value, hash }>>
  //   state:  { "<store>": { "<id>": hash } } (como estava na última sincronização)
  //   remote: [{ store, id, data, deleted }] (o que mudou na nuvem, de outros dispositivos)
  // Regra: se o registro mudou aqui desde a última vez, o daqui vence (vai ser enviado).
  function plan(local, state, remote) {
    const apply = [];
    const next = JSON.parse(JSON.stringify(state || {}));
    for (const r of remote) {
      const cur = local.get(r.store)?.get(r.id);
      const was = state?.[r.store]?.[r.id];
      const changedHere = cur ? cur.hash !== was : was !== undefined;
      if (changedHere) continue;
      if (r.deleted) {
        if (cur) apply.push({ store: r.store, id: r.id, deleted: true });
        if (next[r.store]) delete next[r.store][r.id];
        continue;
      }
      const h = hash(r.data);
      if (!cur || cur.hash !== h) apply.push({ store: r.store, id: r.id, data: r.data });
      (next[r.store] ||= {})[r.id] = h;
    }
    // o que foi aplicado agora já está "em dia"; o resto que mudou aqui sobe
    const applied = new Set(apply.map((a) => `${a.store}\u0000${a.id}`));
    const push = [];
    for (const [store, items] of local) {
      for (const [id, it] of items) {
        if (applied.has(`${store}\u0000${id}`)) continue;
        if (next[store]?.[id] !== it.hash) {
          push.push({ store, id, data: it.value, hash: it.hash, deleted: false });
          (next[store] ||= {})[id] = it.hash;
        }
      }
    }
    for (const [store, ids] of Object.entries(state || {})) {
      for (const id of Object.keys(ids)) {
        if (local.get(store)?.has(id) || applied.has(`${store}\u0000${id}`)) continue;
        if (remote.some((r) => r.store === store && r.id === id)) continue; // já tratado acima
        push.push({ store, id, data: null, hash: null, deleted: true });
        if (next[store]) delete next[store][id];
      }
    }
    return { apply, push, state: next };
  }

  // Primeira conexão com dados dos dois lados.
  //   mode "merge": une; se o mesmo registro difere, fica o de updatedAt maior (senão o daqui)
  //   mode "pull":  a nuvem substitui este computador
  //   mode "push":  este computador substitui a nuvem
  function planInitial(local, remoteAll, mode) {
    const remote = new Map();
    for (const r of remoteAll) if (!r.deleted) (remote.get(r.store) || remote.set(r.store, new Map()).get(r.store)).set(r.id, r.data);
    const apply = [];
    const push = [];
    const state = {};
    const put = (store, id, h) => ((state[store] ||= {})[id] = h);
    const stamp = (v) => Number(v?.updatedAt || v?.updated_at || v?.lastMessageAt || v?.ts || 0);
    if (mode === "pull") {
      for (const [store, items] of local) for (const id of items.keys()) if (!remote.get(store)?.has(id)) apply.push({ store, id, deleted: true });
      for (const [store, items] of remote) for (const [id, data] of items) {
        const h = hash(data);
        if (local.get(store)?.get(id)?.hash !== h) apply.push({ store, id, data });
        put(store, id, h);
      }
      return { apply, push, state };
    }
    if (mode === "push") {
      for (const [store, items] of remote) for (const id of items.keys()) if (!local.get(store)?.has(id)) push.push({ store, id, data: null, hash: null, deleted: true });
      for (const [store, items] of local) for (const [id, it] of items) {
        if (hash(remote.get(store)?.get(id)) !== it.hash) push.push({ store, id, data: it.value, hash: it.hash, deleted: false });
        put(store, id, it.hash);
      }
      return { apply, push, state };
    }
    // merge
    const stores = new Set([...local.keys(), ...remote.keys()]);
    for (const store of stores) {
      const L = local.get(store) || new Map();
      const Rm = remote.get(store) || new Map();
      for (const id of new Set([...L.keys(), ...Rm.keys()])) {
        const l = L.get(id);
        const hasR = Rm.has(id);
        const r = Rm.get(id);
        if (l && !hasR) {
          push.push({ store, id, data: l.value, hash: l.hash, deleted: false });
          put(store, id, l.hash);
        } else if (!l && hasR) {
          apply.push({ store, id, data: r });
          put(store, id, hash(r));
        } else if (l.hash === hash(r)) put(store, id, l.hash);
        else if (stamp(r) > stamp(l.value)) {
          apply.push({ store, id, data: r });
          put(store, id, hash(r));
        } else {
          push.push({ store, id, data: l.value, hash: l.hash, deleted: false });
          put(store, id, l.hash);
        }
      }
    }
    return { apply, push, state };
  }

  // ------------------------------------------------------------ HTTP
  async function http(url, init, what) {
    let r;
    try {
      r = await fetch(url, init);
    } catch {
      throw new CloudError("NETWORK", `Sem conexão com o Supabase (${what}).`);
    }
    const text = await r.text().catch(() => "");
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    if (!r.ok) {
      const msg = String(body?.msg || body?.message || body?.error_description || body?.error || text || "").slice(0, 240);
      if (r.status === 401 || r.status === 403) throw new CloudError("AUTH", `O Supabase recusou o acesso (${what})${msg ? `: ${msg}` : "."}`, r.status);
      if (r.status === 404 || /PGRST205|42P01|does not exist|Could not find the table/i.test(msg)) throw new CloudError("NO_TABLE", `A tabela ${TABLE} ainda não existe no seu projeto.`, r.status);
      if (r.status === 429) throw new CloudError("RATE_LIMIT", "Muitos pedidos ao Supabase agora. Tente de novo em instantes.", r.status);
      throw new CloudError("PROVIDER", `O Supabase respondeu HTTP ${r.status} (${what})${msg ? `: ${msg}` : "."}`, r.status);
    }
    return { body, headers: r.headers };
  }

  // ------------------------------------------------------------ conta (Supabase Auth)
  async function authCall(cfg, path, payload, what) {
    return (await http(`${cfg.url}/auth/v1/${path}`, { method: "POST", headers: { apikey: cfg.key, "Content-Type": "application/json" }, body: JSON.stringify(payload) }, what)).body;
  }
  async function storeSession(s) {
    if (!s?.access_token) return null;
    const sec = { accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: Date.now() + (Number(s.expires_in) || 3600) * 1000 };
    await set(K.secrets, sec);
    return sec;
  }
  async function signIn(cfg, email, password) {
    const s = await authCall(cfg, "token?grant_type=password", { email, password }, "entrar");
    await storeSession(s);
    return { userId: s.user?.id, email: s.user?.email || email };
  }
  // Cria o usuário. Se o projeto exige confirmar o e-mail, não há sessão ainda.
  async function signUp(cfg, email, password) {
    const s = await authCall(cfg, "signup", { email, password }, "criar usuário");
    if (s?.access_token) {
      await storeSession(s);
      return { userId: s.user?.id, email, confirmed: true };
    }
    return { userId: s?.id || s?.user?.id, email, confirmed: false };
  }
  async function token(cfg) {
    const sec = await get(K.secrets, {});
    if (sec.accessToken && sec.expiresAt - 60000 > Date.now()) return sec.accessToken;
    if (!sec.refreshToken) throw new CloudError("LOGIN", "Entre de novo na sua conta da Órbita Cloud (Opções → Cloud).");
    try {
      return (await storeSession(await authCall(cfg, "token?grant_type=refresh_token", { refresh_token: sec.refreshToken }, "renovar sessão"))).accessToken;
    } catch (e) {
      if (e.code === "AUTH" || e.status === 400) throw new CloudError("LOGIN", "A sessão da Órbita Cloud expirou. Entre de novo em Opções → Cloud.");
      throw e;
    }
  }

  // ------------------------------------------------------------ tabela
  // Cria a tabela pela API de gerenciamento (token pessoal sbp_…, usado só agora e não guardado).
  async function createSchema(cfg, pat, { mgmtBase = MGMT } = {}) {
    const ref = cfg.mgmtRef || projectRef(cfg.url);
    if (!ref) throw new CloudError("CONFIG", "Não reconheci o projeto pelo endereço. Rode o SQL manualmente no SQL Editor do Supabase.");
    await http(`${mgmtBase}/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${String(pat || "").trim()}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: SQL }) }, "criar a tabela");
  }

  async function rest(cfg, path, init = {}, what = "dados") {
    const t = await token(cfg);
    return http(`${cfg.url}/rest/v1/${path}`, { ...init, headers: { apikey: cfg.key, Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init.headers || {}) } }, what);
  }
  async function checkTable(cfg) {
    try {
      await rest(cfg, `${TABLE}?select=id&limit=1`, {}, "conferir a tabela");
      return true;
    } catch (e) {
      if (e.code === "NO_TABLE") return false;
      throw e;
    }
  }
  async function remoteCount(cfg) {
    const { headers } = await rest(cfg, `${TABLE}?select=id&deleted=eq.false&limit=1`, { headers: { Prefer: "count=exact" } }, "contar");
    return Number(String(headers.get("content-range") || "").split("/")[1]) || 0;
  }
  // linhas mudadas depois de "since" (todas, se since vazio), em páginas
  async function pull(cfg, since, { onlyLive = false } = {}) {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const q = `${TABLE}?select=store,id,data,deleted,device,updated_at&order=updated_at.asc,store.asc,id.asc&limit=1000&offset=${offset}${since ? `&updated_at=gt.${encodeURIComponent(since)}` : ""}${onlyLive ? "&deleted=eq.false" : ""}`;
      const { body } = await rest(cfg, q, {}, "baixar");
      out.push(...(body || []));
      if (!body || body.length < 1000) return out;
    }
  }
  async function upsert(cfg, rows, onProgress) {
    for (let i = 0; i < rows.length; i += BATCH) {
      const part = rows.slice(i, i + BATCH).map((r) => ({ user_id: cfg.userId, store: r.store, id: r.id, data: r.deleted ? null : r.data, hash: r.hash, deleted: Boolean(r.deleted), device: cfg.device }));
      await rest(cfg, `${TABLE}?on_conflict=user_id,store,id`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(part) }, "enviar");
      onProgress?.(Math.min(rows.length, i + BATCH), rows.length);
    }
  }
  async function latestStamp(cfg) {
    const { body } = await rest(cfg, `${TABLE}?select=updated_at&order=updated_at.desc&limit=1`, {}, "conferir");
    return body?.[0]?.updated_at || null;
  }

  // ------------------------------------------------------------ dados locais
  const req = (r) => new Promise((res, rej) => ((r.onsuccess = () => res(r.result)), (r.onerror = () => rej(r.error))));
  const done = (tx) => new Promise((res, rej) => ((tx.oncomplete = res), (tx.onerror = () => rej(tx.error)), (tx.onabort = () => rej(tx.error))));
  function openExisting(name) {
    return new Promise((resolve) => {
      const r = indexedDB.open(name);
      r.onupgradeneeded = () => r.transaction.abort(); // não existia: não cria
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    });
  }
  async function readDb(name, stores, out, skipped, skip = []) {
    const db = await openExisting(name);
    if (!db) return;
    try {
      const names = [...db.objectStoreNames].filter((n) => (!stores || stores.includes(n)) && !skip.includes(n));
      for (const n of names) {
        const m = new Map();
        await new Promise((resolve, reject) => {
          const cur = db.transaction(n).objectStore(n).openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (!c) return resolve();
            if (hasBinary(c.value)) skipped.n++;
            else m.set(keyToId(c.key), { value: c.value, hash: hash(c.value) });
            c.continue();
          };
          cur.onerror = () => reject(cur.error);
        });
        out.set(`${name}/${n}`, m);
      }
    } finally {
      db.close();
    }
  }
  function storageValue(k, v) {
    if (k === "orbita:ai" && v && typeof v === "object") {
      const { apiKey, keys, ...rest } = v; // chaves de IA nunca sobem
      return rest;
    }
    return v;
  }
  async function hasMainDb() {
    const db = await openExisting(MAIN_DB);
    db?.close();
    return Boolean(db);
  }
  async function collectLocal() {
    const out = new Map();
    const skipped = { n: 0 };
    await readDb(MAIN_DB, null, out, skipped, MAIN_SKIP);
    await readDb(CHAT_DB, CHAT_STORES, out, skipped);
    const all = await chrome.storage.local.get(null);
    const m = new Map();
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith("orbita") || STORAGE_SKIP.test(k)) continue;
      const val = storageValue(k, v);
      m.set(k, { value: val, hash: hash(val) });
    }
    out.set("@storage", m);
    return { local: out, skipped: skipped.n };
  }

  // grava no IndexedDB/chrome.storage o que veio da nuvem
  async function applyLocal(items) {
    const byStore = new Map();
    for (const it of items) (byStore.get(it.store) || byStore.set(it.store, []).get(it.store)).push(it);
    for (const [store, list] of byStore) {
      if (store === "@storage") {
        const setObj = {};
        const del = [];
        for (const it of list) {
          if (!it.id.startsWith("orbita") || STORAGE_SKIP.test(it.id)) continue;
          if (it.deleted) del.push(it.id);
          else if (it.id === "orbita:ai") {
            const cur = await get("orbita:ai", {});
            setObj[it.id] = { ...it.data, ...(cur.keys ? { keys: cur.keys } : {}), ...(cur.apiKey ? { apiKey: cur.apiKey } : {}) }; // mantém as chaves daqui
          } else setObj[it.id] = it.data;
        }
        if (Object.keys(setObj).length) await chrome.storage.local.set(setObj);
        if (del.length) await chrome.storage.local.remove(del);
        continue;
      }
      const [dbName, storeName] = store.split("/");
      if (![MAIN_DB, CHAT_DB].includes(dbName)) continue;
      const shared = dbName === CHAT_DB && Boolean(globalThis.OrbitaChat?.openDb); // conexão compartilhada: não fechar
      const db = shared ? await globalThis.OrbitaChat.openDb() : await openExisting(dbName);
      if (!db) continue;
      try {
        if (!db.objectStoreNames.contains(storeName)) continue;
        const tx = db.transaction(storeName, "readwrite");
        const st = tx.objectStore(storeName);
        for (const it of list) {
          const key = idToKey(it.id);
          if (it.deleted) st.delete(key);
          else if (st.keyPath == null) st.put(it.data, key);
          else st.put(it.data);
        }
        await done(tx);
      } finally {
        if (!shared) db.close();
      }
    }
    // as telas abertas se atualizam
    try {
      const ch = new BroadcastChannel("orbita-data");
      for (const topic of ["lists", "crm", "campaigns", "agenda", "settings"]) ch.postMessage({ topic });
      ch.close();
    } catch {}
  }

  // ------------------------------------------------------------ sincronizar
  async function withLock(fn) {
    const lock = await get(K.lock, 0);
    if (lock > Date.now()) throw new CloudError("BUSY", "Já há uma sincronização em andamento.");
    await set(K.lock, Date.now() + 10 * 60000);
    try {
      return await fn();
    } finally {
      await set(K.lock, 0);
    }
  }

  // mode: "normal" | "merge" | "pull" | "push". onProgress({ step, done, total })
  async function sync({ mode = "normal", onProgress = () => {} } = {}) {
    return withLock(async () => {
      let cfg = await loadConfig();
      if (!cfg.url || !cfg.key || !cfg.userId) throw new CloudError("CONFIG", "A Órbita Cloud não está configurada.");
      if (!cfg.device) cfg = await saveConfig({ device: uuid() });
      const st = await get(K.state, {});
      try {
        if (!(await hasMainDb())) throw new CloudError("NO_DB", "Abra o painel da Órbita uma vez antes de sincronizar (o banco local ainda não foi criado).");
        // cursor tirado ANTES de baixar: o que chegar durante a rodada vem de novo na próxima (sem perder nada)
        const cursor = await latestStamp(cfg);
        onProgress({ step: "Lendo os dados deste computador…" });
        const { local, skipped } = await collectLocal();
        let p;
        let remoteRows;
        if (mode === "normal") {
          onProgress({ step: "Baixando o que mudou na nuvem…" });
          remoteRows = (await pull(cfg, st.pulledUntil)).filter((r) => r.device !== cfg.device);
          p = plan(local, st.hashes || {}, remoteRows);
        } else {
          onProgress({ step: "Baixando os dados da nuvem…" });
          remoteRows = await pull(cfg, null, { onlyLive: true });
          p = planInitial(local, remoteRows, mode);
        }
        if (p.apply.length) {
          onProgress({ step: `Aplicando ${p.apply.length} alterações da nuvem…` });
          await applyLocal(p.apply);
        }
        if (p.push.length) await upsert(cfg, p.push, (d, t) => onProgress({ step: `Enviando para a nuvem: ${d} de ${t}…`, done: d, total: t }));
        await set(K.state, { hashes: p.state, pulledUntil: cursor || st.pulledUntil || null });
        const stats = { down: p.apply.length, up: p.push.length, skippedFiles: skipped, at: Date.now() };
        await saveConfig({ lastSyncAt: Date.now(), lastError: "", lastStats: stats });
        return stats;
      } catch (e) {
        await saveConfig({ lastError: e.message, lastErrorAt: Date.now() });
        throw e;
      }
    });
  }

  async function disconnect({ forget = false } = {}) {
    await saveConfig({ enabled: false });
    if (forget) await chrome.storage.local.remove([K.config, K.secrets, K.state, K.lock]);
    try {
      await chrome.alarms.clear("orbita-cloud");
    } catch {}
  }

  // alarme da sincronização automática (chamado nas Opções e ao iniciar o service worker)
  async function schedule() {
    const cfg = await loadConfig();
    try {
      await chrome.alarms.clear("orbita-cloud");
      if (cfg.enabled && cfg.intervalMin > 0) await chrome.alarms.create("orbita-cloud", { periodInMinutes: Math.max(1, cfg.intervalMin), delayInMinutes: 1 });
    } catch {}
  }

  // ao iniciar o service worker: recria o alarme só se sumiu ou mudou (sem reiniciar a contagem)
  async function ensureSchedule() {
    const cfg = await loadConfig();
    const a = await chrome.alarms.get("orbita-cloud").catch(() => null);
    const want = cfg.enabled && cfg.intervalMin > 0 ? Math.max(1, cfg.intervalMin) : 0;
    if ((a?.periodInMinutes || 0) !== want) await schedule();
  }

  globalThis.OrbitaCloud = {
    SQL, TABLE, K, CloudError,
    normalizeUrl, projectRef, hash, hasBinary, keyToId, idToKey, plan, planInitial,
    loadConfig, saveConfig, signIn, signUp, token, createSchema, checkTable, remoteCount,
    collectLocal, applyLocal, sync, disconnect, schedule, ensureSchedule,
  };
})();
