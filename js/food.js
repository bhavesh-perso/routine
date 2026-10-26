// Food module: today's plan vs what you logged, week plan, batch-cook (prep) screen, grocery lists,
// recipes and the cooking-skills checklist. Planning maths lives in food-plan.js (pure).
import { get, update, setSetting } from './storage.js';
import { dayPlan, isPrepDay, timeLabel } from './plan.js';
import { getDay } from './schedule.js';
import { addDays, mondayOf, dayLabel, monthLabel, esc, fmt } from './util.js';
import * as P from './food-plan.js';

// ---------- data ----------
export async function loadData() {
  try {
    const [foods, recipes] = await Promise.all(['data/foods.json', 'data/recipes.json'].map(u => fetch(u).then(r => r.json())));
    P.setData({ foods, recipes });
  } catch (e) { console.error('Food data did not load', e); }
}

// ---------- storage helpers ----------
const area = () => get('food');
const swapsOf = () => area().swaps || {};
export const entries = iso => (area().log || {})[iso] || [];
export function totals(iso) { return entries(iso).reduce((a, e) => ({ k: a.k + (+e.k || 0), p: a.p + (+e.p || 0) }), { k: 0, p: 0 }); }
export const mealsFor = (iso, s) => P.mealsFor(iso, s, swapsOf());
export const prepFor = (iso, s) => P.prepFor(iso, s);

// One logged item: { n, k, p, meal: 'm1'|'m2'|'m3'|'snack'|null, t: 'HH:MM'|null, src?, qty? }. Stored against the routine day.
export function logEntry(rd, e, min) {
  const entry = { n: String(e.n || 'Food'), k: Math.round(+e.k || 0), p: Math.round((+e.p || 0) * 10) / 10, meal: P.SLOTS.includes(e.meal) ? e.meal : null, t: Number.isFinite(min) ? fmt(min) : (e.t || null) };
  if (e.src) entry.src = e.src;
  if (e.qty) entry.qty = e.qty;
  return update('food', f => {
    f.log = f.log || {}; (f.log[rd] = f.log[rd] || []).push(entry);
    if (e.src) f.recent = [e.src, ...(f.recent || []).filter(x => x !== e.src)].slice(0, 8);
  });
}
export function removeEntry(rd, i) { return update('food', f => { const l = (f.log || {})[rd]; if (l && l[i]) l.splice(i, 1); }); }
export function setSwap(iso, slot, id) {
  return update('food', f => {
    f.swaps = f.swaps || {}; const d = f.swaps[iso] = f.swaps[iso] || {};
    if (id) d[slot] = id; else delete d[slot];
    if (!Object.keys(d).length) delete f.swaps[iso];
    if (!Object.keys(f.swaps).length) delete f.swaps;
  });
}
export const markCooked = (id, iso) => update('food', f => { f.cooked = f.cooked || {}; f.cooked[id] = iso; });
export const unmarkCooked = id => update('food', f => { if (f.cooked) delete f.cooked[id]; });
export function tick(bucket, scope, key, on) {
  return update('food', f => {
    f[bucket] = f[bucket] || {}; const o = f[bucket][scope] = f[bucket][scope] || {};
    if (on) o[key] = true; else delete o[key];
  });
}
export function latestKg() {
  const w = get('progress').weighins || {}; const k = Object.keys(w).filter(d => w[d] && Number.isFinite(+w[d].kg) && +w[d].kg > 0).sort().pop();
  return k ? +w[k].kg : null;
}

