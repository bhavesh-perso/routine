// Gym module: planner (5-day rotation), running plan, exercise data, progression, PRs, and the gym screens.
// The active-session screen (guided logging, rest timer, wake lock, sound) lives in gym-session.js.
import { getDay } from './schedule.js';
import { get, update } from './storage.js';
import { gymSlotKey, wakeFor, bedFor, sleepFor, routineDayAt } from './plan.js';
import { toMin, fmt, addDays, esc, dayLabel, dayNum, isoOf, nowLocal, mondayOf } from './util.js';
import { lineChart } from './chart.js';
import * as S from './gym-session.js';
import { ask } from './sheet.js';
import * as R from './run.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fin = v => typeof v === 'number' && Number.isFinite(v);
export const SAFETY = "Stop if you feel chest pain, dizziness or can't catch your breath. See a doctor before continuing.";
export const PRE_GYM = 'Eat a meal 1–2 hours before. Drink about 500 ml of water during the session.';
export const WARMUP = '5-minute warm-up: march or walk on the spot, arm circles, hip circles, then 10 slow bodyweight squats.';

// ---------- exercise data ----------
let DATA = null;
export const setExerciseData = d => { DATA = d && d.exercises ? d : null; };
export const hasData = () => !!DATA;
export const EX = id => DATA?.exercises?.[id] || null;
export const exerciseName = id => EX(id)?.name || String(id ?? '');
export const templateFor = kind => DATA?.templates?.[kind] || [];
export const allExerciseIds = () => Object.keys(DATA?.exercises || {});
export const videoUrl = id => 'https://www.youtube.com/results?search_query=' + encodeURIComponent(exerciseName(id) + ' form');
const needsMet = (ex, eq) => (ex?.needs || []).every(k => eq.includes(k));
export const equipmentAt = (loc, s) => Array.isArray(s.equipment?.[loc]) ? s.equipment[loc] : [];
export const dumbbellsAt = (loc, s) => (Array.isArray(s.dumbbells?.[loc]) ? s.dumbbells[loc] : []).map(Number).filter(x => x > 0).sort((a, b) => a - b);
export const usesDumbbells = id => (EX(id)?.needs || []).includes('dumbbells');

// The exercise to do for a template slot at this gym: itself if its equipment is ticked,
// else the first alternative whose needs are met, else the first bodyweight alternative.
export function resolveExercise(id, loc, s) {
  const ex = EX(id), eq = equipmentAt(loc, s);
  if (!ex || needsMet(ex, eq)) return id;
  const alts = ex.alts || [];
  return alts.find(a => EX(a) && needsMet(EX(a), eq)) || alts.find(a => EX(a) && !(EX(a).needs || []).length) || id;
}

// ---------- writes (the gym area is the only area this module writes) ----------
let gymRef = null, pv = 0, wv = 0; // plan version (start/finish/skip/move) and write version (every write)
function sig() { const g = get('gym'); if (g !== gymRef) { gymRef = g; pv++; wv++; } return { pv, wv }; }
export function saveGym(fn, affectsPlan = false) {
  sig();
  const ok = update('gym', g => {
    g.sessions ||= {}; g.skips ||= {}; g.moves ||= {}; g.prefs ||= {};
    if (g.active === undefined) g.active = null;
    if (g.rest === undefined) g.rest = null;
    fn(g);
  });
  wv++; if (affectsPlan) pv++;
  return ok;
}
export const gymData = () => get('gym');

// ---------- planner ----------
let fixedToday = null;
export const _setToday = iso => { fixedToday = iso; };
export const currentRd = s => { if (fixedToday) return fixedToday; const { iso, min } = nowLocal(); return routineDayAt(iso, min, s); };
export const weekOf = (iso, s) => Math.floor((dayNum(iso) - dayNum(s.gym.start)) / 7) + 1;
export const isLightWeek = (w, s) => !!s.gym?.lightWeek && w >= 9 && (w - 9) % 8 === 0;
const DEF_SLOT = { nightWork: '07:50-08:50', nightOff: '18:00-19:15', morningWork: '19:15-20:00', morningOff: '17:00-18:15' };

// Planner rules (all in one place).
const MAX_WEEK = 5;       // sessions in any rolling 7 days
const MAX_RUN = 3;        // training routine-days in a row
const MAX_WORK_WEEK = 3;  // sessions on work days in any rolling 7 days
const MAX_TIGHT_WEEK = 2; // of those, tight (morning-shift evening) ones
const MIN_GAP = 20 * 60;  // minutes between the starts of two sessions
const KINDS = ['Upper', 'Lower', 'Push', 'Pull', 'Legs'];
const LEG = /^(Lower|Legs)$/;

const sKeys = new WeakMap();
function settingsKey(s) {
  let k = sKeys.get(s);
  if (!k) {
    k = JSON.stringify([s.gym, s.gymSlots, s.gymLoc, s.equipment, s.anchor, s.anchorBlock, s.blockLength, s.night, s.morning, s.overrides, s.sleep, s.switchPlan, s.drive]);
    sKeys.set(s, k);
  }
  return k;
}

// Static facts about a date for gym planning (depend on settings only), cached per settings.
// A slot that starts before that date's wake time is on the NEXT calendar morning (+1440): the
// session after a night shift. a/b are minutes from the date's midnight and may pass 1440.
let infoCache = { key: null, map: new Map() };
function dayInfo(n, s) {
  const key = settingsKey(s);
  if (infoCache.key !== key) infoCache = { key, map: new Map() };
  let i = infoCache.map.get(n);
  if (i) return i;
  const iso = isoOf(n), d = getDay(iso, s), slotKey = gymSlotKey(iso, s);
  const [ta, tb] = String(s.gymSlots?.[slotKey] || DEF_SLOT[slotKey]).split('-');
  let a = toMin(ta), b = toMin(tb); if (b <= a) b += 1440;
  const wake = wakeFor(iso, s), bed = bedFor(iso, s);
  const nextDay = a < wake;
  if (nextDay) { a += 1440; b += 1440; }
  let ok = b <= bed;
  if (d.type === 'work') {
    const S = toMin(d.shiftStart); let E = toMin(d.shiftEnd); if (E <= S) E += 1440;
    ok = nextDay ? ok && a >= E + (s.drive || 0) : ok && a >= wake && !(a < E && b > S);
  } else if (!nextDay) ok = ok && a >= wake;
  // Never between a night shift's end and the next main sleep: a nap day (the first day of a
  // switch to mornings) has its main sleep tonight, so it gets no session at all.
  const y = getDay(addDays(iso, -1), s);
  if (ok && y.endsNextDay && sleepFor(iso, s).nap) ok = false;
  i = { n, iso, type: d.type, block: d.block, slotKey, a, b, abs: n * 1440 + a, nextDay, ok, loc: s.gymLoc?.[slotKey] || (slotKey === 'morningWork' ? 'work' : 'home'), tight: slotKey === 'morningWork' };
  infoCache.map.set(n, i);
  return i;
}

