// Pure logic: no DOM, no storage. Used by the app and by the Node tests.

export const STEPS = [1, 3, 7, 14, 30, 60];
export const MEMORIZED_STEP = 3; // the 14-day step
export const STAGES = ['Read aloud', 'First letters', 'Fill blanks (30%)', 'Fill blanks (60%)', 'Reference only'];
export const RINGS = ['Ephesians', 'Ring 1', 'Ring 2', 'Ring 3', 'Ring 4', 'Ring 5'];
export const REVIEW_CAP = 20;

export const PLAN_WEEKS = [
  'Ephesians: who you are and the new self',
  'Ephesians: living with others, households, guarding the mind',
  'Colossians and Philippians',
  'Galatians and Romans 1-8',
  'Romans 12-15 and 1 Corinthians',
  '2 Corinthians and Timothy, Titus, Philemon',
  'Thessalonians and Matthew',
  'Mark, Luke, John, Acts',
  'Hebrews, James, Peter',
  '1-3 John, Jude, Revelation, and Torah and history',
  'Psalms, Proverbs and Ecclesiastes',
  'The prophets and a review week',
];

export const SEED_MEMORIZE = [
  ['Eph 1:3', 'Eph 2:8-9', 'Eph 2:10'],
  ['Eph 4:22-24', 'Eph 4:32', 'Eph 6:10-11'],
  ['Col 3:12-13', 'Phil 4:6-7', 'Phil 4:8'],
  ['Gal 2:20', 'Rom 8:1', 'Rom 8:35-39'],
  ['Rom 12:1-2', 'Rom 12:10', '1 Cor 13:4-7'],
  ['2 Cor 5:17', '2 Cor 10:5', '2 Tim 1:7'],
  ['1 Thess 5:16-18', 'Matt 11:28-30', 'Matt 22:37-40'],
  ['John 15:4-5', 'John 13:34-35', 'John 15:15'],
  ['Heb 4:15-16', 'James 1:19-20', '1 Pet 5:5-7'],
  ['1 John 3:1', '1 John 4:18-19', 'Deut 31:6'],
  ['Ps 139:13-16', 'Prov 3:5-6', 'Prov 4:23'],
  ['Isa 41:10', 'Jer 31:3', 'Zeph 3:17'],
];

