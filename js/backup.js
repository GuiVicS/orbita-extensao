// Backup completo da Órbita: banco local (IndexedDB "orbita": listas, contatos,
// campanhas, mídias, histórico, CRM, agenda) + chrome.storage.local
// (preferências, respostas rápidas e seus arquivos). As chaves de API da IA não
// entram no arquivo. Expõe globalThis.OrbitaBackup (usado em Configurações).
(() => {
  "use strict";
  const DB = "orbita";
  const FORMAT = "orbita-backup";

  const req = (r) => new Promise((resolve, reject) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => reject(r.error))));
  const openDb = () => req(indexedDB.open(DB));

  function bytesToB64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // valores do IndexedDB podem ter Blob, ArrayBuffer, Date… que o JSON não guarda
  async function encode(v) {
    if (v === null || typeof v !== "object") return v;
    if (v instanceof Blob) return { __orbita: "blob", type: v.type, data: bytesToB64(new Uint8Array(await v.arrayBuffer())) };
    if (v instanceof ArrayBuffer) return { __orbita: "ab", data: bytesToB64(new Uint8Array(v)) };
    if (ArrayBuffer.isView(v)) return { __orbita: "ta", ctor: v.constructor.name, data: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    if (v instanceof Date) return { __orbita: "date", v: v.getTime() };
    if (Array.isArray(v)) return Promise.all(v.map(encode));
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = await encode(x);
    return out;
  }

  function decode(v) {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(decode);
    switch (v.__orbita) {
      case "blob":
        return new Blob([b64ToBytes(v.data)], { type: v.type });
      case "ab":
        return b64ToBytes(v.data).buffer;
      case "ta": {
        const bytes = b64ToBytes(v.data);
        const C = globalThis[v.ctor];
        return typeof C === "function" ? new C(bytes.buffer, 0, bytes.byteLength / (C.BYTES_PER_ELEMENT || 1)) : bytes;
      }
      case "date":
        return new Date(v.v);
    }
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = decode(x);
    return out;
  }

  const stripSecrets = (ai) => {
    if (!ai || typeof ai !== "object") return ai;
    const { apiKey, keys, ...rest } = ai;
    return rest;
  };

  async function create() {
    const db = await openDb();
    const stores = {};
    try {
      for (const name of db.objectStoreNames) {
        const rows = await req(db.transaction(name, "readonly").objectStore(name).getAll());
        stores[name] = await Promise.all(rows.map(encode));
      }
    } finally {
      db.close();
    }
    const storage = await chrome.storage.local.get(null);
    if (storage["orbita:ai"]) storage["orbita:ai"] = stripSecrets(storage["orbita:ai"]);
    return {
      format: FORMAT,
      version: 1,
      app: chrome.runtime.getManifest().version,
      createdAt: new Date().toISOString(),
      dbVersion: db.version,
      indexedDB: stores,
      storage,
      theme: (() => {
        try {
          return localStorage.getItem("orbita-theme");
        } catch {
          return null;
        }
      })(),
    };
  }

  async function download() {
    const backup = await create();
    const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "h");
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `orbita-backup-${stamp}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    const counts = Object.fromEntries(Object.entries(backup.indexedDB).map(([k, v]) => [k, v.length]));
    return { size: blob.size, counts };
  }

  function pickFile() {
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement("input"), { type: "file", accept: "application/json,.json" });
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
  }

  // Substitui TODOS os dados atuais pelos do backup (as chaves de IA atuais são mantidas).
  async function restore(file) {
    file = file || (await pickFile());
    if (!file) return null;
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      throw new Error("Arquivo inválido.");
    }
    if (backup?.format !== FORMAT || typeof backup.indexedDB !== "object" || typeof backup.storage !== "object") throw new Error("Este arquivo não é um backup da Órbita.");
    const when = backup.createdAt ? new Date(backup.createdAt).toLocaleString("pt-BR") : "data desconhecida";
    if (!confirm(`Restaurar o backup de ${when}?\n\nTodos os dados atuais da Órbita (listas, campanhas, CRM, agenda, respostas rápidas e preferências) serão SUBSTITUÍDOS pelos do backup. Pause campanhas em andamento antes.`)) return null;

    const db = await openDb();
    try {
      if (backup.dbVersion > db.version) throw new Error("Este backup é de uma versão mais nova da Órbita. Atualize a extensão antes de restaurar.");
      const names = [...db.objectStoreNames];
      const tx = db.transaction(names, "readwrite");
      const done = new Promise((resolve, reject) => ((tx.oncomplete = resolve), (tx.onerror = () => reject(tx.error)), (tx.onabort = () => reject(tx.error || new Error("Restauração cancelada.")))));
      for (const name of names) {
        const store = tx.objectStore(name);
        store.clear();
        for (const row of backup.indexedDB[name] || []) store.put(decode(row));
      }
      await done;
    } finally {
      db.close();
    }

    const current = await chrome.storage.local.get(null);
    const next = { ...backup.storage };
    const curAi = current["orbita:ai"];
    if (next["orbita:ai"] || curAi) next["orbita:ai"] = { ...(next["orbita:ai"] || {}), ...(curAi?.apiKey ? { apiKey: curAi.apiKey } : {}), ...(curAi?.keys ? { keys: curAi.keys } : {}) };
    const remove = Object.keys(current).filter((k) => !(k in next));
    if (remove.length) await chrome.storage.local.remove(remove);
    await chrome.storage.local.set(next);
    if (backup.theme) {
      try {
        localStorage.setItem("orbita-theme", backup.theme);
      } catch {}
    }
    return { createdAt: backup.createdAt };
  }

  globalThis.OrbitaBackup = { create, download, restore };
})();
