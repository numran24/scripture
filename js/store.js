// Domain layer: turns raw records into what the screens need. All progress is keyed by verse id.
import * as db from './db.js';
import * as L from './logic.js';

/* ---------- settings (three small records so devices rarely overwrite each other) ---------- */
const DEFAULTS = { theme: 'system', split: 6, reminderOn: false, reminderTime: '07:00' };
export const settings = () => ({ ...DEFAULTS, ...(db.get('settings', 'main') || {}) });
export const saveSettings = (p) => db.put('settings', 'main', { ...settings(), ...p });
export const pos = () => db.get('settings', 'plan') || { week: 1, day: 0 };
export const savePos = (p) => db.put('settings', 'plan', { week: p.week, day: p.day });
export const files = () => db.get('settings', 'files') || {};
const saveFiles = (f) => db.put('settings', 'files', f);
export const today = () => L.todayStr();

/* ---------- verses and thoughts ---------- */
let vCache = null, lCache = null, vById = null;
db.onChange((k) => { if (k.includes('verse')) { vCache = null; vById = null; } if (k.includes('lie')) lCache = null; });
export function verses() {
  if (!vCache) vCache = db.all('verse').map((x) => x.data).sort((a, b) => ((a.ord ?? 1e9) - (b.ord ?? 1e9)) || a.id.localeCompare(b.id));
  return vCache;
}
export function verse(id) {
  if (!vById) vById = new Map(verses().map((v) => [v.id, v]));
  return vById.get(id);
}
export function lies() {
  if (!lCache) lCache = db.all('lie').map((x) => x.data).sort((a, b) => ((a.ord ?? 1e9) - (b.ord ?? 1e9)) || a.key.localeCompare(b.key));
  return lCache;
}
export const lie = (key) => lies().find((l) => l.key === key);
export const needsText = (v) => !v.text || !v.text.trim();
export function weekEntries(week) { return verses().filter((v) => v.week === week); }
export function byRef(ref) { const n = L.normRef(ref); return verses().find((v) => L.normRef(v.reference) === n); }
export function liesForRefs(refs) {
  const set = new Set(refs.map(L.normRef));
  return lies().filter((l) => l.refs.some((r) => set.has(L.normRef(r))));
}

/* ---------- reading plan ---------- */
export const todayLog = () => db.get('log', today()) || { slices: [], memorize: false, review: false };
const saveLog = (lg) => db.put('log', today(), lg);

export function clampDay(p, split = settings().split) { return { ...p, day: Math.min(p.day, split - 1) }; }
export function currentSlice(week, day) {
  const split = settings().split;
  return L.sliceFor(weekEntries(week), split, Math.min(day, split - 1));
}
/** Make sure today has an unfinished Read slice pointing at the current plan position. */
export async function ensureSlice() {
  const p = clampDay(pos());
  const lg = todayLog();
  if (p.week > 12) return;
  const last = lg.slices[lg.slices.length - 1];
  if (!last) { lg.slices.push({ week: p.week, day: p.day, done: false }); await saveLog(lg); }
  else if (!last.done && (last.week !== p.week || last.day !== p.day)) { last.week = p.week; last.day = p.day; await saveLog(lg); }
}
export async function markSliceDone(i) {
  const lg = todayLog(), s = lg.slices[i], split = settings().split;
  if (!s || s.done) return;
  const p = clampDay(pos());
  s.prev = { week: p.week, day: p.day };
  s.done = true;
  const entries = L.sliceFor(weekEntries(s.week), split, Math.min(s.day, split - 1));
  const items = entries.map((v) => ({ kind: 'read', key: v.id, data: { d: today(), n: (db.get('read', v.id)?.n || 0) + 1 } }));
  s.ids = entries.map((v) => v.id);
  const np = L.advancePos(p, split);
  await db.putMany(items);
  await savePos(np);
  await saveLog(lg);
}
export async function undoSlice(i) {
  const lg = todayLog(), s = lg.slices[i], split = settings().split;
  if (!s || !s.done || !s.prev) return false;
  const expect = L.advancePos(s.prev, split);
  const p = pos();
  if (p.week !== expect.week || p.day !== expect.day) return false; // a later day was done after it
  const items = (s.ids || []).map((id) => {
    const n = (db.get('read', id)?.n || 1) - 1;
    return n > 0 ? { kind: 'read', key: id, data: { d: today(), n } } : { kind: 'read', key: id, del: true };
  });
  await db.putMany(items);
  await savePos(s.prev);
  s.done = false; delete s.prev; delete s.ids;
  await saveLog(lg);
  return true;
}
export async function addMakeupSlice() {
  const lg = todayLog(), p = clampDay(pos());
  if (p.week > 12 || lg.slices.some((s) => !s.done)) return;
  lg.slices.push({ week: p.week, day: p.day, done: false });
  await saveLog(lg);
}
export async function setPart(part, val) { const lg = todayLog(); lg[part] = val; await saveLog(lg); }
export const isRead = (id) => !!db.get('read', id);
export function readsByDate() {
  const r = {};
  for (const { key, data } of db.all('log')) r[key] = data.slices.filter((s) => s.done).length;
  return r;
}
export const streak = () => L.computeStreak(readsByDate(), today());
export const weeksCompleted = () => Math.min(12, pos().week - 1);