// Can day n take a session, given which other days have one (has(m) -> boolean)?
// Checks the slot, the 20 h gap, 5 per rolling 7 days, work-day limits and the run of 3.
function allowed(n, i, s, has) {
  if (!i.ok) return false;
  for (let m = n - 2; m <= n + 2; m++) if (m !== n && has(m) && Math.abs(dayInfo(m, s).abs - i.abs) < MIN_GAP) return false;
  const cnt = (lo, hi, f) => { let c = 0; for (let m = lo; m <= hi; m++) if (m !== n && has(m) && f(dayInfo(m, s))) c++; return c; };
  const any = () => true, wk = x => x.type === 'work', tg = x => x.tight;
  for (let k = 0; k < 7; k++) {
    const lo = n - 6 + k, hi = n + k;
    if (cnt(lo, hi, any) + 1 > MAX_WEEK) return false;
    if (i.type === 'work' && cnt(lo, hi, wk) + 1 > MAX_WORK_WEEK) return false;
    if (i.tight && cnt(lo, hi, tg) + 1 > MAX_TIGHT_WEEK) return false;
  }
  let l = 0, r = 0; while (has(n - 1 - l)) l++; while (has(n + 1 + r)) r++;
  return l + r + 1 <= MAX_RUN;
}

let memo = { key: null, until: 0, list: [], byIso: new Map(), runs: new Map() };

function build(s, today, until) {
  const start = dayNum(s.gym.start), T = dayNum(today), g = get('gym');
  const all = Object.values(g.sessions || {}).filter(x => x && typeof x === 'object');
  const doneAt = new Map();
  for (const x of all) { const iso = x.planIso || x.rd; if (x.endedAt && ISO.test(iso || '')) doneAt.set(dayNum(iso), x); }
  const forced = new Set(doneAt.keys());
  const act = g.active ? g.sessions?.[g.active] : null;
  if (act && !act.endedAt && ISO.test(act.planIso || '')) forced.add(dayNum(act.planIso));
  const movedTo = new Map(), excluded = new Set(), skipDays = new Set();
  for (const [from, to] of Object.entries(g.moves || {})) if (ISO.test(from) && ISO.test(String(to))) { forced.add(dayNum(to)); movedTo.set(dayNum(to), from); excluded.add(dayNum(from)); }
  for (const k of Object.keys(g.skips || {})) if (ISO.test(k) && g.skips[k]) { excluded.add(dayNum(k)); skipDays.add(dayNum(k)); }

  const has = new Map(), slots = [];
  const occ = m => has.has(m) || (m >= start && forced.has(m));
  const count = (lo, hi, n) => { let c = 0; for (let m = lo; m <= hi; m++) if (m !== n && occ(m)) c++; return c; };
  // Off days take sessions freely. A work day only tops up: it is used when the 7 days around it
  // (3 before, 3 after) would still have room under the weekly cap once the off days that can
  // still take a session (slot ok, 20 h gap kept) are counted.
  const prefer = (n, i) => {
    if (i.type === 'off') return true;
    let ahead = 0;
    for (let m = n + 1; m <= n + 3; m++) { const j = dayInfo(m, s); if (j.type === 'off' && j.ok && j.abs - i.abs >= MIN_GAP) ahead++; }
    return count(n - 3, n - 1, n) + ahead + 1 <= MAX_WEEK;
  };
  let owed = [];
  for (let n = start; n <= until; n++) {
    const w = Math.floor((n - start) / 7) + 1, i = dayInfo(n, s);
    let place = forced.has(n);
    if (!place) {
      const ok = allowed(n, i, s, occ);
      if (excluded.has(n)) { if (skipDays.has(n) && ok && prefer(n, i)) owed.push(n); continue; }
      owed = owed.filter(d => n - d <= 7);
      if (ok && prefer(n, i)) place = true;
      else if (ok && n >= T && owed.length) { owed.shift(); place = true; } // a skipped session rolls to the next valid day
    }
    if (!place) continue;
    const light = isLightWeek(w, s), iso = isoOf(n), [st, en] = [fmt(i.a), fmt(i.b)];
    const done = doneAt.get(n) || null;
    const loc = done?.loc || (act && !act.endedAt && act.planIso === iso ? act.loc : i.loc);
    const x = {
      iso, n, kind: null, week: w, light, loc, start: st, end: en, time: `${st}–${en}`, nextDay: i.nextDay,
      len: i.b - i.a, tight: i.tight, type: i.type, block: i.block,
      cardio: 0, run: null,
      sets: w <= 2 || light ? 2 : 3, done: !!done, sessionId: done?.id || null, missed: false,
      movedFrom: movedTo.get(n) || null,
    };
    has.set(n, x); slots.push(x);
  }
  // Order: Upper, Lower, Push, Pull, Legs. It only moves forward when a session is logged. Missed
  // sessions keep their place, so the next one is the same workout. Future sessions project the order.
  // A logged session with an old kind (Full Body A/B) just advances the counter by one.
  let counter = 0;
  for (const x of slots) {
    const ses = doneAt.get(x.n);
    if (ses) {
      x.kind = ses.kind || KINDS[counter % KINDS.length];
      const k = KINDS.indexOf(ses.kind);
      counter = k >= 0 ? k + 1 : counter + 1;
    } else {
      x.kind = KINDS[counter % KINDS.length];
      if (x.n < T) x.missed = true; else counter++;
    }
  }
  return { list: slots, runs: planRuns(s, slots, until, start, g) };
}

// Running plan (data/run-plan.json): attaches runs to sessions (x.run, x.cardio = estimated minutes) and
// returns the standalone runs (long run / test on a free off day). Complete weeks only. Does not touch gym caps.
function planRuns(s, slots, until, start, g) {
  const out = [];
  if (!R.hasPlan()) return out;
  const race = R.racePaceOf(R.latestTest(g.runs)), byN = new Map(slots.map(x => [x.n, x]));
  for (let w = 1; start + 7 * w - 1 <= until; w++) {
    const lo = start + 7 * (w - 1), def = R.weekDef(w); if (!def) continue;
    const days = [];
    for (let n = lo; n < lo + 7; n++) {
      if (byN.has(n)) continue;
      const i = dayInfo(n, s); if (i.type !== 'off' || i.nextDay) continue;
      const nx = byN.get(n + 1);
      days.push({ iso: isoOf(n), n, ok: i.ok, beforeHard: !!nx && LEG.test(nx.kind || '') });
    }
    const a = R.assignWeek(w, slots.filter(x => x.week === w), days);
    R.KEYS.forEach((key, k) => {
      const t = a[key], d = def.runs?.[k]; if (!t || !d) return;
      const est = R.estMin(d, def.block, race), run = { key, week: R.runWeekOf(w), block: def.block, ...d, estMin: est };
      if (t.slot) {
        if (key === 'C' && d.type === 'test') { run.first = true; run.text = (run.text ? run.text + ' ' : '') + 'Do the time trial first, fresh. Then do a short lift: 2 sets per exercise.'; t.slot.sets = 2; }
        else if (d.type === 'long') run.text = (run.text ? run.text + ' ' : '') + 'Run after lifting, easy pace.';
        t.slot.run = run; t.slot.cardio = est; return;
      }
      const i = dayInfo(t.day.n, s);
      out.push({ ...run, iso: t.day.iso, n: t.day.n, gymWeek: w, standalone: true, loc: i.loc, start: fmt(i.a), end: fmt(i.a + Math.max(1, est)), len: i.b - i.a });
    });
  }
  return out;
}

