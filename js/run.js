// Running plan: pure helpers (no DOM, no storage). The 52-week plan lives in data/run-plan.json.
// Assignment of runs to gym sessions, pace maths (Riegel), time estimates and logging validation.
// gym.js calls these from the planner; gym-session.js renders the cards.
let PLAN = null, ver = 0;
export const KEYS = ['A', 'B', 'C'];
export const setRunPlan = p => { PLAN = p && Array.isArray(p.weeks) && p.weeks.length ? p : null; ver++; };
export const hasPlan = () => !!PLAN;
export const planVersion = () => ver;
export const planData = () => PLAN;

const fin = v => typeof v === 'number' && Number.isFinite(v);
const LEG = /^(Lower|Legs)$/;

// Run week = gym week; after week 52 the plan repeats weeks 41-52.
export const runWeekOf = w => w < 1 ? 1 : w <= 52 ? w : 41 + ((w - 41) % 12);
export const weekDef = w => PLAN?.weeks?.[runWeekOf(w) - 1] || null;
export const blockOf = w => weekDef(w)?.block || '';
export const blockText = name => PLAN?.blocks?.[name] || '';
export const goal = () => PLAN?.goal || { km: 10, min: 45 };

// ---------- assignment ----------
// w: gym week. sessions: that week's gym sessions in date order ({ iso, n, kind, type, tight, nextDay }).
// days: free days of the week (off days with no gym session) as { iso, n, beforeHard, ok } in date order; ok:false
// means the gym slot is not usable that day (still fine for a run).
// Returns { A, B, C } where each is null, { slot } (attached to that session) or { day } (standalone).
// Weeks 1-11: A, B, C attach in date order, extras dropped from the end.
// Week 12 on: C (the long run or time trial) is placed first and never dropped while any non-leg session or free
// day exists, then B, then A (A drops first, then B).
//   C chain: standalone on a free off day (ok slot) > off-day Upper/Push/Pull > any non-tight one (next-morning last)
//   > standalone on any other free off day > the last non-leg session of the week, even if tight.
export function assignWeek(w, sessions, days = []) {
  const out = { A: null, B: null, C: null };
  const nonLeg = sessions.filter(x => !LEG.test(x.kind || '')), ok = nonLeg.filter(x => !x.tight);
  if (w < 12) { KEYS.forEach((k, i) => { if (ok[i]) out[k] = { slot: ok[i] }; }); return out; }
  const pool = ok.slice(), rank = x => x.type === 'off' ? 0 : x.nextDay ? 2 : 1;
  const best = () => { let bi = -1; pool.forEach((x, i) => { if (bi < 0 || rank(x) < rank(pool[bi])) bi = i; }); return bi; };
  const free = days.filter(d => d.ok !== false), other = days.filter(d => d.ok === false);
  const dayC = free.find(d => !d.beforeHard) || free[0];
  if (dayC) out.C = { day: dayC };
  else if (pool.length) out.C = { slot: pool.splice(best(), 1)[0] };
  else if (other.length) out.C = { day: other[0] };
  else if (nonLeg.length) out.C = { slot: nonLeg[nonLeg.length - 1] };
  if (pool.length) out.B = { slot: pool.splice(best(), 1)[0] };
  if (pool.length) out.A = { slot: pool[0] };
  return out;
}

