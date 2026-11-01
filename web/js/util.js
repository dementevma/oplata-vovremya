export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const rubFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
export const rub = n => { const v = Math.round(n || 0); return (v < 0 ? '−' : '') + rubFmt.format(Math.abs(v)) + ' ₽'; };
export const mln = n => {
  const v = (n || 0) / 1e6;
  return (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1)).replace('.', ',') + ' млн ₽';
};
export const pct = (x, d = 0) => (x * 100).toFixed(d).replace('.', ',') + '%';
// Вероятности модели: на синтетике она переуверена, поэтому крайние значения не выдаём за 0% и 100%.
export const prob = x => x < 0.03 ? '<3%' : x > 0.97 ? '>97%' : pct(x);

export const DAY = 86400000;
export const toDate = s => new Date(s + 'T00:00:00Z');
export const iso = d => d.toISOString().slice(0, 10);
export const addDays = (s, n) => iso(new Date(toDate(s).getTime() + n * DAY));
export const diffDays = (a, b) => Math.round((toDate(a) - toDate(b)) / DAY);
const dFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const dShort = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const dateRu = s => (s ? dFmt.format(toDate(s)) : '');
export const dateShort = s => (s ? dShort.format(toDate(s)).replace('.', '') : '');
// «4–10 ноября», а в разных месяцах — «28 октября – 3 ноября».
export const dateRange = (a, b) => toDate(a).getUTCMonth() === toDate(b).getUTCMonth() ? `${toDate(a).getUTCDate()}–${dateRu(b)}` : `${dateRu(a)} – ${dateRu(b)}`;

export function validDate(value) {
  const s = String(value || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) { const r = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s); if (r) m = [r[0], r[3], r[2], r[1]]; }
  if (!m) return null;
  const v = `${m[1]}-${m[2]}-${m[3]}`;
  const d = toDate(v);
  return !Number.isNaN(d.getTime()) && iso(d) === v ? v : null;
}

export function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
  const s = String(value ?? '').replace(/[\s  ₽]/g, '').replace(/руб\.?/gi, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(Math.round(n * 100)) ? n : null;
}

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export const days = n => `${n} ${plural(n, 'день', 'дня', 'дней')}`;

// Нормальная функция распределения (Abramowitz–Stegun 7.1.26)
export function phi(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

export function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

export function download(name, text, type = 'text/plain;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
