// CSV import: parse + validate, build a preview (added / updated / missing / errors), then apply.
// Progress is never touched here: it is keyed by verse id, and matched rows keep their existing id.
import { parseCSV, toCSV } from './csv.js';
import { normRef, normKey } from './util.js';
import { TOTAL_WEEKS } from './plan.js';

export const VERSE_COLS = ['id', 'reference', 'handle', 'ring', 'group', 'starred', 'text', 'week', 'theme'];
export const CONTENT_FIELDS = ['reference', 'handle', 'ring', 'group', 'starred', 'text', 'week', 'theme'];
export const RINGS = ['Ephesians', 'Ring 1', 'Ring 2', 'Ring 3', 'Ring 4', 'Ring 5'];
export const LIE_COLS = ['thought', 'truth_to_say', 'verse_references'];

export function parseBool(s) {
  const v = String(s ?? '').trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'x', 't', '★'].includes(v)) return true;
  if (['false', 'no', 'n', '0', 'f', ''].includes(v)) return false;
  return null;
}
const idKey = (id) => (/^\d+$/.test(String(id)) ? String(Number(id)) : String(id));
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function readTable(text) {
  const out = { headers: [], table: [], fatal: null, errors: [], warnings: [] };
  try { out.table = parseCSV(String(text ?? '')); } catch (e) { out.fatal = 'Could not read the file as CSV.'; return out; }
  if (!out.table.length) { out.fatal = 'The file is empty.'; return out; }
  out.headers = out.table[0].map((h) => h.trim().toLowerCase());
  return out;
}

// ---------------------------------------------------------------- verses
export function parseVerseCSV(text) {
  const t = readTable(text);
  const res = { rows: [], errors: t.errors, warnings: t.warnings, fatal: t.fatal, present: {}, total: 0 };
  if (res.fatal) return res;
  const H = t.headers;
  if (!H.includes('reference')) {
    res.fatal = 'Missing the required column "reference". Expected columns: ' + VERSE_COLS.join(', ') + '.';
    return res;
  }
  for (const c of VERSE_COLS) res.present[c] = H.includes(c);
  const missing = VERSE_COLS.filter((c) => !res.present[c]);
  if (missing.length) res.warnings.push({ line: 0, msg: `Column(s) not in file, so existing values stay unchanged: ${missing.join(', ')}.` });
  const unknown = H.filter((h) => h && !VERSE_COLS.includes(h));
  if (unknown.length) res.warnings.push({ line: 0, msg: `Ignoring unknown column(s): ${unknown.join(', ')}.` });

  const seenId = new Map(), seenRef = new Map();
  for (let i = 1; i < t.table.length; i++) {
    const line = i + 1;
    const raw = {};
    H.forEach((h, j) => { raw[h] = t.table[i][j] ?? ''; });
    res.total++;
    const row = { line };
    const err = (msg) => res.errors.push({ line, msg });
    row.id = clean(raw.id);
    row.reference = clean(raw.reference);
    if (!row.reference) { err('Missing reference. Row skipped.'); continue; }
    let bad = false;
    for (const f of ['handle', 'ring', 'group', 'theme']) if (res.present[f]) row[f] = clean(raw[f]);
    if (res.present.text) row.text = clean(raw.text);
    if (res.present.starred) {
      const b = parseBool(raw.starred);
      if (b === null) { err(`starred must be true or false (got "${clean(raw.starred)}"). Row skipped.`); bad = true; } else row.starred = b;
    }
    if (res.present.week) {
      const w = clean(raw.week);
      if (w === '') row.week = null;
      else if (!/^\d+$/.test(w) || +w < 1 || +w > TOTAL_WEEKS) { err(`week must be 1-${TOTAL_WEEKS} (got "${w}"). Row skipped.`); bad = true; } else row.week = +w;
    }
    if (bad) continue;
    if (row.ring && !RINGS.includes(row.ring)) res.warnings.push({ line, msg: `Ring "${row.ring}" is not one of: ${RINGS.join(', ')}. Imported anyway.` });
    if (row.id) {
      const k = idKey(row.id);
      if (seenId.has(k)) { err(`Duplicate id "${row.id}" (first on row ${seenId.get(k)}). Row skipped.`); continue; }
      seenId.set(k, line);
    }
    const rk = normRef(row.reference);
    if (seenRef.has(rk)) { err(`Duplicate reference "${row.reference}" (first on row ${seenRef.get(rk)}). Row skipped.`); continue; }
    seenRef.set(rk, line);
    res.rows.push(row);
  }
  return res;
}

