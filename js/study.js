// Study: an AWS Developer – Associate (DVA-C03) plan generated from the shift calendar (off days get the
// long sessions), Mandarin minutes, exam countdown and the Pearson VUE booking task.
// Curriculum lives in data/aws-plan.json; this file only decides which day gets what.
import { getDay, dayNum, isoOf } from './schedule.js';
import { get, update } from './storage.js';
import { studyMinutes } from './plan.js';
import { addDays, esc, dayLabel, mondayOf } from './util.js';
import { ask } from './sheet.js';

const BOOK_URL = 'https://home.pearsonvue.com/aws';
const GUIDE_URL = 'https://aws.amazon.com/certification/certified-developer-associate/';
const EXAM_NAME = 'AWS Certified Developer – Associate (DVA-C03)';
const PRACTICE_SRC = 'Tutorials Dojo practice exams (use the DVA-C03 set if available, otherwise DVA-C02 and focus on the shared domains)';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
let DATA = null;
const memo = { key: '', plan: null };
// Tests (and init) hand the curriculum in here. Clearing the memo makes the next plan use it.
export function setPlanData(d) { DATA = d && Array.isArray(d.topics) && d.topics.length ? d : null; memo.key = ''; }
export const planData = () => DATA;

// ---------- storage ----------
// study = { log: { [routineDay]: { aws:{ done, min }, mandarin:{ min } } }, booked:bool, weak:{ [topicId]:true } }
const area = () => get('study');
export function logOf(iso) {
  const l = area().log?.[iso] || {};
  return { aws: { done: !!l.aws?.done, min: +l.aws?.min || 0 }, mandarin: { min: +l.mandarin?.min || 0 } };
}
export function setLog(iso, fn) {
  return update('study', st => {
    if (!st.log || typeof st.log !== 'object') st.log = {};
    const l = logOf(iso); fn(l); st.log[iso] = l;
  });
}
export const isWeak = id => !!area().weak?.[id];
export function setWeak(id, on) {
  return update('study', st => { st.weak = { ...(st.weak || {}) }; if (on) st.weak[id] = true; else delete st.weak[id]; });
}

// ---------- plan generation ----------
// Phase boundaries as day indexes. 8 weeks → weeks 1–5 content, week 6 practice, weeks 7–8 review;
// other spans scale the same 5 : 1 : 2 shape in whole weeks (or in days when shorter than 4 weeks).
export function phases(N) {
  const W = Math.ceil(N / 7);
  if (W >= 4) {
    const pw = Math.max(1, Math.round(W / 8));
    let cw = Math.round(W * 5 / 8);
    if (W - cw - pw < 1) cw = W - pw - 1;
    return { weeks: W, content: Math.min(N, cw * 7), practice: Math.min(N, (cw + pw) * 7) };
  }
  return { weeks: W, content: Math.round(N * 5 / 8), practice: Math.round(N * 6 / 8) };
}

const weightOf = () => Object.fromEntries((DATA?.domains || []).map(d => [d.id, +d.weight || 0]));
// Where to learn a topic: Maarek course section by name, and/or AWS Skill Builder / AWS docs for DVA-C03 additions.
export const sourceOf = t => [t.maarek ? `Stephane Maarek course: ${t.maarek}` : '', t.learn || ''].filter(Boolean).join('. Also ') || t.name;
export const examName = () => DATA?.exam || EXAM_NAME;
const fill = (tpl, t) => String(tpl || '').replace(/\{topic\}/g, t.name).replace(/\{section\}/g, t.maarek ? `the course section ${t.maarek}` : (t.learn || t.name)).replace(/\{lab\}/g, t.heavy?.[0]?.lab || '');
const lc = x => String(x || '').replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
// Topics without a Maarek section are learnt from AWS Skill Builder / docs, so they say "Study", not "Lectures".
const heavyText = (h, t) => `${t.maarek ? 'Lectures' : 'Study'}: ${h.lectures}. Lab in your AWS playground account: ${h.lab} Then ${h.questions}.`;

