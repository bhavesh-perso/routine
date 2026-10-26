// Plain node tests for js/progress.js: node tests/progress.test.js
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
  key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};
globalThis.confirm = () => true;

const st = await import('../js/storage.js');
const P = await import('../js/progress.js');
const prog = P.default;

let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const reset = () => { mem.clear(); st._clearCache(); };
const s = () => st.getSettings();
const ctxFor = (rd, extra = {}) => ({ s: s(), iso: rd, rd, min: 960, ms: 0, go() {}, rerender() {}, notify() {}, ...extra });

// ---------- weigh-ins with custom measurements ----------
reset();
ok('no weigh-ins: latestWeight null', P.latestWeight() === null);
ok('add measure Arm', P.addMeasure('  Arm ').ok && P.measures().join() === 'Arm');
ok('duplicate measure rejected (case-insensitive)', !P.addMeasure('arm').ok);
ok('reserved name rejected', !P.addMeasure('Belly').ok);
P.addMeasure('Chest');
ok('save weigh-in', P.saveWeighin('2026-11-01', { kg: 68.4, belly: 84, notes: 'first', m: { Arm: 29.5, Chest: 92 } }).ok);
ok('stored shape', JSON.stringify(st.get('progress').weighins['2026-11-01']) === JSON.stringify({ kg: 68.4, belly: 84, notes: 'first', m: { Arm: 29.5, Chest: 92 } }));
P.saveWeighin('2026-11-08', { kg: 68.9, belly: 83.5, notes: '', m: { Arm: 30 } });
P.saveWeighin('2026-11-15', { kg: 69.3, belly: null, notes: '', m: { Arm: 30.6, Chest: 93 } });
ok('edit weigh-in overwrites', P.saveWeighin('2026-11-08', { kg: 69.0, belly: 83.5, notes: 'edited', m: { Arm: 30.1 } }).ok
  && P.weighinOn('2026-11-08').kg === 69 && P.weighinOn('2026-11-08').notes === 'edited');
ok('empty entry rejected', !P.saveWeighin('2026-11-22', { kg: null, belly: null, m: {} }).ok);
ok('silly weight rejected', !P.saveWeighin('2026-11-22', { kg: 680, m: {} }).ok);
ok('bad date rejected', !P.saveWeighin('22/11/2026', { kg: 68 }).ok);
ok('parseNum accepts comma', P.parseNum('68,4') === 68.4 && P.parseNum('') === null && Number.isNaN(P.parseNum('abc')));

// ---------- change since start ----------
const kg = P.changeSinceStart('kg');
ok('weight change since start', kg.start === 68.4 && kg.latest === 69.3 && near(kg.change, 0.9) && kg.n === 3 && kg.startIso === '2026-11-01');
const belly = P.changeSinceStart('belly');
ok('belly skips missing value', belly.latest === 83.5 && near(belly.change, -0.5) && belly.n === 2);
const arm = P.changeSinceStart('m:Arm');
ok('custom measure change', arm.start === 29.5 && arm.latest === 30.6 && near(arm.change, 1.1));
ok('chest series only where logged', P.series('m:Chest').length === 2);
ok('latestWeight', P.latestWeight() === 69.3);
P.removeMeasure('Chest');
ok('remove measure keeps saved values', P.measures().join() === 'Arm' && P.weighinOn('2026-11-15').m.Chest === 93);
ok('delete weigh-in', P.deleteWeighin('2026-11-15') && !P.weighinOn('2026-11-15') && P.latestWeight() === 69);

// click flow through the module with a fake form
{
  reset();
  const inputs = { 'prog-date': '2026-11-01', 'prog-kg': '67,8', 'prog-belly': '85', 'prog-notes': '<b>hi</b>' };
  const measureInputs = [{ value: '29', dataset: { measure: 'Arm' } }];
  P.addMeasure('Arm');
  const form = { querySelector: q => ({ value: inputs[q.slice(1)] ?? '' }), querySelectorAll: () => measureInputs };
  const el = { dataset: { iso: '2026-11-01' }, closest: () => form };
  let went = null, msg = null;
  const c = ctxFor('2026-11-01', { go: h => { went = h; }, notify: m => { msg = m; } });
  await prog.click('prog-save', el, c);
  const w = P.weighinOn('2026-11-01');
  ok('click save stores form values', w && w.kg === 67.8 && w.belly === 85 && w.m.Arm === 29 && went === '#/progress' && msg === 'Weigh-in saved');
  ok('notes escaped in overview', prog.view(c, '').includes('&lt;b&gt;hi&lt;/b&gt;') && !prog.view(c, '').includes('<b>hi</b>'));
  inputs['prog-date'] = '2026-11-05';
  await prog.click('prog-save', el, c);
  ok('future date refused', !P.weighinOn('2026-11-05'));
  await prog.click('prog-delete', { dataset: { iso: '2026-11-01' } }, c);
  ok('click delete with confirm', !P.weighinOn('2026-11-01'));
}

