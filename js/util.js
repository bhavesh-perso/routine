// Small shared helpers. Dates are 'YYYY-MM-DD' strings, times of day are minutes since midnight.
import { dayNum, isoOf } from './schedule.js';
export { dayNum, isoOf };

export const toMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
export const fmt = m => { m = ((Math.round(m) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
export const addDays = (iso, n) => isoOf(dayNum(iso) + n);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dow = iso => (dayNum(iso) + 4) % 7; // 0 = Sunday (1970-01-01 was a Thursday)
export const dowName = iso => DOW[dow(iso)];
export const mondayOf = iso => addDays(iso, -((dow(iso) + 6) % 7)); // weeks start Monday
export const dayLabel = iso => `${DOW[dow(iso)]} ${+iso.slice(8)} ${MON[+iso.slice(5, 7) - 1]}`; // "Wed 28 Oct"
export const monthLabel = iso => `${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

// Current Mauritius calendar date and minutes since midnight (UTC+4, no DST).
export function nowLocal(ms = Date.now()) {
  const t = ms + 4 * 3600e3, n = Math.floor(t / 864e5);
  return { iso: isoOf(n), min: Math.floor((t - n * 864e5) / 60e3), ms };
}
export const round1 = x => Math.round(x * 10) / 10;
