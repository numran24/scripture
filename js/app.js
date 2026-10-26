import * as db from './db.js';
import * as L from './logic.js';
import * as S from './store.js';
import * as sync from './sync.js';
import { h, toast, download, pickFile, fmtWhen, fmtDay, plural } from './ui.js';

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const TABS = [['today', 'Today'], ['plan', 'Plan'], ['browse', 'Browse'], ['truth', 'Truth'], ['progress', 'Progress'], ['settings', 'Settings']];

/* ---------- router ---------- */
let lastRouteKey = '';
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { name: parts[0] || 'today', args: parts.slice(1) };
}
const go = (hash) => { location.hash = hash; };
const enc = encodeURIComponent;

function render() {
  const r = route();
  const key = location.hash;
  if (r.name !== 'drill') dr = null;
  if (r.name !== 'import') imp = null;
  let el;
  try {
    el = ({
      today: viewToday, plan: viewPlan, browse: viewBrowse, verse: viewVerse, edit: viewEdit,
      truth: viewTruth, drill: viewDrill, progress: viewProgress, settings: viewSettings, import: viewImport,
    }[r.name] || viewToday)(r.args);
  } catch (e) {
    console.error(e);
    el = h('div', { class: 'card' }, h('h2', null, 'Something went wrong'), h('p', null, String(e.message || e)));
  }
  main.replaceChildren(el);
  const tab = ['verse', 'edit'].includes(r.name) ? 'browse' : r.name === 'drill' || r.name === 'import' ? (r.name === 'import' ? 'settings' : 'today') : r.name;
  nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  if (key !== lastRouteKey) window.scrollTo(0, 0);
  lastRouteKey = key;
}
let rt;
function softRender() {
  clearTimeout(rt);
  rt = setTimeout(() => {
    const n = route().name;
    const ae = document.activeElement;
    if (['drill', 'import', 'edit'].includes(n)) return;
    if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return;
    render();
  }, 60);
}

/* ---------- shared bits ---------- */
const back = (href, label = 'Back') => h('a', { class: 'back', href }, '‹ ' + label);
const tag = (t, cls = '') => h('span', { class: 'tag ' + cls }, t);
const bar = (n, d) => h('div', { class: 'bar', role: 'img', 'aria-label': `${n} of ${d}` }, h('span', { style: `width:${d ? Math.round((100 * n) / d) : 0}%` }));
const btn = (label, onclick, cls = '') => h('button', { class: 'btn ' + cls, type: 'button', onclick }, label);
const link = (label, href, cls = '') => h('a', { class: 'btn ' + cls, href }, label);

function verseBlock(v, withText = true) {
  const mem = db.get('mem', v.id);
  return h('div', { class: 'verse' },
    h('div', { class: 'vhead' },
      h('a', { class: 'ref', href: '#/verse/' + enc(v.id) }, v.reference),
      v.starred && tag('★', 'star'),
      S.needsText(v) && tag('needs text', 'warn'),
      mem && mem.memorized && tag('memorized', 'ok')),
    h('div', { class: 'handle' }, v.handle),
    withText && (S.needsText(v)
      ? h('a', { class: 'small', href: '#/edit/' + enc(v.id) }, 'Add the verse text')
      : h('p', { class: 'vtext' }, v.text)));
}

function verseRow(v) {
  const mem = db.get('mem', v.id);
  return h('a', { class: 'row', href: '#/verse/' + enc(v.id) },
    h('div', { class: 'grow' }, h('b', null, v.reference), ' ', h('span', { class: 'muted' }, v.handle)),
    v.starred && tag('★', 'star'),
    S.needsText(v) && tag('needs text', 'warn'),
    mem && mem.memorized && tag('✓', 'ok'));
}

function empty(msg) { return h('p', { class: 'muted pad' }, msg); }

