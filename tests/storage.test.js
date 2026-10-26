// node tests/storage.test.js — split storage, migration from v1, backup round-trip, error reporting.
const mem = {}; let full = false;
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { if (full) throw new Error('QuotaExceededError'); mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, key: i => Object.keys(mem)[i], get length() { return Object.keys(mem).length; } };
mem['routine.state'] = JSON.stringify({ schema: 1, firstUse: '2026-10-25', settings: { whey: true }, logs: {
  '2026-10-25': { junk: true, water: 2000, walk: false, food: [{ n: 'Egg', k: 80, p: 6 }] },
  '2026-10-30': { junk: false, water: 0, walk: false, gym: { done: true, sets: { 'goblet-squat': [{ w: 8, r: 10 }] } } } } });
const S = await import('../js/storage.js');
let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; };

ok('migration runs once from v1', S.runMigrations('2026-10-26') === true && S.runMigrations('2026-10-26') === false);
ok('areas are stored under separate keys', ['meta', 'settings', 'days', 'food', 'study', 'gym', 'progress'].every(a => ('routine.v2.' + a) in mem));
ok('checklist kept', S.getDayLog('2026-10-25').junk === true && S.getDayLog('2026-10-25').water === 2000);
ok('food kept with meal slot field', S.get('food').log['2026-10-25'][0].n === 'Egg' && 'meal' in S.get('food').log['2026-10-25'][0]);
ok('future test gym taps dropped', Object.keys(S.get('gym').sessions).length === 0);
ok('settings kept and merged with defaults', S.getSettings().whey === true && S.getSettings().kcal === 2500 && S.getSettings().water.gym === 2500);
ok('wake derived from sleep windows', S.getSettings().wake.nightWork === 900);

const before = mem['routine.v2.food'];
S.setDayLog('2026-10-26', { walk: true });
ok('a checklist change rewrites only the days area', mem['routine.v2.food'] === before && JSON.parse(mem['routine.v2.days'])['2026-10-26'].walk === true);
S.setSetting('water.rest', 1800);
ok('dotted setSetting keeps sibling defaults', S.getSettings().water.rest === 1800 && S.getSettings().water.gym === 2500);
S.setSetting('water.rest', undefined);
ok('clearing a setting restores the default', S.getSettings().water.rest === 2000);

const dump = JSON.parse(JSON.stringify(S.exportAll()));
ok('export has app, schema and every area', dump.app === 'routine' && dump.schema === 2 && dump.data.days['2026-10-26'].walk);
ok('import rejects non-backups', S.parseImport({ hello: 1 }, '2026-10-26').ok === false);
ok('import rejects newer schema', S.parseImport({ ...dump, schema: 99 }, '2026-10-26').ok === false);
ok('import accepts an old v1 file via migration', S.parseImport({ schema: 1, logs: { '2026-10-20': { junk: true } } }, '2026-10-26').data.days['2026-10-20'].junk === true);
S.resetAll();
ok('reset clears data', S.getDayLog('2026-10-26').walk === false);
const p = S.parseImport(dump, '2026-10-26');
ok('round-trip restores data', p.ok && S.replaceAll(p.data) && S.getDayLog('2026-10-26').walk === true);

let reported = '';
S.setErrorHandler(m => { reported = m; });
full = true;
const saved = S.setDayLog('2026-10-27', { junk: true });
full = false;
ok('a failed save is reported, never silent', saved === false && /Couldn't save/.test(reported));
ok('size is measured', S.sizeBytes() > 0);
console.log(fail ? `\n${fail} FAILED` : '\nAll storage tests passed');
process.exit(fail ? 1 : 0);
