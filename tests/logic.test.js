import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../js/logic.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, '..', p), 'utf8');

test('CSV: quotes, commas, CRLF, BOM round-trip', () => {
  const rows = L.parseCSV('﻿a,b\r\n"x, y","say ""hi"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"']]);
  assert.deepEqual(L.parseCSV(L.toCSV(rows)), rows);
});

test('dates and week keys', () => {
  assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(L.dayDiff('2026-10-24', '2026-10-31'), 7);
  assert.equal(L.weekKey('2026-10-25'), '2026-10-19'); // Sunday -> Monday before
});

test('SRS: Missed resets, Hard repeats, Good advances, Easy skips', () => {
  let s = L.newMem('2026-01-01', { added: '2025-12-01' }); // past first week
  s = L.applyGrade(s, 'good', '2026-01-01');
  assert.equal(s.step, 1); assert.equal(s.due, '2026-01-04');
  s = L.applyGrade(s, 'hard', '2026-01-04');
  assert.equal(s.step, 1); assert.equal(s.due, '2026-01-07');
  s = L.applyGrade(s, 'easy', '2026-01-07');
  assert.equal(s.step, 3); assert.equal(s.due, '2026-01-21'); // 14 day step
  assert.equal(s.memorized, true);
  s = L.applyGrade(s, 'missed', '2026-01-21');
  assert.equal(s.step, 0); assert.equal(s.due, '2026-01-22'); assert.equal(s.memorized, false);
});

test('SRS: memorized only once the 14-day step is reached with Good', () => {
  let s = L.newMem('2026-01-10', { added: '2025-12-01' });
  s = L.applyGrade(s, 'good', '2026-01-10'); assert.equal(s.memorized, false); // 3d
  s = L.applyGrade(s, 'good', '2026-01-13'); assert.equal(s.memorized, false); // 7d
  s = L.applyGrade(s, 'good', '2026-01-20'); assert.equal(s.memorized, true);  // 14d
  s = L.applyGrade(s, 'good', '2026-02-03'); assert.equal(s.step, 4);          // 30d
});

test('SRS: first week stays daily', () => {
  let s = L.newMem('2026-02-01');
  for (let d = 0; d < 7; d++) {
    const day = L.addDays('2026-02-01', d);
    s = L.applyGrade(s, 'good', day);
    assert.equal(s.due, L.addDays(day, 1));
  }
  assert.equal(s.memorized, false);
  assert.equal(s.stage, 4);
});

test('Review list: due or overdue, oldest first, capped at 20', () => {
  const entries = [];
  for (let i = 0; i < 30; i++) entries.push({ key: 'k' + i, mem: { due: L.addDays('2026-03-01', -i), added: '2026-01-01' } });
  entries.push({ key: 'future', mem: { due: '2026-03-02', added: '2026-01-01' } });
  const due = L.dueList(entries, '2026-03-01');
  assert.equal(due.length, 20);
  assert.equal(due[0].key, 'k29');
  assert.ok(!due.find((e) => e.key === 'future'));
  assert.equal(L.dueList(entries, '2026-03-01', 20, new Set(['k29']))[0].key, 'k28');
});

test('Plan slices cover every entry exactly once for any split', () => {
  const entries = Array.from({ length: 47 }, (_, i) => i);
  for (const days of [4, 5, 6, 7]) {
    const all = [];
    for (let d = 0; d < days; d++) all.push(...L.sliceFor(entries, days, d));
    assert.deepEqual(all, entries);
  }
  assert.ok(L.sliceFor(entries, 7, 0).length >= 6);
});

test('Plan advances by day, then week, then finishes', () => {
  let p = { week: 1, day: 0 };
  for (let i = 0; i < 5; i++) p = L.advancePos(p, 6);
  assert.deepEqual(p, { week: 1, day: 5, weekDone: false });
  p = L.advancePos(p, 6);
  assert.deepEqual(p, { week: 2, day: 0, weekDone: true });
  assert.equal(L.advancePos({ week: 12, day: 5 }, 6).week, 13);
});

test('Streak: simple run, today not yet read, and break', () => {
  const r = { '2026-05-01': 1, '2026-05-02': 1, '2026-05-03': 1 };
  assert.equal(L.computeStreak(r, '2026-05-03').streak, 3);
  assert.equal(L.computeStreak(r, '2026-05-04').streak, 3); // today still open
  const held = L.computeStreak(r, '2026-05-05'); // yesterday missed: held, needs a make-up today
  assert.equal(held.streak, 3); assert.equal(held.pending, true);
  assert.equal(L.computeStreak(r, '2026-05-06').streak, 0); // two days missed: broken
});

test('Streak: grace day needs next day + make-up, once per week', () => {
  // Mon 4th read, Tue 5th missed, Wed 6th read twice
  const ok = { '2026-05-04': 1, '2026-05-06': 2 };
  assert.equal(L.computeStreak(ok, '2026-05-06').streak, 2);
  const noMakeup = { '2026-05-04': 1, '2026-05-06': 1 };
  assert.equal(L.computeStreak(noMakeup, '2026-05-06').streak, 1);
  // two misses in the same week: only the first is forgiven
  const two = { '2026-05-04': 1, '2026-05-06': 2, '2026-05-08': 2 };
  assert.equal(L.computeStreak(two, '2026-05-08').streak, 1 + 1 + 1 === 3 ? 2 : 2);
  // different weeks: both forgiven
  const diff = { '2026-05-01': 1, '2026-05-03': 2, '2026-05-05': 2 }; // Fri, Sun | Tue
  assert.equal(L.computeStreak(diff, '2026-05-05').streak, 3);
  // pending: missed yesterday, today not done yet
  const pend = L.computeStreak({ '2026-05-04': 1 }, '2026-05-06');
  assert.equal(pend.pending, true); assert.equal(pend.streak, 1);
});

