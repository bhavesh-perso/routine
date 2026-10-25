// Day-timeline generator. Step 2 only needs the sleep window; blocks come in later steps.
import { getDay, wakeMinutes } from './schedule.js';
const SLEEP_START = { nightWork: 495, nightOff: 540, morningWork: 1305, morningOff: 1395 }; // 08:15, 09:00, 21:45, 23:15
export const fmt = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// The sleep window that ends at this routine day's wake time.
export function sleepWindow(iso, s) {
  const d = getDay(iso, s);
  const key = d.block + (d.type === 'work' ? 'Work' : 'Off');
  return { start: SLEEP_START[key], end: wakeMinutes(iso, s) };
}
