// node tests/run.test.js — running plan: assignment, pace maths, logging, provider, day timeline, .ics.
import { readFileSync } from 'node:fs';
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
  key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};
const st = await import('../js/storage.js');
const { setProviders, dayPlan } = await import('../js/plan.js');
const { addDays } = await import('../js/util.js');
const G = await import('../js/gym.js');
const R = await import('../js/run.js');
const { icsEvents, buildIcs } = await import('../js/ics.js');
const read = f => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
G.setExerciseData(read('../data/exercises.json'));
const PLAN = read('../data/run-plan.json');

let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const START = '2026-10-31';
const reset = () => { mem.clear(); st._clearCache(); G._setToday(START); G.setRunData(PLAN); };
const LEG = /^(Lower|Legs)$/;

// ---------- plan data and week mapping ----------
R.setRunPlan(PLAN);
ok('run plan has 52 weeks of 3 runs', PLAN.weeks.length === 52 && PLAN.weeks.every(w => w.runs.length === 3));
ok('run week = gym week up to 52, then weeks 41-52 repeat', R.runWeekOf(1) === 1 && R.runWeekOf(52) === 52 && R.runWeekOf(53) === 41 && R.runWeekOf(64) === 52 && R.runWeekOf(65) === 41 && R.runWeekOf(0) === 1);

