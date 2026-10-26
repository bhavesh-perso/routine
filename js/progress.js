// Progress: weekly weigh-in with custom measurements, charts, gym volume and PRs, study minutes,
// habit heatmap, monthly summary and the 2-minute Sunday review. Reads other areas straight from
// storage (never imports gym/food/study modules) so it has no load-order dependencies.
import { get, update, getDayLog, getMeta } from './storage.js';
import { esc, addDays, dow, mondayOf, dayLabel, monthLabel, dayNum, round1 } from './util.js';
import { lineChart } from './chart.js';
import { ask } from './sheet.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_MEASURES = 8;
let names = {};      // exercise id -> display name (from data/exercises.json)
let weighIso = null; // date picked in the weigh-in form when the router passes no date

// ---------- small helpers ----------
const fin = v => typeof v === 'number' && Number.isFinite(v);
const grp = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const signed = (v, d = 1) => { const r = Math.round(v * 10 ** d) / 10 ** d; return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r); };
const isIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const inRange = (iso, a, b) => iso >= a && iso <= b;
const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return `${ym}-${String(n).padStart(2, '0')}`; };
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const exName = id => names[id] || id;
export const _setNames = map => { names = { ...map }; }; // test hook

// Parse a typed number; accepts "68,4". Returns null for empty, NaN for junk.
export function parseNum(v) {
  const t = String(v ?? '').trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

// ---------- weigh-ins ----------
const prog = () => get('progress');
export const measures = () => Array.isArray(prog().measures) ? prog().measures : [];
export const weighinOn = iso => prog().weighins?.[iso] || null;
// All weigh-ins, oldest first: [{ iso, kg, belly, notes, m }]
export function weighins() {
  const w = prog().weighins || {};
  return Object.keys(w).filter(isIso).sort().map(iso => ({ iso, kg: null, belly: null, notes: '', ...w[iso], m: { ...(w[iso].m || {}) } }));
}

// entry: { kg, belly, notes, m:{name:cm} }. Empty values are dropped. Returns { ok, error? }.
export function saveWeighin(iso, entry) {
  if (!isIso(iso)) return { ok: false, error: 'Pick a date.' };
  const kg = fin(entry.kg) ? entry.kg : null, belly = fin(entry.belly) ? entry.belly : null;
  if (kg !== null && (kg < 25 || kg > 250)) return { ok: false, error: 'Weight looks off. Enter it in kg, for example 68.4.' };
  if (belly !== null && (belly < 30 || belly > 200)) return { ok: false, error: 'Belly looks off. Enter it in cm, for example 82.5.' };
  const m = {};
  for (const [k, v] of Object.entries(entry.m || {})) {
    if (!fin(v)) continue;
    if (v < 5 || v > 250) return { ok: false, error: `${k} looks off. Enter it in cm.` };
    m[k] = v;
  }
  const notes = String(entry.notes || '').trim().slice(0, 500);
  if (kg === null && belly === null && !Object.keys(m).length) return { ok: false, error: 'Enter at least your weight or one measurement.' };
  const ok = update('progress', p => { p.weighins = p.weighins || {}; p.weighins[iso] = { kg, belly, notes, m }; });
  return ok ? { ok: true } : { ok: false, error: "Couldn't save." };
}
export function deleteWeighin(iso) { return update('progress', p => { if (p.weighins) delete p.weighins[iso]; }); }

export function addMeasure(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!name) return { ok: false, error: 'Type a name, for example Arm.' };
  if (/^(weight|belly|kg)$/i.test(name)) return { ok: false, error: 'That one is already on the form.' };
  if (measures().some(x => x.toLowerCase() === name.toLowerCase())) return { ok: false, error: `${name} is already on the list.` };
  if (measures().length >= MAX_MEASURES) return { ok: false, error: `You can track up to ${MAX_MEASURES} measurements.` };
  const ok = update('progress', p => { p.measures = [...(Array.isArray(p.measures) ? p.measures : []), name]; });
  return ok ? { ok: true, name } : { ok: false, error: "Couldn't save." };
}
// Past values stay in the weigh-ins; adding the same name again brings them back.
export function removeMeasure(name) { return update('progress', p => { p.measures = (p.measures || []).filter(x => x !== name); }); }

// key: 'kg' | 'belly' | 'm:<name>'
const valueOf = (w, key) => key.startsWith('m:') ? w.m?.[key.slice(2)] : w[key];
export const series = key => weighins().map(w => ({ x: w.iso, y: valueOf(w, key) })).filter(p => fin(p.y));
// First and latest value of a measurement. null when there is nothing logged.
export function changeSinceStart(key) {
  const pts = series(key);
  if (!pts.length) return null;
  const a = pts[0], b = pts.at(-1);
  return { startIso: a.x, start: a.y, latestIso: b.x, latest: b.y, change: Math.round((b.y - a.y) * 100) / 100, n: pts.length };
}
export function latestWeight() { const c = changeSinceStart('kg'); return c ? c.latest : null; }