// All planned sessions from the gym start date to ~200 days ahead. Memoised; cheap to call often.
export function planAll(s, untilIso = null) {
  const today = currentRd(s), { pv: p } = sig();
  const base = Math.max(dayNum(today), dayNum(s.gym.start)) + 200;
  const want = untilIso ? Math.max(base, dayNum(untilIso) + 30) : base;
  const key = settingsKey(s) + '|' + today + '|' + p + '|' + R.planVersion();
  if (memo.key === key && memo.until >= (untilIso ? dayNum(untilIso) : base)) return memo.list;
  const until = Math.max(want, memo.key === key ? memo.until : 0);
  const r = build(s, today, until);
  memo = { key, until, list: r.list, byIso: new Map(r.list.map(x => [x.iso, x])), runs: new Map(r.runs.map(x => [x.iso, x])) };
  return memo.list;
}
export function sessionFor(iso, s) {
  if (!ISO.test(iso || '') || iso < s.gym.start) return null;
  planAll(s, iso);
  return memo.byIso.get(iso) || null;
}
// ---------- running ----------
export const setRunData = d => { R.setRunPlan(d); };
export const hasRunData = () => R.hasPlan();
// The run on a date: attached to its gym session, or standalone. { ...run, iso, standalone, slot? } or null.
export function runOn(iso, s) {
  if (!ISO.test(iso || '') || iso < s.gym.start) return null;
  const slot = sessionFor(iso, s);
  if (slot?.run) return { ...slot.run, iso, standalone: false, slot };
  return memo.runs.get(iso) || null;
}
// Provider for plan.dayPlan: the standalone run of a date, or null.
export function runFor(iso, s) {
  if (!ISO.test(iso || '') || iso < s.gym.start) return null;
  planAll(s, iso);
  const r = memo.runs.get(iso);
  return r ? { title: r.title, start: r.start, end: r.end, km: r.km ?? null, key: r.key, estMin: r.estMin } : null;
}
// This gym week's runs: [{ key, def, iso|null, standalone, done }] for A, B, C.
export function weekRuns(w, s) {
  const def = R.weekDef(w); if (!def) return [];
  const list = planAll(s), runs = gymData().runs || {}, lo = addDays(s.gym.start, 7 * (w - 1)), hi = addDays(lo, 6);
  const got = {};
  for (const x of list) if (x.week === w && x.run) got[x.run.key] = { iso: x.iso, standalone: false, kind: x.kind };
  for (const r of memo.runs.values()) if (r.gymWeek === w) got[r.key] = { iso: r.iso, standalone: true };
  return R.KEYS.map((key, k) => {
    const g = got[key], d = def.runs?.[k]; if (!d) return null;
    const done = !!((g && runs[g.iso]) || Object.entries(runs).some(([iso, r]) => iso >= lo && iso <= hi && r?.key === key && !r.free));
    return { key, def: d, iso: g?.iso || null, standalone: !!g?.standalone, kind: g?.kind || null, done };
  }).filter(Boolean);
}
// Log (or edit) the run planned on a date. { ok } or { ok:false, error }.
// opts.free = { type: 'easy'|'long'|'test', today }: the "Log a run" form. A date with a planned run fills that one;
// any other date (not in the future) stores a free run of the chosen type.
const FREE = { easy: 'Easy run', long: 'Long run', test: 'Time trial' };
export function logRun(iso, km, min, s, now = Date.now(), opts = {}) {
  const r = ISO.test(iso || '') ? runOn(iso, s) : null, free = opts.free;
  if (!r && !free) return { ok: false, error: 'No run is planned on that day.' };
  if (!r && !FREE[free.type]) return { ok: false, error: 'Pick a run type.' };
  if (!r && !ISO.test(iso || '')) return { ok: false, error: 'Pick a valid date.' };
  if (free?.today && iso > free.today) return { ok: false, error: 'The date cannot be in the future.' };
  const err = R.validateRun(km, min); if (err) return { ok: false, error: err };
  const e = r ? { key: r.key, type: r.type, title: r.title } : { key: null, type: free.type, title: FREE[free.type], free: true };
  saveGym(g => { g.runs ||= {}; g.runs[iso] = { ...e, km: R.round2(km), min: R.round2(min), at: now }; }, true);
  return { ok: true };
}
export function deleteRun(iso) { return saveGym(g => { if (g.runs) delete g.runs[iso]; }, true); }
export const loggedRuns = () => gymData().runs || {};
export const racePace = () => R.racePaceOf(R.latestTest(loggedRuns()));

export const nextSession = (iso, s, inclusive = true) => planAll(s).find(x => inclusive ? x.iso >= iso : x.iso > iso) || null;
export function missedOn(iso, s, today = currentRd(s)) {
  const x = sessionFor(iso, s);
  return !!(x && !x.done && iso < today && !gymData().skips?.[iso]);
}

// Valid days for "Move to…": the next 7 days (from today, not before), no session already, rules kept.
export function moveTargets(iso, s, today = currentRd(s)) {
  const list = planAll(s, addDays(iso, 8)), start = dayNum(s.gym.start), from = dayNum(iso), T = dayNum(today);
  const occ = new Set(list.filter(x => x.n !== from).map(x => x.n));
  const out = [];
  for (let n = Math.max(T, from - 6, start); n <= from + 7; n++) {
    if (n === from || occ.has(n)) continue;
    if (allowed(n, dayInfo(n, s), s, m => occ.has(m))) out.push(isoOf(n));
  }
  return out;
}
export function moveSession(from, to) {
  return saveGym(g => {
    const orig = Object.keys(g.moves).find(k => g.moves[k] === from) || from;
    if (orig === to) delete g.moves[orig]; else g.moves[orig] = to;
    delete g.skips[to];
  }, true);
}
export function skipSession(iso) {
  return saveGym(g => {
    const orig = Object.keys(g.moves).find(k => g.moves[k] === iso);
    if (orig) { delete g.moves[orig]; g.skips[orig] = true; } else g.skips[iso] = true;
  }, true);
}
export function restoreSession(iso) {
  return saveGym(g => { delete g.skips[iso]; delete g.moves[iso]; }, true);
}

// ---------- history, progression, PRs ----------
let hMemo = { wv: -1, done: [] };
export function doneSessions() {
  const { wv: w } = sig();
  if (hMemo.wv !== w) {
    hMemo = { wv: w, done: Object.values(gymData().sessions || {}).filter(x => x && x.endedAt && ISO.test(x.rd || ''))
      .sort((a, b) => a.rd < b.rd ? -1 : a.rd > b.rd ? 1 : (a.startedAt || 0) - (b.startedAt || 0)) };
  }
  return hMemo.done;
}
export const repsOf = d => fin(d?.r) ? d.r : (fin(d?.rl) || fin(d?.rr)) ? Math.min(fin(d.rl) ? d.rl : Infinity, fin(d.rr) ? d.rr : Infinity) : 0;
export const totalReps = d => fin(d?.r) ? d.r : (d?.rl || 0) + (d?.rr || 0);
export const epley = (w, r) => r <= 0 ? 0 : r === 1 ? w : w * (1 + r / 30);
const r1 = x => Math.round(x * 10) / 10;
export const kg = w => String(Math.round(w * 100) / 100);