// ---------- formatting ----------
const FR = { 0.5: '½', 0.25: '¼', 0.75: '¾' };
const num = n => FR[n] || String(Math.round(n * 10) / 10);
const per = (iso, ctx) => { try { return dayPlan(iso, ctx.s).filter(b => b.kind === 'meal' && b.slot); } catch { return []; } };
export function ingText(key, qty) {
  const f = P.foods()[key]; if (!f) return `${qty} ${key}`;
  const u = f.shop?.unit;
  if (u === 'pcs') return `${num(qty)} × ${f.name.toLowerCase()}`;
  return `${num(qty)} ${u === 'ml' ? 'ml' : 'g'} ${f.name.toLowerCase()}`;
}
const BASIC = { salt: 'salt', pepper: 'black pepper', water: 'water' };
const basicsText = r => (r.basics || []).map(b => BASIC[b] || b).join(', ');
const youtube = name => `https://www.youtube.com/results?search_query=${encodeURIComponent('how to make ' + name)}`;
const TAG = { 'pack-for-work': 'Pack for work', 'eat-at-home': 'Eat at home' };
const slotLine = r => `${P.perServing(r).k} kcal · ${P.perServing(r).p} g protein`;
export const rs = n => 'Rs ' + Math.round(n).toLocaleString('en');

