import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVerseCSV, planVerseImport, applyVerseImport, parseLieCSV, planLieImport, applyLieImport, versesToCSV } from '../js/importer.js';
import { queueVerse, gradeUnit, buildUnit, getPlan, ensureDaily, tickRead, ensureWeekUnits, todayUnits, stats } from '../js/domain.js';
import { newRepo, read } from './helpers.js';

const H = 'id,reference,handle,ring,group,starred,text,week,theme\n';
async function seeded() {
  const repo = await newRepo();
  const parsed = parseVerseCSV(read('verses_TEMP_KJV.csv'));
  applyVerseImport(repo, planVerseImport(repo.verses(), parsed), { fileName: 'verses_TEMP_KJV.csv' });
  return repo;
}

test('first import of the real 494-row file: nothing lost, no errors', async () => {
  const repo = await seeded();
  assert.equal(repo.verses().length, 494);
  const parsed = parseVerseCSV(read('verses_TEMP_KJV.csv'));
  assert.equal(parsed.errors.length, 0);
  assert.equal(repo.getKV('meta').verseFile.name, 'verses_TEMP_KJV.csv');
  assert.equal(repo.backupList.length, 1);
});

test('re-importing the same file changes nothing', async () => {
  const repo = await seeded();
  const plan = planVerseImport(repo.verses(), parseVerseCSV(read('verses_TEMP_KJV.csv')));
  assert.deepEqual([plan.counts.added, plan.counts.updated, plan.counts.missing, plan.counts.errors], [0, 0, 0, 0]);
  assert.equal(plan.counts.unchanged, 494);
});

test('update mode: content changes, progress is kept, missing verses untouched', async () => {
  const repo = await seeded();
  const today = '2026-10-25';
  // build up progress on Eph 1:3 (id 001) and Eph 2:8-9 (id 016)
  queueVerse(repo, '001', true, today);
  const u = buildUnit(repo, repo.getProgress('001'));
  gradeUnit(repo, u, 'good', today);
  const p = repo.getProgress('001'); p.note = 'my note'; p.read = today; repo.saveProgress(p);
  const before = repo.getProgress('001');

  const csv = H +
    '001,Eph 1:3,NEW HANDLE,Ephesians,Who you are in Christ,false,New text here.,1,\n' +   // changed by id
    ',Eph 2:8-9,Handle by reference,Ephesians,Who you are in Christ,true,,1,\n' +        // no id: match by reference, blank text
    '9999,Brand 1:1,Added,Ring 1,Test,true,Some text,2,\n';                              // new
  const plan = planVerseImport(repo.verses(), parseVerseCSV(csv), { mode: 'update' });
  assert.equal(plan.counts.added, 1); assert.equal(plan.counts.updated, 2);
  assert.equal(plan.byReference, 1);
  assert.equal(plan.counts.missing, 494 - 2); assert.equal(plan.counts.removed, 0);
  assert.equal(plan.textKept, 1);
  applyVerseImport(repo, plan, { fileName: 'new.csv' });

  assert.equal(repo.verses().length, 495);
  assert.equal(repo.verse('001').handle, 'NEW HANDLE');
  assert.equal(repo.verse('001').starred, false);
  assert.equal(repo.verse('016').handle, 'Handle by reference');
  assert.ok(repo.verse('016').text.startsWith('For by grace'), 'blank text in file keeps the existing text');
  assert.ok(repo.verse('017'), 'verses not in the file are untouched in update mode');
  const after = repo.getProgress('001');
  for (const k of ['read', 'queued', 'stage', 'step', 'due', 'memorized', 'learnStart', 'cards']) assert.deepEqual(after[k], before[k], k);
  assert.equal(after.note, 'my note');
  assert.equal(repo.getKV('meta').verseFile.name, 'new.csv');
});

test('replace mode removes missing verses but keeps their progress, and undo brings everything back', async () => {
  const repo = await seeded();
  const today = '2026-10-25';
  queueVerse(repo, '017', true, today);
  const p = repo.getProgress('017'); p.note = 'keep me'; repo.saveProgress(p);

  const csv = H + '001,Eph 1:3,H,Ephesians,G,true,T,1,\n';
  const plan = planVerseImport(repo.verses(), parseVerseCSV(csv), { mode: 'replace' });
  assert.equal(plan.counts.removed, 493);
  applyVerseImport(repo, plan, { fileName: 'tiny.csv' });
  assert.equal(repo.verses().length, 1);
  assert.equal(repo.getProgress('017').note, 'keep me', 'progress survives removal');

  const undone = repo.undoLastImport();
  assert.match(undone.label, /tiny\.csv/);
  assert.equal(repo.verses().length, 494);
  assert.equal(repo.getKV('meta').verseFile.name, 'verses_TEMP_KJV.csv');
  assert.equal(repo.getProgress('017').note, 'keep me');
  // the removed verse reattaches to its progress after a later import
  assert.equal(buildUnit(repo, repo.getProgress('017')).label, 'Eph 2:10');
});

