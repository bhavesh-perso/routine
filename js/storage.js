// The only module that touches localStorage. Data is split by area, each under its own key,
// so a change rewrites only that area. Every read and write is guarded; failures are reported
// through the error handler (the app shows a banner) and never fail silently.
import { DEFAULTS } from './schedule.js';

export const SCHEMA = 2;
export const AREAS = ['meta', 'settings', 'days', 'food', 'study', 'gym', 'progress'];
const PREFIX = 'routine.v2.';
const V1_KEY = 'routine.state';

let onError = msg => { try { console.error(msg); } catch { /* no console */ } };
export const setErrorHandler = fn => { onError = fn; };

const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const cache = {};
let ver = 0;
export const version = () => ver;

function readKey(key) {
  try { const raw = ls()?.getItem(key); return raw ? JSON.parse(raw) : null; }
  catch (e) { onError(`Couldn't read saved data (${key}): ${e.message}`); return null; }
}
function writeKey(key, value) {
  try { ls()?.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { onError(`Couldn't save your data: ${e.message}. Export a backup from Settings.`); return false; }
}

export function get(area) {
  if (!(area in cache)) cache[area] = readKey(PREFIX + area) || {};
  return cache[area];
}
// update(area, fn): fn mutates the area object in place (or returns a replacement). Saves that area only.
export function update(area, fn) {
  const cur = get(area), out = fn(cur);
  if (out !== undefined) cache[area] = out;
  ver++;
  return writeKey(PREFIX + area, cache[area]);
}

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  ...DEFAULTS, // anchor, anchorBlock, blockLength, night, morning, overrides, wake (wake is derived below)
  sleep: {
    nightWork: { start: '08:15', end: '15:00' },
    nightOff: { start: '09:00', end: '16:00' },
    morningWork: { start: '21:45', end: '04:30' },
    morningOff: { start: '23:15', end: '06:15' },
  },
  switchPlan: { napStart: '08:15', napEnd: '11:30', morningBed: '21:45', morningWake: '04:30', laterHours: 2 },
  leaveEarly: { night: 45, morning: 90 }, // minutes before shift start you leave home
  drive: 45,
  gym: { start: '2026-10-30', lightWeek: true },
  gymSlots: { nightWork: '15:30-16:30', nightOff: '18:00-19:15', morningWork: '19:10-19:55', morningOff: '17:00-18:15' },
  gymLoc: { nightWork: 'home', nightOff: 'home', morningWork: 'work', morningOff: 'home' },
  equipment: { home: ['dumbbells', 'bench'], work: ['dumbbells', 'bench'] },
  dumbbells: { home: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20], work: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
  workShowers: 'unknown',
  restSound: true,
  kcal: 2500, protein: 120, whey: false, budget: 5000, // budget = Rs per month for food
  water: { rest: 2000, gym: 2500 },
  exam: '2026-12-21', studyStart: '2026-10-26',
  aws: { work: 20, off: 90 }, mandarinMin: 15,
  mandarinUrl: 'https://bhavesh-perso.github.io/Mandarin-app/',
  weighDay: 0, // 0 = Sunday
};
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
  return out;
}
let sCache = { v: -1, s: null };
export function getSettings() {
  if (sCache.v === ver && sCache.s) return sCache.s;
  const s = merge(DEFAULT_SETTINGS, get('settings'));
  s.overrides = { ...(get('settings').overrides || {}) };
  const m = t => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
  s.wake = { nightWork: m(s.sleep.nightWork.end), nightOff: m(s.sleep.nightOff.end), morningWork: m(s.sleep.morningWork.end), morningOff: m(s.sleep.morningOff.end) };
  sCache = { v: ver, s };
  return s;
}
// setSetting('water.rest', 1800) or setSetting('whey', true). Dotted paths create nested objects.
export function setSetting(path, value) {
  return update('settings', st => {
    const keys = path.split('.'); let o = st;
    keys.slice(0, -1).forEach(k => { if (!isObj(o[k])) o[k] = {}; o = o[k]; });
    if (value === undefined) delete o[keys.at(-1)]; else o[keys.at(-1)] = value;
  });
}
export function resetSetting(path) { setSetting(path, undefined); }

// ---------- day log (checklist) ----------
export const getDayLog = iso => ({ junk: false, water: 0, walk: false, ...(get('days')[iso] || {}) });
export function setDayLog(iso, patch) {
  markFirstUse(iso);
  return update('days', d => { d[iso] = { ...getDayLog(iso), ...patch }; });
}

// ---------- meta ----------
export const getMeta = () => get('meta');
export function markFirstUse(iso) { if (!get('meta').firstUse) update('meta', m => { m.firstUse = iso; }); }
export function markBackup(ms = Date.now()) { update('meta', m => { m.lastBackup = ms; }); }