// ---------- navigation ----------
const NAV = [['', 'Today'], ['week', 'Week'], ['shop', 'Shop'], ['recipes', 'Recipes'], ['skills', 'Skills']];
function nav(cur) {
  return `<nav class="seg" aria-label="Food sections">${NAV.map(([k, l]) => `<a href="#/food${k ? '/' + k : ''}"${k === cur ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
}
const ui = { slot: null };
const notReady = () => '<p class="note alert">Food data did not load. Reload the page.</p>';

// ---------- totals ----------
function totalsBlock(ctx, iso) {
  const s = ctx.s, t = totals(iso), kg = latestKg(), T = s.kcal, PT = s.protein;
  const kp = Math.min(100, Math.round(t.k / T * 100)), pp = Math.min(100, Math.round(t.p / PT * 100));
  const gkg = kg ? ` · ${(Math.round(t.p / kg * 10) / 10).toFixed(1)} g/kg` : '';
  return `<div class="food-totals">
    <div><p class="food-big"><span class="num">${Math.round(t.p)}</span> <small>of about ${PT} g protein${gkg}</small></p>
    <div class="bar" role="progressbar" aria-label="Protein" aria-valuenow="${pp}" aria-valuemin="0" aria-valuemax="100"><b style="width:${pp}%"></b></div></div>
    <div><p class="food-big"><span class="num">${Math.round(t.k)}</span> <small>of about ${T.toLocaleString('en')} kcal</small></p>
    <div class="bar" role="progressbar" aria-label="Energy" aria-valuenow="${kp}" aria-valuemin="0" aria-valuemax="100"><b style="width:${kp}%"></b></div></div></div>`;
}

// ---------- today ----------
const loggedIn = (iso, slot) => entries(iso).filter(e => e.meal === slot);
function swapSelect(ctx, iso, slot, m) {
  const opts = P.slotOptions(iso, ctx.s, slot).filter(r => r.id !== m.recipe);
  const cur = swapsOf()[iso]?.[slot] || '';
  return `<label class="field food-swap"><span>Swap this meal</span><select data-act="food-swap" data-iso="${iso}" data-slot="${slot}">
    <option value="">${m.swapped ? 'Back to the planned meal' : 'Keep: ' + esc(m.name)}</option>
    ${opts.map(r => `<option value="${esc(r.id)}"${cur === r.id ? ' selected' : ''}>${esc(r.name)} (${P.perServing(r).k} kcal)</option>`).join('')}</select></label>`;
}
function planRows(ctx, rd) {
  const meals = mealsFor(rd, ctx.s), times = Object.fromEntries(per(rd, ctx).map(b => [b.slot, b.start]));
  return `<ul class="rules food-plan">${P.SLOTS.map(slot => {
    const m = meals[slot]; if (!m) return '';
    const got = loggedIn(rd, slot), done = got.length > 0;
    return `<li class="food-meal${done ? ' done' : ''}">
      <p class="food-slot"><b>${P.SLOT_NAME[slot]}</b>${times[slot] != null ? ` <span class="muted num">${esc(timeLabel(times[slot]))}</span>` : ''}${m.prep ? ' <span class="tag">Fresh from today\'s cook</span>' : ''}</p>
      <p class="food-name">${esc(m.name)}</p>
      <p class="muted num">${m.k} kcal · ${m.p} g protein${m.batch ? ' · box from the batch' : ''}</p>
      ${done ? `<p class="muted">Logged: ${esc(got.map(e => e.n).join(', '))}${got[0].t ? ' at ' + esc(got[0].t) : ''}</p>` : ''}
      <div class="row">
        <button type="button" class="btn small${done ? ' ghost' : ' primary'}" data-act="food-log" data-slot="${slot}">${done ? 'Log again' : 'Log this meal'}</button>
        ${m.recipe ? `<a class="btn small ghost" href="#/food/recipe/${esc(m.recipe)}">Recipe</a>` : ''}
      </div>
      <details class="fold"><summary>Swap or change</summary>${swapSelect(ctx, rd, slot, m)}</details>
    </li>`;
  }).join('')}</ul>`;
}
function recents(s) {
  const keys = area().recent || [];
  return keys.map(k => {
    if (k.startsWith('r:')) { const r = P.findRecipe(k.slice(2)); return r ? { key: k, label: r.name, ...P.perServing(r) } : null; }
    const pt = P.portions().find(x => x.id === k); if (!pt || (pt.whey && !s.whey)) return null;
    return { key: k, label: pt.label, ...P.portionNutrition(pt) };
  }).filter(Boolean);
}
const quickBtn = (x, slot) => `<button type="button" class="btn small food-chip" data-act="food-add" data-key="${esc(x.key)}" data-slot="${slot}">${esc(x.label)}<span class="muted num"> ${Math.round(x.k)} kcal · ${Math.round(x.p)} g</span></button>`;

function todayView(ctx) {
  const rd = ctx.rd, s = ctx.s;
  const meals = mealsFor(rd, s), plan = P.dayTotals(meals), list = entries(rd);
  const next = P.SLOTS.find(sl => meals[sl] && !loggedIn(rd, sl).length) || 'snack';
  const slot = ui.slot || next;
  const prep = prepFor(rd, s);
  const pts = P.portions().filter(x => !x.whey || s.whey);
  const rec = recents(s);
  return `<h1 class="page-title">Food</h1><p class="muted">${esc(dayLabel(rd))} · plan for today is about ${Math.round(plan.k).toLocaleString('en')} kcal and ${Math.round(plan.p)} g protein</p>
  ${nav('')}${P.dataReady() ? '' : notReady()}
  <section aria-labelledby="ft"><h2 id="ft">Eaten so far</h2>${totalsBlock(ctx, rd)}</section>
  ${prep ? `<section class="note" aria-labelledby="fp"><h2 id="fp">Batch-cook day</h2><p>${esc(prep.note)}</p><a class="btn small" href="#/food/prep/${rd}">See what to cook</a></section>` : ''}
  <section aria-labelledby="fm"><h2 id="fm">Today's plan</h2>${planRows(ctx, rd)}</section>
  <section aria-labelledby="fl"><h2 id="fl">Logged today</h2>${list.length ? `<ul class="list">${list.map((e, i) => `<li class="item"><span class="check food-entry" data-done="true"><span class="grow">${esc(e.n)}<br><span class="muted num">${esc(e.meal ? P.SLOT_NAME[e.meal] : 'Other')}${e.t ? ' · ' + esc(e.t) : ''} · ${Math.round(e.k)} kcal · ${Math.round(e.p)} g</span></span></span><button type="button" class="add" data-act="food-del" data-i="${i}" aria-label="Remove ${esc(e.n)}">Remove</button></li>`).join('')}</ul>` : '<p class="muted">Nothing logged yet. Tap Log this meal above, or add something below.</p>'}</section>
  <section aria-labelledby="fa"><h2 id="fa">Add something else</h2>
    <label class="field"><span>Add it to</span><select data-act="food-slot">${P.SLOTS.map(x => `<option value="${x}"${x === slot ? ' selected' : ''}>${P.SLOT_NAME[x]}</option>`).join('')}</select></label>
    ${rec.length ? `<h3>Recent</h3><div class="chips">${rec.map(x => quickBtn(x, slot)).join('')}</div>` : ''}
    <details class="fold"><summary>Household portions</summary><div class="chips">${pts.map(x => quickBtn({ key: x.id, label: x.label, ...P.portionNutrition(x) }, slot)).join('')}</div></details>
    <details class="fold"><summary>Custom food</summary>
      <label class="field"><span>Name</span><input id="fc-n" autocomplete="off"></label>
      <div class="row"><label class="field grow"><span>kcal</span><input id="fc-k" inputmode="decimal"></label><label class="field grow"><span>Protein (g)</span><input id="fc-p" inputmode="decimal"></label></div>
      <button type="button" class="btn primary wide" data-act="food-custom" data-slot="${slot}">Add custom food</button></details>
    <label class="toggle"><input type="checkbox" data-act="food-whey"${s.whey ? ' checked' : ''}><span>Whey protein powder</span></label>
    ${s.whey ? '<p class="muted">Each scoop adds about 25 g protein. Start with half a scoop. Whey portions appear in the list above.</p>' : '<p class="muted">Off by default. Turn it on to add whey portions.</p>'}
  </section>`;
}

export function todayCard(ctx) {
  const rd = ctx.rd, s = ctx.s, meals = mealsFor(rd, s), t = totals(rd), prep = prepFor(rd, s);
  const next = P.SLOTS.find(sl => meals[sl] && !loggedIn(rd, sl).length), m = next && meals[next];
  const pp = Math.min(100, Math.round(t.p / s.protein * 100)), kp = Math.min(100, Math.round(t.k / s.kcal * 100));
  return `<p><b class="num">${Math.round(t.p)} / ${s.protein} g</b> protein · <b class="num">${Math.round(t.k)} / ${s.kcal}</b> kcal</p>
  <div class="bar" role="progressbar" aria-label="Protein" aria-valuenow="${pp}" aria-valuemin="0" aria-valuemax="100"><b style="width:${pp}%"></b></div>
  <div class="bar" role="progressbar" aria-label="Energy" aria-valuenow="${kp}" aria-valuemin="0" aria-valuemax="100"><b style="width:${kp}%"></b></div>
  ${prep ? `<p class="note">Batch-cook day: ${esc(prep.cook.map(c => c.name).join(' and '))}. <a href="#/food/prep/${rd}">What to cook</a></p>` : ''}
  ${m ? `<p class="food-next"><span class="muted">${P.SLOT_NAME[next]}</span><br>${esc(m.name)} <span class="muted num">${m.k} kcal · ${m.p} g</span></p>
  <div class="row"><button type="button" class="btn small primary" data-act="food-log" data-slot="${next}">Log this meal</button><a class="btn small ghost" href="#/food">Open food</a></div>`
    : '<p class="muted">Every planned meal is logged.</p><a class="btn small ghost" href="#/food">Open food</a>'}`;
}

// ---------- week ----------
function weekView(ctx, arg) {
  const s = ctx.s, mon = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? mondayOf(arg) : mondayOf(ctx.rd);
  const rows = Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(mon, i), d = getDay(iso, s), m = mealsFor(iso, s), t = P.dayTotals(m), prep = isPrepDay(iso, s);
    const type = d.type === 'off' ? 'Off day' : d.block === 'night' ? 'Night shift' : 'Morning shift';
    return `<li class="food-day${iso === ctx.rd ? ' now' : ''}"><p><b>${esc(dayLabel(iso))}</b> <span class="muted">${type}</span>${prep ? ' <span class="tag">Batch-cook day</span>' : ''}</p>
      <ul class="food-mini">${P.SLOTS.map(sl => m[sl] ? `<li><span class="muted">${P.SLOT_NAME[sl]}</span> ${esc(m[sl].name)}</li>` : '').join('')}</ul>
      <p class="muted num">${Math.round(t.k).toLocaleString('en')} kcal · ${Math.round(t.p)} g protein</p>
      ${prep ? `<a class="btn small" href="#/food/prep/${iso}">What to cook</a>` : ''}</li>`;
  }).join('');
  return `<h1 class="page-title">Food week</h1>${nav('week')}<p class="muted">${esc(dayLabel(mon))} to ${esc(dayLabel(addDays(mon, 6)))}. Cooking happens on batch-cook days only; every other meal is a box from the batch or a quick item.</p>
  <div class="row weeknav"><a class="btn small" href="#/food/week/${addDays(mon, -7)}">Previous</a><a class="btn small grow" href="#/food/week/${mondayOf(ctx.rd)}">This week</a><a class="btn small" href="#/food/week/${addDays(mon, 7)}">Next</a></div>
  <ul class="list">${rows}</ul><p class="muted"><a href="#/food/shop/${mon}">Shopping list for this week</a></p>`;
}