// ---------- gym (computed from stored sessions; warm-up sets never count) ----------
const sessions = () => Object.values(get('gym').sessions || {}).filter(x => x && isIso(x.rd));
export const doneSessions = (from, to) => sessions().filter(x => x.endedAt && inRange(x.rd, from, to))
  .sort((a, b) => a.rd < b.rd ? -1 : a.rd > b.rd ? 1 : (a.startedAt || 0) - (b.startedAt || 0));
// Reps for volume: one-sided moves count both sides. Reps for records: the weaker side.
const totalReps = d => fin(d.r) ? d.r : (fin(d.rl) || fin(d.rr)) ? (d.rl || 0) + (d.rr || 0) : 0;
const setReps = d => fin(d.r) ? d.r : (fin(d.rl) && fin(d.rr)) ? Math.min(d.rl, d.rr) : (d.rl || d.rr || 0);
function* workSets(sess) {
  for (const e of sess.ex || []) for (const st of e.sets || []) if (st && st.type !== 'warm' && st.done) yield { id: e.id, d: st.done };
}

// Totals for a date range of done sessions.
export function gymTotals(from, to) {
  const out = { sessions: 0, sets: 0, kg: 0, bwReps: 0, sec: 0 };
  for (const sess of doneSessions(from, to)) {
    out.sessions++;
    for (const { d } of workSets(sess)) {
      const reps = totalReps(d);
      if (fin(d.w) && d.w > 0 && reps > 0) { out.kg += d.w * reps; out.sets++; }
      else if (reps > 0) { out.bwReps += reps; out.sets++; }
      else if (fin(d.sec) && d.sec > 0) { out.sec += d.sec; out.sets++; }
    }
  }
  out.kg = Math.round(out.kg * 10) / 10;
  return out;
}
export const gymWeek = mondayIso => gymTotals(mondayIso, addDays(mondayIso, 6));

export const epley = (w, r) => r <= 0 ? 0 : r === 1 ? w : w * (1 + r / 30);
// Personal records per exercise from working sets of done sessions.
// { [exId]: { heaviest:{w,r,iso}|null, e1rm:{v,w,r,iso}|null, repsAt:{ [w]:{r,iso} }, bwReps:{r,iso}|null, hold:{sec,iso}|null, history:[{iso,e1rm}] } }
export function prs() {
  const out = {};
  for (const sess of doneSessions('0000-01-01', '9999-12-31')) {
    const best = {};
    for (const { id, d } of workSets(sess)) {
      const p = out[id] || (out[id] = { heaviest: null, e1rm: null, repsAt: {}, bwReps: null, hold: null, history: [] });
      const r = setReps(d), iso = sess.rd;
      if (fin(d.w) && d.w > 0 && r > 0) {
        if (!p.heaviest || d.w > p.heaviest.w || (d.w === p.heaviest.w && r > p.heaviest.r)) p.heaviest = { w: d.w, r, iso };
        const v = Math.round(epley(d.w, r) * 10) / 10;
        if (!p.e1rm || v > p.e1rm.v) p.e1rm = { v, w: d.w, r, iso };
        if (!p.repsAt[d.w] || r > p.repsAt[d.w].r) p.repsAt[d.w] = { r, iso };
        best[id] = Math.max(best[id] || 0, v);
      } else if (r > 0) {
        if (!p.bwReps || r > p.bwReps.r) p.bwReps = { r, iso };
      } else if (fin(d.sec) && d.sec > 0) {
        if (!p.hold || d.sec > p.hold.sec) p.hold = { sec: d.sec, iso };
      }
    }
    for (const [id, v] of Object.entries(best)) out[id].history.push({ iso: sess.rd, e1rm: v });
  }
  return out;
}

