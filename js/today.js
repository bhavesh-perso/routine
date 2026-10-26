// Today screen: day-type header, next block, checklist, module cards, streaks.
import { getDay, describeShift } from './schedule.js';
import { getDayLog, setDayLog, getMeta } from './storage.js';
import { dayPlan, wakeFor, bedFor, switchCard, timeLabel } from './plan.js';
import { fmt, addDays, dayLabel, esc } from './util.js';
import * as gym from './gym.js';
import * as food from './food.js';
import * as study from './study.js';
import * as progress from './progress.js';
import { backupBanner } from './settings.js';

const HABITS = ['junk', 'water', 'walk'];
const safe = (fn, ...a) => { try { return fn(...a) || ''; } catch (e) { return `<p class="note alert">This card failed to load: ${esc(e.message)}</p>`; } };

export const hasGym = (iso, s) => { try { return !!gym.sessionFor(iso, s); } catch { return false; } };
export const waterTarget = (iso, s) => hasGym(iso, s) ? s.water.gym : s.water.rest;
export function habitDone(iso, h, s) {
  const l = getDayLog(iso);
  return h === 'water' ? l.water >= waterTarget(iso, s) : !!l[h];
}
export function streak(rd, h, s) {
  let d = habitDone(rd, h, s) ? rd : addDays(rd, -1), n = 0;
  while (n < 366 && habitDone(d, h, s)) { n++; d = addDays(d, -1); }
  return n;
}
export const dayLabelOf = d => d.type === 'off' ? 'Off day' : d.block === 'night' ? 'Night shift' : 'Morning shift';

// Thin bar across the routine day (wake → next wake): sleep and shift segments, plus a "now" tick.
function dayStrip(rd, ctx, blocks) {
  const s = ctx.s, a = wakeFor(rd, s), b = 1440 + wakeFor(addDays(rd, 1), s), span = b - a;
  const pos = m => Math.max(0, Math.min(100, (m - a) / span * 100)).toFixed(2);
  const seg = (x, y, cls) => `<i class="${cls}" style="left:${pos(x)}%;width:${(pos(y) - pos(x)).toFixed(2)}%"></i>`;
  const shift = blocks.find(x => x.kind === 'shift');
  const now = (ctx.iso === rd ? 0 : 1440) + ctx.min;
  return `<div class="strip" aria-hidden="true">${shift ? seg(shift.start, shift.end, 'sh') : ''}${seg(bedFor(rd, s), b, 'sl')}<i class="now" style="left:${pos(now)}%"></i></div>
  <div class="strip-legend muted"><span>Up ${fmt(a)}</span><span>Next wake ${fmt(b)}</span></div>`;
}

function header(rd, ctx, blocks) {
  const s = ctx.s, d = getDay(rd, s), cls = d.type === 'off' ? 'off' : d.block;
  const bed = bedFor(rd, s), nextWake = wakeFor(addDays(rd, 1), s);
  return `<header class="hero ${cls}">
    <p class="hero-date">${esc(dayLabel(rd))}${d.override ? ' · changed from your usual pattern' : ''}</p>
    <h1>${dayLabelOf(d)}</h1>
    <p class="hero-shift">${esc(describeShift(rd, s))}</p>
    <p>Sleep ${timeLabel(bed)} → ${fmt(nextWake)}</p>
    ${dayStrip(rd, ctx, blocks)}
  </header>`;
}

function nextUp(rd, ctx, blocks) {
  const now = (ctx.iso === rd ? 0 : 1440) + ctx.min;
  const cur = blocks.find(b => b.start <= now && b.end > now && ['shift', 'gym', 'study', 'cook', 'drive'].includes(b.kind));
  const nxt = blocks.find(b => b.start > now && b.kind !== 'sleep') || blocks.find(b => b.start > now);
  if (!nxt && !cur) return '';
  const meals = safeMeals(rd, ctx.s);
  const name = b => b.slot && meals[b.slot]?.name ? `${b.label}: ${esc(meals[b.slot].name)}` : esc(b.label);
  return `<section class="next" aria-labelledby="nx"><h2 id="nx">Next up</h2>
    ${cur ? `<p class="muted">Now: ${name(cur)} until ${timeLabel(cur.end)}</p>` : ''}
    ${nxt ? `<p class="next-main"><span class="num">${timeLabel(nxt.start)}</span> ${name(nxt)}</p>${nxt.tight ? '<p class="muted">Tight day: the work gym slot is short. A shorter session is ready if you need it.</p>' : ''}` : ''}
    <a class="btn small ghost" href="#/day/${rd}">Full day plan</a></section>`;
}
function safeMeals(iso, s) { try { return food.mealsFor(iso, s) || {}; } catch { return {}; } }

