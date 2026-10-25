import { esc, actions, plural, toast } from '../ui.js';
import { todayUnits, queuedUnits, buildCards, gradeUnit, ensureDaily, saveDaily, ensureWeekUnits, lieVerses } from '../domain.js';
import { GRADES, GRADE_LABELS, stageLabel, hintTokens, previewDays, STAGES } from '../srs.js';

let session = null;

const MODES = { memorize: 'Memorize', review: 'Review', practice: 'Practice' };

export function startSession(ctx, mode) {
  const t = ctx.today();
  ensureWeekUnits(ctx.repo, t);
  const u = todayUnits(ctx.repo, t);
  const units = mode === 'memorize' ? u.memorize : mode === 'review' ? u.review : queuedUnits(ctx.repo);
  const cards = buildCards(ctx.repo, units);
  if (!cards.length) return toast('Nothing to drill right now.');
  session = { mode, title: MODES[mode], cards, i: 0, shown: false, tally: { missed: 0, hard: 0, good: 0, easy: 0 }, done: false, back: location.hash.startsWith('#/drill') ? '#/drill' : '#/today' };
  ctx.go('#/drill/run');
}

export function startRehearse(ctx, key) {
  const lie = ctx.repo.lies().find((l) => l.key === key);
  if (!lie) return;
  const cards = lieVerses(ctx.repo, lie).filter((x) => x.verse).map((x) => ({ rehearse: true, verse: x.verse, lie }));
  if (!cards.length) return toast('None of these verses are in your list yet.');
  session = { mode: 'rehearse', title: 'Rehearse', cards, i: 0, shown: false, done: false, back: `#/lie/${encodeURIComponent(key)}` };
  ctx.go('#/drill/run');
}

export const drill = {
  render(ctx, [sub]) {
    if (sub === 'run') return runView(ctx);
    const t = ctx.today();
    if (!ctx.repo.verses().length) return { title: 'Drill', html: '<p class="muted">Import verses first (Today screen).</p>' };
    ensureWeekUnits(ctx.repo, t);
    const u = todayUnits(ctx.repo, t);
    const all = queuedUnits(ctx.repo).filter((x) => !x.needsText);
    const mem = u.memorize.filter((x) => !x.needsText);
    const btn = (mode, label, n, primary) => `<button class="btn block ${primary ? 'primary' : ''}" data-act="drill.start" data-mode="${mode}" ${n ? '' : 'disabled'}>${label} (${n})</button>`;
    return { title: 'Drill', html: `<p class="muted">Each card: recall the verse, show the answer, then grade yourself Missed, Hard, Good or Easy.</p>
      <div class="stack">${btn('memorize', 'Memorize: this week', mem.length, true)}${btn('review', 'Review: due today', u.review.length, true)}${btn('practice', 'Practice: everything in my queue', all.length, false)}</div>
      <h2>Stages</h2><ol class="small">${STAGES.map((s, i) => `<li>${esc(s.name)}${s.ratio ? ` (${Math.round(s.ratio * 100)}%)` : ''}: ${esc(s.note)}</li>`).join('')}</ol>
      ${u.needText.length ? `<div class="card warn small">${plural(u.needText.length, 'queued verse')} need text first: ${u.needText.map((x) => `<a href="#/verse/${encodeURIComponent(x.ids[0])}/edit">${esc(x.label)}</a>`).join(', ')}.</div>` : ''}` };
  },
};