// ---------- study, food, checklist ----------
export function studyTotals(from, to) {
  const log = get('study').log || {}, out = { aws: 0, mandarin: 0 };
  for (const [iso, l] of Object.entries(log)) if (inRange(iso, from, to)) { out.aws += +l?.aws?.min || 0; out.mandarin += +l?.mandarin?.min || 0; }
  return out;
}
// Average kcal and protein over days that have at least one entry.
export function foodAverages(from, to) {
  const log = get('food').log || {}; let n = 0, k = 0, p = 0;
  for (const [iso, list] of Object.entries(log)) {
    if (!inRange(iso, from, to) || !Array.isArray(list) || !list.length) continue;
    n++; for (const e of list) { k += +e?.k || 0; p += +e?.p || 0; }
  }
  return n ? { days: n, k: Math.round(k / n), p: Math.round(p / n) } : { days: 0, k: null, p: null };
}
// Water target: the app may pass ctx.waterTarget(iso); otherwise a day with a logged session counts as a gym day.
function waterTarget(iso, s, ctx) {
  if (typeof ctx?.waterTarget === 'function') { const t = ctx.waterTarget(iso); if (fin(t)) return t; }
  return sessions().some(x => x.rd === iso) ? s.water.gym : s.water.rest;
}
export function habitsOn(iso, s, ctx) {
  const l = getDayLog(iso), junk = !!l.junk, walk = !!l.walk, water = (+l.water || 0) >= waterTarget(iso, s, ctx);
  return { junk, water, walk, count: junk + water + walk };
}
export function checklistDays(from, to, s, ctx) {
  let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (habitsOn(d, s, ctx).count === 3) n++;
  return n;
}

// ---------- monthly summary ----------
function weighChange(from, to, key = 'kg') {
  const pts = series(key), inside = pts.filter(p => inRange(p.x, from, to));
  if (!inside.length) return null;
  const before = pts.filter(p => p.x < from).at(-1), base = before || inside[0], last = inside.at(-1);
  return { latest: last.y, change: Math.round((last.y - base.y) * 100) / 100, from: base.x };
}
export function monthSummary(ym, s, ctx, upTo = '9999-12-31') {
  const from = `${ym}-01`, end = monthEnd(ym), to = end < upTo ? end : upTo;
  const g = gymTotals(from, to);
  return { ym, from, to, weigh: weighChange(from, to), gym: g.sessions, kg: g.kg, bwReps: g.bwReps, study: studyTotals(from, to), checklist: checklistDays(from, to, s, ctx), food: foodAverages(from, to) };
}
function firstDataIso() {
  const c = [...Object.keys(prog().weighins || {}), ...sessions().map(x => x.rd), ...Object.keys(get('days')), ...Object.keys(get('food').log || {}), ...Object.keys(get('study').log || {}), getMeta().firstUse].filter(isIso).sort();
  return c[0] || null;
}

// ---------- Sunday review ----------
export function weekReview(mondayIso, ctx) {
  const s = ctx.s, sun = addDays(mondayIso, 6), last = ctx.rd < sun ? ctx.rd : sun;
  const g = gymWeek(mondayIso), st = studyTotals(mondayIso, sun);
  const planned = typeof ctx.gymPlanned === 'function' ? ctx.gymPlanned(mondayIso) : null;
  const sp = typeof ctx.studyPlanned === 'function' ? ctx.studyPlanned(mondayIso) : null;
  const wk = weighins().filter(w => inRange(w.iso, mondayIso, sun)).at(-1) || null;
  const prev = wk ? weighins().filter(w => w.iso < wk.iso && fin(w.kg)).at(-1) || null : null;
  const elapsed = last < mondayIso ? 0 : dayNum(last) - dayNum(mondayIso) + 1;
  return {
    monday: mondayIso, sunday: sun, elapsed,
    gym: { done: g.sessions, planned: fin(planned) ? planned : null, kg: g.kg, bwReps: g.bwReps },
    study: { aws: st.aws, mandarin: st.mandarin, plan: sp && fin(sp.aws) ? { aws: sp.aws, mandarin: +sp.mandarin || 0 } : null },
    food: foodAverages(mondayIso, sun),
    checklist: elapsed ? checklistDays(mondayIso, last, s, ctx) : 0,
    weigh: wk, weighPrev: prev,
  };
}

