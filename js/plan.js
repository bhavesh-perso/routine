// Day-timeline generator. Builds the blocks of one routine day (wake → next sleep) from the
// day type, sleep rules, block-switch plan and settings. Minutes are relative to 00:00 of the
// day's date, so a night shift ending at 07:00 the next morning has end = 1860.
import { getDay } from './schedule.js';
import { toMin, fmt, addDays, dow } from './util.js';

// Other modules register themselves here so plan.js never imports them (no cycles).
// gymFor(iso, s) -> { kind, loc, cardio, start:'HH:MM', end:'HH:MM', nextDay? } | null
// nextDay: true means the slot is on the next calendar morning (after a night shift); add 1440 to its minutes.
// A gym slot may carry run: { title, estMin } (a run done after the session).
// runFor(iso, s) -> { title, start:'HH:MM', end:'HH:MM', km? } | null: a standalone run on an off day.
const providers = { gymFor: () => null, runFor: () => null };
export const setProviders = p => Object.assign(providers, p);

const keyOf = d => d.block + (d.type === 'work' ? 'Work' : 'Off');

// Block-switch stretch: the 2 off days (A, B) before the first work day (C) of a new block.
export function switchInfo(iso, s) {
  const d = getDay(iso, s);
  const role = (x, r) => {
    const prevWork = getDay(addDays(x, -1), s).type === 'work', nextWork = getDay(addDays(x, 1), s).type === 'work';
    if (r === 'C') return null;
    return prevWork ? 'A' : nextWork ? 'B' : null;
  };
  let r = null, A = null;
  if (d.type === 'off' && d.isBlockSwitchDay) { r = role(iso); A = r === 'A' ? iso : addDays(iso, -1); }
  else if (d.type === 'work') {
    const y = getDay(addDays(iso, -1), s);
    if (y.type === 'off' && y.isBlockSwitchDay) { r = 'C'; A = addDays(iso, -2); }
  }
  if (!r) return null;
  const C = addDays(A, 2), from = getDay(addDays(A, -1), s).block, to = getDay(C, s).block;
  if (from === to) return null;
  return { role: r, A, B: addDays(A, 1), C, from, to };
}

// When you wake on this date (minutes since its midnight). This starts the routine day.
export function wakeFor(iso, s) {
  const sw = switchInfo(iso, s), p = s.switchPlan;
  if (sw?.to === 'morning') {
    if (sw.role === 'A') return toMin(p.napEnd);
    if (sw.role === 'B') return toMin(p.morningWake);
  }
  if (sw?.to === 'night') {
    const k = { A: 0, B: 1, C: 2 }[sw.role];
    return toMin(s.sleep.morningOff.end) + k * p.laterHours * 60;
  }
  return s.wake[keyOf(getDay(iso, s))];
}

// The sleep that ends at this date's wake time. start is negative when it began the evening before.
export function sleepFor(iso, s) {
  const sw = switchInfo(iso, s), p = s.switchPlan, end = wakeFor(iso, s);
  if (sw?.to === 'morning' && sw.role === 'A') return { start: toMin(p.napStart), end, nap: true };
  if (sw?.to === 'morning' && sw.role === 'B') return { start: toMin(p.morningBed) - 1440, end, nap: false };
  if (sw?.to === 'night') {
    const k = { A: 0, B: 1, C: 2 }[sw.role];
    let start = toMin(s.sleep.morningOff.start) + k * p.laterHours * 60 - 1440;
    return { start, end, nap: false };
  }
  const w = s.sleep[keyOf(getDay(iso, s))];
  let start = toMin(w.start);
  if (start > end) start -= 1440;
  return { start, end, nap: false };
}
// Bedtime at the end of this routine day, relative to this date's midnight.
export const bedFor = (iso, s) => sleepFor(addDays(iso, 1), s).start + 1440;

// The routine day: the latest date whose wake time has passed. Everything daily resets at wake.
export function routineDayAt(iso, min, s) {
  for (let k = 0; k <= 2; k++) {
    const d = addDays(iso, -k);
    if (wakeFor(d, s) - k * 1440 <= min) return d;
  }
  return addDays(iso, -2);
}

// Which day-type style a date uses. Switch days run on a daytime ("morning") rhythm.
export function styleKey(iso, s) {
  const d = getDay(iso, s);
  if (d.type === 'work') return keyOf(d);
  return switchInfo(iso, s) ? 'morningOff' : keyOf(d);
}
export const gymSlotKey = styleKey;
export const isPrepDay = (iso, s) => getDay(iso, s).isFirstOffAfterWork; // batch cook: first off day of each off stretch
export function studyMinutes(iso, s) {
  const d = getDay(iso, s), inPlan = iso >= s.studyStart && iso < s.exam;
  return { aws: inPlan ? (d.type === 'work' ? s.aws.work : s.aws.off) : 0, mandarin: s.mandarinMin };
}