// ---------- prep ----------
function prepView(ctx, iso) {
  const s = ctx.s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) iso = ctx.rd;
  const prep = prepFor(iso, s);
  if (!prep) {
    let n = null; for (let k = 1; k <= 14 && !n; k++) if (isPrepDay(addDays(iso, k), s)) n = addDays(iso, k);
    return `<a class="back" href="#/food/week">Food week</a><h1 class="page-title">Batch cook</h1><p class="note calm">${esc(dayLabel(iso))} is not a batch-cook day. Every meal today is a box from the fridge or freezer, or a quick item.</p>${n ? `<a class="btn" href="#/food/prep/${n}">Next batch-cook day: ${esc(dayLabel(n))}</a>` : ''}`;
  }
  const dishes = P.dishesFor(iso, s), cooked = area().cooked || {}, go = P.whereBoxesGo(iso, s);
  const dish = r => `<section aria-labelledby="d-${r.id}"><h2 id="d-${r.id}">${esc(r.name)}</h2>
    <p class="muted">${r.portions} boxes · ${r.active} min active · ${r.total} min in all · ${slotLine(r)} each${r.hiddenVeg ? ' · vegetables hidden in it' : ''}</p>
    <h3>You need</h3><ul class="rules">${r.ing.map(([k, q]) => `<li>${esc(ingText(k, q))}</li>`).join('')}${basicsText(r) ? `<li class="muted">${esc(basicsText(r))}</li>` : ''}</ul>
    <h3>Steps</h3><ol class="food-steps">${r.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
    <p class="muted">${esc(r.batch)}</p>
    <div class="row"><a class="btn small ghost" target="_blank" rel="noopener" href="${youtube(r.name)}">Watch how</a>
    <button type="button" class="btn small" data-act="food-cooked" data-id="${esc(r.id)}" data-iso="${iso}">${cooked[r.id] ? 'Cooked ' + esc(dayLabel(cooked[r.id])) : 'Mark as cooked'}</button></div></section>`;
  return `<a class="back" href="#/food/week">Food week</a><h1 class="page-title">Batch cook</h1><p class="muted">${esc(dayLabel(iso))}</p>
  <p class="note">${esc(prep.note)}</p>
  <p class="muted">Order: put both rice cookers or pots on first, then do the chopping while they cook. Wash up as you go.</p>
  ${dishes.map(dish).join('')}
  <section aria-labelledby="wg"><h2 id="wg">Where the boxes go</h2><ul class="rules">${go.map(g => `<li><b>${esc(dayLabel(g.iso))}</b> <span class="muted">${esc(g.items.map(x => P.SLOT_NAME[x.slot] + ': ' + x.recipe.name).join(' · '))}</span></li>`).join('')}</ul></section>
  <p><a class="btn small ghost" href="#/food/shop/${mondayOf(iso)}">Shopping list for this week</a></p>`;
}