function fillContent(ds) {
  const T = DATA.topics, wt = weightOf();
  const total = ds.reduce((a, x) => a + x.min, 0);
  const raw = T.map(t => (wt[t.domain] || 0) * (+t.share || 0));
  // Budget per topic by weight, but never less than one long session (every topic gets a lab);
  // topics lifted to that floor are fixed and the rest of the time is shared out again by weight.
  const floor = ds.some(x => x.heavy) ? Math.max(...ds.map(x => x.min)) : 0, B = raw.map(() => 0), fixed = new Set();
  for (let pass = 0; pass < T.length; pass++) {
    const left = total - [...fixed].reduce((a, i) => a + B[i], 0), w = raw.reduce((a, v, i) => fixed.has(i) ? a : a + v, 0) || 1;
    let changed = false;
    raw.forEach((v, i) => { if (fixed.has(i)) return; B[i] = v / w * left; if (B[i] < floor) { B[i] = floor; fixed.add(i); changed = true; } });
    if (!changed) break;
  }
  const C = []; let acc = 0; B.forEach(v => { acc += v; C.push(acc); }); // cumulative minute targets
  const offLeft = []; for (let j = ds.length - 1, n = 0; j >= 0; j--) { if (ds[j].heavy) n++; offLeft[j] = n; }
  const cnt = T.map(() => ({ days: 0, heavy: 0, light: 0 }));
  let k = 0, cum = 0;
  ds.forEach((x, j) => {
    const rest = T.length - 1 - k;
    const c0 = cnt[k];
    if (c0.days && rest > 0) {
      const has = c0.heavy > 0;
      // Advance when this topic has had its share of minutes (and a long session if one is left),
      // or when the remaining days (or off days) are only just enough for one per remaining topic.
      if (ds.length - j <= rest || (x.heavy && has && offLeft[j] <= rest) || (cum + x.min / 2 > C[k] && (has || offLeft[j] === 0))) k++;
    }
    const t = T[k], c = cnt[k];
    if (x.heavy) {
      const list = t.heavy || [], h = list[c.heavy % list.length] || { lectures: t.name, lab: 'Repeat your last lab.', questions: '10 practice questions' };
      const again = list.length && c.heavy >= list.length ? 'Second pass. ' : '';
      Object.assign(x, { kind: 'lab', task: again + heavyText(h, t), short: `${again}${t.maarek ? 'Lectures on' : 'Read up on'} ${lc(h.lectures)}, a lab, then ${h.questions}.` });
      c.heavy++;
    } else {
      const list = t.light || [], l = list[c.light % list.length] || `Watch one lecture on ${t.name}.`;
      Object.assign(x, { kind: 'lesson', task: l, short: l });
      c.light++;
    }
    c.days++; cum += x.min;
    Object.assign(x, { topicId: t.id, topic: t.name, section: sourceOf(t) });
  });
}

function fillPractice(ds) {
  const P = DATA.practice || {}, exams = ds.filter(x => x.heavy);
  if (!exams.length && ds.length) exams.push(ds[0]); // no off day in this phase: still take one exam
  let n = 0;
  for (const x of ds) {
    if (exams.includes(x)) {
      n++;
      Object.assign(x, { kind: 'practice', examNo: n, task: String(P.heavy || 'Take Tutorials Dojo practice exam {n}.').replace('{n}', n), short: `Tutorials Dojo practice exam ${n}, timed.` });
    } else {
      const t = n ? P.light : P.lightBefore;
      Object.assign(x, { kind: 'lesson', task: t || 'Review practice exam explanations.', short: t || '' });
    }
    Object.assign(x, { topicId: null, topic: 'Practice exams', section: DATA?.practice?.source || PRACTICE_SRC });
  }
  return n;
}