/** Preview of what an import would do. Pure: does not write anything. */
export function planVerseImport(existing, parsed, { mode = 'update', keepTextIfBlank = true } = {}) {
  const byId = new Map(existing.map((v) => [idKey(v.id), v]));
  const byRef = new Map(existing.map((v) => [normRef(v.reference), v]));
  const used = new Set();
  const plan = { mode, added: [], updated: [], unchanged: [], missing: [], removed: [], errors: [...parsed.errors],
    warnings: [...parsed.warnings], byReference: 0, textKept: 0, needsText: 0 };
  const present = parsed.present || {};

  for (const row of parsed.rows) {
    let match = row.id ? byId.get(idKey(row.id)) : null;
    let how = 'id';
    if (!match) { match = byRef.get(normRef(row.reference)); how = 'reference'; }
    if (!match) {
      const nv = { id: row.id || '', reference: row.reference, handle: row.handle ?? '', ring: row.ring ?? '', group: row.group ?? '',
        starred: row.starred ?? false, text: row.text ?? '', week: row.week ?? 0, theme: row.theme ?? '' };
      if (!nv.text) plan.needsText++;
      if (!row.week && present.week !== false) plan.warnings.push({ line: row.line, msg: `${row.reference}: no week, so it is not part of the plan.` });
      plan.added.push({ line: row.line, row: nv });
      continue;
    }
    if (used.has(match.id)) { plan.errors.push({ line: row.line, msg: `"${row.reference}" matches the same verse as an earlier row. Row skipped.` }); continue; }
    const clash = byRef.get(normRef(row.reference));
    if (clash && clash.id !== match.id) { plan.errors.push({ line: row.line, msg: `Reference "${row.reference}" is already used by another verse. Row skipped.` }); continue; }
    used.add(match.id);
    if (how === 'reference') plan.byReference++;
    const after = { ...match };
    const changes = [];
    for (const f of CONTENT_FIELDS) {
      if (!present[f] || row[f] === undefined) continue;
      let nv = row[f];
      if (f === 'week' && nv === null) continue;
      if (f === 'text' && nv === '' && keepTextIfBlank && match.text) { plan.textKept++; continue; }
      if (nv !== match[f]) { changes.push(f); after[f] = nv; }
    }
    if (!after.text) plan.needsText++;
    if (changes.length) plan.updated.push({ id: match.id, line: row.line, before: match, after, changes, how });
    else plan.unchanged.push(match.id);
  }
  plan.missing = existing.filter((v) => !used.has(v.id));
  if (mode === 'replace') plan.removed = plan.missing;
  plan.counts = { rows: parsed.total, added: plan.added.length, updated: plan.updated.length, unchanged: plan.unchanged.length,
    missing: plan.missing.length, removed: plan.removed.length, errors: plan.errors.length, warnings: plan.warnings.length };
  return plan;
}

export function applyVerseImport(repo, plan, { fileName = 'verses.csv' } = {}) {
  const backup = repo.createBackup('verses', `Before importing ${fileName}`, { ...plan.counts, mode: plan.mode });
  for (const { row } of plan.added) repo.saveVerse({ ...row, id: row.id && !repo.verse(row.id) ? row.id : repo.nextVerseId() });
  for (const u of plan.updated) repo.saveVerse(u.after);
  for (const v of plan.removed) repo.removeVerse(v.id);
  const meta = repo.getKV('meta', {});
  meta.verseFile = { name: fileName, loadedAt: repo.clock(), mode: plan.mode, rows: plan.counts.rows,
    added: plan.counts.added, updated: plan.counts.updated, removed: plan.counts.removed, total: repo.verses().length };
  repo.setKV('meta', meta);
  return backup;
}

