// Food planning logic. Pure: no DOM, no storage. Data comes from setData({ foods, recipes }).
// Nutrition is always computed from foods.json (per 100 g; pcs foods use `each` grams per piece).
import { getDay } from './schedule.js';
import { isPrepDay } from './plan.js';
import { addDays, dayNum, mondayOf } from './util.js';

let FOODS = {}, PORTIONS = [], EXTRAS = {}, BATCH = [], QUICK = [], TOPUPS = [];
export function setData({ foods, recipes }) {
  FOODS = foods?.foods || {}; PORTIONS = foods?.portions || []; EXTRAS = foods?.extras || {};
  BATCH = recipes?.batch || []; QUICK = recipes?.quick || []; TOPUPS = recipes?.topups || [];
}
export const foods = () => FOODS;
export const portions = () => PORTIONS;
export const extras = () => EXTRAS;
export const batchRecipes = () => BATCH;
export const quickRecipes = () => QUICK;
export const allRecipes = () => [...BATCH, ...QUICK];
export const findRecipe = id => allRecipes().find(r => r.id === id) || null;
export const dataReady = () => BATCH.length > 0 && Object.keys(FOODS).length > 0;

export const SLOTS = ['m1', 'm2', 'm3', 'snack'];
export const SLOT_NAME = { m1: 'Meal 1', m2: 'Meal 2', m3: 'Meal 3', snack: 'Snack' };

// ---------- nutrition ----------
export const grams = (key, qty) => { const f = FOODS[key]; return f && f.shop?.unit === 'pcs' ? qty * (f.shop.each || 0) : qty; };
export function nutrition(ing) {
  let k = 0, p = 0;
  for (const [key, qty] of ing || []) { const f = FOODS[key]; if (!f) continue; const g = grams(key, qty); k += f.k * g / 100; p += f.p * g / 100; }
  return { k, p };
}
// ---------- cost: estimated rupees from foods.json shop.rs (per kg, litre or piece) ----------
// qty is in shop units: grams or ml, or pieces for pcs foods (the same numbers recipes use).
export const priceOf = (key, qty) => { const sh = FOODS[key]?.shop; return sh?.rs ? (sh.unit === 'pcs' ? qty * sh.rs : qty / 1000 * sh.rs) : 0; };
export const recipeCost = r => (r.ing || []).reduce((t, [k, q]) => t + priceOf(k, q), 0) / (r.portions || 1);
export const listCost = items => Math.round(items.reduce((t, i) => t + (i.rs || 0), 0));
// What a calendar month of the plan costs: what you eat, not the packs you buy (a 5 kg rice bag lasts beyond one month).
export function monthCost(iso, s, swaps = {}) {
  const [a, b] = monthRange(iso);
  return listCost(groceryFor(a, b, 'fresh', s, swaps)) + listCost(groceryFor(a, b, 'staple', s, swaps));
}

export function perServing(r) {
  const n = nutrition(r.ing), d = r.portions || 1;
  return { k: Math.round(n.k / d), p: Math.round(n.p / d) };
}
export const portionNutrition = pt => { const f = FOODS[pt.f]; return { k: Math.round(f.k * pt.g / 100), p: Math.round(f.p * pt.g / 100 * 10) / 10 }; };

// ---------- batch rotation ----------
export const EPOCH = '2026-10-26';
// Order matters: neighbours in this list end up on the same prep day, so proteins and prices are mixed on purpose
// (no two chicken dishes side by side, pricier fish/prawn/goat/paneer next to cheap beans/soya/eggs). Wraps around.
// The cheapest dishes appear twice (at least 4 places apart) to keep a month near the Rs 5,000 budget.
export const POOL = ['chicken-curry', 'dhal-rice-eggs', 'fish-curry', 'soya-curry', 'mine-frit', 'red-bean-curry', 'chicken-lentil-soup',
  'chickpea-soya-curry', 'egg-curry', 'chicken-briyani', 'soya-noodles', 'prawn-rougaille', 'dhal-rice-eggs', 'tuna-potato-curry',
  'chilli-sin-carne', 'paneer-peas-curry', 'soya-curry', 'chicken-rougaille', 'lentil-bolognese', 'sardine-rougaille', 'egg-curry',
  'bol-renverse', 'chickpea-soya-curry', 'goat-curry', 'soya-noodles', 'tuna-egg-fried-rice', 'chicken-potato-traybake',
  'chilli-sin-carne', 'fish-potato-bake', 'chicken-fried-rice', 'tuna-tomato-pasta'];
