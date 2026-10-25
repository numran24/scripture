import { esc, actions, changes, toast, download, pickFile, fmtWhen, plural } from '../ui.js';
import { getSettings, saveSettings, getPlan, setDefaultPace } from '../domain.js';
import { PACE_OPTIONS } from '../plan.js';
import { parseVerseCSV, planVerseImport, applyVerseImport, parseLieCSV, planLieImport, applyLieImport,
  verseTemplateCSV, lieTemplateCSV, versesToCSV, liesToCSV } from '../importer.js';
import * as reminder from '../reminder.js';

let imp = null;   // import in progress: { kind, fileName, parsed, mode, keepText, ack }
const LIMIT = 100;

// ------------------------------------------------------------------ settings screen
export const settingsView = {
  render(ctx) {
    const { repo, sync } = ctx;
    const s = getSettings(repo), plan = getPlan(repo), meta = repo.getKV('meta', {});
    const vf = meta.verseFile, lf = meta.lieFile, last = repo.lastBackup();
    const fileLine = (f, noun) => f ? `<strong>${esc(f.name)}</strong><br><span class="small muted">Loaded ${esc(fmtWhen(f.loadedAt))} · ${plural(f.total, noun)} now${f.mode === 'replace' ? ' · replaced everything' : ''}</span>` : '<span class="muted">Nothing loaded yet</span>';
    const html = `
    <section class="card"><h2 style="margin-top:0">Reminder</h2>
      <label class="inline"><input type="checkbox" data-change="settings.reminderOn" ${s.reminder.enabled ? 'checked' : ''}> Daily reminder</label>
      <label for="rtime">Time</label><input type="time" id="rtime" value="${esc(s.reminder.time)}" data-change="settings.reminderTime">
      <p class="small muted">${esc(reminder.statusText())}</p></section>

    <section class="card"><h2 style="margin-top:0">Appearance and pace</h2>
      <label for="theme">Theme</label><select id="theme" data-change="settings.theme">${['system', 'light', 'dark'].map((t) => `<option value="${t}" ${s.theme === t ? 'selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select>
      <label for="pace">Reading days per week (default)</label><select id="pace" data-change="settings.pace">${PACE_OPTIONS.map((n) => `<option value="${n}" ${plan.pace === n ? 'selected' : ''}>${n} days</option>`).join('')}</select>
      <p class="small muted">You can also set this per week on the Plan screen.</p></section>

    <section class="card"><h2 style="margin-top:0">Data</h2>
      <div class="stack">
        <div><div class="small muted">Verse data</div>${fileLine(vf, 'verse')}</div>
        <button class="btn primary block" data-act="settings.replaceVerses">Replace verse data</button>
        <div><div class="small muted">Lie-to-Truth data</div>${fileLine(lf, 'thought')}</div>
        <button class="btn block" data-act="settings.replaceLie">Replace Lie-to-Truth data</button>
        <button class="btn block" data-act="settings.undo" ${last ? '' : 'disabled'}>Undo last import</button>
        <p class="small muted" style="margin:0">${last ? `Undo restores the verse or Lie-to-Truth data from ${esc(fmtWhen(last.takenAt))} (${esc(last.label)}). Your progress is never changed by imports. A backup is saved automatically before every import.` : 'A backup is saved automatically before every import, and you can undo it here.'}</p>
      </div>
      <h3>Templates</h3><div class="grid2"><button class="btn" data-act="settings.template">Verses CSV</button><button class="btn" data-act="settings.templateLie">Lie-to-Truth CSV</button></div>
      <h3>Backup and export</h3>
      <div class="stack"><button class="btn block" data-act="settings.exportJson">Full backup (JSON)</button>
        <div class="grid2"><button class="btn" data-act="settings.exportCsv">Verses (CSV)</button><button class="btn" data-act="settings.exportLieCsv">Lie-to-Truth (CSV)</button></div>
        <button class="btn block" data-act="settings.restoreJson">Restore from backup file</button></div></section>

    <section class="card"><h2 style="margin-top:0">Sync and account</h2>${syncBlock(ctx)}</section>
    <p class="small muted">All data is stored on this device first and works offline.</p>`;
    return { title: 'Settings', html, back: '#/today' };
  },
};

function syncBlock(ctx) {
  const { sync } = ctx;
  const last = sync.lastSync();
  if (sync.signedIn()) {
    return `<p>Signed in as <strong>${esc(sync.email() || 'your account')}</strong>.</p>
      <p class="small muted" id="sync-status">${esc(sync.status || (last ? `Last synced ${fmtWhen(last)}.` : 'Not synced yet.'))}</p>
      <div class="grid2"><button class="btn primary" data-act="sync.now">Sync now</button><button class="btn danger" data-act="sync.out">Sign out</button></div>`;
  }
  return `<p class="small muted">Optional. Sign in with an email link to keep your devices in step. Without it, everything still works on this device.</p>
    ${sync.configured() ? '' : '<p class="small"><strong>Set up first:</strong> enter your Supabase project URL and anon key (see the README).</p>'}
    <details ${sync.configured() ? '' : 'open'}><summary>Backend settings</summary>
      <label for="sburl">Supabase URL</label><input type="url" id="sburl" value="${esc(sync.url())}" placeholder="https://xxxx.supabase.co" data-change="sync.cfg" autocomplete="off">
      <label for="sbkey">Supabase anon key</label><input type="text" id="sbkey" value="${esc(sync.key())}" data-change="sync.cfg" autocomplete="off"></details>
    <label for="semail">Email</label><input type="email" id="semail" value="${esc(sync.email())}" autocomplete="email" placeholder="you@example.com">
    <button class="btn primary block" style="margin-top:.6rem" data-act="sync.link">Email me a sign-in link</button>
    <p class="small muted" id="sync-status">${esc(sync.status)}</p>`;
}

changes['settings.theme'] = (el, ctx) => {
  const s = getSettings(ctx.repo); s.theme = el.value; saveSettings(ctx.repo, s);
  ctx.applyTheme(el.value);
};
changes['settings.pace'] = (el, ctx) => { setDefaultPace(ctx.repo, +el.value); toast('Saved'); };
changes['settings.reminderTime'] = (el, ctx) => {
  const s = getSettings(ctx.repo); s.reminder.time = el.value || '20:00'; saveSettings(ctx.repo, s); reminder.pushState(ctx.repo, ctx.today()); toast('Saved');
};
changes['settings.reminderOn'] = async (el, ctx) => {
  const s = getSettings(ctx.repo);
  s.reminder.enabled = el.checked;
  if (el.checked) {
    const p = await reminder.enable();
    if (p === 'denied') toast('Notifications are blocked. The Today banner still works.', 4000);
    else if (p === 'unsupported') toast('Notifications are not supported here. The Today banner still works.', 4000);
  }
  saveSettings(ctx.repo, s); reminder.pushState(ctx.repo, ctx.today()); ctx.rerender();
};
changes['sync.cfg'] = (el, ctx) => {
  ctx.sync.saveSettings({ url: document.getElementById('sburl').value, key: document.getElementById('sbkey').value });
};

// ------------------------------------------------------------------ data actions
async function chooseCSV(ctx, kind) {
  const f = await pickFile('.csv,text/csv,text/plain');
  if (!f) return;
  const parsed = kind === 'verses' ? parseVerseCSV(f.text) : parseLieCSV(f.text);
  imp = { kind, fileName: f.name, parsed, mode: 'update', keepText: true, ack: false };
  ctx.go('#/import');
  ctx.rerender(false);
}
actions['settings.replaceVerses'] = (el, ctx) => chooseCSV(ctx, 'verses');
actions['settings.replaceLie'] = (el, ctx) => chooseCSV(ctx, 'lie');
actions['settings.template'] = () => download('verses_template.csv', verseTemplateCSV(), 'text/csv');
actions['settings.templateLie'] = () => download('lie_to_truth_template.csv', lieTemplateCSV(), 'text/csv');
actions['settings.exportJson'] = (el, ctx) => download(`scripture-backup-${ctx.today()}.json`, JSON.stringify(ctx.repo.exportAll(), null, 1), 'application/json');
actions['settings.exportCsv'] = (el, ctx) => download(`verses-${ctx.today()}.csv`, versesToCSV(ctx.repo.verses()), 'text/csv');
actions['settings.exportLieCsv'] = (el, ctx) => download(`lie_to_truth-${ctx.today()}.csv`, liesToCSV(ctx.repo.lies()), 'text/csv');
actions['settings.restoreJson'] = async (el, ctx) => {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  let json;
  try { json = JSON.parse(f.text); } catch { return toast('That file is not valid JSON.'); }
  if (!confirm(`Restore everything from "${f.name}"? This replaces your current verses, notes and progress. You can undo it right after from Settings.`)) return;
  try { ctx.repo.restoreAll(json); toast('Backup restored. Undo is available in Settings.', 4000); ctx.rerender(); } catch (e) { toast(e.message, 4000); }
};
actions['settings.undo'] = (el, ctx) => {
  const rec = ctx.repo.undoLastImport();
  toast(rec ? `Undone: ${rec.label}` : 'Nothing to undo.', 3500); ctx.rerender();
};
actions['settings.loadSample'] = async (el, ctx) => {
  try {
    const [v, l] = await Promise.all([fetch('sample/verses_sample.csv').then((r) => r.text()), fetch('sample/lie_to_truth_sample.csv').then((r) => r.text())]);
    const vp = parseVerseCSV(v);
    applyVerseImport(ctx.repo, planVerseImport(ctx.repo.verses(), vp), { fileName: 'sample (20 verses)' });
    applyLieImport(ctx.repo, planLieImport(ctx.repo.lies(), parseLieCSV(l), ctx.repo.verses()), { fileName: 'sample Lie-to-Truth' });
    toast('Loaded 20 sample verses.'); ctx.rerender();
  } catch { toast('Could not load the sample (you may be offline before the first load).'); }
};

actions['sync.link'] = async (el, ctx) => {
  const email = document.getElementById('semail').value.trim();
  if (!email) return toast('Enter your email.');
  ctx.sync.saveSettings({ url: document.getElementById('sburl')?.value ?? ctx.sync.url(), key: document.getElementById('sbkey')?.value ?? ctx.sync.key() });
  try { await ctx.sync.sendLink(email); ctx.sync._set('Check your email and open the link on this device.'); document.getElementById('sync-status').textContent = ctx.sync.status; }
  catch (e) { toast(e.message, 4500); }
};
actions['sync.now'] = async (el, ctx) => { await ctx.sync.sync(); ctx.rerender(); };
actions['sync.out'] = (el, ctx) => { if (confirm('Sign out of sync? Your data stays on this device.')) { ctx.sync.signOut(); ctx.rerender(); } };

// ------------------------------------------------------------------ import preview
const planOf = (ctx) => (imp.kind === 'verses'
  ? planVerseImport(ctx.repo.verses(), imp.parsed, { mode: imp.mode, keepTextIfBlank: imp.keepText })
  : planLieImport(ctx.repo.lies(), imp.parsed, ctx.repo.verses(), { mode: imp.mode }));

const list = (items, fn, empty = '') => (items.length ? `<ul class="small" style="padding-left:1.2rem;margin:.3rem 0">${items.slice(0, LIMIT).map(fn).join('')}</ul>${items.length > LIMIT ? `<p class="small muted">and ${items.length - LIMIT} more</p>` : ''}` : empty);

export const importView = {
  render(ctx) {
    if (!imp) return { title: 'Import', html: '<p>No file chosen.</p><a class="btn primary block" href="#/settings">Back to Settings</a>', back: '#/settings' };
    const noun = imp.kind === 'verses' ? 'verse' : 'thought';
    const title = imp.kind === 'verses' ? 'Replace verse data' : 'Replace Lie-to-Truth data';
    if (imp.parsed.fatal) {
      return { title, back: '#/settings', html: `<div class="card bad"><strong>Can't import ${esc(imp.fileName)}</strong><p>${esc(imp.parsed.fatal)}</p></div>
        <div class="grid2"><a class="btn" href="#/settings">Cancel</a><button class="btn primary" data-act="settings.${imp.kind === 'verses' ? 'replaceVerses' : 'replaceLie'}">Choose another file</button></div>` };
    }
    const plan = planOf(ctx), c = plan.counts, replace = imp.mode === 'replace';
    const changesCount = c.added + c.updated + c.removed;
    const disabled = !changesCount || (replace && c.removed > 0 && !imp.ack);
    const label = (x) => (imp.kind === 'verses' ? x.reference : x.thought);
    const html = `<p>File: <strong>${esc(imp.fileName)}</strong></p>
      <div class="card"><table class="diff"><tbody>
        <tr><td>Rows in file</td><td><strong>${c.rows}</strong></td></tr>
        <tr><td>Added</td><td><strong>${c.added}</strong></td></tr>
        <tr><td>Updated</td><td><strong>${c.updated}</strong></td></tr>
        <tr><td>Unchanged</td><td><strong>${c.unchanged}</strong></td></tr>
        <tr><td>${replace ? 'Removed (missing from file)' : 'Missing from file (left untouched)'}</td><td><strong>${replace ? c.removed : c.missing}</strong></td></tr>
        <tr><td>Errors (rows skipped)</td><td><strong style="color:var(--${c.errors ? 'bad' : 'fg'})">${c.errors}</strong></td></tr>
        <tr><td>Warnings</td><td><strong>${c.warnings}</strong></td></tr></tbody></table>
        ${imp.kind === 'verses' && plan.byReference ? `<p class="small muted">${plural(plan.byReference, 'row')} matched by reference because the id was missing or different. They keep their existing id, so progress carries over.</p>` : ''}
        ${imp.kind === 'verses' && plan.needsText ? `<p class="small muted">${plural(plan.needsText, 'verse')} will have no text and be flagged "needs text".</p>` : ''}</div>

      <h3>Mode</h3>
      <label class="inline"><input type="radio" name="mode" value="update" data-change="imp.mode" ${replace ? '' : 'checked'}><span><strong>Update matching ${noun}s</strong> (default)<br><span class="small muted">Adds new ones, updates matching ones, leaves ${noun}s that aren't in the file untouched.</span></span></label>
      <label class="inline"><input type="radio" name="mode" value="replace" data-change="imp.mode" ${replace ? 'checked' : ''}><span><strong>Replace everything</strong><br><span class="small muted">Also removes ${noun}s that aren't in the file.</span></span></label>
      ${replace && c.removed > 0 ? `<div class="card bad"><strong>Warning: ${plural(c.removed, noun)} will be removed from your list.</strong>
        <p class="small">${imp.kind === 'verses' ? 'Your progress and notes on them are kept and reattach if they come back, but they disappear from Browse, the plan and drills.' : 'They will disappear from the Lie-to-Truth list.'} You can undo this right after.</p>
        <label class="inline"><input type="checkbox" data-change="imp.ack" ${imp.ack ? 'checked' : ''}> I understand</label></div>` : ''}
      ${imp.kind === 'verses' ? `<label class="inline"><input type="checkbox" data-change="imp.keep" ${imp.keepText ? 'checked' : ''}><span>Keep my existing text when the file's text is blank</span></label>` : ''}
      <p class="small muted">${imp.kind === 'verses' ? 'Memorized status, review schedule, streak, notes and plan position are stored by verse id and are not changed.' : 'Thoughts are matched by their text.'} A backup is made automatically before applying.</p>

      <details ${c.errors ? 'open' : ''}><summary>Errors (${c.errors})</summary>${list(plan.errors, (e) => `<li>Row ${e.line}: ${esc(e.msg)}</li>`, '<p class="small muted">None.</p>')}</details>
      <details><summary>Warnings (${c.warnings})</summary>${list(plan.warnings, (e) => `<li>${e.line ? `Row ${e.line}: ` : ''}${esc(e.msg)}</li>`, '<p class="small muted">None.</p>')}</details>
      <details><summary>Added (${c.added})</summary>${list(plan.added, (x) => `<li>${esc(label(x.row))}</li>`, '<p class="small muted">None.</p>')}</details>
      <details><summary>Updated (${c.updated})</summary>${list(plan.updated, (x) => `<li>${esc(label(x.after))} <span class="muted">(${esc(x.changes.join(', '))})</span></li>`, '<p class="small muted">None.</p>')}</details>
      <details><summary>${replace ? 'Removed' : 'Missing from file'} (${replace ? c.removed : c.missing})</summary>${list(replace ? plan.removed : plan.missing, (x) => `<li>${esc(label(x))}</li>`, '<p class="small muted">None.</p>')}</details>

      <div class="grid2" style="margin-top:1rem"><button class="btn" data-act="imp.cancel">Cancel</button>
        <button class="btn primary" data-act="imp.apply" ${disabled ? 'disabled' : ''}>${changesCount ? 'Apply import' : 'Nothing to change'}</button></div>`;
    return { title, html, back: '#/settings' };
  },
};
changes['imp.mode'] = (el, ctx) => { imp.mode = el.value; imp.ack = false; ctx.rerender(); };
changes['imp.keep'] = (el, ctx) => { imp.keepText = el.checked; ctx.rerender(); };
changes['imp.ack'] = (el, ctx) => { imp.ack = el.checked; ctx.rerender(); };
actions['imp.cancel'] = (el, ctx) => { imp = null; ctx.go('#/settings'); };
actions['imp.apply'] = (el, ctx) => {
  if (!imp) return;
  const first = !ctx.repo.verses().length;
  const plan = planOf(ctx);
  if (imp.kind === 'verses') applyVerseImport(ctx.repo, plan, { fileName: imp.fileName });
  else applyLieImport(ctx.repo, plan, { fileName: imp.fileName });
  const c = plan.counts;
  imp = null;
  toast(`Imported: ${c.added} added, ${c.updated} updated${c.removed ? `, ${c.removed} removed` : ''}. Undo is in Settings.`, 4500);
  ctx.go(first ? '#/today' : '#/settings');
};
