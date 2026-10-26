// Active gym session: guided one-set-at-a-time logging, list view, rest timer, wake lock,
// rest-end sound, finish and summary. Every tap saves gym.active + sessions[id].
import * as G from './gym.js';
import { esc, dayLabel, fmt, nowLocal } from './util.js';
import { ask } from './sheet.js';

const fin = v => typeof v === 'number' && Number.isFinite(v);
const ui = { mode: 'guided', rpe: null, flash: '', swapFor: null, edit: null, feel: null };
let audio = null, beepedFor = null, wakeLock = null, tick = null, visHooked = false;

// ---------- pure helpers (tested) ----------
export function sessionTotals(x) {
  let sets = 0, v = 0;
  for (const e of x?.ex || []) for (const st of e.sets || []) if (st && st.type !== 'warm' && st.done) {
    sets++; if (fin(st.done.w) && st.done.w > 0) v += st.done.w * G.totalReps(st.done);
  }
  const min = fin(x?.startedAt) && fin(x?.endedAt) && x.startedAt > 1e9 ? Math.max(1, Math.round((x.endedAt - x.startedAt) / 60000)) : 0;
  return { sets, kg: Math.round(v * 10) / 10, min };
}
// Next set to do in guided mode: first set not done and not skipped. null when all are through.
export function nextSet(x) {
  for (let ei = 0; ei < (x?.ex || []).length; ei++) {
    const sets = x.ex[ei].sets || [];
    for (let si = 0; si < sets.length; si++) if (!sets[si].done && !sets[si].skip) return { ei, si };
  }
  return null;
}
// Target for a set: the plan, overridden by the last working set already logged for this exercise
// in this session (prefill, addendum A3). Warm-up sets keep their own plan.
export function targetFor(x, ei, si) {
  const e = x.ex[ei], st = e.sets[si], p = { ...(st.plan || {}) };
  if (st.type === 'warm') return p;
  for (let k = si - 1; k >= 0; k--) {
    const d = e.sets[k].done;
    if (e.sets[k].type === 'work' && d) {
      if (fin(d.w)) p.w = d.w;
      if (fin(d.r)) p.r = d.r; else if (fin(d.rl) || fin(d.rr)) p.r = Math.max(d.rl || 0, d.rr || 0);
      if (fin(d.sec)) p.sec = d.sec;
      break;
    }
  }
  return p;
}
// New records set in a finished or running session, compared with earlier sessions only.
export function newPRs(x) {
  const before = G.doneSessions().filter(o => o.id !== x.id && (o.rd < x.rd || (o.rd === x.rd && (o.startedAt || 0) < (x.startedAt || 0))));
  const run = G.prsFrom(before), out = [], hadBefore = new Set(Object.keys(run));
  for (const e of x.ex || []) for (const st of e.sets || []) {
    if (!st || st.type === 'warm' || !st.done) continue;
    // Nothing is flagged the first time an exercise is logged (same rule as logSet), so the sets
    // of that first session only build the baseline.
    const what = hadBefore.has(e.id) ? G.checkPR(run[e.id], st.done) : [];
    if (what.length) out.push({ id: e.id, what, d: st.done });
    const one = G.prsFrom([{ rd: x.rd, ex: [{ id: e.id, sets: [st] }] }])[e.id];
    run[e.id] = mergePR(run[e.id], one);
  }
  return out;
}
function mergePR(a, b) {
  if (!a) return b; if (!b) return a;
  const pick = (p, q, f) => !p ? q : !q ? p : f(q) > f(p) ? q : p;
  const repsAt = { ...a.repsAt };
  for (const [w, v] of Object.entries(b.repsAt)) if (!repsAt[w] || v.r > repsAt[w].r) repsAt[w] = v;
  return { heaviest: pick(a.heaviest, b.heaviest, h => h.w * 1000 + h.r), e1rm: pick(a.e1rm, b.e1rm, h => h.v), repsAt,
    bwReps: pick(a.bwReps, b.bwReps, h => h.r), hold: pick(a.hold, b.hold, h => h.sec) };
}