const mod = (a, n) => ((a % n) + n) % n;
const pool = () => POOL.filter(id => BATCH.some(r => r.id === id)).concat(BATCH.map(r => r.id).filter(id => !POOL.includes(id)));

const ordCache = new WeakMap();
// How many prep days come before this date, counted from EPOCH (negative before it).
export function prepOrdinal(iso, s) {
  let c = ordCache.get(s); if (!c) { c = new Map(); ordCache.set(s, c); }
  if (c.has(iso)) return c.get(iso);
  let n = 0;
  if (iso >= EPOCH) for (let d = EPOCH; d < iso; d = addDays(d, 1)) { if (isPrepDay(d, s)) n++; }
  else for (let d = iso; d < EPOCH; d = addDays(d, 1)) { if (isPrepDay(d, s)) n--; }
  c.set(iso, n); return n;
}
export function dishesFor(iso, s) {
  // Prep day i cooks the next two dishes in the pool, so every dish comes round once per cycle of n/2 prep days.
  const p = pool(), i = prepOrdinal(iso, s), n = p.length;
  return [p[mod(2 * i, n)], p[mod(2 * i + 1, n)]].map(id => BATCH.find(r => r.id === id));
}

export function prepFor(iso, s) {
  if (!isPrepDay(iso, s) || !dataReady()) return null;
  const dishes = dishesFor(iso, s);
  const total = dishes.reduce((a, r) => a + r.portions, 0), active = dishes.reduce((a, r) => a + r.active, 0);
  return {
    cook: dishes.map(r => ({ id: r.id, name: r.name, portions: r.portions })),
    note: `Cook ${dishes.map(r => r.name).join(' and ')}: ${total} boxes in all, about ${active} minutes of active cooking. Keep the next 3 days of boxes in the fridge and freeze the rest.`,
  };
}

// ---------- day kinds and batch portions ----------
function kindOf(iso, s) {
  const d = getDay(iso, s);
  if (d.type === 'work') return d.block === 'night' ? 'nightWork' : 'morningWork';
  return isPrepDay(iso, s) ? 'prep' : 'off';
}
const BATCH_SLOTS = { nightWork: ['m1', 'm2'], morningWork: ['m2', 'm3'], off: ['m2'], prep: ['m2'] };
const need = (iso, s) => BATCH_SLOTS[kindOf(iso, s)].length;

// The prep day whose boxes feed this date.
export function prepDayFor(iso, s) {
  for (let k = 0; k <= 14; k++) { const d = addDays(iso, -k); if (isPrepDay(d, s)) return d; }
  return null;
}
// Portion queue of a prep day: dishes alternate so you do not eat one dish several times in a row.
function queue(P, s) {
  const [a, b] = dishesFor(P, s), out = [];
  for (let i = 0; i < Math.max(a.portions, b.portions); i++) { if (i < a.portions) out.push(a); if (i < b.portions) out.push(b); }
  return out;
}
// Batch portions the date eats, one per batch slot: [{ slot, recipe, fresh }] or null entries when the boxes ran out.
export function batchFor(iso, s) {
  const P = prepDayFor(iso, s); if (!P) return BATCH_SLOTS[kindOf(iso, s)].map(slot => ({ slot, recipe: null }));
  let used = 0; for (let d = P; d < iso; d = addDays(d, 1)) used += need(d, s);
  const q = queue(P, s);
  const out = BATCH_SLOTS[kindOf(iso, s)].map((slot, i) => ({ slot, recipe: q[used + i] || null, fresh: iso === P }));
  if (out.length === 2 && mod(dayNum(iso), 2)) [out[0].recipe, out[1].recipe] = [out[1].recipe, out[0].recipe]; // alternate the order day to day
  return out;
}
// Boxes needed from this prep day until the next one (for the test and the prep screen).
export function boxesNeeded(P, s) {
  let n = 0, d = P; do { n += need(d, s); d = addDays(d, 1); } while (!isPrepDay(d, s) && dayNum(d) - dayNum(P) < 14);
  return n;
}
export function whereBoxesGo(P, s) {
  const out = []; let d = P;
  do { const b = batchFor(d, s).filter(x => x.recipe); if (b.length) out.push({ iso: d, items: b }); d = addDays(d, 1); } while (!isPrepDay(d, s) && dayNum(d) - dayNum(P) < 14);
  return out;
}

