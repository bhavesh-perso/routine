// node tests/ics.test.js
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
  key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};
const { getSettings } = await import('../js/storage.js');
const { setProviders, dayPlan } = await import('../js/plan.js');
const { buildIcs, icsEvents, fold, escText, localStamp } = await import('../js/ics.js');

let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; };

// Stub gym provider: two sessions in the range.
const GYM = { '2026-10-30': { kind: 'Full Body A', loc: 'home', start: '18:00', end: '19:15' }, '2026-11-01': { kind: 'Full Body B', loc: 'home', start: '18:00', end: '19:15' } };
setProviders({ gymFor: iso => GYM[iso] || null });

const s = getSettings();
const FROM = '2026-10-26', DAYS = 7;
const NOW = Date.UTC(2026, 9, 26, 6, 0, 0);
const ics = buildIcs(s, FROM, DAYS, { now: NOW });
const lines = ics.split('\r\n');
const unfolded = ics.replace(/\r\n /g, '');

{
  setProviders({ runFor: iso => iso === '2026-10-31' ? { title: 'Long run 5 km', start: '18:00', end: '18:35', km: 5 } : null });
  const ev = icsEvents(s, FROM, DAYS).filter(e => e.kind === 'run');
  ok('ics export includes a run event for a standalone run', ev.length === 1 && ev[0].summary === 'Run: Long run 5 km' && ev[0].start.endsWith('T180000') && ev[0].end.endsWith('T183500'));
  setProviders({ runFor: () => null });
}
ok('starts with BEGIN:VCALENDAR and ends with END:VCALENDAR + CRLF', ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
ok('VERSION and PRODID present', /\r\nVERSION:2\.0\r\n/.test(ics) && /\r\nPRODID:/.test(ics));
ok('VTIMEZONE for Indian/Mauritius, +0400, no DAYLIGHT', /BEGIN:VTIMEZONE\r\nTZID:Indian\/Mauritius\r\nBEGIN:STANDARD/.test(ics) && /TZOFFSETFROM:\+0400\r\nTZOFFSETTO:\+0400/.test(ics) && !ics.includes('DAYLIGHT'));
ok('every line break is CRLF (no bare LF)', !/[^\r]\n/.test(ics));
const enc = new TextEncoder();
ok('every physical line is at most 75 octets', lines.every(l => enc.encode(l).length <= 75));

// Expected events = plan blocks of kind shift/gym/study/weigh.
const expected = [];
for (let i = 0; i < DAYS; i++) {
  const iso = new Date(Date.UTC(2026, 9, 26 + i)).toISOString().slice(0, 10);
  dayPlan(iso, s).filter(b => ['shift', 'gym', 'study', 'weigh'].includes(b.kind)).forEach(b => expected.push({ iso, kind: b.kind }));
}
const vevents = unfolded.split('BEGIN:VEVENT').slice(1);
ok(`one VEVENT per expected block (${expected.length})`, vevents.length === expected.length && expected.length > 0);
const countKind = k => expected.filter(e => e.kind === k).length;
ok('range has 2 shifts, 2 gym sessions, 7 study blocks, 1 weigh-in', countKind('shift') === 2 && countKind('gym') === 2 && countKind('study') === 7 && countKind('weigh') === 1);
ok('each VEVENT has a VALARM with TRIGGER:-PT15M and ACTION:DISPLAY', vevents.every(v => /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:[^\r]*\r\nTRIGGER:-PT15M\r\nEND:VALARM/.test(v)));
ok('BEGIN/END balanced', (unfolded.match(/BEGIN:VEVENT/g) || []).length === (unfolded.match(/END:VEVENT/g) || []).length);

const shift28 = vevents.find(v => v.includes('UID:20261028-shift@routine.bhavesh-perso'));
ok('night shift 28 Oct 19:00 → 29 Oct 07:00 in Mauritius time', !!shift28 && shift28.includes('DTSTART;TZID=Indian/Mauritius:20261028T190000') && shift28.includes('DTEND;TZID=Indian/Mauritius:20261029T070000'));
ok('gym 30 Oct 18:00–19:15', vevents.some(v => v.includes('UID:20261030-gym@routine.bhavesh-perso') && v.includes(':20261030T180000') && v.includes(':20261030T191500')));
ok('weigh-in on Sunday 1 Nov at wake, at least 10 min long', vevents.some(v => v.includes('UID:20261101-weigh@') && v.includes('DTSTART;TZID=Indian/Mauritius:20261101T163000') && v.includes('DTEND;TZID=Indian/Mauritius:20261101T164000')));
ok('DTSTAMP is UTC', vevents.every(v => v.includes('DTSTAMP:20261026T060000Z')));
const uids = vevents.map(v => v.match(/UID:([^\r]+)/)[1]);
ok('UIDs are unique', new Set(uids).size === uids.length);

const again = buildIcs(s, FROM, DAYS, { now: NOW + 3600e3 }).replace(/\r\n /g, '');
const uids2 = again.split('BEGIN:VEVENT').slice(1).map(v => v.match(/UID:([^\r]+)/)[1]);
ok('UIDs are stable across two builds', JSON.stringify(uids) === JSON.stringify(uids2));
const overlap = buildIcs(s, '2026-10-28', 3, { now: NOW }).replace(/\r\n /g, '');
ok('UIDs stable when the range starts on a different day', overlap.includes('UID:20261028-shift@routine.bhavesh-perso') && overlap.includes('UID:20261030-gym@routine.bhavesh-perso'));

ok('default range is 56 days', new Set(icsEvents(s, FROM).map(e => e.iso)).size === 56);

// The morning after a night shift: nextDay slot lands on the next calendar date.
setProviders({ gymFor: iso => iso === '2026-10-29' ? { kind: 'Upper', loc: 'home', start: '07:50', end: '08:50', nextDay: true } : null });
const nd = icsEvents(s, '2026-10-29', 1).find(e => e.kind === 'gym');
ok('next-morning gym session exports on the next calendar day (07:50-08:50)', nd.iso === '2026-10-29' && nd.start === '20261030T075000' && nd.end === '20261030T085000' && nd.summary === 'Gym: Upper (gym near home)');
ok('its UID stays on the plan day', nd.uid === '20261029-gym@routine.bhavesh-perso');

// Helpers
ok('localStamp: ≥1440 rolls to the next day', localStamp('2026-10-31', 1860) === '20261101T070000');
ok('localStamp: negative belongs to the day before', localStamp('2026-11-01', -135) === '20261031T214500');
ok('escText escapes \\ ; , and newlines', escText('a\\b;c,d\ne') === 'a\\\\b\\;c\\,d\\ne');
const long = 'SUMMARY:' + 'Gym: Full Body A at the home gym, then cardio and a long note — ünïcödé '.repeat(3);
const f = fold(long);
ok('fold keeps lines ≤ 75 octets and unfolds back', f.split('\r\n').every(l => enc.encode(l).length <= 75) && f.replace(/\r\n /g, '') === long);
ok('fold leaves short lines alone', fold('UID:x') === 'UID:x');

console.log(fail ? `\n${fail} FAILED` : '\nAll ics tests passed');
process.exit(fail ? 1 : 0);