/* ---------- Today ---------- */
function viewToday() {
  const vs = S.verses();
  if (!vs.length) return welcome();
  const p = S.clampDay(S.pos()), set = S.settings(), st = S.streak(), lg = S.todayLog();
  const planDone = p.week > 12;
  const wk = Math.min(p.week, 12);
  const el = h('div', null);

  el.append(h('div', { class: 'card top' },
    h('div', null,
      h('div', { class: 'big' }, planDone ? 'Plan complete' : `Week ${wk} · Day ${p.day + 1} of ${set.split}`),
      h('div', { class: 'muted' }, planDone ? 'Every week is done. Keep reviewing, or restart from Plan.' : L.PLAN_WEEKS[wk - 1])),
    h('div', { class: 'streak' }, h('b', null, st.streak), h('span', null, 'day streak'))));
  if (st.pending) el.append(h('div', { class: 'note warnbox' }, 'You missed yesterday. Finish a second Read day today (a make-up day) to keep your streak.'));
  else if (st.bridged) el.append(h('div', { class: 'note' }, 'A grace day kept your streak alive. You get one each week.'));

  /* Read */
  const readDone = lg.slices.some((s) => s.done);
  const read = h('section', { class: 'card' }, partHead('Read', readDone));
  if (planDone && !lg.slices.length) read.append(empty('No reading left in the plan.'));
  lg.slices.forEach((s, i) => {
    const ids = s.done && s.ids ? s.ids : null;
    const entries = ids ? ids.map(S.verse).filter(Boolean) : S.currentSlice(s.week, s.day);
    read.append(h('div', { class: 'slice' },
      h('div', { class: 'slicehead' }, h('b', null, `Week ${s.week} · Day ${s.day + 1}`), h('span', { class: 'muted' }, plural(entries.length, 'entry').replace('entrys', 'entries'))),
      entries.length ? entries.map((v) => verseBlock(v)) : empty('This day has no entries yet.'),
      s.done
        ? btn('Done ✓  (tap to undo)', async () => { if (!(await S.undoSlice(i))) toast('Undo the later day first'); }, 'done')
        : btn('Mark this day read', async () => { await S.markSliceDone(i); toast('Read done. Plan moved on.'); }, 'primary')));
  });
  if (lg.slices.length && lg.slices.every((s) => s.done) && !planDone) {
    read.append(btn('Read another day (make-up)', () => S.addMakeupSlice(), 'ghost'));
  }
  el.append(read);

  /* Memorize */
  const mlist = S.memorizeList();
  const drillable = mlist.filter((x) => x.key && !x.needsText && !x.missing);
  const mAuto = drillable.length > 0 && drillable.every((x) => x.mem.last === S.today());
  const mem = h('section', { class: 'card' }, partHead('Memorize', lg.memorize || mAuto));
  if (!mlist.length) mem.append(empty('Nothing assigned this week.'));
  for (const x of mlist) {
    if (x.missing) { mem.append(h('div', { class: 'verse' }, h('b', null, x.label), tag('not in your verse table', 'warn'))); continue; }
    mem.append(h('div', { class: 'verse' },
      h('div', { class: 'vhead' }, h('b', null, x.label), tag(`Stage ${x.mem.stage + 1}/5 · ${L.STAGES[x.mem.stage]}`),
        x.mem.memorized && tag('memorized', 'ok'), x.needsText && tag('needs text', 'warn'), x.mem.last === S.today() && tag('today ✓', 'ok')),
      h('div', { class: 'handle' }, x.handle),
      x.needsText && h('a', { class: 'small', href: '#/edit/' + enc(x.verses[0] ? (x.verses.find(S.needsText) || x.verses[0]).id : x.key) }, 'Add the verse text to drill this')));
  }
  if (drillable.length) mem.append(link(`Drill ${plural(drillable.length, 'verse')}`, '#/drill/memorize', 'primary'));
  mem.append(btn(lg.memorize ? 'Marked done ✓ (tap to undo)' : 'Mark memorize done', () => S.setPart('memorize', !lg.memorize), lg.memorize ? 'done' : 'ghost'));
  el.append(mem);

  /* Review */
  const rlist = S.reviewList();
  const over = S.overdueCount();
  const rev = h('section', { class: 'card' }, partHead('Review', lg.review || rlist.length === 0));
  rev.append(rlist.length
    ? h('p', null, `${plural(rlist.length, 'verse')} due` + (over > rlist.length ? ` (${over - rlist.length} more waiting, oldest first)` : ''))
    : empty('Nothing due today.'));
  const rdrill = rlist.filter((x) => !x.needsText);
  if (rdrill.length) rev.append(link('Start review', '#/drill/review', 'primary'));
  if (rlist.length) rev.append(btn(lg.review ? 'Marked done ✓ (tap to undo)' : 'Mark review done', () => S.setPart('review', !lg.review), lg.review ? 'done' : 'ghost'));
  el.append(rev);

  /* Meditate */
  const slice = lg.slices.length ? lg.slices[0] : null;
  const pool = slice ? (slice.ids ? slice.ids.map(S.verse).filter(Boolean) : S.currentSlice(slice.week, slice.day)) : [];
  const withText = pool.filter((v) => !S.needsText(v));
  const pick = (withText.length ? withText : pool)[hash(S.today()) % Math.max(1, (withText.length ? withText : pool).length)];
  if (pick) {
    const nk = 'med:' + S.today();
    el.append(h('section', { class: 'card' },
      h('h2', null, 'Meditate'),
      h('div', { class: 'ref' }, pick.reference), h('div', { class: 'handle' }, pick.handle),
      !S.needsText(pick) && h('p', { class: 'vtext' }, pick.text),
      h('p', { class: 'say' }, 'Say this out loud in the first person.'),
      h('input', { class: 'field', type: 'text', maxlength: 200, placeholder: 'One line (optional)', value: S.note(nk), 'aria-label': 'Meditation note',
        onchange: (e) => S.saveNote(nk, e.target.value) })));
  }
  return el;
}
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const partHead = (t, done) => h('div', { class: 'parthead' }, h('h2', null, t), h('span', { class: 'chk' + (done ? ' on' : ''), 'aria-label': done ? 'done' : 'not done' }, done ? '✓' : ''));

function welcome() {
  return h('div', { class: 'card' },
    h('h2', null, 'Welcome'),
    h('p', null, 'No verses yet. Import your CSV, or try the app with 20 sample verses first.'),
    link('Import my verses', '#/import/verses', 'primary'),
    btn('Load 20 sample verses', loadSample, 'ghost'),
    h('p', { class: 'small muted' }, 'You can replace the data with your full file at any time from Settings > Data.'));
}
async function loadSample() {
  try {
    const [v, l] = await Promise.all([fetch('sample/verses_sample20.csv').then((r) => r.text()), fetch('sample/lie_to_truth_sample.csv').then((r) => r.text())]);
    const pv = L.parseVersesCSV(v);
    await S.applyVerseImport(L.diffVerses(S.verses(), pv), { mode: 'update', name: 'sample (20 verses)' });
    await S.applyLieImport(L.diffLies(S.lies(), L.parseLiesCSV(l), S.verses()), { mode: 'update', name: 'sample thoughts' });
    toast('Sample loaded');
  } catch (e) { toast('Could not load the sample: ' + e.message); }
}

/* ---------- Plan ---------- */
function viewPlan() {
  const set = S.settings(), p = S.clampDay(S.pos());
  const el = h('div', null);
  el.append(h('div', { class: 'card' },
    h('h2', null, 'Reading plan'),
    h('p', null, `${S.weeksCompleted()} of 12 weeks completed.`), bar(S.weeksCompleted(), 12),
    h('p', { class: 'muted' }, 'The plan moves forward only when you finish a day\'s Read, so you never fall behind.'),
    h('div', { class: 'label' }, 'Reading days per week'),
    h('div', { class: 'seg' }, [4, 5, 6, 7].map((n) => h('button', { type: 'button', class: set.split === n ? 'on' : '', onclick: async () => {
      await S.saveSettings({ split: n });
      await S.savePos(S.clampDay(S.pos(), n));
    } }, String(n))))));
  for (let w = 1; w <= 12; w++) {
    const entries = S.weekEntries(w), read = entries.filter((v) => S.isRead(v.id)).length;
    const state = p.week > w ? 'done' : p.week === w ? 'now' : '';
    const passages = L.SEED_MEMORIZE[w - 1].join(' · ');
    el.append(h('div', { class: 'card week ' + state },
      h('div', { class: 'vhead' }, h('h3', null, `Week ${w}`), state === 'done' && tag('done ✓', 'ok'), state === 'now' && tag(`Day ${p.day + 1} of ${set.split}`)),
      h('div', null, L.PLAN_WEEKS[w - 1]),
      h('div', { class: 'small muted' }, `Memorize: ${passages}`),
      h('div', { class: 'small' }, `${read} of ${entries.length} entries read`), bar(read, entries.length),
      state !== 'now' && btn('Jump to this week', async () => {
        if (confirm(`Move the plan to Week ${w}, Day 1? Your read history and memorize progress are kept.`)) { await S.savePos({ week: w, day: 0 }); await S.ensureSlice(); await S.ensureWeekMem(w); }
      }, 'ghost small')));
  }
  el.append(h('div', { class: 'card' }, btn(p.week > 12 ? 'Start the plan again' : 'Restart at Week 1', async () => {
    if (confirm('Restart the plan at Week 1, Day 1? Your history and progress are kept.')) { await S.savePos({ week: 1, day: 0 }); await S.ensureSlice(); }
  }, 'ghost')));
  return el;
}

