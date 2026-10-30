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
const reset = (today = '2026-10-31') => { mem.clear(); st._clearCache(); G._setToday(today); };
const settings = () => st.getSettings();
const START = '2026-10-31';

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

// ---------- planner: dates, rotation, rules ----------
reset();
let s = settings(), list = plan(s);
const ROT = ['Upper', 'Lower', 'Push', 'Pull', 'Legs'];
const absOf = x => x.n * 1440 + toMin(x.start) + (x.nextDay ? 1440 : 0);
const gapsOk = l => l.every((x, k) => k === 0 || absOf(x) - absOf(l[k - 1]) >= 1200);
ok('first gym session is Sat 31 Oct 2026', list[0].iso === '2026-10-31' && G.sessionFor('2026-10-30', s) === null);
ok('no session before the start date', list.every(x => x.iso >= START));
ok('week numbers count from the start date', G.weekOf('2026-10-31', s) === 1 && G.weekOf('2026-11-06', s) === 1 && G.weekOf('2026-11-07', s) === 2 && G.weekOf('2026-12-26', s) === 9);
ok('the 3-phase ramp and the five-day gate are gone', G.phaseOf === undefined && G.fiveAllowed === undefined && G.GATE_NOTE === undefined && list.every(x => !('phase' in x) && !('five' in x)));
ok('always Upper, Lower, Push, Pull, Legs from week 1', list.slice(0, 15).map(x => x.kind).join() === [...ROT, ...ROT, ...ROT].join() || list.slice(0, 15).every((x, k) => x.kind === ROT[k % 5]));
ok('at most 5 per rolling 7 days, and the cap is reached', rolling(list) === 5);
ok('never more than 3 training days in a row', maxRun(list) <= 3);
ok('never two sessions on one day', new Set(list.map(x => x.iso)).size === list.length);
ok('at least 20 hours between the starts of two sessions', gapsOk(list));
ok('work-day sessions: at most 3 per rolling 7 days, tight ones at most 2', rolling(list, x => x.type === 'work') <= 3 && rolling(list, x => x.tight) <= 2);
ok('work days are used from week 1 (the cap is 5 a week)', list.some(x => x.type === 'work' && x.week === 1));
ok('off days come first: most sessions are on off days', list.filter(x => x.type === 'off').length > list.filter(x => x.type === 'work').length);
ok('every slot sits between wake (or shift end + drive) and bedtime', list.every(x => { const ss = settings(), a = toMin(x.start) + (x.nextDay ? 1440 : 0); let b = a + x.len; return a >= wakeFor(x.iso, ss) && b <= bedFor(x.iso, ss); }));
ok('changing the start date in settings re-plans', (() => { const o = { ...settings(), gym: { start: '2026-11-06', lightWeek: true } }; const l = G.planAll(o); return l[0].iso >= '2026-11-06' && G.sessionFor('2026-10-31', o) === null; })());
ok('2 sets in weeks 1-2, 3 from week 3 (light weeks stay 2)', list.filter(x => x.week <= 2).every(x => x.sets === 2) && list.filter(x => x.week >= 3 && !x.light).every(x => x.sets === 3) && list.filter(x => x.light).every(x => x.sets === 2));
ok('location names', G.locName('home') === 'Gym near home' && G.locName('work') === 'Gym near work');

// ---------- light week ----------
ok('light weeks are 9, 17, 25', [9, 17, 25].every(w => G.isLightWeek(w, s)) && ![1, 8, 10, 16, 18].some(w => G.isLightWeek(w, s)));
ok('light week sessions: flagged light, 2 sets', list.filter(x => x.week === 9).length > 0 && list.filter(x => x.week === 9).every(x => x.light && x.sets === 2));
ok('week 10 is a normal week again', list.filter(x => x.week === 10).every(x => !x.light && x.sets === 3));
ok('light week can be switched off in settings', (() => { const o = { ...s, gym: { ...s.gym, lightWeek: false } }; return !G.isLightWeek(9, o); })());