// ---------- gym: weekly volume, sessions, PRs ----------
reset();
const set = (type, w, r, extra = {}) => ({ type, plan: {}, done: { w, r, at: 1, ...extra } });
const sess = (id, rd, ex, endedAt = 2) => ({ id, rd, planIso: rd, kind: 'Full Body A', loc: 'home', startedAt: 1, endedAt, feel: null, notes: '', ex });
st.update('gym', g => {
  g.sessions = {
    a: sess('a', '2026-11-02', [
      { id: 'goblet-squat', sets: [set('warm', 6, 10), set('work', 10, 10), set('work', 10, 8)] },
      { id: 'incline-pushup', sets: [set('work', null, 12), set('work', undefined, 10)] },
      { id: 'plank', sets: [{ type: 'work', plan: {}, done: { sec: 30, at: 1 } }] },
    ]),
    b: sess('b', '2026-11-05', [
      { id: 'goblet-squat', sets: [set('warm', 30, 10), set('work', 12, 6), set('work', 10, 12)] },
      { id: 'db-row', sets: [{ type: 'work', plan: {}, done: { w: 8, rl: 10, rr: 9, at: 1 } }, { type: 'work', plan: {}, done: null }] },
    ]),
    c: sess('c', '2026-11-06', [{ id: 'goblet-squat', sets: [set('work', 50, 10)] }], null), // not finished: ignored
    d: sess('d', '2026-11-10', [{ id: 'goblet-squat', sets: [set('work', 12, 10)] }]),
  };
});
const wk = P.gymWeek('2026-11-02');
// work sets only: 10*10 + 10*8 + 12*6 + 10*12 + 8*(10+9) = 100+80+72+120+152 = 524
ok('weekly volume excludes warm-up sets and unfinished sessions', near(wk.kg, 524));
ok('sessions per week counts done only', wk.sessions === 2);
ok('bodyweight reps counted separately', wk.bwReps === 22);
ok('timed holds not in volume', wk.sec === 30);
ok('next week separate', P.gymWeek('2026-11-09').sessions === 1 && near(P.gymWeek('2026-11-09').kg, 120));
const pr = P.prs();
const gs = pr['goblet-squat'];
ok('heaviest weight ignores warm-up 30 kg and unfinished 50 kg', gs.heaviest.w === 12 && gs.heaviest.r === 10 && gs.heaviest.iso === '2026-11-10');
ok('most reps at a weight', gs.repsAt[10].r === 12 && gs.repsAt[12].r === 10);
ok('best estimated 1RM (Epley)', near(gs.e1rm.v, 16) && gs.e1rm.w === 12 && gs.e1rm.r === 10);
ok('1RM history per session', gs.history.length === 3 && near(gs.history[0].e1rm, 13.3));
ok('one-sided reps use weaker side for records', pr['db-row'].heaviest.r === 9);
ok('bodyweight PR', pr['incline-pushup'].bwReps.r === 12 && !pr['incline-pushup'].heaviest);
ok('hold PR', pr.plank.hold.sec === 30);
ok('epley 1 rep = weight', P.epley(20, 1) === 20 && near(P.epley(10, 30), 20));

// ---------- monthly summary ----------
reset();
st.update('gym', g => { g.sessions = {
  a: sess('a', '2026-10-31', [{ id: 'db-bench', sets: [set('work', 8, 10)] }]),
  b: sess('b', '2026-11-02', [{ id: 'db-bench', sets: [set('warm', 4, 10), set('work', 10, 10)] }]),
  c: sess('c', '2026-11-04', [{ id: 'db-bench', sets: [set('work', 10, 12)] }]) }; });
st.update('study', x => { x.log = { '2026-10-30': { aws: { done: true, min: 90 }, mandarin: { min: 15 } }, '2026-11-01': { aws: { min: 90 }, mandarin: { min: 15 } }, '2026-11-02': { aws: { min: 20 }, mandarin: { min: 10 } } }; });
st.update('food', f => { f.log = { '2026-11-01': [{ n: 'a', k: 1000, p: 50 }, { n: 'b', k: 1400, p: 70 }], '2026-11-02': [{ n: 'c', k: 2600, p: 110 }], '2026-11-03': [] }; });
st.update('days', d => { Object.assign(d, {
  '2026-11-01': { junk: true, water: 2000, walk: true },   // all three (rest day, target 2000)
  '2026-11-02': { junk: true, water: 2000, walk: true },   // gym day: water target 2500, so not complete
  '2026-11-03': { junk: true, water: 2600, walk: true },   // complete
  '2026-10-31': { junk: true, water: 3000, walk: true } }); });