/* ---------- Browse ---------- */
const bf = { q: '', starred: false, memorized: false, needs: false, limit: 80 };
function viewBrowse(args) {
  const vs = S.verses();
  const el = h('div', null);
  const filtering = bf.q.trim() || bf.starred || bf.memorized || bf.needs;
  const [ring, group] = args;
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Search reference, handle, text, theme', value: bf.q, 'aria-label': 'Search',
    oninput: (e) => { bf.q = e.target.value; bf.limit = 80; clearTimeout(search._t); search._t = setTimeout(() => { const pos = e.target.selectionStart; render(); const s = document.querySelector('input[type=search]'); s.focus(); s.setSelectionRange(pos, pos); }, 250); } });
  const chip = (label, key) => h('button', { type: 'button', class: 'chip' + (bf[key] ? ' on' : ''), onclick: () => { bf[key] = !bf[key]; bf.limit = 80; render(); } }, label);
  el.append(h('div', { class: 'card' }, search, h('div', { class: 'chips' }, chip('★ Starred', 'starred'), chip('Memorized', 'memorized'), chip('Needs text', 'needs'))));
  if (!vs.length) return (el.append(empty('No verses yet. Import them in Settings.')), el);
  const mem = (v) => db.get('mem', v.id);
  const match = (v) => {
    const q = bf.q.trim().toLowerCase();
    if (q && ![v.reference, v.handle, v.text, v.theme, v.group].some((s) => (s || '').toLowerCase().includes(q))) return false;
    if (bf.starred && !v.starred) return false;
    if (bf.memorized && !(mem(v) && mem(v).memorized)) return false;
    if (bf.needs && !S.needsText(v)) return false;
    return true;
  };
  if (filtering) {
    const res = vs.filter(match);
    el.append(h('p', { class: 'muted pad' }, plural(res.length, 'result')));
    const list = h('div', { class: 'card flush' }, res.slice(0, bf.limit).map(verseRow));
    el.append(list);
    if (res.length > bf.limit) el.append(btn('Show more', () => { bf.limit += 80; render(); }, 'ghost'));
    return el;
  }
  if (!ring) {
    const rings = [...new Set([...L.RINGS, ...vs.map((v) => v.ring)])].filter((r) => vs.some((v) => v.ring === r));
    el.append(h('div', { class: 'card flush' }, rings.map((r) => {
      const l = vs.filter((v) => v.ring === r);
      return h('a', { class: 'row', href: '#/browse/' + enc(r) }, h('b', { class: 'grow' }, r || '(no ring)'), h('span', { class: 'muted' }, `${l.length} · ${l.filter((v) => v.starred).length} ★`));
    })));
    return el;
  }
  const inRing = vs.filter((v) => v.ring === ring);
  if (!group) {
    const groups = [...new Set(inRing.map((v) => v.group))];
    el.append(back('#/browse', 'All rings'), h('h2', { class: 'pad' }, ring),
      h('div', { class: 'card flush' }, groups.map((g) => h('a', { class: 'row', href: `#/browse/${enc(ring)}/${enc(g)}` }, h('b', { class: 'grow' }, g || '(no group)'), h('span', { class: 'muted' }, String(inRing.filter((v) => v.group === g).length))))));
    return el;
  }
  el.append(back('#/browse/' + enc(ring), ring), h('h2', { class: 'pad' }, group || '(no group)'),
    h('div', { class: 'card flush' }, inRing.filter((v) => v.group === group).map(verseRow)));
  return el;
}

/* ---------- Verse detail and edit ---------- */
function viewVerse([id]) {
  const v = S.verse(id);
  if (!v) return h('div', { class: 'card' }, back('#/browse'), empty('That verse is no longer in your data.'));
  const m = db.get('mem', id), rd = db.get('read', id);
  const el = h('div', null, back('#/browse'));
  const linked = S.liesForRefs([v.reference]);
  el.append(h('div', { class: 'card' },
    h('h2', null, v.reference), h('div', { class: 'handle big2' }, v.handle),
    S.needsText(v) ? h('p', { class: 'warnbox' }, 'Needs text. It can be read as reference and handle but not drilled.') : h('p', { class: 'vtext large' }, v.text),
    h('div', { class: 'tags' }, tag(v.ring), tag(v.group), v.week && tag('Week ' + v.week), v.starred && tag('★ starred', 'star'),
      ...String(v.theme || '').split(/[;,]/).map((t) => t.trim()).filter(Boolean).map((t) => tag('#' + t))),
    h('div', { class: 'small' }, rd ? `Read ${plural(rd.n, 'time')}, last ${fmtDay(rd.d)}.` : 'Not read yet.'),
    m && !m.archived
      ? h('div', { class: 'small' }, `Memorize: stage ${m.stage + 1}/5 (${L.STAGES[m.stage]}), next review ${fmtDay(m.due)}${m.memorized ? ', memorized' : ''}.`)
      : h('div', { class: 'small' }, 'Not in the memorize queue.'),
    h('div', { class: 'actions' },
      S.inQueue(id) ? btn('Remove from memorize queue', () => S.removeFromQueue(id), 'ghost')
        : btn('Add to memorize queue', async () => { await S.addToQueue(id); toast('Added. It joins Memorize for a week, then Review.'); }, 'primary'),
      link('Edit', '#/edit/' + enc(id), 'ghost'))));
  if (linked.length) el.append(h('div', { class: 'card' }, h('h3', null, 'Lie to Truth'), linked.map((l) => h('a', { class: 'row', href: '#/truth/' + enc(l.key) }, h('span', { class: 'grow' }, l.thought), h('span', { class: 'muted' }, '›')))));
  el.append(h('div', { class: 'card' }, h('h3', null, 'Notes'),
    h('textarea', { class: 'field', rows: 4, placeholder: 'Your notes on this verse', 'aria-label': 'Notes', onchange: (e) => S.saveNote(id, e.target.value) }, S.note(id))));
  return el;
}