/* ---------- dates (all local-time, 'YYYY-MM-DD') ---------- */
const pad = (n) => String(n).padStart(2, '0');
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function addDays(s, n) {
  const t = new Date(toUTC(s) + n * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function dayDiff(a, b) {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}
/** Monday of the week containing s. */
export function weekKey(s) {
  const dow = (new Date(toUTC(s)).getUTCDay() + 6) % 7; // Mon=0
  return addDays(s, -dow);
}

/* ---------- CSV ---------- */
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}
export function toCSV(rows) {
  const esc = (v) => {
    v = v == null ? '' : String(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/* ---------- references ---------- */
export function normRef(s) {
  return String(s || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').replace(/\s*-\s*/g, '-').replace(/\s*:\s*/g, ':').trim().toLowerCase();
}
export function parseRef(ref) {
  const m = normRef(ref).match(/^(.+?) (\d+):(\d+)(?:-(?:(\d+):)?(\d+))?$/);
  if (!m) return null;
  const ch1 = +m[2], v1 = +m[3];
  const ch2 = m[4] ? +m[4] : ch1;
  const v2 = m[5] ? +m[5] : v1;
  return { book: m[1], a: ch1 * 1000 + v1, b: ch2 * 1000 + v2 };
}
function overlaps(x, y) {
  return x && y && x.book === y.book && x.a <= y.b && y.a <= x.b;
}
/**
 * Memorize passages for the plan are written as ranges (e.g. "Eph 4:22-24") but the
 * verse table may hold them as separate rows. Exact match first, otherwise every row
 * that overlaps the range, in table order.
 */
export function resolvePassage(label, verses) {
  const n = normRef(label);
  const exact = verses.find((v) => normRef(v.reference) === n);
  if (exact) return { label, ids: [exact.id] };
  const pr = parseRef(label);
  const ids = pr ? verses.filter((v) => overlaps(pr, parseRef(v.reference))).map((v) => v.id) : [];
  return { label, ids };
}

/* ---------- verse CSV import ---------- */
export const VERSE_COLS = ['id', 'reference', 'handle', 'ring', 'group', 'starred', 'text', 'week', 'theme'];
export const CONTENT_FIELDS = ['reference', 'handle', 'ring', 'group', 'starred', 'text', 'week', 'theme'];

function parseBool(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['true', 'yes', 'y', '1', 'x', '*'].includes(s)) return true;
  if (['false', 'no', 'n', '0', ''].includes(s)) return false;
  return null;
}

export function parseVersesCSV(text) {
  const out = { rows: [], errors: [], warnings: [], cols: [] };
  const table = parseCSV(text);
  if (!table.length) { out.errors.push({ line: 0, msg: 'The file is empty.' }); return out; }
  const header = table[0].map((h) => h.trim().toLowerCase());
  out.cols = header.filter((h) => VERSE_COLS.includes(h));
  const unknown = header.filter((h) => h && !VERSE_COLS.includes(h));
  if (unknown.length) out.warnings.push({ line: 1, msg: `Ignoring unknown column(s): ${unknown.join(', ')}` });
  if (!header.includes('reference')) {
    out.errors.push({ line: 1, msg: 'Missing required column "reference".' });
    return out;
  }
  const missingCols = VERSE_COLS.filter((c) => !header.includes(c));
  if (missingCols.length) out.warnings.push({ line: 1, msg: `Missing column(s) ${missingCols.join(', ')}: those fields will be left unchanged.` });
  const seenId = new Map(), seenRef = new Map();
  for (let i = 1; i < table.length; i++) {
    const line = i + 1;
    const cells = table[i];
    const rec = {};
    header.forEach((h, k) => { if (VERSE_COLS.includes(h)) rec[h] = (cells[k] ?? '').trim(); });
    const err = (msg) => out.errors.push({ line, msg });
    if (!rec.reference) { err('Missing reference.'); continue; }
    const row = { line, ord: i };
    let bad = false;
    for (const c of out.cols) {
      let v = rec[c];
      if (c === 'starred') {
        const b = parseBool(v);
        if (b === null) { err(`starred must be true or false (got "${v}").`); bad = true; break; }
        v = b;
      } else if (c === 'week') {
        if (v === '') v = null;
        else if (!/^\d+$/.test(v) || +v < 1 || +v > 12) { err(`week must be 1-12 (got "${v}").`); bad = true; break; }
        else v = +v;
      } else if (c === 'ring' && v && !RINGS.includes(v)) {
        out.warnings.push({ line, msg: `Unfamiliar ring "${v}".` });
      }
      row[c] = v;
    }
    if (bad) continue;
    if (row.id) {
      if (seenId.has(row.id)) { err(`Duplicate id ${row.id} (also on line ${seenId.get(row.id)}).`); continue; }
      seenId.set(row.id, line);
    }
    const nr = normRef(row.reference);
    if (seenRef.has(nr)) { err(`Duplicate reference "${row.reference}" (also on line ${seenRef.get(nr)}).`); continue; }
    seenRef.set(nr, line);
    out.rows.push(row);
  }
  return out;
}

export function nextId(existingIds) {
  let max = 0;
  for (const id of existingIds) if (/^\d+$/.test(id)) max = Math.max(max, +id);
  return String(max + 1).padStart(3, '0');
}

/**
 * Compare parsed CSV rows with the live verses.
 * Matches by id first, then by reference. The EXISTING id is always kept, because all
 * progress is stored by verse id.
 */
export function diffVerses(existing, parsed, opts = {}) {
  const keepText = opts.keepTextIfEmpty !== false;
  const byId = new Map(existing.map((v) => [v.id, v]));
  const byRef = new Map(existing.map((v) => [normRef(v.reference), v]));
  const res = { add: [], update: [], unchanged: [], missing: [], errors: [...parsed.errors], warnings: [...parsed.warnings], textKept: 0, textChanged: 0 };
  const taken = new Map();
  const usedIds = new Set(existing.map((v) => v.id));
  let counter = nextId(usedIds);
  for (const row of parsed.rows) {
    const m = (row.id && byId.get(row.id)) || byRef.get(normRef(row.reference));
    if (m) {
      if (taken.has(m.id)) {
        res.errors.push({ line: row.line, msg: `Matches the same verse as line ${taken.get(m.id)} (${m.reference}).` });
        continue;
      }
      taken.set(m.id, row.line);
      const changes = {};
      for (const c of parsed.cols) {
        if (c === 'id') continue;
        let nv = row[c];
        if (c === 'text' && keepText && nv === '' && (m.text || '') !== '') { res.textKept++; continue; }
        const ov = m[c] ?? (c === 'starred' ? false : c === 'week' ? null : '');
        if (nv !== ov) {
          changes[c] = { from: ov, to: nv };
          if (c === 'text') res.textChanged++;
        }
      }
      const orderChanged = m.ord !== row.ord;
      if (Object.keys(changes).length) res.update.push({ id: m.id, line: row.line, reference: m.reference, changes, ord: row.ord });
      else res.unchanged.push({ id: m.id, ord: row.ord, orderChanged });
    } else {
      let id = row.id;
      if (!id) { id = counter; counter = String(+counter + 1).padStart(3, '0'); }
      usedIds.add(id);
      const v = { id, ord: row.ord };
      for (const c of CONTENT_FIELDS) v[c] = c in row ? row[c] : c === 'starred' ? false : c === 'week' ? null : '';
      res.add.push({ line: row.line, verse: v });
    }
  }
  res.missing = existing.filter((v) => !taken.has(v.id));
  return res;
}

/* ---------- Lie-to-Truth CSV ---------- */
export function lieKey(thought) {
  return String(thought || '').replace(/[“”"]/g, '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
}
export function splitRefs(s) {
  return String(s || '').split(';').map((x) => x.trim()).filter(Boolean);
}
export function parseLiesCSV(text) {
  const out = { rows: [], errors: [], warnings: [] };
  const table = parseCSV(text);
  if (!table.length) { out.errors.push({ line: 0, msg: 'The file is empty.' }); return out; }
  const header = table[0].map((h) => h.trim().toLowerCase());
  for (const need of ['thought', 'truth_to_say', 'verse_references']) {
    if (!header.includes(need)) out.errors.push({ line: 1, msg: `Missing required column "${need}".` });
  }
  if (out.errors.length) return out;
  const ix = (n) => header.indexOf(n);
  const seen = new Map();
  for (let i = 1; i < table.length; i++) {
    const line = i + 1, c = table[i];
    const thought = (c[ix('thought')] || '').trim();
    if (!thought) { out.errors.push({ line, msg: 'Missing thought.' }); continue; }
    const key = lieKey(thought);
    if (seen.has(key)) { out.errors.push({ line, msg: `Duplicate thought (also on line ${seen.get(key)}).` }); continue; }
    seen.set(key, line);
    const truth = (c[ix('truth_to_say')] || '').trim();
    if (!truth) out.warnings.push({ line, msg: 'No truth_to_say.' });
    out.rows.push({ line, ord: i, key, thought, truth, refs: splitRefs(c[ix('verse_references')]) });
  }
  return out;
}
export function diffLies(existing, parsed, verses) {
  const byKey = new Map(existing.map((l) => [l.key, l]));
  const res = { add: [], update: [], unchanged: [], missing: [], errors: [...parsed.errors], warnings: [...parsed.warnings] };
  const seen = new Set();
  for (const r of parsed.rows) {
    seen.add(r.key);
    const m = byKey.get(r.key);
    const rec = { key: r.key, thought: r.thought, truth: r.truth, refs: r.refs, ord: r.ord };
    if (!m) res.add.push({ line: r.line, lie: rec });
    else {
      const changes = {};
      if (m.truth !== r.truth) changes.truth = { from: m.truth, to: r.truth };
      if (m.refs.join(';') !== r.refs.join(';')) changes.refs = { from: m.refs.join('; '), to: r.refs.join('; ') };
      if (m.thought !== r.thought) changes.thought = { from: m.thought, to: r.thought };
      if (Object.keys(changes).length) res.update.push({ key: m.key, line: r.line, thought: r.thought, changes, lie: rec });
      else res.unchanged.push({ key: m.key, ord: r.ord });
    }
    if (verses) {
      const refs = new Set(verses.map((v) => normRef(v.reference)));
      for (const ref of r.refs) if (!refs.has(normRef(ref))) res.warnings.push({ line: r.line, msg: `Reference "${ref}" is not in the verse table.` });
    }
  }
  res.missing = existing.filter((l) => !seen.has(l.key));
  return res;
}

/* ---------- reading plan ---------- */
export function sliceFor(entries, days, day) {
  const n = entries.length;
  const a = Math.floor((day * n) / days), b = Math.floor(((day + 1) * n) / days);
  return entries.slice(a, b);
}
export function advancePos(pos, days) {
  let { week, day } = pos;
  day++;
  let weekDone = false;
  if (day >= days) { day = 0; week++; weekDone = true; }
  return { week: Math.min(week, 13), day, weekDone };
}
export const PLAN_DONE_WEEK = 13;

/* ---------- spaced repetition ---------- */
export function newMem(today, extra = {}) {
  return { stage: 0, step: 0, due: today, added: today, memorized: false, reps: 0, lapses: 0, last: null, ...extra };
}
export function applyGrade(st, grade, today) {
  const s = { ...st };
  s.reps = (s.reps || 0) + 1;
  s.last = today;
  const firstWeek = dayDiff(s.added || today, today) < 7;
  if (grade === 'missed') {
    s.step = 0; s.stage = Math.max(0, s.stage - 1); s.lapses = (s.lapses || 0) + 1; s.memorized = false;
    s.due = addDays(today, 1);
  } else if (grade === 'hard') {
    s.due = addDays(today, firstWeek ? 1 : STEPS[s.step]);
  } else {
    const inc = grade === 'easy' ? 2 : 1;
    s.stage = Math.min(STAGES.length - 1, s.stage + inc);
    if (!firstWeek) {
      s.step = Math.min(STEPS.length - 1, s.step + inc);
      if (s.step >= MEMORIZED_STEP) s.memorized = true;
    }
    s.due = addDays(today, firstWeek ? 1 : STEPS[s.step]);
  }
  return s;
}
/** entries: [{key, mem}] -> due today or overdue, oldest first, capped. */
export function dueList(entries, today, cap = REVIEW_CAP, exclude = new Set()) {
  return entries
    .filter((e) => e.mem && e.mem.due <= today && !exclude.has(e.key))
    .sort((a, b) => (a.mem.due < b.mem.due ? -1 : a.mem.due > b.mem.due ? 1 : (a.mem.added || '').localeCompare(b.mem.added || '')))
    .slice(0, cap);
}

/* ---------- drill hints ---------- */
const TOK = /^([^\p{L}\p{N}]*)([\p{L}\p{N}][\s\S]*?)?([^\p{L}\p{N}]*)$/u;
function tokens(text) {
  return String(text).replace(/([—–])/g, ' $1 ').split(/\s+/).filter(Boolean);
}
export function firstLetters(text) {
  return tokens(text).map((t) => {
    const m = t.match(TOK);
    return m && m[2] ? m[1] + m[2][0] + m[3] : t;
  }).join(' ');
}
function seeded(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
export function blanks(text, pct, seed = '') {
  const toks = tokens(text).map((t) => {
    const m = t.match(TOK);
    return { t, lead: m ? m[1] : '', core: m && m[2] ? m[2] : '', trail: m ? m[3] : '' };
  });
  const cand = toks.map((x, i) => (x.core ? i : -1)).filter((i) => i >= 0);
  const rnd = seeded(String(seed));
  for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
  const hide = new Set(cand.slice(0, Math.round(cand.length * pct)));
  return toks.map((x, i) => (hide.has(i) ? x.lead + '_'.repeat(Math.max(2, x.core.length)) + x.trail : x.t)).join(' ');
}
export function hintFor(stage, text, seed) {
  if (stage <= 0) return text;
  if (stage === 1) return firstLetters(text);
  if (stage === 2) return blanks(text, 0.3, seed);
  if (stage === 3) return blanks(text, 0.6, seed);
  return '';
}

/* ---------- streak ---------- */
/**
 * reads: { 'YYYY-MM-DD': number of Read days completed that date }
 * A day counts if reads >= 1. One missed day per calendar week is bridged when the
 * next day has reads >= 2 (the day itself plus a make-up day).
 */
export function computeStreak(reads, today) {
  const R = (d) => reads[d] || 0;
  let streak = 0, pending = false, bridged = 0;
  const used = new Set();
  let d = today, next;
  if (R(today) >= 1) next = R(today);
  else { d = addDays(today, -1); next = Infinity; }
  for (;;) {
    if (R(d) >= 1) { streak++; next = R(d); d = addDays(d, -1); continue; }
    const wk = weekKey(d);
    if (R(addDays(d, -1)) >= 1 && next >= 2 && !used.has(wk)) {
      if (next === Infinity) pending = true;
      used.add(wk); bridged++;
      d = addDays(d, -1);
      continue;
    }
    break;
  }
  return { streak, pending, bridged };
}
export function bestStreak(reads) {
  let best = 0;
  for (const d of Object.keys(reads)) if (reads[d] >= 1) best = Math.max(best, computeStreak(reads, d).streak);
  return best;
}
