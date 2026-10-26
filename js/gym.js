import { getDay, dayNum, isoOf } from './schedule.js';
import { getSettings, getLog, setLog, allLogs, ver } from './storage.js';
let DATA = null;
export const loadGymData = () => fetch('data/exercises.json').then(r => r.json()).then(d => { DATA = d; }).catch(() => {});
const todayN = () => Math.floor((Date.now() + 4 * 3600e3) / 864e5); // Mauritius calendar day
const phaseOf = w => w <= 4 ? 1 : w <= 8 ? 2 : 3;
const isLight = w => w >= 9 && (w - 9) % 8 === 0;
const done = iso => !!getLog(iso).gym?.done;
const KINDS3 = ['Upper', 'Lower', 'Push', 'Pull', 'Legs'];
let cache = { key: '', list: [] };

export function planAll(s) {
  const key = ver() + '|' + s.gym.start + '|' + s.anchor + '|' + Object.keys(s.overrides).length;
  if (cache.key === key) return cache.list;
  const start = dayNum(s.gym.start), out = [], tn = todayN();
  const has = n => out.some(x => x.n === n);
  for (let n = start, idx = 0; n <= start + 400; n++) {
    const iso = isoOf(n), w = Math.floor((n - start) / 7) + 1, ph = phaseOf(w), day = getDay(iso, s);
    const p3ok = out.filter(x => x.n >= n - 14 && x.n < tn && !done(x.iso)).length === 0;
    const target = ph === 1 ? 3 : ph === 2 ? 4 : p3ok ? 5 : 4;
    if (out.filter(x => x.n > n - 7).length >= target) continue;
    let run = 0; while (run < 3 && has(n - 1 - run)) run++;
    if (run >= 2) continue;
    const work = day.type === 'work';
    if (work && (ph < 2 || out.some(x => x.n > n - 7 && getDay(x.iso, s).type === 'work'))) continue;
    const kind = ph === 1 ? (idx % 2 ? 'Full Body B' : 'Full Body A') : ph === 2 ? (idx % 2 ? 'Lower' : 'Upper') : KINDS3[idx % 5];
    const night = day.block === 'night';
    out.push({ iso, n, idx, kind, week: w, phase: ph, light: isLight(w),
      loc: night || !work ? 'home' : 'work',
      time: work ? (night ? '15:30–16:30' : '19:10–19:55') : (night ? '18:00–19:15' : '17:00–18:15'),
      cardio: idx % 4 !== 3 ? (w <= 2 ? 10 : Math.min(30, 10 + 5 * (w - 2))) : 0 });
    idx++;
  }
  cache = { key, list: out };
  return out;
}
export const sessionFor = (iso, s) => planAll(s).find(x => x.iso === iso);

function lastSets(id, before, n = 2) {
  return Object.entries(allLogs()).filter(([d, l]) => d < before && l.gym?.sets?.[id]).sort((a, b) => b[0].localeCompare(a[0])).slice(0, n).map(x => x[1].gym.sets[id]);
}
const num = v => (v === '' || v == null ? null : +v);
let sel = null;

export function gymView(rd) {
  const s = getSettings(), list = planAll(s);
  if (!DATA) return '<p class="note">Exercise data did not load. Check your connection and reload.</p>';
  const start = dayNum(s.gym.start), rn = dayNum(rd);
  const head = rn < start ? `<p class="note">Your gym plan starts ${s.gym.start}. Until then, rest and keep your checklist going.</p>` : '';
  const upcoming = list.filter(x => x.iso >= rd);
  const cur = list.find(x => x.iso === sel) || upcoming[0];
  const w = Math.max(1, Math.floor((rn - start) / 7) + 1);
  return `<h1 class="plain">Gym</h1><p class="streaks">Week ${w} · Phase ${phaseOf(w)}${isLight(w) ? ' · Light week' : ''}</p>${head}
  ${cur ? session(cur, s) : '<p class="note">No sessions planned yet.</p>'}
  <section><h2>Coming up</h2><ul class="list">${upcoming.slice(0, 6).map(x => `<li class="item"><button type="button" class="check" data-act="gym-view" data-iso="${x.iso}">${x.iso.slice(5)} · ${x.kind} · ${x.loc} gym</button></li>`).join('')}</ul></section>`;
}