// ---------- pure assignment ----------
const ses = (iso, kind, o = {}) => ({ iso, n: +iso.slice(8), kind, type: 'off', tight: false, nextDay: false, ...o });
{
  const week = [ses('2027-01-01', 'Upper'), ses('2027-01-02', 'Lower'), ses('2027-01-03', 'Push'), ses('2027-01-04', 'Pull'), ses('2027-01-05', 'Legs')];
  const a = R.assignWeek(5, week, []);
  ok('weeks 1-12: A, B, C go to the non-leg sessions in date order', a.A.slot.kind === 'Upper' && a.B.slot.kind === 'Push' && a.C.slot.kind === 'Pull');
  ok('weeks 1-12: never on Lower or Legs', R.assignWeek(5, [ses('2027-01-02', 'Lower'), ses('2027-01-05', 'Legs')], []).A === null);
  ok('weeks 1-12: a tight session never takes a run', R.assignWeek(5, [ses('2027-01-01', 'Upper', { tight: true }), ses('2027-01-03', 'Push')], []).A.slot.kind === 'Push');
  const two = R.assignWeek(5, [ses('2027-01-01', 'Upper'), ses('2027-01-03', 'Push')], []);
  ok('weeks 1-12 with 2 sessions: extras dropped from the end (A, B kept, C dropped)', !!two.A && !!two.B && two.C === null);
  const w2 = [ses('2027-01-01', 'Upper', { type: 'work', nextDay: true }), ses('2027-01-03', 'Push'), ses('2027-01-04', 'Pull')];
  const day = (iso, o = {}) => ({ iso, n: +iso.slice(8), beforeHard: false, ok: true, ...o });
  const b = R.assignWeek(13, w2, [day('2027-01-02')]);
  ok('week 13+: C is a standalone run on a free off day (chain a)', b.C.day.iso === '2027-01-02');
  ok('week 13+: B (quality) prefers an off-day session, A takes another', b.B.slot.kind === 'Push' && b.A.slot.kind === 'Pull' || b.B.slot.kind === 'Push' && b.A.slot.kind === 'Upper');
  const c = R.assignWeek(13, w2, [day('2027-01-02', { beforeHard: true }), day('2027-01-06')]);
  ok('week 13+: C avoids the day before Lower or Legs when another day exists', c.C.day.iso === '2027-01-06');
  ok('week 13+: ...but takes it when it is the only free day', R.assignWeek(13, w2, [day('2027-01-02', { beforeHard: true })]).C.day.iso === '2027-01-02');
  const e = R.assignWeek(13, w2, []);
  ok('chain b: no free day, C attaches to an off-day Upper/Push/Pull session; B then A follow', e.C.slot.kind === 'Push' && e.B.slot.kind === 'Pull' && e.A.slot.kind === 'Upper');
  const e2 = R.assignWeek(13, [ses('2027-01-01', 'Upper', { type: 'work', nextDay: true }), ses('2027-01-02', 'Pull', { type: 'work' })], []);
  ok('chain c: no off-day session, C takes any non-tight one, next-morning slots last', e2.C.slot.kind === 'Pull' && e2.B.slot.kind === 'Upper' && e2.A === null);
  const e3 = R.assignWeek(13, [ses('2027-01-01', 'Upper', { tight: true }), ses('2027-01-02', 'Lower')], [day('2027-01-04', { ok: false }), day('2027-01-05', { ok: false })]);
  ok('chain d: C goes standalone on the first free off day whose gym slot is not usable', e3.C.day.iso === '2027-01-04' && e3.B === null && e3.A === null);
  const e4 = R.assignWeek(13, [ses('2027-01-01', 'Upper', { tight: true }), ses('2027-01-02', 'Lower'), ses('2027-01-03', 'Pull', { tight: true })], []);
  ok('chain e: last, C attaches to the last non-leg session even if tight', e4.C.slot.kind === 'Pull' && e4.B === null && e4.A === null);
  ok('C is never dropped while any non-leg session or free day exists', ['Upper', 'Push', 'Pull'].every(k => [true, false].every(tight => !!R.assignWeek(24, [ses('2027-01-01', k, { tight })], []).C)) && !!R.assignWeek(24, [], [day('2027-01-02', { ok: false })]).C);
  const g = R.assignWeek(13, [ses('2027-01-03', 'Push'), ses('2027-01-04', 'Pull')], []);
  ok('drop order is A first, then B, never C', !!g.C && !!g.B && !g.A && !R.assignWeek(13, [ses('2027-01-03', 'Push')], []).B && !!R.assignWeek(13, [ses('2027-01-03', 'Push')], []).C);
  ok('week 12 (test week) uses the same order: C first, then B, then A', (() => { const x = R.assignWeek(12, [ses('2027-01-01', 'Upper'), ses('2027-01-03', 'Push')], []); return x.C.slot.kind === 'Upper' && x.B.slot.kind === 'Push' && x.A === null; })());
  ok('weeks 1-11 keep date order and drop from the end', (() => { const x = R.assignWeek(11, [ses('2027-01-01', 'Upper'), ses('2027-01-03', 'Push')], []); return x.A.slot.kind === 'Upper' && x.B.slot.kind === 'Push' && x.C === null; })());
  ok('week 13+: only Lower, Legs or tight sessions: no A or B', (() => { const x = R.assignWeek(20, [ses('2027-01-01', 'Lower'), ses('2027-01-03', 'Legs'), ses('2027-01-04', 'Upper', { tight: true })], []); return !x.A && !x.B && x.C.slot.kind === 'Upper'; })());
}