function viewEdit([id]) {
  const v = S.verse(id);
  if (!v) return h('div', { class: 'card' }, back('#/browse'), empty('Verse not found.'));
  const f = {};
  const field = (key, label, el) => h('label', { class: 'lbl' }, label, (f[key] = el));
  const input = (key, type = 'text') => h('input', { class: 'field', type, value: v[key] ?? '' });
  return h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault();
    const wk = f.week.value.trim();
    if (wk && !(/^\d+$/.test(wk) && +wk >= 1 && +wk <= 12)) return toast('Week must be 1 to 12');
    await S.saveVerse({ ...v, reference: f.reference.value.trim() || v.reference, handle: f.handle.value.trim(), ring: f.ring.value.trim(), group: f.group.value.trim(),
      starred: f.starred.checked, text: f.text.value.trim(), week: wk ? +wk : null, theme: f.theme.value.trim() });
    toast('Saved');
    go('#/verse/' + enc(id));
  } },
  back('#/verse/' + enc(id), 'Cancel'), h('h2', null, 'Edit ' + v.reference),
  field('text', 'Verse text', h('textarea', { class: 'field', rows: 8, placeholder: 'Paste the verse text here' }, v.text || '')),
  field('reference', 'Reference', input('reference')), field('handle', 'Handle', input('handle')),
  field('ring', 'Ring', input('ring')), field('group', 'Group', input('group')),
  field('week', 'Week (1 to 12)', input('week', 'text')), field('theme', 'Theme tags', input('theme')),
  h('label', { class: 'lbl inline' }, (f.starred = h('input', { type: 'checkbox', checked: !!v.starred })), ' Starred (memorize-worthy)'),
  h('button', { class: 'btn primary', type: 'submit' }, 'Save'));
}

/* ---------- Lie to Truth ---------- */
function viewTruth([key]) {
  const ls = S.lies();
  if (!key) {
    if (!ls.length) return h('div', { class: 'card' }, h('h2', null, 'Lie to Truth'), empty('No thoughts yet. Import your Lie-to-Truth CSV in Settings.'), link('Import', '#/import/lies', 'primary'));
    return h('div', null, h('h2', { class: 'pad' }, 'Lie to Truth'),
      h('div', { class: 'card flush' }, ls.map((l) => h('a', { class: 'row', href: '#/truth/' + enc(l.key) }, h('div', { class: 'grow' }, h('b', null, l.thought), h('div', { class: 'muted small' }, l.truth)), h('span', { class: 'muted' }, '›')))));
  }
  const l = S.lie(key);
  if (!l) return h('div', { class: 'card' }, back('#/truth'), empty('Thought not found.'));
  const vv = l.refs.map((r) => ({ ref: r, v: S.byRef(r) }));
  const ready = vv.filter((x) => x.v && !S.needsText(x.v));
  return h('div', null, back('#/truth', 'All thoughts'),
    h('div', { class: 'card' }, h('div', { class: 'lie' }, l.thought), h('div', { class: 'label' }, 'Truth to say back'), h('div', { class: 'truth' }, l.truth),
      ready.length ? link(`Rehearse ${plural(ready.length, 'verse')}`, '#/drill/rehearse/' + enc(key), 'primary') : h('p', { class: 'warnbox' }, 'Add verse text to rehearse these.')),
    h('div', { class: 'card' }, h('h3', null, 'Verses'),
      vv.map((x) => x.v ? verseBlock(x.v) : h('div', { class: 'verse' }, h('b', null, x.ref), tag('not in verse table', 'warn')))));
}

