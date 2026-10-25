// Daily reminder. Web push needs a server, so this uses what a static app can do and says so in Settings:
//  - a notification when the app is open (or backgrounded) after the reminder time and Read isn't ticked,
//  - Periodic Background Sync where the browser offers it (installed Chrome on Android),
//  - always: a banner on the Today screen.
import { getSettings } from './domain.js';

export function support() {
  const n = 'Notification' in window;
  const sw = 'serviceWorker' in navigator;
  return { notifications: n, permission: n ? Notification.permission : 'unsupported',
    periodic: sw && 'periodicSync' in ServiceWorkerRegistration.prototype,
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    ios: /iphone|ipad|ipod/i.test(navigator.userAgent) };
}
export function statusText() {
  const s = support();
  if (!s.notifications) return 'This browser can\'t show notifications. A reminder banner appears on the Today screen instead.';
  if (s.ios && !s.standalone) return 'On iPhone and iPad, add this app to your Home Screen first, then turn the reminder on. Until then a banner appears on the Today screen.';
  if (s.permission === 'denied') return 'Notifications are blocked in your browser settings. A reminder banner still appears on the Today screen.';
  if (s.periodic && s.permission === 'granted') return 'Notifications show when the app is open. This browser may also deliver them in the background (it decides the exact timing). A banner always appears on Today.';
  return 'Notifications show while the app is open or running in the background. This browser can\'t wake a closed app (that needs a push server, which this app does not use), so a banner on the Today screen is the fallback.';
}
export async function enable() {
  if (!('Notification' in window)) return 'unsupported';
  let p = Notification.permission;
  if (p === 'default') p = await Notification.requestPermission();
  if (p === 'granted') {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) await reg.periodicSync.register('daily-reminder', { minInterval: 12 * 3600 * 1000 });
    } catch { /* optional */ }
  }
  return p;
}
export async function pushState(repo, today) {
  try {
    const s = getSettings(repo), d = repo.getKV('daily');
    const c = await caches.open('scripture-state');
    await c.put('state', new Response(JSON.stringify({ enabled: s.reminder.enabled, time: s.reminder.time,
      doneDate: d && d.date === today && d.readDone ? today : null, notifiedDate: localStorage.getItem('scripture-notified') })));
  } catch { /* cache storage unavailable */ }
}
export async function check(repo, today) {
  try {
    const s = getSettings(repo);
    if (!s.reminder.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    const d = repo.getKV('daily');
    if (d && d.date === today && d.readDone) return;
    const n = new Date(), hhmm = `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
    if (hhmm < s.reminder.time || localStorage.getItem('scripture-notified') === today) return;
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Scripture', { body: "Time for today's reading.", tag: 'daily-reading', icon: 'icons/icon-192.png' });
    localStorage.setItem('scripture-notified', today);
  } catch { /* ignore */ }
}
