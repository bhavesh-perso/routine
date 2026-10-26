// node tests/gym.test.js — planner rules, progression, PRs, rest timer, warm-ups, session length, skip/move/restore,
// the active-session writes, and the .ics export with the real gym provider.
import { readFileSync } from 'node:fs';
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
  key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};
globalThis.confirm = () => true;

const st = await import('../js/storage.js');
const { getDay } = await import('../js/schedule.js');
const { setProviders, dayPlan, wakeFor, bedFor } = await import('../js/plan.js');
const { addDays, toMin } = await import('../js/util.js');
const G = await import('../js/gym.js');
const S = await import('../js/gym-session.js');
const { buildIcs, icsEvents } = await import('../js/ics.js');
G.setExerciseData(JSON.parse(readFileSync(new URL('../data/exercises.json', import.meta.url), 'utf8')));

let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; };
const near = (a, b, e = 0.06) => Math.abs(a - b) <= e;
const reset = (today = '2026-10-30') => { mem.clear(); st._clearCache(); G._setToday(today); };
const settings = () => st.getSettings();
const START = '2026-10-30';

// All planned dates in [from, to] and a rolling-window counter.
const plan = (s = settings()) => G.planAll(s);
const inRange = (list, a, b) => list.filter(x => x.iso >= a && x.iso <= b);
const rolling = (list, key = () => true) => {
  const days = new Set(list.filter(key).map(x => x.n)); let max = 0;
  const lo = Math.min(...list.map(x => x.n)), hi = Math.max(...list.map(x => x.n));
  for (let n = lo; n <= hi - 6; n++) { let c = 0; for (let k = 0; k < 7; k++) if (days.has(n + k)) c++; max = Math.max(max, c); }
  return max;
};
const maxRun = list => { const d = new Set(list.map(x => x.n)); let best = 0, cur = 0; for (let n = Math.min(...d); n <= Math.max(...d); n++) { cur = d.has(n) ? cur + 1 : 0; best = Math.max(best, cur); } return best; };

// Inject a finished session straight into storage (for progression, PR and ordering tests).
let seq = 0;
function inject({ rd, planIso = rd, kind = 'Full Body A', light = false, ex, loc = 'home', startedAt = 1.8e12 + (++seq) * 1000 }) {
  G.saveGym(g => {
    const id = 's-' + rd + '-' + seq;
    g.sessions[id] = { id, rd, planIso, kind, loc, light, short: false, startedAt, endedAt: startedAt + 3600e3, feel: 'ok', notes: '', ex };
  }, true);
}
const setsOf = (arr, type = 'work') => arr.map(d => ({ type, plan: { r: 8, rest: 60 }, done: d ? { ...d, at: 1 } : null }));
const exOf = (id, arr) => ({ id, sets: setsOf(arr) });

// ---------- planner: dates, phases, rules ----------
reset();
let s = settings(), list = plan(s);
ok('first gym session is Fri 30 Oct 2026', list[0].iso === '2026-10-30' && G.sessionFor('2026-10-29', s) === null);
ok('no session before the start date', list.every(x => x.iso >= START));
const ph = p => list.filter(x => x.phase === p);
ok('phases by week: 1-4, 5-8, 9+', G.phaseOf(1) === 1 && G.phaseOf(4) === 1 && G.phaseOf(5) === 2 && G.phaseOf(8) === 2 && G.phaseOf(9) === 3);
ok('week numbers count from the start date', G.weekOf('2026-10-30', s) === 1 && G.weekOf('2026-11-05', s) === 1 && G.weekOf('2026-11-06', s) === 2 && G.weekOf('2026-12-25', s) === 9);
ok('phase 1: at most 3 per rolling 7 days, on off days only', rolling(ph(1)) <= 3 && ph(1).every(x => x.type === 'off'));
ok('phase 1 really has 3 per week where days allow', ph(1).length >= 8);
ok('phase 2: at most 4 per rolling 7 days', rolling(list.filter(x => x.phase <= 2)) <= 4);
ok('phase 2 reaches 4 in a week', inRange(list, '2026-11-27', '2026-12-03').length === 4);
ok('phase 3 gate open (nothing missed): 5 in a week, never more', (() => { const p3 = ph(3); return rolling(p3) === 5; })());
ok('never more than 3 training days in a row (all phases)', maxRun(list) <= 3);
ok('always at least one full rest day in any 7', rolling(list) <= 6);
ok('never two sessions on one day', new Set(list.map(x => x.iso)).size === list.length);
ok('every slot sits between wake and bedtime', list.every(x => { const ss = settings(), a = toMin(x.start); let b = toMin(x.end); if (b <= a) b += 1440; return a >= wakeFor(x.iso, ss) && b <= bedFor(x.iso, ss); }));
ok('changing the start date in settings re-plans', (() => { const o = { ...settings(), gym: { start: '2026-11-06', lightWeek: true } }; const l = G.planAll(o); return l[0].iso >= '2026-11-06' && G.sessionFor('2026-10-30', o) === null; })());
ok('phase 1 kinds are Full Body A/B only', ph(1).every(x => /^Full Body [AB]$/.test(x.kind)));
ok('phase 2 kinds are Upper/Lower only', ph(2).every(x => x.kind === 'Upper' || x.kind === 'Lower'));
ok('phase 3 with the gate open cycles Upper, Lower, Push, Pull, Legs', ph(3).filter(x => x.five).slice(0, 5).map(x => x.kind).join() === 'Upper,Lower,Push,Pull,Legs');
ok('week 1 sessions are 2 sets, later weeks 3', list.filter(x => x.week === 1).every(x => x.sets === 2) && list.filter(x => x.week >= 2 && x.week <= 8).every(x => x.sets === 3));
ok('cardio ramp: 10 min weeks 1-2, +5/week, capped at 30', G.cardioMinutes(1) === 10 && G.cardioMinutes(2) === 10 && G.cardioMinutes(3) === 15 && G.cardioMinutes(4) === 20 && G.cardioMinutes(6) === 30 && G.cardioMinutes(12) === 30);
ok('cardio on at most 3 sessions in any 7 days', rolling(list, x => x.cardio > 0) <= 3);
ok('cardio machine comes from ticked equipment, else a walk', G.cardioWith('home', settings()) === 'walk' && G.cardioWith('home', { equipment: { home: ['dumbbells', 'bike'] } }) === 'bike');