// ---------- writes ----------
export function startSession(iso, s, ms, rd, short = false) {
  const slot = G.sessionFor(iso, s); if (!slot) return null;
  const p = G.planFor(slot, s), g = G.gymData();
  let id = 's-' + iso, k = 2; while (g.sessions?.[id]) id = `s-${iso}-${k++}`;
  const x = { id, rd, planIso: iso, kind: slot.kind, loc: slot.loc, light: !!slot.light, short: !!short, startedAt: ms, endedAt: null, feel: null, notes: '', ex: short ? p.shortEx : p.ex };
  G.saveGym(gd => { gd.sessions[id] = x; gd.active = id; gd.rest = null; }, true);
  return id;
}
// Logs one set. values: { w?, r?, rl?, rr?, sec?, rpe? }. Returns the PR labels it beat.
export function logSet(ei, si, values, ms = Date.now()) {
  const x = G.activeSession(); if (!x) return [];
  const e = x.ex[ei], st = e?.sets?.[si]; if (!st) return [];
  const clean = {}; for (const k of ['w', 'r', 'rl', 'rr', 'sec', 'rpe']) if (fin(values[k])) clean[k] = values[k];
  let prs = [];
  if (st.type === 'work' && !st.done) {
    const hist = G.prs()[e.id];
    if (hist) {
      const cur = G.prsFrom([{ rd: x.rd, ex: [{ id: e.id, sets: e.sets.filter(o => o.done && o.type === 'work') }] }])[e.id];
      prs = G.checkPR(mergePR(hist, cur), clean);
    }
  }
  G.saveGym(g => {
    const t = g.sessions[x.id].ex[ei].sets[si];
    t.done = { ...clean, at: ms }; delete t.skip;
    const more = nextSet(g.sessions[x.id]);
    g.rest = more ? { startedAt: ms, sec: t.plan?.rest || 60 } : null;
  });
  return prs;
}
export function finishSession(ms, feel, notes) {
  const x = G.activeSession(); if (!x) return null;
  G.saveGym(g => { const t = g.sessions[x.id]; t.endedAt = ms; t.feel = feel || null; t.notes = String(notes || '').slice(0, 2000); g.active = null; g.rest = null; }, true);
  return x.id;
}
// Swap the remaining sets of an exercise to an alternative. Done sets stay with the original.
export function swapExercise(ei, to, s) {
  const x = G.activeSession(); if (!x || !G.EX(to)) return;
  G.saveGym(g => {
    const list = g.sessions[x.id].ex, e = list[ei], orig = e.from || e.id;
    const sg = G.suggest(to, x.loc, s), ex = G.EX(to);
    const remake = st => {
      const plan = { rest: st.plan?.rest || 60 };
      if (ex.unit === 'time') plan.sec = sg.sec || ex.range[0];
      else { plan.r = sg.r || ex.range[0]; if (ex.unit === 'kg') plan.w = sg.w ?? null; }
      return { type: 'work', plan, done: null };
    };
    const todo = e.sets.filter(st => !st.done && st.type === 'work').map(remake);
    const repl = { id: to, ...(to !== orig ? { from: orig } : {}), sets: todo };
    if (e.sets.some(st => st.done)) { e.sets = e.sets.filter(st => st.done); list.splice(ei + 1, 0, repl); }
    else list[ei] = repl;
  });
}

