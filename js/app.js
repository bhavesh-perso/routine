// App shell: builds the context, routes, dispatches taps to modules, shows banners.
import { getSettings, setErrorHandler, runMigrations, askPersist } from './storage.js';
import { routineDayAt, setProviders } from './plan.js';
import { nowLocal, esc, addDays } from './util.js';
import { startRouter } from './router.js';
import { initPwa } from './pwa.js';
import { tell } from './sheet.js';
import { chrome } from './shell.js';
import today, { waterTarget, fab } from './today.js';
import week from './week.js';
import gym, * as G from './gym.js';
import food from './food.js';
import study, * as St from './study.js';
import progress from './progress.js';
import settings from './settings.js';

export const APP_VERSION = '2026-10-27';
const MODS = { today, week, gym, food, study, progress, settings };
const PREFIX = { today: today, week: week, gym, food, study, prog: progress, set: settings };
const main = document.getElementById('main'), fabBox = document.getElementById('fab');
const tabs = [...document.querySelectorAll('nav.tabs a')];
const state = { route: { name: 'today', arg: '' }, error: '', update: null, toast: '' };

setProviders({ gymFor: (iso, s) => G.sessionFor(iso, s), runFor: (iso, s) => G.runFor(iso, s) });

function ctx() {
  const s = getSettings(), { iso, min, ms } = nowLocal();
  return {
    s, iso, min, ms, rd: routineDayAt(iso, min, s),
    go: h => { location.hash = h; },
    rerender: () => render(),
    notify,
    waterTarget: iso => waterTarget(iso, s),
    gymPlanned: mon => { try { return G.planAll(s).filter(x => x.iso >= mon && x.iso <= addDays(mon, 6)).length; } catch { return null; } },
    studyPlanned: mon => { try { const w = St.weekStudy(mon, s); return { aws: w.aws.plan, mandarin: w.mandarin.plan }; } catch { return null; } },
  };
}

function bannerHtml() {
  let h = '';
  if (state.error) h += `<div class="note alert" role="alert"><b>Couldn't save.</b> ${esc(state.error)} <button type="button" class="btn small ghost" data-act="app-dismiss">Dismiss</button></div>`;
  if (state.update) h += `<div class="note" role="status">Update available. <button type="button" class="btn small primary" data-act="app-update">Reload</button></div>`;
  return h;
}

function render(changed = false) {
  const r = state.route, name = r.name === 'day' ? 'week' : r.name, mod = MODS[name] || today;
  const arg = r.name === 'day' ? 'day/' + r.arg : r.arg, c = ctx();
  let html;
  try { html = mod.view(c, arg); }
  catch (e) { html = `<h1 class="page-title">Something went wrong</h1><p class="note alert">${esc(e.message)}</p><p><a href="#/today">Back to Today</a></p>`; console.error(e); }
  const showFab = !(r.name === 'gym' && /^session/.test(r.arg));
  main.innerHTML = bannerHtml() + html;
  fabBox.innerHTML = showFab ? fab() : '';
  const tab = name === 'study' ? 'today' : name;
  tabs.forEach(a => a.toggleAttribute('aria-current', a.dataset.tab === tab));
  chrome(r, changed);
  if (changed) {
    scrollTo(0, 0);
    const h1 = main.querySelector('h1'); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    document.title = (h1?.textContent?.trim() || 'Routine') + ' · Routine';
  }
  try { mod.mounted?.(c); } catch (e) { console.error(e); }
}

function notify(msg) {
  const t = document.getElementById('toast'); if (!t) return;
  t.textContent = msg; t.hidden = false;
  clearTimeout(notify.t); notify.t = setTimeout(() => { t.hidden = true; }, 2200);
}

async function dispatch(kind, e) {
  const el = e.target.closest?.('[data-act]'); if (!el || !(main.contains(el) || fabBox.contains(el))) return;
  if (kind === 'click' && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return; // inputs report through 'change'
  const act = el.dataset.act;
  if (kind === 'click' && act === 'app-dismiss') { state.error = ''; return render(); }
  if (kind === 'click' && act === 'app-update') { state.update?.(); return; }
  const mod = PREFIX[act.split('-')[0]]; if (!mod) return;
  const fn = kind === 'click' ? mod.click : mod.change; if (!fn) return;
  try {
    const out = await fn.call(mod, act, el, ctx());
    if (out) render();
  } catch (err) { console.error(err); tell(err.message, { title: 'That did not work' }); }
}
for (const box of [main, fabBox]) {
  box.addEventListener('click', e => dispatch('click', e));
  box.addEventListener('change', e => dispatch('change', e));
}

const typing = () => /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
setInterval(() => { if (state.route.name === 'today' && !typing()) render(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !typing()) render(); });

async function boot() {
  setErrorHandler(msg => { state.error = msg; if (main) render(); });
  runMigrations(nowLocal().iso);
  askPersist();
  await Promise.allSettled(Object.values(MODS).map(m => m.init?.()));
  startRouter((r, changed) => { state.route = r; render(changed); });
  initPwa({ onUpdate: apply => { state.update = apply; render(); } });
}
boot();