function banners(rd, ctx, blocks) {
  const s = ctx.s, out = [], d = getDay(rd, s), yest = addDays(rd, -1), first = getMeta().firstUse;
  out.push(safe(backupBanner, ctx));
  let gymMissed = false; try { gymMissed = gym.missedOn(yest, s); } catch { /* none */ }
  const checklistMissed = first && yest >= first && HABITS.some(h => !habitDone(yest, h, s));
  if (checklistMissed || gymMissed) out.push('<p class="note calm">Missed yesterday, so today counts.</p>');
  const now = (ctx.iso === rd ? 0 : 1440) + ctx.min, drive = blocks.find(b => b.drowsy);
  if (d.endsNextDay && drive && now >= drive.start - 30 && now < bedFor(rd, s)) out.push('<p class="note">If you feel sleepy, pull over somewhere safe and nap 15–20 min.</p>');
  const sc = switchCard(rd, s);
  if (sc) out.push(`<section class="note switch" aria-labelledby="swc"><h2 id="swc">Sleep switch: ${sc.to === 'morning' ? 'nights to mornings' : 'mornings to nights'}</h2>
    <ul class="rules">${sc.rows.map(r => `<li${r.date === rd ? ' class="today"' : ''}><b>${esc(dayLabel(r.date))}</b><br>${esc(r.text)}</li>`).join('')}</ul></section>`);
  return out.join('');
}

function checklist(rd, ctx) {
  const s = ctx.s, log = getDayLog(rd), wt = waterTarget(rd, s), pct = Math.min(100, Math.round(log.water / wt * 100));
  const tog = (h, text) => `<li class="item"><button type="button" class="check" data-act="today-${h}" aria-pressed="${habitDone(rd, h, s)}">${text}</button>${habitDone(rd, h, s) ? `<button type="button" class="add" data-act="today-undo" data-h="${h}">Undo</button>` : ''}</li>`;
  return `<section aria-labelledby="cl"><h2 id="cl">Today's checklist</h2><ul class="list">
    ${tog('junk', 'No junk food today')}
    <li class="item"><div class="check" data-done="${habitDone(rd, 'water', s)}">Water <span class="num">${log.water} / ${wt} ml</span></div>
      <button type="button" class="add" data-act="today-water" data-ml="250" aria-label="Add 250 ml">+250</button><button type="button" class="add" data-act="today-water" data-ml="-250" aria-label="Remove 250 ml">−</button></li>
    ${tog('walk', '10-minute walk')}
  </ul><div class="bar" role="progressbar" aria-label="Water" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><b style="width:${pct}%"></b></div>
  <p class="muted">${wt === s.water.gym ? 'Gym day target.' : 'Rest day target.'} Everything here resets when you wake up.</p></section>`;
}

function streaks(rd, ctx) {
  const s = ctx.s;
  const cells = Array.from({ length: 28 }, (_, i) => {
    const x = addDays(rd, i - 27), c = HABITS.filter(h => habitDone(x, h, s)).length;
    return `<i class="c${c}${x === rd ? ' today' : ''}" title="${esc(dayLabel(x))}: ${c} of 3"></i>`;
  }).join('');
  const full = Array.from({ length: 28 }, (_, i) => addDays(rd, i - 27)).filter(x => HABITS.every(h => habitDone(x, h, s))).length;
  return `<section aria-labelledby="st"><h2 id="st">Streaks</h2>
    <p class="muted">No junk food ${streak(rd, 'junk', s)} · Water ${streak(rd, 'water', s)} · Walk ${streak(rd, 'walk', s)} days in a row</p>
    <div class="grid" role="img" aria-label="Last 4 weeks: all three habits done on ${full} of 28 days">${cells}</div>
    <p class="muted">Each square is a day. Brighter means more of the three habits done. Today has a ring.</p></section>`;
}

export default {
  name: 'today',
  view(ctx) {
    const rd = ctx.rd, blocks = dayPlan(rd, ctx.s);
    return header(rd, ctx, blocks) + banners(rd, ctx, blocks) + nextUp(rd, ctx, blocks) + checklist(rd, ctx)
      + `<section aria-labelledby="gy"><h2 id="gy">Gym</h2>${safe(gym.todayCard, ctx)}</section>`
      + `<section aria-labelledby="sy"><h2 id="sy">Study</h2>${safe(study.todayCard, ctx)}</section>`
      + `<section aria-labelledby="fd"><h2 id="fd">Food</h2>${safe(food.todayCard, ctx)}</section>`
      + safe(progress.todayCard, ctx) + streaks(rd, ctx);
  },
  click(act, el, ctx) {
    const rd = ctx.rd, l = getDayLog(rd);
    const names = { junk: 'No junk food today', walk: '10-minute walk' };
    if (act === 'today-junk' || act === 'today-walk') {
      const h = act.slice(6);
      if (!l[h] && confirm(`Mark "${names[h]}" as done?`)) setDayLog(rd, { [h]: true });
      return true;
    }
    if (act === 'today-undo' && confirm('Undo this item?')) { setDayLog(rd, { [el.dataset.h]: false }); return true; }
    if (act === 'today-water') { setDayLog(rd, { water: Math.max(0, l.water + +el.dataset.ml) }); return true; }
    return false;
  },
};