// ---------- planner integration ----------
reset();
const s = st.getSettings();
const sig = l => l.map(x => `${x.iso}|${x.kind}|${x.start}|${x.loc}`).join();
R.setRunPlan(null);
const bare = G.planAll(s);
const bareSig = sig(bare), bareOk = bare.every(x => !x.run && x.cardio === 0);
R.setRunPlan(PLAN);
const list = G.planAll(s, addDays(START, 400));
ok('without a run plan no session has a run and cardio is 0', bareOk);
ok('gym planner is untouched by runs (same days, kinds, slots)', sig(list.slice(0, bare.length)) === bareSig);
const runs = list.filter(x => x.run);
ok('never a run on Lower, Legs or a tight session', runs.length > 20 && runs.every(x => !LEG.test(x.kind) && !x.tight));
ok('x.cardio = estimated run minutes, 0 without a run', list.every(x => x.cardio === (x.run ? x.run.estMin : 0)) && runs.every(x => x.run.estMin > 0));
ok('x.run carries key, week, block and the plan def', runs.every(x => ['A', 'B', 'C'].includes(x.run.key) && x.run.week === R.runWeekOf(x.week) && x.run.block === PLAN.weeks[x.run.week - 1].block && x.run.title === PLAN.weeks[x.run.week - 1].runs['ABC'.indexOf(x.run.key)].title));
{
  let bad = 0;
  for (let w = 1; w <= 11; w++) {
    const wk = list.filter(x => x.week === w), elig = wk.filter(x => !x.tight && !LEG.test(x.kind)), got = wk.filter(x => x.run);
    if (!(got.length === Math.min(3, elig.length) && got.every((x, k) => x === elig[k] && x.run.key === 'ABC'[k]))) bad++;
  }
  ok('weeks 1-11: A, B, C attach to the non-leg sessions in date order', bad === 0);
  const w1 = list.filter(x => x.week === 1 && x.run);
  ok('week 1 has three runs with default settings', w1.length === 3);
}
ok('weeks 1-12: no standalone runs', (() => { for (let n = 0; n < 84; n++) if (G.runFor(addDays(START, n), s)) return false; return true; })());
// Weeks 13+: standalone C on a free off day.
const standalone = [];
for (let n = 84; n < 84 + 7 * 40; n++) { const iso = addDays(START, n), r = G.runFor(iso, s); if (r) standalone.push({ iso, ...r }); }
ok('week 13+: standalone runs exist and are the long run or test (key C)', standalone.length > 5 && standalone.every(r => r.key === 'C'));
ok('standalone runs sit on days with no gym session', standalone.every(r => !G.sessionFor(r.iso, s) && G.runOn(r.iso, s)?.standalone === true));
ok('standalone run time = the off-day gym slot (18:00 or 17:00 start)', standalone.every(r => ['18:00', '17:00'].includes(r.start)) && standalone.every(r => r.end > r.start));
ok('a standalone run is rarely the day before Legs or Lower', (() => {
  let bad = 0;
  for (const r of standalone) { const nx = G.sessionFor(addDays(r.iso, 1), s); if (nx && LEG.test(nx.kind)) bad++; }
  return bad <= Math.ceil(standalone.length / 4);
})());
ok('gym week 53 uses run week 41', (() => { const x = list.find(y => y.week === 53 && y.run); return !x || x.run.week === 41; })());
ok('C is placed in every week 12-52 (attached or standalone)', (() => { for (let w = 12; w <= 52; w++) { const wk = list.filter(x => x.week === w), has = wk.some(x => x.run?.key === 'C') || (() => { for (let n = 0; n < 7; n++) if (G.runFor(addDays(START, 7 * (w - 1) + n), s)) return true; return false; })(); if (!has && wk.some(x => !LEG.test(x.kind))) return false; } return true; })());
ok('time trials are scheduled in weeks 12, 24, 36 and 52', [12, 24, 36, 52].every(w => list.some(x => x.week === w && x.run?.type === 'test') || (() => { for (let n = 0; n < 7; n++) if (G.runFor(addDays(START, 7 * (w - 1) + n), s)?.title.includes('time trial')) return true; return false; })()));
ok('an attached time trial is flagged first, shortened to 2 sets, with the text', list.filter(x => x.run?.type === 'test').every(x => x.run.first === true && x.sets === 2 && x.run.text.includes('Do the time trial first, fresh. Then do a short lift: 2 sets per exercise.')));
ok('an attached long run gets the after-lifting note, no first flag', list.filter(x => x.run?.type === 'long').every(x => !x.run.first && x.run.text.endsWith('Run after lifting, easy pace.')));
ok('skipping a gym session: the run follows the plan (recomputed)', (() => {
  reset();
  const a = G.planAll(st.getSettings()).find(x => x.run?.key === 'A');
  G.skipSession(a.iso);
  const after = G.planAll(st.getSettings());
  const keys = after.filter(x => x.week === a.week && x.run).map(x => x.run.key).join('');
  reset();
  return !after.find(x => x.iso === a.iso && x.run) && keys.includes('A') && keys.includes('B');
})());