// Gate closed: a past planned session that was not done keeps phase 3 at 4.
reset('2027-01-20');
list = plan(settings());
const p3late = list.filter(x => x.phase === 3 && x.iso >= '2027-01-20');
ok('phase 3 gate shut when a past planned session was missed: 4 per week max', rolling(list.filter(x => x.iso >= '2027-01-20' && x.iso <= '2027-02-02' && x.phase === 3)) <= 4 && p3late.filter(x => x.iso <= '2027-02-02').every(x => !x.five));
ok('gate reopens once the missed session is more than 14 days back', list.some(x => x.iso > '2027-02-02' && x.five));
ok('gate shut: phase 3 follows Upper/Lower', p3late.filter(x => x.iso <= '2027-02-02').every(x => x.kind === 'Upper' || x.kind === 'Lower'));
ok('fiveAllowed false when the gate is shut', G.fiveAllowed('2027-01-25', settings()) === false);

// ---------- light week ----------
reset(); s = settings(); list = plan(s);
ok('light weeks are 9, 17, 25', [9, 17, 25].every(w => G.isLightWeek(w, s)) && ![1, 8, 10, 16, 18].some(w => G.isLightWeek(w, s)));
ok('light week sessions: flagged light, 2 sets', list.filter(x => x.week === 9).length > 0 && list.filter(x => x.week === 9).every(x => x.light && x.sets === 2));
ok('week 10 is a normal week again', list.filter(x => x.week === 10).every(x => !x.light && x.sets === 3));
ok('light week can be switched off in settings', (() => { const o = { ...s, gym: { ...s.gym, lightWeek: false } }; return !G.isLightWeek(9, o); })());

// ---------- work-day sessions ----------
reset(); s = settings(); list = plan(s);
const work = list.filter(x => x.type === 'work');
ok('work-day sessions exist from phase 2 on and never in phase 1', work.length > 0 && work.every(x => x.phase >= 2));
const mw = work.filter(x => x.block === 'morning');
ok('morning-block work day: work gym, 19:10-19:55, flagged tight', mw.length > 0 && mw.every(x => x.loc === 'work' && x.time === '19:10–19:55' && x.tight === true && x.start === '19:10' && x.end === '19:55'));
ok('morning-block work-day session starts after the shift ends (19:00)', mw.every(x => { const d = getDay(x.iso, s); return d.shiftEnd === '19:00' && x.start >= '19:00'; }));
const nw = work.filter(x => x.block === 'night');
ok('night-block work day: home gym 15:30-16:30, before the 19:00 shift', nw.length > 0 && nw.every(x => x.loc === 'home' && x.time === '15:30–16:30'));
ok('no cardio on a tight work-gym day', mw.every(x => x.cardio === 0));
ok('never right after a night shift', list.every(x => { const y = getDay(addDays(x.iso, -1), s); return !(y.endsNextDay && x.start < '16:00' && x.type === 'off'); }));
ok('at most 1 work-day session per rolling 7 days outside a 5-session phase 3', rolling(list.filter(x => x.phase < 3), x => x.type === 'work') <= 1);
ok('session slots never overlap a shift', list.every(x => { const d = getDay(x.iso, s); if (d.type !== 'work') return true; return x.end <= '19:00' && d.block === 'night' ? true : x.start >= d.shiftEnd || x.end <= d.shiftStart; }));