// ---------- views ----------
const SEG = [['', 'Body'], ['gym', 'Gym'], ['study', 'Study'], ['habits', 'Habits'], ['month', 'Months']];
const seg = cur => `<nav class="seg" aria-label="Progress sections">${SEG.map(([a, t]) => `<a href="#/progress${a ? '/' + a : ''}"${a === cur ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
const head = (cur, title = 'Progress') => `<h1 class="page-title">${title}</h1>${seg(cur)}`;
const firstWeighText = s => `Log your first weigh-in on ${DAY_NAMES[s.weighDay] || 'Sunday'} after you wake up.`;
const changeLine = (c, unit) => c.n < 2 ? `First entry ${dayLabel(c.startIso)}` : `${signed(c.change)} ${unit} since ${dayLabel(c.startIso)}`;

function overview(ctx) {
  const s = ctx.s, all = weighins(), ms = measures();
  const reviewLink = `<a class="btn small ghost" href="#/progress/review">2-minute review</a>`;
  if (!all.length) return `${head('')}
    <p class="note calm">${firstWeighText(s)} Weigh yourself before eating or drinking, then measure your belly at the navel.</p>
    <div class="row"><a class="btn primary" href="#/progress/weigh">Add weigh-in</a>${reviewLink}</div>`;
  const kg = changeSinceStart('kg'), belly = changeSinceStart('belly'), last = all.at(-1);
  const rows = [['Weight', kg, 'kg'], ['Belly at the navel', belly, 'cm'], ...ms.map(n => [n, changeSinceStart('m:' + n), 'cm'])].filter(r => r[1]);
  const charts = [['kg', 'Weight', ' kg'], ['belly', 'Belly at the navel', ' cm'], ...ms.map(n => ['m:' + n, n, ' cm'])]
    .filter(([k]) => series(k).length)
    .map(([k, t, u]) => `<section><h2>${esc(t)}</h2>${lineChart(series(k), { label: t, unit: u, decimals: 1 })}</section>`).join('');
  const recent = all.slice(-6).reverse().map(w => `<li class="row"><span class="grow"><b>${dayLabel(w.iso)}</b> <span class="muted num">${[fin(w.kg) ? w.kg + ' kg' : '', fin(w.belly) ? 'belly ' + w.belly + ' cm' : '', ...Object.entries(w.m).filter(([n]) => ms.includes(n)).map(([n, v]) => `${esc(n.toLowerCase())} ${v} cm`)].filter(Boolean).join(' · ')}</span>${w.notes ? `<br><span class="muted">${esc(w.notes)}</span>` : ''}</span><a class="btn small ghost" href="#/progress/weigh/${w.iso}" aria-label="Edit weigh-in of ${dayLabel(w.iso)}">Edit</a></li>`).join('');
  return `${head('')}
  <section class="prog-latest" aria-label="Latest weigh-in">
    <p class="muted">Latest weigh-in, ${dayLabel(last.iso)}</p>
    ${fin(kg?.latest) ? `<p class="prog-big num">${kg.latest} <small>kg</small></p>` : ''}
    <ul class="rules">${rows.map(([t, c, u]) => `<li class="row"><span class="grow">${esc(t)}</span><span class="num"><b>${c.latest} ${u}</b> <span class="muted">${changeLine(c, u)}</span></span></li>`).join('')}</ul>
    <div class="row"><a class="btn primary" href="#/progress/weigh">Add weigh-in</a>${reviewLink}</div>
  </section>
  <p class="muted">Muscle gain shows in your measurements more than on the scale.</p>
  ${charts}
  <section><h2>Recent weigh-ins</h2><ul class="rules">${recent}</ul></section>`;
}

function weighForm(ctx, iso) {
  const s = ctx.s, maxIso = ctx.iso > ctx.rd ? ctx.iso : ctx.rd;
  iso = isIso(iso) ? iso : isIso(weighIso) ? weighIso : ctx.rd;
  const w = weighinOn(iso), ms = measures(), extra = w ? Object.keys(w.m || {}).filter(n => !ms.includes(n)) : [];
  const v = x => fin(x) ? String(x) : '';
  const num = (id, label, val, attrs = '') => `<label class="field" for="${id}"><span>${label}</span><input id="${id}" type="text" inputmode="decimal" autocomplete="off" value="${esc(val)}"${attrs}></label>`;
  return `<a class="back" href="#/progress">Progress</a><h1 class="page-title">${w ? 'Edit weigh-in' : 'Weigh-in'}</h1>
  <p class="muted">Weigh yourself after you wake up, before eating or drinking. Usual day: ${DAY_NAMES[s.weighDay] || 'Sunday'}.</p>
  <div class="prog-form" data-form="weigh">
    <label class="field" for="prog-date"><span>Date</span><input id="prog-date" type="date" value="${iso}" max="${maxIso}" data-act="prog-weigh-date"></label>
    ${num('prog-kg', 'Body weight (kg)', v(w?.kg), ' placeholder="e.g. 68.4"')}
    ${num('prog-belly', 'Belly at the navel (cm)', v(w?.belly), ' placeholder="e.g. 82.5"')}
    ${ms.map((n, i) => num(`prog-m-${i}`, `${esc(n)} (cm)`, v(w?.m?.[n]), ` data-measure="${esc(n)}"`)).join('')}
    <label class="field" for="prog-notes"><span>Notes (optional)</span><textarea id="prog-notes" rows="2">${esc(w?.notes || '')}</textarea></label>
    ${extra.length ? `<p class="muted">Also saved on this date: ${extra.map(n => `${esc(n)} ${w.m[n]} cm`).join(', ')}. Add the measurement again to edit it.</p>` : ''}
    <button type="button" class="btn primary wide" data-act="prog-save" data-iso="${iso}">Save weigh-in</button>
    ${w ? `<button type="button" class="btn ghost wide prog-gap" data-act="prog-delete" data-iso="${iso}">Delete this weigh-in</button>` : ''}
  </div>
  <details class="fold"${ms.length ? '' : ' open'}><summary>Your measurements</summary>
    <p class="muted">Add your own, such as arm, chest, waist or thigh. Measure the same spot each time.</p>
    ${ms.length ? `<ul class="rules">${ms.map(n => `<li class="row"><span class="grow">${esc(n)}</span><button type="button" class="btn small ghost" data-act="prog-remove-measure" data-name="${esc(n)}" aria-label="Remove ${esc(n)}">Remove</button></li>`).join('')}</ul>` : ''}
    <div class="row"><label class="field grow" for="prog-new-measure"><span>New measurement name</span><input id="prog-new-measure" type="text" maxlength="24" autocomplete="off" placeholder="e.g. Arm"></label>
    <button type="button" class="btn" data-act="prog-add-measure">Add</button></div>
  </details>
  <p><a href="#/progress">Back to progress</a></p>`;
}

// Weeks (Monday isos) from the first data week, capped at `max`, ending with the current week.
function weekList(firstIso, curIso, max) {
  const cur = mondayOf(curIso), out = [];
  let m = firstIso ? mondayOf(firstIso) : cur;
  if (dayNum(cur) - dayNum(m) > (max - 1) * 7) m = addDays(cur, -(max - 1) * 7);
  for (; m <= cur; m = addDays(m, 7)) out.push(m);
  return out;
}
const weekName = m => `Week of ${dayLabel(m).slice(4)}`;
const barRow = (pct, label) => `<div class="bar prog-bar" aria-hidden="true"><b style="width:${Math.max(0, Math.min(100, Math.round(pct)))}%"></b></div><span class="prog-sr">${label}</span>`;

function gymView(ctx) {
  const all = doneSessions('0000-01-01', '9999-12-31');
  if (!all.length) return `${head('gym')}<p class="note calm">Finish your first gym session and your weekly volume and records show up here.</p><p><a class="btn" href="#/gym">Go to gym</a></p>`;
  const weeks = weekList(all[0].rd, ctx.rd, 8).map(m => ({ m, ...gymWeek(m) }));
  const maxKg = Math.max(1, ...weeks.map(w => w.kg));
  const volPts = weeks.filter(w => w.m < mondayOf(ctx.rd)).map(w => ({ x: w.m, y: w.kg })); // completed weeks only
  const p = prs(), ids = Object.keys(p).sort((a, b) => exName(a).localeCompare(exName(b)));
  const prItem = id => {
    const r = p[id], lines = [];
    if (r.heaviest) lines.push(`Heaviest: <b class="num">${r.heaviest.w} kg × ${r.heaviest.r}</b> <span class="muted">${dayLabel(r.heaviest.iso)}</span>`);
    if (r.e1rm) lines.push(`Best estimated 1RM: <b class="num">${r.e1rm.v} kg</b> <span class="muted">from ${r.e1rm.w} kg × ${r.e1rm.r}</span>`);
    const ws = Object.keys(r.repsAt).map(Number).sort((a, b) => b - a).slice(0, 4);
    if (ws.length) lines.push(`Most reps: ${ws.map(w => `<span class="num">${w} kg × ${r.repsAt[w].r}</span>`).join(' · ')}`);
    if (r.bwReps) lines.push(`Most reps (bodyweight): <b class="num">${r.bwReps.r}</b> <span class="muted">${dayLabel(r.bwReps.iso)}</span>`);
    if (r.hold) lines.push(`Longest hold: <b class="num">${r.hold.sec} s</b> <span class="muted">${dayLabel(r.hold.iso)}</span>`);
    const chart = r.history.length >= 2 ? `<details class="fold"><summary>Estimated 1RM over time</summary>${lineChart(r.history.map(h => ({ x: h.iso, y: h.e1rm })), { label: `${exName(id)} estimated 1RM`, unit: ' kg' })}</details>` : '';
    return `<li><h3>${esc(exName(id))}</h3>${lines.map(l => `<p>${l}</p>`).join('')}${chart}</li>`;
  };
  return `${head('gym')}
  <section><h2>Weekly training</h2>
  <p class="muted">Volume is weight × reps on working sets. Warm-up sets don't count.</p>
  <ul class="rules">${weeks.slice().reverse().map(w => `<li><div class="row"><span class="grow">${weekName(w.m)}</span><span class="num">${plural(w.sessions, 'session')}</span></div>
    <p class="muted num">${grp(w.kg)} kg${w.bwReps ? ` · ${w.bwReps} bodyweight reps` : ''}${w.sec ? ` · ${w.sec} s held` : ''}</p>${barRow(w.kg / maxKg * 100, `${grp(w.kg)} kg, ${plural(w.sessions, 'session')}`)}</li>`).join('')}</ul>
  ${volPts.length >= 2 ? `<h3>Volume per completed week</h3>${lineChart(volPts, { label: 'Weekly volume', unit: ' kg', decimals: 0 })}` : ''}</section>
  <section><h2>Personal records</h2>${ids.length ? `<ul class="rules">${ids.map(prItem).join('')}</ul>` : '<p class="muted">Log a working set to see your records.</p>'}
  <p class="muted">Estimated 1RM uses weight × (1 + reps ÷ 30). It smooths out changes in reps.</p></section>`;
}

function studyView(ctx) {
  const log = get('study').log || {}, first = Object.keys(log).filter(isIso).sort()[0];
  const weeks = weekList(first, ctx.rd, 8).map(m => ({ m, ...studyTotals(m, addDays(m, 6)), plan: typeof ctx.studyPlanned === 'function' ? ctx.studyPlanned(m) : null }));
  const any = weeks.some(w => w.aws || w.mandarin);
  if (!any) return `${head('study')}<p class="note calm">Log your study minutes from Today and your weekly totals show up here.</p><p><a class="btn" href="#/study">Go to study</a></p>`;
  const total = studyTotals('0000-01-01', '9999-12-31');
  const row = (label, done, plan) => {
    const hasPlan = plan && fin(plan.v) && plan.v > 0;
    return `<div class="row"><span class="grow">${label}</span><span class="num">${done} min${hasPlan ? ` <span class="muted">of ${plan.v}</span>` : ''}</span></div>${hasPlan ? barRow(done / plan.v * 100, `${label}: ${done} of ${plan.v} minutes`) : ''}`;
  };
  return `${head('study')}
  <p class="muted num">Since you started: AWS ${grp(total.aws)} min · Mandarin ${grp(total.mandarin)} min</p>
  <ul class="rules">${weeks.slice().reverse().map(w => `<li><h3>${weekName(w.m)}</h3>${row('AWS', w.aws, w.plan && { v: w.plan.aws })}${row('Mandarin', w.mandarin, w.plan && { v: w.plan.mandarin })}</li>`).join('')}</ul>
  ${weeks.length >= 2 ? lineChart(weeks.map(w => ({ x: w.m, y: w.aws + w.mandarin })), { label: 'Study minutes per week', unit: ' min', decimals: 0 }) : ''}`;
}

// 12-week habit heatmap. Each cell shows how many of the 3 habits were done (0–3) as a digit, not only a colour.
export function habitGrid(ctx, weeks = 12) {
  const s = ctx.s, end = addDays(mondayOf(ctx.rd), 6), start = addDays(mondayOf(ctx.rd), -(weeks - 1) * 7);
  const first = getMeta().firstUse || Object.keys(get('days')).filter(isIso).sort()[0] || ctx.rd;
  const from = start > first ? start : first;
  const cells = [], tot = { junk: 0, water: 0, walk: 0, all: 0, days: 0 };
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (d > ctx.rd || d < from) { cells.push(`<i class="prog-cell none" aria-hidden="true"></i>`); continue; }
    const h = habitsOn(d, s, ctx);
    tot.days++; tot.junk += h.junk; tot.water += h.water; tot.walk += h.walk; tot.all += h.count === 3;
    cells.push(`<i class="prog-cell c${h.count}" title="${dayLabel(d)}: ${h.count} of 3">${h.count}</i>`);
  }
  return { cells, tot, from };
}
function habitsView(ctx) {
  const { cells, tot, from } = habitGrid(ctx);
  if (!tot.days || !(tot.junk + tot.water + tot.walk)) return `${head('habits')}<p class="note calm">Tick your checklist on Today and your consistency shows up here.</p><p><a class="btn" href="#/today">Go to Today</a></p>`;
  const pct = n => Math.round(n / tot.days * 100);
  const summary = `Last 12 weeks from ${dayLabel(from)}: all three habits on ${tot.all} of ${tot.days} days. No junk food ${tot.junk} days, water ${tot.water} days, walk ${tot.walk} days.`;
  return `${head('habits')}
  <p class="muted">Each square is one routine day. The number is how many of the three checklist items you completed.</p>
  <figure class="prog-heat"><div class="prog-days" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span>${x}</span>`).join('')}</div>
    <div class="prog-grid" role="img" aria-label="${esc(summary)}">${cells.join('')}</div></figure>
  <p class="prog-legend muted" aria-hidden="true"><i class="prog-cell c0">0</i> none <i class="prog-cell c1">1</i> <i class="prog-cell c2">2</i> <i class="prog-cell c3">3</i> all three</p>
  <ul class="rules">${[['All three', tot.all], ['No junk food', tot.junk], ['Water target', tot.water], ['10-minute walk', tot.walk]].map(([t, n]) => `<li><div class="row"><span class="grow">${t}</span><span class="num">${n} of ${tot.days} days</span></div>${barRow(pct(n), `${t}: ${pct(n)}%`)}</li>`).join('')}</ul>`;
}

function monthView(ctx) {
  const first = firstDataIso();
  if (!first) return `${head('month')}<p class="note calm">Your monthly summary starts once you log something: a weigh-in, a gym session, food or study minutes.</p>`;
  const months = []; let ym = ctx.rd.slice(0, 7);
  while (ym >= first.slice(0, 7) && months.length < 12) { months.push(ym); const [y, m] = ym.split('-').map(Number); ym = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
  const card = ym => {
    const x = monthSummary(ym, ctx.s, ctx, ctx.rd);
    const w = x.weigh ? `${x.weigh.latest} kg <span class="muted">(${signed(x.weigh.change)} kg since ${dayLabel(x.weigh.from)})</span>` : '<span class="muted">No weigh-in</span>';
    const rows = [['Weigh-in', w], ['Gym sessions', `${x.gym}`], ['Volume', `${grp(x.kg)} kg${x.bwReps ? ` · ${x.bwReps} bodyweight reps` : ''}`],
      ['Study', `AWS ${x.study.aws} min · Mandarin ${x.study.mandarin} min`], ['Checklist days (all three)', `${x.checklist}`],
      ['Average per day logged', x.food.days ? `${x.food.p} g protein · ${grp(x.food.k)} kcal <span class="muted">(${plural(x.food.days, 'day')})</span>` : '<span class="muted">No food logged</span>']];
    return `<section class="prog-month"><h2>${monthLabel(ym + '-01')}</h2><ul class="rules">${rows.map(([t, v]) => `<li class="row"><span class="grow">${t}</span><span class="num">${v}</span></li>`).join('')}</ul></section>`;
  };
  return `${head('month')}${months.map(card).join('')}`;
}

function reviewView(ctx) {
  const mon = mondayOf(ctx.rd), r = weekReview(mon, ctx), s = ctx.s;
  const part = r.elapsed < 7 ? ` <span class="muted">(${plural(r.elapsed, 'day')} so far)</span>` : '';
  const vs = (done, plan, unit = '') => plan != null ? `${done}${unit} of ${plan}${unit} planned` : `${done}${unit}`;
  const weigh = r.weigh
    ? `${[fin(r.weigh.kg) ? r.weigh.kg + ' kg' : '', fin(r.weigh.belly) ? 'belly ' + r.weigh.belly + ' cm' : ''].filter(Boolean).join(' · ') || 'Measurements logged'}${fin(r.weigh.kg) && r.weighPrev ? ` <span class="muted">(${signed(r.weigh.kg - r.weighPrev.kg)} kg since ${dayLabel(r.weighPrev.iso)})</span>` : ''}`
    : `Not logged yet. <a href="#/progress/weigh">Add weigh-in</a>`;
  const rows = [
    ['Gym sessions', vs(r.gym.done, r.gym.planned) + (r.gym.kg ? ` <span class="muted">· ${grp(r.gym.kg)} kg volume</span>` : '')],
    ['AWS study', vs(r.study.aws, r.study.plan?.aws, ' min')],
    ['Mandarin', vs(r.study.mandarin, r.study.plan?.mandarin, ' min')],
    ['Average protein', r.food.days ? `${r.food.p} g <span class="muted">target ${s.protein} g</span>` : '<span class="muted">No food logged</span>'],
    ['Average kcal', r.food.days ? `${grp(r.food.k)} <span class="muted">target ${grp(s.kcal)}</span>` : '<span class="muted">No food logged</span>'],
    ['Checklist days (all three)', `${r.checklist} of ${r.elapsed}`],
    ['Weigh-in', weigh],
  ];
  return `<a class="back" href="#/progress">Progress</a><h1 class="page-title">Your week</h1>
  <p class="muted">${dayLabel(r.monday)} – ${dayLabel(r.sunday)}${part}</p>
  <ul class="rules prog-review">${rows.map(([t, v]) => `<li><span class="muted">${t}</span><p class="num">${v}</p></li>`).join('')}</ul>
  ${r.food.days ? `<p class="muted">Food averages count only the ${plural(r.food.days, 'day')} with entries.</p>` : ''}
  <p class="note calm">Look at one thing to keep and one thing to adjust next week. That's the whole review.</p>
  <p><a href="#/progress">Back to progress</a></p>`;
}

// ---------- Today card ----------
export function todayCard(ctx) {
  const s = ctx.s, rd = ctx.rd, isWeigh = dow(rd) === s.weighDay, isSun = dow(rd) === 0;
  if (!isWeigh && !isSun) return '';
  let html = '';
  if (isWeigh) {
    const w = weighinOn(rd);
    html += w
      ? `<p><b>Weigh-in logged:</b> <span class="num">${[fin(w.kg) ? w.kg + ' kg' : '', fin(w.belly) ? 'belly ' + w.belly + ' cm' : ''].filter(Boolean).join(' · ') || 'measurements saved'}</span> <a href="#/progress/weigh/${rd}">Edit</a></p>`
      : `<p><b>Weigh-in today.</b> After you wake up, before eating or drinking.</p><p><a class="btn primary" href="#/progress/weigh">Log weigh-in</a></p>`;
  }
  if (isSun) html += `<p><a class="btn ghost" href="#/progress/review">2-minute weekly review</a></p>`;
  return `<section class="prog-today" aria-label="Progress">${html}</section>`;
}

// ---------- module ----------
function readForm(el) {
  const root = el.closest?.('[data-form="weigh"]') || globalThis.document;
  const val = id => root.querySelector(`#${id}`)?.value ?? '';
  const m = {}, bad = [];
  root.querySelectorAll('[data-measure]').forEach(inp => { const n = parseNum(inp.value); if (Number.isNaN(n)) bad.push(inp.dataset.measure); else if (n !== null) m[inp.dataset.measure] = n; });
  const kg = parseNum(val('prog-kg')), belly = parseNum(val('prog-belly'));
  if (Number.isNaN(kg)) bad.push('Weight'); if (Number.isNaN(belly)) bad.push('Belly');
  return { iso: val('prog-date') || el.dataset.iso, entry: { kg, belly, notes: val('prog-notes'), m }, bad };
}