function runView(ctx) {
  if (!session) return { title: 'Drill', html: '<p>No drill in progress.</p><a class="btn primary block" href="#/drill">Back to Drill</a>' };
  const s = session;
  if (s.done) {
    const t = s.tally;
    return { title: s.title, html: `<div class="card good"><h2 style="margin-top:0">Done</h2>
      ${s.mode === 'rehearse' ? `<p>You rehearsed ${plural(s.cards.length, 'verse')}.</p>` : `<p>${plural(s.cards.length, 'card')}: ${GRADES.map((g) => `${t[g]} ${GRADE_LABELS[g].toLowerCase()}`).join(', ')}.</p>`}
      <a class="btn primary block" href="${s.back}">Finish</a></div>` };
  }
  const c = s.cards[s.i];
  const head = `<div class="row"><span class="grow muted">Card ${s.i + 1} of ${s.cards.length}</span><button class="btn" data-act="drill.exit">Exit</button></div>`;
  if (c.rehearse) {
    const v = c.verse;
    const front = `<div class="card"><div class="small muted">Thought</div><p class="prompt">${esc(c.lie.thought)}</p><div class="small muted">Say the truth, then the verse:</div><p class="prompt">${esc(v.reference)}</p></div>`;
    const back = `<div class="card good"><div class="small muted">Truth to say</div><p class="bigtext"><strong>${esc(c.lie.truth)}</strong></p>
      <p class="bigtext">${v.text ? esc(v.text) : '<span class="tag warn">needs text</span>'}</p><p class="muted">${esc(v.handle)}</p></div>`;
    return { title: 'Rehearse', html: `${head}${front}${s.shown ? back : ''}
      ${s.shown ? `<div class="grid2"><button class="btn" data-act="drill.prev" ${s.i ? '' : 'disabled'}>Back</button><button class="btn primary" data-act="drill.next">${s.i + 1 === s.cards.length ? 'Finish' : 'Next'}</button></div>`
        : `<button class="btn primary block" data-act="drill.show">Show verse</button>`}` };
  }
  const u = c.unit, stage = u.p.stage || 0;
  const prompt = c.front === 'thought'
    ? `<div class="small muted">Thought. Say the truth and the verse.</div><p class="prompt">${esc(c.thought.thought)}</p>`
    : `<div class="small muted">Reference</div><p class="prompt">${esc(u.label)}</p>`;
  let hint = '';
  if (!s.shown) {
    const toks = hintTokens(u.text, stage, `${u.key}|${ctx.today()}|${u.p.cards || 0}`);
    hint = stage >= 4 ? '<p class="muted">Recall the whole verse.</p>'
      : `<p class="hint">${toks.map((t) => (t.hidden ? `<span class="blank" aria-label="hidden word">${esc(t.text)}</span>` : esc(t.text))).join(' ')}</p>${stage === 0 ? '<p class="muted">Read it aloud.</p>' : ''}`;
  }
  const front = `<div class="card"><div class="small muted">${esc(stageLabel(stage))}</div>${prompt}${hint}</div>`;
  const t = ctx.today();
  const back = `<div class="card soft"><div class="small muted">${esc(u.label)}</div><p class="bigtext">${esc(u.text)}</p><p class="muted">${esc(u.handle)}</p>
    ${c.front === 'thought' ? `<div class="small muted">Truth to say</div><p><strong>${esc(c.thought.truth)}</strong></p>` : ''}</div>
    <div class="grid4">${GRADES.map((g) => { const d = previewDays(u.p, g, t); return `<button class="btn ${g === 'good' ? 'primary' : ''}" data-act="drill.grade" data-g="${g}">${GRADE_LABELS[g]}${d ? `<br><span class="small">${d}d</span>` : ''}</button>`; }).join('')}</div>`;
  return { title: s.title, html: `${head}${front}${s.shown ? back : '<button class="btn primary block" data-act="drill.show">Show answer</button>'}` };
}

actions['drill.start'] = (el, ctx) => startSession(ctx, el.dataset.mode);
actions['drill.show'] = (el, ctx) => { session.shown = true; ctx.rerender(false); };
actions['drill.exit'] = (el, ctx) => { const b = session?.back || '#/drill'; session = null; ctx.go(b); };
actions['drill.prev'] = (el, ctx) => { session.i = Math.max(0, session.i - 1); session.shown = false; ctx.rerender(false); };
actions['drill.next'] = (el, ctx) => advance(ctx);
actions['drill.grade'] = (el, ctx) => {
  const s = session, c = s.cards[s.i], g = el.dataset.g;
  gradeUnit(ctx.repo, c.unit, g, ctx.today());
  s.tally[g]++;
  advance(ctx);
};
function advance(ctx) {
  const s = session;
  s.i++; s.shown = false;
  if (s.i >= s.cards.length) {
    s.done = true;
    if (s.mode === 'memorize' || s.mode === 'review') {
      const d = ensureDaily(ctx.repo, ctx.today());
      if (s.mode === 'memorize') d.memDone = true; else d.reviewDone = true;
      saveDaily(ctx.repo, d);
    }
  }
  ctx.rerender(false);
}
