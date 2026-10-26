// Settings screen (#/settings[/<section>]), JSON backup / restore, calendar export and the
// "export a backup" banner. Every field saves on change through setSetting(path, value).
import { validateSettings, dayNum, isoOf } from './schedule.js';
import { getSettings, setSetting, exportAll, parseImport, replaceAll, resetAll, sizeBytes, markBackup, getMeta } from './storage.js';
import { esc, toMin, fmt, dayLabel, nowLocal } from './util.js';
import { buildIcs } from './ics.js';
import { ask } from './sheet.js';

export const EQUIPMENT = ['barbell', 'rack', 'machines', 'dumbbells', 'cables', 'bands', 'bench', 'treadmill', 'bike', 'rower'];
const EQUIP_LABEL = { barbell: 'Barbell', rack: 'Squat rack', machines: 'Machines', dumbbells: 'Dumbbells', cables: 'Cables', bands: 'Bands', bench: 'Bench', treadmill: 'Treadmill', bike: 'Exercise bike', rower: 'Rower' };
const DAY_TYPES = [['nightWork', 'Night block, work day'], ['nightOff', 'Night block, off day'], ['morningWork', 'Morning block, work day'], ['morningOff', 'Morning block, off day']];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SECTIONS = [['shifts', 'Shifts'], ['overrides', 'Changed days'], ['sleep', 'Sleep'], ['gym', 'Gym'], ['food', 'Food and water'], ['study', 'Study'], ['progress', 'Progress'], ['data', 'Backup and data']];
const BACKUP_DAYS = 14;

// Screen state that survives re-renders.
const ui = { open: new Set(), lastArg: null, scrollTo: null, errors: {}, drafts: {}, importMsg: '' };

// ---------- small parsers (exported for tests) ----------
export const isTime = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v));
export const isIso = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && isoOf(dayNum(v)) === v;

// "2, 4,6 8" → [2, 4, 6, 8]. Returns { ok, list } or { ok:false, error }.
export function parseDumbbells(text) {
  const parts = String(text || '').split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) return { ok: false, error: 'Add at least one weight, for example 2, 4, 6.' };
  const nums = parts.map(p => Number(p.replace(/kg$/i, '')));
  const bad = parts.filter((p, i) => !Number.isFinite(nums[i]) || nums[i] <= 0 || nums[i] > 100);
  if (bad.length) return { ok: false, error: `Use numbers in kg between 0 and 100. Check: ${bad.join(', ')}` };
  const list = [...new Set(nums.map(n => Math.round(n * 100) / 100))].sort((a, b) => a - b);
  return { ok: true, list };
}

const sleepLen = (a, b) => { const m = ((toMin(b) - toMin(a)) % 1440 + 1440) % 1440; return `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`; };
const getPath = (s, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), s);

// ---------- overrides ----------
export const OVERRIDE_KINDS = [['off', 'Leave / off'], ['sick', 'Sick'], ['work-night', 'Work a night shift'], ['work-morning', 'Work a morning shift'], ['custom', 'Custom shift times']];
export function overrideLabel(ov) {
  if (!ov) return '';
  if (ov.kind === 'work') return ov.block === 'morning' ? 'Work a morning shift' : 'Work a night shift';
  if (ov.kind === 'custom') return `Custom shift ${ov.start}–${ov.end}`;
  return { off: 'Leave / off', leave: 'Leave', sick: 'Sick' }[ov.kind] || 'Changed';
}
// kind: off | sick | leave | work-night | work-morning | custom. Returns { ok } or { ok:false, error }.
export function addOverride(iso, kind, start, end) {
  if (!isIso(iso)) return { ok: false, error: 'Pick a date first.' };
  let ov;
  if (kind === 'off' || kind === 'sick' || kind === 'leave') ov = { kind };
  else if (kind === 'work-night' || kind === 'work-morning') ov = { kind: 'work', block: kind.slice(5) };
  else if (kind === 'custom') {
    if (!isTime(start) || !isTime(end) || start === end) return { ok: false, error: 'Enter a start and an end time for the custom shift.' };
    // Shifts that start in the afternoon or run past midnight follow night-block sleep.
    ov = { kind: 'custom', start, end, block: toMin(start) >= 720 || toMin(end) < toMin(start) ? 'night' : 'morning' };
  } else return { ok: false, error: 'Pick what changes on that day.' };
  return setSetting('overrides.' + iso, ov) ? { ok: true } : { ok: false, error: "Couldn't save." };
}
export const clearOverride = iso => setSetting('overrides.' + iso, undefined);