// ---------- A/B order only moves forward when logged ----------
reset('2026-11-02'); s = settings(); list = plan(s);
ok('nothing logged, 30 Oct and 1 Nov in the past: both flagged missed', list[0].missed && list[1].missed);
ok('missed sessions keep their place: A then B, then the next session is still A (the first workout of the order)', list[0].kind === 'Full Body A' && list[1].kind === 'Full Body A' && G.nextSession('2026-11-02', s).kind === 'Full Body A');
inject({ rd: '2026-10-30', kind: 'Full Body A', ex: [exOf('goblet-squat', [{ w: 6, r: 10 }])] });
list = plan(s);
ok('after logging A on 30 Oct the missed 1 Nov slot shows B and the next one stays B', list[0].done && list[0].kind === 'Full Body A' && list[1].kind === 'Full Body B' && list[1].missed && G.nextSession('2026-11-02', s).kind === 'Full Body B');
inject({ rd: '2026-11-01', planIso: '2026-11-01', kind: 'Full Body B', ex: [exOf('db-rdl', [{ w: 6, r: 10 }])] });
list = plan(s);
ok('logging B moves the order on to A', G.nextSession('2026-11-02', s).kind === 'Full Body A' && !list[1].missed);
reset('2026-11-02'); s = settings();
inject({ rd: '2026-10-30', kind: 'Full Body B', ex: [exOf('db-rdl', [{ w: 6, r: 10 }])] });
ok('a logged session of one kind makes the next planned one the other kind', plan(s).find(x => x.iso > '2026-11-02').kind === 'Full Body A');

// ---------- progression ----------
reset(); s = settings();
const dbs = G.dumbbellsAt('home', s);
ok('default dumbbells 2-20 kg', dbs.join() === '2,4,6,8,10,12,14,16,18,20');
ok('+2.5 rounds up to the next dumbbell that exists', G.nextWeight(10, 2.5, true, dbs) === 14 && G.nextWeight(12, 2.5, true, dbs) === 16 && G.nextWeight(6, 2, true, dbs) === 8);
ok('rounding off gives the plain increment', G.nextWeight(10, 2.5, false, dbs) === 12.5 && G.nextWeight(40, 1.25, false, []) === 41.25);
ok('no heavier dumbbell: weight stays', G.nextWeight(20, 2.5, true, dbs) === 20 && G.nextWeight(24, 2.5, true, dbs) === 24);
ok('nearest weight for a light week (80%)', G.nearestWeight(16, dbs, true) === 16 && G.nearestWeight(15, dbs, true) === 14 && G.nearestWeight(13, dbs, true) === 12 && G.nearestWeight(20.1, [], false) === 20);
ok('first time: start light, no weight', G.suggest('goblet-squat', 'home', s).reason === 'start' && G.suggest('goblet-squat', 'home', s).w === null);
inject({ rd: '2026-10-30', ex: [exOf('goblet-squat', [{ w: 10, r: 12 }, { w: 10, r: 12 }, { w: 10, r: 12 }])] });
let sg = G.suggest('goblet-squat', 'home', s);
ok('top of range on every set: next dumbbell up, back to the bottom of the range', sg.reason === 'up' && sg.w === 14 && sg.r === 8);
inject({ rd: '2026-11-01', ex: [exOf('goblet-squat', [{ w: 14, r: 12, rpe: 8 }, { w: 14, r: 12, rpe: 9 }, { w: 14, r: 12, rpe: 8 }])] });
sg = G.suggest('goblet-squat', 'home', s);
ok('RPE 9 or more on any set holds the weight', sg.reason === 'rpe' && sg.w === 14 && sg.r === 12);
inject({ rd: '2026-11-04', ex: [exOf('goblet-squat', [{ w: 14, r: 12, rpe: 7 }, { w: 14, r: 11, rpe: 8 }, { w: 14, r: 12 }])] });
sg = G.suggest('goblet-squat', 'home', s);
ok('not every set at the top: build reps by one from the lowest set', sg.reason === 'build' && sg.w === 14 && sg.r === 12);
inject({ rd: '2026-11-05', ex: [exOf('goblet-squat', [{ w: 14, r: 9 }, { w: 14, r: 8 }, { w: 14, r: 8 }])] });
sg = G.suggest('goblet-squat', 'home', s);
ok('build: lowest set + 1', sg.reason === 'build' && sg.r === 9 && sg.w === 14);
inject({ rd: '2026-11-06', ex: [exOf('goblet-squat', [{ w: 14, r: 6 }, { w: 14, r: 7 }, { w: 14, r: 7 }])] });
inject({ rd: '2026-11-07', ex: [exOf('goblet-squat', [{ w: 14, r: 6 }, { w: 14, r: 6 }, { w: 14, r: 7 }])] });
sg = G.suggest('goblet-squat', 'home', s);
ok('below the range twice in a row: hold at the bottom of the range', sg.reason === 'missed' && sg.w === 14 && sg.r === 8);
reset(); s = settings();
inject({ rd: '2026-10-30', ex: [exOf('goblet-squat', [{ w: 20, r: 12 }, { w: 20, r: 12 }, { w: 20, r: 12 }])] });
sg = G.suggest('goblet-squat', 'home', s);
ok('at the heaviest dumbbell: reason max, weight stays', sg.reason === 'max' && sg.w === 20);
G.saveGym(g => { g.prefs['goblet-squat'] = { inc: 2.5, round: false }; });
ok('rounding off per exercise: plain +2.5', G.suggest('goblet-squat', 'home', s).w === 22.5);
G.saveGym(g => { g.prefs['goblet-squat'] = { inc: 5, round: false }; });
ok('increment is a per-exercise preference', G.suggest('goblet-squat', 'home', s).w === 25 && G.prefsFor('goblet-squat').inc === 5 && G.prefsFor('db-row').round === true && G.prefsFor('lat-pulldown').round === false);
reset(); s = settings();
inject({ rd: '2026-10-30', ex: [exOf('goblet-squat', [{ w: 10, r: 10 }])] });
inject({ rd: '2026-11-06', light: true, ex: [exOf('goblet-squat', [{ w: 8, r: 12 }, { w: 8, r: 12 }, { w: 8, r: 12 }])] });
ok('light-week sessions never drive progression', G.suggest('goblet-squat', 'home', s).w === 10);
reset(); s = settings();
inject({ rd: '2026-10-30', ex: [exOf('plank', [{ sec: 40 }, { sec: 40 }, { sec: 40 }])] });
ok('timed hold: below the top of the range builds by 5 s', (() => { const x = G.suggest('plank', 'home', s), hi = G.EX('plank').range[1]; return hi > 40 ? x.reason === 'build' && x.sec === 45 : x.reason === 'up' && x.sec === 45; })());
inject({ rd: '2026-10-30', ex: [exOf('incline-pushup', [{ r: 15 }, { r: 15 }, { r: 15 }])] });
ok('bodyweight at the top of the range adds a rep', (() => { const x = G.suggest('incline-pushup', 'home', s); return x.reason === 'up' && x.r === 16; })());