function session(x, s) {
  const eq = s.equipment[x.loc], sets = x.week === 1 || x.light ? 2 : 3;
  const g = getLog(x.iso).gym || {};
  const machine = ['treadmill', 'bike', 'rower'].find(m => eq.includes(m));
  const ex = DATA.templates[x.kind].map(id => {
    const e = DATA.exercises[id], ok = e.needs.every(k => eq.includes(k)), name = ok ? e.name : e.alt;
    const last = lastSets(id, x.iso), l0 = last[0];
    const tip = l0 && l0.every(z => z.r >= 12) ? 'Last time you hit the top of the range: try +2.5 kg (or +1 rep).'
      : last.length === 2 && last.every(a => a.some(z => z.r < 8)) ? 'You missed reps twice: hold this weight.' : '';
    const rows = Array.from({ length: sets }, (_, i) => `<div class="set"><span>Set ${i + 1}</span>
      <input type="number" inputmode="decimal" aria-label="${name} set ${i + 1} weight in kg" data-ex="${id}" data-set="${i}" data-f="w" placeholder="kg${l0?.[i] ? ' · ' + l0[i].w : ''}" value="${g.sets?.[id]?.[i]?.w ?? ''}">
      <input type="number" inputmode="numeric" aria-label="${name} set ${i + 1} reps" data-ex="${id}" data-set="${i}" data-f="r" placeholder="reps${l0?.[i] ? ' · ' + l0[i].r : ''}" value="${g.sets?.[id]?.[i]?.r ?? ''}"></div>`).join('');
    return `<details class="ex"><summary>${name} · ${sets} × ${e.reps || '8–12'}</summary>
      <p><b>Setup.</b> ${e.setup}</p><p><b>Move.</b> ${e.move}</p><p><b>Breathing.</b> ${e.breathe}</p><p><b>Common mistake.</b> ${e.mistake}</p><p><b>Cue.</b> ${e.cue}</p>
      <a class="add link" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' form')}">Watch form video</a></details>${tip ? `<p class="streaks">${tip}</p>` : ''}${rows}`;
  }).join('');
  return `<section class="sess"><h2>${x.kind} · ${x.iso}</h2><p>${x.loc === 'home' ? 'Home' : 'Work'} gym · ${x.time}${x.light ? ' · Light week: 2 sets at about 80% of your last weights' : ''}</p>
  <p class="streaks">Eat a meal 1–2 hours before and drink about 500 ml of water during. Rest ${x.week === 1 ? '90 s' : '60–90 s'} between sets. Start light (effort 6–7 out of 10).</p>
  <p><b>Warm-up, 5 min.</b> Easy march or walk, arm circles, 10 bodyweight squats.</p>${ex}
  ${x.cardio ? `<p><b>Easy cardio, ${x.cardio} min.</b> ${machine ? 'Use the ' + machine + '.' : 'Brisk outdoor walk.'} Keep a pace where you can still speak in full sentences.</p>` : ''}
  <p class="note">Stop if you feel chest pain, dizziness or can't catch your breath. See a doctor before continuing.</p>
  ${g.done ? '<p><b>Session done.</b></p>' : `<button type="button" class="add wide" data-act="gym-finish" data-iso="${x.iso}">Finish session</button>`}</section>`;
}

export function gymClick(act, el) {
  if (act === 'gym-view') { sel = el.dataset.iso; return true; }
  if (act === 'gym-finish') { if (confirm('Mark this session as done?')) setLog(el.dataset.iso, { gym: { ...getLog(el.dataset.iso).gym, done: true } }); return true; }
  return false;
}
export function gymInput(t) {
  if (!t.dataset?.ex) return;
  const iso = (sel || document.querySelector('.sess h2')?.textContent.split(' · ')[1]), g = getLog(iso).gym || {}, i = +t.dataset.set;
  const arr = [...(g.sets?.[t.dataset.ex] || [])]; arr[i] = { ...(arr[i] || { w: null, r: null }), [t.dataset.f]: num(t.value) };
  setLog(iso, { gym: { ...g, sets: { ...g.sets, [t.dataset.ex]: arr } } });
}
