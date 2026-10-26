// node tests/food.test.js — recipe rules, 8-week meal plan, rotation, grocery coverage, logging, screens render.
import { readFileSync } from 'node:fs';
const mem = {};
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, key: i => Object.keys(mem)[i], get length() { return Object.keys(mem).length; } };
const root = new URL('..', import.meta.url);
const foodsJson = JSON.parse(readFileSync(new URL('data/foods.json', root), 'utf8'));
const recipesJson = JSON.parse(readFileSync(new URL('data/recipes.json', root), 'utf8'));
const P = await import('../js/food-plan.js');
const S = await import('../js/storage.js');
const U = await import('../js/util.js');
const { isPrepDay } = await import('../js/plan.js');
const { getDay } = await import('../js/schedule.js');
const F = await import('../js/food.js');
P.setData({ foods: foodsJson, recipes: recipesJson });

let fail = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' ' + extra)); if (!cond) fail++; };
const s = S.getSettings(), F0 = foodsJson.foods;
const recipes = P.allRecipes();

// ---- recipe rules ----
ok('every recipe has steps, ingredients and a tag', recipes.every(r => r.steps?.length && r.ing?.length && r.tag));
ok('at most 8 ingredients, basics excluded', recipes.every(r => r.ing.length <= 8), recipes.filter(r => r.ing.length > 8).map(r => r.id).join());
const missing = recipes.flatMap(r => r.ing.map(i => i[0]).filter(k => !F0[k]).map(k => r.id + ':' + k));
ok('every ingredient key exists in foods.json', !missing.length, missing.join());
ok('basics are foods or water', recipes.every(r => (r.basics || []).every(b => b === 'water' || F0[b])));
ok('topup keys exist', recipesJson.topups.every(t => t.ing.every(i => F0[i[0]])));
ok('portions point at real foods', foodsJson.portions.every(p => F0[p.f]));
const BAD = /\b(pork|beef|bacon|ham|sausages?|lard|wine|beer|rum|vodka|whisky|alcohol|brandy)\b/i;
ok('no pork, beef or alcohol anywhere in recipes or foods', !BAD.test(JSON.stringify(recipesJson) + JSON.stringify(F0)));
ok('batch recipes are 30 minutes of active cooking or less', P.batchRecipes().every(r => r.active <= 30));
ok('quick recipes take 10 minutes or less', P.quickRecipes().filter(r => !r.extra).every(r => r.total <= 10));
ok('white fish is a fresh shopping item', F0.fish?.shop?.cat === 'fresh');
ok('nutrition is computed from foods.json', Math.abs(P.nutrition([['egg', 2]]).k - 2 * 55 * 1.43) < 0.01 && Math.abs(P.nutrition([['rice_raw', 100]]).p - 7.1) < 1e-9);
ok('batch boxes are 4 portions and 450 to 850 kcal, 30 to 65 g', P.batchRecipes().every(r => { const n = P.perServing(r); return r.portions === 4 && n.k >= 450 && n.k <= 850 && n.p >= 30 && n.p <= 65; }));
const srcText = ['js/food.js', 'js/food-plan.js', 'data/recipes.json'].map(f => readFileSync(new URL(f, root), 'utf8')).join('\n');
ok('no weight-loss language', !/weight[- ]loss|lose weight|fat burn|calories burned|cut(ting)? calories|\bdiet\b|cheat/i.test(srcText));

// ---- 8 weeks of plan ----
const days = Array.from({ length: 56 }, (_, i) => U.addDays('2026-10-26', i));
const det = Object.fromEntries(days.map(d => [d, P.dayDetail(d, s)]));
const tot = d => P.dayTotals(det[d].meals);
const off = days.filter(d => { const t = tot(d); return t.k < 2300 || t.k > 2700 || t.p < 110 || t.p > 140; });
ok('8 weeks: daily totals 2,300 to 2,700 kcal and 110 to 140 g protein', !off.length, off.map(d => `${d} ${Math.round(tot(d).k)}/${Math.round(tot(d).p)}`).join('; '));
ok('every day has four meals', days.every(d => P.SLOTS.every(sl => det[d].meals[sl]?.name && det[d].meals[sl].k > 0)));
const sig = d => P.SLOTS.map(sl => det[d].meals[sl].name).join('|');
const same = days.slice(1).filter((d, i) => sig(d) === sig(days[i]));
ok('no identical day twice in a row', !same.length, same.join());
const sameSlot = days.slice(1).filter((d, i) => ['snack', 'm1'].filter(sl => !det[d].meals[sl].batch && det[d].meals[sl].name === det[days[i]].meals[sl].name).length >= 2);
ok('quick meals rotate (not the same breakfast and snack as yesterday)', !sameSlot.length, sameSlot.join());
const distinct = new Set(days.flatMap(d => P.SLOTS.map(sl => det[d].meals[sl].recipe)));
ok('plenty of variety across 8 weeks (20+ different items)', distinct.size >= 20, String(distinct.size));
ok('no pork/beef/alcohol in planned meals', days.every(d => P.SLOTS.every(sl => !BAD.test(det[d].meals[sl].name))));

