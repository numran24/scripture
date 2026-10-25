// Plan logic: weekly slices, position stepping, and resolving the weekly memorize targets.
import { naturalCompare, normRef } from './util.js';

export const TOTAL_WEEKS = 12;
export const PACE_OPTIONS = [4, 5, 6, 7];
export const DEFAULT_PACE = 6;

export const WEEK_TITLES = {
  1: 'Ephesians: who you are and the new self',
  2: 'Ephesians: living with others, households, guarding the mind',
  3: 'Colossians and Philippians',
  4: 'Galatians and Romans 1-8',
  5: 'Romans 12-15 and 1 Corinthians',
  6: '2 Corinthians and Timothy, Titus, Philemon',
  7: 'Thessalonians and Matthew',
  8: 'Mark, Luke, John, Acts',
  9: 'Hebrews, James, Peter',
  10: '1-3 John, Jude, Revelation, and Torah and history',
  11: 'Psalms, Proverbs and Ecclesiastes',
  12: 'The prophets and a review week',
};

export const MEMORIZE_SEED = {
  1: ['Eph 1:3', 'Eph 2:8-9', 'Eph 2:10'],
  2: ['Eph 4:22-24', 'Eph 4:32', 'Eph 6:10-11'],
  3: ['Col 3:12-13', 'Phil 4:6-7', 'Phil 4:8'],
  4: ['Gal 2:20', 'Rom 8:1', 'Rom 8:35-39'],
  5: ['Rom 12:1-2', 'Rom 12:10', '1 Cor 13:4-7'],
  6: ['2 Cor 5:17', '2 Cor 10:5', '2 Tim 1:7'],
  7: ['1 Thess 5:16-18', 'Matt 11:28-30', 'Matt 22:37-40'],
  8: ['John 15:4-5', 'John 13:34-35', 'John 15:15'],
  9: ['Heb 4:15-16', 'James 1:19-20', '1 Pet 5:5-7'],
  10: ['1 John 3:1', '1 John 4:18-19', 'Deut 31:6'],
  11: ['Ps 139:13-16', 'Prov 3:5-6', 'Prov 4:23'],
  12: ['Isa 41:10', 'Jer 31:3', 'Zeph 3:17'],
};

export function weekEntries(verses, week) {
  return verses.filter((v) => v.week === week).sort((a, b) => naturalCompare(a.id, b.id));
}

/** Split a week's entries evenly over n days; slice sizes differ by at most one. */
export function daySlice(entries, dayIndex, n) {
  const N = entries.length;
  const a = Math.floor((dayIndex * N) / n);
  const b = Math.floor(((dayIndex + 1) * N) / n);
  return entries.slice(a, b);
}

export function nextPos(pos, n) {
  if (pos.day + 1 < n) return { week: pos.week, day: pos.day + 1 };
  return { week: pos.week + 1, day: 0 };
}

export function parseRef(ref) {
  const m = String(ref || '').replace(/[–—]/g, '-').trim().match(/^(.+?)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const v1 = +m[3];
  return { book: m[1].toLowerCase().replace(/\s+/g, ' '), ch: +m[2], v1, v2: m[4] ? +m[4] : v1 };
}

/**
 * Turn a target like "Eph 4:22-24" into the verse rows that cover it.
 * Exact reference first; then rows wholly inside the range (if they cover it fully);
 * otherwise rows that overlap it (e.g. "2 Cor 10:5" -> the "2 Cor 10:3-5" row).
 */
export function resolveTarget(verses, target) {
  const exact = verses.find((v) => normRef(v.reference) === normRef(target));
  if (exact) return { target, label: exact.reference, ids: [exact.id], how: 'exact' };
  const t = parseRef(target);
  if (!t) return { target, label: target, ids: [], how: 'none' };
  const same = verses.map((v) => ({ v, r: parseRef(v.reference) }))
    .filter((x) => x.r && x.r.book === t.book && x.r.ch === t.ch);
  const inside = same.filter((x) => x.r.v1 >= t.v1 && x.r.v2 <= t.v2);
  const covered = new Set();
  inside.forEach((x) => { for (let i = x.r.v1; i <= x.r.v2; i++) covered.add(i); });
  let full = true;
  for (let i = t.v1; i <= t.v2; i++) if (!covered.has(i)) full = false;
  let how = 'range';
  let pick = inside;
  if (!(inside.length && full)) {
    pick = same.filter((x) => x.r.v1 <= t.v2 && x.r.v2 >= t.v1);
    how = 'overlap';
  }
  pick.sort((a, b) => a.r.v1 - b.r.v1);
  const ids = pick.map((x) => x.v.id);
  return { target, label: ids.length === 1 ? pick[0].v.reference : target, ids, how: ids.length ? how : 'none' };
}
