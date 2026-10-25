// One storage module: versioned schema + migrations. Everything else goes through here.
import { DEFAULTS } from './schedule.js';
const KEY = 'routine.state';
export const SCHEMA = 1;
const MIGRATIONS = {}; // MIGRATIONS[n] upgrades schema n -> n+1

const fresh = () => ({ schema: SCHEMA, firstUse: null, settings: {}, logs: {} });

function load() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(KEY);
    if (!raw) return fresh();
    let st = JSON.parse(raw);
    while (st.schema < SCHEMA) { st = MIGRATIONS[st.schema](st); st.schema++; }
    return st;
  } catch { return fresh(); }
}
const state = load();

export function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ } }
export const getFirstUse = () => state.firstUse;
export const getSettings = () => ({ ...DEFAULTS, waterRest: 2000, waterGym: 2500, ...state.settings });
export const getLog = iso => ({ junk: false, water: 0, walk: false, ...state.logs[iso] });
export function setLog(iso, patch) {
  state.logs[iso] = { ...getLog(iso), ...patch };
  if (!state.firstUse) state.firstUse = iso;
  save();
}
