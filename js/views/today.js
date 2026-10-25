import { esc, actions, changes, plural, toast } from '../ui.js';
import { getPlan, ensureDaily, saveDaily, tickRead, tickMakeup, ensureWeekUnits, todayUnits, streakNow, sliceVerses, splitFor,
  planComplete, getSettings, makeupSlice } from '../domain.js';
import { stageLabel } from '../srs.js';
import { WEEK_TITLES } from '../plan.js';

const verseRow = (v) => `<a class="verse" href="#/verse/${encodeURIComponent(v.id)}">
  <span class="ref">${esc(v.reference)}</span>${v.starred ? ' <span class="tag good" title="Starred">★</span>' : ''}${v.text ? '' : ' <span class="tag warn">needs text</span>'}
  <div class="handle">${esc(v.handle)}</div>${v.text ? `<div class="vtext">${esc(v.text)}</div>` : ''}</a>`;

const check = (part, on, label) => `<button class="check" role="checkbox" aria-checked="${on}" aria-label="${esc(label)}" data-act="today.tick" data-part="${part}">${on ? '✓' : ''}</button>`;

export function emptyState() {
  return `<div class="card"><h2 style="margin-top:0">Welcome</h2>
    <p>No verses yet. Import your CSV, or try the app with 20 sample verses first.</p>
    <div class="stack"><button class="btn primary block" data-act="settings.replaceVerses">Import my verses CSV</button>
    <button class="btn block" data-act="settings.loadSample">Load 20 sample verses</button>
    <button class="btn block" data-act="settings.template">Download CSV template</button></div></div>`;
}