// ---------- work-day sessions and the morning after a night shift ----------
const work = list.filter(x => x.type === 'work');
const mw = work.filter(x => x.block === 'morning');
ok('morning-block work day: gym near work, 19:15-20:00, flagged tight', mw.length > 0 && mw.every(x => x.loc === 'work' && x.time === '19:15–20:00' && x.tight === true && x.start === '19:15' && x.end === '20:00' && !x.nextDay));
ok('morning-block work-day session starts after the shift ends (19:00)', mw.every(x => { const d = getDay(x.iso, s); return d.shiftEnd === '19:00' && x.start >= '19:00'; }));
const nw = work.filter(x => x.block === 'night');
ok('night-block work day: gym near home, 07:50-08:50 the next morning', nw.length > 0 && nw.every(x => x.loc === 'home' && x.time === '07:50–08:50' && x.nextDay === true && x.len === 60));
ok('only night-work sessions are next-day ones', list.every(x => x.nextDay === (x.type === 'work' && x.block === 'night')));
ok('after-shift session starts at or after shift end + drive and ends before bed', nw.every(x => { const d = getDay(x.iso, s); const a = toMin(x.start) + 1440; return a >= toMin(d.shiftEnd) + 1440 + s.drive && a + x.len <= bedFor(x.iso, s); }));
ok('last night shift before the switch to mornings (nap at 08:15) gets no session', G.sessionFor('2026-11-22', s) === null && G.sessionFor('2026-11-20', s)?.nextDay === true);
ok('no evening session on the off day after a morning-after session (20 h gap)', nw.every(x => { const nx = G.sessionFor(addDays(x.iso, 1), s); return !nx || nx.nextDay; }));
ok('session slots never overlap a shift', list.every(x => { const d = getDay(x.iso, s); if (d.type !== 'work' || x.nextDay) return true; return x.start >= d.shiftEnd || x.end <= d.shiftStart; }));

// ---------- order only moves forward when logged ----------
reset('2026-11-03'); s = settings(); list = plan(s);
ok('nothing logged, 31 Oct, 1 Nov and 2 Nov are past: all flagged missed', list[0].missed && list[1].missed && list[2].missed);
ok('missed sessions keep their place: the next session is still the first workout', list[0].kind === 'Upper' && list[1].kind === 'Upper' && list[2].kind === 'Upper' && G.nextSession('2026-11-03', s).kind === 'Upper');
inject({ rd: '2026-10-31', kind: 'Upper', ex: [exOf('goblet-squat', [{ w: 6, r: 10 }])] });
list = plan(s);
ok('after logging Upper on 31 Oct the missed 1 Nov slot shows Lower and the next one stays Lower', list[0].done && list[0].kind === 'Upper' && list[1].kind === 'Lower' && list[1].missed && G.nextSession('2026-11-03', s).kind === 'Lower');
inject({ rd: '2026-11-01', planIso: '2026-11-01', kind: 'Lower', ex: [exOf('db-rdl', [{ w: 6, r: 10 }])] });
list = plan(s);
ok('logging Lower moves the order on to Push', G.nextSession('2026-11-03', s).kind === 'Push' && !list[1].missed);
reset('2026-11-03'); s = settings();
inject({ rd: '2026-10-31', kind: 'Pull', ex: [exOf('db-rdl', [{ w: 6, r: 10 }])] });
ok('a logged Pull makes the next planned one Legs, then it wraps to Upper', plan(s).find(x => x.iso > '2026-11-03').kind === 'Legs' && plan(s).filter(x => x.iso > '2026-11-03')[1].kind === 'Upper');
reset('2026-11-03'); s = settings();
inject({ rd: '2026-10-31', kind: 'Full Body A', ex: [exOf('db-rdl', [{ w: 6, r: 10 }])] });
ok('an old Full Body session just advances the counter by one', plan(s)[0].kind === 'Full Body A' && plan(s)[1].kind === 'Lower' && G.nextSession('2026-11-03', s).kind === 'Lower');