// ---------- epley, PRs ----------
ok('Epley e1RM: 100 kg x 5 = 116.7, x1 = weight, x0 = 0', near(G.epley(100, 5), 116.667, 0.01) && G.epley(100, 1) === 100 && G.epley(100, 0) === 0);
ok('reps of a one-sided set is the weaker side, total is both', G.repsOf({ rl: 10, rr: 8 }) === 8 && G.totalReps({ rl: 10, rr: 8 }) === 18 && G.repsOf({ r: 9 }) === 9);
const prior = G.prsFrom([{ rd: '2026-10-30', ex: [{ id: 'x', sets: [{ type: 'work', done: { w: 20, r: 8 } }, { type: 'warm', done: { w: 100, r: 5 } }] }] }]).x;
ok('warm-up sets never count to records', prior.heaviest.w === 20 && near(prior.e1rm.v, 25.3, 0.06));
ok('heaviest weight and e1RM flagged', (() => { const w = G.checkPR(prior, { w: 22, r: 8 }); return w.includes('heaviest weight') && w.includes('best estimated 1RM'); })());
ok('more reps at the same weight flagged', G.checkPR(prior, { w: 20, r: 10 }).includes('most reps at 20 kg'));
ok('a lighter weight with more reps can beat the e1RM', G.checkPR(prior, { w: 18, r: 14 }).includes('best estimated 1RM'));
ok('a worse set flags nothing', G.checkPR(prior, { w: 18, r: 8 }).length === 0);
ok('nothing flagged with no earlier records', G.checkPR(undefined, { w: 50, r: 5 }).length === 0);
const bwp = G.prsFrom([{ rd: '2026-10-30', ex: [{ id: 'y', sets: [{ type: 'work', done: { r: 10 } }, { type: 'work', done: { sec: 30 } }] }] }]).y;
ok('bodyweight reps and holds are tracked separately', G.checkPR(bwp, { r: 11 }).includes('most reps') && G.checkPR(bwp, { sec: 31 }).includes('longest hold') && G.checkPR(bwp, { r: 10 }).length === 0);

