import { esc, actions, plural } from '../ui.js';
import { lieVerses } from '../domain.js';
import { startRehearse } from './drill.js';

const enc = encodeURIComponent;

export const lie = {
  render(ctx, [key]) {
    const { repo } = ctx;
    const lies = repo.lies();
    if (!key) {
      if (!lies.length) return { title: 'Lie to Truth', html: `<div class="card"><p>No thoughts yet. Import your Lie-to-Truth CSV in Settings › Data.</p><a class="btn primary block" href="#/settings">Open Settings</a></div>` };
      return { title: 'Lie to Truth', html: `<p class="muted small">Tap a thought to see the truth to say back to it.</p>
        <ul class="list">${lies.map((l) => `<li><a href="#/lie/${enc(l.key)}"><span class="grow">${esc(l.thought)}<br><span class="small muted">${plural(l.refs.length, 'verse')}</span></span><span class="chev"></span></a></li>`).join('')}</ul>` };
    }
    const l = repo.lies().find((x) => x.key === key);
    if (!l) return { title: 'Lie to Truth', html: '<p>That thought is not in your list.</p>', back: '#/lie' };
    const vs = lieVerses(repo, l);
    const html = `<p class="bigtext muted" style="margin-bottom:.2rem">${esc(l.thought)}</p>
      <div class="card good"><div class="small muted">Truth to say</div><p class="bigtext" style="margin:.2rem 0"><strong>${esc(l.truth)}</strong></p></div>
      <button class="btn primary block" data-act="lie.rehearse" data-key="${esc(l.key)}" ${vs.some((x) => x.verse) ? '' : 'disabled'}>Rehearse</button>
      <h2>Verses</h2>
      ${vs.map(({ ref, verse }) => verse ? `<a class="verse" href="#/verse/${enc(verse.id)}"><span class="ref">${esc(verse.reference)}</span>${verse.text ? '' : ' <span class="tag warn">needs text</span>'}<div class="handle">${esc(verse.handle)}</div>${verse.text ? `<div class="vtext">${esc(verse.text)}</div>` : ''}</a>`
        : `<div class="verse"><span class="ref">${esc(ref)}</span> <span class="tag warn">not in verse list</span></div>`).join('') || '<p class="muted">No verses linked.</p>'}`;
    return { title: 'Truth', html, back: '#/lie' };
  },
};
actions['lie.rehearse'] = (el, ctx) => startRehearse(ctx, el.dataset.key);
