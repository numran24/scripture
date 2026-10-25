import { esc, bar, plural } from '../ui.js';
import { stats, streakNow, readsOf, getPlan, weeksCompleted } from '../domain.js';
import { RINGS } from '../importer.js';
import { TOTAL_WEEKS } from '../plan.js';
import { addDays, weekKey } from '../util.js';

function rows(map, keys, label) {
  return keys.filter((k) => map[k]).map((k) => {
    const b = map[k], denom = Math.max(b.starred, b.memorized);
    return `<div class="barrow"><div class="lbl"><strong>${esc(label(k))}</strong><span class="muted">${b.read}/${b.total} read</span></div>${bar(b.read, b.total)}
      <div class="lbl small muted" style="margin-top:.3rem"><span>Memorized</span><span>${b.memorized}/${denom} starred</span></div>${bar(b.memorized, denom, 'good')}</div>`;
  }).join('');
}

export const progressView = {
  render(ctx) {
    const { repo } = ctx;
    if (!repo.verses().length) return { title: 'Progress', html: '<p class="muted">Import verses first (Today screen).</p>' };
    const t = ctx.today();
    const s = stats(repo), st = streakNow(repo, t), reads = readsOf(repo), plan = getPlan(repo);
    const rings = [...new Set([...RINGS, ...Object.keys(s.byRing)])];
    const start = addDays(weekKey(t), -77);
    let cal = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<b>${d}</b>`).join('');
    for (let i = 0; i < 84; i++) {
      const d = addDays(start, i), r = reads[d];
      cal += `<i class="${r ? (r.makeup ? 'mk' : 'on') : ''} ${d > t ? 'future' : ''}" title="${d}${r ? (r.makeup ? ' (read + make-up)' : ' (read)') : ''}"></i>`;
    }
    const runs = st.runs.slice(-6).reverse();
    const html = `<div class="card soft"><div class="row"><div class="grow"><div class="small muted">Entries read</div><strong>${s.read} of ${s.total}</strong></div>
      <div class="grow"><div class="small muted">Memorized</div><strong>${s.memorized}</strong></div>
      <div class="grow"><div class="small muted">Weeks done</div><strong>${weeksCompleted(plan)} of ${TOTAL_WEEKS}</strong></div></div></div>
      <h2>By ring</h2>${rows(s.byRing, rings, (k) => k)}
      <h2>By week</h2>${rows(s.byWeek, Array.from({ length: TOTAL_WEEKS + 1 }, (_, i) => i), (k) => (k ? `Week ${k}` : 'No week'))}
      <h2>Streak</h2><div class="card"><div class="row"><div class="grow"><div class="small muted">Current</div><strong>${plural(st.current, 'day')}</strong></div><div class="grow"><div class="small muted">Best</div><strong>${plural(st.longest, 'day')}</strong></div></div>
      <p class="small muted">A day counts when you tick Read. Green = read, blue = read plus make-up. One grace day a week.</p>
      <div class="cal" role="img" aria-label="Last 12 weeks of reading days">${cal}</div></div>
      ${runs.length ? `<h3>Recent streaks</h3><table class="diff"><tbody>${runs.map((r) => `<tr><td>${esc(r.start)}${r.end !== r.start ? ' to ' + esc(r.end) : ''}</td><td>${plural(r.length, 'day')}</td></tr>`).join('')}</tbody></table>` : ''}`;
    return { title: 'Progress', html };
  },
};