// ---------- sound and wake lock ----------
function unlockAudio() {
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!audio && AC) audio = new AC();
    if (audio?.state === 'suspended') audio.resume();
  } catch { audio = null; }
}
function beep() {
  try {
    if (!audio) return;
    const t = audio.currentTime;
    for (const k of [0, 0.25]) {
      const o = audio.createOscillator(), gn = audio.createGain();
      o.frequency.value = 880; gn.gain.setValueAtTime(0.0001, t + k); gn.gain.exponentialRampToValueAtTime(0.3, t + k + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, t + k + 0.18);
      o.connect(gn).connect(audio.destination); o.start(t + k); o.stop(t + k + 0.2);
    }
  } catch { /* no sound */ }
}
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock?.request && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) { const w = wakeLock; wakeLock = null; await w.release(); }
  } catch { wakeLock = null; }
}

// Runs after every render of a gym page. Only touches DOM nodes; never ticks in the background.
export function mounted(ctx) {
  const onSession = !!document.getElementById('gym-session') && !!G.activeSession();
  keepAwake(onSession);
  if (!visHooked) {
    visHooked = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.getElementById('gym-session') && G.activeSession()) keepAwake(true); });
  }
  clearInterval(tick); tick = null;
  const node = document.getElementById('gym-rest');
  if (!node) return;
  const update = () => {
    if (!node.isConnected) { clearInterval(tick); tick = null; return; }
    const rest = G.gymData().rest, left = G.restLeft(rest);
    node.querySelector('.gym-clock').textContent = clock(left);
    if (left === 0) {
      node.classList.add('over');
      node.querySelector('.gym-rest-msg').textContent = 'Rest over. Next set when you\'re ready.';
      if (rest && beepedFor !== rest.startedAt && Date.now() - (rest.startedAt + rest.sec * 1000) < 3000 && ctx.s.restSound) beep();
      if (rest) beepedFor = rest.startedAt;
      clearInterval(tick); tick = null;
    }
  };
  update();
  if (G.restLeft(G.gymData().rest) > 0) tick = setInterval(update, 1000);
}
const clock = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

// ---------- view pieces ----------
function lastBest(id, si, typeIdx) {
  const ex = G.EX(id) || {}, h = G.historyFor(id).at(-1), pr = G.prs()[id];
  const last = h?.sets?.filter(st => st.type !== 'warm')[typeIdx]?.done;
  let best = '';
  if (pr?.heaviest) best = `${G.kg(pr.heaviest.w)} kg × ${pr.heaviest.r}`;
  else if (ex.unit === 'time' && pr?.hold) best = `${pr.hold.sec} s`;
  else if (pr?.bwReps) best = `${pr.bwReps.r} reps`;
  return `<span class="gym-lb muted num">Last: ${last ? esc(G.fmtDone(last, id)) : '–'} · Best: ${best ? esc(best) : '–'}</span>`;
}
function inputs(id, t, suffix, done = null) {
  const ex = G.EX(id) || {}, v = k => esc(done?.[k] ?? t[k] ?? '');
  const f = (k, label, mode, attrs = '') => `<label class="field gym-in"><span>${label}</span><input id="gym-in-${k}-${suffix}" type="text" inputmode="${mode}" autocomplete="off" value="${v(k)}" ${attrs}></label>`;
  const parts = [];
  if (ex.unit === 'kg') parts.push(f('w', G.usesDumbbells(id) ? 'kg per dumbbell' : 'kg', 'decimal'));
  if (ex.unit === 'time') parts.push(f('sec', 'Seconds', 'numeric'));
  else if (ex.oneSided) { const dv = done ? done : { rl: t.r, rr: t.r }; parts.push(`<label class="field gym-in"><span>Left reps</span><input id="gym-in-rl-${suffix}" type="text" inputmode="numeric" value="${esc(dv.rl ?? '')}"></label>`, `<label class="field gym-in"><span>Right reps</span><input id="gym-in-rr-${suffix}" type="text" inputmode="numeric" value="${esc(dv.rr ?? '')}"></label>`); }
  else parts.push(f('r', ex.perSide ? 'Reps per side' : 'Reps', 'numeric'));
  return `<div class="row gym-inputs">${parts.join('')}</div>`;
}
const rpeChips = sel => `<div class="chips gym-rpe" role="group" aria-label="Effort, optional">${[6, 7, 8, 9, 10].map(n => `<button type="button" class="btn small" data-act="gym-rpe" data-v="${n}" aria-pressed="${sel === n}">${n}</button>`).join('')}</div>`;