/* ---------- Drill ---------- */
let dr = null;
function startDrill(mode, arg) {
  const id = mode + '/' + (arg || '');
  if (dr && dr.id === id) return; // finished sessions stay put until you leave the drill screen
  const cards = [];
  if (mode === 'memorize' || mode === 'review') {
    const list = mode === 'memorize' ? S.memorizeList() : S.reviewList();
    for (const p of list) {
      if (!p.key || p.needsText) continue;
      const thoughts = S.liesForRefs(p.refs);
      const useThought = thoughts.length > 0 && p.mem.reps % 2 === 1; // alternate: reference, thought, reference...
      cards.push({ p, front: useThought ? 'thought' : 'ref', lie: thoughts[(p.mem.reps >> 1) % Math.max(1, thoughts.length)] });
    }
  } else if (mode === 'rehearse') {
    const l = S.lie(arg);
    if (l) for (const r of l.refs) {
      const v = S.byRef(r);
      if (v && !S.needsText(v)) cards.push({ rehearse: true, lie: l, p: { label: v.reference, text: v.text, handle: v.handle, key: v.id, mem: { stage: 4, reps: 0 } }, front: 'both' });
    }
  }
  dr = { id, mode, arg, cards, i: 0, shown: false, graded: 0, tally: { missed: 0, hard: 0, good: 0, easy: 0 }, over: false };
}
function viewDrill([mode, arg]) {
  startDrill(mode, arg);
  const exit = mode === 'rehearse' ? '#/truth/' + enc(arg) : '#/today';
  const title = { memorize: 'Memorize', review: 'Review', rehearse: 'Rehearse' }[mode] || 'Drill';
  if (!dr.cards.length) return h('div', { class: 'card' }, back(exit, 'Close'), h('h2', null, title), empty('Nothing to drill right now. Verses with no text cannot be drilled.'));
  if (dr.i >= dr.cards.length) return drillDone(exit, title);
  const c = dr.cards[dr.i], p = c.p;
  const pick = S.settings().drillMode || 'auto';
  const manual = !c.rehearse && pick !== 'auto';
  const level = c.rehearse ? 4 : manual ? +pick : p.mem.stage;
  const typed = !c.rehearse && L.isTypedLevel(level);
  const el = h('div', { class: 'card drill' });
  el.append(h('div', { class: 'vhead' }, back(exit, 'Close'), h('span', { class: 'grow' }), h('span', { class: 'muted' }, `${Math.min(dr.i + 1, dr.cards.length)} / ${dr.cards.length}`)));
  if (!c.rehearse) {
    el.append(h('label', { class: 'lbl' }, 'How to drill',
      h('select', { class: 'field', 'aria-label': 'Drill level', onchange: async (e) => { await S.saveSettings({ drillMode: e.target.value }); dr.shown = false; dr.typed = ''; dr.forgive = new Map(); render(); } },
        h('option', { value: 'auto', selected: pick === 'auto' }, 'Auto (steps up as I get it right)'),
        L.DRILL_LEVELS.map((n, i) => h('option', { value: String(i), selected: pick === String(i) }, `${i + 1}. ${n}`)))));
    el.append(h('div', { class: 'small muted' }, manual ? `Level: ${L.DRILL_LEVELS[level]}` : `Auto: stage ${level + 1}/5, ${L.STAGES[level]}`), bar(Math.min(level, 4) + 1, 5));
  }
  // front
  const front = h('div', { class: 'front' });
  if (c.front === 'thought' && c.lie) front.append(h('div', { class: 'label' }, 'The thought'), h('div', { class: 'lie' }, c.lie.thought), h('div', { class: 'label' }, typed ? 'Write the verse' : 'Say the truth and the verse'));
  else if (c.front === 'both') front.append(h('div', { class: 'lie' }, c.lie.thought), h('div', { class: 'ref big2' }, p.label), h('div', { class: 'label' }, 'Say the truth, then recall the verse'));
  else front.append(h('div', { class: 'ref big2' }, p.label));
  let ta = null;
  if (!c.rehearse && !dr.shown) {
    const seed = p.key + ':' + p.mem.reps;
    const hint = level === 5 ? L.firstLetters(p.text) : L.hintFor(Math.min(level, 4), p.text, seed);
    if (hint) front.append(h('p', { class: 'vtext large hint' }, hint));
    if (level === 0) front.append(h('p', { class: 'say' }, 'Read it aloud.'));
    if (level === 4) front.append(h('p', { class: 'muted' }, 'Recall everything, then check.'));
    if (typed) {
      ta = h('textarea', { class: 'field typed', rows: 7, placeholder: level === 5 ? 'Type the whole verse. The letters above are your help.' : 'Type the whole verse from memory.', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Your answer',
        oninput: (e) => { dr.typed = e.target.value; } }, dr.typed || '');
      front.append(ta);
    }
  }
  el.append(front);
  if (ta) requestAnimationFrame(() => ta.focus());
  if (!dr.shown) {
    el.append(btn(typed ? 'Check my answer' : 'Show answer', () => { dr.shown = true; render(); }, 'primary big'));
  } else {
    const back_ = h('div', { class: 'back-side' }, c.lie && c.front !== 'ref' && h('div', { class: 'truth' }, c.lie.truth), h('div', { class: 'ref' }, p.label));
    if (typed) {
      const r = L.compareWords(p.text, dr.typed || '');
      const fg = dr.forgive || (dr.forgive = new Map());
      const sc = L.scoreWith(r, fg);
      const typos = L.forgiveTypos(r, fg).size - fg.size;
      const toggle = (i, w) => () => {
        if (fg.has(i)) fg.delete(i);
        else fg.set(i, L.nearestExtra(w, r.extras, new Set([...fg.values()].filter((k) => k >= 0))));
        render();
      };
      back_.append(
        h('p', { class: 'vtext large cmp' }, r.words.map((w, i) => [i ? ' ' : '', w.hit ? w.w
          : h('button', { type: 'button', class: 'miss' + (fg.has(i) ? ' forgiven' : ''), 'aria-pressed': fg.has(i) ? 'true' : 'false',
            'aria-label': (fg.has(i) ? 'Counted as right: ' : 'Missed, tap to count as right: ') + w.w, onclick: toggle(i, w.w) }, (fg.has(i) ? '✓ ' : '') + w.w)])),
        h('div', { class: 'score' }, `${sc.hits} of ${sc.total} words right (${sc.pct}%)` + (fg.size ? `, ${fg.size} forgiven` : '') + (sc.extra ? `, ${sc.extra} extra` : '') + '. Suggested: ' + L.suggestGrade(sc.pct)),
        h('div', { class: 'actions' },
          typos > 0 && btn(`Forgive likely typos (${typos})`, () => { dr.forgive = L.forgiveTypos(r, fg); render(); }, 'ghost small'),
          fg.size > 0 && btn('Undo forgiving', () => { dr.forgive = new Map(); render(); }, 'ghost small')),
        h('div', { class: 'small muted' }, 'Underlined words were missed or out of order. Tap one to count it as right (a keyboard slip, say). The grade you press below is what gets recorded.'));
    } else back_.append(h('p', { class: 'vtext large' }, p.text));
    back_.append(h('div', { class: 'handle' }, p.handle));
    el.append(back_);
    if (c.rehearse) {
      el.append(h('div', { class: 'grades two' },
        btn('Again', () => { dr.cards.push({ ...c }); next(); }, 'g-missed'), btn('Got it', () => { dr.tally.good++; next(); }, 'g-good')));
    } else {
      const g = (label, key) => btn(label, async () => {
        dr.tally[key]++;
        await S.grade(p.key, key, manual ? level : null);
        if (key === 'missed' && !c.again) dr.cards.push({ ...c, again: true, p: S.passageView(p.key, db.get('mem', p.key)) });
        next();
      }, 'g-' + key);
      el.append(h('div', { class: 'grades' }, g('Missed', 'missed'), g('Hard', 'hard'), g('Good', 'good'), g('Easy', 'easy')));
    }
  }
  return el;
}
function next() { dr.i++; dr.shown = false; dr.typed = ''; dr.forgive = new Map(); if (dr.i >= dr.cards.length) dr.over = true; render(); }
function drillDone(exit, title) {
  const t = dr.tally, n = t.missed + t.hard + t.good + t.easy;
  if (!dr.recorded) {
    dr.recorded = true;
    if (dr.mode === 'memorize') S.setPart('memorize', true);
    if (dr.mode === 'review') S.setPart('review', true);
  }
  return h('div', { class: 'card' }, h('h2', null, title + ' done'),
    dr.mode === 'rehearse' ? h('p', null, 'Nicely rehearsed.') : h('p', null, `${plural(n, 'card')}: ${t.missed} missed, ${t.hard} hard, ${t.good} good, ${t.easy} easy.`),
    link('Finish', exit, 'primary'));
}