// ---------- backup ----------
export const backupName = iso => `routine-backup-${iso}.json`;
const localDate = ms => nowLocal(ms).iso;

// What a parsed backup contains, as short lines for the confirm dialog.
export function backupSummary(data) {
  const n = o => Object.keys(o || {}).length;
  const days = n(data.days), food = n(data.food?.log), gym = Object.values(data.gym?.sessions || {}).filter(x => x && x.endedAt).length;
  const study = n(data.study?.log), weigh = n(data.progress?.weighins), changed = n(data.settings), ov = n(data.settings?.overrides);
  return [
    `Checklist days: ${days}`, `Food log days: ${food}`, `Gym sessions: ${gym}`, `Study log days: ${study}`,
    `Weigh-ins: ${weigh}`, `Changed settings: ${changed}${ov ? ` (including ${ov} changed day${ov === 1 ? '' : 's'})` : ''}`,
  ];
}

// Share sheet when the browser can share files (iPhone: Save to Files / iCloud Drive), else a download.
// Resolves 'shared' | 'downloaded' | 'cancelled'. Call it straight from the tap (no await before it),
// or Safari refuses the share.
export async function shareOrDownload(text, name, type) {
  const nav = globalThis.navigator;
  let file = null;
  try { file = new File([text], name, { type }); } catch { /* old browser: download only */ }
  if (file && nav?.canShare?.({ files: [file] }) && nav.share) {
    try { await nav.share({ files: [file], title: name }); return 'shared'; }
    catch (e) { if (e?.name === 'AbortError') return 'cancelled'; /* else fall back to a download */ }
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return 'downloaded';
}

async function exportBackup(ctx) {
  const how = await shareOrDownload(JSON.stringify(exportAll()), backupName(ctx.iso), 'application/json');
  if (how === 'cancelled') { ctx.notify('Export cancelled'); return true; }
  markBackup();
  ctx.notify('Backup exported');
  return true;
}

async function exportCalendar(ctx) {
  // Start from the routine day so a night shift that is under way is still included.
  const from = ctx.rd && ctx.rd < ctx.iso ? ctx.rd : ctx.iso;
  const how = await shareOrDownload(buildIcs(ctx.s, from, 56), 'routine-calendar.ics', 'text/calendar');
  ctx.notify(how === 'cancelled' ? 'Export cancelled' : 'Calendar exported');
  return true;
}

async function importBackup(el, ctx) {
  const f = el.files?.[0];
  el.value = '';
  if (!f) return false;
  let obj;
  try { obj = JSON.parse(await f.text()); }
  catch { ui.importMsg = "That file isn't valid JSON. Pick a routine-backup-….json file."; return true; }
  const r = parseImport(obj, ctx.iso);
  if (!r.ok) { ui.importMsg = r.error; return true; }
  const at = Date.parse(obj.exportedAt), when = Number.isFinite(at) ? ` from ${dayLabel(localDate(at))} ${localDate(at).slice(0, 4)}` : '';
  const ok = await ask(`This backup${when} contains:\n\n${backupSummary(r.data).join('\n')}`, { title: 'Replace everything on this phone?', ok: 'Replace', danger: true });
  if (!ok) { ui.importMsg = 'Import cancelled. Nothing changed.'; return true; }
  if (!replaceAll(r.data)) { ui.importMsg = "Couldn't save the backup on this phone."; return true; }
  ui.importMsg = ''; ui.errors = {}; ui.drafts = {};
  ctx.notify('Backup restored');
  return true;
}

// Quiet nudge on Today: '' unless the last backup is older than 14 days (or there is none and the
// app has been in use for more than 14 days).
export function backupBanner(ctx) {
  const meta = getMeta(), today = dayNum(ctx.iso);
  let text;
  if (meta.lastBackup) {
    const days = today - dayNum(localDate(meta.lastBackup));
    if (days <= BACKUP_DAYS) return '';
    text = `Last backup was ${days} days ago.`;
  } else {
    if (!meta.firstUse || !isIso(meta.firstUse) || today - dayNum(meta.firstUse) <= BACKUP_DAYS) return '';
    text = "You haven't exported a backup yet.";
  }
  return `<p class="note calm set-banner">${text} <a href="#/settings/data">Export a backup in Settings</a> — iPhone Safari can clear saved data.</p>`;
}

// ---------- rendering helpers ----------
function errFor(path) {
  const e = ui.errors[path];
  return e ? `<span class="set-err" id="err-${esc(path)}" role="alert">${esc(e)}</span>` : '';
}
const shown = (path, v) => (path in ui.drafts ? ui.drafts[path] : v);
const invalid = path => (ui.errors[path] ? ` aria-invalid="true" aria-describedby="err-${esc(path)}"` : '');

// kind: time | date | int | text | url
function input(label, path, v, kind, { min, max, step, hint = '', type } = {}) {
  const t = type || { time: 'time', date: 'date', int: 'number', url: 'url' }[kind] || 'text';
  const attrs = [min != null && `min="${min}"`, max != null && `max="${max}"`, step != null && `step="${step}"`,
    kind === 'int' && 'inputmode="numeric"'].filter(Boolean).join(' ');
  return `<label class="field"><span>${label}</span>
    <input type="${t}" data-act="set-field" data-path="${esc(path)}" data-kind="${kind}" value="${esc(shown(path, v))}" ${attrs}${invalid(path)}>
    ${hint ? `<small class="muted">${hint}</small>` : ''}${errFor(path)}</label>`;
}
function select(label, path, v, options, kind = 'text') {
  return `<label class="field"><span>${label}</span><select data-act="set-field" data-path="${esc(path)}" data-kind="${kind}">
    ${options.map(([val, text]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(text)}</option>`).join('')}</select></label>`;
}
const toggle = (label, path, on, hint = '') => `<label class="toggle"><input type="checkbox" data-act="set-bool" data-path="${esc(path)}"${on ? ' checked' : ''}><span>${label}${hint ? `<br><small class="muted">${hint}</small>` : ''}</span></label>`;
const pair = (a, b) => `<div class="set-pair">${a}${b}</div>`;

function fold(id, title, body) {
  return `<details class="fold set-fold" id="set-${id}" data-sec="${id}"${ui.open.has(id) ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
}

