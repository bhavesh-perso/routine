// Week screen (Mon–Sun) and the day detail: full timeline, override, gym skip / move.
import { getDay, describeShift } from './schedule.js';
import { setSetting } from './storage.js';
import { dayPlan, bedFor, wakeFor, isPrepDay, studyMinutes, timeLabel, switchInfo } from './plan.js';
import { fmt, addDays, mondayOf, dayLabel, esc, toMin } from './util.js';
import * as gym from './gym.js';
import * as food from './food.js';
import * as study from './study.js';
import { dayLabelOf } from './today.js';

const opt = (fn, ...a) => { try { return fn(...a); } catch { return null; } };
const OV = { off: 'Leave / off', sick: 'Sick', work: 'Swapped to work', custom: 'Custom shift' };
let moving = null; // iso of the gym session whose "Move to…" picker is open

function weekView(ctx, arg) {
  const s = ctx.s, mon = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? mondayOf(arg) : mondayOf(ctx.rd);
  const rows = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(mon, i), d = getDay(iso, s), g = opt(gym.sessionFor, iso, s), st = studyMinutes(iso, s), sf = opt(study.studyFor, iso, s);
    const ov = d.override ? `<span class="tag">${esc(OV[d.override.kind] || 'Changed')}</span>` : '';
    return `<li><a class="day ${d.type === 'off' ? 'off' : d.block}${iso === ctx.rd ? ' now' : ''}" href="#/day/${iso}">
      <b>${esc(dayLabel(iso))} · ${dayLabelOf(d)}</b>${ov}
      <span>${esc(describeShift(iso, s))} · ${d.block === 'night' ? 'Night' : 'Morning'} block</span>
      <span>Sleep ${timeLabel(bedFor(iso, s))} → ${fmt(wakeFor(addDays(iso, 1), s))}</span>
      ${g ? `<span>Gym: ${esc(g.kind)}${g.light ? ' (light week)' : ''} · ${esc(g.loc)} gym · ${esc(g.time || g.start + '–' + g.end)}${g.done ? ' · done' : ''}</span>` : ''}
      <span>Study: ${st.aws ? `AWS ${st.aws} min${sf?.aws?.topic ? ' (' + esc(sf.aws.topic) + ')' : ''} + ` : ''}Mandarin ${st.mandarin} min</span>
      ${isPrepDay(iso, s) ? '<span>Batch-cook day</span>' : ''}
      ${switchInfo(iso, s) && getDay(iso, s).type === 'off' ? '<span>Sleep-switch day</span>' : ''}
    </a></li>`;
  }).join('');
  return `<h1 class="page-title">Week</h1><p class="muted">${esc(dayLabel(mon))} – ${esc(dayLabel(addDays(mon, 6)))}</p>
  <div class="row weeknav"><a class="btn small" href="#/week/${addDays(mon, -7)}" aria-label="Previous week">Previous</a>
  <a class="btn small grow" href="#/week/${mondayOf(ctx.rd)}">This week</a>
  <a class="btn small" href="#/week/${addDays(mon, 7)}" aria-label="Next week">Next</a></div>
  <ul class="list weeklist">${rows}</ul><p class="muted">Tap a day for its full plan, to change it, or to move a gym session.</p>`;
}

