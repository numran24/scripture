import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVerseCSV, planVerseImport, applyVerseImport, parseLieCSV, planLieImport, applyLieImport } from '../js/importer.js';
import { getPlan, ensureDaily, tickRead, tickMakeup, ensureWeekUnits, todayUnits, gradeUnit, buildCards, setPace, jumpToWeek,
  sliceVerses, streakNow, stats, weeksCompleted, makeupSlice } from '../js/domain.js';
import { addDays } from '../js/util.js';
import { newRepo, read } from './helpers.js';

async function seeded() {
  const repo = await newRepo();
  applyVerseImport(repo, planVerseImport([], parseVerseCSV(read('verses_TEMP_KJV.csv'))), { fileName: 'v.csv' });
  applyLieImport(repo, planLieImport([], parseLieCSV(read('lie_to_truth_TEMP_KJV.csv')), repo.verses()), { fileName: 'l.csv' });
  return repo;
}

test('plan advances only when Read is ticked; untick reverts; week rolls over', async () => {
  const repo = await seeded();
  const d0 = '2026-11-02';
  let d = ensureDaily(repo, d0);
  assert.deepEqual(d.slice, { week: 1, day: 0 });
  const first = sliceVerses(repo, getPlan(repo), d.slice);
  assert.ok(first.length >= 7 && first.length <= 8);
  // not ticking = no advance, even days later
  assert.deepEqual(ensureDaily(repo, addDays(d0, 3)).slice, { week: 1, day: 0 });
  tickRead(repo, d0, false);
  tickRead(repo, addDays(d0, 3), true);
  assert.deepEqual({ w: getPlan(repo).week, d: getPlan(repo).day }, { w: 1, d: 1 });
  assert.equal(repo.getProgress(first[0].id).read, addDays(d0, 3));
  tickRead(repo, addDays(d0, 3), false);
  assert.equal(getPlan(repo).day, 0);
  assert.equal(repo.getProgress(first[0].id).read, null);
  // finish week 1 at a 5-day pace
  setPace(repo, 1, 5);
  for (let i = 0; i < 5; i++) tickRead(repo, addDays(d0, 10 + i), true);
  assert.deepEqual({ w: getPlan(repo).week, d: getPlan(repo).day }, { w: 2, d: 0 });
  assert.equal(weeksCompleted(getPlan(repo)), 1);
  const s = stats(repo);
  assert.equal(s.byWeek[1].read, s.byWeek[1].total, 'every week-1 entry marked read');
});

test('make-up day keeps the streak and reads one extra slice', async () => {
  const repo = await seeded();
  tickRead(repo, '2026-11-02', true);
  tickRead(repo, '2026-11-03', true);
  // 2026-11-04 missed; on 11-05 read and make up
  tickRead(repo, '2026-11-05', true);
  assert.equal(streakNow(repo, '2026-11-05').current, 1);
  assert.equal(streakNow(repo, '2026-11-05').makeupOffer, true);
  const before = getPlan(repo).day;
  assert.ok(makeupSlice(repo, '2026-11-05').length > 0);
  tickMakeup(repo, '2026-11-05', true);
  assert.equal(getPlan(repo).day, before + 1);
  assert.equal(streakNow(repo, '2026-11-05').current, 3);
  tickMakeup(repo, '2026-11-05', false);
  assert.equal(getPlan(repo).day, before);
  assert.equal(streakNow(repo, '2026-11-05').current, 1);
});

test('memorize: 3 assigned per week (multi-verse targets combined), reviewed daily in week one', async () => {
  const repo = await seeded();
  const d0 = '2026-11-02';
  jumpToWeek(repo, 2);
  ensureWeekUnits(repo, d0);
  let t = todayUnits(repo, d0);
  assert.equal(t.memorize.length, 3);
  const labels = t.memorize.map((u) => u.label);
  assert.deepEqual(labels, ['Eph 4:22-24', 'Eph 4:32', 'Eph 6:10-11']);
  assert.equal(t.memorize[0].verses.length, 3);
  assert.ok(t.memorize[0].text.includes('put off concerning the former conversation'));
  assert.equal(t.review.length, 0);

  // grade through week one: card front alternates reference/thought where a thought exists
  const fronts = [];
  for (let i = 0; i < 4; i++) {
    const day = addDays(d0, i);
    const units = todayUnits(repo, day).memorize;
    const cards = buildCards(repo, units);
    fronts.push(cards.find((c) => c.unit.label === 'Eph 4:32').front);
    for (const u of units) gradeUnit(repo, u, 'good', day);
  }
  assert.deepEqual(fronts, ['reference', 'thought', 'reference', 'thought']);
  const u = todayUnits(repo, addDays(d0, 4)).memorize[0];
  assert.equal(u.p.stage, 4);

  // next week: last week's verses now live in Review once due; new week's three are in Memorize
  jumpToWeek(repo, 3);
  const d8 = addDays(d0, 8);
  ensureWeekUnits(repo, d8);
  t = todayUnits(repo, d8);
  assert.deepEqual(t.memorize.map((x) => x.label), ['Col 3:12-13', 'Phil 4:6-7', 'Phil 4:8']);
  assert.equal(t.review.length, 3);
  assert.ok(t.review[0].p.due <= d8);
});

test('review is capped at 20 and oldest first', async () => {
  const repo = await seeded();
  const today = '2026-12-01';
  repo.verses().slice(100, 130).forEach((v, i) => {
    const p = repo.getProgress(v.id);
    Object.assign(p, { queued: true, learnStart: '2026-01-01', due: addDays('2026-11-01', i), step: 2 });
    repo.saveProgress(p);
  });
  const t = todayUnits(repo, today);
  assert.equal(t.review.length, 20);
  assert.equal(t.reviewTotalDue, 30);
  assert.equal(t.review[0].p.due, '2026-11-01');
});

test('verse with no text is flagged and cannot be drilled', async () => {
  const repo = await seeded();
  const v = repo.verse('016');
  repo.saveVerse({ ...v, text: '' });
  const p = repo.getProgress('016'); Object.assign(p, { queued: true, learnStart: '2026-01-01', due: '2026-01-02' }); repo.saveProgress(p);
  const t = todayUnits(repo, '2026-02-01');
  assert.equal(t.needText.length, 1);
  assert.equal(t.review.length, 0);
  assert.equal(buildCards(repo, t.needText).length, 0);
});