// ---------- progression ----------
reset(); s = settings();
const dbs = G.dumbbellsAt('home', s);
ok('default dumbbells 2-30 kg', dbs.join() === '2,4,6,8,10,12,14,16,18,20,22,24,26,28,30');
ok('+2.5 rounds up to the next dumbbell that exists', G.nextWeight(10, 2.5, true, dbs) === 14 && G.nextWeight(12, 2.5, true, dbs) === 16 && G.nextWeight(6, 2, true, dbs) === 8);
ok('rounding off gives the plain increment', G.nextWeight(10, 2.5, false, dbs) === 12.5 && G.nextWeight(40, 1.25, false, []) === 41.25);
ok('no heavier dumbbell: weight stays', G.nextWeight(30, 2.5, true, dbs) === 30 && G.nextWeight(28, 2.5, true, dbs) === 30);
ok('nearest weight for a light week (80%)', G.nearestWeight(16, dbs, true) === 16 && G.nearestWeight(15, dbs, true) === 14 && G.nearestWeight(13, dbs, true) === 12 && G.nearestWeight(20.1, [], false) === 20);
ok('first time: start light, no weight', G.suggest('goblet-squat', 'home', s).reason === 'start' && G.suggest('goblet-squat', 'home', s).w === null);
inject({ rd: '2026-10-31', ex: [exOf('goblet-squat', [{ w: 10, r: 12 }, { w: 10, r: 12 }, { w: 10, r: 12 }])] });
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
inject({ rd: '2026-10-31', ex: [exOf('goblet-squat', [{ w: 30, r: 12 }, { w: 30, r: 12 }, { w: 30, r: 12 }])] });
sg = G.suggest('goblet-squat', 'home', s);
ok('at the heaviest dumbbell: reason max, weight stays', sg.reason === 'max' && sg.w === 30);
G.saveGym(g => { g.prefs['goblet-squat'] = { inc: 2.5, round: false }; });
ok('rounding off per exercise: plain +2.5', G.suggest('goblet-squat', 'home', s).w === 32.5);
G.saveGym(g => { g.prefs['goblet-squat'] = { inc: 5, round: false }; });
ok('increment is a per-exercise preference', G.suggest('goblet-squat', 'home', s).w === 35 && G.prefsFor('goblet-squat').inc === 5 && G.prefsFor('db-row').round === true && G.prefsFor('lat-pulldown').round === false);
reset(); s = settings();
inject({ rd: '2026-10-31', ex: [exOf('goblet-squat', [{ w: 10, r: 10 }])] });
inject({ rd: '2026-11-06', light: true, ex: [exOf('goblet-squat', [{ w: 8, r: 12 }, { w: 8, r: 12 }, { w: 8, r: 12 }])] });
ok('light-week sessions never drive progression', G.suggest('goblet-squat', 'home', s).w === 10);
reset(); s = settings();
inject({ rd: '2026-10-31', ex: [exOf('plank', [{ sec: 40 }, { sec: 40 }, { sec: 40 }])] });
ok('timed hold: below the top of the range builds by 5 s', (() => { const x = G.suggest('plank', 'home', s), hi = G.EX('plank').range[1]; return hi > 40 ? x.reason === 'build' && x.sec === 45 : x.reason === 'up' && x.sec === 45; })());
inject({ rd: '2026-10-31', ex: [exOf('incline-pushup', [{ r: 15 }, { r: 15 }, { r: 15 }])] });
ok('bodyweight at the top of the range adds a rep', (() => { const x = G.suggest('incline-pushup', 'home', s); return x.reason === 'up' && x.r === 16; })());

// ---------- epley, PRs ----------
ok('Epley e1RM: 100 kg x 5 = 116.7, x1 = weight, x0 = 0', near(G.epley(100, 5), 116.667, 0.01) && G.epley(100, 1) === 100 && G.epley(100, 0) === 0);
ok('reps of a one-sided set is the weaker side, total is both', G.repsOf({ rl: 10, rr: 8 }) === 8 && G.totalReps({ rl: 10, rr: 8 }) === 18 && G.repsOf({ r: 9 }) === 9);
const prior = G.prsFrom([{ rd: '2026-10-31', ex: [{ id: 'x', sets: [{ type: 'work', done: { w: 20, r: 8 } }, { type: 'warm', done: { w: 100, r: 5 } }] }] }]).x;
ok('warm-up sets never count to records', prior.heaviest.w === 20 && near(prior.e1rm.v, 25.3, 0.06));
ok('heaviest weight and e1RM flagged', (() => { const w = G.checkPR(prior, { w: 22, r: 8 }); return w.includes('heaviest weight') && w.includes('best estimated 1RM'); })());
ok('more reps at the same weight flagged', G.checkPR(prior, { w: 20, r: 10 }).includes('most reps at 20 kg'));
ok('a lighter weight with more reps can beat the e1RM', G.checkPR(prior, { w: 18, r: 14 }).includes('best estimated 1RM'));
ok('a worse set flags nothing', G.checkPR(prior, { w: 18, r: 8 }).length === 0);
ok('nothing flagged with no earlier records', G.checkPR(undefined, { w: 50, r: 5 }).length === 0);
const bwp = G.prsFrom([{ rd: '2026-10-31', ex: [{ id: 'y', sets: [{ type: 'work', done: { r: 10 } }, { type: 'work', done: { sec: 30 } }] }] }]).y;
ok('bodyweight reps and holds are tracked separately', G.checkPR(bwp, { r: 11 }).includes('most reps') && G.checkPR(bwp, { sec: 31 }).includes('longest hold') && G.checkPR(bwp, { r: 10 }).length === 0);