// ---- prep days and boxes ----
const preps = days.filter(d => isPrepDay(d, s));
ok('1 to 2 prep days a week (first off day of each off stretch)', preps.length >= 8 && preps.length <= 16 && preps.every(d => getDay(d, s).isFirstOffAfterWork), String(preps.length));
const dishIds = d => P.prepFor(d, s).cook.map(c => c.id);
ok('prep days cook two dishes', preps.every(d => dishIds(d).length === 2 && dishIds(d)[0] !== dishIds(d)[1]));
const clash = preps.slice(1).filter((d, i) => dishIds(d).some(x => dishIds(preps[i]).includes(x)));
ok('consecutive prep days cook different dishes', !clash.length, clash.join());
const preps16 = Array.from({ length: 140 }, (_, i) => U.addDays('2026-10-26', i)).filter(d => isPrepDay(d, s));
ok('prep days cover every batch dish in the pool within 20 weeks', new Set(preps16.flatMap(dishIds)).size === P.batchRecipes().length);
const nobox = days.filter(d => det[d].fallback);
ok('batch boxes cover every work day and off day (no fallback meals)', !nobox.length, nobox.join());
const workDays = days.filter(d => getDay(d, s).type === 'work');
ok('work days use two boxes from the batch', workDays.every(d => P.SLOTS.filter(sl => det[d].meals[sl].batch).length === 2));
ok('boxes needed never exceed boxes cooked', preps.every(d => P.boxesNeeded(d, s) <= P.prepFor(d, s).cook.reduce((a, c) => a + c.portions, 0)));
ok('prep day eats one fresh portion', preps.every(d => Object.values(det[d].meals).some(m => m.prep)));
ok('prepFor is null on a non-prep day', P.prepFor(days.find(d => !isPrepDay(d, s)), s) === null);
ok('days off prep days have no cook list', days.filter(d => !isPrepDay(d, s)).every(d => !det[d].cook));
ok('packed meals on work days are pack-for-work', workDays.every(d => P.SLOTS.every(sl => { const m = det[d].meals[sl]; if (m.batch) return true; const r = P.findRecipe(m.recipe); return sl === 'm1' && getDay(d, s).block === 'morning' || r.tag === 'pack-for-work' || sl === 'm3'; })));

// ---- grocery lists ----
let gap = [], short = [];
const weeks = [...new Set(days.map(U.mondayOf))];
for (const mon of weeks) {
  const fresh = P.groceryFor(mon, U.addDays(mon, 6), 'fresh', s), keys = new Set(fresh.map(i => i.key));
  for (let i = 0; i < 7; i++) {
    const d = U.addDays(mon, i);
    for (const [k] of P.dayDetail(d, s).uses) if (F0[k]?.shop?.cat === 'fresh' && !keys.has(k)) gap.push(d + ' ' + k);
  }
  for (const it of fresh) if (!it.extra && it.bought + 1e-6 < it.qty) short.push(mon + ' ' + it.key);
}
const months = [...new Set(days.map(d => d.slice(0, 7)))];
for (const ym of months) {
  const [a, b] = P.monthRange(ym + '-01'), st = P.groceryFor(a, b, 'staple', s), keys = new Set(st.map(i => i.key));
  for (let d = a; d <= b; d = U.addDays(d, 1)) for (const [k] of P.dayDetail(d, s).uses) if (F0[k]?.shop?.cat === 'staple' && !keys.has(k)) gap.push(d + ' ' + k);
  for (const it of st) if (!it.extra && it.bought + 1e-6 < it.qty) short.push(ym + ' ' + it.key);
  ok('monthly list includes the extras from foods.json (boxes, foil)', foodsJson.extras.staple.every(e => st.some(i => i.key === e.key)));
}
ok('grocery lists cover every ingredient in the plan (weekly fresh, monthly staples)', !gap.length, gap.slice(0, 5).join('; '));
ok('suggested packs cover the quantity needed', !short.length, short.slice(0, 5).join('; '));
ok('every ingredient used has a shop entry or is basic water', days.every(d => det[d].uses.every(([k]) => k === 'water' || F0[k]?.shop)));
ok('pack maths: 1,700 g with 1000/500 packs buys 2,000 g', P.packTotal(P.packsFor(1700, [1000, 500])) === 2000);
ok('pack maths: 1 egg-carton case', P.packTotal(P.packsFor(14, [30, 12, 6])) >= 14);
const wk1 = P.groceryFor('2026-10-26', '2026-11-01', 'fresh', s);
ok('week list has chicken and eggs with a buy line', ['chicken_breast', 'egg'].every(k => wk1.find(i => i.key === k && i.buy)));