P.saveWeighin('2026-10-25', { kg: 68, m: {} });
P.saveWeighin('2026-11-01', { kg: 68.5, m: {} });
P.saveWeighin('2026-11-29', { kg: 69.2, m: {} });
const nov = P.monthSummary('2026-11', s(), ctxFor('2026-11-30'));
ok('month gym sessions', nov.gym === 2);
ok('month volume (no warm-up)', near(nov.kg, 220));
ok('month study minutes', nov.study.aws === 110 && nov.study.mandarin === 25);
ok('month checklist days use gym-day water target', nov.checklist === 2);
ok('month food average over days with entries', nov.food.days === 2 && nov.food.k === 2500 && nov.food.p === 115);
ok('month weigh change from last weigh-in before the month', nov.weigh.latest === 69.2 && near(nov.weigh.change, 1.2) && nov.weigh.from === '2026-10-25');
const oct = P.monthSummary('2026-10', s(), ctxFor('2026-11-30'));
ok('October separate', oct.gym === 1 && near(oct.kg, 80) && oct.study.aws === 90 && oct.checklist === 1 && oct.weigh.latest === 68);
ok('ctx.waterTarget hook overrides', P.monthSummary('2026-11', s(), ctxFor('2026-11-30', { waterTarget: () => 2000 })).checklist === 3);

// ---------- Sunday review ----------
// Week Mon 26 Oct – Sun 1 Nov
const rc = ctxFor('2026-11-01', { gymPlanned: m => (m === '2026-10-26' ? 3 : 0), studyPlanned: () => ({ aws: 400, mandarin: 105 }) });
const r = P.weekReview('2026-10-26', rc);
ok('review gym done vs planned', r.gym.done === 1 && r.gym.planned === 3);
ok('review study vs plan', r.study.aws === 180 && r.study.mandarin === 30 && r.study.plan.aws === 400 && r.study.plan.mandarin === 105);
ok('review food averages (days with entries)', r.food.days === 1 && r.food.k === 2400 && r.food.p === 120);
ok('review checklist days', r.checklist === 2 && r.elapsed === 7);
ok("review this week's weigh-in and previous", r.weigh.iso === '2026-11-01' && r.weigh.kg === 68.5 && r.weighPrev.iso === '2026-10-25');
const r2 = P.weekReview('2026-10-26', ctxFor('2026-10-28'));
ok('review without hooks omits planned', r2.gym.planned === null && r2.study.plan === null && r2.elapsed === 3);
ok('review view renders planned text', prog.view(rc, 'review').includes('1 of 3 planned') && prog.view(rc, 'review').includes('180 min of 400 min planned'));
ok('review view without hooks', !prog.view(ctxFor('2026-11-01'), 'review').includes('planned'));

// ---------- today card ----------
reset();
const sun = ctxFor('2026-11-01'), mon = ctxFor('2026-11-02');
ok('today card on weigh day prompts', prog && P.todayCard(sun).includes('Weigh-in today') && P.todayCard(sun).includes('#/progress/weigh') && P.todayCard(sun).includes('#/progress/review'));
ok("today card empty on Monday", P.todayCard(mon) === '');
P.saveWeighin('2026-11-01', { kg: 68.2, m: {} });
ok('today card shows logged value', P.todayCard(sun).includes('68.2 kg') && !P.todayCard(sun).includes('Weigh-in today'));
st.setSetting('weighDay', 3);
const wed = ctxFor('2026-11-04');
ok('weigh day setting respected', P.todayCard(wed).includes('Weigh-in today') && !P.todayCard(wed).includes('review') && P.todayCard(ctxFor('2026-11-01')).includes('review') && !P.todayCard(ctxFor('2026-11-01')).includes('Weigh-in'));

// ---------- language checks ----------
reset();
const all = ['', 'weigh', 'gym', 'study', 'habits', 'month', 'review'].map(a => prog.view(sun, a)).join(' ');
ok('no weight-loss or burn language', !/burn|lose|loss|deficit|BMI|BMR|fail/i.test(all));

console.log(fail ? `\n${fail} FAILED` : '\nAll progress tests passed');
process.exit(fail ? 1 : 0);