function shiftsSection(s) {
  return `<p class="muted">The 14-day pattern is fixed: 2 on, 3 off, 2 on, 2 off, 3 on, 2 off. Blocks alternate night and morning.</p>
  ${input('Anchor date (cycle day 0, a work day)', 'anchor', s.anchor, 'date')}
  ${input('Block length in days', 'blockLength', s.blockLength, 'int', { min: 14, max: 364, step: 14, hint: 'A multiple of 14, for example 28.' })}
  ${select('The anchor starts a', 'anchorBlock', s.anchorBlock, [['night', 'Night block'], ['morning', 'Morning block']])}
  <h3>Night shift</h3>${pair(input('Starts', 'night.start', s.night.start, 'time'), input('Ends (next day)', 'night.end', s.night.end, 'time'))}
  <h3>Morning shift</h3>${pair(input('Starts', 'morning.start', s.morning.start, 'time'), input('Ends', 'morning.end', s.morning.end, 'time'))}`;
}

function overridesSection(s, ctx) {
  const dates = Object.keys(s.overrides || {}).sort();
  const item = iso => `<li class="row"><span class="grow"><b>${esc(dayLabel(iso))} ${iso.slice(0, 4)}</b><br><span class="muted">${esc(overrideLabel(s.overrides[iso]))}</span></span>
    <button type="button" class="btn small ghost" data-act="set-ov-clear" data-iso="${esc(iso)}" aria-label="Clear the change on ${esc(dayLabel(iso))}">Clear</button></li>`;
  const upcoming = dates.filter(d => d >= ctx.rd), past = dates.filter(d => d < ctx.rd);
  return `<p class="muted">A changed day always wins over the pattern. Clearing it brings the pattern back. You can also change a day from its page in Week.</p>
  ${upcoming.length ? `<ul class="rules set-ov">${upcoming.map(item).join('')}</ul>` : '<p>No changed days coming up.</p>'}
  ${past.length ? `<details class="set-past"><summary>Past changed days (${past.length})</summary><ul class="rules set-ov">${past.map(item).join('')}</ul></details>` : ''}
  <h3>Change a day</h3>
  <label class="field"><span>Date</span><input type="date" id="set-ov-date" value="${esc(ctx.rd)}"></label>
  <label class="field"><span>What changes</span><select id="set-ov-kind">${OVERRIDE_KINDS.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
  ${pair('<label class="field"><span>Custom start</span><input type="time" id="set-ov-start"></label>', '<label class="field"><span>Custom end</span><input type="time" id="set-ov-end"></label>')}
  <p class="muted">Custom times are only used with "Custom shift times".</p>
  ${errFor('ov')}
  <button type="button" class="btn wide" data-act="set-ov-add">Save this change</button>`;
}