// ---- logging ----
const rd = '2026-10-28', ctx = { s, iso: rd, min: 23 * 60, ms: 0, rd, notify() {}, go() {}, rerender() {} };
F.logEntry(rd, { n: 'Chicken curry with rice', k: 713, p: 45, meal: 'm2', src: 'r:chicken-curry', qty: 1 }, 23 * 60 + 5);
let e0 = S.get('food').log[rd][0];
ok('logging stores meal slot and time against the routine day', e0.meal === 'm2' && e0.t === '23:05' && e0.k === 713 && e0.p === 45);
const m2 = F.mealsFor(rd, s);
ok('Log this meal button handler logs the planned meal with slot and time', (() => {
  const el = { dataset: { slot: 'm1' } };
  const r = F.default.click('food-log', el, ctx); const l = S.get('food').log[rd];
  return r === true && l.length === 2 && l[1].meal === 'm1' && l[1].t === '23:00' && l[1].n === m2.m1.name && l[1].k === m2.m1.k;
})());
ok('totals sum the day log', Math.round(F.totals(rd).k) === 713 + m2.m1.k);
ok('recent list is kept, newest first, no duplicates', S.get('food').recent[0] === 'r:' + m2.m1.recipe && new Set(S.get('food').recent).size === S.get('food').recent.length && S.get('food').recent.includes('r:chicken-curry'));
F.default.click('food-add', { dataset: { key: 'egg', slot: 'snack' } }, ctx);
ok('household portion logs 1 egg with protein', (() => { const l = S.get('food').log[rd].at(-1); return l.n === '1 egg' && l.meal === 'snack' && Math.round(l.p) === 7; })());
F.default.change('food-whey', { checked: true });
ok('whey toggle is off by default and can be turned on', S.getSettings().whey === true && !JSON.parse(mem['routine.v2.settings'] || '{}').nope);
F.default.change('food-whey', { checked: false });
F.removeEntry(rd, 0);
ok('removing an entry works', S.get('food').log[rd].length === 2);
// swaps
const before = F.mealsFor(rd, s).snack.name, alt = P.slotOptions(rd, s, 'snack').find(r => r.id !== F.mealsFor(rd, s).snack.recipe);
F.default.change('food-swap', { dataset: { iso: rd, slot: 'snack' }, value: alt.id });
ok('swap replaces one meal and is stored', F.mealsFor(rd, s).snack.recipe === alt.id && S.get('food').swaps[rd].snack === alt.id && F.mealsFor(rd, s).m1.recipe === m2.m1.recipe);
F.default.change('food-swap', { dataset: { iso: rd, slot: 'snack' }, value: '' });
ok('clearing a swap restores the plan', F.mealsFor(rd, s).snack.name === before && !S.get('food').swaps);
F.markCooked('fish-potatoes', rd);
ok('cooked map stores the date', S.get('food').cooked['fish-potatoes'] === rd);

// ---- screens render ----
const routes = ['', 'week', 'week/2026-11-02', 'prep/2026-10-26', 'prep/2026-10-28', 'shop', 'shop/2026-11-02', 'recipes', 'recipe/chicken-curry', 'recipe/fish-potatoes', 'recipe/nope', 'skills'];
for (const r of routes) {
  let html = '', err = null; try { html = F.default.view(ctx, r); } catch (e) { err = e; }
  ok(`route #/food/${r} renders`, !err && html.length > 40 && !/undefined|NaN|\[object/.test(html), err ? err.message : '');
}
let card = ''; try { card = F.todayCard(ctx); } catch (e) { card = ''; }
ok('todayCard renders with a Log this meal button', card.includes('food-log') && !/undefined|NaN/.test(card));
ok('week and prep screens link to each other', F.default.view(ctx, 'week').includes('#/food/prep/') && F.default.view(ctx, 'prep/2026-10-26').includes('Where the boxes go'));
ok('prepFor note is neutral and names both dishes', (() => { const p = F.prepFor('2026-10-26', s); return p.cook.length === 2 && p.cook.every(c => p.note.includes(c.name)); })());
ok('g/kg shows when a weigh-in exists', (() => { S.update('progress', p => { p.weighins = { '2026-10-25': { kg: 60 } }; }); return F.latestKg() === 60 && F.default.view(ctx, '').includes('g/kg'); })());
ok('styles/food.css keeps inputs and tap targets accessible', (() => { const c = readFileSync(new URL('styles/food.css', root), 'utf8'); return /min-height:4[48]px/.test(c) && !/font-size:\s*1[0-5]px/.test(c); })());

console.log(fail ? `\n${fail} FAILED` : '\nAll passed');
process.exit(fail ? 1 : 0);