// Completed sessions that include this exercise, oldest first: { id, iso, light, sets:[working set], e1rm, top }
export function historyFor(exId) {
  const out = [];
  for (const x of doneSessions()) {
    const sets = (x.ex || []).filter(e => e.id === exId).flatMap(e => (e.sets || []).filter(st => st && st.type !== 'warm'));
    if (!sets.length) continue;
    const ds = sets.filter(st => st.done).map(st => st.done);
    const e1 = Math.max(0, ...ds.filter(d => fin(d.w) && d.w > 0).map(d => epley(d.w, repsOf(d))));
    out.push({ id: x.id, iso: x.rd, light: !!x.light, sets, done: ds, e1rm: r1(e1), feel: x.feel || null });
  }
  return out;
}

export const prefsFor = id => ({ inc: 2.5, round: usesDumbbells(id), ...(gymData().prefs?.[id] || {}) });
// Next weight up: +increment, rounded up to the next dumbbell that exists when rounding is on.
export function nextWeight(cur, inc, round, dbs) {
  const t = cur + inc;
  if (round && dbs.length) { const up = dbs.find(x => x >= t - 1e-9); return up ?? Math.max(cur, dbs.at(-1)); }
  return Math.round(t * 4) / 4;
}
// Nearest available weight (ties go lighter). Used for light weeks.
export function nearestWeight(x, dbs, isDb) {
  if (!isDb || !dbs.length) return Math.max(1.25, Math.round(x / 1.25) * 1.25);
  return dbs.reduce((b, d) => Math.abs(d - x) < Math.abs(b - x) - 1e-9 ? d : b, dbs[0]);
}
// 1–2 warm-up sets (~50%, ~75%) before the first big lift, only once the working weight is above
// the lightest dumbbell. Weights round down to what exists.
export function warmupWeights(w, dbs) {
  if (!fin(w) || !dbs.length || w <= dbs[0]) return [];
  const down = x => { const c = dbs.filter(d => d <= x + 1e-9); return c.length ? c.at(-1) : dbs[0]; };
  return [...new Set([down(w * 0.5), down(w * 0.75)])].filter(x => x < w);
}

// Suggestion for the next session of an exercise (addendum A5, A7, A8).
// reason: start | up | max | rpe | missed | build
export function suggest(exId, loc, s, hist = historyFor(exId).filter(h => !h.light)) {
  const ex = EX(exId); if (!ex) return { reason: 'start' };
  const [lo, hi] = ex.range || [8, 12], unit = ex.unit || 'kg';
  const metric = d => unit === 'time' ? (d.sec || 0) : repsOf(d);
  if (!hist.length) return unit === 'time' ? { reason: 'start', sec: lo } : { reason: 'start', w: null, r: lo };
  const last = hist.at(-1), prev = hist.at(-2);
  const vals = last.sets.filter(st => st.done).map(st => st.done);
  const allLogged = last.sets.length > 0 && last.sets.every(st => st.done);
  const top = allLogged && vals.every(d => metric(d) >= hi);
  const rpeHigh = vals.some(d => fin(d.rpe) && d.rpe >= 9);
  const below = h => h.sets.some(st => st.done && metric(st.done) < lo);
  const missedTwice = !!prev && below(last) && below(prev);
  const base = vals.length ? Math.min(...vals.map(metric)) : lo;
  if (unit === 'kg') {
    const lastW = Math.max(0, ...vals.map(d => fin(d.w) ? d.w : 0)) || null;
    if (!lastW) return { reason: 'start', w: null, r: lo };
    if (top && !rpeHigh) {
      const p = prefsFor(exId), nw = nextWeight(lastW, +p.inc || 2.5, p.round, dumbbellsAt(loc, s));
      return nw > lastW ? { reason: 'up', w: nw, r: lo } : { reason: 'max', w: lastW, r: hi };
    }
    if (top) return { reason: 'rpe', w: lastW, r: hi };
    if (missedTwice) return { reason: 'missed', w: lastW, r: lo };
    return { reason: 'build', w: lastW, r: Math.min(hi, Math.max(lo, base + 1)) };
  }
  const step = unit === 'time' ? 5 : 1, k = unit === 'time' ? 'sec' : 'r';
  const lastPlan = last.sets[0]?.plan?.[k] || lo;
  if (top && !rpeHigh) return { reason: 'up', [k]: base + step };
  if (top) return { reason: 'rpe', [k]: base };
  if (missedTwice) return { reason: 'missed', [k]: lastPlan };
  return { reason: 'build', [k]: Math.min(hi, Math.max(lo, base + step)) };
}
export function suggestText(exId, sg) {
  const ex = EX(exId), u = ex?.unit || 'kg';
  const tgt = u === 'time' ? `${sg.sec} s` : u === 'bw' ? `${sg.r} reps` : sg.w ? `${kg(sg.w)} kg × ${sg.r}` : '';
  return {
    start: u === 'kg' ? 'First time: pick a light weight you could lift about 15 times.' : `Start with ${tgt}.`,
    up: `You hit the top of the range on every set last time. Next: ${tgt}.`,
    max: `You're at the heaviest dumbbell here. Add reps instead: ${tgt}.`,
    rpe: `All reps done, but it felt very hard (effort 9 or more). Hold at ${tgt}.`,
    missed: `Reps fell short two sessions in a row. Hold at ${tgt}.`,
    build: `Aim for ${tgt}.`,
  }[sg.reason] || '';
}

// Personal records from a list of sessions (working sets only).
export function prsFrom(list) {
  const out = {};
  for (const x of list) for (const e of x.ex || []) for (const st of e.sets || []) {
    if (!st || st.type === 'warm' || !st.done) continue;
    const d = st.done, r = repsOf(d), iso = x.rd;
    const p = out[e.id] ||= { heaviest: null, e1rm: null, repsAt: {}, bwReps: null, hold: null };
    if (fin(d.w) && d.w > 0 && r > 0) {
      if (!p.heaviest || d.w > p.heaviest.w || (d.w === p.heaviest.w && r > p.heaviest.r)) p.heaviest = { w: d.w, r, iso };
      const v = r1(epley(d.w, r));
      if (!p.e1rm || v > p.e1rm.v) p.e1rm = { v, w: d.w, r, iso };
      if (!p.repsAt[d.w] || r > p.repsAt[d.w].r) p.repsAt[d.w] = { r, iso };
    } else if (r > 0) { if (!p.bwReps || r > p.bwReps.r) p.bwReps = { r, iso }; }
    else if (fin(d.sec) && d.sec > 0) { if (!p.hold || d.sec > p.hold.sec) p.hold = { sec: d.sec, iso }; }
  }
  return out;
}
let pMemo = { wv: -1, v: null };
export function prs() { const { wv: w } = sig(); if (pMemo.wv !== w) pMemo = { wv: w, v: prsFrom(doneSessions()) }; return pMemo.v; }
// Which records a new working set beats. Nothing is flagged the first time an exercise is logged.
export function checkPR(prior, d) {
  if (!prior || !d) return [];
  const r = repsOf(d), out = [];
  if (fin(d.w) && d.w > 0 && r > 0) {
    if (prior.heaviest && d.w > prior.heaviest.w) out.push('heaviest weight');
    else if (prior.repsAt[d.w] && r > prior.repsAt[d.w].r) out.push(`most reps at ${kg(d.w)} kg`);
    if (prior.e1rm && epley(d.w, r) > prior.e1rm.v + 0.05) out.push('best estimated 1RM');
    if (!prior.heaviest && !prior.e1rm) return [];
  } else if (r > 0) { if (prior.bwReps && r > prior.bwReps.r) out.push('most reps'); }
  else if (fin(d.sec) && prior.hold && d.sec > prior.hold.sec) out.push('longest hold');
  return out;
}
export function weekVolume(mondayIso) {
  const end = addDays(mondayIso, 6); let v = 0;
  for (const x of doneSessions()) if (x.rd >= mondayIso && x.rd <= end)
    for (const e of x.ex || []) for (const st of e.sets || []) if (st && st.type !== 'warm' && st.done && fin(st.done.w) && st.done.w > 0) v += st.done.w * totalReps(st.done);
  return r1(v);
}

