import { getSettings, getLog, setLog, setSetting } from './storage.js';
let RECIPES = [];
export const loadFoodData = () => fetch('data/recipes.json').then(r => r.json()).then(d => { RECIPES = d; }).catch(() => {});
const QUICK = [['Egg', 80, 6], ['Chicken breast, 150 g', 250, 46], ['Rice, 1 cup cooked', 200, 4], ['Yoghurt, 200 g', 130, 14], ['Banana', 105, 1], ['Nuts, 30 g', 180, 6], ['Tuna, 100 g', 110, 25], ['Bread slice', 80, 3]];
const entries = iso => getLog(iso).food || [];
export function totals(iso) { return entries(iso).reduce((a, e) => ({ k: a.k + e.k, p: a.p + e.p }), { k: 0, p: 0 }); }
const btn = (label, n, k, p) => `<button type="button" class="add" data-act="food-add" data-n="${n}" data-k="${k}" data-p="${p}">${label}</button>`;

export function foodSummary(iso) {
  const s = getSettings(), t = totals(iso), f = Math.min(1, t.p / s.protein), kp = Math.min(100, Math.round(t.k / s.kcal * 100));
  return `<section><h2>Food today</h2><div class="ringrow"><svg viewBox="0 0 72 72" width="72" height="72" role="img" aria-label="Protein ${t.p} of ${s.protein} grams"><circle cx="36" cy="36" r="30" fill="none" stroke="#1b2029" stroke-width="8"/><circle cx="36" cy="36" r="30" fill="none" stroke="#f0a53a" stroke-width="8" stroke-dasharray="${(188.5 * f).toFixed(1)} 188.5" transform="rotate(-90 36 36)"/></svg>
  <div><b>${t.p} / ${s.protein} g protein</b><br>${t.k} / ${s.kcal} kcal<div class="bar" role="progressbar" aria-label="Calories" aria-valuenow="${kp}" aria-valuemin="0" aria-valuemax="100"><b style="width:${kp}%"></b></div></div></div></section>`;
}

export function foodView(rd) {
  const s = getSettings(), list = entries(rd);
  const log = list.length ? list.map((e, i) => `<li class="item"><span class="check">${e.n} · ${e.k} kcal · ${e.p} g</span><button type="button" class="add" data-act="food-del" data-i="${i}" aria-label="Remove ${e.n}">Remove</button></li>`).join('') : '<li class="note">Nothing logged yet. Tap a food below or open a recipe.</li>';
  const rec = RECIPES.map(r => `<details class="ex"><summary>${r.name} · ${r.protein} g protein · ${r.kcal} kcal</summary>
    <p>${r.tag === 'pack-for-work' ? 'Pack for work' : 'Eat at home'} · ${r.time} min · makes ${r.servings}${r.hidden ? ' · Hidden veg' : ''}</p>
    <p><b>Ingredients</b></p><ul>${r.ing.map(i => `<li>${i[0]}: ${i[1]}</li>`).join('')}</ul>
    <p><b>Steps</b></p><ol>${r.steps.map(x => `<li>${x}</li>`).join('')}</ol><p><b>Batch it.</b> ${r.batch}</p>
    ${btn('Add 1 serving', r.name, r.kcal, r.protein)} <a class="add link" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent('how to make ' + r.name)}">Watch how</a></details>`).join('');
  return `<h1 class="plain">Food</h1>${foodSummary(rd)}
  <section><h2>Logged today</h2><ul class="list">${log}</ul></section>
  <section><h2>Quick add</h2><div class="chips">${QUICK.map(q => btn(q[0], q[0], q[1], q[2])).join('')}${s.whey ? btn('Whey scoop (25 g protein)', 'Whey scoop', 120, 25) : ''}</div>
  ${s.whey ? '<p class="streaks">Start with half a scoop.</p>' : ''}
  <div class="set"><input id="fn" aria-label="Food name" placeholder="Food"><input id="fk" type="number" inputmode="numeric" aria-label="Calories" placeholder="kcal"><input id="fp" type="number" inputmode="numeric" aria-label="Protein in grams" placeholder="g protein"></div>
  <button type="button" class="add wide" data-act="food-custom">Add custom food</button>
  <button type="button" class="add wide" data-act="food-whey">Whey powder: ${s.whey ? 'on' : 'off'}</button></section>
  <section><h2>Recipes</h2>${rec || '<p class="note">Recipes did not load. Reload the page.</p>'}</section>`;
}

export function foodClick(act, el, rd) {
  if (!act.startsWith('food-')) return false;
  const l = entries(rd);
  if (act === 'food-add') setLog(rd, { food: [...l, { n: el.dataset.n, k: +el.dataset.k, p: +el.dataset.p }] });
  if (act === 'food-del') setLog(rd, { food: l.filter((_, i) => i !== +el.dataset.i) });
  if (act === 'food-whey') setSetting('whey', !getSettings().whey);
  if (act === 'food-custom') {
    const n = document.getElementById('fn').value.trim() || 'Custom food', k = +document.getElementById('fk').value || 0, p = +document.getElementById('fp').value || 0;
    if (k || p) setLog(rd, { food: [...l, { n, k, p }] });
  }
  return true;
}