// ---------- quick items ----------
const QUICK_SLOTS = {
  nightWork: { m3: 'light', snack: 'snack' },
  morningWork: { m1: 'breakfast', snack: 'snack' },
  off: { m1: 'breakfast', m3: 'home', snack: 'snack' },
  prep: { m1: 'breakfast', m3: 'home', snack: 'snack' },
};
const SALT = { m1: 0, m2: 3, m3: 2, snack: 1 };
// Quick items that work for this slot on this day (used for plan picks and the swap list).
export function slotOptions(iso, s, slot) {
  const kind = kindOf(iso, s), work = kind.endsWith('Work');
  const base = slot === 'm1' ? ['breakfast', 'light'] : slot === 'snack' ? ['snack'] : ['home', 'light'];
  return QUICK.filter(r => r.slots.some(x => base.includes(x)) && (!work || r.tag === 'pack-for-work' || (slot === 'm1' && kind === 'morningWork')));
}
const mealOf = (r, extra = {}) => { const n = perServing(r); return { name: r.name, k: n.k, p: n.p, recipe: r.id, ...extra }; };
const WHERE = { 'top-milk': 'm1', 'top-yoghurt': 'm3', 'top-banana': 'snack', 'top-peanuts': 'snack', 'top-pb-toast': 'm3' };
const BAND = { k: [2400, 2650], p: [115, 135] };
const sumOf = meals => SLOTS.reduce((a, sl) => ({ k: a.k + (meals[sl]?.k || 0), p: a.p + (meals[sl]?.p || 0) }), { k: 0, p: 0 });

// Adds small top-ups (milk, banana, peanuts...) when a day lands under target. Copies the meals first.
function withTopups(meals, uses, iso, s) {
  const out = {}; for (const sl of SLOTS) if (meals[sl]) out[sl] = { ...meals[sl] };
  const u = uses.slice(), T = s.kcal || 2500, P = s.protein || 120, off = mod(dayNum(iso), Math.max(1, TOPUPS.length)), done = [];
  for (let i = 0; i < 4; i++) {
    const t = sumOf(out); if (t.k >= T - 80 && t.p >= P - 6) break;
    const c = TOPUPS.map((_, j) => TOPUPS[(off + j + i) % TOPUPS.length]).find(x => !done.includes(x.id) && t.k + nutrition(x.ing).k <= BAND.k[1]);
    if (!c) break;
    const n = nutrition(c.ing), m = out[WHERE[c.id] || 'snack'] || out.snack || out.m3; if (!m) break;
    m.name += `, plus ${c.name}`; m.k += Math.round(n.k); m.p += Math.round(n.p); m.top = [...(m.top || []), c.id];
    u.push(...c.ing.map(x => [...x])); done.push(c.id);
  }
  return { meals: out, uses: u };
}
const inBand = t => t.k >= BAND.k[0] && t.k <= BAND.k[1] && t.p >= BAND.p[0] && t.p <= BAND.p[1];
const miss = t => Math.max(0, BAND.k[0] - t.k, t.k - BAND.k[1]) / 10 + Math.max(0, BAND.p[0] - t.p, t.p - BAND.p[1]);
const sig = m => SLOTS.map(sl => m[sl]?.name || '').join('|');
const quickIds = m => SLOTS.map(sl => m[sl] && !m[sl].batch ? m[sl].recipe : '');