function restBlock() {
  const rest = G.gymData().rest, left = G.restLeft(rest);
  if (!rest) return '';
  return `<div id="gym-rest" class="gym-rest${left === 0 ? ' over' : ''}" role="timer" aria-live="off">
    <p class="gym-clock num" aria-hidden="false">${clock(left)}</p><p class="gym-rest-msg muted">${left ? `Rest. Started ${fmt(nowLocal(rest.startedAt).min)}, ${rest.sec} s.` : "Rest over. Next set when you're ready."}</p>
    <div class="row"><button type="button" class="btn small" data-act="gym-rest-add">+30 s</button><button type="button" class="btn small ghost" data-act="gym-rest-skip">${left ? 'Skip rest' : 'Hide'}</button></div></div>`;
}
const setLabel = (e, si) => {
  const st = e.sets[si], wu = e.sets.filter(o => o.type === 'warm').length;
  return st.type === 'warm' ? `Warm-up set ${si + 1} of ${wu}` : `Set ${si - wu + 1} of ${e.sets.length - wu}`;
};
const workIdx = (e, si) => si - e.sets.filter((o, k) => k < si && o.type === 'warm').length;

function guided(x, s) {
  const pos = nextSet(x);
  if (!pos) return finishBlock(x, s);
  const { ei, si } = pos, e = x.ex[ei], st = e.sets[si], t = targetFor(x, ei, si), ex = G.EX(e.id) || {};
  const after = (() => { const c = structuredCloneSafe(x); c.ex[ei].sets[si].done = {}; return nextSet(c); })();
  const upNext = !after ? (G.sessionFor(x.planIso, s)?.cardio && !x.short ? 'Cardio, then finish' : 'Finish the session')
    : after.ei === ei ? `${setLabel(e, after.si)} · ${G.fmtPlan(targetFor(x, after.ei, after.si), e.id)}` : `${G.exerciseName(x.ex[after.ei].id)}`;
  const alts = (G.EX(e.from || e.id)?.alts || []).concat(e.from ? [e.from] : []).filter(a => a !== e.id && G.EX(a));
  return `<section class="gym-guided" aria-labelledby="gs-ex">
  <p class="muted">${esc(setLabel(e, si))}${st.type === 'warm' ? ' · warm-up, doesn\'t count to volume or records' : ''}</p>
  <h2 id="gs-ex" class="gym-exname"><a href="#/gym/ex/${esc(e.id)}">${esc(G.exerciseName(e.id))}</a></h2>
  ${e.from ? `<p class="muted">Instead of ${esc(G.exerciseName(e.from))}</p>` : ''}
  <p class="gym-target"><span class="muted">Target</span> <b class="num">${esc(G.fmtPlan(t, e.id))}</b></p>
  ${lastBest(e.id, si, workIdx(e, si))}
  ${ui.flash ? `<p class="note gym-pr" role="status">${esc(ui.flash)}</p>` : ''}
  <button type="button" class="btn primary wide" data-act="gym-done" data-ei="${ei}" data-si="${si}">Done as planned</button>
  <details class="fold gym-edit"><summary>Different numbers</summary>${inputs(e.id, t, 'g')}
  <button type="button" class="btn wide" data-act="gym-log" data-ei="${ei}" data-si="${si}" data-sfx="g">Log these numbers</button></details>
  ${st.type === 'work' ? `<p class="muted">How hard was it? Optional, 10 = nothing left.</p>${rpeChips(ui.rpe)}` : ''}
  <p class="gym-upnext"><span class="muted">Up next:</span> ${esc(upNext)}</p>
  <div class="row"><button type="button" class="btn small ghost" data-act="gym-skip-set" data-ei="${ei}" data-si="${si}">Skip this set</button>
  ${alts.length ? `<button type="button" class="btn small ghost" data-act="gym-swap-open" data-ei="${ei}" aria-expanded="${ui.swapFor === ei}">Swap exercise</button>` : ''}
  <a class="btn small ghost" target="_blank" rel="noopener" href="${esc(G.videoUrl(e.id))}">Watch form video</a></div>
  ${ui.swapFor === ei ? `<div class="chips" role="group" aria-label="Swap to">${alts.map(a => `<button type="button" class="btn small" data-act="gym-swap" data-ei="${ei}" data-to="${esc(a)}">${esc(G.exerciseName(a))}</button>`).join('')}</div>` : ''}
  <details class="fold"><summary>How to do it</summary>${G.howTo(e.id)}</details>
  ${ex.unit === 'kg' && G.usesDumbbells(e.id) ? '<p class="muted">Weights are per dumbbell.</p>' : ''}
  </section>`;
}
function structuredCloneSafe(x) { return JSON.parse(JSON.stringify(x)); }

