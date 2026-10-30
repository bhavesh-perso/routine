// Today screen: day-type header, next block, checklist, module cards, streaks.
import { getDay, describeShift } from './schedule.js';
import { getDayLog, setDayLog, getMeta, get } from './storage.js';
import { dayPlan, wakeFor, bedFor, switchCard, timeLabel } from './plan.js';
import { fmt, addDays, dayLabel, esc } from './util.js';
import * as gym from './gym.js';
import * as food from './food.js';
import * as study from './study.js';
import * as progress from './progress.js';
import { backupBanner } from './settings.js';
import { ask } from './sheet.js';

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

// ---------- home tiles ----------
const ICON = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  gym: '<path d="M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12"/>',
  food: '<path d="M7 3v8a2 2 0 0 0 4 0V3M9 11v10M17 3c-2 2-3 5-3 8h3v10"/>',
  study: '<path d="M3 6.5C5.5 5 8.5 5 12 7c3.5-2 6.5-2 9-.5V19c-2.5-1.5-5.5-1.5-9 .5-3.5-2-6.5-2-9-.5z"/><path d="M12 7v12.5"/>',
  streak: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
};
const ico = k => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
const tile = (sec, k, title, big, small, done) => `<a class="app-tile${done ? ' done' : ''}" href="#/today/${sec}">
  <span class="ti">${ico(k)}</span><span class="tt">${title}</span><span class="tb">${big}</span><span class="ts">${small}</span></a>`;

function tiles(rd, ctx) {
  const s = ctx.s, log = getDayLog(rd), wt = waterTarget(rd, s);
  const nDone = HABITS.filter(h => habitDone(rd, h, s)).length;
  let g = null; try { g = gym.sessionFor(rd, s); } catch { /* none */ }
  let sr = null; try { sr = g ? null : gym.runFor(rd, s); } catch { /* none */ }
  let tot = { k: 0, p: 0 }; try { tot = food.totals(rd) || tot; } catch { /* none */ }
  let sf = null; try { sf = study.studyFor(rd, s); } catch { /* none */ }
  const sl = (get('study').log || {})[rd] || {};
  const awsDone = !!sl.aws?.done, mand = sl.mandarin?.min || 0;
  const studyBig = sf ? `${sf.aws.min} min` : 'Rest';
  const studySmall = sf ? (awsDone ? 'AWS done' : 'AWS') + (mand ? ' · Mandarin done' : ` + Mandarin`) : '';
  return `<div class="tiles">
    ${tile('checklist', 'check', 'Checklist', `${nDone} of 3`, `Water ${log.water} / ${wt} ml`, nDone === 3)}
    ${tile('gym', 'gym', 'Gym', g ? (g.done ? 'Done' : g.nextDay ? 'Tomorrow ' + g.start : g.start) : sr ? sr.start : 'Rest', g ? esc(g.kind) + (g.run ? ' + run' : '') : sr ? esc(sr.title) : 'No session today', g ? g.done : !!(sr && gym.loggedRuns()[rd]))}
    ${tile('food', 'food', 'Food', `${tot.p} g`, `protein · ${tot.k} kcal so far`, false)}
    ${tile('study', 'study', 'Study', studyBig, studySmall, awsDone)}
  </div>
  <a class="app-wide" href="#/today/streaks"><span class="ti">${ico('streak')}</span><span class="grow"><b>Streaks and progress</b><br><span class="muted">No junk food ${streak(rd, 'junk', s)} · Water ${streak(rd, 'water', s)} · Walk ${streak(rd, 'walk', s)} days</span></span></a>`;
}

const back = t => `<a class="back" href="#/today">Today</a><h1 class="page-title">${t}</h1>`;
const SECTIONS = {
  checklist: (rd, ctx) => back('Checklist') + checklist(rd, ctx),
  gym: (rd, ctx) => back('Gym') + safe(gym.todayCard, ctx) + '<p><a class="btn ghost" href="#/gym">Open gym</a></p>',
  study: (rd, ctx) => back('Study') + safe(study.todayCard, ctx),
  food: (rd, ctx) => back('Food') + safe(food.todayCard, ctx) + '<p><a class="btn ghost" href="#/food">Open food plan</a></p>',
  streaks: (rd, ctx) => back('Streaks and progress') + streaks(rd, ctx) + safe(progress.todayCard, ctx),
};

let qaOpen = false;
export function fab() {
  return `<div class="qa">${qaOpen ? `<div class="qa-sheet" role="dialog" aria-label="Quick add">
    <button type="button" class="btn" data-act="today-qa-water">Add 250 ml water</button>
    <button type="button" class="btn" data-act="today-qa-walk">Mark 10-minute walk done</button>
    <button type="button" class="btn" data-act="today-qa-meal">Log a meal</button>
    <button type="button" class="btn" data-act="today-qa-weigh">Weigh-in</button></div>` : ''}
    <button type="button" class="qa-btn" data-act="today-qa" aria-expanded="${qaOpen}" aria-label="${qaOpen ? 'Close quick add' : 'Quick add'}">${qaOpen ? '×' : '+'}</button></div>`;
}

export default {
  name: 'today',
  view(ctx, arg = '') {
    const rd = ctx.rd, blocks = dayPlan(rd, ctx.s);
    if (SECTIONS[arg]) return SECTIONS[arg](rd, ctx);
    return header(rd, ctx, blocks) + banners(rd, ctx, blocks) + nextUp(rd, ctx, blocks) + tiles(rd, ctx);
  },
  async click(act, el, ctx) {
    const rd = ctx.rd, l = getDayLog(rd);
    const names = { junk: 'No junk food today', walk: '10-minute walk' };
    if (act === 'today-qa') { qaOpen = !qaOpen; return true; }
    if (act.startsWith('today-qa-')) {
      qaOpen = false;
      if (act === 'today-qa-water') { setDayLog(rd, { water: l.water + 250 }); ctx.notify('Added 250 ml'); return true; }
      if (act === 'today-qa-walk') { if (!l.walk && await ask('Mark "10-minute walk" as done?', { ok: 'Mark done' })) setDayLog(rd, { walk: true }); return true; }
      if (act === 'today-qa-meal') { ctx.go('#/food'); return true; }
      if (act === 'today-qa-weigh') { ctx.go('#/progress'); return true; }
    }
    if (act === 'today-junk' || act === 'today-walk') {
      const h = act.slice(6);
      if (!l[h] && await ask(`Mark "${names[h]}" as done?`, { ok: 'Mark done' })) setDayLog(rd, { [h]: true });
      return true;
    }
    if (act === 'today-undo' && await ask('Undo this item?', { ok: 'Undo' })) { setDayLog(rd, { [el.dataset.h]: false }); return true; }
    if (act === 'today-water') { setDayLog(rd, { water: Math.max(0, l.water + +el.dataset.ml) }); return true; }
    return false;
  },
};