// One day. `avoid` is the previous day's plan: the pick must differ from it.
function planDay(iso, s, swaps, avoid) {
  const kind = kindOf(iso, s), sw = swaps?.[iso] || {}, fixed = {}, uses = [], used = new Set();
  let fallback = false;
  const addUses = r => { if (!r.batch) uses.push(...r.ing.map(i => [...i])); r.basics?.forEach(b => uses.push([b, 0])); };
  for (const slot of SLOTS) { const r = sw[slot] && findRecipe(sw[slot]); if (r) { fixed[slot] = mealOf(r, { swapped: true }); used.add(r.id); addUses(r); } }
  for (const b of batchFor(iso, s)) {
    if (fixed[b.slot]) continue;
    if (b.recipe) { fixed[b.slot] = { ...mealOf(b.recipe), batch: true, ...(b.fresh ? { prep: true } : {}) }; used.add(b.recipe.id); }
    else {
      fallback = true;
      const list = slotOptions(iso, s, b.slot).filter(r => !r.extra && !used.has(r.id)), r = list[mod(dayNum(iso), Math.max(1, list.length))];
      if (r) { fixed[b.slot] = mealOf(r); used.add(r.id); addUses(r); }
    }
  }
  const free = SLOTS.filter(sl => !fixed[sl] && QUICK_SLOTS[kind][sl]).map(slot => {
    const want = QUICK_SLOTS[kind][slot], work = kind.endsWith('Work');
    const list = QUICK.filter(r => !r.extra && r.slots.includes(want) && (!work || r.tag === 'pack-for-work' || slot === 'm1') && !used.has(r.id));
    const st = mod(dayNum(iso) + SALT[slot], Math.max(1, list.length));
    return { slot, list: list.map((_, i) => list[(st + i) % list.length]) };
  });
  const prevQ = avoid ? quickIds(avoid) : [], prevSig = avoid ? sig(avoid) : '';
  // Budget: the day's share of the monthly budget, minus the boxes it eats, is what quick meals and top-ups may cost.
  const boxRs = SLOTS.reduce((t, sl) => t + (fixed[sl]?.batch ? recipeCost(findRecipe(fixed[sl].recipe)) : 0), 0);
  const cap = (s.budget || 5000) / 30.4 - boxRs;
  let best = null, strict = null, cheap = null, tries = 0;
  const walk = (i, pick) => {
    if (strict || tries > 3000) return;
    if (i === free.length) {
      tries++;
      const meals = { ...fixed }, u = uses.slice();
      pick.forEach((r, j) => { meals[free[j].slot] = mealOf(r); u.push(...r.ing.map(x => [...x]), ...(r.basics || []).map(b => [b, 0])); });
      const f = withTopups(meals, u, iso, s), t = sumOf(f.meals), differs = sig(f.meals) !== prevSig;
      const fresh = free.every((fr, j) => prevQ[SLOTS.indexOf(fr.slot)] !== pick[j].id);
      const cand = { ...f, score: miss(t) + (differs ? 0 : 1000) + (fresh ? 0 : 20) };
      if (inBand(t) && differs && fresh) {
        cand.rs = f.uses.reduce((a, [k, q]) => a + priceOf(k, q), 0);
        if (cand.rs <= cap) { strict = cand; return; } // first in rotation order that fits the budget keeps variety
        if (!cheap || cand.rs < cheap.rs) cheap = cand;
        return;
      }
      if (!best || cand.score < best.score) best = cand;
      return;
    }
    for (const r of free[i].list) { if (pick.some(x => x.id === r.id)) continue; walk(i + 1, [...pick, r]); if (strict) return; }
  };
  walk(0, []);
  const chosen = strict || cheap || best || { ...withTopups(fixed, uses, iso, s) };
  const prep = isPrepDay(iso, s) ? dishesFor(iso, s) : null;
  if (prep) for (const r of prep) { chosen.uses.push(...r.ing.map(i => [...i])); r.basics?.forEach(b => chosen.uses.push([b, 0])); }
  return { meals: chosen.meals, uses: chosen.uses, cook: prep, fallback, kind };
}
// The plan chains from the start date so each day can avoid repeating the day before. Memoised per settings object.
const planCache = new WeakMap();
function planned(iso, s) {
  let c = planCache.get(s); if (!c) { c = new Map(); planCache.set(s, c); }
  if (c.has(iso)) return c.get(iso);
  const from = iso > EPOCH ? EPOCH : iso;
  let prev = null;
  for (let d = from; d <= iso; d = addDays(d, 1)) {
    if (!c.has(d)) c.set(d, planDay(d, s, {}, prev?.meals));
    prev = c.get(d);
  }
  return c.get(iso);
}

