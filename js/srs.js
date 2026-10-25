// Simple spaced repetition + hint stages for the Drill.
import { addDays, diffDays, hashStr, mulberry32 } from './util.js';

export const STEPS = [1, 3, 7, 14, 30, 60];
export const GRADES = ['missed', 'hard', 'good', 'easy'];
export const GRADE_LABELS = { missed: 'Missed', hard: 'Hard', good: 'Good', easy: 'Easy' };
export const LEARN_DAYS = 7;
export const MAX_REVIEW = 20;

// stage index 0..4 -> what is shown
export const STAGES = [
  { n: 1, name: 'Read aloud', note: 'Full text visible' },
  { n: 2, name: 'First letters', note: 'Each word reduced to its first letter' },
  { n: 3, name: 'Fill in the blanks', note: 'About 30% of words hidden', ratio: 0.3 },
  { n: 3, name: 'Fill in the blanks', note: 'About 60% of words hidden', ratio: 0.6 },
  { n: 4, name: 'Reference only', note: 'Recall everything' },
];
export const stageLabel = (i) => {
  const s = STAGES[Math.max(0, Math.min(4, i || 0))];
  return `Stage ${s.n} of 4 · ${s.name}${s.ratio ? ` (${Math.round(s.ratio * 100)}%)` : ''}`;
};

export function defaultProgress(id) {
  return { id, read: null, queued: false, target: null, learnStart: null, stage: 0, step: 0, due: null,
    lastGrade: null, lastReviewed: null, memorized: false, cards: 0, lapses: 0, note: '' };
}

export const isLearning = (p, today) => !!p.learnStart && diffDays(p.learnStart, today) < LEARN_DAYS;

/**
 * Apply a self-grade. Returns a new progress object.
 *  Missed -> back to the 1-day step, one stage back.
 *  Hard   -> same step, same stage.
 *  Good   -> next step, next stage.      Easy -> skips one step, two stages.
 * During a verse's first 7 days it is reviewed daily, so the step is held and only the stage moves.
 * Grading a verse that is not yet due (extra practice) moves the stage but not the schedule.
 * "Memorized" is set when a Good/Easy grade lands on the 14-day step or beyond; it is kept once set.
 */
export function applyGrade(p, grade, today) {
  const q = { ...p };
  const learning = isLearning(q, today);
  const isDue = !q.due || q.due <= today;
  let step = q.step ?? 0, stage = q.stage ?? 0;
  if (grade === 'missed') { step = 0; stage = Math.max(0, stage - 1); q.lapses = (q.lapses || 0) + 1; }
  else if (grade === 'good') { stage = Math.min(4, stage + 1); if (isDue && !learning) step = Math.min(5, step + 1); }
  else if (grade === 'easy') { stage = Math.min(4, stage + 2); if (isDue && !learning) step = Math.min(5, step + 2); }

  if (grade === 'missed') q.due = addDays(today, 1);
  else if (isDue) q.due = addDays(today, learning ? 1 : STEPS[step]);

  if ((grade === 'good' || grade === 'easy') && isDue && !learning && STEPS[step] >= 14) q.memorized = true;
  q.step = step; q.stage = stage; q.lastGrade = grade; q.lastReviewed = today; q.cards = (q.cards || 0) + 1;
  return q;
}

export function previewDays(p, grade, today) {
  const q = applyGrade(p, grade, today);
  return q.due ? diffDays(today, q.due) : null;
}

export function dueUnits(units, today, cap = MAX_REVIEW) {
  return units
    .filter((u) => u.p.due && u.p.due <= today)
    .sort((a, b) => (a.p.due < b.p.due ? -1 : a.p.due > b.p.due ? 1 : 0))
    .slice(0, cap);
}

// ---- hint rendering ----
const WORD_RE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su;
const splitWord = (w) => { const m = w.match(WORD_RE); return { lead: m[1], core: m[2], trail: m[3] }; };

/** Returns [{ text, hidden }] for display at a given stage. Deterministic for a given seed. */
export function hintTokens(text, stage, seed = '') {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (stage <= 0) return words.map((w) => ({ text: w, hidden: false }));
  if (stage === 1) {
    return words.map((w) => {
      const { lead, core, trail } = splitWord(w);
      return { text: core ? lead + core[0] + trail : w, hidden: false };
    });
  }
  if (stage >= 4) return [];
  const ratio = STAGES[stage].ratio;
  const eligible = [];
  words.forEach((w, i) => { if (splitWord(w).core) eligible.push(i); });
  const want = eligible.length ? Math.max(1, Math.round(eligible.length * ratio)) : 0;
  const rnd = mulberry32(hashStr(`${seed}|${stage}`));
  const order = eligible.map((i) => [rnd(), i]).sort((a, b) => a[0] - b[0]).slice(0, want).map((x) => x[1]);
  const hide = new Set(order);
  return words.map((w, i) => {
    if (!hide.has(i)) return { text: w, hidden: false };
    const { lead, core, trail } = splitWord(w);
    return { text: lead + '_'.repeat(Math.min(Math.max(core.length, 3), 10)) + trail, hidden: true };
  });
}
