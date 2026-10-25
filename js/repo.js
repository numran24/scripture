// Local-first data layer. Everything is cached in memory (a few hundred small records) and written
// through to a storage adapter (IndexedDB in the browser, a Map in tests).
// Every write stamps updatedAt and marks the record "dirty" so sync can push it (last-write-wins).
import { clone, stable } from './util.js';
import { defaultProgress } from './srs.js';

export const KF = { verses: 'id', progress: 'id', lie: 'key', kv: 'key' };
const KIND = { verses: 'verse', progress: 'progress', lie: 'lie', kv: 'kv' };
const KIND_STORE = Object.fromEntries(Object.entries(KIND).map(([s, k]) => [k, s]));
export const STORE_KEYS = { ...KF, backups: 'key', dirty: 'key' };
const MAX_BACKUPS = 10;
const META = new Set(['updatedAt', 'deleted']);
const content = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !META.has(k)));

export class MemoryAdapter {
  constructor() { this.d = Object.fromEntries(Object.keys(STORE_KEYS).map((s) => [s, new Map()])); }
  async getAll(s) { return [...this.d[s].values()].map(clone); }
  async put(s, o) { this.d[s].set(o[STORE_KEYS[s]], clone(o)); }
  async delete(s, key) { this.d[s].delete(key); }
}

export class IDBAdapter {
  constructor(name = 'scripture-db') { this.name = name; this.db = null; }
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => { for (const [s, kp] of Object.entries(STORE_KEYS)) r.result.createObjectStore(s, { keyPath: kp }); };
      r.onsuccess = () => { this.db = r.result; res(this); };
      r.onerror = () => rej(r.error);
    });
  }
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  getAll(s) { return this.tx(s, 'readonly', (os) => os.getAll()); }
  put(s, o) { return this.tx(s, 'readwrite', (os) => os.put(o)); }
  delete(s, key) { return this.tx(s, 'readwrite', (os) => os.delete(key)); }
}

export class Repo {
  constructor(adapter, { clock = () => Date.now() } = {}) {
    this.a = adapter; this.clock = clock;
    this.m = { verses: new Map(), progress: new Map(), lie: new Map(), kv: new Map() };
    this.dirty = new Set(); this.backupList = [];
    this._chain = Promise.resolve(); this._last = 0; this.listeners = new Set();
    this._vcache = null; this._lcache = null;
  }

  async load() {
    for (const s of Object.keys(this.m)) {
      for (const o of await this.a.getAll(s)) {
        this.m[s].set(o[KF[s]], o);
        if (o.updatedAt > this._last) this._last = o.updatedAt;
      }
    }
    for (const d of await this.a.getAll('dirty')) this.dirty.add(d.key);
    this.backupList = (await this.a.getAll('backups')).sort((x, y) => x.takenAt - y.takenAt);
    this._vcache = this._lcache = null;
    return this;
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { this.listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); }
  ts() { let t = this.clock(); if (t <= this._last) t = this._last + 1; this._last = t; return t; }
  _persist(fn) { this._chain = this._chain.then(fn).catch((e) => console.error('storage error', e)); }
  flush() { return this._chain; }

  _write(store, obj, { remote = false } = {}) {
    const key = obj[KF[store]];
    if (!remote) { obj.updatedAt = this.ts(); this._markDirty(store, key); }
    this.m[store].set(key, obj);
    if (store === 'verses') this._vcache = null;
    if (store === 'lie') this._lcache = null;
    this._persist(() => this.a.put(store, obj));
    if (!remote) this._emit();
  }
  _markDirty(store, key) {
    const k = `${KIND[store]}:${key}`;
    if (this.dirty.has(k)) return;
    this.dirty.add(k);
    this._persist(() => this.a.put('dirty', { key: k }));
  }
  _tombstone(store, key) { this._write(store, { [KF[store]]: key, deleted: true }); }
  list(store) { return [...this.m[store].values()].filter((o) => !o.deleted); }

  // ---- verses (content). Treat returned objects as read-only; copy before changing. ----
  verses() {
    if (!this._vcache) {
      this._vcache = this.list('verses');
      this._vcache.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    }
    return this._vcache;
  }
  verse(id) { const v = this.m.verses.get(id); return v && !v.deleted ? v : null; }
  saveVerse(v) { this._write('verses', { ...v, deleted: false }); }
  removeVerse(id) { this._tombstone('verses', id); }
  nextVerseId() {
    let max = 0;
    for (const k of this.m.verses.keys()) if (/^\d+$/.test(k)) max = Math.max(max, Number(k));
    return String(max + 1).padStart(3, '0');
  }

  // ---- progress (by verse id; never touched by content imports) ----
  getProgress(id) { const p = this.m.progress.get(id); return p && !p.deleted ? clone(p) : defaultProgress(id); }
  saveProgress(p) { this._write('progress', { ...p, deleted: false }); }
  allProgress() { return this.list('progress'); }

  // ---- Lie-to-Truth ----
  lies() {
    if (!this._lcache) this._lcache = this.list('lie');
    return this._lcache;
  }
  saveLie(l) { this._write('lie', { ...l, deleted: false }); }
  removeLie(key) { this._tombstone('lie', key); }