// Marked topics first (in course order), then the rest by domain weight, then by size in the domain.
export function reviewOrder(weak = {}) {
  if (!DATA) return [];
  const wt = weightOf(), T = DATA.topics;
  const rest = T.filter(t => !weak[t.id]).sort((a, b) => (wt[b.domain] - wt[a.domain]) || (b.share - a.share) || T.indexOf(a) - T.indexOf(b));
  return [...T.filter(t => weak[t.id]), ...rest];
}

function fillReview(ds, weak) {
  const R = DATA.review || {}, list = reviewOrder(weak);
  const offs = ds.filter(x => x.heavy), last = offs.length ? offs.at(-1) : ds.at(-1);
  let j = 0, cur = list[0], after = false;
  for (const x of ds) {
    if (x === last) {
      Object.assign(x, { kind: 'final', topicId: null, topic: 'Final practice exam', section: DATA?.practice?.source || PRACTICE_SRC, task: R.final || 'Final practice exam.', short: 'Final practice exam under exam conditions.' });
      after = true; continue;
    }
    if (after) {
      const t = R.afterFinal || R.light || 'Review your final practice exam.';
      Object.assign(x, { kind: 'lesson', topicId: null, topic: 'Final practice exam review', section: DATA?.practice?.source || PRACTICE_SRC, task: t, short: t });
      continue;
    }
    if (x.heavy) {
      cur = list[j++ % list.length];
      Object.assign(x, { kind: 'review', task: fill(R.heavy, cur), short: `Review ${cur.name}: ${cur.maarek ? 'lectures' : 'docs'}, a lab and 15–20 questions.` });
    } else {
      const t = fill(R.light, cur);
      Object.assign(x, { kind: 'lesson', task: t, short: t });
    }
    Object.assign(x, { topicId: cur.id, topic: 'Review: ' + cur.name, section: sourceOf(cur), weak: !!weak[cur.id] });
  }
}

function build(s, weak) {
  const start = s.studyStart, n0 = dayNum(start), N = Math.max(0, dayNum(s.exam) - n0);
  const ph = phases(N), days = [];
  for (let i = 0; i < N; i++) {
    const iso = isoOf(n0 + i), d = getDay(iso, s);
    days.push({ iso, i, week: Math.floor(i / 7) + 1, type: d.type, heavy: d.type === 'off', min: studyMinutes(iso, s).aws,
      phase: i < ph.content ? 'content' : i < ph.practice ? 'practice' : 'review', kind: '', topicId: null, topic: '', section: '', task: '', short: '' });
  }
  if (!DATA) {
    const t = 'Continue the Stephane Maarek course where you left off.';
    days.forEach(x => Object.assign(x, { kind: 'lesson', topic: EXAM_NAME, task: t, short: t }));
  } else {
    fillContent(days.filter(x => x.phase === 'content'));
    fillPractice(days.filter(x => x.phase === 'practice'));
    const rv = days.filter(x => x.phase === 'review');
    if (rv.length) fillReview(rv, weak);
  }
  return { start, exam: s.exam, weeks: ph.weeks, phases: ph, days };
}

// Deterministic and memoised on everything it depends on: dates, minutes, shift calendar, weak topics.
export function planFor(s) {
  const weak = area().weak || {};
  const key = JSON.stringify([s.studyStart, s.exam, s.aws, s.anchor, s.anchorBlock, s.blockLength, s.night, s.morning, s.overrides, weak, !!DATA, DATA?.topics?.length]);
  if (memo.key !== key) { memo.plan = build(s, weak); memo.key = key; }
  return memo.plan;
}
const dayOf = (iso, s) => { const p = planFor(s), i = dayNum(iso) - dayNum(p.start); return i >= 0 && i < p.days.length ? p.days[i] : null; };