function listView(x) {
  return `<ol class="rules gym-list">${x.ex.map((e, ei) => `<li><h3><a href="#/gym/ex/${esc(e.id)}">${esc(G.exerciseName(e.id))}</a></h3>${e.from ? `<p class="muted">Instead of ${esc(G.exerciseName(e.from))}</p>` : ''}
    <ul class="gym-sets">${e.sets.map((st, si) => {
      const key = `${ei}-${si}`, editing = ui.edit === key, t = targetFor(x, ei, si);
      const head = `<div class="row"><span class="grow">${esc(setLabel(e, si))}${st.type === 'warm' ? ' <span class="tag">warm-up</span>' : ''}</span><span class="muted num">${esc(G.fmtPlan(t, e.id))}</span></div>${st.type === 'work' ? lastBest(e.id, si, workIdx(e, si)) : ''}`;
      if (st.done && !editing) return `<li class="gym-set done">${head}<div class="row"><b class="grow num">${esc(G.fmtDone(st.done, e.id))}</b><button type="button" class="btn small ghost" data-act="gym-edit" data-k="${key}">Edit</button></div></li>`;
      if (st.skip && !editing) return `<li class="gym-set">${head}<div class="row"><span class="grow muted">Skipped</span><button type="button" class="btn small ghost" data-act="gym-edit" data-k="${key}">Log it</button></div></li>`;
      return `<li class="gym-set">${head}${inputs(e.id, t, key, st.done)}<div class="row"><button type="button" class="btn small primary" data-act="gym-log" data-ei="${ei}" data-si="${si}" data-sfx="${key}">${st.done ? 'Save' : 'Log set'}</button>${editing ? '<button type="button" class="btn small ghost" data-act="gym-edit" data-k="">Cancel</button>' : ''}</div></li>`;
    }).join('')}</ul></li>`).join('')}</ol>`;
}