// ---------- session building and length ----------
export const restLeft = (rest, now = Date.now()) => !rest || !fin(rest.startedAt) ? 0 : Math.max(0, Math.ceil(((rest.startedAt + (rest.sec || 0) * 1000) - now) / 1000));

// Exercises and planned sets for a planned session. opts.short: 2 sets, first 4 exercises.
export function buildExercises(slot, s, opts = {}) {
  const ids = templateFor(slot.kind).slice(0, opts.short ? 4 : undefined);
  const nSets = opts.short ? 2 : slot.sets, dbs = dumbbellsAt(slot.loc, s);
  let warmed = false;
  return ids.map(tid => {
    const id = resolveExercise(tid, slot.loc, s), ex = EX(id) || {}, unit = ex.unit || 'kg';
    const big = !!EX(tid)?.big, rest = slot.week === 1 ? 90 : big ? 90 : 60;
    const sg = suggest(id, slot.loc, s);
    const plan = { rest };
    if (unit === 'time') plan.sec = sg.sec;
    else {
      plan.r = sg.r;
      if (unit === 'kg') {
        plan.w = sg.w ?? null;
        if (slot.light) {
          const last = historyFor(id).filter(h => !h.light).at(-1);
          const lw = last ? Math.max(0, ...last.done.map(d => fin(d.w) ? d.w : 0)) : 0;
          plan.w = lw ? nearestWeight(lw * 0.8, dbs, usesDumbbells(id)) : null;
        }
      }
    }
    const sets = [];
    if (big && unit === 'kg' && !warmed) {
      warmed = true;
      for (const [k, w] of warmupWeights(plan.w, usesDumbbells(id) ? dbs : []).entries()) sets.push({ type: 'warm', plan: { w, r: k === 0 ? 8 : 5, rest: 60 }, done: null });
    }
    for (let k = 0; k < nSets; k++) sets.push({ type: 'work', plan: { ...plan }, done: null });
    return { id, ...(id !== tid ? { from: tid } : {}), sets };
  });
}
// Session length in minutes = sets × (work + rest) + warm-up + the attached run's minutes (addendum B16).
export function estimateMin(exList, cardio = 0, warm = 5) {
  let sec = 0;
  for (const e of exList) {
    const ex = EX(e.id) || {};
    for (const st of e.sets) {
      const work = st.plan?.sec ? st.plan.sec * (ex.oneSided ? 2 : 1) : (ex.oneSided ? 80 : 40);
      sec += work + (st.plan?.rest ?? 60);
    }
  }
  return Math.ceil(sec / 60) + warm + (cardio || 0);
}
export function planFor(slot, s) {
  const full = buildExercises(slot, s), est = estimateMin(full, slot.cardio);
  const shortEx = buildExercises(slot, s, { short: true }), shortEst = estimateMin(shortEx, 0);
  return { ex: full, est, fits: est <= slot.len, shortEx, shortEst };
}

// ---------- shared bits of UI ----------
export const locName = loc => loc === 'work' ? 'Gym near work' : 'Gym near home';
// Session time for the UI: the slot after a night shift is on the next calendar morning.
export const whenText = x => x.nextDay ? `Next morning ${x.time}, after the night shift` : x.time;
export function fmtDone(d, id) {
  if (!d) return '';
  const ex = EX(id) || {}, two = fin(d.rl) || fin(d.rr);
  const reps = two ? `${d.rl ?? '–'} left / ${d.rr ?? '–'} right` : `${d.r ?? '–'}`;
  let t = ex.unit === 'time' || (fin(d.sec) && !fin(d.r) && !two) ? `${d.sec} s` : fin(d.w) && d.w > 0 ? `${kg(d.w)} kg × ${reps}` : `${reps} reps`;
  if (fin(d.rpe)) t += ` · effort ${d.rpe}`;
  return t;
}
export function fmtPlan(p, id) {
  const ex = EX(id) || {}, side = ex.oneSided ? ' each side' : ex.perSide ? ' per side' : '';
  if (ex.unit === 'time') return `${p.sec} s`;
  if (ex.unit === 'bw') return `${p.r} reps${side}`;
  return `${p.w ? kg(p.w) + ' kg' : 'choose weight'} × ${p.r}${side}`;
}
function weekLine(x, s) {
  let t = `Week ${x.week}`;
  if (x.light) t += ' · Light week: same moves, 2 sets, about 80% of your last weights. This is planned recovery.';
  else if (x.week === 1) t += ' · First week: 2 sets per move, 90 s rest.';
  else if (x.week <= 2) t += ' · Keep it easy: effort 6–7 out of 10.';
  return t;
}
const moveChips = (iso, s) => {
  const t = moveTargets(iso, s);
  if (!t.length) return '<p class="muted">No valid day in the next week. Skip it instead, and it rolls to the next valid day.</p>';
  return `<div class="chips" role="group" aria-label="Move the session to">${t.map(d => `<button type="button" class="btn small" data-act="gym-move-to" data-from="${iso}" data-to="${d}">${esc(dayLabel(d))}</button>`).join('')}</div>`;
};
let moving = null;
const actions = (x, s) => x.done || x.missed ? '' : `<div class="row gym-acts"><button type="button" class="btn small" data-act="gym-move-open" data-iso="${x.iso}" aria-expanded="${moving === x.iso}">Move to…</button><button type="button" class="btn small ghost" data-act="gym-skip" data-iso="${x.iso}">Skip</button></div>${moving === x.iso ? moveChips(x.iso, s) : ''}`;

export function activeSession() {
  const g = gymData(), x = g.active ? g.sessions?.[g.active] : null;
  return x && !x.endedAt ? x : null;
}

// ---------- running UI bits ----------
const runDoneText = iso => { const l = loggedRuns()[iso]; return l ? R.fmtResult(l) : ''; };
const runLine = x => { const d = runDoneText(x.iso); return `<p class="muted">Plus run: ${esc(x.run.title)}, about ${x.run.estMin} min. ${d ? 'Logged: ' + esc(d) + '.' : ''} <a href="#/gym/run/${x.iso}">${d ? 'See run' : 'Run details'}</a></p>`; };
function standaloneRun(r) {
  const d = runDoneText(r.iso);
  return `<p><b>Run</b> · ${esc(r.title)} · <span class="num">${r.start}–${r.end}</span></p><p class="muted">${esc(r.text || '')}</p>${d ? `<p class="note calm">Logged: ${esc(d)}</p>` : ''}
  <div class="row"><a class="btn primary" href="#/gym/run/${r.iso}">${d ? 'See run' : 'Open run and log it'}</a></div>`;
}