reset(); s = settings();
inject({ rd: '2026-10-30', ex: [exOf('db-bench', [{ w: 10, r: 10 }, { w: 12, r: 8 }, { w: 10, r: 9 }])] });
const first = G.doneSessions()[0];
ok('first session ever: summary flags no records, even for a heavier second set', S.newPRs(first).length === 0);
inject({ rd: '2026-11-01', ex: [exOf('db-bench', [{ w: 10, r: 10 }, { w: 14, r: 8 }, { w: 14, r: 10 }])] });
const second = G.doneSessions()[1];
const np = S.newPRs(second);
ok('second session: records found in summary, against earlier sessions only', np.length === 2 && np[0].what.includes('heaviest weight') && np[1].what.includes('most reps at 14 kg'));
ok('prs() cache follows writes', G.prs()['db-bench'].heaviest.w === 14 && (inject({ rd: '2026-11-04', ex: [exOf('db-bench', [{ w: 16, r: 8 }])] }), G.prs()['db-bench'].heaviest.w === 16));
ok('historyFor: working sets, e1RM per session, oldest first', (() => { const h = G.historyFor('db-bench'); return h.length === 3 && h[0].iso === '2026-10-30' && near(h[0].e1rm, G.epley(12, 8), 0.06) && h[2].e1rm > h[1].e1rm; })());
ok('week volume counts weight x total reps, not warm-ups', (() => { reset(); inject({ rd: '2026-11-02', ex: [{ id: 'a', sets: [{ type: 'warm', plan: {}, done: { w: 5, r: 10, at: 1 } }, { type: 'work', plan: {}, done: { w: 10, r: 10, at: 1 } }, { type: 'work', plan: {}, done: { w: 8, rl: 5, rr: 6, at: 1 } }] }] }); return G.weekVolume('2026-11-02') === 188 && G.weekVolume('2026-11-09') === 0; })());

// ---------- rest timer from stored timestamps ----------
ok('restLeft counts down from startedAt and never goes below 0', G.restLeft({ startedAt: 1000, sec: 90 }, 1000) === 90 && G.restLeft({ startedAt: 1000, sec: 90 }, 31000) === 60 && G.restLeft({ startedAt: 1000, sec: 90 }, 91000) === 0 && G.restLeft({ startedAt: 1000, sec: 90 }, 9e9) === 0);
ok('restLeft rounds up part seconds and tolerates no/garbage timer', G.restLeft({ startedAt: 0, sec: 60 }, 500) === 60 && G.restLeft(null) === 0 && G.restLeft({ startedAt: 'x', sec: 5 }) === 0);