reset(); s = settings();
inject({ rd: '2026-10-31', ex: [exOf('db-bench', [{ w: 10, r: 10 }, { w: 12, r: 8 }, { w: 10, r: 9 }])] });
const first = G.doneSessions()[0];
ok('first session ever: summary flags no records, even for a heavier second set', S.newPRs(first).length === 0);
inject({ rd: '2026-11-01', ex: [exOf('db-bench', [{ w: 10, r: 10 }, { w: 14, r: 8 }, { w: 14, r: 10 }])] });
const second = G.doneSessions()[1];
const np = S.newPRs(second);
ok('second session: records found in summary, against earlier sessions only', np.length === 2 && np[0].what.includes('heaviest weight') && np[1].what.includes('most reps at 14 kg'));
ok('prs() cache follows writes', G.prs()['db-bench'].heaviest.w === 14 && (inject({ rd: '2026-11-04', ex: [exOf('db-bench', [{ w: 16, r: 8 }])] }), G.prs()['db-bench'].heaviest.w === 16));
ok('historyFor: working sets, e1RM per session, oldest first', (() => { const h = G.historyFor('db-bench'); return h.length === 3 && h[0].iso === '2026-10-31' && near(h[0].e1rm, G.epley(12, 8), 0.06) && h[2].e1rm > h[1].e1rm; })());
ok('week volume counts weight x total reps, not warm-ups', (() => { reset(); inject({ rd: '2026-11-02', ex: [{ id: 'a', sets: [{ type: 'warm', plan: {}, done: { w: 5, r: 10, at: 1 } }, { type: 'work', plan: {}, done: { w: 10, r: 10, at: 1 } }, { type: 'work', plan: {}, done: { w: 8, rl: 5, rr: 6, at: 1 } }] }] }); return G.weekVolume('2026-11-02') === 188 && G.weekVolume('2026-11-09') === 0; })());

// ---------- rest timer from stored timestamps ----------
ok('restLeft counts down from startedAt and never goes below 0', G.restLeft({ startedAt: 1000, sec: 90 }, 1000) === 90 && G.restLeft({ startedAt: 1000, sec: 90 }, 31000) === 60 && G.restLeft({ startedAt: 1000, sec: 90 }, 91000) === 0 && G.restLeft({ startedAt: 1000, sec: 90 }, 9e9) === 0);
ok('restLeft rounds up part seconds and tolerates no/garbage timer', G.restLeft({ startedAt: 0, sec: 60 }, 500) === 60 && G.restLeft(null) === 0 && G.restLeft({ startedAt: 'x', sec: 5 }) === 0);