// ---------- pace maths ----------
export const riegel10k = (sec, km) => sec * Math.pow(10 / km, 1.06);
export function fmtPace(sec) {
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
export const fmtKmh = sec => (Math.round(3600 / sec * 10) / 10).toFixed(1);
// Minutes (decimal) -> "47:30" or "1:02:10".
export function fmtTime(min) {
  const t = Math.round(min * 60), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const dist = km => `${Math.round(km * 100) / 100} km`;
export const fmtResult = r => `${dist(r.km)} in ${fmtTime(r.min)} (${fmtPace(r.min * 60 / r.km)}/km)`;

// Latest logged time trial: { iso, km, min } or null. runs = gym.runs.
export function latestTest(runs) {
  let best = null;
  for (const [iso, r] of Object.entries(runs || {})) {
    if (!r || r.type !== 'test' || !fin(r.km) || !fin(r.min) || r.km <= 0 || r.min <= 0) continue;
    if (!best || iso > best.iso || (iso === best.iso && (r.at || 0) > (best.at || 0))) best = { iso, km: r.km, min: r.min, at: r.at || 0 };
  }
  return best;
}
// 10 km race pace in s/km from a test, or null.
export function racePaceOf(test) {
  if (!test) return null;
  return riegel10k(test.min * 60, test.km) / 10;
}
export const easyPaceOf = (race, block) => race != null ? race + (PLAN?.paceOffset?.easy ?? 75) : (PLAN?.easyPace?.[block] ?? 420);
export function targetPace(kind, race) {
  const off = PLAN?.paceOffset?.[kind];
  return race == null || !fin(off) ? null : race + off;
}
export const paceText = sec => `${fmtPace(sec)}/km · treadmill ${fmtKmh(sec)} km/h · incline 1%`;

// Target lines for a run def, given the race pace (null before any test). Array of plain strings.
export function targetLines(def, race) {
  const out = [];
  const p = def?.pace ? targetPace(def.pace, race) : null;
  if (p != null) out.push(`Target pace: ${paceText(p)}`);
  if (def?.type === 'walkrun') out.push('Treadmill: run 7.5–8.5 km/h, walk 5.5–6 km/h, incline 1%');
  else if (p == null && def?.pace === 'easy') out.push('Treadmill: about 8–9 km/h, incline 1%, talk test decides');
  return out;
}

// Estimated minutes of a run: def.min, else km x easy pace (+10 min warm-up and cool-down for tests).
export function estMin(def, block, race) {
  if (fin(def?.min)) return def.min;
  if (!fin(def?.km)) return 0;
  return Math.round(def.km * easyPaceOf(race, block) / 60 + (def.type === 'test' ? 10 : 0));
}

// ---------- logging ----------
// "47.5", "47,5" or "47:30" -> minutes (number), '' -> null, anything else -> NaN.
export function parseMin(v) {
  const t = String(v ?? '').trim().replace(',', '.');
  if (!t) return null;
  const m = /^(\d+):([0-5]?\d)$/.exec(t);
  if (m) return +m[1] + +m[2] / 60;
  return /^\d*\.?\d+$|^\d+\.$/.test(t) ? Number(t) : NaN;
}
export function parseKm(v) {
  const t = String(v ?? '').trim().replace(',', '.');
  if (!t) return null;
  return /^\d*\.?\d+$|^\d+\.$/.test(t) ? Number(t) : NaN;
}
export function validateRun(km, min) {
  if (!fin(km) || km < 0.1 || km > 60) return 'Distance must be between 0.1 and 60 km.';
  if (!fin(min) || min < 1 || min > 600) return 'Time must be between 1 and 600 minutes.';
  return null;
}
export const round2 = x => Math.round(x * 100) / 100;

// Best logged time (minutes) over a distance (within 0.1 km), or null: { iso, min, km }.
export function bestOver(runs, km) {
  let best = null;
  for (const [iso, r] of Object.entries(runs || {})) {
    if (!r || !fin(r.km) || !fin(r.min) || Math.abs(r.km - km) > 0.1) continue;
    if (!best || r.min < best.min) best = { iso, min: r.min, km: r.km };
  }
  return best;
}

// First test week at or after w in the plan (looking through the repeating weeks), or null.
export function nextTest(w) {
  if (!PLAN) return null;
  const rw = runWeekOf(w), from = w > 52 ? rw : Math.max(1, w);
  for (let i = from; i <= 52; i++) {
    const t = PLAN.weeks[i - 1]?.runs?.find(r => r.type === 'test');
    if (t) return { week: i, gymWeek: Math.max(1, w) + (i - from), def: t };
  }
  return null;
}