  // ---- key/value (plan, settings, daily, meta, reads) ----
  getKV(key, dflt) { const o = this.m.kv.get(key); return o && !o.deleted ? clone(o.value) : dflt; }
  setKV(key, value) { this._write('kv', { key, value: clone(value), deleted: false }); }
  delKV(key) { if (this.m.kv.has(key) && !this.m.kv.get(key).deleted) this._tombstone('kv', key); }
  kvList(prefix) {
    return this.list('kv').filter((o) => o.key.startsWith(prefix)).map((o) => ({ key: o.key, value: clone(o.value) }));
  }

  // ---- sync helpers ----
  applyRemote(kind, id, data, deleted, updatedAt) {
    const store = KIND_STORE[kind];
    if (!store) return false;
    const cur = this.m[store].get(id);
    if (cur && (cur.updatedAt || 0) >= updatedAt) return false;
    const obj = deleted ? { [KF[store]]: id, deleted: true, updatedAt } : { ...data, [KF[store]]: id, deleted: false, updatedAt };
    this._write(store, obj, { remote: true });
    if (updatedAt > this._last) this._last = updatedAt;
    const k = `${kind}:${id}`;
    if (this.dirty.delete(k)) this._persist(() => this.a.delete('dirty', k));
    return true;
  }
  dirtyDocs() {
    const out = [];
    for (const k of this.dirty) {
      const i = k.indexOf(':');
      const kind = k.slice(0, i), id = k.slice(i + 1);
      const obj = this.m[KIND_STORE[kind]]?.get(id);
      if (obj) out.push({ kind, id, data: content(obj), deleted: !!obj.deleted, updatedAt: obj.updatedAt });
    }
    return out;
  }
  clearDirty(docs) {
    for (const d of docs) {
      const cur = this.m[KIND_STORE[d.kind]]?.get(d.id);
      const k = `${d.kind}:${d.id}`;
      if (cur && cur.updatedAt === d.updatedAt && this.dirty.delete(k)) this._persist(() => this.a.delete('dirty', k));
    }
  }
  markAllDirty() {
    for (const s of Object.keys(this.m)) for (const o of this.m[s].values()) this._markDirty(s, o[KF[s]]);
  }

  // ---- backups / undo ----
  _snapshot(kind) {
    const copy = (s) => this.list(s).map((o) => clone(content(o)));
    if (kind === 'verses') return { verses: copy('verses'), meta: this.getKV('meta', null) };
    if (kind === 'lie') return { lie: copy('lie'), meta: this.getKV('meta', null) };
    return { verses: copy('verses'), progress: copy('progress'), lie: copy('lie'), kv: copy('kv') };
  }
  createBackup(kind, label, summary = {}) {
    const rec = { key: 'b' + this.clock() + Math.random().toString(36).slice(2, 6), kind, label, summary, takenAt: this.clock(), data: this._snapshot(kind) };
    this.backupList.push(rec);
    this._persist(() => this.a.put('backups', rec));
    while (this.backupList.length > MAX_BACKUPS) {
      const old = this.backupList.shift();
      this._persist(() => this.a.delete('backups', old.key));
    }
    return rec;
  }
  lastBackup() { return this.backupList[this.backupList.length - 1] || null; }

  _restoreStore(store, list) {
    const kf = KF[store];
    const keep = new Set(list.map((o) => o[kf]));
    for (const o of this.list(store)) if (!keep.has(o[kf])) this._tombstone(store, o[kf]);
    for (const o of list) {
      const cur = this.m[store].get(o[kf]);
      if (!cur || cur.deleted || stable(content(cur)) !== stable(content(o))) this._write(store, { ...content(o), deleted: false });
    }
  }
  _restore(rec) {
    const d = rec.data;
    if (d.verses) this._restoreStore('verses', d.verses);
    if (d.lie && (rec.kind === 'lie' || rec.kind === 'all')) this._restoreStore('lie', d.lie);
    if (rec.kind === 'all') { this._restoreStore('progress', d.progress || []); this._restoreStore('kv', d.kv || []); }
    else if (d.meta !== undefined) { d.meta ? this.setKV('meta', d.meta) : this.delKV('meta'); }
    this._vcache = this._lcache = null;
  }
  /** Restore the most recent backup (taken automatically before each import) and discard it. */
  undoLastImport() {
    const rec = this.lastBackup();
    if (!rec) return null;
    // Verse backups restore verses only; Lie backups restore lie only.
    const only = rec.kind === 'verses' ? { ...rec, data: { verses: rec.data.verses, meta: rec.data.meta } }
      : rec.kind === 'lie' ? { ...rec, data: { lie: rec.data.lie, meta: rec.data.meta } } : rec;
    this._restore(only);
    this.backupList.pop();
    this._persist(() => this.a.delete('backups', rec.key));
    this._emit();
    return rec;
  }

  // ---- full backup file ----
  exportAll() {
    const copy = (s) => this.list(s).map((o) => clone(content(o)));
    return { app: 'scripture-app', version: 1, exportedAt: new Date(this.clock()).toISOString(),
      verses: copy('verses'), progress: copy('progress'), lie: copy('lie'), kv: copy('kv') };
  }
  restoreAll(json) {
    if (!json || json.app !== 'scripture-app' || !Array.isArray(json.verses)) throw new Error('This is not a Scripture backup file.');
    const rec = this.createBackup('all', 'Before restoring a backup file', { verses: json.verses.length });
    this._restore({ kind: 'all', data: { verses: json.verses, progress: json.progress || [], lie: json.lie || [], kv: json.kv || [] } });
    this._emit();
    return rec;
  }
}
