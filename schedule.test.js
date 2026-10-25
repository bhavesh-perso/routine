import { getDay, routineDay, describeShift, validateSettings, DEFAULTS } from './js/schedule.js';
let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; };
const types = (days, t) => days.every(d => getDay(d).type === t);

ok('28-29 Oct work', types(['2026-10-28', '2026-10-29'], 'work'));
ok('30 Oct-1 Nov off', types(['2026-10-30', '2026-10-31', '2026-11-01'], 'off'));
ok('2-3 Nov work', types(['2026-11-02', '2026-11-03'], 'work'));
ok('4-5 Nov off', types(['2026-11-04', '2026-11-05'], 'off'));
ok('6-8 Nov work', types(['2026-11-06', '2026-11-07', '2026-11-08'], 'work'));
ok('9-10 Nov off', types(['2026-11-09', '2026-11-10'], 'off'));
ok('11 Nov work', getDay('2026-11-11').type === 'work');

ok('28 Oct and 24 Nov are night block', getDay('2026-10-28').block === 'night' && getDay('2026-11-24').block === 'night');
const n25 = getDay('2026-11-25');
ok('25 Nov morning, cycle day 0, work', n25.block === 'morning' && n25.cycleDay === 0 && n25.type === 'work');
ok('21-22 Dec off in morning block', ['2026-12-21', '2026-12-22'].every(d => getDay(d).type === 'off' && getDay(d).block === 'morning'));
const d23 = getDay('2026-12-23');
ok('23 Dec night, cycle day 0, work', d23.block === 'night' && d23.cycleDay === 0 && d23.type === 'work');
ok('20 Jan 2027 morning', getDay('2027-01-20').block === 'morning');

ok('26 Oct = cycle day 12, off', getDay('2026-10-26').cycleDay === 12 && getDay('2026-10-26').type === 'off');
ok('27 Oct = cycle day 13, off', getDay('2026-10-27').cycleDay === 13 && getDay('2026-10-27').type === 'off');
ok('26-27 Oct fall in morning block', getDay('2026-10-26').block === 'morning');

ok('28 Oct night shift ends next day 07:00', getDay('2026-10-28').endsNextDay === true && getDay('2026-10-28').shiftEnd === '07:00');
ok('shift text on 28 Oct', describeShift('2026-10-28') === 'Shift 19:00 → ends tomorrow 07:00');
ok('shift text on 29 Oct', describeShift('2026-10-30') === 'Shift ends 07:00 (started yesterday)');
ok('first off after work 30 Oct', getDay('2026-10-30').isFirstOffAfterWork === true);
ok('last off before work 1 Nov', getDay('2026-11-01').isLastOffBeforeWork === true);
ok('block switch flags 23-24 Nov and 21-22 Dec only', ['2026-11-23', '2026-11-24', '2026-12-21', '2026-12-22'].every(d => getDay(d).isBlockSwitchDay) && !getDay('2026-10-31').isBlockSwitchDay && !getDay('2026-11-25').isBlockSwitchDay);

const ov = { ...DEFAULTS, overrides: { '2026-10-28': { kind: 'sick' }, '2026-10-30': { kind: 'work', block: 'morning' } } };
ok('override sick beats pattern', getDay('2026-10-28', ov).type === 'off' && getDay('2026-10-28', ov).override.kind === 'sick');
ok('override swap to morning work', getDay('2026-10-30', ov).type === 'work' && getDay('2026-10-30', ov).shiftStart === '07:00');
ok('no override leaves pattern', getDay('2026-10-28').type === 'work');

ok('routineDay 02:00 on 29 Oct = 28 Oct', routineDay('2026-10-29', 120) === '2026-10-28');
ok('routineDay 16:00 on 29 Oct = 29 Oct', routineDay('2026-10-29', 960) === '2026-10-29');
ok('routineDay 10:00 on 30 Oct = 29 Oct', routineDay('2026-10-30', 600) === '2026-10-29');
ok('routineDay morning block 04:30 starts day', routineDay('2026-11-25', 270) === '2026-11-25' && routineDay('2026-11-25', 269) === '2026-11-24');

const alt = { ...DEFAULTS, anchor: '2026-10-29' };
ok('settings change alters results', getDay('2026-10-28', alt).cycleDay === 13 && getDay('2026-10-28', alt).type === 'off');
let threw = false; try { validateSettings({ ...DEFAULTS, blockLength: 20 }); } catch { threw = true; }
ok('block length must be multiple of 14', threw);

console.log(fail ? `\n${fail} FAILED` : '\nAll tests passed');
process.exit(fail ? 1 : 0);