function sleepSection(s) {
  const win = ([k, name]) => `<h3>${name}</h3>${pair(input('Sleep', `sleep.${k}.start`, s.sleep[k].start, 'time'), input('Wake', `sleep.${k}.end`, s.sleep[k].end, 'time'))}
    <p class="muted num">${sleepLen(s.sleep[k].start, s.sleep[k].end)}</p>`;
  const p = s.switchPlan;
  return `<p class="muted">Your wake time is the end of each window. Daily things (checklist, water, food, study) reset when you wake.</p>
  ${DAY_TYPES.map(win).join('')}
  <h3>Block switch: nights to mornings</h3>
  <p class="muted">The day after the last night shift, then the night before the first morning shift.</p>
  ${pair(input('Nap from', 'switchPlan.napStart', p.napStart, 'time'), input('Nap until', 'switchPlan.napEnd', p.napEnd, 'time'))}
  ${pair(input('Bedtime', 'switchPlan.morningBed', p.morningBed, 'time'), input('Wake', 'switchPlan.morningWake', p.morningWake, 'time'))}
  <h3>Block switch: mornings to nights</h3>
  ${input('Go to bed this many hours later each night', 'switchPlan.laterHours', p.laterHours, 'int', { min: 1, max: 4, hint: `Starts from your morning-block off-day bedtime (${esc(s.sleep.morningOff.start)}).` })}`;
}