/* ---------- memorize passages ---------- */
export function memAll() { return db.all('mem').map((x) => ({ key: x.key, mem: x.data })).filter((e) => !e.mem.archived); }
export function passageView(key, mem) {
  const vs = verses();
  const ids = mem.seed ? L.resolvePassage(mem.label, vs).ids : (mem.ids || [key]);
  const vv = ids.map(verse).filter(Boolean);
  const label = mem.label || (vv[0] && vv[0].reference) || key;
  return {
    key, mem, label, verses: vv,
    refs: [label, ...vv.map((v) => v.reference)],
    text: vv.map((v) => (v.text || '').trim()).join(' ').trim(),
    handle: vv.map((v) => v.handle).filter(Boolean).join(' '),
    needsText: !vv.length || vv.some(needsText),
    missing: !vv.length,
    ring: vv[0] ? vv[0].ring : '',
  };
}
export function weekPassages(week) {
  const vs = verses();
  return (L.SEED_MEMORIZE[week - 1] || []).map((label) => {
    const r = L.resolvePassage(label, vs);
    return { label, key: r.ids[0] || null };
  });
}
export async function ensureWeekMem(week) {
  const items = [];
  for (const p of weekPassages(week)) {
    if (p.key && !db.get('mem', p.key)) items.push({ kind: 'mem', key: p.key, data: L.newMem(today(), { seed: true, label: p.label }) });
  }
  if (items.length) await db.putMany(items);
}
export function memorizeList() {
  const week = Math.min(pos().week, 12);
  const out = [], seen = new Set();
  for (const p of weekPassages(week)) {
    if (!p.key) { out.push({ key: null, label: p.label, missing: true }); continue; }
    const mem = db.get('mem', p.key);
    if (mem) { out.push(passageView(p.key, mem)); seen.add(p.key); }
  }
  for (const e of memAll()) {
    if (seen.has(e.key) || e.mem.seed) continue;
    if (L.dayDiff(e.mem.added, today()) < 7) { out.push(passageView(e.key, e.mem)); seen.add(e.key); }
  }
  return out;
}
export function reviewList() {
  const ex = new Set(memorizeList().filter((p) => p.key).map((p) => p.key));
  const due = L.dueList(memAll(), today(), L.REVIEW_CAP, ex);
  return due.map((e) => passageView(e.key, e.mem)).filter((p) => !p.missing);
}
export function overdueCount() {
  const ex = new Set(memorizeList().filter((p) => p.key).map((p) => p.key));
  return memAll().filter((e) => e.mem.due <= today() && !ex.has(e.key)).length;
}
export const inQueue = (id) => { const m = db.get('mem', id); return !!m && !m.archived; };
export async function addToQueue(id) {
  const v = verse(id);
  const m = db.get('mem', id);
  if (m && m.archived) return db.put('mem', id, { ...m, archived: false, due: today() });
  if (!m) return db.put('mem', id, L.newMem(today(), { ids: [id], label: v.reference }));
}
export async function removeFromQueue(id) {
  const m = db.get('mem', id);
  if (m) await db.put('mem', id, { ...m, archived: true });
}
export async function grade(key, g) {
  const m = db.get('mem', key);
  if (!m) return;
  await db.put('mem', key, L.applyGrade(m, g, today()));
}
export const memorizedKeys = () => memAll().filter((e) => e.mem.memorized).map((e) => e.key);

/* ---------- notes ---------- */
export const note = (key) => db.get('note', key) || '';
export function saveNote(key, text) {
  return text.trim() ? db.put('note', key, text.trim()) : db.del('note', key);
}