// ---------- shop ----------
function shopList(items, bucket, scope) {
  const ticks = area()[bucket]?.[scope] || {};
  if (!items.length) return '<p class="muted">Nothing needed.</p>';
  const left = items.filter(i => !ticks[i.key]).length;
  return `<p class="muted">${left} of ${items.length} still to buy</p><ul class="list">${items.map(i => `<li class="item"><button type="button" class="check food-shopitem" aria-pressed="${!!ticks[i.key]}" data-act="food-tick" data-bucket="${bucket}" data-scope="${scope}" data-key="${esc(i.key)}">
    <span class="grow">${esc(i.name)}<br><span class="muted">${i.extra ? esc(i.need) : `Need ${esc(i.need)} · buy ${esc(i.buy)}${i.label ? ' ' + esc(i.label) : ''}`}</span></span></button></li>`).join('')}</ul>`;
}
function budgetBlock(s, mon, sw, fresh) {
  const month = P.monthCost(mon, s, sw), budget = s.budget || 5000, pct = Math.min(100, Math.round(month / budget * 100));
  return `<section class="tile food-budget" aria-label="Budget"><p class="muted">${esc(monthLabel(mon))}, estimated</p>
    <p class="food-big"><span class="num">${rs(month)}</span> <small>of ${rs(budget)} a month</small></p>
    <div class="bar" role="progressbar" aria-label="Budget used" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><b style="width:${pct}%"></b></div>
    <p class="muted">This week's fresh list is about ${rs(P.listCost(fresh))}. ${month > budget ? 'Over budget: swap a goat, prawn or paneer dish for a soya, bean or egg one to bring it down.' : 'Prices are estimates from Mauritius supermarkets; your shop may differ a little.'}</p></section>`;
}
function shopView(ctx, arg) {
  const s = ctx.s, mon = /^\d{4}-\d{2}-\d{2}$/.test(arg) ? mondayOf(arg) : mondayOf(ctx.rd), sw = swapsOf();
  const [wf, wt] = [mon, addDays(mon, 6)], [mf, mt] = P.monthRange(mon), ym = mon.slice(0, 7);
  const fresh = P.groceryFor(wf, wt, 'fresh', s, sw), staples = P.groceryFor(mf, mt, 'staple', s, sw);
  return `<h1 class="page-title">Shopping</h1>${nav('shop')}
  ${budgetBlock(s, mon, sw, fresh)}
  <p class="muted">Metric quantities. Pack sizes are the cheapest common ones; swap brands as you like.</p>
  <div class="row weeknav"><a class="btn small" href="#/food/shop/${addDays(mon, -7)}">Previous</a><a class="btn small grow" href="#/food/shop/${mondayOf(ctx.rd)}">This week</a><a class="btn small" href="#/food/shop/${addDays(mon, 7)}">Next</a></div>
  <section aria-labelledby="sf"><h2 id="sf">Weekly fresh: ${esc(dayLabel(wf))} to ${esc(dayLabel(wt))}</h2>${shopList(fresh, 'shop', mon)}</section>
  <section aria-labelledby="ss"><h2 id="ss">Monthly staples: ${esc(monthLabel(mon))}</h2><p class="muted">Covers the whole month, including oil, spices, salt and the boxes for batch cooking.</p>${shopList(staples, 'staples', ym)}</section>`;
}