function gymSection(s) {
  const slot = ([k, name]) => {
    const [a, b] = String(s.gymSlots[k] || '').split('-');
    return `<h3>${name}</h3>${pair(input('From', `gymSlots.${k}#0`, a, 'time'), input('To', `gymSlots.${k}#1`, b, 'time'))}${errFor('gymSlots.' + k)}`;
  };
  const loc = ([k, name]) => select(name, `gymLoc.${k}`, s.gymLoc[k], [['home', 'Home gym'], ['work', 'Work gym']]);
  const equip = g => `<fieldset class="set-equip"><legend>${g === 'home' ? 'Home gym' : 'Work gym'}</legend>
    ${EQUIPMENT.map(x => `<label class="toggle"><input type="checkbox" data-act="set-equip" data-gym="${g}" data-item="${x}"${(s.equipment[g] || []).includes(x) ? ' checked' : ''}><span>${EQUIP_LABEL[x]}</span></label>`).join('')}</fieldset>`;
  const bells = g => input(`${g === 'home' ? 'Home gym' : 'Work gym'} dumbbells (kg)`, `dumbbells.${g}`, (s.dumbbells[g] || []).join(', '), 'text', { type: 'text', hint: 'Separate weights with commas, for example 2, 4, 6, 8.' });
  return `${input('Phase 1 starts on', 'gym.start', s.gym.start, 'date')}
  ${toggle('Plan a light week every 8 weeks', 'gym.lightWeek', s.gym.lightWeek, 'At each phase change: same exercises, 2 sets, about 80% of your working weights.')}
  <h2 class="set-sub">Session times</h2>
  <p class="muted">Night block work days only get a pre-shift session from phase 2.</p>
  ${DAY_TYPES.map(slot).join('')}
  <h2 class="set-sub">Which gym</h2>${DAY_TYPES.map(loc).join('')}
  <h2 class="set-sub">Equipment</h2>
  <p class="muted">Exercises that need something you haven't ticked switch to their alternative. With no cardio machine ticked, cardio is a brisk outdoor walk.</p>
  ${equip('home')}${equip('work')}
  <h2 class="set-sub">Dumbbells</h2>
  <p class="muted">Weight suggestions round up to the next dumbbell you actually have.</p>
  ${bells('home')}${bells('work')}
  ${select('Work gym showers', 'workShowers', s.workShowers, [['unknown', "Don't know yet"], ['yes', 'Yes'], ['no', 'No']])}
  ${toggle('Play a short sound when rest ends', 'restSound', s.restSound, 'Only while the app is open on screen.')}`;
}

function foodSection(s) {
  return `<p class="muted">Eat at maintenance to a small surplus.</p>
  ${input('Daily kcal target', 'kcal', s.kcal, 'int', { min: 1200, max: 5000, step: 50 })}
  ${input('Daily protein target (g)', 'protein', s.protein, 'int', { min: 50, max: 250, hint: 'Aim for somewhere in 110–140 g.' })}
  ${pair(input('Water, rest day (ml)', 'water.rest', s.water.rest, 'int', { min: 500, max: 6000, step: 250 }), input('Water, gym day (ml)', 'water.gym', s.water.gym, 'int', { min: 500, max: 6000, step: 250 }))}
  ${input('Monthly food budget (Rs)', 'budget', s.budget, 'int', { min: 1000, max: 50000, step: 100, hint: 'The shopping list compares the plan against this.' })}
  ${toggle('I use whey protein', 'whey', s.whey, 'Adds 25 g protein per scoop. Start with half a scoop.')}`;
}

function studySection(s) {
  return `${pair(input('Study plan starts', 'studyStart', s.studyStart, 'date'), input('Exam date', 'exam', s.exam, 'date'))}
  ${pair(input('AWS, work day (min)', 'aws.work', s.aws.work, 'int', { min: 0, max: 240, step: 5 }), input('AWS, off day (min)', 'aws.off', s.aws.off, 'int', { min: 0, max: 240, step: 5 }))}
  ${input('Mandarin every day (min)', 'mandarinMin', s.mandarinMin, 'int', { min: 0, max: 120, step: 5 })}
  ${input('Mandarin app address', 'mandarinUrl', s.mandarinUrl, 'url', { hint: 'The "Open Mandarin app" button opens this.' })}`;
}

function progressSection(s) {
  return `${select('Weigh-in day', 'weighDay', s.weighDay, WEEKDAYS.map((d, i) => [i, d]), 'int')}
  <p class="muted">You weigh in at wake time on this day, whatever the day type.</p>`;
}

