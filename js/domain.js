// App logic on top of the repo: plan position, daily checklist, memorize units, drill sessions, stats.
import { addDays, diffDays, normKey, normRef } from './util.js';
import { TOTAL_WEEKS, DEFAULT_PACE, MEMORIZE_SEED, weekEntries, daySlice, nextPos, resolveTarget } from './plan.js';
import { applyGrade, dueUnits, isLearning, MAX_REVIEW } from './srs.js';
import { streakInfo } from './streak.js';

export const DEFAULT_SETTINGS = { theme: 'system', reminder: { enabled: false, time: '20:00' } };

export function getSettings(repo) {
  const s = repo.getKV('settings', {});
  return { ...DEFAULT_SETTINGS, ...s, reminder: { ...DEFAULT_SETTINGS.reminder, ...(s.reminder || {}) } };
}
export const saveSettings = (repo, s) => repo.setKV('settings', s);

export function getPlan(repo) {
  const p = repo.getKV('plan', {});
  return { week: p.week ?? 1, day: p.day ?? 0, pace: p.pace ?? DEFAULT_PACE, splits: p.splits || {}, cycles: p.cycles || 0 };
}
export const savePlan = (repo, p) => repo.setKV('plan', p);
export const splitFor = (plan, week) => plan.splits[week] || plan.pace;
export const planComplete = (plan) => plan.week > TOTAL_WEEKS;
export const weeksCompleted = (plan) => Math.min(TOTAL_WEEKS, plan.week - 1);

export function setPace(repo, week, n) {
  const plan = getPlan(repo);
  plan.splits[week] = n;
  if (plan.week === week) plan.day = Math.min(plan.day, n - 1);
  savePlan(repo, plan);
}
export function setDefaultPace(repo, n) {
  const plan = getPlan(repo);
  plan.pace = n;
  if (!plan.splits[plan.week]) plan.day = Math.min(plan.day, n - 1);
  savePlan(repo, plan);
}
export function jumpToWeek(repo, week) {
  const plan = getPlan(repo);
  plan.week = week; plan.day = 0;
  savePlan(repo, plan);
}
export function restartPlan(repo) {
  const plan = getPlan(repo);
  plan.week = 1; plan.day = 0; plan.cycles += 1;
  savePlan(repo, plan);
}

export function sliceVerses(repo, plan, pos) {
  if (pos.week > TOTAL_WEEKS) return [];
  return daySlice(weekEntries(repo.verses(), pos.week), pos.day, splitFor(plan, pos.week));
}

// ------------------------------------------------------------------ streak reads
export function readsOf(repo) {
  const out = {};
  for (const { key, value } of repo.kvList('read:')) out[key.slice(5)] = value;
  return out;
}
export const streakNow = (repo, today) => streakInfo(readsOf(repo), today);

// ------------------------------------------------------------------ daily checklist
const samePos = (a, b) => a.week === b.week && a.day === b.day;
const freshDaily = (date, plan) => ({ date, slice: { week: plan.week, day: plan.day }, readDone: false, readIds: [], newlyRead: [],
  memDone: false, reviewDone: false, makeupDone: false, makeIds: [], newlyMake: [], meditate: { id: null, note: '', skip: 0 } });

export function ensureDaily(repo, today) {
  const plan = getPlan(repo);
  let d = repo.getKV('daily');
  if (!d || d.date !== today) {
    d = freshDaily(today, plan);
    repo.setKV('daily', d);
  } else if (!d.readDone && !samePos(d.slice, plan)) {
    d.slice = { week: plan.week, day: plan.day };
    repo.setKV('daily', d);
  }
  return d;
}
export const saveDaily = (repo, d) => repo.setKV('daily', d);

function markRead(repo, ids, today) {
  const newly = [];
  for (const id of ids) {
    const p = repo.getProgress(id);
    if (!p.read) { p.read = today; repo.saveProgress(p); newly.push(id); }
  }
  return newly;
}
function unmarkRead(repo, ids) {
  for (const id of ids) { const p = repo.getProgress(id); p.read = null; repo.saveProgress(p); }
}
function advance(repo, plan, from) {
  const next = nextPos(from, splitFor(plan, from.week));
  plan.week = next.week; plan.day = next.day;
  savePlan(repo, plan);
  return next;
}