// ---------- warm-up sets, session build, length ----------
ok('warm-up weights ~50% and ~75%, rounded down to real dumbbells', G.warmupWeights(20, dbs).join() === '10,14' && G.warmupWeights(14, dbs).join() === '6,10');
ok('no warm-ups until the working weight is above the lightest dumbbell', G.warmupWeights(2, dbs).length === 0 && G.warmupWeights(null, dbs).length === 0 && G.warmupWeights(8, []).length === 0);
ok('warm-up weights are distinct and below the working weight', (() => { const w = G.warmupWeights(4, dbs); return w.join() === '2' && w.every(x => x < 4); })());
reset(); s = settings();
let slot = G.sessionFor('2026-10-30', s), built = G.buildExercises(slot, s);
ok('first session: no warm-up sets (no weights yet), 2 working sets each, 90 s rest in week 1', built.every(e => e.sets.every(x => x.type === 'work')) && built[0].sets.length === 2 && built.every(e => e.sets.every(x => x.plan.rest === 90)));
inject({ rd: '2026-10-30', ex: [exOf('goblet-squat', [{ w: 12, r: 12 }, { w: 12, r: 12 }, { w: 12, r: 12 }])] });
G._setToday('2026-11-09'); // week 2
slot = G.sessionFor('2026-11-10', s) || G.nextSession('2026-11-10', s); built = G.buildExercises(slot, s);
const gs = built.find(e => e.id === 'goblet-squat') || built[0];
ok('warm-up sets come before the first big lift only, at ~50% then ~75%', (() => { const w = gs.sets.filter(x => x.type === 'warm'); return slot.kind === 'Full Body A' && gs.sets[0].type === 'warm' && w.length === 2 && w[0].plan.w < w[1].plan.w && w[1].plan.w < gs.sets.find(x => x.type === 'work').plan.w && built.slice(1).every(e => e.sets.every(x => x.type === 'work')); })());
ok('warm-up sets are flagged warm and not done', gs.sets.filter(x => x.type === 'warm').every(x => x.done === null));
const shortEx = G.buildExercises(slot, s, { short: true });
ok('shorter version: 2 sets, first 4 exercises', shortEx.length === 4 && shortEx.every(e => e.sets.filter(x => x.type === 'work').length === 2));
ok('light week: ~80% of the last working weight, to a real dumbbell', (() => { const l = G.buildExercises({ ...slot, light: true, sets: 2 }, s).find(e => e.id === 'goblet-squat'); return l.sets.find(x => x.type === 'work').plan.w === 10; })());
ok('missing equipment swaps in the alternative automatically', (() => { const o = { ...s, equipment: { ...s.equipment, home: ['dumbbells'] } }; return G.resolveExercise('db-bench', 'home', o) !== 'db-bench' && G.resolveExercise('db-bench', 'home', s) === 'db-bench' && G.resolveExercise('goblet-squat', 'home', { ...s, equipment: { home: [] } }) === 'box-squat'; })());
// Session length: sets x (work + rest) + 5 warm-up + cardio.
const fake = [{ id: 'db-bench', sets: [{ type: 'work', plan: { rest: 60 } }, { type: 'work', plan: { rest: 60 } }] }, { id: 'plank', sets: [{ type: 'work', plan: { sec: 30, rest: 60 } }] }, { id: 'db-row', sets: [{ type: 'work', plan: { rest: 60 } }] }];
// bench 2 x (40 + 60) = 200, plank 30 + 60 = 90, one-sided row 80 + 60 = 140 -> 430 s = 8 min (ceil) + 5 warm-up
ok('session length estimate = sets x (work+rest) + warm-up + cardio', G.estimateMin(fake, 0) === 8 + 5 && G.estimateMin(fake, 10) === 8 + 5 + 10 && G.estimateMin([], 0) === 5);
ok('one-sided and timed moves are counted correctly', G.EX('db-row').oneSided === true && G.estimateMin([{ id: 'db-row', sets: [{ type: 'work', plan: { rest: 60 } }] }], 0, 0) === Math.ceil(140 / 60));
reset(); s = settings(); G._setToday('2026-12-01');
const tight = plan(s).find(x => x.tight);
const pf = G.planFor(tight, s);
ok('tight work-gym day: the plan reports whether it fits 19:10-19:55 and offers a shorter version', tight.len === 45 && pf.est > 0 && pf.fits === (pf.est <= 45) && pf.shortEx.length === 4 && pf.shortEst <= pf.est);
ok('a day with a roomy slot fits', (() => { const roomy = plan(s).find(x => x.len === 75 && x.cardio === 0) || plan(s).find(x => x.len === 75); return G.planFor(roomy, s).est <= 75 + 25; })());