function dataSection(ctx) {
  const m = getMeta(), kb = sizeBytes() / 1024;
  const last = m.lastBackup ? (() => { const t = nowLocal(m.lastBackup); return `${dayLabel(t.iso)} ${t.iso.slice(0, 4)}, ${fmt(t.min)}`; })() : 'never';
  return `<p>Last backup: <b>${esc(last)}</b></p>
  <p class="muted">iPhone Safari can clear saved data from web apps. Export a backup every week or two and keep it in Files or iCloud Drive.</p>
  <div class="set-actions">
    <button type="button" class="btn primary wide" data-act="set-export">Export backup (JSON)</button>
    <label class="btn wide set-file">Import backup (JSON)<input type="file" accept="application/json,.json" data-act="set-import"></label>
  </div>
  ${ui.importMsg ? `<p class="note alert" role="alert">${esc(ui.importMsg)}</p>` : ''}
  <h3>Calendar</h3>
  <p class="muted">The next 8 weeks of shifts, gym sessions, study blocks and weigh-ins, each with an alert 15 minutes before. On iPhone, importing again adds the events again, so delete the old Routine events first.</p>
  <button type="button" class="btn wide" data-act="set-ics">Export calendar (.ics)</button>
  <h3>Storage</h3>
  <p class="num">Stored on this phone: ${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB <span class="muted">of about 5 MB (the browser's limit)</span></p>
  <h3>Reset</h3>
  <p class="muted">Deletes every log and setting on this phone. Export a backup first if you might want it back.</p>
  <button type="button" class="btn wide set-danger" data-act="set-reset">Reset all data</button>`;
}

// ---------- saving ----------
function check(path, kind, raw, el) {
  const v = String(raw ?? '').trim();
  if (kind === 'time') return isTime(v) ? { value: v } : { error: 'Enter a time like 07:00.' };
  if (kind === 'date') return isIso(v) ? { value: v } : { error: 'Pick a date.' };
  if (kind === 'url') return /^https?:\/\/\S+$/i.test(v) ? { value: v } : { error: 'Enter a full address starting with https://' };
  if (kind === 'int') {
    const n = Number(v), min = el?.min !== '' && el?.min != null ? Number(el.min) : -Infinity, max = el?.max !== '' && el?.max != null ? Number(el.max) : Infinity;
    if (v === '' || !Number.isInteger(n)) return { error: 'Enter a whole number.' };
    if (n < min || n > max) return { error: `Enter a number from ${min} to ${max}.` };
    return { value: n };
  }
  return { value: v };
}

// Rules that involve more than one field. Returns an error message or ''.
function crossCheck(path, value, s) {
  if (path === 'anchor' || path === 'blockLength') {
    try { validateSettings({ ...s, [path]: value }); } catch (e) { return e.message; }
  }
  if (/^(night|morning)\.(start|end)$/.test(path)) {
    const [b, k] = path.split('.'), other = s[b][k === 'start' ? 'end' : 'start'];
    if (other === value) return 'Start and end must be different.';
  }
  if (/^sleep\.\w+\.(start|end)$/.test(path)) {
    const [, t, k] = path.split('.'), other = s.sleep[t][k === 'start' ? 'end' : 'start'];
    if (other === value) return 'Sleep and wake must be different.';
  }
  if (path === 'exam' && value <= s.studyStart) return 'The exam has to be after the study start date.';
  if (path === 'studyStart' && value >= s.exam) return 'The study start has to be before the exam date.';
  return '';
}

function saveField(path, kind, raw, el, ctx) {
  const s = ctx.s || getSettings();
  // Gym slots are stored as one 'HH:MM-HH:MM' string; each half is its own input.
  if (path.startsWith('gymSlots.')) {
    const [key, part] = path.split('#'), r = check(path, 'time', raw);
    const cur = String(getPath(s, key) || '-').split('-');
    if (r.error) return fail(key, path, raw, r.error);
    cur[+part] = r.value;
    if (!isTime(cur[0]) || !isTime(cur[1]) || toMin(cur[1]) <= toMin(cur[0])) return fail(key, path, raw, 'The session has to end after it starts.');
    return ok(key, setSetting(key, cur.join('-')), ctx);
  }
  if (path.startsWith('dumbbells.')) {
    const r = parseDumbbells(raw);
    if (!r.ok) return fail(path, path, raw, r.error);
    return ok(path, setSetting(path, r.list), ctx);
  }
  const r = check(path, kind, raw, el);
  if (r.error) return fail(path, path, raw, r.error);
  const cross = crossCheck(path, r.value, s);
  if (cross) return fail(path, path, raw, cross);
  return ok(path, setSetting(path, r.value), ctx);
}
function fail(errKey, draftKey, raw, msg) { ui.errors[errKey] = msg; ui.drafts[draftKey] = raw; return true; }
function ok(key, saved, ctx) {
  for (const k of Object.keys(ui.drafts)) if (k === key || k.startsWith(key + '#')) delete ui.drafts[k];
  delete ui.errors[key];
  if (saved) ctx.notify('Saved');
  return true;
}
// Exported for tests: run a field change without a DOM.
export const _saveField = (path, kind, raw, ctx, el) => saveField(path, kind, raw, el, ctx);
export const _ui = ui;