export function tickRead(repo, today, on) {
  const d = ensureDaily(repo, today);
  const plan = getPlan(repo);
  if (on && !d.readDone) {
    if (planComplete(plan)) return d;
    const pos = { ...d.slice };
    d.readIds = sliceVerses(repo, plan, pos).map((v) => v.id);
    d.newlyRead = markRead(repo, d.readIds, today);
    d.prevPos = pos;
    d.posAfter = samePos(plan, pos) ? advance(repo, plan, pos) : null;
    d.readDone = true;
    repo.setKV('read:' + today, { makeup: false });
  } else if (!on && d.readDone) {
    if (d.makeupDone) tickMakeup(repo, today, false);
    const dd = repo.getKV('daily');
    unmarkRead(repo, dd.newlyRead || []);
    const pl = getPlan(repo);
    if (dd.posAfter && samePos(pl, dd.posAfter)) { pl.week = dd.prevPos.week; pl.day = dd.prevPos.day; savePlan(repo, pl); }
    dd.readDone = false; dd.readIds = []; dd.newlyRead = []; dd.posAfter = null;
    saveDaily(repo, dd);
    repo.delKV('read:' + today);
    return dd;
  }
  saveDaily(repo, d);
  return d;
}

/** The make-up slice is simply the next slice after today's read. */
export function makeupSlice(repo, today) {
  const d = ensureDaily(repo, today);
  const plan = getPlan(repo);
  if (d.makeupDone) return d.makeIds.map((id) => repo.verse(id)).filter(Boolean);
  return planComplete(plan) ? [] : sliceVerses(repo, plan, { week: plan.week, day: plan.day });
}
export function tickMakeup(repo, today, on) {
  const d = ensureDaily(repo, today);
  const plan = getPlan(repo);
  if (on && !d.makeupDone && d.readDone && !planComplete(plan)) {
    const pos = { week: plan.week, day: plan.day };
    d.makeIds = sliceVerses(repo, plan, pos).map((v) => v.id);
    d.newlyMake = markRead(repo, d.makeIds, today);
    d.makePrev = pos;
    d.makeAfter = advance(repo, plan, pos);
    d.makeupDone = true;
    repo.setKV('read:' + today, { makeup: true });
  } else if (!on && d.makeupDone) {
    unmarkRead(repo, d.newlyMake || []);
    const pl = getPlan(repo);
    if (d.makeAfter && samePos(pl, d.makeAfter)) { pl.week = d.makePrev.week; pl.day = d.makePrev.day; savePlan(repo, pl); }
    d.makeupDone = false; d.makeIds = []; d.newlyMake = []; d.makeAfter = null;
    repo.setKV('read:' + today, { makeup: false });
  }
  saveDaily(repo, d);
  return d;
}

// ------------------------------------------------------------------ memorize units
const verseMap = (repo) => new Map(repo.verses().map((v) => [v.id, v]));

export function buildUnit(repo, p, vmap = verseMap(repo)) {
  let ids = null, label = null;
  if (p.target) {
    const r = resolveTarget(repo.verses(), p.target);
    if (r.ids.length) { ids = r.ids; label = r.label; }
  }
  if (!ids) { const v = vmap.get(p.id); if (!v) return null; ids = [v.id]; label = v.reference; }
  const vs = ids.map((id) => vmap.get(id)).filter(Boolean);
  if (!vs.length) return null;
  return { key: p.id, label, ids, verses: vs, p,
    text: vs.map((v) => v.text.trim()).filter(Boolean).join(' '),
    handle: vs.map((v) => v.handle).filter(Boolean).join(' '),
    needsText: vs.some((v) => !v.text.trim()) };
}

/** Create progress records for this week's memorize targets (idempotent). */
export function ensureWeekUnits(repo, today) {
  const plan = getPlan(repo);
  if (planComplete(plan)) return;
  const verses = repo.verses();
  if (!verses.length) return;
  for (const target of MEMORIZE_SEED[plan.week] || []) {
    const r = resolveTarget(verses, target);
    if (!r.ids.length) continue;
    const key = r.ids[0];
    const want = r.ids.length > 1 ? target : null;
    const p = repo.getProgress(key);
    if (p.queued && p.learnStart && p.target === want) continue;
    p.queued = true;
    p.target = want;
    if (!p.learnStart) { p.learnStart = today; p.due = p.due || today; }
    repo.saveProgress(p);
  }
}

