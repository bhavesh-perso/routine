import { getDay, describeShift, routineDay, dayNum, isoOf } from './schedule.js';
import { getSettings, getLog, setLog, getFirstUse } from './storage.js';
import { sleepWindow, fmt } from './plan.js';
import { addRoute, startRouter } from './router.js';

function nowLocal() { // Mauritius calendar date + minutes since midnight
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Mauritius', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
const ctx = () => { const s = getSettings(), { iso, min } = nowLocal(); return { s, iso, min, rd: routineDay(iso, min, s) }; };
const done = (iso, h, s) => { const l = getLog(iso); return h === 'water' ? l.water >= s.waterRest : l[h]; };
const prev = (iso, n = 1) => isoOf(dayNum(iso) - n);
function streak(rd, h, s) {
  let d = done(rd, h, s) ? rd : prev(rd), n = 0;
  while (n < 365 && done(d, h, s)) { n++; d = prev(d); }
  return n;
}

function today() {
  const { s, iso, min, rd } = ctx(), d = getDay(rd, s), log = getLog(rd);
  const label = d.type === 'off' ? 'Off day' : d.block === 'night' ? 'Night shift' : 'Morning shift';
  const sw = sleepWindow(rd, s);
  const yest = prev(rd), fu = getFirstUse();
  const missed = fu && yest >= fu && ['junk', 'water', 'walk'].some(h => !done(yest, h, s));
  const drowsy = iso !== rd && d.endsNextDay && min >= 420 && min <= 600;
  const pct = Math.min(100, Math.round(log.water / s.waterRest * 100));
  const item = (h, text, extra = '') => h === 'water'
    ? `<li class="item"><div class="check" data-done="${!!done(rd, h, s)}">${text}</div>${extra}</li>`
    : `<li class="item"><button type="button" class="check" data-act="${h}" aria-pressed="${!!done(rd, h, s)}">${text}</button>${done(rd, h, s) ? `<button type="button" class="add" data-act="undo-${h}">Undo</button>` : ''}</li>`;
  const grid = Array.from({ length: 28 }, (_, i) => { const x = prev(rd, 27 - i); const c = ['junk', 'water', 'walk'].filter(h => done(x, h, s)).length; return `<i class="c${c}" title="${x}"></i>`; }).join('');
  return `
  <header class="hero ${d.type === 'off' ? 'off' : d.block}">
    <h1>${label}</h1>
    <p>${describeShift(rd, s)}</p>
    <p>Sleep ${fmt(sw.start)}–${fmt(sw.end)} · wake ${fmt(sw.end)}</p>
    ${d.override ? `<p class="mark">Changed from your usual pattern</p>` : ''}
  </header>
  ${drowsy ? `<p class="note">If you feel sleepy, pull over somewhere safe and nap 15–20 min.</p>` : ''}
  ${missed ? `<p class="note">Missed yesterday, so today counts.</p>` : ''}
  <section aria-labelledby="cl"><h2 id="cl">Today's checklist</h2>
  <ul class="list">
    ${item('junk', 'No junk food today')}
    ${item('water', `Drink water: ${log.water} / ${s.waterRest} ml`, `<button type="button" class="add" data-act="water+" aria-label="Add 250 ml">+250 ml</button><button type="button" class="add" data-act="water-" aria-label="Remove 250 ml">−</button>`)}
    ${item('walk', '10-minute walk')}
  </ul><div class="bar" role="progressbar" aria-label="Water" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><b style="width:${pct}%"></b></div></section>
  <section aria-labelledby="st"><h2 id="st">Streaks</h2>
  <p class="streaks">No junk ${streak(rd, 'junk', s)} · Water ${streak(rd, 'water', s)} · Walk ${streak(rd, 'walk', s)} days</p>
  <div class="grid" aria-label="Last 28 days, darker means more habits done">${grid}</div></section><p class="streaks">Build 2.4</p>`;
}

const later = n => () => `<section><h1 class="plain">Coming in step ${n}</h1><p class="note">Nothing to do here yet. Use Today for now.</p></section>`;
addRoute('today', today);
['week:2', 'gym:3', 'food:4', 'progress:6', 'settings:7'].forEach(x => { const [k, n] = x.split(':'); addRoute(k, later(n)); });

const main = document.getElementById('main');
const rerender = startRouter(main, [...document.querySelectorAll('nav a')]);
main.addEventListener('click', e => {
  const act = e.target.closest?.('[data-act]')?.dataset.act; if (!act) return;
  try {
    const { s, rd } = ctx(), l = getLog(rd);
    const name = { junk: 'No junk food today', walk: '10-minute walk' };
    if ((act === 'junk' || act === 'walk') && !l[act] && confirm(`Mark "${name[act]}" as done?`)) setLog(rd, { [act]: true });
    if (act.startsWith('undo-') && confirm('Undo this item?')) setLog(rd, { [act.slice(5)]: false });
    if (act === 'water') setLog(rd, { water: l.water >= s.waterRest ? 0 : s.waterRest });
    if (act === 'water+') setLog(rd, { water: l.water + 250 });
    if (act === 'water-') setLog(rd, { water: Math.max(0, l.water - 250) });
    rerender();
  } catch (err) {
    alert('Tap failed: ' + err.message);
  }
});
setInterval(() => { if (!location.hash || location.hash === '#/today') rerender(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) rerender(); });