function finishBlock(x, s) {
  const slot = G.sessionFor(x.planIso, s), cardio = slot?.cardio && !x.short ? slot.cardio : 0, t = sessionTotals(x);
  const feel = ui.feel ?? x.feel;
  return `<section class="gym-finish" aria-labelledby="gs-fin"><h2 id="gs-fin">${nextSet(x) ? 'Finish early' : 'Lifting done'}</h2>
  ${cardio ? `<p><b>Now:</b> ${esc(G.cardioText(cardio, slot.cardioWith))}</p>` : ''}
  <p class="muted num">${t.sets} working sets · ${t.kg} kg volume so far</p>
  <p>How did it feel?</p><div class="chips" role="group" aria-label="How did it feel">${['bad', 'ok', 'good'].map(f => `<button type="button" class="btn small" data-act="gym-feel" data-v="${f}" aria-pressed="${feel === f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
  <label class="field"><span>Notes (optional)</span><textarea id="gym-notes" rows="3">${esc(x.notes || '')}</textarea></label>
  <button type="button" class="btn primary wide" data-act="gym-finish">Finish session</button></section>`;
}

export function sessionView(ctx) {
  const s = ctx.s, x = G.activeSession();
  if (!x) {
    const today = G.sessionFor(ctx.rd, s);
    if (today && !today.done) return `<a class="back" href="#/gym">Gym</a><h1 class="page-title">${esc(today.kind)}</h1><p class="muted">${esc(dayLabel(ctx.rd))}</p>${G.preview(ctx, ctx.rd, true)}`;
    const nx = G.nextSession(ctx.rd, s, false);
    return `<a class="back" href="#/gym">Gym</a><h1 class="page-title">No session today</h1>
    <p>${today?.done ? "Today's session is done." : 'Today is a rest day.'}${nx ? ` Next: ${esc(nx.kind)} on ${esc(dayLabel(nx.iso))} at <span class="num">${nx.time}</span>.` : ''}</p><p><a class="btn" href="#/gym">Go to the gym overview</a></p>`;
  }
  const slot = G.sessionFor(x.planIso, s), n = x.ex.reduce((a, e) => a + e.sets.length, 0), d = x.ex.reduce((a, e) => a + e.sets.filter(st => st.done || st.skip).length, 0);
  const pct = n ? Math.round(d / n * 100) : 0;
  return `<div id="gym-session">
  <p class="muted">${esc(dayLabel(x.rd))} · ${G.locName(x.loc)} · started ${fmt(nowLocal(x.startedAt).min)}${x.light ? ' · light week' : ''}${x.short ? ' · shorter version' : ''}</p>
  <h1 class="page-title">${esc(x.kind || 'Session')}</h1>
  <div class="bar" role="progressbar" aria-label="Sets done" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><b style="width:${pct}%"></b></div>
  <p class="note alert gym-safety">${esc(G.SAFETY)}</p>
  ${d === 0 ? `<p class="note calm">${esc(G.PRE_GYM)}</p><p><b>Start with the warm-up.</b> ${esc(G.WARMUP)}</p>${slot?.week <= 2 ? '<p class="muted">First weeks: keep the effort around 6–7 out of 10. You should finish each set feeling you could do 3–4 more.</p>' : ''}` : ''}
  ${restBlock()}
  <div class="seg" role="group" aria-label="View"><button type="button" data-act="gym-mode" data-v="guided" aria-pressed="${ui.mode === 'guided'}">One set at a time</button><button type="button" data-act="gym-mode" data-v="list" aria-pressed="${ui.mode === 'list'}">All sets</button></div>
  ${ui.mode === 'list' ? listView(x) + (nextSet(x) ? '' : finishBlock(x, s)) : guided(x, s)}
  ${ui.mode === 'list' && nextSet(x) ? finishBlock(x, s) : ''}
  ${ui.mode === 'guided' && nextSet(x) ? `<details class="fold"><summary>Finish early or discard</summary>${finishBlock(x, s)}<button type="button" class="btn small ghost" data-act="gym-discard">Discard this session</button></details>` : ''}
  </div>`;
}

export function summaryView(ctx, id) {
  const x = G.gymData().sessions?.[id];
  if (!x) return `<a class="back" href="#/gym/history">Past sessions</a><h1 class="page-title">Not found</h1><p class="note">That session isn't saved on this phone.</p>`;
  const t = sessionTotals(x), prs = x.endedAt ? newPRs(x) : [];
  return `<a class="back" href="#/gym/history">Past sessions</a><h1 class="page-title">${esc(x.kind || 'Session')}</h1>
  <p class="muted">${esc(dayLabel(x.rd))} · ${G.locName(x.loc)}${x.light ? ' · light week' : ''}${x.short ? ' · shorter version' : ''}</p>
  <dl class="gym-sum"><div><dt>Time</dt><dd class="num">${t.min ? `${t.min} min` : '–'}</dd></div><div><dt>Working sets</dt><dd class="num">${t.sets}</dd></div><div><dt>Volume</dt><dd class="num">${t.kg} kg</dd></div>${x.feel ? `<div><dt>Felt</dt><dd>${esc(x.feel)}</dd></div>` : ''}</dl>
  ${t.min && fin(x.startedAt) && x.startedAt > 1e9 ? `<p class="muted">${fmt(nowLocal(x.startedAt).min)}–${fmt(nowLocal(x.endedAt).min)}</p>` : ''}
  ${prs.length ? `<section><h2>New records</h2><ul class="rules">${prs.map(p => `<li><b>${esc(G.exerciseName(p.id))}</b>: ${esc(p.what.join(', '))} <span class="muted num">(${esc(G.fmtDone(p.d, p.id))})</span></li>`).join('')}</ul></section>` : ''}
  <section><h2>Sets</h2><ul class="rules">${(x.ex || []).map(e => `<li><b>${esc(G.exerciseName(e.id))}</b><p class="muted num">${e.sets.filter(st => st.done).map(st => (st.type === 'warm' ? 'warm-up ' : '') + esc(G.fmtDone(st.done, e.id))).join(' · ') || 'Not logged'}</p></li>`).join('')}</ul></section>
  ${x.notes ? `<section><h2>Notes</h2><p>${esc(x.notes)}</p></section>` : ''}
  <p><a class="btn" href="#/gym">Back to gym</a></p>`;
}

