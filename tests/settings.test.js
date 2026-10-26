// node tests/settings.test.js
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
  key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};
globalThis.confirm = () => true;

const st = await import('../js/storage.js');
const { getDay } = await import('../js/schedule.js');
const { setProviders } = await import('../js/plan.js');
const settings = await import('../js/settings.js');
const mod = settings.default;
setProviders({ gymFor: () => null });

let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; };
const notes = [];
const ctx = (extra = {}) => ({ s: st.getSettings(), iso: '2026-10-26', rd: '2026-10-26', min: 1020, ms: Date.UTC(2026, 9, 26, 13), go() {}, rerender() {}, notify: m => notes.push(m), ...extra });
const field = (path, kind, raw, el) => settings._saveField(path, kind, raw, ctx(), el);

// ---- block length validation ----
field('blockLength', 'int', '20', { min: '14', max: '364' });
ok('invalid block length (20) is not saved', st.getSettings().blockLength === 28);
ok('invalid block length shows the error', /multiple of 14/.test(settings._ui.errors.blockLength || ''));
ok('error is rendered on the screen', mod.view(ctx(), 'shifts').includes('multiple of 14'));
field('blockLength', 'int', '42', { min: '14', max: '364' });
ok('valid block length (42) saves and clears the error', st.getSettings().blockLength === 42 && !settings._ui.errors.blockLength);
field('blockLength', 'int', '28', { min: '14', max: '364' });
ok('"Saved" notification shown', notes.includes('Saved'));
field('night.start', 'time', '25:00');
ok('bad time rejected', st.getSettings().night.start === '19:00' && !!settings._ui.errors['night.start']);
field('night.start', 'time', '19:00');
field('exam', 'date', '2026-10-01');
ok('exam before study start rejected', st.getSettings().exam === '2026-12-21');
field('gymSlots.morningWork#1', 'time', '19:30');
ok('gym slot half saves as one HH:MM-HH:MM string', st.getSettings().gymSlots.morningWork === '19:10-19:30');
field('gymSlots.morningWork#1', 'time', '19:00');
ok('gym slot ending before it starts is rejected', st.getSettings().gymSlots.morningWork === '19:10-19:30');
field('gymSlots.morningWork#1', 'time', '19:55');

// ---- dumbbells ----
const p = settings.parseDumbbells('10, 2,4kg 4; 2.5');
ok('dumbbell list is parsed, de-duplicated and sorted', p.ok && JSON.stringify(p.list) === '[2,2.5,4,10]');
ok('dumbbell list with junk is rejected', !settings.parseDumbbells('2, four, 6').ok && !settings.parseDumbbells('').ok && !settings.parseDumbbells('-2').ok);
field('dumbbells.home', 'text', '12, 6, 8');
ok('dumbbell list saved per gym', JSON.stringify(st.getSettings().dumbbells.home) === '[6,8,12]' && st.getSettings().dumbbells.work.length === 10);

// ---- equipment ----
mod.change('set-equip', { dataset: { gym: 'work', item: 'treadmill' }, checked: true }, ctx());
ok('equipment checkbox adds to that gym only', st.getSettings().equipment.work.includes('treadmill') && !st.getSettings().equipment.home.includes('treadmill'));
mod.change('set-bool', { dataset: { path: 'restSound' }, checked: false }, ctx());
ok('rest sound toggle saves', st.getSettings().restSound === false);

// ---- overrides ----
ok('28 Oct is a work day by pattern', getDay('2026-10-28', st.getSettings()).type === 'work');
ok('add override: sick', settings.addOverride('2026-10-28', 'sick').ok && getDay('2026-10-28', st.getSettings()).type === 'off');
ok('add override: swap to morning work', settings.addOverride('2026-10-30', 'work-morning').ok && getDay('2026-10-30', st.getSettings()).shiftStart === '07:00');
ok('add override: custom times', settings.addOverride('2026-10-31', 'custom', '10:00', '16:00').ok && getDay('2026-10-31', st.getSettings()).shiftEnd === '16:00');
ok('custom override without times is rejected', !settings.addOverride('2026-11-01', 'custom', '', '').ok);
ok('override list shows on the screen', mod.view(ctx(), 'overrides').includes('Sick') && mod.view(ctx(), 'overrides').includes('Custom shift 10:00–16:00'));
await mod.click('set-ov-clear', { dataset: { iso: '2026-10-28' } }, ctx());
ok('clear override restores the pattern', getDay('2026-10-28', st.getSettings()).type === 'work' && !getDay('2026-10-28', st.getSettings()).override);