// ---------- warm-up sets, session build, length ----------
ok('warm-up weights ~50% and ~75%, rounded down to real dumbbells', G.warmupWeights(20, dbs).join() === '10,14' && G.warmupWeights(14, dbs).join() === '6,10');
ok('no warm-ups until the working weight is above the lightest dumbbell', G.warmupWeights(2, dbs).length === 0 && G.warmupWeights(null, dbs).length === 0 && G.warmupWeights(8, []).length === 0);
ok('warm-up weights are distinct and below the working weight', (() => { const w = G.warmupWeights(4, dbs); return w.join() === '2' && w.every(x => x < 4); })());
reset(); s = settings();
let slot = G.sessionFor('2026-10-31', s), built = G.buildExercises(slot, s);
ok('the session is built from the template of its kind', built.length > 0 && built.length <= G.templateFor(slot.kind).length && G.templateFor('Upper').length > 0);
ok('first session: no warm-up sets (no weights yet), 2 working sets each, 90 s rest in week 1', built.every(e => e.sets.every(x => x.type === 'work')) && built[0].sets.length === 2 && built.every(e => e.sets.every(x => x.plan.rest === 90)));
inject({ rd: '2026-10-31', ex: [exOf('db-bench', [{ w: 12, r: 12 }, { w: 12, r: 12 }, { w: 12, r: 12 }])] });
G._setToday('2026-11-09'); // week 2
slot = { ...G.nextSession('2026-11-10', s), kind: 'Push' }; built = G.buildExercises(slot, s);
const gs = built.find(e => G.EX(e.id).big);
ok('warm-up sets come before the first big lift only, at ~50% then ~75%', (() => { const w = gs.sets.filter(x => x.type === 'warm'); return gs.id === 'db-bench' && gs.sets[0].type === 'warm' && w.length === 2 && w[0].plan.w < w[1].plan.w && w[1].plan.w < gs.sets.find(x => x.type === 'work').plan.w && built.filter(e => e !== gs).every(e => e.sets.every(x => x.type === 'work')); })());
ok('warm-up sets are flagged warm and not done', gs.sets.filter(x => x.type === 'warm').every(x => x.done === null));
const shortEx = G.buildExercises(slot, s, { short: true });
ok('shorter version: 2 sets, first 4 exercises', shortEx.length === 4 && shortEx.every(e => e.sets.filter(x => x.type === 'work').length === 2));
ok('light week: ~80% of the last working weight, to a real dumbbell', (() => { const l = G.buildExercises({ ...slot, light: true, sets: 2 }, s).find(e => e.id === 'db-bench'); return l.sets.find(x => x.type === 'work').plan.w === 10; })());
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
reset('2026-10-31'); s = settings();
const T0 = Date.UTC(2026, 9, 30, 14, 0, 0);
const id = S.startSession('2026-10-31', s, T0, '2026-10-31');
let act = G.activeSession();
ok('start session: saved as active with every planned set', id === 's-2026-10-31' && act && act.kind === 'Upper' && act.ex.length === G.templateFor('Upper').length && G.gymData().active === id && act.endedAt === null && act.rd === '2026-10-31');
ok('a session in progress holds its plan day (not re-planned)', G.sessionFor('2026-10-31', s).done === false && G.todayCard({ s, rd: '2026-10-31' }).includes('Resume session'));
ok('nextSet starts at the first set', (() => { const p = S.nextSet(act); return p.ei === 0 && p.si === 0; })());
const prs0 = S.logSet(0, 0, { w: 8, r: 10, rpe: 7 }, T0 + 60e3);
act = G.activeSession();
ok('logging a set stores values and a timestamp, no records the first time', prs0.length === 0 && act.ex[0].sets[0].done.w === 8 && act.ex[0].sets[0].done.r === 10 && act.ex[0].sets[0].done.rpe === 7 && act.ex[0].sets[0].done.at === T0 + 60e3);
ok('logging a set starts the rest timer from that set\'s rest plan', G.gymData().rest.startedAt === T0 + 60e3 && G.gymData().rest.sec === 90);
ok('rest timer survives a reload (computed from stored timestamps)', (() => { st._clearCache(); const r = G.gymData().rest; return G.restLeft(r, T0 + 60e3 + 30e3) === 60 && G.restLeft(r, T0 + 60e3 + 95e3) === 0; })());
ok('next set prefills from the last logged set of the same move', (() => { act = G.activeSession(); const t = S.targetFor(act, 0, 1); return t.w === 8 && t.r === 10; })());
S.logSet(0, 1, { w: 8, r: 9 }, T0 + 200e3);
ok('rest timer restarts on every logged set', G.gymData().rest.startedAt === T0 + 200e3);
S.swapExercise(3, 'db-row', s);
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
ok('finished session counts as done in the plan and in history', G.sessionFor('2026-10-31', s).done === true && G.sessionFor('2026-10-31', s).sessionId === fid && G.doneSessions().length === 1 && S.sessionTotals(fin).min === 60);
ok('the next planned session is the next workout in the rotation', G.nextSession('2026-10-31', s, false).kind === 'Lower');
ok('summary and history views render and escape', (() => { const h = G.default.view({ s, rd: '2026-10-31' }, 'history'), m = G.default.view({ s, rd: '2026-10-31' }, 'summary/' + fid); return h.includes('Upper') && m.includes('class="gym-sum"') && G.default.view({ s, rd: '2026-10-31' }, 'summary/<b>').includes('Not found'); })());
ok('exercise page and overview render', (() => { const c = { s, rd: '2026-10-31' }; return G.default.view(c, 'ex/goblet-squat').includes('Goblet squat') && G.default.view(c, 'ex/nope').includes('Not found') && G.default.view(c, '').includes('Coming up') && G.default.view(c, 'day/2026-11-01').includes('Lower') && G.default.view(c, 'day/bad').includes("isn't valid"); })());