// ---------- pace maths ----------
ok('Riegel: 10 km in 50:00 stays 50:00', near(R.riegel10k(3000, 10), 3000));
ok('Riegel: 5 km in 25:00 = 25:00 x 2^1.06 = 52:07', near(R.riegel10k(1500, 5), 1500 * Math.pow(2, 1.06)) && Math.round(R.riegel10k(1500, 5)) === 3127);
const race = R.racePaceOf({ km: 10, min: 57.5 });
ok('race pace from a 10 km test = time / 10', near(race, 345));
ok('race pace from a 5 km test uses Riegel', near(R.racePaceOf({ km: 5, min: 25 }), 1500 * Math.pow(2, 1.06) / 10));
ok('pace text: 5:45/km, 10.4 km/h, incline 1%', R.paceText(345) === '5:45/km · treadmill 10.4 km/h · incline 1%');
ok('target pace = race pace + offset (easy +75, tempo +15, interval -15, race +0)', R.targetPace('easy', race) === 420 && R.targetPace('tempo', race) === 360 && R.targetPace('interval', race) === 330 && R.targetPace('race', race) === 345);
ok('pace rounds to whole seconds and km/h to one decimal', R.fmtPace(359.6) === '6:00' && R.fmtKmh(360) === '10.0' && R.fmtKmh(420) === '8.6');
ok('no test: easy shows effort text and the treadmill hint, no numbers', (() => { const l = R.targetLines({ type: 'easy', pace: 'easy' }, null); return l.length === 1 && l[0] === 'Treadmill: about 8–9 km/h, incline 1%, talk test decides'; })());
ok('no test: walk-run gets its treadmill speeds', R.targetLines({ type: 'walkrun' }, null).join() === 'Treadmill: run 7.5–8.5 km/h, walk 5.5–6 km/h, incline 1%');
ok('no test: tempo shows no pace numbers', R.targetLines({ type: 'tempo', pace: 'tempo' }, null).length === 0);
ok('with a test: tempo shows a pace line', R.targetLines({ type: 'tempo', pace: 'tempo' }, race)[0] === 'Target pace: 6:00/km · treadmill 10.0 km/h · incline 1%');
ok('estMin: def.min wins', R.estMin({ type: 'easy', min: 25, km: 9 }, 'Base', null) === 25);
ok('estMin: km x easy pace of the block before any test', R.estMin({ type: 'long', km: 5, pace: 'easy' }, 'Build', null) === Math.round(5 * 420 / 60) && R.estMin({ type: 'long', km: 5 }, 'Base', null) === Math.round(5 * 450 / 60));
ok('estMin: a test adds 10 min warm-up and cool-down', R.estMin({ type: 'test', km: 5 }, 'Base', null) === Math.round(5 * 450 / 60 + 10));
ok('estMin: easy pace comes from the latest test once logged', R.estMin({ type: 'long', km: 5 }, 'Base', race) === Math.round(5 * 420 / 60));
ok('input parsing: 47.5, 47,5, 47:30, junk', R.parseMin('47.5') === 47.5 && R.parseMin('47,5') === 47.5 && R.parseMin('47:30') === 47.5 && R.parseMin('') === null && Number.isNaN(R.parseMin('abc')) && Number.isNaN(R.parseMin('-3')) && R.parseKm('5.2') === 5.2 && Number.isNaN(R.parseKm('5k')));
ok('time format: 47:30 and 1:02:10', R.fmtTime(47.5) === '47:30' && R.fmtTime(62 + 10 / 60) === '1:02:10');