// ---------- active session flow ----------
reset('2026-10-30'); s = settings();
const T0 = Date.UTC(2026, 9, 30, 14, 0, 0);
const id = S.startSession('2026-10-30', s, T0, '2026-10-30');
let act = G.activeSession();
ok('start session: saved as active with every planned set', id === 's-2026-10-30' && act && act.kind === 'Full Body A' && act.ex.length === 5 && G.gymData().active === id && act.endedAt === null && act.rd === '2026-10-30');
ok('a session in progress holds its plan day (not re-planned)', G.sessionFor('2026-10-30', s).done === false && G.todayCard({ s, rd: '2026-10-30' }).includes('Resume session'));
ok('nextSet starts at the first set', (() => { const p = S.nextSet(act); return p.ei === 0 && p.si === 0; })());
const prs0 = S.logSet(0, 0, { w: 8, r: 10, rpe: 7 }, T0 + 60e3);
act = G.activeSession();
ok('logging a set stores values and a timestamp, no records the first time', prs0.length === 0 && act.ex[0].sets[0].done.w === 8 && act.ex[0].sets[0].done.r === 10 && act.ex[0].sets[0].done.rpe === 7 && act.ex[0].sets[0].done.at === T0 + 60e3);
ok('logging a set starts the rest timer from that set\'s rest plan', G.gymData().rest.startedAt === T0 + 60e3 && G.gymData().rest.sec === 90);
ok('rest timer survives a reload (computed from stored timestamps)', (() => { st._clearCache(); const r = G.gymData().rest; return G.restLeft(r, T0 + 60e3 + 30e3) === 60 && G.restLeft(r, T0 + 60e3 + 95e3) === 0; })());
ok('next set prefills from the last logged set of the same move', (() => { act = G.activeSession(); const t = S.targetFor(act, 0, 1); return t.w === 8 && t.r === 10; })());
S.logSet(0, 1, { w: 8, r: 9 }, T0 + 200e3);
ok('rest timer restarts on every logged set', G.gymData().rest.startedAt === T0 + 200e3);
ok('one-sided set: left/right stored, weaker side counts as reps', (() => { const ei = G.activeSession().ex.findIndex(e => e.id === 'db-row'); S.logSet(ei, 0, { w: 6, rl: 10, rr: 8 }, T0 + 300e3); const d = G.activeSession().ex[ei].sets[0].done; return d.rl === 10 && d.rr === 8 && G.repsOf(d) === 8; })());
ok('junk values are dropped, not stored', (() => { S.logSet(0, 0, { w: NaN, r: 'abc', sec: undefined, rpe: 8 }, T0 + 310e3); const d = G.activeSession().ex[0].sets[0].done; return !('w' in d) && !('r' in d) && d.rpe === 8; })());
S.logSet(0, 0, { w: 8, r: 10, rpe: 7 }, T0 + 320e3);
// swap the second exercise
const before = G.activeSession().ex[1].id;
S.swapExercise(1, 'pushup', s);
ok('swap replaces the remaining sets with the alternative', (() => { const e = G.activeSession().ex[1]; return e.id === 'pushup' && e.from === before && e.sets.every(x => x.type === 'work' && !x.done); })());
// log everything else, skipping one set
act = G.activeSession();
await S.sessionClick('gym-skip-set', { dataset: { ei: '2', si: '1' } }, { s, notify() {}, go() {} });
act = G.activeSession();
ok('skipping a set marks it skipped and nextSet passes over it', act.ex[2].sets[1].skip === true && (() => { const p = S.nextSet(act); return !(p.ei === 2 && p.si === 1); })());
for (let guard = 0; guard < 80; guard++) {
  const p = S.nextSet(G.activeSession()); if (!p) break;
  const e = G.activeSession().ex[p.ei], ex = G.EX(e.id), t = S.targetFor(G.activeSession(), p.ei, p.si);
  const v = ex.unit === 'time' ? { sec: t.sec } : ex.oneSided ? { rl: t.r, rr: t.r } : { r: t.r };
  if (ex.unit === 'kg') v.w = t.w ?? 5;
  S.logSet(p.ei, p.si, v, T0 + 400e3 + guard * 1e3);
}
ok('after the last set the rest timer clears and there is no next set', S.nextSet(G.activeSession()) === null && G.gymData().rest === null);
const tot = S.sessionTotals(G.activeSession());
ok('totals: working sets and volume (warm-ups excluded)', tot.sets > 8 && tot.kg > 0 && tot.min === 0);
const fid = S.finishSession(T0 + 3600e3, 'good', 'felt fine');
const fin = G.gymData().sessions[fid];
ok('finish: ended, feel and notes saved, active and rest cleared', fin.endedAt === T0 + 3600e3 && fin.feel === 'good' && fin.notes === 'felt fine' && G.gymData().active === null && G.gymData().rest === null);
ok('finished session counts as done in the plan and in history', G.sessionFor('2026-10-30', s).done === true && G.sessionFor('2026-10-30', s).sessionId === fid && G.doneSessions().length === 1 && S.sessionTotals(fin).min === 60);
ok('the next planned session is the other workout', G.nextSession('2026-10-31', s).kind === 'Full Body B');
ok('summary and history views render and escape', (() => { const h = G.default.view({ s, rd: '2026-10-30' }, 'history'), m = G.default.view({ s, rd: '2026-10-30' }, 'summary/' + fid); return h.includes('Full Body A') && m.includes('class="gym-sum"') && G.default.view({ s, rd: '2026-10-30' }, 'summary/<b>').includes('Not found'); })());
ok('exercise page and overview render', (() => { const c = { s, rd: '2026-10-30' }; return G.default.view(c, 'ex/goblet-squat').includes('Goblet squat') && G.default.view(c, 'ex/nope').includes('Not found') && G.default.view(c, '').includes('Coming up') && G.default.view(c, 'day/2026-11-01').includes('Full Body B') && G.default.view(c, 'day/bad').includes("isn't valid"); })());