// ---------- module ----------
export default {
  name: 'settings',
  view(ctx, arg = '') {
    const s = ctx.s;
    // Arriving from another screen (or a new section link): open that section and scroll to it.
    const arriving = !globalThis.document?.querySelector?.('main .set');
    if (arg !== ui.lastArg || arriving) {
      ui.lastArg = arg;
      if (SECTIONS.some(([id]) => id === arg)) { ui.open.add(arg); ui.scrollTo = arg; }
    }
    const body = {
      shifts: () => shiftsSection(s), overrides: () => overridesSection(s, ctx), sleep: () => sleepSection(s), gym: () => gymSection(s),
      food: () => foodSection(s), study: () => studySection(s), progress: () => progressSection(s), data: () => dataSection(ctx),
    };
    return `<h1 class="page-title">Settings</h1>
    <p class="muted">Changes save as soon as you leave a field.</p>
    <div class="set">${SECTIONS.map(([id, title]) => fold(id, title, body[id]())).join('')}</div>`;
  },
  mounted() {
    const doc = globalThis.document; if (!doc) return;
    doc.querySelectorAll('details.set-fold').forEach(d => d.addEventListener('toggle', () => {
      if (d.open) ui.open.add(d.dataset.sec); else ui.open.delete(d.dataset.sec);
    }));
    if (ui.scrollTo) { doc.getElementById('set-' + ui.scrollTo)?.scrollIntoView({ block: 'start' }); ui.scrollTo = null; }
  },
  async click(act, el, ctx) {
    if (act === 'set-export') return exportBackup(ctx);
    if (act === 'set-ics') return exportCalendar(ctx);
    if (act === 'set-ov-clear') { clearOverride(el.dataset.iso); ctx.notify('Back to the usual pattern'); return true; }
    if (act === 'set-ov-add') {
      const v = id => document.getElementById(id)?.value || '';
      const r = addOverride(v('set-ov-date'), v('set-ov-kind'), v('set-ov-start'), v('set-ov-end'));
      if (!r.ok) { ui.errors.ov = r.error; return true; }
      delete ui.errors.ov; ctx.notify('Saved for that day'); return true;
    }
    if (act === 'set-reset') {
      if (!(await ask('Every log and setting goes. Export a backup first if you might want it back.', { title: 'Delete all Routine data on this phone?', ok: 'Delete all', danger: true }))) return false;
      if (!(await ask('This cannot be undone.', { title: 'Are you sure?', ok: 'Yes, delete everything', danger: true }))) return false;
      resetAll(); ui.errors = {}; ui.drafts = {}; ui.importMsg = '';
      ctx.notify('All data deleted');
      return true;
    }
    return false;
  },
  change(act, el, ctx) {
    if (act === 'set-field') return saveField(el.dataset.path, el.dataset.kind, el.value, el, ctx);
    if (act === 'set-bool') { if (setSetting(el.dataset.path, !!el.checked)) ctx.notify('Saved'); return true; }
    if (act === 'set-equip') {
      const g = el.dataset.gym, have = new Set(ctx.s.equipment[g] || []);
      if (el.checked) have.add(el.dataset.item); else have.delete(el.dataset.item);
      if (setSetting('equipment.' + g, EQUIPMENT.filter(x => have.has(x)))) ctx.notify('Saved');
      return true;
    }
    if (act === 'set-import') return importBackup(el, ctx);
    return false;
  },
};