// ---------- Today card ----------
export function todayCard(ctx) {
  const s = ctx.s, act = activeSession();
  if (!hasData()) return '<p class="muted">Exercise data is still loading.</p>';
  if (act) return `<p><b>${esc(act.kind || 'Session')}</b> in progress, started ${fmt(nowLocal(act.startedAt).min)}.</p><a class="btn primary" href="#/gym/session">Resume session</a>`;
  if (ctx.rd < s.gym.start) return `<p>Rest day.</p><p class="muted">Your gym plan starts ${esc(dayLabel(s.gym.start))}.</p>`;
  const x = sessionFor(ctx.rd, s);
  if (!x) {
    const sr = runOn(ctx.rd, s);
    if (sr) return standaloneRun(sr);
    const nx = nextSession(ctx.rd, s, false);
    return `<p>Rest day.</p>${nx ? `<p class="muted">Next session: ${esc(dayLabel(nx.iso))}, ${esc(nx.kind)} (${esc(locName(nx.loc).toLowerCase())}), ${whenText(nx)}.</p>` : ''}`;
  }
  if (x.done) return `<p><b>${esc(x.kind)}</b> done.</p>${x.run ? runLine(x) : ''}${x.sessionId ? `<a class="btn small" href="#/gym/summary/${esc(x.sessionId)}">See summary</a>` : ''}`;
  return `<p><b>${esc(x.kind)}</b> · ${locName(x.loc)} · <span class="num">${whenText(x)}</span></p>
  <p class="muted">${esc(weekLine(x, s))}</p>
  ${x.tight ? '<p class="muted">Tight day: the work gym slot is short. The session screen offers a shorter version if it won\'t fit.</p>' : ''}
  ${x.run ? runLine(x) : ''}
  <div class="row"><a class="btn primary" href="#/gym/session">Start session</a><a class="btn small ghost" href="#/gym/day/${x.iso}">Preview</a></div>`;
}

// ---------- screens ----------
function overview(ctx) {
  const s = ctx.s, rd = ctx.rd, act = activeSession();
  const w = Math.max(1, weekOf(rd, s)), started = rd >= s.gym.start, list = planAll(s);
  const today = sessionFor(rd, s), up = list.filter(x => x.iso > rd).slice(0, 8);
  const skipped = Object.keys(gymData().skips || {}).filter(d => d >= addDays(rd, -1)).sort();
  const missed = list.filter(x => x.missed && x.iso >= addDays(rd, -7));
  let head = started ? `Week ${w}${isLightWeek(w, s) ? ' · Light week' : ''}` : `Starts ${dayLabel(s.gym.start)}`;
  let main = '';
  if (act) main = `<section class="tile gym-now"><h2>Session in progress</h2><p>${esc(act.kind || 'Session')} · ${locName(act.loc)}</p><a class="btn primary wide" href="#/gym/session">Resume session</a></section>`;
  else if (today && !today.done) main = `<section class="tile gym-now"><h2>Today: ${esc(today.kind)}</h2><p>${locName(today.loc)} · <span class="num">${whenText(today)}</span>${today.run ? ` · plus run ${today.run.estMin} min` : ''}</p>
    <p class="muted">${esc(weekLine(today, s))}</p><div class="row"><a class="btn primary" href="#/gym/session">Start session</a><a class="btn ghost" href="#/gym/day/${today.iso}">Preview</a></div>${actions(today, s)}</section>`;
  else if (!today && runOn(rd, s)) main = `<section class="tile gym-now"><h2>Today: run</h2>${standaloneRun(runOn(rd, s))}</section>`;
  else {
    const nx = nextSession(rd, s, false);
    main = `<section class="gym-now"><h2>${today?.done ? `Today's ${esc(today.kind)} is done` : 'Rest day today'}</h2>${nx ? `<p>Next: <b>${esc(nx.kind)}</b>, ${esc(dayLabel(nx.iso))} · ${locName(nx.loc)} · <span class="num">${whenText(nx)}</span></p>
      <div class="row"><a class="btn small" href="#/gym/day/${nx.iso}">Preview</a>${moveTargets(nx.iso, s).includes(rd) ? `<button type="button" class="btn small" data-act="gym-move-to" data-from="${nx.iso}" data-to="${rd}">Do it today instead</button>` : ''}</div>` : ''}</section>`;
  }
  return `<h1 class="page-title">Gym</h1><p class="muted">${esc(head)}</p>
  ${main}
  ${missed.length ? `<p class="note calm">Missed: ${missed.map(x => esc(dayLabel(x.iso))).join(', ')}. The order waits for you, so the next session is the same workout.</p>` : ''}
  <section aria-labelledby="gy-up"><h2 id="gy-up">Coming up</h2>
  ${up.length ? `<ul class="rules gym-up">${up.map(x => `<li><a class="go" href="#/gym/day/${x.iso}"><span class="grow"><b>${esc(dayLabel(x.iso))}</b> · ${esc(x.kind)}
    <span class="muted">${locName(x.loc)}${x.light ? ' · light week' : ''}${x.run ? ` · plus run ${x.run.estMin} min` : ''}${x.tight ? ' · tight day' : ''}${x.movedFrom ? ` · moved from ${esc(dayLabel(x.movedFrom))}` : ''}${x.nextDay ? ' · next morning, after the night shift' : ''}</span></span><span class="muted num">${x.time}</span></a></li>`).join('')}</ul>
    <p class="muted">Tap a session to preview, move or skip it.</p>` : '<p class="muted">Nothing planned yet.</p>'}
  ${skipped.length ? `<h3>Skipped</h3><ul class="rules">${skipped.map(d => `<li class="row"><span class="grow">${esc(dayLabel(d))}</span><button type="button" class="btn small ghost" data-act="gym-restore" data-iso="${d}">Restore</button></li>`).join('')}</ul>` : ''}
  </section>
  ${runningCard(ctx)}
  <section><h2>More</h2><div class="row"><a class="btn" href="#/gym/ex">Exercises and how-to</a><a class="btn" href="#/gym/history">Past sessions</a></div></section>
  <details class="fold"><summary>How the plan works</summary>
  <p>Five workouts in a rotation from week 1: Upper, Lower, Push, Pull, Legs. Up to 5 sessions in any 7 days, off days first. Work days can take up to 3 of them, and at most 2 of those on the short evening slot after a morning shift.</p>
  <p>After a night shift the session is the next morning, once you are home and showered. Never more than 3 training days in a row, and at least 20 hours between two session starts.</p>
  <p>Skipping keeps your place in the order and rolls the session to the next valid day. Every 8 weeks from week 9 there's a planned light week.</p></details>`;
}