export const today = {
  render(ctx) {
    const { repo } = ctx;
    const t = ctx.today();
    if (!repo.verses().length) return { title: 'Today', html: emptyState() };
    ensureWeekUnits(repo, t);
    const plan = getPlan(repo);
    const d = ensureDaily(repo, t);
    const st = streakNow(repo, t);
    const settings = getSettings(repo);
    const units = todayUnits(repo, t);
    const slice = d.readDone ? d.readIds.map((id) => repo.verse(id)).filter(Boolean) : sliceVerses(repo, plan, d.slice);
    const sw = d.slice.week, n = splitFor(plan, sw);

    let html = '';
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (settings.reminder.enabled && !d.readDone && hhmm >= settings.reminder.time) {
      html += `<div class="card warn">Reminder: today's Read isn't ticked yet.</div>`;
    }

    // header
    html += `<div class="card soft"><div class="row"><div class="grow">
      <div class="small muted">Plan</div>
      <strong>${planComplete(plan) && !d.readDone ? 'Plan complete' : `Week ${sw} · Day ${d.slice.day + 1} of ${n}`}</strong>
      ${WEEK_TITLES[sw] ? `<div class="small muted">${esc(WEEK_TITLES[sw])}</div>` : ''}</div>
      <div style="text-align:right"><div class="small muted">Streak</div><strong>${plural(st.current, 'day')}</strong>
      <div class="small muted">Best ${st.longest}</div></div></div>
      ${st.atRisk ? `<p class="small" style="margin-bottom:0"><strong>You missed a day.</strong> Tick Read and the make-up below today to keep your streak.</p>` : ''}</div>`;

    // Read
    html += `<section class="card"><div class="part-head"><h2>Read</h2>${check('read', d.readDone, 'Read done')}</div>
      <p class="small muted" style="margin-top:.2rem">${planComplete(plan) && !d.readDone ? 'You finished all 12 weeks. Review below, or restart the plan on the Plan screen.' : `${plural(slice.length, 'entry', 'entries')}. The plan moves on when you tick this.`}</p>
      ${slice.length ? slice.map(verseRow).join('') : '<p class="muted">No entries in this slice.</p>'}</section>`;

    // Make-up
    if (st.makeupOffer || d.makeupDone) {
      const mk = makeupSlice(repo, t);
      html += `<section class="card"><div class="part-head"><h2>Make-up</h2>${check('makeup', d.makeupDone, 'Make-up done')}</div>
        <p class="small muted" style="margin-top:.2rem">${d.readDone ? 'You missed a day. Read one extra slice today and your streak carries on (one grace day per week).' : 'Tick Read first, then read this extra slice.'}</p>
        ${mk.map(verseRow).join('')}</section>`;
    }

    // Memorize
    const drillMem = units.memorize.filter((u) => !u.needsText);
    html += `<section class="card"><div class="part-head"><h2>Memorize</h2>${check('mem', d.memDone, 'Memorize done')}</div>
      ${units.memorize.length ? `<ul class="list">${units.memorize.map((u) => `<li><a href="#/verse/${encodeURIComponent(u.ids[0])}" class="li"><span class="grow"><strong>${esc(u.label)}</strong>${u.needsText ? ' <span class="tag warn">needs text</span>' : ''}${u.p.memorized ? ' <span class="tag good">memorized</span>' : ''}<br><span class="small muted">${esc(stageLabel(u.p.stage))}</span></span></a></li>`).join('')}</ul>` : '<p class="muted">Nothing assigned.</p>'}
      <button class="btn primary block" data-act="drill.start" data-mode="memorize" ${drillMem.length ? '' : 'disabled'}>Start memorize (${drillMem.length})</button></section>`;

    // Review
    html += `<section class="card"><div class="part-head"><h2>Review</h2>${check('review', d.reviewDone, 'Review done')}</div>
      <p class="small muted" style="margin-top:.2rem">${units.review.length ? `${units.review.length} due${units.reviewTotalDue > units.review.length ? ` (showing the oldest ${units.review.length} of ${units.reviewTotalDue})` : ''}, oldest first.` : 'Nothing due today.'}</p>
      ${units.review.slice(0, 5).map((u) => `<div class="small"><strong>${esc(u.label)}</strong> <span class="muted">· due ${esc(u.p.due)}</span></div>`).join('')}
      ${units.review.length > 5 ? `<div class="small muted">and ${units.review.length - 5} more</div>` : ''}
      <button class="btn primary block" style="margin-top:.6rem" data-act="drill.start" data-mode="review" ${units.review.length ? '' : 'disabled'}>Start review (${units.review.length})</button></section>`;

    if (units.needText.length) html += `<div class="card warn small">${plural(units.needText.length, 'queued verse')} need text before they can be drilled: ${units.needText.map((u) => `<a href="#/verse/${encodeURIComponent(u.ids[0])}/edit">${esc(u.label)}</a>`).join(', ')}.</div>`;

    // Meditate
    const cands = slice.filter((v) => v.text).sort((a, b) => Number(b.starred) - Number(a.starred));
    if (cands.length) {
      const v = cands[(d.meditate.skip || 0) % cands.length];
      html += `<section class="card"><h2 style="margin-top:0">Meditate</h2>
        <p class="small muted" style="margin-top:0">Say this out loud in the first person.</p>
        <p class="bigtext"><strong>${esc(v.reference)}</strong> ${esc(v.text)}</p>
        <label for="med-note" class="small">One-line note (optional)</label>
        <input type="text" id="med-note" value="${esc(d.meditate.note || '')}" data-change="today.note" data-id="${esc(v.id)}" maxlength="300" placeholder="What stood out?">
        ${cands.length > 1 ? `<button class="btn block" style="margin-top:.6rem" data-act="today.anotherVerse">Another verse</button>` : ''}</section>`;
    }
    return { title: 'Today', html };
  },
};

actions['today.tick'] = (el, ctx) => {
  const t = ctx.today(), part = el.dataset.part, d = ensureDaily(ctx.repo, t);
  if (part === 'read') tickRead(ctx.repo, t, !d.readDone);
  else if (part === 'makeup') {
    if (!d.readDone) return toast('Tick Read first.');
    tickMakeup(ctx.repo, t, !d.makeupDone);
  } else if (part === 'mem') { d.memDone = !d.memDone; saveDaily(ctx.repo, d); }
  else if (part === 'review') { d.reviewDone = !d.reviewDone; saveDaily(ctx.repo, d); }
  ctx.rerender();
};
actions['today.anotherVerse'] = (el, ctx) => {
  const d = ensureDaily(ctx.repo, ctx.today());
  d.meditate.skip = (d.meditate.skip || 0) + 1; d.meditate.note = '';
  saveDaily(ctx.repo, d); ctx.rerender();
};
changes['today.note'] = (el, ctx) => {
  const t = ctx.today(), d = ensureDaily(ctx.repo, t), note = el.value.trim();
  d.meditate.note = note; d.meditate.id = el.dataset.id; saveDaily(ctx.repo, d);
  const p = ctx.repo.getProgress(el.dataset.id), prefix = `${t} · `;
  const lines = String(p.note || '').split('\n').filter((l) => l && !l.startsWith(prefix));
  if (note) lines.push(prefix + note);
  p.note = lines.join('\n'); ctx.repo.saveProgress(p);
  toast('Note saved');
};