// ---------- taps ----------
const val = id => { const v = document.getElementById(id)?.value; if (v == null || String(v).trim() === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : NaN; };
function readInputs(id, sfx) {
  const ex = G.EX(id) || {}, out = {}, bad = [];
  const take = (k, name) => { const v = val(`gym-in-${k}-${sfx}`); if (Number.isNaN(v)) bad.push(name); else if (v !== null) out[k] = k === 'w' ? Math.round(v * 100) / 100 : Math.round(v); };
  if (ex.unit === 'kg') take('w', 'weight');
  if (ex.unit === 'time') take('sec', 'seconds');
  else if (ex.oneSided) { take('rl', 'left reps'); take('rr', 'right reps'); }
  else take('r', 'reps');
  return { out, bad };
}
function afterLog(prs, ctx) {
  ui.flash = prs.length ? `New PR: ${prs.join(', ')}.` : '';
  ui.rpe = null; ui.edit = null; ui.swapFor = null;
  if (prs.length) ctx.notify('New PR');
}

export async function sessionClick(act, el, ctx) {
  const d = el.dataset, s = ctx.s;
  if (act === 'gym-start') {
    unlockAudio();
    if (G.activeSession()) { ctx.go('#/gym/session'); return true; }
    const id = startSession(d.iso, s, ctx.ms ?? Date.now(), ctx.rd, d.short === '1');
    if (!id) { ctx.notify('No session planned that day'); return true; }
    Object.assign(ui, { mode: 'guided', rpe: null, flash: '', swapFor: null, edit: null, feel: null });
    if (location.hash !== '#/gym/session') ctx.go('#/gym/session');
    return true;
  }
  if (!G.activeSession() && act !== 'gym-mode') return false;
  unlockAudio(); // first tap of the session unlocks sound on iOS
  const x = G.activeSession();
  if (act === 'gym-done') {
    const ei = +d.ei, si = +d.si, e = x?.ex[ei], t = targetFor(x, ei, si), ex = G.EX(e.id) || {}, v = {};
    if (ex.unit === 'kg' && fin(t.w)) v.w = t.w;
    if (ex.unit === 'time') v.sec = t.sec; else if (ex.oneSided) { v.rl = t.r; v.rr = t.r; } else v.r = t.r;
    if (ex.unit === 'kg' && !fin(t.w)) { ctx.notify('Enter the weight you used first'); el.closest('section')?.querySelector('details.gym-edit')?.setAttribute('open', ''); return false; }
    if (ui.rpe && e.sets[si].type === 'work') v.rpe = ui.rpe;
    afterLog(logSet(ei, si, v, ctx.ms ?? Date.now()), ctx);
    return true;
  }
  if (act === 'gym-log') {
    const ei = +d.ei, si = +d.si, e = x.ex[ei], { out, bad } = readInputs(e.id, d.sfx);
    if (bad.length) { ctx.notify(`Check the ${bad.join(' and ')}`); return false; }
    const ex = G.EX(e.id) || {};
    if (ex.unit === 'time' ? !fin(out.sec) : ex.oneSided ? !(fin(out.rl) || fin(out.rr)) : !fin(out.r)) { ctx.notify(ex.unit === 'time' ? 'Enter the seconds' : 'Enter the reps'); return false; }
    if (ex.unit === 'kg' && !fin(out.w)) { ctx.notify('Enter the weight'); return false; }
    if (ui.rpe && e.sets[si].type === 'work') out.rpe = ui.rpe; else if (e.sets[si].done?.rpe) out.rpe = e.sets[si].done.rpe;
    if (e.sets[si].done) { G.saveGym(g => { g.sessions[x.id].ex[ei].sets[si].done = { ...out, at: e.sets[si].done.at }; }); ui.edit = null; ctx.notify('Saved'); return true; }
    afterLog(logSet(ei, si, out, ctx.ms ?? Date.now()), ctx);
    return true;
  }
  if (act === 'gym-rpe') { ui.rpe = ui.rpe === +d.v ? null : +d.v; return true; }
  if (act === 'gym-mode') { ui.mode = d.v === 'list' ? 'list' : 'guided'; return true; }
  if (act === 'gym-edit') { ui.edit = d.k || null; return true; }
  if (act === 'gym-skip-set') { G.saveGym(g => { g.sessions[x.id].ex[+d.ei].sets[+d.si].skip = true; }); ui.flash = ''; return true; }
  if (act === 'gym-swap-open') { ui.swapFor = ui.swapFor === +d.ei ? null : +d.ei; return true; }
  if (act === 'gym-swap') { swapExercise(+d.ei, d.to, s); ui.swapFor = null; ctx.notify(`Swapped to ${G.exerciseName(d.to)}`); return true; }
  if (act === 'gym-rest-skip') { G.saveGym(g => { g.rest = null; }); return true; }
  if (act === 'gym-rest-add') {
    G.saveGym(g => { if (!g.rest) return; const left = G.restLeft(g.rest); g.rest = left > 0 ? { startedAt: g.rest.startedAt, sec: g.rest.sec + 30 } : { startedAt: Date.now(), sec: 30 }; });
    return true;
  }
  if (act === 'gym-feel') { ui.feel = d.v; G.saveGym(g => { g.sessions[x.id].feel = d.v; }); return true; }
  if (act === 'gym-finish') {
    const notes = document.getElementById('gym-notes')?.value ?? x.notes;
    if (nextSet(x) && !(await ask('Some sets are not logged yet.', { title: 'Finish anyway?', ok: 'Finish' }))) return false;
    const id = finishSession(ctx.ms ?? Date.now(), ui.feel ?? x.feel, notes);
    Object.assign(ui, { mode: 'guided', rpe: null, flash: '', swapFor: null, edit: null, feel: null });
    keepAwake(false);
    ctx.go('#/gym/summary/' + id);
    return true;
  }
  if (act === 'gym-discard') {
    if (!(await ask('Everything logged in it goes.', { title: 'Discard this session?', ok: 'Discard', danger: true }))) return false;
    G.saveGym(g => { delete g.sessions[x.id]; g.active = null; g.rest = null; }, true);
    keepAwake(false); ctx.notify('Session discarded'); ctx.go('#/gym');
    return true;
  }
  return false;
}
