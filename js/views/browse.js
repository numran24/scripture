import { esc, actions, changes, plural, toast } from '../ui.js';
import { RINGS } from '../importer.js';
import { TOTAL_WEEKS } from '../plan.js';
import { queueVerse, thoughtsFor, buildUnit } from '../domain.js';
import { stageLabel } from '../srs.js';
import { normRef } from '../util.js';

const filt = { q: '', starred: false, memorized: false };
const enc = encodeURIComponent;

const tags = (v, p) => [
  v.starred ? '<span class="tag good" title="Starred">★</span>' : '',
  p?.memorized ? '<span class="tag good">memorized</span>' : '',
  p?.queued && !p?.memorized ? '<span class="tag">in queue</span>' : '',
  v.text ? '' : '<span class="tag warn">needs text</span>',
].filter(Boolean).join(' ');

function matches(v, p) {
  if (filt.starred && !v.starred) return false;
  if (filt.memorized && !p?.memorized) return false;
  const q = filt.q.trim().toLowerCase();
  return !q || `${v.reference} ${v.handle} ${v.text} ${v.group} ${v.ring} ${v.theme}`.toLowerCase().includes(q);
}
const filtering = () => !!(filt.q.trim() || filt.starred || filt.memorized);

function verseItems(ctx, list) {
  const prog = new Map(ctx.repo.allProgress().map((p) => [p.id, p]));
  const rows = list.filter((v) => matches(v, prog.get(v.id)));
  if (!rows.length) return '<p class="muted">No verses match.</p>';
  return `<p class="small muted">${plural(rows.length, 'verse')}</p>` + rows.slice(0, 300).map((v) => `<a class="verse" href="#/verse/${enc(v.id)}">
    <span class="ref">${esc(v.reference)}</span> ${tags(v, prog.get(v.id))}<div class="handle">${esc(v.handle)}</div></a>`).join('')
    + (rows.length > 300 ? '<p class="muted small">Showing the first 300. Narrow the search.</p>' : '');
}

function results(ctx, ring, group) {
  const all = ctx.repo.verses().filter((v) => (!ring || v.ring === ring) && (!group || v.group === group));
  if (group || filtering()) return verseItems(ctx, all);
  const prog = new Map(ctx.repo.allProgress().map((p) => [p.id, p]));
  if (!ring) {
    const rings = [...new Set([...RINGS, ...ctx.repo.verses().map((v) => v.ring)])].filter(Boolean);
    return `<ul class="list">${rings.map((r) => {
      const vs = ctx.repo.verses().filter((v) => v.ring === r);
      if (!vs.length) return '';
      const mem = vs.filter((v) => prog.get(v.id)?.memorized).length;
      return `<li><a href="#/browse/${enc(r)}"><span class="grow"><strong>${esc(r)}</strong><br><span class="small muted">${plural(vs.length, 'entry', 'entries')}${mem ? ` · ${mem} memorized` : ''}</span></span><span class="chev"></span></a></li>`;
    }).join('')}</ul>`;
  }
  const groups = [];
  for (const v of all) if (!groups.includes(v.group)) groups.push(v.group);
  return `<ul class="list">${groups.map((g) => {
    const vs = all.filter((v) => v.group === g);
    return `<li><a href="#/browse/${enc(ring)}/${enc(g)}"><span class="grow"><strong>${esc(g || '(no group)')}</strong><br><span class="small muted">${plural(vs.length, 'entry', 'entries')}</span></span><span class="chev"></span></a></li>`;
  }).join('')}</ul>`;
}

export const browse = {
  render(ctx, [ring, group]) {
    if (!ctx.repo.verses().length) return { title: 'Browse', html: '<p class="muted">Import verses first (Today screen).</p>' };
    const crumbs = ring ? `<p class="small"><a href="#/browse">All rings</a>${group ? ` › <a href="#/browse/${enc(ring)}">${esc(ring)}</a>` : ''}</p>` : '';
    const html = `${crumbs}
      <label class="sr" for="bq">Search</label>
      <input type="search" id="bq" value="${esc(filt.q)}" placeholder="Search reference, handle or text" data-change="browse.q" data-ring="${esc(ring || '')}" data-group="${esc(group || '')}" autocomplete="off">
      <div class="filters"><button class="chip" aria-pressed="${filt.starred}" data-act="browse.filter" data-f="starred">★ Starred</button>
      <button class="chip" aria-pressed="${filt.memorized}" data-act="browse.filter" data-f="memorized">Memorized</button></div>
      <div id="results">${results(ctx, ring, group)}</div>`;
    return { title: group || ring || 'Browse', html, back: group ? `#/browse/${enc(ring)}` : ring ? '#/browse' : null };
  },
};
changes['browse.q'] = (el, ctx) => {
  filt.q = el.value;
  document.getElementById('results').innerHTML = results(ctx, el.dataset.ring, el.dataset.group);
};
actions['browse.filter'] = (el, ctx) => { filt[el.dataset.f] = !filt[el.dataset.f]; ctx.rerender(); };