// ---------- skip / move / restore ----------
reset('2026-10-31'); s = settings(); list = plan(s);
const beforeList = list.filter(x => x.iso <= '2026-11-30').map(x => x.iso);
const rulesHold = l => rolling(l) <= 5 && maxRun(l) <= 3 && gapsOk(l) && rolling(l, x => x.type === 'work') <= 3 && rolling(l, x => x.tight) <= 2 && new Set(l.map(x => x.iso)).size === l.length;
ok('the untouched plan keeps every rule', rulesHold(list));
G.skipSession('2026-11-01');
let after = plan(s);
ok('skip removes the session on that day', G.sessionFor('2026-11-01', s) === null && !after.some(x => x.iso === '2026-11-01'));
ok('skipped session rolls to the next valid day', after[1].iso > '2026-11-01' && after.filter(x => x.iso <= '2026-11-26').length >= beforeList.filter(d => d <= '2026-11-26').length - 2);
ok('skip never doubles up a day or breaks the caps, the gap or the run', rulesHold(after));
ok('skipped session keeps its place in the order', after[1].kind === 'Lower');
ok('skipped day is not "missed"', G.missedOn('2026-11-01', s, '2026-11-03') === false);
G.restoreSession('2026-11-01');
ok('restore puts it back exactly as before', plan(s).filter(x => x.iso <= '2026-11-30').map(x => x.iso).join() === beforeList.join() && G.gymData().skips['2026-11-01'] === undefined);
reset('2026-10-31'); s = settings(); list = plan(s);
ok('a full week offers no move targets (every day is at a cap, the gap or the run limit)', G.moveTargets('2026-11-01', s).length === 0 && G.moveTargets('2026-11-04', s).length === 0);
reset('2026-11-30'); s = settings(); list = plan(s);
const FROM = '2026-12-01', tgs = G.moveTargets(FROM, s);
ok('move targets: valid days within the next week, never a day that already has a session', tgs.length > 0 && tgs.every(d => d >= '2026-11-30' && d <= '2026-12-08' && !plan(s).some(x => x.iso === d && x.iso !== FROM)));
ok('every move target keeps all the rules once moved', tgs.every(d => { G.moveSession(FROM, d); const l = plan(s).filter(x => x.iso <= '2026-12-31'), good = rulesHold(l) && G.sessionFor(d, s)?.movedFrom === FROM; G.moveSession(d, FROM); return good; }));
const to = tgs[0], kindBefore = G.sessionFor(FROM, s).kind;
G.moveSession(FROM, to);
after = plan(s);
ok('move: the session appears on the new day and not the old one', G.sessionFor(to, s)?.movedFrom === FROM && G.sessionFor(FROM, s) === null);
ok('move keeps the rotation going in date order', (() => { const k = after.filter(x => x.iso >= '2026-11-30').map(x => x.kind); return k.every((x, i) => i === 0 || x === ROT[(ROT.indexOf(k[i - 1]) + 1) % 5]); })());
G.moveSession(to, FROM);
ok('moving back clears the move', Object.keys(G.gymData().moves).length === 0 && G.sessionFor(FROM, s) !== null);
G.moveSession(FROM, to); G.skipSession(to);
ok('skipping a moved session skips the original day', G.gymData().skips[FROM] === true && Object.keys(G.gymData().moves).length === 0);
G.restoreSession(FROM);
ok('the target list is always an array', Array.isArray(G.moveTargets(FROM, s)));

// ---------- UI text for the morning-after slot ----------
reset('2026-11-02'); s = settings();
const after1 = G.sessionFor('2026-11-02', s);
ok('whenText says next morning for a next-day slot, plain times otherwise', G.whenText(after1) === 'Next morning 07:50–08:50, after the night shift' && G.whenText(G.sessionFor('2026-11-01', s)) === '18:00–19:15');
ok('today card, overview, preview and week view say it clearly', (() => { const c = { s, rd: '2026-11-02' }; return G.todayCard(c).includes('Next morning 07:50–08:50, after the night shift') && G.default.view(c, '').includes('Next morning 07:50–08:50') && G.default.view(c, 'day/2026-11-02').includes('Next morning 07:50–08:50') && !G.todayCard(c).includes('Phase'); })());

