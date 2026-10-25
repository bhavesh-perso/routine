// Shift engine. Dates are 'YYYY-MM-DD' strings; all maths uses integer day numbers.
const MS = 86400000;
const WORK_DAYS = [0, 1, 5, 6, 9, 10, 11]; // cycle days that are work days

export const DEFAULTS = {
  anchor: '2026-10-28',      // cycle day 0, a work day
  anchorBlock: 'night',      // block type the anchor starts with
  blockLength: 28,           // multiple of 14
  night:   { start: '19:00', end: '07:00' },
  morning: { start: '07:00', end: '19:00' },
  wake: { nightWork: 900, nightOff: 960, morningWork: 270, morningOff: 375 }, // minutes since midnight
  overrides: {},             // 'YYYY-MM-DD' -> {kind:'off'|'leave'|'sick'|'work'|'custom', block?, start?, end?}
};

export const mod = (a, n) => ((a % n) + n) % n;
export const dayNum = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / MS); };
export const isoOf = n => new Date(n * MS).toISOString().slice(0, 10);
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export function validateSettings(s) {
  if (!Number.isInteger(s.blockLength) || s.blockLength <= 0 || s.blockLength % 14 !== 0)
    throw new Error('Block length must be a multiple of 14 days.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.anchor)) throw new Error('Anchor must be YYYY-MM-DD.');
  return s;
}

function patternDay(n, s) {
  const since = n - dayNum(s.anchor);
  const cycleDay = mod(since, 14);
  const blockIndex = Math.floor(since / s.blockLength);
  const anchorIsNight = s.anchorBlock === 'night';
  const block = (mod(blockIndex, 2) === 0) === anchorIsNight ? 'night' : 'morning';
  return { cycleDay, block, type: WORK_DAYS.includes(cycleDay) ? 'work' : 'off' };
}

// Effective type/block/shift for a day number, overrides applied.
function effective(n, s) {
  const p = patternDay(n, s);
  const ov = s.overrides?.[isoOf(n)] || null;
  let type = p.type, block = p.block, start = null, end = null;
  if (ov) {
    if (ov.kind === 'off' || ov.kind === 'leave' || ov.kind === 'sick') type = 'off';
    else if (ov.kind === 'work') { type = 'work'; block = ov.block || block; }
    else if (ov.kind === 'custom') { type = 'work'; start = ov.start; end = ov.end; }
  }
  if (type === 'work' && !start) ({ start, end } = s[block]);
  if (type === 'off') { start = null; end = null; }
  return { cycleDay: p.cycleDay, type, block, start, end, override: ov };
}

export function getDay(iso, s = DEFAULTS) {
  const n = dayNum(iso);
  const e = effective(n, s);
  const off = e.type === 'off';
  const endsNextDay = !off && toMin(e.end) <= toMin(e.start);
  let isBlockSwitchDay = false;
  if (off) {
    let next = null, prev = null;
    for (let k = 1; k <= 2 && !next; k++) if (effective(n + k, s).type === 'work') next = effective(n + k, s);
    for (let k = 1; k <= 5 && !prev; k++) if (effective(n - k, s).type === 'work') prev = effective(n - k, s);
    isBlockSwitchDay = !!(next && prev && next.block !== prev.block);
  }
  return {
    date: iso, cycleDay: e.cycleDay, type: e.type, block: e.block,
    shiftStart: e.start, shiftEnd: e.end, endsNextDay,
    isFirstOffAfterWork: off && effective(n - 1, s).type === 'work',
    isLastOffBeforeWork: off && effective(n + 1, s).type === 'work',
    isBlockSwitchDay, override: e.override,
  };
}

// UI text for the shift line, explicit about night shifts crossing midnight.
export function describeShift(iso, s = DEFAULTS) {
  const d = getDay(iso, s);
  if (d.endsNextDay) return `Shift ${d.shiftStart} → ends tomorrow ${d.shiftEnd}`;
  if (d.type === 'work') return `Shift ${d.shiftStart}–${d.shiftEnd}`;
  const y = getDay(isoOf(dayNum(iso) - 1), s);
  if (y.endsNextDay) return `Shift ends ${y.shiftEnd} (started yesterday)`;
  return 'No shift';
}

export function wakeMinutes(iso, s = DEFAULTS) {
  const d = getDay(iso, s), w = s.wake;
  if (d.block === 'night') return d.type === 'work' ? w.nightWork : w.nightOff;
  return d.type === 'work' ? w.morningWork : w.morningOff;
}

// The routine day is the latest date whose wake time is <= now (day boundary = wake, not midnight).
export function routineDay(iso, minutes, s = DEFAULTS) {
  const now = dayNum(iso) * 1440 + minutes;
  for (let k = 0; k <= 2; k++) {
    const d = isoOf(dayNum(iso) - k);
    if (dayNum(d) * 1440 + wakeMinutes(d, s) <= now) return d;
  }
  return isoOf(dayNum(iso) - 2);
}