// ------------------------------------------------------------ verse detail
export const verseView = {
  render(ctx, [id, sub]) {
    const v = ctx.repo.verse(id);
    if (!v) return { title: 'Verse', html: '<p>That verse is not in your list.</p>', back: '#/browse' };
    if (sub === 'edit') return editView(ctx, v);
    const p = ctx.repo.getProgress(v.id);
    const unit = buildUnit(ctx.repo, { ...p, id: v.id, target: null });
    const th = thoughtsFor(ctx.repo, unit);
    const html = `<div class="small muted">${esc(v.ring)} › ${esc(v.group)}${v.week ? ` · Week ${v.week}` : ''}</div>
      <p class="bigtext" style="margin-top:.4rem"><strong>${esc(v.handle)}</strong></p>
      ${v.text ? `<p class="bigtext">${esc(v.text)}</p>` : `<div class="card warn"><strong>Needs text.</strong> You can read this by reference and handle, but it can't be drilled until text is added.<a class="btn block" style="margin-top:.6rem" href="#/verse/${enc(v.id)}/edit">Add text</a></div>`}
      <div class="card soft stack"><div><strong>Status</strong></div>
        <div>${p.read ? `Read on ${esc(p.read)}` : 'Not read yet'}${v.starred ? ' · ★ starred' : ''}</div>
        <div>${p.queued ? `In memorize queue · ${esc(stageLabel(p.stage))}${p.due ? ` · next review ${esc(p.due)}` : ''}` : 'Not in memorize queue'}${p.memorized ? ' · <strong>memorized</strong>' : ''}</div>
        <button class="btn block ${p.queued ? '' : 'primary'}" data-act="verse.queue" data-id="${esc(v.id)}">${p.queued ? 'Remove from memorize queue' : 'Add to memorize queue'}</button></div>
      ${th.length ? `<h3>Lie-to-Truth</h3><ul class="list">${th.map((l) => `<li><a href="#/lie/${enc(l.key)}"><span class="grow">${esc(l.thought)}<br><span class="small muted">${esc(l.truth)}</span></span><span class="chev"></span></a></li>`).join('')}</ul>` : ''}
      <label for="vnote">Notes</label>
      <textarea id="vnote" data-change="verse.note" data-id="${esc(v.id)}" placeholder="Your notes on this verse">${esc(p.note)}</textarea>
      <div class="row" style="margin-top:.8rem"><a class="btn grow" href="#/verse/${enc(v.id)}/edit">Edit verse</a></div>`;
    return { title: v.reference, html, back: '#/browse' };
  },
};
actions['verse.queue'] = (el, ctx) => {
  const p = ctx.repo.getProgress(el.dataset.id);
  queueVerse(ctx.repo, el.dataset.id, !p.queued, ctx.today());
  toast(p.queued ? 'Removed from queue' : 'Added to memorize queue'); ctx.rerender();
};
changes['verse.note'] = (el, ctx) => { const p = ctx.repo.getProgress(el.dataset.id); p.note = el.value; ctx.repo.saveProgress(p); toast('Note saved'); };

function editView(ctx, v) {
  const rings = [...new Set([...RINGS, v.ring])].filter(Boolean);
  const groups = [...new Set(ctx.repo.verses().map((x) => x.group))].filter(Boolean);
  const html = `<form data-form="verse.save" data-id="${esc(v.id)}" class="stack" autocomplete="off">
    <div><label for="f-text">Verse text</label><textarea id="f-text" name="text" style="min-height:200px" placeholder="Paste the verse text here">${esc(v.text)}</textarea></div>
    <div><label for="f-ref">Reference</label><input type="text" id="f-ref" name="reference" value="${esc(v.reference)}" required></div>
    <div><label for="f-handle">Handle (short summary)</label><textarea id="f-handle" name="handle" style="min-height:80px">${esc(v.handle)}</textarea></div>
    <div><label for="f-ring">Ring</label><select id="f-ring" name="ring">${rings.map((r) => `<option ${r === v.ring ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
    <div><label for="f-group">Group</label><input type="text" id="f-group" name="group" value="${esc(v.group)}" list="groups"><datalist id="groups">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></div>
    <div><label for="f-week">Week</label><select id="f-week" name="week"><option value="0" ${!v.week ? 'selected' : ''}>(none)</option>${Array.from({ length: TOTAL_WEEKS }, (_, i) => `<option ${v.week === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
    <label class="inline"><input type="checkbox" name="starred" ${v.starred ? 'checked' : ''}> Starred (memorize-worthy)</label>
    <div><label for="f-theme">Theme tags (optional)</label><input type="text" id="f-theme" name="theme" value="${esc(v.theme)}"></div>
    <p class="small muted">A later "Replace verse data" import updates these fields from the file. If the file's text is blank, your text is kept.</p>
    <div class="grid2"><a class="btn" href="#/verse/${encodeURIComponent(v.id)}">Cancel</a><button class="btn primary" type="submit">Save</button></div></form>`;
  return { title: 'Edit verse', html, back: `#/verse/${encodeURIComponent(v.id)}` };
}
export const forms = {};
forms['verse.save'] = (form, ctx) => {
  const f = new FormData(form), v = ctx.repo.verse(form.dataset.id);
  if (!v) return;
  const ref = String(f.get('reference')).trim();
  if (!ref) return toast('Reference is required');
  const clash = ctx.repo.verses().find((x) => x.id !== v.id && normRef(x.reference) === normRef(ref));
  if (clash) return toast('Another verse already uses that reference');
  ctx.repo.saveVerse({ ...v, reference: ref, handle: String(f.get('handle')).trim(), ring: String(f.get('ring')), group: String(f.get('group')).trim(),
    week: +f.get('week') || 0, starred: f.get('starred') === 'on', theme: String(f.get('theme')).trim(), text: String(f.get('text')).replace(/\s+/g, ' ').trim() });
  toast('Saved'); ctx.go(`#/verse/${encodeURIComponent(v.id)}`);
};