// ---------- named helpers other screens use ----------
export function studyFor(iso, s) {
  const m = studyMinutes(iso, s), d = m.aws ? dayOf(iso, s) : null;
  return {
    aws: { min: m.aws, topic: d?.topic || null, task: d?.task || null, heavy: !!d?.heavy, short: d?.short || null, section: d?.section || null, kind: d?.kind || null, week: d?.week || null, phase: d?.phase || null },
    mandarin: { min: m.mandarin },
  };
}
export function weekStudy(mondayIso, s) {
  const out = { aws: { plan: 0, done: 0 }, mandarin: { plan: 0, done: 0 } };
  for (let k = 0; k < 7; k++) {
    const iso = addDays(mondayIso, k), m = studyMinutes(iso, s), l = logOf(iso);
    out.aws.plan += m.aws; out.aws.done += l.aws.min;
    out.mandarin.plan += m.mandarin; out.mandarin.done += l.mandarin.min;
  }
  return out;
}
// Shape progress.js reads through ctx.studyPlanned(mondayIso).
export const plannedWeek = (mondayIso, s) => { const w = weekStudy(mondayIso, s); return { aws: w.aws.plan, mandarin: w.mandarin.plan }; };
// Days from today's calendar date to the exam: 0 on exam day, negative after it.
export const examDays = ctx => dayNum(ctx.s.exam) - dayNum(ctx.iso);

// ---------- view helpers ----------
const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? String(u) : '#';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function countdown(ctx) {
  const n = examDays(ctx), when = dayLabel(ctx.s.exam);
  if (n > 1) return `<b class="num">${n}</b> days to your exam on ${when}.`;
  if (n === 1) return `Your exam is tomorrow, ${when}.`;
  if (n === 0) return 'Your exam is today.';
  return `Your exam date (${when}) has passed. If you rebook, set the new date in <a href="#/settings">Settings</a>.`;
}
const bookItem = (cls = '') => `<div class="row study-book ${cls}"><button type="button" class="check" data-act="study-book" aria-pressed="false">Book your exam on Pearson VUE</button>
  <a class="btn small ghost" href="${BOOK_URL}" target="_blank" rel="noopener">Open Pearson VUE</a></div>`;
const mandarinBtn = (s, cls = 'btn') => `<a class="${cls}" href="${esc(safeUrl(s.mandarinUrl))}" target="_blank" rel="noopener">Open Mandarin app</a>`;
const awsCheck = (iso, l, label = 'AWS study done') => `<button type="button" class="check" data-act="study-done" data-iso="${iso}" aria-pressed="${l.aws.done}">${label}</button>`;
const manCheck = (iso, l, plan) => `<button type="button" class="check" data-act="study-man-done" data-iso="${iso}" aria-pressed="${plan > 0 && l.mandarin.min >= plan}">Mandarin ${plan} min done</button>`;
// One neutral line while the DVA-C03 weights come from a summary rather than the official guide.
const weightsNote = () => DATA?.weightsPreliminary === false ? '' : `<p class="muted study-prelim">Domain weights are preliminary until you check the official DVA-C03 exam guide. <a href="${GUIDE_URL}" target="_blank" rel="noopener">Open the AWS exam page</a></p>`;
const KIND = { lab: 'Long session: lectures, lab, questions', lesson: 'Short session', practice: 'Practice exam', review: 'Review session', final: 'Final practice exam' };
const PHASE = { content: 'Course content', practice: 'Practice exams', review: 'Weak-area review' };

function head(ctx, page) {
  const tab = (p, href, text) => `<a href="${href}"${p === page ? ' aria-current="page"' : ''}>${text}</a>`;
  return `<a class="back" href="#/today">Today</a><h1 class="page-title">Study</h1>
  <nav class="seg" aria-label="Study pages">${tab('today', '#/study', 'Today')}${tab('plan', '#/study/plan', 'Full plan')}${tab('week', '#/study/week', 'Week')}</nav>`;
}

function minField(iso, subj, value, label) {
  const id = `study-${subj}-${iso}`;
  return `<label class="field study-min" for="${id}"><span>${label}</span><input id="${id}" type="number" inputmode="numeric" min="0" max="600" step="5" value="${value || ''}" placeholder="0" data-act="study-min" data-subj="${subj}" data-iso="${iso}"></label>`;
}