// ---------- logging ----------
ok('validation: km 0.1-60, min 1-600', R.validateRun(0.1, 1) === null && R.validateRun(60, 600) === null && !!R.validateRun(0.09, 30) && !!R.validateRun(60.1, 30) && !!R.validateRun(5, 0.9) && !!R.validateRun(5, 601) && !!R.validateRun(NaN, 30) && !!R.validateRun(5, undefined));
reset();
{
  const s2 = st.getSettings(), first = G.planAll(s2).find(x => x.run), iso = first.iso;
  ok('logging a run on a day with none planned is refused', G.logRun('2026-10-30', 5, 30, s2).ok === false);
  ok('invalid distance or time is refused and nothing is saved', G.logRun(iso, 0.05, 30, s2).ok === false && G.logRun(iso, 5, 700, s2).ok === false && !G.gymData().runs);
  const r = G.logRun(iso, 3.2, 28.5, s2, 123);
  const saved = G.gymData().runs?.[iso];
  ok('logging stores { key, type, title, km, min, at } under gym.runs[iso] (decimal minutes kept)', r.ok && saved.key === first.run.key && saved.type === first.run.type && saved.title === first.run.title && saved.km === 3.2 && saved.min === 28.5 && saved.at === 123);
  ok('a logged run can be edited', G.logRun(iso, 3.3, 29.25, s2).ok && G.gymData().runs[iso].min === 29.25 && G.gymData().runs[iso].km === 3.3);
  ok('a logged run can be deleted', (G.deleteRun(iso), !G.gymData().runs[iso]));
  ok('a non-test run does not set paces', R.latestTest(G.gymData().runs) === null && G.racePace() === null);
  // A test feeds the paces straight away. The shipped plan has no test in the first weeks, so make week 1's A run a 5 km test.
  const P2 = JSON.parse(JSON.stringify(PLAN)); P2.weeks[0].runs[0] = { ...PLAN.weeks[11].runs[2] }; G.setRunData(P2);
  const testSlot = G.planAll(s2).find(x => x.run?.type === 'test'), testIso = testSlot.iso;
  ok('a test run is planned with its km and an estimate with warm-up', testSlot.run.km === 5 && testSlot.run.estMin === Math.round(5 * 450 / 60 + 10));
  let longIso = null; for (let n = 84; n < 300 && !longIso; n++) { const i = addDays(START, n); if (G.runOn(i, s2)?.type === 'long') longIso = i; }
  const longBefore = G.runOn(longIso, s2);
  const logged = G.logRun(testIso, 5, 25, s2);
  ok('a logged test feeds the paces immediately', logged.ok && near(G.racePace(), 1500 * Math.pow(2, 1.06) / 10));
  const longAfter = G.runOn(longIso, s2);
  ok('...and the time estimates (km x new easy pace)', longAfter.estMin === Math.round(longAfter.km * (G.racePace() + 75) / 60) && longAfter.estMin !== longBefore.estMin);
  ok('best 5 km and best 10 km come from logged runs', R.bestOver(G.gymData().runs, 5).min === 25 && R.bestOver(G.gymData().runs, 10) === null);
  ok('weekRuns lists A, B, C with dates and the done state', (() => { const wr = G.weekRuns(1, s2); return wr.length === 3 && wr.every(x => x.iso) && wr.filter(x => x.done).length === 1; })());
}