export function dayDetail(iso, s, swaps = {}) {
  if (!dataReady()) return { meals: {}, uses: [], cook: null, fallback: false, kind: kindOf(iso, s) };
  if (!swaps?.[iso] || !Object.keys(swaps[iso]).length) return planned(iso, s);
  const prev = iso > EPOCH ? planned(addDays(iso, -1), s).meals : null;
  return planDay(iso, s, swaps, prev);
}
export const mealsFor = (iso, s, swaps = {}) => dayDetail(iso, s, swaps).meals;
export const dayTotals = meals => sumOf(meals);

// ---------- grocery lists ----------
const fmtG = (g, unit) => unit === 'g' ? (g >= 1000 ? `${Math.round(g / 100) / 10} kg` : `${Math.round(g)} g`) : unit === 'ml' ? (g >= 1000 ? `${Math.round(g / 100) / 10} L` : `${Math.round(g)} ml`) : `${Math.ceil(g - 1e-9)}`;
// Pack suggestion: biggest packs first, then the smallest pack that covers what is left.
export function packsFor(qty, packs) {
  const sorted = (packs || [1]).slice().sort((a, b) => b - a), out = []; let left = qty;
  for (const sz of sorted) { const n = Math.floor(left / sz + 1e-9); if (n > 0 && (sz !== sorted[sorted.length - 1] || true)) { out.push({ size: sz, n }); left -= n * sz; } }
  if (left > 1e-9) { const fit = sorted.slice().reverse().find(sz => sz >= left) || sorted[0]; const e = out.find(o => o.size === fit); if (e) e.n++; else out.push({ size: fit, n: 1 }); }
  return out;
}
export const packTotal = packs => packs.reduce((a, p) => a + p.size * p.n, 0);

// Items needed over a date range. cat 'fresh' (weekly) or 'staple' (monthly).
export function groceryFor(from, to, cat, s, swaps = {}) {
  const need = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const det = dayDetail(d, s, swaps);
    for (const [key, qty] of det.uses) { const f = FOODS[key]; if (!f?.shop || f.shop.cat !== cat) continue; need.set(key, (need.get(key) || 0) + grams(key, qty) / (f.shop.unit === 'pcs' ? (f.shop.each || 1) : 1)); }
  }
  const items = [];
  for (const [key, qty] of need) {
    const f = FOODS[key], sh = f.shop, packs = qty > 0 ? packsFor(qty, sh.packs) : [{ size: sh.packs[sh.packs.length - 1], n: 1 }];
    const unit = sh.unit, size = n => unit === 'pcs' ? '' : fmtG(n, unit);
    const buy = packs.map(p => unit === 'pcs' ? `${p.n * p.size}` : `${p.n} × ${size(p.size)}`).join(' + ');
    const needTxt = qty > 0 ? (unit === 'pcs' ? `${Math.ceil(qty - 1e-9)}` : fmtG(qty, unit)) : 'a little';
    items.push({ key, name: f.name, label: sh.label, unit, qty, need: needTxt, packs, buy, bought: packTotal(packs), rs: priceOf(key, qty) });
  }
  const ex = (EXTRAS[cat] || []).map(e => ({ key: e.key, name: e.name, qty: 0, need: e.qty, extra: true, buy: e.qty, packs: [] }));
  return items.sort((a, b) => a.name.localeCompare(b.name)).concat(ex);
}
export const weekRange = iso => { const m = mondayOf(iso); return [m, addDays(m, 6)]; };
export function monthRange(iso) {
  const [y, m] = iso.split('-').map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate(), p = n => String(n).padStart(2, '0');
  return [`${y}-${p(m)}-01`, `${y}-${p(m)}-${p(last)}`];
}