export function weekAssigned(repo) {
  const plan = getPlan(repo);
  if (planComplete(plan)) return [];
  const verses = repo.verses();
  const vmap = verseMap(repo);
  const out = [];
  for (const target of MEMORIZE_SEED[plan.week] || []) {
    const r = resolveTarget(verses, target);
    if (!r.ids.length) { out.push({ missing: true, target }); continue; }
    const u = buildUnit(repo, { ...repo.getProgress(r.ids[0]), id: r.ids[0], target: r.ids.length > 1 ? target : null }, vmap);
    if (u) { u.target = target; out.push(u); }
  }
  return out;
}

export function queuedUnits(repo) {
  const vmap = verseMap(repo);
  return repo.allProgress().filter((p) => p.queued).map((p) => buildUnit(repo, p, vmap)).filter(Boolean);
}

/** Today's three lists. Memorize = this week's assigned + queued verses still in their first week. */
export function todayUnits(repo, today) {
  const assigned = weekAssigned(repo).filter((u) => !u.missing);
  const assignedKeys = new Set(assigned.map((u) => u.key));
  const all = queuedUnits(repo);
  const memorize = [...assigned, ...all.filter((u) => !assignedKeys.has(u.key) && isLearning(u.p, today))];
  const memKeys = new Set(memorize.map((u) => u.key));
  const dueAll = all.filter((u) => !memKeys.has(u.key) && !u.needsText && u.p.due && u.p.due <= today);
  const review = dueUnits(dueAll, today, MAX_REVIEW);
  return { memorize, review, reviewTotalDue: dueAll.length, needText: all.filter((u) => u.needsText) };
}

export function queueVerse(repo, id, on, today) {
  const p = repo.getProgress(id);
  if (on) { p.queued = true; if (!p.learnStart) { p.learnStart = today; p.due = today; } }
  else p.queued = false;
  repo.saveProgress(p);
}

export function thoughtsFor(repo, unit) {
  const refs = new Set([...unit.verses.map((v) => normRef(v.reference)), normRef(unit.label)]);
  const tags = unit.verses.flatMap((v) => String(v.theme || '').split(/[;|,]/).map(normKey).filter((t) => t.length >= 4));
  return repo.lies().filter((l) => l.refs.some((r) => refs.has(normRef(r))) || tags.some((t) => t === l.key || l.key.includes(t)));
}

export function buildCards(repo, units) {
  return units.filter((u) => !u.needsText).map((u) => {
    const th = thoughtsFor(repo, u);
    const c = u.p.cards || 0;
    const useThought = th.length > 0 && c % 2 === 1;
    return { unit: u, front: useThought ? 'thought' : 'reference', thought: useThought ? th[Math.floor(c / 2) % th.length] : null, truth: th[0] || null };
  });
}

export function gradeUnit(repo, unit, grade, today) {
  const p = applyGrade(repo.getProgress(unit.key), grade, today);
  repo.saveProgress(p);
  return p;
}

// ------------------------------------------------------------------ Lie-to-Truth
export function lieVerses(repo, lie) {
  const byRef = new Map(repo.verses().map((v) => [normRef(v.reference), v]));
  return lie.refs.map((r) => ({ ref: r, verse: byRef.get(normRef(r)) || null }));
}

// ------------------------------------------------------------------ stats
export function stats(repo) {
  const verses = repo.verses();
  const prog = new Map(repo.allProgress().map((p) => [p.id, p]));
  const byRing = {}, byWeek = {};
  const bump = (m, k) => (m[k] ||= { total: 0, read: 0, starred: 0, memorized: 0 });
  for (const v of verses) {
    const p = prog.get(v.id);
    for (const [m, k] of [[byRing, v.ring || '(none)'], [byWeek, v.week || 0]]) {
      const b = bump(m, k);
      b.total++; if (v.starred) b.starred++; if (p?.read) b.read++;
    }
  }
  const vmap = new Map(verses.map((v) => [v.id, v]));
  let memorized = 0;
  for (const p of prog.values()) {
    if (!p.memorized) continue;
    const v = vmap.get(p.id);
    if (!v) continue;
    memorized++;
    bump(byRing, v.ring || '(none)').memorized++;
    bump(byWeek, v.week || 0).memorized++;
  }
  return { byRing, byWeek, memorized, total: verses.length, read: [...prog.values()].filter((p) => p.read && vmap.has(p.id)).length };
}
export { addDays, diffDays };