// ---------- size, persistence ----------
export function sizeBytes() {
  let n = 0;
  try { const s = ls(); for (let i = 0; i < (s?.length || 0); i++) { const k = s.key(i); if (k.startsWith('routine.')) n += (k.length + (s.getItem(k) || '').length) * 2; } }
  catch { /* ignore */ }
  return n;
}
export async function askPersist() {
  if (get('meta').persistAsked) return;
  update('meta', m => { m.persistAsked = true; });
  try { if (globalThis.navigator?.storage?.persist) await navigator.storage.persist(); } catch { /* not supported */ }
}

// ---------- migrations ----------
// v1 kept everything in one key: { schema:1, firstUse, settings, logs:{ iso:{junk,water,walk,gym,food} } }
export function migrateV1(v1, todayIso) {
  const out = { meta: { schema: SCHEMA, firstUse: v1.firstUse || null }, settings: { ...(v1.settings || {}) }, days: {}, food: { log: {} }, study: {}, gym: { sessions: {} }, progress: {} };
  const gymStart = out.settings.gym?.start || DEFAULT_SETTINGS.gym.start;
  for (const [iso, l] of Object.entries(v1.logs || {})) {
    out.days[iso] = { junk: !!l.junk, water: +l.water || 0, walk: !!l.walk };
    if (Array.isArray(l.food) && l.food.length) out.food.log[iso] = l.food.map(e => ({ n: e.n, k: +e.k || 0, p: +e.p || 0, meal: null, t: null }));
    // Gym logs from before the plan started or in the future can only be test taps, so they are dropped.
    if (l.gym && iso >= gymStart && iso <= todayIso) {
      out.gym.sessions['s-' + iso] = { id: 's-' + iso, rd: iso, planIso: iso, kind: null, loc: 'home', startedAt: null, endedAt: l.gym.done ? 1 : null, feel: null, notes: '',
        ex: Object.entries(l.gym.sets || {}).map(([id, sets]) => ({ id, sets: (sets || []).map(x => ({ type: 'work', plan: {}, done: x ? { w: x.w, r: x.r } : null })) })) };
    }
  }
  return out;
}
export function runMigrations(todayIso) {
  if (get('meta').schema === SCHEMA) return false;
  const v1 = readKey(V1_KEY);
  if (v1 && v1.schema === 1) {
    const data = migrateV1(v1, todayIso);
    for (const a of AREAS) { cache[a] = data[a]; writeKey(PREFIX + a, data[a]); }
    ver++;
    return true;
  }
  update('meta', m => { m.schema = SCHEMA; });
  return false;
}

// ---------- backup ----------
export function exportAll() {
  const data = {}; for (const a of AREAS) data[a] = get(a);
  return { app: 'routine', schema: SCHEMA, exportedAt: new Date().toISOString(), data };
}
// Validates and normalises an imported file. Returns { ok, data, error }. Does not write anything.
export function parseImport(obj, todayIso) {
  if (!isObj(obj)) return { ok: false, error: 'That file is not a Routine backup.' };
  if (obj.schema === 1 && isObj(obj.logs)) return { ok: true, data: migrateV1(obj, todayIso) };
  if (obj.app !== 'routine' || !isObj(obj.data)) return { ok: false, error: 'That file is not a Routine backup.' };
  if (typeof obj.schema !== 'number' || obj.schema > SCHEMA) return { ok: false, error: 'This backup comes from a newer version of the app. Update the app first.' };
  const data = {};
  for (const a of AREAS) {
    if (obj.data[a] !== undefined && !isObj(obj.data[a])) return { ok: false, error: `The "${a}" part of the backup is damaged.` };
    data[a] = obj.data[a] || {};
  }
  data.meta = { ...data.meta, schema: SCHEMA };
  return { ok: true, data };
}
export function replaceAll(data) {
  let ok = true;
  for (const a of AREAS) { cache[a] = data[a] || {}; ok = writeKey(PREFIX + a, cache[a]) && ok; }
  ver++;
  return ok;
}
export function resetAll() {
  try { const s = ls(); const keys = []; for (let i = 0; i < (s?.length || 0); i++) if (s.key(i).startsWith('routine.')) keys.push(s.key(i)); keys.forEach(k => s.removeItem(k)); }
  catch (e) { onError(`Couldn't reset: ${e.message}`); }
  for (const a of AREAS) delete cache[a];
  ver++;
  update('meta', m => { m.schema = SCHEMA; });
}
// Test helper: forget cached areas so the next get() re-reads localStorage.
export const _clearCache = () => { for (const a of AREAS) delete cache[a]; ver++; };