function dayView(ctx, iso) {
  const s = ctx.s, d = getDay(iso, s), blocks = dayPlan(iso, s), meals = opt(food.mealsFor, iso, s) || {};
  const sf = opt(study.studyFor, iso, s), g = opt(gym.sessionFor, iso, s), prep = opt(food.prepFor, iso, s);
  const line = b => {
    let extra = '';
    if (b.slot && meals[b.slot]) extra = `<span class="muted">${esc(meals[b.slot].name)}${meals[b.slot].p ? ` · ${Math.round(meals[b.slot].p)} g protein` : ''}</span>`;
    if (b.kind === 'study' && sf?.aws?.topic) extra = `<span class="muted">AWS: ${esc(sf.aws.topic)}</span>`;
    if (b.kind === 'cook' && prep?.cook?.length) extra = `<span class="muted">${esc(prep.cook.map(c => c.name).join(' and '))}</span>`;
    if (b.kind === 'gym' && b.tight) extra = '<span class="muted">Tight day</span>';
    const end = b.end > b.start + 1 && !['sleep'].includes(b.kind) || (b.kind === 'sleep' && !b.bedtime) ? `–${timeLabel(b.end)}` : '';
    return `<li class="tl-${b.kind}"><span class="tl-time num">${timeLabel(b.start)}${end}</span><span class="tl-what">${esc(b.label)}${extra ? '<br>' + extra : ''}</span></li>`;
  };
  const ov = d.override;
  const gymPart = g ? `<section aria-labelledby="dg"><h2 id="dg">Gym session</h2><p>${esc(g.kind)} · ${esc(g.loc)} gym · ${esc(g.time || g.start + '–' + g.end)}${g.done ? ' · done' : ''}</p>
    ${g.done ? '' : `<div class="row"><a class="btn small" href="#/gym/day/${iso}">Preview</a><button type="button" class="btn small" data-act="week-move" data-iso="${iso}" aria-expanded="${moving === iso}">Move to…</button><button type="button" class="btn small ghost" data-act="week-skip" data-iso="${iso}">Skip</button></div>`}
    ${moving === iso ? movePicker(iso, s) : ''}</section>` : '';
  return `<p><a href="#/week/${iso}">Back to week</a></p>
  <h1 class="page-title">${esc(dayLabel(iso))}</h1><p class="muted">${dayLabelOf(d)} · ${esc(describeShift(iso, s))}${ov ? ' · ' + esc(OV[ov.kind] || 'Changed') : ''}</p>
  <section aria-labelledby="dt"><h2 id="dt">Timeline</h2><ol class="timeline">${blocks.map(line).join('')}</ol></section>
  ${gymPart}
  <section aria-labelledby="do"><h2 id="do">Change this day</h2>
  <p class="muted">Overrides only change this one date and always win over the pattern.</p>
  <div class="chips">
    <button type="button" class="btn small" data-act="week-ov" data-kind="off" data-iso="${iso}" aria-pressed="${ov?.kind === 'off'}">Leave / off</button>
    <button type="button" class="btn small" data-act="week-ov" data-kind="sick" data-iso="${iso}" aria-pressed="${ov?.kind === 'sick'}">Sick</button>
    <button type="button" class="btn small" data-act="week-ov" data-kind="work" data-block="night" data-iso="${iso}" aria-pressed="${ov?.kind === 'work' && ov.block === 'night'}">Work a night shift</button>
    <button type="button" class="btn small" data-act="week-ov" data-kind="work" data-block="morning" data-iso="${iso}" aria-pressed="${ov?.kind === 'work' && ov.block === 'morning'}">Work a morning shift</button>
  </div>
  <div class="row customshift"><label class="field grow"><span>Custom start</span><input type="time" id="ov-start" value="${esc(ov?.start || '')}"></label>
  <label class="field grow"><span>Custom end</span><input type="time" id="ov-end" value="${esc(ov?.end || '')}"></label></div>
  <button type="button" class="btn small" data-act="week-ov" data-kind="custom" data-iso="${iso}">Use custom shift times</button>
  ${ov ? `<button type="button" class="btn small ghost" data-act="week-ov-clear" data-iso="${iso}">Clear and go back to the pattern</button>` : ''}
  </section>`;
}

function movePicker(iso, s) {
  const targets = opt(gym.moveTargets, iso, s) || [];
  if (!targets.length) return '<p class="note calm">No valid day in the next week. Skip it instead, and it rolls to the next valid day.</p>';
  return `<div class="chips movepick" role="group" aria-label="Move the session to">${targets.map(t => `<button type="button" class="btn small" data-act="week-move-to" data-from="${iso}" data-to="${t}">${esc(dayLabel(t))}</button>`).join('')}</div>`;
}

export default {
  name: 'week',
  view(ctx, arg = '') {
    if (arg.startsWith('day/')) return dayView(ctx, arg.slice(4));
    return weekView(ctx, arg);
  },
  click(act, el, ctx) {
    const iso = el.dataset.iso;
    if (act === 'week-move') { moving = moving === iso ? null : iso; return true; }
    if (act === 'week-move-to') { gym.moveSession(el.dataset.from, el.dataset.to); moving = null; ctx.notify(`Moved to ${dayLabel(el.dataset.to)}`); return true; }
    if (act === 'week-skip') { if (confirm('Skip this session? It rolls to the next valid day.')) { gym.skipSession(iso); ctx.notify('Skipped'); } return true; }
    if (act === 'week-ov-clear') { setSetting('overrides.' + iso, undefined); ctx.notify('Back to the usual pattern'); return true; }
    if (act === 'week-ov') {
      const k = el.dataset.kind;
      if (k === 'custom') {
        const a = document.getElementById('ov-start')?.value, b = document.getElementById('ov-end')?.value;
        if (!a || !b || toMin(a) === toMin(b)) { ctx.notify('Enter a start and an end time first'); return false; }
        setSetting('overrides.' + iso, { kind: 'custom', start: a, end: b, block: toMin(a) >= 12 * 60 || toMin(b) < toMin(a) ? 'night' : 'morning' });
      } else setSetting('overrides.' + iso, k === 'work' ? { kind: 'work', block: el.dataset.block } : { kind: k });
      ctx.notify('Saved for this day');
      return true;
    }
    return false;
  },
};