// ---- backup round trip ----
st.setDayLog('2026-10-25', { water: 1500, junk: true });
st.update('progress', p => { p.weighins = { '2026-10-25': { kg: 68.4 } }; });
const before = JSON.stringify({ s: st.getSettings(), d: st.get('days'), p: st.get('progress') });
const file = JSON.parse(JSON.stringify(st.exportAll()));
ok('export has app, schema and data', file.app === 'routine' && file.schema === st.SCHEMA && !!file.data.settings);
ok('backup file name', settings.backupName('2026-10-26') === 'routine-backup-2026-10-26.json');
st.resetAll();
ok('reset clears data', st.getSettings().blockLength === 28 && !st.get('days')['2026-10-25'] && !st.getSettings().overrides['2026-10-30']);
const parsed = st.parseImport(file, '2026-10-26');
ok('parseImport accepts the export', parsed.ok);
const sum = settings.backupSummary(parsed.data).join('\n');
ok('import summary counts per area', sum.includes('Checklist days: 1') && sum.includes('Weigh-ins: 1') && /including 2 changed days/.test(sum));
st.replaceAll(parsed.data);
ok('round trip restores everything', JSON.stringify({ s: st.getSettings(), d: st.get('days'), p: st.get('progress') }) === before);
ok('parseImport rejects other files', !st.parseImport({ hello: 1 }, '2026-10-26').ok);

// ---- import through the change handler ----
st.resetAll();
const fakeFile = text => ({ files: [{ text: async () => text }], value: 'x' });
await mod.change('set-import', fakeFile(JSON.stringify(file)), ctx());
ok('import handler restores after confirm', st.getSettings().overrides['2026-10-30']?.block === 'morning');
await mod.change('set-import', fakeFile('{nope'), ctx());
ok('import handler reports bad JSON', /valid JSON/.test(settings._ui.importMsg) && mod.view(ctx(), 'data').includes('valid JSON'));

// ---- backup banner ----
const DAY = 864e5, now = Date.UTC(2026, 9, 26, 8);
st.update('meta', m => { m.firstUse = '2026-10-20'; m.lastBackup = null; });
ok('banner hidden for a new install (first use < 14 days ago)', settings.backupBanner(ctx()) === '');
st.update('meta', m => { m.firstUse = '2026-10-01'; });
ok('banner shown when never backed up and in use > 14 days', settings.backupBanner(ctx()).includes('#/settings/data'));
st.update('meta', m => { m.lastBackup = now - 20 * DAY; });
const b = settings.backupBanner(ctx());
ok('banner shown when last backup is 20 days old', b.includes('Last backup was 20 days ago') && b.includes('class="note') && b.includes('iPhone Safari can clear saved data'));
st.update('meta', m => { m.lastBackup = now - 3 * DAY; });
ok('banner hidden after a recent backup', settings.backupBanner(ctx()) === '');
st.update('meta', m => { m.lastBackup = null; m.firstUse = null; });
ok('banner hidden with no data at all', settings.backupBanner(ctx()) === '');

// ---- reset needs two confirmations ----
let asked = 0; globalThis.confirm = () => (++asked === 1);
st.setSetting('kcal', 2700);
await mod.click('set-reset', {}, ctx());
ok('reset stops if the second confirm is declined', asked === 2 && st.getSettings().kcal === 2700);
globalThis.confirm = () => true;
await mod.click('set-reset', {}, ctx());
ok('reset runs after two confirms', st.getSettings().kcal === 2500);

// ---- views render ----
let threw = null;
try { for (const a of ['', 'data', 'shifts', 'overrides', 'sleep', 'gym', 'food', 'study', 'progress', 'nope']) mod.view(ctx(), a); } catch (e) { threw = e; }
ok('every section renders without throwing', !threw);
const html = mod.view(ctx(), '');
ok('every input and select sits in a label', (html.match(/<input|<select/g) || []).length === (html.match(/<label/g) || []).length);
ok('never suggests 8–9 hours of sleep', !/\b(8|9|8–9|8-9) ?h(ours)?\b/i.test(html));

console.log(fail ? `\n${fail} FAILED` : '\nAll settings tests passed');
process.exit(fail ? 1 : 0);