/* ---------- Progress ---------- */
function viewProgress() {
  const vs = S.verses();
  if (!vs.length) return h('div', { class: 'card' }, empty('Import your verses to see progress.'));
  const el = h('div', null);
  const reads = S.readsByDate(), st = S.streak();
  el.append(h('div', { class: 'card' }, h('h2', null, 'Streak'),
    h('div', { class: 'stats' }, stat(st.streak, 'current'), stat(L.bestStreak(reads), 'best'), stat(Object.values(reads).filter((n) => n >= 1).length, 'days read')),
    h('div', { class: 'label' }, 'Last 12 weeks'), heat(reads)));
  const totalRead = vs.filter((v) => S.isRead(v.id)).length;
  el.append(h('div', { class: 'card' }, h('h2', null, 'Entries read'), h('p', null, `${totalRead} of ${vs.length}`), bar(totalRead, vs.length),
    h('h3', null, 'By ring'), L.RINGS.map((r) => { const l = vs.filter((v) => v.ring === r); return l.length ? meter(r, l.filter((v) => S.isRead(v.id)).length, l.length) : null; }),
    h('h3', null, 'By week'), Array.from({ length: 12 }, (_, i) => { const l = S.weekEntries(i + 1); return l.length ? meter('Week ' + (i + 1), l.filter((v) => S.isRead(v.id)).length, l.length) : null; })));
  // memorized: planned passages per ring/week vs memorized
  const planned = [];
  for (let w = 1; w <= 12; w++) for (const p of S.weekPassages(w)) planned.push({ w, key: p.key, ring: p.key ? S.verse(p.key).ring : '' });
  const mem = S.memAll().filter((e) => e.mem.memorized);
  const memSet = new Set(mem.map((e) => e.key));
  const ringOf = (k) => (S.verse(k) ? S.verse(k).ring : '');
  el.append(h('div', { class: 'card' }, h('h2', null, 'Verses memorized'), h('p', null, `${mem.length} memorized, ${S.memAll().length} in the queue`), bar(mem.length, Math.max(planned.length, S.memAll().length)),
    h('h3', null, 'By ring'), L.RINGS.map((r) => {
      const pl = planned.filter((x) => x.ring === r).length, mm = mem.filter((e) => ringOf(e.key) === r).length;
      return pl || mm ? meter(r, mm, Math.max(pl, mm)) : null;
    }),
    h('h3', null, 'By week'), Array.from({ length: 12 }, (_, i) => { const pl = planned.filter((x) => x.w === i + 1 && x.key); return meter('Week ' + (i + 1), pl.filter((x) => memSet.has(x.key)).length, pl.length || 3); })));
  return el;
}
const stat = (n, l) => h('div', { class: 'stat' }, h('b', null, String(n)), h('span', null, l));
const meter = (label, n, d) => h('div', { class: 'meter' }, h('div', { class: 'mrow' }, h('span', null, label), h('span', { class: 'muted' }, `${n}/${d}`)), bar(n, d));
function heat(reads) {
  const t = S.today(), start = L.weekKey(L.addDays(t, -7 * 11));
  const grid = h('div', { class: 'heat', role: 'img', 'aria-label': 'Days read over the last 12 weeks' });
  for (let i = 0; i < 84; i++) {
    const d = L.addDays(start, i);
    const n = d > t ? -1 : reads[d] || 0;
    grid.append(h('i', { class: n < 0 ? 'f' : n >= 2 ? 'h2' : n === 1 ? 'h1' : '', title: d }));
  }
  return grid;
}

/* ---------- Settings ---------- */
function viewSettings() {
  const set = S.settings(), fm = S.files();
  const el = h('div', null);
  const sec = (title, ...kids) => h('section', { class: 'card' }, h('h2', null, title), ...kids);

  // reminder
  const rs = reminderSupport();
  el.append(sec('Daily reminder',
    h('div', { class: 'seg' }, h('button', { type: 'button', class: set.reminderOn ? '' : 'on', onclick: () => setReminder(false) }, 'Off'), h('button', { type: 'button', class: set.reminderOn ? 'on' : '', onclick: () => setReminder(true) }, 'On')),
    h('label', { class: 'lbl' }, 'Time', h('input', { class: 'field', type: 'time', value: set.reminderTime, onchange: async (e) => { await S.saveSettings({ reminderTime: e.target.value || '07:00' }); await applyReminder(); } })),
    h('p', { class: 'small ' + (rs.ok ? 'muted' : 'warnbox') }, rs.msg)));

  el.append(sec('Appearance', h('div', { class: 'seg' }, ['system', 'light', 'dark'].map((t) => h('button', { type: 'button', class: set.theme === t ? 'on' : '', onclick: () => S.saveSettings({ theme: t }).then(applyTheme) }, t[0].toUpperCase() + t.slice(1))))));
  el.append(sec('Plan pace', h('div', { class: 'seg' }, [4, 5, 6, 7].map((n) => h('button', { type: 'button', class: set.split === n ? 'on' : '', onclick: async () => { await S.saveSettings({ split: n }); await S.savePos(S.clampDay(S.pos(), n)); } }, n + ' days'))),
    h('p', { class: 'small muted' }, 'Reading days per week. Changing it mid-week is safe.')));

  // data
  const loaded = (k, label) => fm[k]
    ? h('div', { class: 'small' }, h('b', null, label + ': '), `${fm[k].name}, loaded ${fmtWhen(fm[k].at)} (${fm[k].added} added, ${fm[k].updated} updated${fm[k].removed ? ', ' + fm[k].removed + ' removed' : ''})`)
    : h('div', { class: 'small muted' }, label + ': ' + (k === 'verses' ? (S.verses().length ? 'loaded on another device or restored from a backup' : 'none yet') : (S.lies().length ? 'loaded on another device or restored from a backup' : 'none yet')));
  const undo = h('div', null);
  S.lastUndoable().then((b) => {
    if (!b) return;
    undo.append(btn(`Undo last import (${b.what === 'lies' ? 'Lie-to-Truth' : b.what === 'verses' ? 'verses' : 'restore'}, ${fmtWhen(b.at)})`, async () => {
      if (!confirm('Undo the last import? Verse content goes back to how it was. Progress you made since then is kept.')) return;
      await S.undoLastImport(); toast('Import undone'); render();
    }, 'ghost'));
  });
  el.append(sec('Data',
    loaded('verses', 'Verse data'), loaded('lies', 'Lie-to-Truth data'),
    h('p', { class: 'small muted' }, `${plural(S.verses().length, 'verse')}, ${plural(S.lies().length, 'thought')} on this device.`),
    link('Replace verse data', '#/import/verses', 'primary'), link('Replace Lie-to-Truth data', '#/import/lies', 'ghost'), undo,
    h('div', { class: 'label' }, 'Templates'),
    h('div', { class: 'actions' }, btn('Verses template', () => download('verses_template.csv', S.templateVersesCSV()), 'ghost small'), btn('Lie-to-Truth template', () => download('lie_to_truth_template.csv', S.templateLiesCSV()), 'ghost small')),
    h('div', { class: 'label' }, 'Backup and export'),
    h('div', { class: 'actions' },
      btn('Full backup (JSON)', () => download(`scripture-backup-${S.today()}.json`, S.fullJSON(), 'application/json'), 'ghost small'),
      btn('Verses CSV', () => download('verses.csv', S.versesCSV()), 'ghost small'),
      btn('Lie-to-Truth CSV', () => download('lie_to_truth.csv', S.liesCSV()), 'ghost small'),
      btn('Progress CSV', () => download('progress.csv', S.progressCSV()), 'ghost small')),
    btn('Restore from backup file', restoreBackup, 'ghost')));

  el.append(syncSection(sec));
  el.append(sec('About', h('p', { class: 'small muted' }, db.persistent ? 'Your data is stored on this device and works offline.' : 'Storage is unavailable in this browser mode; changes will not survive closing the app.')));
  return el;
}