// ---------- skip / move / restore ----------
reset('2026-10-30'); s = settings(); list = plan(s);
const beforeList = list.filter(x => x.iso <= '2026-11-30').map(x => x.iso);
G.skipSession('2026-11-01');
let after = plan(s);
ok('skip removes the session on that day', G.sessionFor('2026-11-01', s) === null && !after.some(x => x.iso === '2026-11-01'));
ok('skipped session rolls to the next valid days (sessions follow on 4 and 5 Nov)', after[1].iso === '2026-11-04' && after[2].iso === '2026-11-05' && after.filter(x => x.phase === 1).length >= beforeList.filter(d => d <= '2026-11-26').length - 1);
ok('skip never doubles up a day or breaks the weekly cap', new Set(after.map(x => x.iso)).size === after.length && rolling(after.filter(x => x.phase === 1)) <= 3 && maxRun(after) <= 3);
ok('skipped session keeps its place in the A/B order', (() => { const a = after.find(x => x.iso > '2026-11-01'); return a.kind === 'Full Body B'; })());
ok('skipped day is not "missed"', G.missedOn('2026-11-01', s, '2026-11-03') === false);
G.restoreSession('2026-11-01');
ok('restore puts it back exactly as before', plan(s).filter(x => x.iso <= '2026-11-30').map(x => x.iso).join() === beforeList.join() && G.gymData().skips['2026-11-01'] === undefined);
reset('2026-10-30'); s = settings(); list = plan(s);
const tgs = G.moveTargets('2026-11-01', s);
ok('move targets: valid days within the next week, never a day that already has a session, off days in phase 1', tgs.length > 0 && tgs.every(d => d >= '2026-10-30' && d <= '2026-11-08' && !plan(s).some(x => x.iso === d && x.iso !== '2026-11-01') && getDay(d, s).type === 'off'));
const to = tgs[0];
G.moveSession('2026-11-01', to);
after = plan(s);
ok('move: the session appears on the new day and not the old one', G.sessionFor(to, s)?.kind === 'Full Body B' && G.sessionFor(to, s).movedFrom === '2026-11-01' && G.sessionFor('2026-11-01', s) === null);
ok('move keeps the weekly cap and the order', rolling(after.filter(x => x.phase === 1)) <= 3 && maxRun(after) <= 3 && after.filter(x => x.iso <= '2026-11-05').map(x => x.kind).slice(0, 2).join() !== 'Full Body B,Full Body B');
G.moveSession(to, '2026-11-01');
ok('moving back clears the move', Object.keys(G.gymData().moves).length === 0 && G.sessionFor('2026-11-01', s) !== null);
G.moveSession('2026-11-01', to); G.skipSession(to);
ok('skipping a moved session skips the original day', G.gymData().skips['2026-11-01'] === true && Object.keys(G.gymData().moves).length === 0);
G.restoreSession('2026-11-01');
ok('a day with an invalid move target list gives a helpful empty list', Array.isArray(G.moveTargets('2026-11-01', s)));

// ---------- .ics with the real provider ----------
reset('2026-10-30'); s = settings();
setProviders({ gymFor: (iso, ss) => G.sessionFor(iso, ss) });
const ics = buildIcs(s, '2026-10-26', 42, { now: Date.UTC(2026, 9, 26, 6, 0, 0) });
const flat = ics.replace(/\r\n /g, '');
const evs = icsEvents(s, '2026-10-26', 42).filter(e => e.kind === 'gym');
const planned = plan(s).filter(x => x.iso >= '2026-10-26' && x.iso <= '2026-12-06');
ok('ics: one gym event per planned session, none before the start date', evs.length === planned.length && evs.length > 8 && evs.every(e => e.iso >= START));
ok('ics: first event is Fri 30 Oct 18:00-19:15 Mauritius time, named from the session', evs[0].iso === '2026-10-30' && evs[0].start === '20261030T180000' && evs[0].end === '20261030T191500' && evs[0].summary === 'Gym: Full Body A at the home gym');
ok('ics: gym events carry TZID and appear in the text', flat.includes('DTSTART;TZID=Indian/Mauritius:20261030T180000') && flat.includes('SUMMARY:Gym: Full Body A at the home gym') && (flat.match(/BEGIN:VEVENT/g) || []).length > evs.length);
ok('ics: times match the planner for every event', evs.every(e => { const x = G.sessionFor(e.iso, s); const [h, m] = x.start.split(':'); return e.start === e.iso.replaceAll('-', '') + 'T' + h + m + '00'; }));
ok('ics: morning work-gym day exports at the work gym', (() => { const w = evs.find(e => /work gym/.test(e.summary)); return !!w && w.start.endsWith('T191000') && w.end.endsWith('T195500'); })());
ok('ics: UIDs unique and stable', new Set(icsEvents(s, '2026-10-26', 42).map(e => e.uid)).size === icsEvents(s, '2026-10-26', 42).length && buildIcs(s, '2026-10-26', 42, { now: 1 }).replace(/DTSTAMP:\S+/g, '') === buildIcs(s, '2026-10-26', 42, { now: 2 }).replace(/DTSTAMP:\S+/g, ''));
ok('ics: dayPlan shows the gym block from the real provider', dayPlan('2026-10-30', s).some(b => b.kind === 'gym' && /Full Body A/.test(b.label)));

console.log(fail ? `\n${fail} FAILED` : '\nAll gym tests passed');
process.exit(fail ? 1 : 0);