// ---------- unscheduled log and the first-flag ordering ----------
reset();
{
  const s4 = st.getSettings();
  const lst = G.planAll(s4), free = '2026-11-03';
  ok('setup: 3 Nov has no planned run', !G.runOn(free, s4));
  ok('free log: future dates, bad types, bad numbers are refused', G.logRun('2026-11-10', 5, 25, s4, 1, { free: { type: 'test', today: '2026-11-03' } }).ok === false && G.logRun(free, 5, 25, s4, 1, { free: { type: 'sprint', today: free } }).ok === false && G.logRun(free, 0, 25, s4, 1, { free: { type: 'test', today: free } }).ok === false && !G.gymData().runs);
  ok('free log without the form options is still refused on a day with no run', G.logRun(free, 5, 25, s4).ok === false);
  ok('free log stores a run keyed by date', G.logRun(free, 5, 25, s4, 7, { free: { type: 'test', today: free } }).ok && G.gymData().runs[free].type === 'test' && G.gymData().runs[free].title === 'Time trial' && G.gymData().runs[free].km === 5);
  ok('an unscheduled time trial feeds the paces', near(G.racePace(), 1500 * Math.pow(2, 1.06) / 10));
  ok('...and best 5 km', R.bestOver(G.gymData().runs, 5).min === 25);
  const planned = lst.find(x => x.run).iso;
  G.logRun(planned, 3, 30, s4, 8, { free: { type: 'long', today: planned } });
  ok('a free log on a date with a planned run fills the planned one', G.gymData().runs[planned].key === lst.find(x => x.run).run.key && G.gymData().runs[planned].type === lst.find(x => x.run).run.type && !G.gymData().runs[planned].free);
  ok('a free time trial does not mark the weekly C as done', !G.weekRuns(1, s4).some(r => r.key === 'C' && r.done && r.iso !== planned && !G.gymData().runs[r.iso]));
}
reset();
{
  const P3 = JSON.parse(JSON.stringify(PLAN)); P3.weeks[0].runs[2] = { ...PLAN.weeks[11].runs[2] }; G.setRunData(P3);
  const s5 = st.getSettings(), x = G.planAll(s5).find(y => y.run?.type === 'test');
  ok('a time trial attached to a session sets run.first', x.run.first === true && x.run.key === 'C');
  const S = await import('../js/gym-session.js');
  S.startSession(x.iso, s5, 1.8e12, START);
  const html = S.sessionView({ s: s5, rd: START });
  ok('session view: the Run card comes before the exercises when first is set', html.indexOf('id="gr-h"') > 0 && html.indexOf('id="gr-h"') < html.indexOf('gs-ex'));
  reset();
  const x2 = G.planAll(st.getSettings()).find(y => y.run && !y.run.first);
  S.startSession(x2.iso, st.getSettings(), 1.8e12, START);
  const h2 = S.sessionView({ s: st.getSettings(), rd: START });
  ok('session view: other runs show after the exercises', !h2.includes('id="gr-h"') || h2.indexOf('id="gr-h"') > h2.indexOf('gs-ex'));
}
reset();

// ---------- provider, day timeline, .ics ----------
reset();
{
  const s3 = st.getSettings();
  setProviders({ gymFor: (iso, ss) => G.sessionFor(iso, ss), runFor: (iso, ss) => G.runFor(iso, ss) });
  let sa = null; for (let n = 84; n < 200 && !sa; n++) { const iso = addDays(START, n); if (G.runFor(iso, s3)) sa = iso; }
  const rf = G.runFor(sa, s3);
  ok('runFor returns { title, start, end, km } for a standalone run, null otherwise', rf && typeof rf.title === 'string' && /^\d\d:\d\d$/.test(rf.start) && /^\d\d:\d\d$/.test(rf.end) && 'km' in rf && G.runFor('2026-10-30', s3) === null && G.runFor(START, s3) === null);
  const b = dayPlan(sa, s3), blk = b.find(x => x.kind === 'run');
  ok('dayPlan adds a run block on that off day, at the run time', !!blk && blk.label === 'Run: ' + rf.title && blk.start === Number(rf.start.slice(0, 2)) * 60 + Number(rf.start.slice(3)) && blk.end > blk.start);
  ok('timeline stays sorted and no meal starts inside the run', b.every((x, k) => k === 0 || x.start >= b[k - 1].start) && !b.some(x => x.kind === 'meal' && x.start >= blk.start && x.start < blk.end));
  ok('no run block on days without a standalone run', !dayPlan(START, s3).some(x => x.kind === 'run'));
  const gdate = G.planAll(s3).find(x => x.run);
  const gb = dayPlan(gdate.iso, s3).find(x => x.kind === 'gym');
  ok('a gym block with a run attached says so in the label', gb.label.endsWith(` + run ${gdate.run.estMin} min`));
  const ev = icsEvents(s3, sa, 1).filter(e => e.kind === 'run');
  ok('ics export has the run event', ev.length === 1 && ev[0].summary === 'Run: ' + rf.title && ev[0].uid.includes('-run@'));
  const text = buildIcs(s3, sa, 1, { now: Date.UTC(2026, 9, 26) }).replace(/\r\n /g, '');
  ok('ics file contains the run summary', text.includes('SUMMARY:Run: ' + rf.title.replace(/[,;]/g, m => '\\' + m)));
}
setProviders({ gymFor: () => null, runFor: () => null });

console.log(fail ? `\n${fail} FAILED` : '\nAll run tests passed');
process.exit(fail ? 1 : 0);