test('Hints: first letters keep punctuation; blanks hide the right share', () => {
  assert.equal(L.firstLetters('Blessed be the God, and Father:'), 'B b t G, a F:');
  const t = 'one two three four five six seven eight nine ten';
  const b = L.blanks(t, 0.3, 'x');
  assert.equal(b.split(' ').filter((w) => w.includes('_')).length, 3);
  assert.equal(L.blanks(t, 0.6, 'x').split(' ').filter((w) => w.includes('_')).length, 6);
  assert.equal(L.blanks(t, 0.3, 'x'), b); // deterministic
  assert.equal(L.hintFor(4, t, 'x'), '');
});

test('Refs: ranges and overlap resolution', () => {
  const verses = [
    { id: '1', reference: 'Eph 4:22' }, { id: '2', reference: 'Eph 4:23' }, { id: '3', reference: 'Eph 4:24' },
    { id: '4', reference: '2 Cor 10:3-5' }, { id: '5', reference: 'Eph 1:3' },
  ];
  assert.deepEqual(L.resolvePassage('Eph 4:22-24', verses).ids, ['1', '2', '3']);
  assert.deepEqual(L.resolvePassage('2 Cor 10:5', verses).ids, ['4']);
  assert.deepEqual(L.resolvePassage('Eph 1:3', verses).ids, ['5']);
  assert.deepEqual(L.resolvePassage('Nope 1:1', verses).ids, []);
});

test('Verse import: errors, add / update / missing, ids preserved', () => {
  const existing = [
    { id: '001', reference: 'Eph 1:3', handle: 'old', ring: 'Ephesians', group: 'g', starred: true, text: 'my pasted text', week: 1, theme: '', ord: 1 },
    { id: '002', reference: 'Eph 1:4', handle: 'h', ring: 'Ephesians', group: 'g', starred: false, text: '', week: 1, theme: '', ord: 2 },
    { id: '003', reference: 'Eph 1:5', handle: 'h', ring: 'Ephesians', group: 'g', starred: false, text: 'x', week: 1, theme: '', ord: 3 },
  ];
  const csv = [
    'id,reference,handle,ring,group,starred,text,week,theme',
    '001,Eph 1:3,new handle,Ephesians,g,true,,1,',        // update handle, empty text kept
    '999,Eph 1:4,h,Ephesians,g,false,filled,1,',          // matched by reference, id kept as 002
    ',Eph 9:9,brand new,Ephesians,g,false,,2,',           // add, id generated
    '005,,no ref,Ephesians,g,false,,2,',                  // error
    '006,Eph 7:1,bad week,Ephesians,g,false,,13,',        // error
    '007,Eph 7:2,bad star,Ephesians,g,maybe,,2,',         // error
    '001,Eph 7:3,dup id,Ephesians,g,false,,2,',           // error
  ].join('\n');
  const d = L.diffVerses(existing, L.parseVersesCSV(csv));
  assert.equal(d.errors.length, 4);
  assert.equal(d.update.length, 2);
  assert.equal(d.update.find((u) => u.reference === 'Eph 1:4').id, '002');
  assert.equal(d.textKept, 1);
  assert.equal(d.add.length, 1);
  assert.equal(d.add[0].verse.id, '004');
  assert.deepEqual(d.missing.map((v) => v.id), ['003']);
  const strict = L.diffVerses(existing, L.parseVersesCSV(csv), { keepTextIfEmpty: false });
  assert.equal(strict.textKept, 0);
});

test('Verse import: missing columns leave fields untouched', () => {
  const existing = [{ id: '001', reference: 'Eph 1:3', handle: 'h', ring: 'Ephesians', group: 'g', starred: true, text: 't', week: 1, theme: '', ord: 1 }];
  const d = L.diffVerses(existing, L.parseVersesCSV('reference,text\nEph 1:3,new text'));
  assert.deepEqual(Object.keys(d.update[0].changes), ['text']);
});

test('Lie import matches by thought text, ignoring quotes and case', () => {
  const csv = 'thought,truth_to_say,verse_references\n"""I have to earn it.""",Grace,Eph 2:8-9; Rom 8:1\n';
  const p = L.parseLiesCSV(csv);
  assert.equal(p.rows[0].refs.length, 2);
  const existing = [{ key: L.lieKey('i have to earn it.'), thought: '"I have to earn it."', truth: 'Old', refs: ['Eph 2:8-9'] }];
  const d = L.diffLies(existing, p, [{ reference: 'Eph 2:8-9' }]);
  assert.equal(d.update.length, 1);
  assert.equal(d.warnings.length, 1); // Rom 8:1 not in verse table
});

const real = '/mnt/user-data/uploads/verses_TEMP_KJV.csv';
test('Real file: parses clean and every plan week has a memorize passage', { skip: !fs.existsSync(real) }, () => {
  const p = L.parseVersesCSV(fs.readFileSync(real, 'utf8'));
  assert.equal(p.errors.length, 0);
  assert.equal(p.rows.length, 494);
  const d = L.diffVerses([], p);
  assert.equal(d.add.length, 494);
  const verses = d.add.map((a) => a.verse);
  for (const week of L.SEED_MEMORIZE) for (const ref of week) assert.ok(L.resolvePassage(ref, verses).ids.length > 0, ref);
  // second import of same file changes nothing
  const again = L.diffVerses(verses, p);
  assert.equal(again.add.length + again.update.length + again.missing.length, 0);
  const lies = L.parseLiesCSV(fs.readFileSync('/mnt/user-data/uploads/lie_to_truth_TEMP_KJV.csv', 'utf8'));
  assert.equal(L.diffLies([], lies, verses).warnings.length, 0);
});