async function restoreBackup() {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  let j;
  try { j = JSON.parse(f.text); if (j.app !== 'scripture-app' || !Array.isArray(j.records)) throw 0; } catch { return toast('That is not a backup file from this app'); }
  const nv = j.records.filter((r) => r.kind === 'verse' && !r.d).length;
  if (!confirm(`Restore this backup (${f.name}, ${nv} verses)? Everything on this device is replaced by the backup. A copy of the current data is saved first, so you can undo.`)) return;
  await db.makeBackup('Before restore', { kinds: db.SYNC_KINDS, what: 'restore', fileName: f.name });
  await db.restoreAll(j.records);
  toast('Backup restored');
  render();
}

function syncSection(sec) {
  const c = sync.cfg(), ss = sync.session();
  const body = [];
  const stat = h('p', { class: 'small', id: 'syncstat' }, sync.status.msg + (sync.status.at ? ` (${fmtWhen(sync.status.at)})` : ''));
  sync.onStatus((s) => { const e = document.getElementById('syncstat'); if (e) e.textContent = s.msg + (s.at ? ` (${fmtWhen(s.at)})` : ''); });
  if (!sync.configured()) {
    let u, k;
    body.push(h('p', { class: 'small muted' }, 'Optional. Syncs your progress across devices using your own free Supabase project (see README). Without it, everything stays on this device.'),
      h('label', { class: 'lbl' }, 'Supabase project URL', (u = h('input', { class: 'field', type: 'url', placeholder: 'https://xxxx.supabase.co', value: c.url }))),
      h('label', { class: 'lbl' }, 'Supabase anon key', (k = h('input', { class: 'field', type: 'text', placeholder: 'public anon key', value: c.anon }))),
      btn('Save', async () => { await sync.saveCfg(u.value, k.value); render(); }, 'primary'));
  } else if (!ss) {
    let em;
    body.push(h('label', { class: 'lbl' }, 'Email for sign-in link', (em = h('input', { class: 'field', type: 'email', autocomplete: 'email', placeholder: 'you@example.com' }))),
      btn('Email me a sign-in link', async () => {
        if (!em.value.includes('@')) return toast('Enter your email');
        try { await sync.sendMagicLink(em.value.trim()); toast('Check your email and open the link on this device'); } catch (e) { toast(e.message); }
      }, 'primary'),
      h('p', { class: 'small muted' }, 'Open the emailed link in the same browser or installed app you use for this page.'));
  } else {
    body.push(h('p', { class: 'small' }, 'Signed in as ' + ss.email), btn('Sync now', () => sync.syncNow(), 'primary'),
      btn('Sign out', async () => { if (confirm('Sign out of sync? Your data stays on this device.')) { await sync.signOut(); render(); } }, 'ghost'));
  }
  return sec('Sync', stat, ...body);
}

/* ---------- Import (verses and Lie-to-Truth) ---------- */
let imp = null;
function viewImport([kind]) {
  const isV = kind !== 'lies';
  if (!imp || imp.kind !== kind) imp = { kind, mode: 'update', keepText: true, name: '', parsed: null, result: null };
  const title = isV ? 'Replace verse data' : 'Replace Lie-to-Truth data';
  const el = h('div', { class: 'card' }, back('#/settings', 'Settings'), h('h2', null, title));
  el.append(h('p', { class: 'small muted' }, isV ? 'Columns: id, reference, handle, ring, group, starred, text, week, theme. Rows match existing verses by id, then by reference. Your progress, notes and review schedule stay attached to each verse.'
    : 'Columns: thought, truth_to_say, verse_references (semicolon-separated). Rows match existing thoughts by thought text.'),
  btn(imp.name ? 'Choose a different CSV' : 'Choose CSV file', async () => {
    const f = await pickFile('.csv,text/csv,text/plain');
    if (!f) return;
    imp.name = f.name; imp.text = f.text; imp.result = null; render();
  }, 'primary'),
  btn('Download template', () => (isV ? download('verses_template.csv', S.templateVersesCSV()) : download('lie_to_truth_template.csv', S.templateLiesCSV())), 'ghost small'));
  if (imp.result) {
    el.append(h('div', { class: 'okbox' }, imp.result.msg), link('Done', '#/settings', 'primary'));
    return el;
  }
  if (!imp.name) return el;
  el.append(h('div', { class: 'label' }, 'File: ' + imp.name));
  el.append(h('div', { class: 'label' }, 'Mode'),
    radio('Update matching verses', 'Leaves anything not in the file untouched.', imp.mode === 'update', () => { imp.mode = 'update'; render(); }),
    radio('Replace everything', 'Also removes items missing from the file.', imp.mode === 'replace', () => { imp.mode = 'replace'; render(); }));
  let diff, nParsed;
  if (isV) {
    const parsed = L.parseVersesCSV(imp.text);
    diff = L.diffVerses(S.verses(), parsed, { keepTextIfEmpty: imp.keepText });
    nParsed = parsed.rows.length;
    el.append(h('label', { class: 'lbl inline' }, h('input', { type: 'checkbox', checked: imp.keepText, onchange: (e) => { imp.keepText = e.target.checked; render(); } }), ' Keep my existing text when the file\'s text is empty'));
  } else {
    const parsed = L.parseLiesCSV(imp.text);
    diff = L.diffLies(S.lies(), parsed, S.verses());
    nParsed = parsed.rows.length;
  }
  const replace = imp.mode === 'replace';
  const sum = h('div', { class: 'sum' },
    sumRow('Added', diff.add.length, 'ok'), sumRow('Updated', diff.update.length, 'ok'), sumRow('Unchanged', diff.unchanged.length, ''),
    sumRow(replace ? 'Will be removed' : 'Not in the file (left untouched)', diff.missing.length, replace && diff.missing.length ? 'bad' : ''),
    sumRow('Errors (rows skipped)', diff.errors.length, diff.errors.length ? 'bad' : ''));
  el.append(h('h3', null, 'Preview'), sum);
  if (isV && (diff.textKept || diff.textChanged)) el.append(h('p', { class: 'small muted' }, `${diff.textChanged} verse texts will change${diff.textKept ? `; ${diff.textKept} kept because the file has no text for them` : ''}.`));
  if (diff.errors.length) el.append(detail('Errors', diff.errors.map((e) => `Line ${e.line}: ${e.msg}`), true));
  if (diff.warnings.length) el.append(detail('Warnings', diff.warnings.map((e) => `Line ${e.line}: ${e.msg}`)));
  if (diff.add.length) el.append(detail('Added', diff.add.map((a) => (isV ? a.verse.reference : a.lie.thought))));
  if (diff.update.length) el.append(detail('Updated', diff.update.map((u) => (isV ? `${u.reference}: ${Object.keys(u.changes).join(', ')}` : `${u.thought}: ${Object.keys(u.changes).join(', ')}`))));
  if (diff.missing.length) el.append(detail(replace ? 'To be removed' : 'Missing from the file', diff.missing.map((m) => (isV ? m.reference : m.thought))));
  const nothing = !diff.add.length && !diff.update.length && !(replace && diff.missing.length);
  if (!nParsed) el.append(h('p', { class: 'warnbox' }, 'No usable rows found.'));
  el.append(h('div', { class: 'note' }, 'A backup of your current data is made automatically before applying. You can undo from Settings.'));
  el.append(h('button', { class: 'btn ' + (replace ? 'danger' : 'primary'), type: 'button', disabled: !nParsed || (nothing && !diff.unchanged.some((u) => u.orderChanged)), onclick: async () => {
    const lines = [`Apply this import?`, `+${diff.add.length} added, ${diff.update.length} updated` + (replace ? `, ${diff.missing.length} removed` : '')];
    if (diff.errors.length) lines.push(`${diff.errors.length} rows with errors will be skipped.`);
    if (replace && diff.missing.length) lines.push('', `WARNING: Replace everything will remove ${diff.missing.length} ${isV ? 'verses' : 'thoughts'} that are not in this file. (Progress for them is kept, and Undo brings them back.)`);
    if (!confirm(lines.join('\n'))) return;
    if (replace && diff.missing.length && !confirm(`Last check: remove ${diff.missing.length} items not in the file?`)) return;
    const f = isV ? S.applyVerseImport : S.applyLieImport;
    await f(diff, { mode: imp.mode, name: imp.name });
    imp.result = { msg: `Imported ${imp.name}: ${diff.add.length} added, ${diff.update.length} updated${replace ? ', ' + diff.missing.length + ' removed' : ''}. You can undo this from Settings.` };
    render();
  } }, replace ? 'Replace everything' : 'Apply update'));
  return el;
}
const radio = (t, sub, on, fn) => h('button', { type: 'button', class: 'radio' + (on ? ' on' : ''), onclick: fn }, h('b', null, t), h('span', { class: 'small muted' }, sub));
const sumRow = (l, n, cls) => h('div', { class: 'sumrow ' + cls }, h('span', null, l), h('b', null, String(n)));
const detail = (t, lines, open = false) => h('details', { open }, h('summary', null, `${t} (${lines.length})`), h('ul', { class: 'lines' }, lines.slice(0, 200).map((x) => h('li', null, x)), lines.length > 200 && h('li', null, `…and ${lines.length - 200} more`)));

