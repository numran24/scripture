// Optional cloud sync via Supabase (REST only, no SDK). Last-write-wins per record.
// The app works fully without this; if it is not configured everything stays on the device.
import * as db from './db.js';
import { CONFIG } from './config.js';

const PAGE = 1000, CHUNK = 400;
let timer = null, running = false;
export const status = { state: 'off', msg: 'Not signed in', at: null };
const listeners = new Set();
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setStatus(state, msg) {
  status.state = state; status.msg = msg;
  if (state === 'ok') status.at = Date.now();
  listeners.forEach((f) => f(status));
}

export function cfg() {
  const saved = db.kvGet('syncCfg', {});
  return { url: (CONFIG.supabaseUrl || saved.url || '').replace(/\/+$/, ''), anon: CONFIG.supabaseAnonKey || saved.anon || '' };
}
export function configured() { const c = cfg(); return !!(c.url && c.anon); }
export function session() { return db.kvGet('syncSession', null); }
export function saveCfg(url, anon) { return db.kvSet('syncCfg', { url: url.trim(), anon: anon.trim() }); }

function headers(token) {
  const c = cfg();
  return { apikey: c.anon, Authorization: 'Bearer ' + (token || c.anon), 'Content-Type': 'application/json' };
}

export async function sendMagicLink(email) {
  const c = cfg();
  const redirect = location.origin + location.pathname;
  const r = await fetch(`${c.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ email, create_user: true }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).msg || 'Could not send the link (' + r.status + ')');
}

/** Call once on load: picks up the tokens Supabase puts in the URL hash after the magic link. */
export async function handleRedirect() {
  const h = location.hash;
  if (!/access_token=/.test(h)) return false;
  const p = new URLSearchParams(h.replace(/^#\/?/, ''));
  const access = p.get('access_token'), refresh = p.get('refresh_token');
  history.replaceState(null, '', location.pathname + '#/settings');
  if (!access) return false;
  const u = await fetch(cfg().url + '/auth/v1/user', { headers: headers(access) }).then((r) => r.json()).catch(() => ({}));
  await db.kvSet('syncSession', {
    access, refresh, email: u.email || '', user: u.id || '',
    exp: Date.now() + (+p.get('expires_in') || 3600) * 1000,
  });
  return true;
}

async function token() {
  let s = session();
  if (!s) throw new Error('Not signed in');
  if (Date.now() > s.exp - 60000) {
    const r = await fetch(cfg().url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: headers(), body: JSON.stringify({ refresh_token: s.refresh }),
    });
    if (!r.ok) { await db.kvSet('syncSession', null); throw new Error('Session expired. Sign in again.'); }
    const j = await r.json();
    s = { ...s, access: j.access_token, refresh: j.refresh_token, exp: Date.now() + j.expires_in * 1000 };
    await db.kvSet('syncSession', s);
  }
  return s.access;
}

export async function signOut() {
  await db.kvSet('syncSession', null);
  await db.kvSet('syncLastPull', 0);
  await db.kvSet('syncLastPush', 0);
  setStatus('off', 'Signed out. Your data stays on this device.');
}

export async function syncNow() {
  if (!configured() || !session()) return;
  if (running) return;
  if (!navigator.onLine) { setStatus('offline', 'Offline. Will sync when you are back online.'); return; }
  running = true;
  setStatus('busy', 'Syncing…');
  try {
    const c = cfg(), tk = await token();
    const started = Date.now();
    // 1. pull everything the server stamped after our last pull (server time `s`, so an edit
    //    made offline on another device is never missed). Per record, the newer `u` wins.
    let since = db.kvGet('syncLastPull', 0), pulled = 0;
    for (;;) {
      const r = await fetch(`${c.url}/rest/v1/records?select=kind,key,data,u,d,s&s=gte.${since}&order=s.asc&limit=${PAGE}`, { headers: headers(tk) });
      if (!r.ok) throw new Error('Pull failed (' + r.status + '). Is the table set up? See README.');
      const rows = await r.json();
      const apply = rows.filter((x) => { const l = db.raw(x.kind, x.key); return !l || x.u > l.u; });
      if (apply.length) await db.putRaw(apply.map((x) => ({ kind: x.kind, key: x.key, data: x.data, u: Number(x.u), d: !!x.d })));
      pulled += apply.length;
      const last = rows.length ? Number(rows[rows.length - 1].s) : since;
      if (rows.length < PAGE || last === since) { since = last; break; }
      since = last;
    }
    await db.kvSet('syncLastPull', since);
    // 2. push local records that changed since the last push
    const lastPush = db.kvGet('syncLastPush', 0);
    const dirty = db.allRaw().filter((r) => db.SYNC_KINDS.includes(r.kind) && r.u > lastPush);
    for (let i = 0; i < dirty.length; i += CHUNK) {
      const body = dirty.slice(i, i + CHUNK).map((r) => ({ kind: r.kind, key: r.key, data: r.data, u: r.u, d: !!r.d }));
      const r = await fetch(`${c.url}/rest/v1/records?on_conflict=user_id,kind,key`, {
        method: 'POST', headers: { ...headers(tk), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Push failed (' + r.status + ').');
    }
    await db.kvSet('syncLastPush', started);
    setStatus('ok', `Synced. ${pulled} received, ${dirty.length} sent.`);
  } catch (e) {
    setStatus('error', e.message || String(e));
  } finally {
    running = false;
  }
}

export function scheduleSync(delay = 4000) {
  if (!configured() || !session()) return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, delay);
}

export function init() {
  window.addEventListener('online', () => syncNow());
  db.onChange((kinds) => { if (kinds.some((k) => db.SYNC_KINDS.includes(k))) scheduleSync(); });
  if (session()) setStatus('idle', 'Signed in as ' + session().email);
  else if (configured()) setStatus('off', 'Not signed in');
  else setStatus('off', 'Sync is not set up');
  if (session()) syncNow();
}
