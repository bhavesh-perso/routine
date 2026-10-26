// Calendar export (RFC 5545). Events come from plan.dayPlan blocks, so the calendar always
// matches what the app shows. Times are local Mauritius times with a VTIMEZONE (UTC+4, no DST).
import { dayPlan } from './plan.js';
import { addDays } from './util.js';

export const TZID = 'Indian/Mauritius';
const KINDS = ['shift', 'gym', 'study', 'weigh'];
const MIN_LEN = { weigh: 10 }; // calendar entries shorter than this look broken; give them some room

const pad = n => String(n).padStart(2, '0');
const compact = iso => iso.replaceAll('-', '');

// Minutes relative to a date's midnight → 'YYYYMMDDTHHMMSS' (≥1440 = next day, negative = day before).
export function localStamp(iso, min) {
  const dayOff = Math.floor(min / 1440), m = min - dayOff * 1440;
  return `${compact(addDays(iso, dayOff))}T${pad(Math.floor(m / 60))}${pad(m % 60)}00`;
}
export function utcStamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
// TEXT escaping (RFC 5545 §3.3.11).
export const escText = t => String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Fold a content line at 75 octets; continuation lines start with one space (which counts).
// Never splits a multi-byte UTF-8 character.
export function fold(line) {
  const enc = new TextEncoder();
  const out = []; let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

// Events for [fromIso, fromIso + days). UIDs are date + kind (+ index when a day has more than one),
// so the same plan always produces the same UIDs.
export function icsEvents(s, fromIso, days = 56) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const iso = addDays(fromIso, i);
    const blocks = dayPlan(iso, s).filter(b => KINDS.includes(b.kind) && !b.bedtime);
    const count = {}, seen = {};
    blocks.forEach(b => { count[b.kind] = (count[b.kind] || 0) + 1; });
    for (const b of blocks) {
      seen[b.kind] = (seen[b.kind] || 0) + 1;
      const end = Math.max(b.end, b.start + (MIN_LEN[b.kind] || 15));
      out.push({
        uid: `${compact(iso)}-${b.kind}${count[b.kind] > 1 ? '-' + seen[b.kind] : ''}@routine.bhavesh-perso`,
        kind: b.kind, iso, start: localStamp(iso, b.start), end: localStamp(iso, end), summary: b.label,
      });
    }
  }
  return out;
}

export function buildIcs(s, fromIso, days = 56, { now = Date.now() } = {}) {
  const stamp = utcStamp(now);
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//bhavesh-perso//Routine//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Routine', `X-WR-TIMEZONE:${TZID}`,
    'BEGIN:VTIMEZONE', `TZID:${TZID}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0400', 'TZOFFSETTO:+0400', 'TZNAME:+04', 'END:STANDARD', 'END:VTIMEZONE',
  ];
  for (const e of icsEvents(s, fromIso, days)) {
    const summary = escText(e.summary);
    L.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${TZID}:${e.start}`, `DTEND;TZID=${TZID}:${e.end}`,
      `SUMMARY:${summary}`, `TRANSP:${e.kind === 'shift' ? 'OPAQUE' : 'TRANSPARENT'}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${summary}`, 'TRIGGER:-PT15M', 'END:VALARM',
      'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
