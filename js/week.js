import { getDay, describeShift, dayNum, isoOf } from './schedule.js';
import { getSettings } from './storage.js';
import { sleepWindow, fmt } from './plan.js';
import { sessionFor } from './gym.js';
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let off = 0; // weeks away from the current week

export function weekClick(act) {
  if (act === 'week-prev') off--; else if (act === 'week-next') off++; else if (act === 'week-now') off = 0; else return false;
  return true;
}
export function weekView(rd) {
  const s = getSettings(), n = dayNum(rd), mon = n - ((n + 3) % 7) + off * 7; // week starts Monday
  const rows = DOW.map((name, i) => {
    const iso = isoOf(mon + i), d = getDay(iso, s), sw = sleepWindow(iso, s), g = sessionFor(iso, s);
    const label = d.type === 'off' ? 'Off day' : d.block === 'night' ? 'Night shift' : 'Morning shift';
    return `<li class="day ${d.type === 'off' ? 'off' : d.block} ${iso === rd ? 'now' : ''}">
      <b>${name} ${iso.slice(8)}/${iso.slice(5, 7)} · ${label}</b>
      <span>${describeShift(iso, s)}</span><span>Sleep ${fmt(sw.start)}–${fmt(sw.end)}</span>
      ${g ? `<span>Gym: ${g.kind} · ${g.loc} gym · ${g.time}</span>` : ''}
      ${d.isBlockSwitchDay ? '<span>Sleep-switch day: shift your sleep for the new block</span>' : ''}
      ${d.override ? '<span>Changed from your usual pattern</span>' : ''}</li>`;
  }).join('');
  return `<h1 class="plain">Week</h1>
  <div class="item"><button type="button" class="add" data-act="week-prev" aria-label="Previous week">Prev</button><button type="button" class="add" data-act="week-now" style="flex:1">This week</button><button type="button" class="add" data-act="week-next" aria-label="Next week">Next</button></div>
  <ul class="list" style="margin-top:12px">${rows}</ul>`;
}
