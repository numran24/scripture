import { esc, actions, changes, bar, plural, toast } from '../ui.js';
import { getPlan, splitFor, planComplete, weeksCompleted, setPace, jumpToWeek, restartPlan, ensureDaily } from '../domain.js';
import { TOTAL_WEEKS, PACE_OPTIONS, WEEK_TITLES, MEMORIZE_SEED, weekEntries } from '../plan.js';
import { stats } from '../domain.js';

export const planView = {
  render(ctx) {
    const { repo } = ctx;
    if (!repo.verses().length) return { title: 'Plan', html: '<p class="muted">Import verses first (Today screen).</p>' };
    const plan = getPlan(repo);
    const s = stats(repo);
    let html = `<div class="card soft"><strong>Weeks completed: ${weeksCompleted(plan)} of ${TOTAL_WEEKS}</strong>${bar(weeksCompleted(plan), TOTAL_WEEKS, 'good')}
      <p class="small muted" style="margin-bottom:0">The plan moves on only when you tick Read on a day, so you never fall behind. There are no dates to catch up on.</p></div>`;
    if (planComplete(plan)) html += `<div class="card good"><strong>You finished the plan.</strong><button class="btn block" style="margin-top:.6rem" data-act="plan.restart">Start again from Week 1</button></div>`;
    for (let w = 1; w <= TOTAL_WEEKS; w++) {
      const entries = weekEntries(repo.verses(), w);
      const current = !planComplete(plan) && plan.week === w;
      const done = plan.week > w;
      const n = splitFor(plan, w);
      const wr = s.byWeek[w]?.read || 0;
      html += `<section class="card ${current ? 'soft' : ''}" ${current ? 'aria-current="step"' : ''}>
        <div class="row"><strong class="grow">Week ${w}</strong>${current ? `<span class="tag good">Day ${plan.day + 1} of ${n}</span>` : done ? '<span class="tag good">Done</span>' : '<span class="tag">Upcoming</span>'}</div>
        <div>${esc(WEEK_TITLES[w])}</div>
        <div class="small muted">${plural(entries.length, 'entry', 'entries')} · ${wr} read · memorize: ${esc(MEMORIZE_SEED[w].join(', '))}</div>
        ${entries.length ? bar(wr, entries.length) : ''}
        <div class="row" style="margin-top:.6rem">
          ${w >= plan.week || plan.week > TOTAL_WEEKS ? `<label class="small grow" style="margin:0">Reading days<select data-change="plan.split" data-week="${w}" aria-label="Reading days for week ${w}">${PACE_OPTIONS.map((o) => `<option value="${o}" ${o === n ? 'selected' : ''}>${o} days (about ${Math.round(entries.length / o) || 0} a day)</option>`).join('')}</select></label>` : ''}
          ${current ? '' : `<button class="btn" data-act="plan.jump" data-week="${w}">Go to week ${w}</button>`}
        </div></section>`;
    }
    return { title: 'Plan', html };
  },
};

changes['plan.split'] = (el, ctx) => { setPace(ctx.repo, +el.dataset.week, +el.value); ctx.rerender(); toast('Saved'); };
actions['plan.jump'] = (el, ctx) => {
  const w = +el.dataset.week;
  if (!confirm(`Jump to Week ${w}? Your progress stays; today's Read will show Week ${w}, Day 1.`)) return;
  jumpToWeek(ctx.repo, w); ensureDaily(ctx.repo, ctx.today()); ctx.go('#/today');
};
actions['plan.restart'] = (el, ctx) => {
  if (!confirm('Start the plan again from Week 1? Read marks and memorized verses are kept.')) return;
  restartPlan(ctx.repo); ctx.rerender();
};
