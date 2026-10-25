// Small shared helpers: dates, escaping, normalisation, seeded randomness.
export const pad = (n) => String(n).padStart(2, '0');

export function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}
/** Whole days from a to b (b - a). Uses UTC so DST never skews the count. */
export function diffDays(a, b) {
  const A = parseDate(a), B = parseDate(b);
  return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) -
    Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 86400000);
}
/** Monday of the week containing the date. */
export function weekKey(s) {
  const dow = (parseDate(s).getDay() + 6) % 7;
  return addDays(s, -dow);
}
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function normRef(r) {
  return String(r || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}
/** Key used to match Lie-to-Truth thoughts: case, spacing and quote marks ignored. */
export function normKey(s) {
  return String(s || '').replace(/[“”"]/g, '').replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
export const naturalCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** JSON with sorted keys, for comparing objects regardless of key order. */
export function stable(o) {
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
  return JSON.stringify(o);
}
export const clone = (o) => (o === undefined ? undefined : structuredClone(o));