// ---------------------------------------------------------------- Lie-to-Truth
export function parseLieCSV(text) {
  const t = readTable(text);
  const res = { rows: [], errors: t.errors, warnings: t.warnings, fatal: t.fatal, total: 0 };
  if (res.fatal) return res;
  const H = t.headers;
  const miss = ['thought', 'truth_to_say'].filter((c) => !H.includes(c));
  if (miss.length) { res.fatal = `Missing required column(s): ${miss.join(', ')}. Expected: ${LIE_COLS.join(', ')}.`; return res; }
  if (!H.includes('verse_references')) res.warnings.push({ line: 0, msg: 'Column verse_references not in file; no verses will be linked.' });
  const seen = new Map();
  for (let i = 1; i < t.table.length; i++) {
    const line = i + 1;
    const raw = {};
    H.forEach((h, j) => { raw[h] = t.table[i][j] ?? ''; });
    res.total++;
    const thought = clean(raw.thought);
    if (!thought) { res.errors.push({ line, msg: 'Missing thought. Row skipped.' }); continue; }
    const key = normKey(thought);
    if (seen.has(key)) { res.errors.push({ line, msg: `Duplicate thought (first on row ${seen.get(key)}). Row skipped.` }); continue; }
    seen.set(key, line);
    const truth = clean(raw.truth_to_say);
    if (!truth) res.warnings.push({ line, msg: `"${thought}" has no truth_to_say.` });
    const refs = String(raw.verse_references || '').split(';').map(clean).filter(Boolean);
    res.rows.push({ line, key, thought, truth, refs });
  }
  return res;
}

export function planLieImport(existing, parsed, verses, { mode = 'update' } = {}) {
  const byKey = new Map(existing.map((l) => [l.key, l]));
  const refSet = new Set(verses.map((v) => normRef(v.reference)));
  const plan = { mode, added: [], updated: [], unchanged: [], missing: [], removed: [], errors: [...parsed.errors], warnings: [...parsed.warnings] };
  const used = new Set();
  for (const r of parsed.rows) {
    const unknown = r.refs.filter((x) => !refSet.has(normRef(x)));
    if (unknown.length) plan.warnings.push({ line: r.line, msg: `Not in the verse list yet: ${unknown.join('; ')}.` });
    const cur = byKey.get(r.key);
    const next = { key: r.key, thought: r.thought, truth: r.truth, refs: r.refs };
    if (!cur) { plan.added.push({ line: r.line, row: next }); continue; }
    used.add(r.key);
    const changes = [];
    if (cur.thought !== next.thought) changes.push('thought');
    if (cur.truth !== next.truth) changes.push('truth');
    if (cur.refs.join(';') !== next.refs.join(';')) changes.push('verses');
    if (changes.length) plan.updated.push({ key: r.key, line: r.line, before: cur, after: next, changes });
    else plan.unchanged.push(r.key);
  }
  plan.missing = existing.filter((l) => !used.has(l.key));
  if (mode === 'replace') plan.removed = plan.missing;
  plan.counts = { rows: parsed.total, added: plan.added.length, updated: plan.updated.length, unchanged: plan.unchanged.length,
    missing: plan.missing.length, removed: plan.removed.length, errors: plan.errors.length, warnings: plan.warnings.length };
  return plan;
}

export function applyLieImport(repo, plan, { fileName = 'lie_to_truth.csv' } = {}) {
  const backup = repo.createBackup('lie', `Before importing ${fileName}`, { ...plan.counts, mode: plan.mode });
  for (const { row } of plan.added) repo.saveLie(row);
  for (const u of plan.updated) repo.saveLie(u.after);
  for (const l of plan.removed) repo.removeLie(l.key);
  const meta = repo.getKV('meta', {});
  meta.lieFile = { name: fileName, loadedAt: repo.clock(), mode: plan.mode, rows: plan.counts.rows,
    added: plan.counts.added, updated: plan.counts.updated, removed: plan.counts.removed, total: repo.lies().length };
  repo.setKV('meta', meta);
  return backup;
}

// ---------------------------------------------------------------- templates / export
export const verseTemplateCSV = () => toCSV(VERSE_COLS, [
  { id: '001', reference: 'Eph 1:3', handle: 'Blessed with every spiritual blessing, already, in Christ.', ring: 'Ephesians', group: 'Who you are in Christ', starred: 'true', text: '', week: '1', theme: '' },
  { id: '002', reference: 'Eph 1:4', handle: 'Chosen before the world began.', ring: 'Ephesians', group: 'Who you are in Christ', starred: 'false', text: '', week: '1', theme: '' },
]);
export const lieTemplateCSV = () => toCSV(LIE_COLS, [
  { thought: '"I have to earn God\'s approval."', truth_to_say: 'I am accepted by grace, not performance.', verse_references: 'Eph 2:8-9; Eph 2:10' },
]);
export const versesToCSV = (verses) => toCSV(VERSE_COLS, verses.map((v) => ({ ...v, starred: v.starred ? 'true' : 'false', week: v.week || '' })));
export const liesToCSV = (lies) => toCSV(LIE_COLS, lies.map((l) => ({ thought: l.thought, truth_to_say: l.truth, verse_references: l.refs.join('; ') })));
