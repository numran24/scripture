// Offline shell. Bump VERSION when you change any app file so phones pick up the update.
const VERSION = 'v1';
const CACHE = 'scripture-' + VERSION;
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/logic.js', 'js/db.js', 'js/store.js', 'js/sync.js', 'js/ui.js', 'js/config.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'sample/verses_sample20.csv', 'sample/lie_to_truth_sample.csv',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('scripture-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Cache first (fast, offline), refresh in the background for next time. Never touch API calls.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }));
});

/* ---- reminders (background, where the browser allows periodic sync) ---- */
function idb() {
  return new Promise((res, rej) => { const r = indexedDB.open('scripture'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
const get = (db, store, key) => new Promise((res) => { const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
const put = (db, store, val) => new Promise((res) => { const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(val); t.oncomplete = res; t.onerror = res; });
const pad = (n) => String(n).padStart(2, '0');

async function maybeRemind() {
  try {
    const db = await idb();
    const rem = (await get(db, 'kv', 'reminder'))?.v;
    if (!rem || !rem.on) return;
    const d = new Date(), today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const [hh, mm] = (rem.time || '07:00').split(':').map(Number);
    if (rem.lastShown === today || d < new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm)) return;
    const lg = (await get(db, 'records', 'log:' + today))?.data;
    if (lg && lg.slices && lg.slices.some((s) => s.done)) return;
    await self.registration.showNotification('Scripture', { body: "Time for today's reading.", tag: 'daily', icon: 'icons/icon-192.png' });
    await put(db, 'kv', { k: 'reminder', v: { ...rem, lastShown: today } });
  } catch (e) { /* ignore */ }
}
self.addEventListener('periodicsync', (e) => { if (e.tag === 'daily-reminder') e.waitUntil(maybeRemind()); });
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow('./#/today'))));
});