const SLOT_LABEL = { m1: 'Meal 1', m2: 'Meal 2', m3: 'Meal 3', snack: 'Snack' };
const blk = (start, end, kind, label, extra = {}) => ({ start, end, kind, label, ...extra });
const meal = (t, slot, note = '') => blk(t, t + 20, 'meal', SLOT_LABEL[slot] + note, { slot });

export function dayPlan(iso, s) {
  const d = getDay(iso, s), sw = switchInfo(iso, s), wake = wakeFor(iso, s), sl = sleepFor(iso, s);
  const bed = bedFor(iso, s), tomorrowWork = getDay(addDays(iso, 1), s).type === 'work';
  const g = providers.gymFor(iso, s), rn = providers.runFor(iso, s), st = studyMinutes(iso, s), studyLen = st.aws + st.mandarin;
  const studyLabel = st.aws ? `Study: AWS ${st.aws} min + Mandarin ${st.mandarin} min` : `Mandarin ${st.mandarin} min`;
  const out = [blk(sl.start, sl.end, 'sleep', sl.nap ? 'Nap after the shift' : 'Sleep')];
  if (dow(iso) === s.weighDay) out.push(blk(wake, wake + 5, 'weigh', 'Weigh-in'));
  const gymBlk = (a, b, extra) => blk(a, b, 'gym', `Gym: ${g.kind} (${g.loc === 'work' ? 'gym near work' : 'gym near home'})${g.run ? ` + run ${g.run.estMin} min` : ''}`, { loc: g.loc, ...extra });
  const gymMin = () => { const o = g.nextDay ? 1440 : 0; return [toMin(g.start) + o, toMin(g.end) + o]; };
  const pack = t => out.push(blk(t, t, 'reminder', d.type === 'work' && d.block === 'night' ? 'Pack shift food and gym bag' : "Pack tomorrow's food and gym bag"));

  if (d.type === 'work') {
    const S = toMin(d.shiftStart); let E = toMin(d.shiftEnd); if (E <= S) E += 1440;
    if (d.block === 'night') {
      out.push(meal(wake, 'm1'));
      const studyAt = wake + 45;
      if (studyLen) out.push(blk(studyAt, studyAt + studyLen, 'study', studyLabel));
      out.push(blk(S - 90, S - 80, 'walk', '10-minute walk'));
      pack(S - 75);
      const leave = S - s.leaveEarly.night;
      out.push(blk(leave, leave + s.drive, 'drive', 'Drive to work'));
      out.push(blk(S, E, 'shift', 'Night shift', { endsNextDay: E >= 1440 }));
      out.push(meal(S + 240, 'm2', ' (packed)'));
      out.push(blk(S + 360, S + 360, 'reminder', 'Caffeine cutoff'));
      out.push(meal(S + 540, 'snack'));
      out.push(blk(E, E + s.drive, 'drive', 'Drive home. Wear sunglasses', { drowsy: true }));
      if (g) {
        // The session is the morning after the shift: home, gym, then shower and the meal, then sleep.
        const [a, b] = gymMin();
        out.push(gymBlk(a, b, { note: 'After the shift' }));
        // Bed can be only minutes after the gym (09:00 before an off day), so the meal is cut to fit and kept.
        out.push(blk(b, Math.max(b + 1, Math.min(b + 30, bed)), 'meal', 'Shower, then Meal 3 (protein)', { slot: 'm3', keep: true }));
      } else out.push(blk(E + s.drive, E + s.drive + 30, 'meal', 'Shower, then a small light Meal 3', { slot: 'm3' }));
    } else {
      out.push(meal(wake + 15, 'm1', ' (quick breakfast)'));
      const leave = S - s.leaveEarly.morning;
      out.push(blk(leave, leave + s.drive, 'drive', 'Drive to work'));
      out.push(blk(S, E, 'shift', 'Morning shift'));
      out.push(meal(S + 300, 'm2', ' (packed)'));
      out.push(blk(S + 330, S + 340, 'walk', '10-minute walk on your break'));
      out.push(meal(S + 510, 'snack'));
      if (g) {
        const [a, b] = gymMin();
        out.push(gymBlk(a, b, { tight: true }));
        out.push(blk(b + 5, b + 5 + s.drive, 'drive', 'Drive home'));
        out.push(meal(b + 50, 'm3'));
        if (studyLen) out.push(blk(b + 70, b + 70 + studyLen, 'study', studyLabel));
      } else {
        out.push(blk(E, E + s.drive, 'drive', 'Drive home'));
        out.push(meal(E + 60, 'm3'));
        if (studyLen) out.push(blk(E + 90, E + 90 + studyLen, 'study', studyLabel));
      }
      if (tomorrowWork) pack(bed - 10);
    }
  } else {
    const nightStyle = !sw && d.block === 'night', L = bed - wake;
    // Offsets come from the fixed times in the brief (night off: wake 16:00; morning off: wake 06:15),
    // scaled to the length of the day so shorter switch days still fit before bed.
    const k = L >= 900 ? 1 : L / 1020, at = off => Math.round(wake + off * k);
    let cookAt = null;
    if (nightStyle) {
      out.push(meal(wake + 15, 'm1'));
      out.push(blk(wake + 60, wake + 70, 'walk', '10-minute walk'));
      if (g) { const [a, b] = gymMin(); out.push(gymBlk(a, b)); cookAt = b + 15; } else cookAt = wake + 120;
      if (isPrepDay(iso, s)) out.push(blk(cookAt, cookAt + 75, 'cook', 'Batch cook for the work days'));
      out.push(meal(isPrepDay(iso, s) && g ? cookAt + 75 : wake + 240, 'm2'));
      if (studyLen) out.push(blk(wake + 300, wake + 300 + studyLen, 'study', studyLabel));
      out.push(meal(wake + 540, 'm3'));
      out.push(meal(wake + 780, 'snack'));
    } else {
      out.push(meal(at(45), 'm1'));
      const sAt = at(165);
      if (studyLen) out.push(blk(sAt, sAt + studyLen, 'study', studyLabel));
      if (isPrepDay(iso, s)) out.push(blk(sAt + studyLen + 5, sAt + studyLen + 95, 'cook', 'Batch cook for the work days'));
      out.push(meal(at(375), 'm2'));
      out.push(blk(at(405), at(405) + 10, 'walk', '10-minute walk after lunch'));
      out.push(meal(at(585), 'snack'));
      if (g) out.push(gymBlk(...gymMin()));
      out.push(meal(at(795), 'm3'));
    }
    if (rn) out.push(blk(toMin(rn.start), Math.max(toMin(rn.start) + 1, toMin(rn.end)), 'run', `Run: ${rn.title}`, { km: rn.km ?? null }));
    if (tomorrowWork) pack(bed - 30);
  }
  out.push(blk(bed, bed + 1, 'sleep', 'Sleep', { bedtime: true }));
  return settle(out, wake, bed);
}