function runningCard(ctx) {
  const s = ctx.s;
  if (!R.hasPlan()) return '';
  const g = R.goal(), started = ctx.rd >= s.gym.start, w = Math.max(1, weekOf(ctx.rd, s)), rw = R.runWeekOf(w), block = R.blockOf(w);
  const runs = loggedRuns(), test = R.latestTest(runs), race = R.racePaceOf(test), nt = R.nextTest(w);
  const b5 = R.bestOver(runs, 5), b10 = R.bestOver(runs, 10);
  const items = started ? weekRuns(w, s) : [];
  const li = r => {
    const when = r.done ? 'done' : r.iso ? `${dayLabel(r.iso)}${r.standalone ? '' : ' with ' + (r.kind || 'gym')}` : 'not scheduled this week';
    const inner = `<span class="grow"><b>${esc(r.def.title)}</b> <span class="muted">${esc(when)}</span></span>`;
    return r.iso ? `<li><a class="go" href="#/gym/run/${r.iso}">${inner}</a></li>` : `<li class="row">${inner}</li>`;
  };
  return `<section class="gym-running" aria-labelledby="gy-run"><h2 id="gy-run">Running</h2>
  <p><b>${esc(block)}</b> · week ${rw}${w > 52 ? ' (repeat)' : ''} <span class="muted">· goal ${g.km} km under ${g.min} min</span></p>
  <p class="muted">${esc(R.blockText(block))}</p>
  ${items.length ? `<ul class="rules">${items.map(li).join('')}</ul>` : started ? '' : `<p class="muted">Runs start with the gym plan on ${esc(dayLabel(s.gym.start))}.</p>`}
  <p>${test ? `Latest test: <b class="num">${esc(R.fmtResult(test))}</b> <span class="muted">${esc(dayLabel(test.iso))}. Race pace ${R.fmtPace(race)}/km.</span>` : 'No test yet. Your first test run sets your paces.'}</p>
  ${nt ? `<p class="muted">Next test: week ${nt.gymWeek}, ${esc(nt.def.title)}${nt.def.goal ? ', goal under ' + nt.def.goal + ' min' : ''}.</p>` : ''}
  <p class="muted num">Best 5 km: ${b5 ? R.fmtTime(b5.min) : '–'} · Best 10 km: ${b10 ? R.fmtTime(b10.min) : '–'}</p>
  ${S.freeRunForm(ctx.rd)}</section>`;
}

function exList(ex, opts = {}) {
  return `<ol class="rules gym-plan">${ex.map(e => {
    const w = e.sets.filter(st => st.type === 'work'), wu = e.sets.filter(st => st.type === 'warm');
    return `<li><a href="#/gym/ex/${esc(e.id)}"><b>${esc(exerciseName(e.id))}</b></a>${e.from ? ` <span class="muted">(instead of ${esc(exerciseName(e.from))})</span>` : ''}
    <p class="muted num">${w.length} × ${esc(fmtPlan(w[0]?.plan || {}, e.id))} · rest ${w[0]?.plan?.rest || 60} s${wu.length ? ` · ${wu.length} warm-up set${wu.length > 1 ? 's' : ''} first` : ''}</p>
    ${opts.tips ? `<p class="muted">${esc(suggestText(e.id, suggest(e.id, opts.loc, opts.s)))}</p>` : ''}</li>`;
  }).join('')}</ol>`;
}

export function preview(ctx, iso, withStart = false) {
  const s = ctx.s, x = sessionFor(iso, s);
  if (!x) return `<p class="note calm">No gym session planned on ${esc(dayLabel(iso))}.</p>`;
  const p = planFor(x, s);
  const fit = x.tight || !p.fits ? (p.fits ? `<p class="muted">About ${p.est} min. Fits the ${x.len}-minute slot.</p>`
    : `<p class="note">About ${p.est} min, longer than the ${x.len}-minute slot. A shorter version (2 sets, fewer accessories, no run) takes about ${p.shortEst} min.</p>`) : `<p class="muted">About ${p.est} min including warm-up${x.run ? ' and the run' : ''}.</p>`;
  const start = withStart ? `<div class="row"><button type="button" class="btn primary" data-act="gym-start" data-iso="${iso}">Start session</button>${!p.fits ? `<button type="button" class="btn" data-act="gym-start" data-iso="${iso}" data-short="1">Start shorter version</button>` : ''}</div>` : '';
  return `<p>${locName(x.loc)} · <span class="num">${whenText(x)}</span>${x.tight ? ' · tight day' : ''}</p>
  <p class="muted">${esc(weekLine(x, s))}</p>${fit}
  <p class="note calm">${esc(PRE_GYM)}</p>
  <p><b>Warm-up.</b> ${esc(WARMUP)}</p>
  ${exList(p.ex, { tips: true, loc: x.loc, s })}
  ${x.run ? `<section class="gym-run"><p><b>Run.</b> ${esc(x.run.title)} · about ${x.run.estMin} min</p>${S.runBody(x.run, racePace())}<p><a href="#/gym/run/${x.iso}">Log this run</a></p></section>` : ''}
  <p class="note alert">${esc(SAFETY)}</p>${start}`;
}

function dayView(ctx, iso) {
  if (!ISO.test(iso)) return `<h1 class="page-title">Gym</h1><p class="note">That date isn't valid. <a href="#/gym">Back to gym</a></p>`;
  const x = sessionFor(iso, ctx.s);
  return `<a class="back" href="#/gym">Gym</a><h1 class="page-title">${esc(x ? x.kind : runOn(iso, ctx.s) ? 'Run' : 'Rest day')}</h1><p class="muted">${esc(dayLabel(iso))}${x?.done ? ' · done' : x?.missed ? ' · missed' : ''}</p>
  ${!x && runOn(iso, ctx.s) ? standaloneRun(runOn(iso, ctx.s)) : preview(ctx, iso, !!x && iso === ctx.rd && !x.done && !activeSession())}
  ${x && iso > ctx.rd && !x.done ? actions(x, ctx.s) : ''}`;
}

function exIndex() {
  const used = new Set(Object.values(DATA?.templates || {}).flat());
  const row = id => `<li><a href="#/gym/ex/${esc(id)}">${esc(exerciseName(id))}</a></li>`;
  const ids = allExerciseIds().sort((a, b) => exerciseName(a).localeCompare(exerciseName(b)));
  return `<a class="back" href="#/gym">Gym</a><h1 class="page-title">Exercises</h1>
  <h2>In your plan</h2><ul class="rules">${ids.filter(i => used.has(i)).map(row).join('')}</ul>
  <h2>Alternatives</h2><p class="muted">Used when equipment isn't ticked for a gym, or when you swap mid-session.</p><ul class="rules">${ids.filter(i => !used.has(i)).map(row).join('')}</ul>`;
}

export function howTo(id) {
  const e = EX(id) || {};
  return `<dl class="gym-how"><dt>Setup</dt><dd>${esc(e.setup)}</dd><dt>The movement</dt><dd>${esc(e.move)}</dd><dt>Breathing</dt><dd>${esc(e.breathe)}</dd><dt>Common mistake</dt><dd>${esc(e.mistake)}</dd><dt>Cue</dt><dd>${esc(e.cue)}</dd></dl>
  <a class="btn small" target="_blank" rel="noopener" href="${esc(videoUrl(id))}">Watch form video</a>`;
}

