// node tests/plan.test.js — day timelines, sleep rules, block switches, routine day.
const mem = {}; globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, key: i => Object.keys(mem)[i], get length() { return Object.keys(mem).length; } };
const { getSettings } = await import('../js/storage.js');
const P = await import('../js/plan.js');
let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; };
const s = getSettings();
const at = (iso, kind) => P.dayPlan(iso, s).filter(b => b.kind === kind);
const hhmm = m => P.timeLabel(m);

ok('night work day wakes 15:00', P.wakeFor('2026-10-29', s) === 900);
ok('night off day sleeps 09:00–16:00', P.wakeFor('2026-10-31', s) === 960 && P.sleepFor('2026-10-31', s).start === 540);
ok('morning work day wakes 04:30 after 21:45', P.wakeFor('2026-11-26', s) === 270 && P.sleepFor('2026-11-26', s).start === 1305 - 1440);
ok('morning off day wakes 06:15 after 23:15', P.wakeFor('2026-11-28', s) === 375 && P.sleepFor('2026-11-28', s).start === 1395 - 1440);
ok('morning off day before work sleeps 21:45', P.bedFor('2026-11-30', s) === 1305);

const sh = at('2026-10-29', 'shift')[0];
ok('night shift block 19:00 → 07:00 next day', sh.start === 1140 && sh.end === 1860);
const m2 = P.dayPlan('2026-10-29', s).find(b => b.slot === 'm2');
ok('packed meal 2 at 23:00 on night shift', m2.start === 1380);
ok('caffeine cutoff 01:00', P.dayPlan('2026-10-29', s).some(b => b.label === 'Caffeine cutoff' && b.start === 1500));
ok('night shift sleep 08:15 next morning before another shift, 09:00 before an off day', P.bedFor('2026-10-28', s) === 1440 + 495 && P.bedFor('2026-10-29', s) === 1440 + 540);
ok('drive home flagged for drowsy note', at('2026-10-29', 'drive').some(b => b.drowsy && b.start === 1860));
ok('morning work: leave 05:30, meal 2 12:00, snack 15:30', at('2026-11-26', 'drive')[0].start === 330 && P.dayPlan('2026-11-26', s).find(b => b.slot === 'm2').start === 720 && P.dayPlan('2026-11-26', s).find(b => b.slot === 'snack').start === 930);
ok('morning work non-gym: meal 3 20:00, study 20:30', P.dayPlan('2026-11-26', s).find(b => b.slot === 'm3').start === 1200 && at('2026-11-26', 'study')[0].start === 1230);
ok('morning off: study 09:00–10:45 (90 + 15 min)', at('2026-11-28', 'study')[0].start === 540 && at('2026-11-28', 'study')[0].end === 645);
ok('night off: study 21:00 (90 + 15 min)', at('2026-10-31', 'study')[0].start === 1260 && at('2026-10-31', 'study')[0].end === 1365);
ok('work day study is 20 + 15 min', at('2026-10-29', 'study')[0].end - at('2026-10-29', 'study')[0].start === 35);
ok('batch cook on first off day of a stretch only', at('2026-10-30', 'cook').length === 1 && at('2026-10-31', 'cook').length === 0 && at('2026-11-04', 'cook').length === 1);
ok('weigh-in on Sunday at wake', at('2026-11-01', 'weigh')[0]?.start === P.wakeFor('2026-11-01', s) && at('2026-10-31', 'weigh').length === 0);
ok('walk every day', ['2026-10-29', '2026-10-31', '2026-11-26', '2026-11-28'].every(d => at(d, 'walk').length === 1));
ok('no AWS after the exam date, Mandarin stays', P.studyMinutes('2026-12-22', s).aws === 0 && P.studyMinutes('2026-12-22', s).mandarin === 15);

// Block switch night → morning (23–24 Nov 2026, first morning shift 25 Nov)
ok('23 Nov: nap 08:15–11:30, routine day starts 11:30', P.sleepFor('2026-11-23', s).nap && P.wakeFor('2026-11-23', s) === 690);
ok('23 Nov: bed 21:45', P.bedFor('2026-11-23', s) === 1305);
ok('24 Nov: 21:45 → 04:30, bed 21:45', P.wakeFor('2026-11-24', s) === 270 && P.bedFor('2026-11-24', s) === 1305);
ok('25 Nov: first morning shift wakes 04:30', P.wakeFor('2026-11-25', s) === 270);
// Block switch morning → night (21–22 Dec 2026, first night shift 23 Dec)
ok('21 Dec: bed 01:15', P.bedFor('2026-12-21', s) === 1440 + 75);
ok('22 Dec: wake 08:15, bed 03:15', P.wakeFor('2026-12-22', s) === 495 && P.bedFor('2026-12-22', s) === 1440 + 195);
ok('23 Dec: wake 10:15 before first night shift', P.wakeFor('2026-12-23', s) === 615);
ok('switch card on 23 Nov and 21 Dec, not on a normal day', P.switchCard('2026-11-23', s)?.to === 'morning' && P.switchCard('2026-12-21', s)?.to === 'night' && P.switchCard('2026-11-01', s) === null);

// Routine day
ok('02:00 on 29 Oct belongs to 28 Oct', P.routineDayAt('2026-10-29', 120, s) === '2026-10-28');
ok('10:00 on 30 Oct still 29 Oct (asleep after shift)', P.routineDayAt('2026-10-30', 600, s) === '2026-10-29');
ok('16:00 on 30 Oct is 30 Oct', P.routineDayAt('2026-10-30', 960, s) === '2026-10-30');
ok('04:29 on 26 Nov is still 25 Nov, 04:30 is 26 Nov', P.routineDayAt('2026-11-26', 269, s) === '2026-11-25' && P.routineDayAt('2026-11-26', 270, s) === '2026-11-26');

// Every day for 16 weeks: blocks sorted, nothing after bedtime, no meal inside gym/study/cook
let clean = true;
for (let i = 0; i < 112; i++) {
  const iso = (await import('../js/util.js')).addDays('2026-10-26', i), b = P.dayPlan(iso, s), bed = P.bedFor(iso, s);
  for (let j = 1; j < b.length; j++) if (b[j].start < b[j - 1].start) clean = false;
  if (b.some(x => x.kind !== 'sleep' && x.start >= bed)) clean = false;
  const busy = b.filter(x => ['gym', 'study', 'cook'].includes(x.kind));
  if (b.some(x => x.kind === 'meal' && busy.some(y => x.start >= y.start && x.start < y.end))) clean = false;
}
ok('16 weeks of plans are ordered and fit before bed', clean);

const alt = { ...s, sleep: { ...s.sleep, nightOff: { start: '08:30', end: '15:30' } }, wake: { ...s.wake, nightOff: 930 } };
ok('changing a sleep window changes wake time', P.wakeFor('2026-10-31', alt) === 930);
console.log(fail ? `\n${fail} FAILED` : '\nAll plan tests passed');
process.exit(fail ? 1 : 0);