/* ---------- import / backup ---------- */
export async function applyVerseImport(diff, { mode, name }) {
  await db.makeBackup('Before verse import', { kinds: ['verse'], what: 'verses', fileName: name, prevMeta: files().verses || null });
  const items = [];
  for (const a of diff.add) items.push({ kind: 'verse', key: a.verse.id, data: a.verse });
  for (const u of diff.update) {
    const cur = { ...verse(u.id) };
    for (const [c, ch] of Object.entries(u.changes)) cur[c] = ch.to;
    cur.ord = u.ord;
    items.push({ kind: 'verse', key: u.id, data: cur });
  }
  for (const u of diff.unchanged) if (u.orderChanged) items.push({ kind: 'verse', key: u.id, data: { ...verse(u.id), ord: u.ord } });
  if (mode === 'replace') for (const m of diff.missing) items.push({ kind: 'verse', key: m.id, del: true });
  await db.putMany(items);
  await saveFiles({ ...files(), verses: { name, at: Date.now(), mode, added: diff.add.length, updated: diff.update.length, removed: mode === 'replace' ? diff.missing.length : 0 } });
  await ensureWeekMem(Math.min(pos().week, 12));
}
export async function applyLieImport(diff, { mode, name }) {
  await db.makeBackup('Before Lie-to-Truth import', { kinds: ['lie'], what: 'lies', fileName: name, prevMeta: files().lies || null });
  const items = [];
  for (const a of diff.add) items.push({ kind: 'lie', key: a.lie.key, data: a.lie });
  for (const u of diff.update) items.push({ kind: 'lie', key: u.key, data: u.lie });
  for (const u of diff.unchanged) { const cur = lie(u.key); if (cur && cur.ord !== u.ord) items.push({ kind: 'lie', key: u.key, data: { ...cur, ord: u.ord } }); }
  if (mode === 'replace') for (const m of diff.missing) items.push({ kind: 'lie', key: m.key, del: true });
  await db.putMany(items);
  await saveFiles({ ...files(), lies: { name, at: Date.now(), mode, added: diff.add.length, updated: diff.update.length, removed: mode === 'replace' ? diff.missing.length : 0 } });
}
export async function lastUndoable() {
  const l = await db.listBackups();
  return [...l].reverse().find((b) => b.kinds) || null;
}
export async function undoLastImport() {
  const snap = await lastUndoable();
  if (!snap) return null;
  await db.restoreKinds(snap, snap.kinds);
  if (snap.what === 'verses' || snap.what === 'lies') await saveFiles({ ...files(), [snap.what]: snap.prevMeta || undefined });
  await db.deleteBackup(snap.n);
  return snap;
}
export async function saveVerse(v) { return db.put('verse', v.id, v); }

/* ---------- export ---------- */
export function versesCSV() {
  return L.toCSV([L.VERSE_COLS, ...verses().map((v) => [v.id, v.reference, v.handle, v.ring, v.group, v.starred ? 'true' : 'false', v.text, v.week ?? '', v.theme])]);
}
export function liesCSV() {
  return L.toCSV([['thought', 'truth_to_say', 'verse_references'], ...lies().map((l) => [l.thought, l.truth, l.refs.join('; ')])]);
}
export function progressCSV() {
  const rows = [['id', 'reference', 'read_count', 'in_queue', 'memorized', 'stage', 'step_days', 'next_due', 'reviews', 'lapses', 'note']];
  for (const v of verses()) {
    const m = db.get('mem', v.id);
    rows.push([v.id, v.reference, db.get('read', v.id)?.n || 0, m && !m.archived ? 'yes' : '', m && m.memorized ? 'yes' : '', m ? L.STAGES[m.stage] : '', m ? L.STEPS[m.step] : '', m ? m.due : '', m ? m.reps : '', m ? m.lapses : '', note(v.id)]);
  }
  return L.toCSV(rows);
}
export function fullJSON() {
  return JSON.stringify({
    app: 'scripture-app', version: 1, exported: new Date().toISOString(),
    records: db.allRaw().filter((r) => db.SYNC_KINDS.includes(r.kind)).map(({ kind, key, data, u, d }) => ({ kind, key, data, u, d })),
  });
}
export const templateVersesCSV = () => L.toCSV([
  L.VERSE_COLS,
  ['001', 'Eph 1:3', 'Blessed with every spiritual blessing, already, in Christ.', 'Ephesians', 'Who you are in Christ', 'true', '', '1', 'worth; belonging'],
  ['002', 'Eph 1:4', 'Chosen before the world began.', 'Ephesians', 'Who you are in Christ', 'false', '', '1', ''],
]);
export const templateLiesCSV = () => L.toCSV([
  ['thought', 'truth_to_say', 'verse_references'],
  ['"I have to earn God\'s approval."', 'I am accepted by grace, not performance.', 'Eph 2:8-9; Eph 2:10'],
]);
