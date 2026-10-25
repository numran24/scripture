// Streak = consecutive days with the Read part ticked, with one "grace day" per week:
// a single missed day is forgiven if on the next day you also tick the make-up slice.
import { addDays, diffDays, weekKey } from './util.js';

/** reads: { 'YYYY-MM-DD': { makeup: boolean } } */
export function streakInfo(reads, today) {
  const dates = Object.keys(reads).filter((d) => d <= today).sort();
  const graceUsed = new Set();
  const runs = [];
  let count = 0, runStart = null, prev = null, longest = 0;
  for (const d of dates) {
    if (prev === null) { count = 1; runStart = d; }
    else {
      const gap = diffDays(prev, d) - 1;
      const graceWeek = gap === 1 ? weekKey(addDays(prev, 1)) : null;
      if (gap === 0) count++;
      else if (gap === 1 && reads[d].makeup && !graceUsed.has(graceWeek)) { graceUsed.add(graceWeek); count++; }
      else { runs.push({ start: runStart, end: prev, length: count }); count = 1; runStart = d; }
    }
    longest = Math.max(longest, count);
    prev = d;
  }
  if (prev !== null) runs.push({ start: runStart, end: prev, length: count });

  let current = 0, atRisk = false;
  if (prev !== null) {
    const delta = diffDays(prev, today);
    if (delta <= 1) current = count;
    else if (delta === 2 && !graceUsed.has(weekKey(addDays(prev, 1)))) { current = count; atRisk = true; }
  }

  // Is a make-up slice on offer today? Yes if, ignoring today, the last read was exactly two days ago
  // and that missed day's week still has its grace day.
  let makeupOffer = false;
  const before = dates.filter((d) => d < today);
  if (before.length) {
    const last = before[before.length - 1];
    if (diffDays(last, today) === 2) {
      const prior = streakInfoGraceUsed(reads, before);
      makeupOffer = !prior.has(weekKey(addDays(last, 1)));
    }
  }
  return { current, longest, atRisk, makeupOffer, runs, graceUsed };
}

function streakInfoGraceUsed(reads, dates) {
  const used = new Set();
  let prev = null;
  for (const d of dates) {
    if (prev !== null) {
      const gap = diffDays(prev, d) - 1;
      if (gap === 1 && reads[d].makeup) {
        const w = weekKey(addDays(prev, 1));
        if (!used.has(w)) used.add(w);
      }
    }
    prev = d;
  }
  return used;
}