function exView(ctx, id) {
  if (!id) return exIndex();
  const e = EX(id);
  if (!e) return `<a class="back" href="#/gym/ex">Exercises</a><h1 class="page-title">Not found</h1><p class="note">There's no exercise called "${esc(id)}".</p>`;
  const s = ctx.s, hist = historyFor(id), pr = prs()[id], p = prefsFor(id), loc = nextSession(ctx.rd, s)?.loc || 'home';
  const unitTxt = e.unit === 'time' ? 'Timed hold, logged in seconds.' : e.unit === 'bw' ? 'Bodyweight, logged in reps.' : usesDumbbells(id) ? 'Logged in kg per dumbbell (the weight of one dumbbell).' : 'Logged in kg.';
  const rng = e.unit === 'time' ? `${e.range[0]}–${e.range[1]} s` : `${e.range[0]}–${e.range[1]} reps${e.oneSided ? ' each side' : e.perSide ? ' per side' : ''}`;
  const pts = e.unit === 'kg' ? hist.filter(h => h.e1rm > 0).map(h => ({ x: h.iso, y: h.e1rm }))
    : hist.map(h => ({ x: h.iso, y: Math.max(0, ...h.done.map(d => e.unit === 'time' ? d.sec || 0 : repsOf(d))) })).filter(q => q.y > 0);
  const chart = pts.length ? lineChart(pts, { label: e.unit === 'kg' ? `${e.name} best estimated 1RM per session` : `${e.name} best set per session`, unit: e.unit === 'kg' ? ' kg' : e.unit === 'time' ? ' s' : ' reps', decimals: 1 }) : '<p class="muted">Log this exercise to see a chart.</p>';
  const prLines = [];
  if (pr?.heaviest) prLines.push(`Heaviest: <b class="num">${kg(pr.heaviest.w)} kg × ${pr.heaviest.r}</b> <span class="muted">${esc(dayLabel(pr.heaviest.iso))}</span>`);
  if (pr?.e1rm) prLines.push(`Best estimated 1RM: <b class="num">${pr.e1rm.v} kg</b> <span class="muted">from ${kg(pr.e1rm.w)} kg × ${pr.e1rm.r}</span>`);
  if (pr && Object.keys(pr.repsAt).length) prLines.push('Most reps: ' + Object.keys(pr.repsAt).map(Number).sort((a, b) => b - a).map(w => `<span class="num">${kg(w)} kg × ${pr.repsAt[w].r}</span>`).join(' · '));
  if (pr?.bwReps) prLines.push(`Most reps: <b class="num">${pr.bwReps.r}</b> <span class="muted">${esc(dayLabel(pr.bwReps.iso))}</span>`);
  if (pr?.hold) prLines.push(`Longest hold: <b class="num">${pr.hold.sec} s</b> <span class="muted">${esc(dayLabel(pr.hold.iso))}</span>`);
  const prefs = e.unit !== 'kg' ? '' : `<section aria-labelledby="gx-p"><h2 id="gx-p">Progression</h2>
    <p class="muted">When you hit the top of the range on every set, the next session adds this much.</p>
    <div class="chips" role="group" aria-label="Increment">${[1, 1.25, 2, 2.5, 5].map(v => `<button type="button" class="btn small" data-act="gym-pref-inc" data-id="${esc(id)}" data-v="${v}" aria-pressed="${+p.inc === v}">+${v} kg</button>`).join('')}</div>
    <label class="toggle"><input type="checkbox" data-act="gym-pref-round" data-id="${esc(id)}" ${p.round ? 'checked' : ''}> Round up to the next dumbbell that exists</label></section>`;
  const alts = (e.alts || []).filter(a => EX(a));
  return `<a class="back" href="#/gym/ex">Exercises</a><h1 class="page-title">${esc(e.name)}</h1>
  <p class="muted">${esc(rng)}. ${esc(unitTxt)}</p>
  <p>${esc(suggestText(id, suggest(id, loc, s)))}</p>
  ${howTo(id)}
  ${alts.length ? `<p class="muted">Alternatives: ${alts.map(a => `<a href="#/gym/ex/${esc(a)}">${esc(exerciseName(a))}</a>`).join(', ')}</p>` : ''}
  ${prefs}
  <section aria-labelledby="gx-c"><h2 id="gx-c">Progress</h2>${chart}</section>
  <section aria-labelledby="gx-r"><h2 id="gx-r">Personal records</h2>${prLines.length ? `<ul class="rules">${prLines.map(l => `<li>${l}</li>`).join('')}</ul>` : '<p class="muted">Your records appear after your first logged working set.</p>'}</section>
  <section aria-labelledby="gx-h"><h2 id="gx-h">Past sessions</h2>${hist.length ? `<ul class="rules">${hist.slice().reverse().map(h => `<li><a href="#/gym/summary/${esc(h.id)}">${esc(dayLabel(h.iso))}</a>${h.light ? ' <span class="tag">light</span>' : ''}<p class="muted num">${h.done.map(d => esc(fmtDone(d, id))).join(' · ') || 'No sets logged'}</p></li>`).join('')}</ul>` : '<p class="muted">No sessions yet.</p>'}</section>`;
}

function historyView() {
  const list = doneSessions().slice().reverse();
  return `<a class="back" href="#/gym">Gym</a><h1 class="page-title">Past sessions</h1>
  ${list.length ? `<ul class="rules">${list.map(x => {
    const t = S.sessionTotals(x);
    return `<li><a href="#/gym/summary/${esc(x.id)}"><b>${esc(dayLabel(x.rd))}</b> · ${esc(x.kind || 'Session')}</a>${x.light ? ' <span class="tag">light</span>' : ''}${x.short ? ' <span class="tag">short</span>' : ''}
    <p class="muted num">${locName(x.loc)}${t.min ? ` · ${t.min} min` : ''} · ${t.sets} sets · ${t.kg} kg${x.feel ? ` · felt ${esc(x.feel)}` : ''}</p></li>`;
  }).join('')}</ul>` : '<p class="note calm">No finished sessions yet. Your first one is on the Gym tab.</p>'}`;
}

export default {
  name: 'gym',
  async init() {
    try { const r = await fetch('data/exercises.json'); setExerciseData(await r.json()); }
    catch { /* view shows a message */ }
    try { const r = await fetch('data/run-plan.json'); setRunData(await r.json()); }
    catch { /* no running plan: no runs */ }
  },
  view(ctx, arg = '') {
    if (!hasData()) return '<h1 class="page-title">Gym</h1><p class="note">Exercise data did not load. Reload the app to try again.</p>';
    const [page, sub] = String(arg || '').split('/');
    if (page === 'session') return S.sessionView(ctx);
    if (page === 'summary') return S.summaryView(ctx, sub);
    if (page === 'run') return S.runView(ctx, sub);
    if (page === 'day') return dayView(ctx, sub);
    if (page === 'ex') return exView(ctx, sub);
    if (page === 'history') return historyView();
    return overview(ctx);
  },
  async click(act, el, ctx) {
    const d = el.dataset;
    if (act === 'gym-move-open') { moving = moving === d.iso ? null : d.iso; return true; }
    if (act === 'gym-move-to') { moveSession(d.from, d.to); moving = null; ctx.notify(`Moved to ${dayLabel(d.to)}`); return true; }
    if (act === 'gym-skip') { if (await ask('It keeps its place in the order and rolls to the next valid day.', { title: 'Skip this session?', ok: 'Skip' })) { skipSession(d.iso); ctx.notify('Skipped'); } return true; }
    if (act === 'gym-restore') { restoreSession(d.iso); ctx.notify('Restored'); return true; }
    if (act === 'gym-pref-inc') { saveGym(g => { g.prefs[d.id] = { ...prefsFor(d.id), inc: +d.v }; }); return true; }
    if (act.startsWith('gym-run-')) return S.runClick(act, el, ctx);
    return S.sessionClick(act, el, ctx);
  },
  change(act, el) {
    if (act === 'gym-pref-round') { saveGym(g => { g.prefs[el.dataset.id] = { ...prefsFor(el.dataset.id), round: !!el.checked }; }); return true; }
    return false;
  },
  mounted(ctx) { S.mounted(ctx); },
};