// ---------- recipes ----------
function recipesView() {
  const row = r => `<li><a class="food-rlink" href="#/food/recipe/${esc(r.id)}"><b>${esc(r.name)}</b><span class="muted">${slotLine(r)} · ${r.total} min · ${rs(P.recipeCost(r))}${r.hiddenVeg ? ' · hidden veg' : ''}</span></a></li>`;
  return `<h1 class="page-title">Recipes</h1>${nav('recipes')}${P.dataReady() ? '' : notReady()}
  <h2>Batch cook</h2><p class="muted">Cooked on batch-cook days and boxed. Four boxes each.</p><ul class="list">${P.batchRecipes().map(row).join('')}</ul>
  <h2>Quick meals</h2><p class="muted">No cooking, or 10 minutes at most.</p><ul class="list">${P.quickRecipes().map(row).join('')}</ul>`;
}
function recipeView(id) {
  const r = P.findRecipe(id);
  if (!r) return `<a class="back" href="#/food/recipes">Recipes</a><h1 class="page-title">Recipe not found</h1>`;
  const cooked = area().cooked || {}, n = P.perServing(r);
  return `<a class="back" href="#/food/recipes">Recipes</a><h1 class="page-title">${esc(r.name)}</h1>
  <p class="muted"><span class="tag">${esc(TAG[r.tag] || r.tag)}</span>${r.hiddenVeg ? '<span class="tag">Hidden veg</span>' : ''}${r.portions ? `<span class="tag">Makes ${r.portions} boxes</span>` : ''}</p>
  <p class="num">${n.k} kcal · ${n.p} g protein · about ${rs(P.recipeCost(r))} per ${r.portions ? 'box' : 'serving'} · ${r.active} min active · ${r.total} min in all</p>
  <h2>You need</h2><ul class="rules">${r.ing.map(([k, q]) => `<li>${esc(ingText(k, q))}</li>`).join('')}${basicsText(r) ? `<li class="muted">${esc(basicsText(r))}</li>` : ''}</ul>
  <h2>Steps</h2><ol class="food-steps">${r.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
  ${r.batch ? `<p class="note calm">${esc(r.batch)}</p>` : ''}${r.note ? `<p class="note calm">${esc(r.note)}</p>` : ''}
  <div class="row"><a class="btn" target="_blank" rel="noopener" href="${youtube(r.name)}">Watch how</a>
  <button type="button" class="btn" data-act="food-cooked" data-id="${esc(r.id)}">${cooked[r.id] ? 'Cooked ' + esc(dayLabel(cooked[r.id])) + ' · mark again' : 'Mark as cooked'}</button></div>`;
}