// ---------- day plan with the morning-after session ----------
setProviders({ gymFor: (iso, ss) => G.sessionFor(iso, ss) });
{
  const bl = dayPlan('2026-11-02', s), gy = bl.find(b => b.kind === 'gym'), dh = bl.find(b => /Drive home/.test(b.label)), m3 = bl.find(b => b.slot === 'm3'), bedt = bl.find(b => b.bedtime), sh = bl.find(b => b.kind === 'shift');
  ok('night work day: gym block is the next morning, after the drive home, label names the gym', gy.start === 1440 + 470 && gy.end === 1440 + 530 && gy.start >= dh.end && /^Gym: Upper \(gym near home\)$/.test(gy.label) && sh.end === 1860);
  ok('night work day: shower and Meal 3 (protein) right after the gym, then bed', m3.label === 'Shower, then Meal 3 (protein)' && m3.start === gy.end && m3.end <= bedt.start && bl.every(b => b.start <= bedt.start));
  ok('night work day: no gym block before the shift', !bl.some(b => b.kind === 'gym' && b.start < sh.start));
  const study = bl.find(b => b.kind === 'study'), walk = bl.find(b => b.kind === 'walk'), m1 = bl.find(b => b.slot === 'm1');
  ok('night work day: meal 1 and study fit before the shift with the 16:00 wake', m1.start === 960 && study.start >= 960 && study.end <= walk.start && walk.end <= sh.start);
  const noGym = dayPlan('2026-11-03', s).find(b => b.slot === 'm3');
  ok('night work day without a session keeps the light Meal 3', dayPlan('2026-11-03', s).every(b => b.kind !== 'gym') && /small light Meal 3/.test(noGym.label));
}

// ---------- .ics with the real provider ----------
reset('2026-10-31'); s = settings();
setProviders({ gymFor: (iso, ss) => G.sessionFor(iso, ss) });
const ics = buildIcs(s, '2026-10-26', 42, { now: Date.UTC(2026, 9, 26, 6, 0, 0) });
const flat = ics.replace(/\r\n /g, '');
const evs = icsEvents(s, '2026-10-26', 42).filter(e => e.kind === 'gym');
const planned = plan(s).filter(x => x.iso >= '2026-10-26' && x.iso <= '2026-12-06');
const hm = x => x.start.replace(':', '');
const stampOf = x => addDays(x.iso, x.nextDay ? 1 : 0).replaceAll('-', '') + 'T' + hm(x) + '00';
ok('ics: one gym event per planned session, none before the start date', evs.length === planned.length && evs.length > 8 && evs.every(e => e.iso >= START));
ok('ics: first event is Sat 31 Oct 18:00-19:15 Mauritius time, named from the session', evs[0].iso === '2026-10-31' && evs[0].start === '20261031T180000' && evs[0].end === '20261031T191500' && evs[0].summary === 'Gym: Upper (gym near home)');
ok('ics: gym events carry TZID and appear in the text', flat.includes('DTSTART;TZID=Indian/Mauritius:20261031T180000') && flat.includes('SUMMARY:Gym: Upper (gym near home)') && (flat.match(/BEGIN:VEVENT/g) || []).length > evs.length);
ok('ics: times match the planner for every event', evs.every(e => e.start === stampOf(G.sessionFor(e.iso, s))));
ok('ics: the morning after a night shift exports on the next calendar day at 07:50', (() => { const e = evs.find(x => x.iso === '2026-11-02'); return e.start === '20261103T075000' && e.end === '20261103T085000' && e.uid.startsWith('20261102-gym'); })());
ok('ics: morning work-gym day exports at the work gym', (() => { const w = evs.find(e => /gym near work/.test(e.summary)); return !!w && w.start.endsWith('T191500') && w.end.endsWith('T200000'); })());
ok('ics: UIDs unique and stable', new Set(icsEvents(s, '2026-10-26', 42).map(e => e.uid)).size === icsEvents(s, '2026-10-26', 42).length && buildIcs(s, '2026-10-26', 42, { now: 1 }).replace(/DTSTAMP:\S+/g, '') === buildIcs(s, '2026-10-26', 42, { now: 2 }).replace(/DTSTAMP:\S+/g, ''));
ok('ics: dayPlan shows the gym block from the real provider', dayPlan('2026-10-31', s).some(b => b.kind === 'gym' && /Upper/.test(b.label)));

console.log(fail ? `\n${fail} FAILED` : '\nAll gym tests passed');
process.exit(fail ? 1 : 0);
