// Local-first store. Everything lives in memory (it is small) and is written through to
// IndexedDB. Each record is { id:'kind:key', kind, key, data, u (updated ms), d (deleted) }.
// Kinds: verse, lie, mem, log, read, note, settings. These sync. 'kv' and 'backups' are local only.

const DB_NAME = 'scripture', DB_VER = 1;
let idb = null;
const cache = new Map();
const kvCache = new Map();
const listeners = new Set();
let lastU = 0;
export let persistent = true;

export const SYNC_KINDS = ['verse', 'lie', 'mem', 'log', 'read', 'note', 'settings'];
export const CONTENT_KINDS = ['verse', 'lie'];

export function now() {
  lastU = Math.max(Date.now(), lastU + 1);
  return lastU;
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(kinds) { listeners.forEach((f) => { try { f(kinds); } catch (e) { console.error(e); } }); }

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function txDone(tx) {
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}

export async function open() {
  try {
    idb = await new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('records', { keyPath: 'id' });
        db.createObjectStore('kv', { keyPath: 'k' });
        db.createObjectStore('backups', { keyPath: 'n', autoIncrement: true });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const recs = await req(idb.transaction('records').objectStore('records').getAll());
    recs.forEach((x) => { cache.set(x.id, x); lastU = Math.max(lastU, x.u || 0); });
    const kvs = await req(idb.transaction('kv').objectStore('kv').getAll());
    kvs.forEach((x) => kvCache.set(x.k, x.v));
  } catch (e) {
    console.warn('IndexedDB unavailable, running in memory only', e);
    persistent = false;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

function write(recs) {
  if (!idb) return Promise.resolve();
  const tx = idb.transaction('records', 'readwrite');
  const st = tx.objectStore('records');
  recs.forEach((r) => st.put(r));
  return txDone(tx);
}

/* ---- reads ---- */
export function raw(kind, key) { return cache.get(kind + ':' + key); }
export function get(kind, key) {
  const r = cache.get(kind + ':' + key);
  return r && !r.d ? r.data : undefined;
}
export function all(kind) {
  const out = [];
  for (const r of cache.values()) if (r.kind === kind && !r.d) out.push({ key: r.key, data: r.data });
  return out;
}
export function allRaw() { return [...cache.values()]; }

/* ---- writes ---- */
export function put(kind, key, data) {
  const r = { id: kind + ':' + key, kind, key, data, u: now(), d: false };
  cache.set(r.id, r);
  emit([kind]);
  return write([r]);
}
export function putMany(items) { // [{kind,key,data}] or [{kind,key,del:true}]
  const recs = items.map((x) => {
    const old = cache.get(x.kind + ':' + x.key);
    return { id: x.kind + ':' + x.key, kind: x.kind, key: x.key, data: x.del ? (old ? old.data : null) : x.data, u: now(), d: !!x.del };
  });
  recs.forEach((r) => cache.set(r.id, r));
  emit([...new Set(recs.map((r) => r.kind))]);
  return write(recs);
}
export function del(kind, key) { return putMany([{ kind, key, del: true }]); }
/** Used by sync: take a remote record verbatim (keeps its timestamp). */
export function putRaw(recs) {
  recs.forEach((r) => { r.id = r.kind + ':' + r.key; cache.set(r.id, r); lastU = Math.max(lastU, r.u || 0); });
  emit([...new Set(recs.map((r) => r.kind))]);
  return write(recs);
}

/* ---- local-only key/value ---- */
export function kvGet(k, dflt) { return kvCache.has(k) ? kvCache.get(k) : dflt; }
export function kvSet(k, v) {
  kvCache.set(k, v);
  if (!idb) return Promise.resolve();
  const tx = idb.transaction('kv', 'readwrite');
  tx.objectStore('kv').put({ k, v });
  return txDone(tx);
}

/* ---- backups (before every import) ---- */
const MAX_BACKUPS = 8;
export async function makeBackup(label, extra = {}) {
  const snap = { at: Date.now(), label, ...extra, records: allRaw().map((r) => ({ ...r })) };
  if (!idb) { (makeBackup.mem ||= []).push(snap); return snap; }
  const tx = idb.transaction('backups', 'readwrite');
  const st = tx.objectStore('backups');
  st.add(snap);
  await txDone(tx);
  const list = await listBackups();
  if (list.length > MAX_BACKUPS) {
    const tx2 = idb.transaction('backups', 'readwrite');
    list.slice(0, list.length - MAX_BACKUPS).forEach((b) => tx2.objectStore('backups').delete(b.n));
    await txDone(tx2);
  }
  return snap;
}
export async function listBackups() {
  if (!idb) return makeBackup.mem || [];
  const l = await req(idb.transaction('backups').objectStore('backups').getAll());
  return l.sort((a, b) => a.n - b.n);
}
export async function deleteBackup(n) {
  if (!idb) { makeBackup.mem.pop(); return; }
  const tx = idb.transaction('backups', 'readwrite');
  tx.objectStore('backups').delete(n);
  return txDone(tx);
}
/**
 * Put the given kinds back exactly as they were in a snapshot.
 * Records that did not exist then are marked deleted; the rest are rewritten with a
 * fresh timestamp so the change also wins on other devices. Progress kinds are left alone.
 */
export async function restoreKinds(snap, kinds) {
  const then = new Map(snap.records.filter((r) => kinds.includes(r.kind)).map((r) => [r.id, r]));
  const items = [];
  for (const r of cache.values()) {
    if (!kinds.includes(r.kind)) continue;
    if (!then.has(r.id) && !r.d) items.push({ kind: r.kind, key: r.key, del: true });
  }
  for (const r of then.values()) items.push(r.d ? { kind: r.kind, key: r.key, del: true } : { kind: r.kind, key: r.key, data: r.data });
  await putMany(items);
}
/** Full restore from a backup file (every kind). */
export async function restoreAll(records) {
  const items = [];
  const incoming = new Set(records.map((r) => r.kind + ':' + r.key));
  for (const r of cache.values()) if (SYNC_KINDS.includes(r.kind) && !r.d && !incoming.has(r.id)) items.push({ kind: r.kind, key: r.key, del: true });
  for (const r of records) if (SYNC_KINDS.includes(r.kind)) items.push(r.d ? { kind: r.kind, key: r.key, del: true } : { kind: r.kind, key: r.key, data: r.data });
  await putMany(items);
}