/* ---------- theme ---------- */
function applyTheme() {
  const t = S.settings().theme;
  document.documentElement.dataset.theme = t === 'system' ? '' : t;
  try { localStorage.setItem('theme', t); } catch {}
}

/* ---------- reminders ---------- */
let reminderTimer;
function reminderSupport() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!('Notification' in window)) return { ok: false, msg: 'This browser cannot show notifications. Reminders are not available here; a phone alarm is the fallback.' };
  if (ios && !standalone) return { ok: false, msg: 'On iPhone, add the app to your Home screen first (Share, then Add to Home Screen), open it from there, then turn reminders on.' };
  if (Notification.permission === 'denied') return { ok: false, msg: 'Notifications are blocked for this site. Allow them in your browser or phone settings, then turn reminders on again.' };
  const bg = 'serviceWorker' in navigator && 'periodicSync' in ServiceWorkerRegistration.prototype;
  return { ok: true, msg: bg ? 'Reminders can arrive in the background on this device when the installed app is used regularly. There is no push server, so a closed app may miss one; if so, a phone alarm is the fallback.' : 'Reminders show while the app is open or recently used. Browsers here do not allow background reminders without a push server, so a phone alarm is the fallback if you miss one.' };
}
async function setReminder(on) {
  if (on) {
    if (!('Notification' in window)) return toast('Notifications are not supported here');
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') { await S.saveSettings({ reminderOn: false }); return toast('Permission was not granted'); }
  }
  await S.saveSettings({ reminderOn: on });
  await applyReminder();
}
async function applyReminder() {
  const s = S.settings();
  const prev = db.kvGet('reminder', {});
  await db.kvSet('reminder', { on: s.reminderOn, time: s.reminderTime, lastShown: prev.lastShown || '' });
  clearTimeout(reminderTimer);
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) { if (s.reminderOn) await reg.periodicSync.register('daily-reminder', { minInterval: 6 * 3600 * 1000 }); else await reg.periodicSync.unregister('daily-reminder'); }
  } catch {}
  if (!s.reminderOn || !('Notification' in window) || Notification.permission !== 'granted') return;
  const [hh, mm] = s.reminderTime.split(':').map(Number);
  const t = new Date(); t.setHours(hh, mm, 0, 0);
  if (t <= new Date()) t.setDate(t.getDate() + 1);
  reminderTimer = setTimeout(fireReminder, Math.min(t - new Date(), 2147483000));
}
async function fireReminder() {
  const d = S.today(), prev = db.kvGet('reminder', {});
  if (prev.lastShown !== d && !S.todayLog().slices.some((x) => x.done)) {
    try { const reg = await navigator.serviceWorker.ready; await reg.showNotification('Scripture', { body: 'Time for today\'s reading.', tag: 'daily', icon: 'icons/icon-192.png' }); } catch {}
  }
  await db.kvSet('reminder', { ...prev, lastShown: d });
  applyReminder();
}

/* ---------- boot ---------- */
(async function boot() {
  await db.open();
  applyTheme();
  try { await sync.handleRedirect(); } catch (e) { console.warn(e); }
  nav.append(...TABS.map(([k, t]) => h('a', { href: '#/' + k, 'data-tab': k }, t)));
  window.addEventListener('hashchange', async () => {
    if (/access_token=/.test(location.hash)) { // magic link opened while the app was already open
      try { if (await sync.handleRedirect()) { sync.init(); } } catch (e) { console.warn(e); }
    }
    render();
  });
  db.onChange(softRender);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {});
  if (S.verses().length) { await S.ensureSlice(); await S.ensureWeekMem(Math.min(S.pos().week, 12)); }
  db.onChange(async (k) => { if (k.includes('verse') && S.verses().length) { await S.ensureSlice(); await S.ensureWeekMem(Math.min(S.pos().week, 12)); } });
  sync.init();
  render();
  applyReminder();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (S.verses().length) { await S.ensureSlice(); await S.ensureWeekMem(Math.min(S.pos().week, 12)); }
    softRender(); applyReminder(); sync.syncNow();
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
})();