// ---------- skills ----------
function skillsView(ctx) {
  const cooked = area().cooked || {}, mon = mondayOf(ctx.rd), start = mondayOf(P.EPOCH), weeks = [];
  for (let m = start; m <= mon; m = addDays(m, 7)) weeks.push(m);
  const inWeek = m => P.allRecipes().filter(r => cooked[r.id] && cooked[r.id] >= m && cooked[r.id] <= addDays(m, 6));
  const never = P.allRecipes().filter(r => !cooked[r.id]), thisWeekDishes = (() => { const out = []; for (let i = 0; i < 7; i++) { const p = prepFor(addDays(mon, i), ctx.s); if (p) out.push(...p.cook.map(c => c.id)); } return out; })();
  const sug = never.find(r => thisWeekDishes.includes(r.id)) || never.find(r => r.extra) || never[0];
  const group = (title, list) => `<h2>${title}</h2><ul class="list">${list.map(r => `<li class="item"><a class="food-rlink grow" href="#/food/recipe/${esc(r.id)}"><b>${esc(r.name)}</b><span class="muted">${cooked[r.id] ? 'Cooked ' + esc(dayLabel(cooked[r.id])) : 'Not cooked yet'}</span></a>
    <button type="button" class="add" data-act="food-cooked" data-id="${esc(r.id)}" aria-label="Mark ${esc(r.name)} as cooked">${cooked[r.id] ? 'Again' : 'Cooked'}</button></li>`).join('')}</ul>`;
  return `<h1 class="page-title">Cooking skills</h1>${nav('skills')}
  <p class="muted">One new recipe a week. ${Object.keys(cooked).length} of ${P.allRecipes().length} cooked so far.</p>
  ${sug ? `<p class="note">This week's new recipe: <a href="#/food/recipe/${esc(sug.id)}">${esc(sug.name)}</a>${sug.extra ? ' (a proper cook for an off day)' : ''}.</p>` : '<p class="note calm">Every recipe has been cooked at least once.</p>'}
  <h2>Weekly checklist</h2><ul class="list">${weeks.reverse().map(m => { const l = inWeek(m); return `<li class="item"><span class="check" data-done="${l.length > 0}">${esc(dayLabel(m))}: ${l.length ? esc(l.map(r => r.name).join(', ')) : 'nothing cooked yet'}</span></li>`; }).join('')}</ul>
  ${group('Batch cook', P.batchRecipes())}${group('Quick meals', P.quickRecipes())}`;
}

// ---------- module ----------
export default {
  name: 'food',
  init: loadData,
  view(ctx, arg = '') {
      const [head, rest = ''] = String(arg).split(/\/(.*)/s);
    switch (head) {
      case 'week': return weekView(ctx, rest);
      case 'prep': return prepView(ctx, rest);
      case 'shop': return shopView(ctx, rest);
      case 'recipes': return recipesView();
      case 'recipe': return recipeView(rest);
      case 'skills': return skillsView(ctx);
      default: return todayView(ctx);
    }
  },
  click(act, el, ctx) {
    const rd = ctx.rd;
    if (act === 'food-log') {
      const slot = el.dataset.slot, m = mealsFor(rd, ctx.s)[slot]; if (!m) return false;
      logEntry(rd, { n: m.name, k: m.k, p: m.p, meal: slot, t: null, src: m.recipe ? 'r:' + m.recipe : null, qty: 1 }, ctx.min);
      ctx.notify('Logged ' + P.SLOT_NAME[slot]); return true;
    }
    if (act === 'food-add') {
      const key = el.dataset.key, slot = el.dataset.slot;
      if (key.startsWith('r:')) { const r = P.findRecipe(key.slice(2)); if (!r) return false; const n = P.perServing(r); logEntry(rd, { n: r.name, k: n.k, p: n.p, meal: slot, src: key, qty: 1 }, ctx.min); }
      else { const pt = P.portions().find(x => x.id === key); if (!pt) return false; const n = P.portionNutrition(pt); logEntry(rd, { n: pt.label, k: n.k, p: n.p, meal: slot, src: key, qty: 1 }, ctx.min); }
      ctx.notify('Added'); return true;
    }
    if (act === 'food-custom') {
      const v = id => document.getElementById(id)?.value ?? '', n = v('fc-n').trim() || 'Custom food';
      const k = parseFloat(v('fc-k').replace(',', '.')) || 0, p = parseFloat(v('fc-p').replace(',', '.')) || 0;
      if (!k && !p) { ctx.notify('Enter kcal or protein first'); return false; }
      logEntry(rd, { n, k, p, meal: el.dataset.slot, qty: 1 }, ctx.min); ctx.notify('Added'); return true;
    }
    if (act === 'food-del') { removeEntry(rd, +el.dataset.i); return true; }
    if (act === 'food-tick') { const on = el.getAttribute('aria-pressed') !== 'true'; tick(el.dataset.bucket, el.dataset.scope, el.dataset.key, on); return true; }
    if (act === 'food-cooked') { markCooked(el.dataset.id, el.dataset.iso || rd); ctx.notify('Marked as cooked'); return true; }
    return false;
  },
  change(act, el) {
    if (act === 'food-swap') { setSwap(el.dataset.iso, el.dataset.slot, el.value); return true; }
    if (act === 'food-slot') { ui.slot = el.value; return true; }
    if (act === 'food-whey') { setSetting('whey', !!el.checked); return true; }
    return false;
  },
};