// Moves meals, snacks and walks that land inside gym, cooking or study to just after it,
// and drops anything that would fall after bedtime.
function settle(list, wake, bed) {
  const busy = list.filter(b => ['gym', 'run', 'cook', 'study', 'shift'].includes(b.kind));
  for (const b of list) {
    if (!['meal', 'walk'].includes(b.kind)) continue;
    for (let i = 0; i < 4; i++) {
      const hit = busy.find(x => b.start >= x.start && b.start < x.end && !(x.kind === 'shift'));
      if (!hit) break;
      const len = b.end - b.start; b.start = hit.end + 10; b.end = b.start + len;
    }
  }
  // Meals and walks never stack on the same minute.
  const soft = list.filter(b => ['meal', 'walk'].includes(b.kind)).sort((a, b) => a.start - b.start);
  for (let i = 1; i < soft.length; i++) {
    const p = soft[i - 1], b = soft[i];
    if (b.start < p.end + 5) { const len = b.end - b.start; b.start = p.end + 5; b.end = b.start + len; }
  }
  return list.filter(b => b.kind === 'sleep' || b.keep || b.start < bed - 10).sort((a, b) => a.start - b.start || (a.kind === 'sleep' ? -1 : 1));
}

// "08:15" or "07:00 tomorrow" style label for a minute offset relative to the day's date.
export const timeLabel = m => fmt(m) + (m >= 1440 ? ' (tomorrow)' : m < 0 ? ' (the evening before)' : '');

// Text for the sleep-switch card, or null when the date isn't a switch day.
export function switchCard(iso, s) {
  const sw = switchInfo(iso, s);
  if (!sw || sw.role === 'C') return null;
  const p = s.switchPlan, rows = [];
  if (sw.to === 'morning') {
    rows.push({ date: sw.A, text: `Nap ${p.napStart}–${p.napEnd} after the shift. Stay up, then sleep at ${p.morningBed}.` });
    rows.push({ date: sw.B, text: `Sleep ${p.morningBed} → wake ${p.morningWake}.` });
    rows.push({ date: sw.C, text: `First morning shift ${s.morning.start}–${s.morning.end}.` });
  } else {
    const bed0 = toMin(s.sleep.morningOff.start), wake0 = toMin(s.sleep.morningOff.end), h = p.laterHours * 60;
    rows.push({ date: sw.A, text: `Go to bed at ${fmt(bed0 + h)}, wake at ${fmt(wake0 + h)}.` });
    rows.push({ date: sw.B, text: `Go to bed at ${fmt(bed0 + 2 * h)}, wake at ${fmt(wake0 + 2 * h)}.` });
    rows.push({ date: sw.C, text: `First night shift ${s.night.start} → ${s.night.end} the next morning.` });
  }
  return { to: sw.to, rows };
}