test('errors are reported with row numbers and bad rows are skipped', () => {
  const csv = H +
    '1,Eph 1:3,h,Ephesians,g,true,t,1,\n' +
    '2,,missing ref,Ephesians,g,true,t,1,\n' +
    '3,Eph 1:4,h,Ephesians,g,maybe,t,1,\n' +
    '4,Eph 1:5,h,Ephesians,g,true,t,13,\n' +
    '1,Eph 1:6,dup id,Ephesians,g,true,t,1,\n' +
    '5,Eph 1:3,dup ref,Ephesians,g,true,t,1,\n' +
    '6,Eph 1:7,h,Nowhere,g,true,t,1,\n';
  const parsed = parseVerseCSV(csv);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.errors.map((e) => e.line), [3, 4, 5, 6, 7]);
  assert.ok(parsed.warnings.some((w) => /Nowhere/.test(w.msg)));
  assert.match(parseVerseCSV('a,b\n1,2').fatal, /reference/);
  assert.match(parseVerseCSV('').fatal, /empty/);
});

test('ids that Excel turned into numbers (1 vs 001) still match by id', async () => {
  const repo = await seeded();
  const plan = planVerseImport(repo.verses(), parseVerseCSV(H + '1,Eph 1:3,X,Ephesians,g,true,t,1,\n'));
  assert.equal(plan.updated[0].id, '001'); assert.equal(plan.byReference, 0);
});

test('verses export and re-import round trips', async () => {
  const repo = await seeded();
  const plan = planVerseImport(repo.verses(), parseVerseCSV(versesToCSV(repo.verses())));
  assert.equal(plan.counts.updated + plan.counts.added + plan.counts.errors, 0);
});

test('Lie-to-Truth: matched by thought text (quotes/case ignored), modes, undo', async () => {
  const repo = await seeded();
  const lie = read('lie_to_truth_TEMP_KJV.csv');
  const parsed = parseLieCSV(lie);
  assert.equal(parsed.rows.length, 19); assert.equal(parsed.errors.length, 0);
  const p1 = planLieImport(repo.lies(), parsed, repo.verses());
  assert.equal(p1.counts.added, 19); assert.equal(p1.warnings.length, 0);
  applyLieImport(repo, p1, { fileName: 'lie.csv' });
  assert.equal(repo.lies().length, 19);

  const edited = 'thought,truth_to_say,verse_references\n' +
    'i have to earn god\'s approval.,New truth,Eph 2:8-9\n' +                  // same thought, different case, no quotes
    '"""A new thought""",Truth,Eph 1:3; Nope 9:9\n';
  const p2 = planLieImport(repo.lies(), parseLieCSV(edited), repo.verses(), { mode: 'update' });
  assert.equal(p2.counts.updated, 1); assert.equal(p2.counts.added, 1); assert.equal(p2.counts.missing, 18); assert.equal(p2.counts.removed, 0);
  assert.ok(p2.warnings.some((w) => /Nope 9:9/.test(w.msg)));
  const p3 = planLieImport(repo.lies(), parseLieCSV(edited), repo.verses(), { mode: 'replace' });
  assert.equal(p3.counts.removed, 18);
  applyLieImport(repo, p3, { fileName: 'edited.csv' });
  assert.equal(repo.lies().length, 2);
  repo.undoLastImport();
  assert.equal(repo.lies().length, 19);
  assert.equal(repo.getKV('meta').lieFile.name, 'lie.csv');
});

test('full JSON backup restores everything, and is itself undoable', async () => {
  const repo = await seeded();
  applyLieImport(repo, planLieImport([], parseLieCSV(read('lie_to_truth_TEMP_KJV.csv')), repo.verses()), { fileName: 'l.csv' });
  queueVerse(repo, '001', true, '2026-10-25');
  const snap = JSON.parse(JSON.stringify(repo.exportAll()));
  queueVerse(repo, '002', true, '2026-10-25');
  repo.removeVerse('003');
  repo.restoreAll(snap);
  assert.equal(repo.verses().length, 494);
  assert.equal(repo.getProgress('002').queued, false);
  assert.equal(repo.getProgress('001').queued, true);
  repo.undoLastImport();
  assert.equal(repo.getProgress('002').queued, true);
  assert.equal(repo.verses().length, 493);
  assert.throws(() => repo.restoreAll({ nope: 1 }), /not a Scripture backup/);
});

test('sync bookkeeping: writes are dirty, remote wins only when newer', async () => {
  const repo = await seeded();
  const d0 = repo.dirtyDocs().length;
  assert.ok(d0 >= 494);
  const docs = repo.dirtyDocs();
  repo.clearDirty(docs);
  assert.equal(repo.dirtyDocs().length, 0);
  const v = repo.verse('001');
  assert.equal(repo.applyRemote('verse', '001', { ...v, handle: 'old' }, false, v.updatedAt - 1), false);
  assert.equal(repo.applyRemote('verse', '001', { ...v, handle: 'remote' }, false, v.updatedAt + 5), true);
  assert.equal(repo.verse('001').handle, 'remote');
  assert.equal(repo.dirtyDocs().length, 0, 'remote writes are not pushed back');
  assert.equal(repo.applyRemote('verse', '001', null, true, v.updatedAt + 9), true);
  assert.equal(repo.verse('001'), null);
});

test('storage adapter round trip: a new Repo loads what the old one wrote', async () => {
  const repo = await seeded();
  queueVerse(repo, '001', true, '2026-10-25');
  await repo.flush();
  const { Repo } = await import('../js/repo.js');
  const again = await new Repo(repo.a).load();
  assert.equal(again.verses().length, 494);
  assert.equal(again.getProgress('001').queued, true);
  assert.equal(again.backupList.length, 1);
  assert.ok(again.dirtyDocs().length > 0);
});