export default {
  name: 'progress',
  async init() {
    try {
      const r = await fetch('data/exercises.json'); const j = await r.json();
      names = Object.fromEntries(Object.entries(j.exercises || {}).map(([id, x]) => [id, x?.name || id]));
    } catch { /* fall back to ids */ }
  },
  view(ctx, arg = '') {
    const [page, sub] = String(arg || '').split('/');
    try {
      if (page === 'weigh') return weighForm(ctx, sub);
      if (page === 'gym') return gymView(ctx);
      if (page === 'study') return studyView(ctx);
      if (page === 'habits') return habitsView(ctx);
      if (page === 'month') return monthView(ctx);
      if (page === 'review') return reviewView(ctx);
      return overview(ctx);
    } catch (e) {
      return `${head('')}<p class="note alert">This page couldn't load: ${esc(e.message)}. Your data is safe; export a backup from Settings.</p>`;
    }
  },
  async click(act, el, ctx) {
    if (act === 'prog-save') {
      const f = readForm(el);
      if (f.bad.length) { ctx.notify(`Check ${f.bad.join(', ')}: use a number like 68.4.`); return false; }
      if (!isIso(f.iso) || f.iso > (ctx.iso > ctx.rd ? ctx.iso : ctx.rd)) { ctx.notify('Pick today or an earlier date.'); return false; }
      const r = saveWeighin(f.iso, f.entry);
      if (!r.ok) { ctx.notify(r.error); return false; }
      weighIso = null; ctx.notify('Weigh-in saved'); ctx.go('#/progress'); return false; // go() re-renders
    }
    if (act === 'prog-delete') {
      const iso = el.dataset.iso;
      if (!isIso(iso) || !(await ask(`Delete the weigh-in of ${dayLabel(iso)}?`, { ok: 'Delete', danger: true }))) return false;
      deleteWeighin(iso); weighIso = null; ctx.notify('Weigh-in deleted'); ctx.go('#/progress'); return false;
    }
    if (act === 'prog-add-measure') {
      const root = el.closest?.('details') || globalThis.document, inp = root.querySelector('#prog-new-measure');
      const r = addMeasure(inp?.value);
      ctx.notify(r.ok ? `${r.name} added` : r.error);
      return r.ok;
    }
    if (act === 'prog-remove-measure') {
      const n = el.dataset.name;
      if (!n || !(await ask('Values you already saved stay in your data.', { title: `Remove ${n} from the form?`, ok: 'Remove' }))) return false;
      removeMeasure(n); return true;
    }
    return false;
  },
  change(act, el, ctx) {
    if (act === 'prog-weigh-date' && isIso(el.value)) { weighIso = el.value; ctx.go(`#/progress/weigh/${el.value}`); return false; }
    return false;
  },
};