function weakList(ctx) {
  if (!DATA) return '';
  const wt = weightOf(), dn = Object.fromEntries(DATA.domains.map(d => [d.id, d.name]));
  return `<ul class="rules study-topics">${DATA.topics.map(t => `<li class="row"><div class="grow"><b>${esc(t.name)}</b>
    <p class="muted">${esc(dn[t.domain] || '')} (${wt[t.domain] || 0}%) · ${esc(sourceOf(t))}</p></div>
    <button type="button" class="btn small" data-act="study-weak" data-topic="${esc(t.id)}" aria-pressed="${isWeak(t.id)}">Needs review</button></li>`).join('')}</ul>`;
}

function todayView(ctx) {
  const s = ctx.s, rd = ctx.rd, f = studyFor(rd, s), l = logOf(rd), p = planFor(s), booked = !!area().booked;
  let aws;
  if (f.aws.min) {
    const lab = f.aws.kind === 'lab' || f.aws.kind === 'review';
    aws = `<p class="muted">Week ${f.aws.week} of ${p.weeks} · ${PHASE[f.aws.phase]} · ${f.aws.heavy ? 'Off day' : 'Work day'} · ${f.aws.min} min</p>
      <h3 class="study-topic">${esc(f.aws.topic)}</h3>
      <p class="tag">${KIND[f.aws.kind] || 'Session'}</p>
      <p>${esc(f.aws.task)}</p>
      ${f.aws.section ? `<p class="muted">Where to learn it: ${esc(f.aws.section)}</p>` : ''}
      ${lab ? `<p class="note calm">Do labs in your employer's AWS playground account and delete what you create. Never type passwords or access keys into this app.</p>` : ''}
      <div class="study-log">${awsCheck(rd, l)}${minField(rd, 'aws', l.aws.min, 'AWS minutes studied')}</div>`;
  } else if (rd < s.studyStart) aws = `<p>Your AWS plan starts on ${dayLabel(s.studyStart)}.</p>`;
  else aws = '<p>No AWS study planned today.</p>';
  const showWeak = f.aws.phase === 'practice' || f.aws.phase === 'review' || rd >= s.exam;
  return `${head(ctx, 'today')}
  <p class="study-count">${countdown(ctx)}</p>
  ${booked ? '' : bookItem()}
  <section aria-labelledby="study-aws"><h2 id="study-aws">${esc(examName())}</h2>${weightsNote()}${aws}</section>
  <section aria-labelledby="study-man"><h2 id="study-man">Mandarin</h2>
    <p>${f.mandarin.min} min every day.</p>
    <div class="study-log">${manCheck(rd, l, f.mandarin.min)}${minField(rd, 'mandarin', l.mandarin.min, 'Mandarin minutes')}</div>
    <p>${mandarinBtn(s, 'btn primary wide')}</p></section>
  ${DATA ? `<details class="fold"${showWeak ? ' open' : ''}><summary>Topics that need review (${Object.keys(area().weak || {}).length})</summary>
    <p class="muted">${esc(DATA.review?.guidance || '')}</p>${weakList(ctx)}</details>` : ''}
  <p><a class="btn ghost wide" href="#/study/plan">See the full plan</a></p>
  ${booked ? `<p class="muted study-booked">Exam booked. <button type="button" class="btn small ghost" data-act="study-unbook">Mark as not booked</button></p>` : ''}`;
}

function planView(ctx) {
  const s = ctx.s, p = planFor(s);
  if (!p.days.length) return `${head(ctx, 'plan')}<p class="note">Your exam date is on or before your study start date. Set the dates in <a href="#/settings">Settings</a> and the plan rebuilds.</p>`;
  const last = p.days.at(-1).iso, weeks = [];
  for (let w = 1; w <= p.weeks; w++) weeks.push(p.days.filter(x => x.week === w));
  const body = weeks.map((ds, wi) => {
    const done = ds.filter(x => logOf(x.iso).aws.done).length, cur = ds.some(x => x.iso === ctx.rd);
    const phs = [...new Set(ds.map(x => PHASE[x.phase]))].join(', ');
    return `<details class="fold study-week"${cur ? ' open' : ''}><summary>Week ${wi + 1} · ${dayLabel(ds[0].iso)} – ${dayLabel(ds.at(-1).iso)}<span class="muted study-sum">${done}/${ds.length}</span></summary>
      <p class="muted">${esc(phs)}</p>
      <ul class="rules">${ds.map(x => {
        const l = logOf(x.iso), today = x.iso === ctx.rd;
        return `<li class="study-day${today ? ' is-today' : ''}"${today ? ' aria-current="date"' : ''}>
          <div class="row"><b class="grow">${dayLabel(x.iso)}${today ? ' (today)' : ''}</b><span class="tag">${x.heavy ? 'Off' : 'Work'} · ${x.min} min</span>${x.weak ? '<span class="tag">Needs review</span>' : ''}</div>
          <p>${esc(x.topic)}</p><p class="muted">${esc(x.task)}</p>
          ${awsCheck(x.iso, l, l.aws.done ? `Done${l.aws.min ? ` · ${l.aws.min} min` : ''}` : 'Mark done')}</li>`;
      }).join('')}</ul></details>`;
  }).join('');
  const dom = DATA ? `<ul class="rules">${DATA.domains.map(d => `<li class="row"><span class="grow">${esc(d.name)}</span><span class="num">${d.weight}%</span></li>`).join('')}</ul>` : '';
  return `${head(ctx, 'plan')}
  <p>${esc(examName())}: ${plural(p.weeks, 'week')} from ${dayLabel(p.start)} to ${dayLabel(last)}. Exam on ${dayLabel(p.exam)}.</p>
  <p class="muted">Off days get the long sessions with a lab. Work days get one lecture or a flashcard review. The plan rebuilds when you change the exam or start date in Settings.</p>
  ${body}
  <h2>Topics</h2><p class="muted">${esc(DATA?.review?.guidance || '')}</p>${weakList(ctx)}
  ${dom ? `<h2>Exam domains</h2>${weightsNote()}${dom}` : ''}
  <p class="muted">${esc(DATA?.courseNote || 'Course sections are matched by name. Check the section numbers in your Udemy course.')}</p>`;
}

function weekView(ctx, sub) {
  const s = ctx.s, m = mondayOf(ISO.test(sub || '') ? sub : ctx.rd), w = weekStudy(m, s);
  const bar = (label, x) => {
    const pct = x.plan ? Math.min(100, Math.round(x.done / x.plan * 100)) : 0;
    return `<div class="study-bar"><div class="row"><b class="grow">${label}</b><span class="num">${x.done} / ${x.plan} min</span></div>
      <div class="bar" role="progressbar" aria-label="${label} minutes against plan" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><b style="width:${pct}%"></b></div></div>`;
  };
  const rows = Array.from({ length: 7 }, (_, k) => {
    const iso = addDays(m, k), pl = studyMinutes(iso, s), l = logOf(iso);
    return `<li class="row${iso === ctx.rd ? ' is-today' : ''}"><span class="grow">${dayLabel(iso)}</span>
      <span class="num">AWS ${l.aws.min}/${pl.aws}</span><span class="num">Mandarin ${l.mandarin.min}/${pl.mandarin}</span></li>`;
  }).join('');
  return `${head(ctx, 'week')}
  <div class="row study-weeknav"><a class="btn small ghost" href="#/study/week/${addDays(m, -7)}">Previous week</a><span class="grow">Week of ${dayLabel(m)}</span><a class="btn small ghost" href="#/study/week/${addDays(m, 7)}">Next week</a></div>
  ${bar('AWS', w.aws)}${bar('Mandarin', w.mandarin)}
  <h2>Day by day</h2><p class="muted">Minutes studied / planned.</p><ul class="rules study-days">${rows}</ul>`;
}

// ---------- Today card ----------
export function todayCard(ctx) {
  const s = ctx.s, rd = ctx.rd, f = studyFor(rd, s), l = logOf(rd), n = examDays(ctx);
  const items = [];
  if (f.aws.min) items.push(`<li><div class="row"><b class="grow">AWS ${f.aws.min} min</b><span class="tag">${f.aws.heavy ? 'Long session' : 'Short session'}</span></div>
    <p>${esc(f.aws.topic)}</p><p class="muted">${esc(f.aws.short || f.aws.task)}</p>${awsCheck(rd, l, l.aws.done ? `AWS done${l.aws.min ? ` · ${l.aws.min} min` : ''}` : 'AWS study done')}</li>`);
  items.push(`<li><div class="row"><b class="grow">Mandarin ${f.mandarin.min} min</b>${l.mandarin.min ? `<span class="muted num">${l.mandarin.min} min logged</span>` : ''}</div>
    <div class="row study-man">${manCheck(rd, l, f.mandarin.min)}${mandarinBtn(s, 'btn')}</div></li>`);
  if (n >= -1) items.push(`<li><p class="study-count">${countdown(ctx)}</p></li>`);
  if (!area().booked) items.push(`<li>${bookItem()}</li>`);
  return `<ul class="rules study-card">${items.join('')}</ul><p><a href="#/study">Open study</a></p>`;
}

// ---------- module ----------
const clampMin = v => Math.max(0, Math.min(600, Math.round(+v || 0)));

export default {
  name: 'study',
  async init() {
    try { const r = await fetch('data/aws-plan.json'); if (r.ok) setPlanData(await r.json()); }
    catch { /* the plan falls back to "continue the course" */ }
  },
  view(ctx, arg = '') {
    const [page, sub] = String(arg || '').split('/');
    if (page === 'plan') return planView(ctx);
    if (page === 'week') return weekView(ctx, sub);
    return todayView(ctx);
  },
  async click(act, el, ctx) {
    const iso = ISO.test(el?.dataset?.iso || '') ? el.dataset.iso : ctx.rd, s = ctx.s;
    if (act === 'study-done') {
      const ok = setLog(iso, l => { l.aws.done = !l.aws.done; if (l.aws.done && !l.aws.min) l.aws.min = studyMinutes(iso, s).aws; });
      if (ok && logOf(iso).aws.done) ctx.notify?.('AWS study logged');
      return true;
    }
    if (act === 'study-man-done') {
      const plan = s.mandarinMin, l0 = logOf(iso);
      if (plan > 0 && l0.mandarin.min >= plan) { if (!(await ask("Clear this day's Mandarin minutes?", { ok: 'Clear' }))) return false; setLog(iso, l => { l.mandarin.min = 0; }); }
      else { setLog(iso, l => { l.mandarin.min = Math.max(l.mandarin.min, plan); }); ctx.notify?.('Mandarin logged'); }
      return true;
    }
    if (act === 'study-book') { update('study', st => { st.booked = true; }); ctx.notify?.('Exam booking ticked off'); return true; }
    if (act === 'study-unbook') { update('study', st => { st.booked = false; }); return true; }
    if (act === 'study-weak') { const id = el.dataset.topic; if (id) setWeak(id, !isWeak(id)); return true; }
    return false;
  },
  change(act, el, ctx) {
    if (act !== 'study-min') return false;
    const iso = ISO.test(el.dataset.iso || '') ? el.dataset.iso : ctx.rd, v = clampMin(el.value);
    if (el.dataset.subj === 'mandarin') setLog(iso, l => { l.mandarin.min = v; });
    else setLog(iso, l => { l.aws.min = v; });
    ctx.notify?.('Saved');
    return true;
  },
};
