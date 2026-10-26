// Plain node tests for js/study.js: node tests/study.test.js
import { readFileSync } from 'node:fs';
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
  key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; },
};
globalThis.confirm = () => true;

const st = await import('../js/storage.js');
const { studyMinutes } = await import('../js/plan.js');
const { getDay } = await import('../js/schedule.js');
const S = await import('../js/study.js');
const study = S.default;
const DATA = JSON.parse(readFileSync(new URL('../data/aws-plan.json', import.meta.url), 'utf8'));
S.setPlanData(DATA);

let fail = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; };
const reset = () => { mem.clear(); st._clearCache(); };
const ctxFor = (rd, extra = {}) => ({ s: st.getSettings(), iso: rd, rd, min: 900, ms: 0, go() {}, rerender() {}, notify() {}, ...extra });

// ---------- shape of the default plan ----------
reset();
const s = st.getSettings();
const p = S.planFor(s);
ok('8 weeks', p.weeks === 8);
ok('starts Mon 26 Oct, ends Sun 20 Dec', p.days[0].iso === '2026-10-26' && p.days.at(-1).iso === '2026-12-20' && p.days.length === 56);
ok('week 1 = 26 Oct–1 Nov', p.days.filter(d => d.week === 1).map(d => d.iso).join() === '2026-10-26,2026-10-27,2026-10-28,2026-10-29,2026-10-30,2026-10-31,2026-11-01');
ok('week 8 = 14–20 Dec', p.days.filter(d => d.week === 8)[0].iso === '2026-12-14' && p.days.filter(d => d.week === 8).at(-1).iso === '2026-12-20');
const wk = w => p.days.filter(d => d.week === w);
ok('weeks 1–5 are content', [1, 2, 3, 4, 5].every(w => wk(w).every(d => d.phase === 'content')));
ok('week 6 is practice exams', wk(6).every(d => d.phase === 'practice') && wk(6).some(d => d.kind === 'practice'));
ok('week 6 practice exams fall on off days', wk(6).filter(d => d.kind === 'practice').every(d => d.heavy && d.type === 'off'));
ok('week 6 tasks name Tutorials Dojo', wk(6).filter(d => d.kind === 'practice').every(d => /Tutorials Dojo/.test(d.task)));
ok('week 6 says DVA-C03 set if available, else DVA-C02', wk(6).every(d => d.section === 'Tutorials Dojo practice exams (use the DVA-C03 set if available, otherwise DVA-C02 and focus on the shared domains)') && wk(6).filter(d => d.kind === 'practice').every(d => /DVA-C03 set if available, otherwise DVA-C02/.test(d.task)));
ok('weeks 7–8 are review', [7, 8].every(w => wk(w).every(d => d.phase === 'review')));
ok('weeks 7–8 have review sessions', wk(7).concat(wk(8)).filter(d => d.kind === 'review').length >= 3);
ok('one final practice exam in weeks 7–8, on an off day', (() => { const f = p.days.filter(d => d.kind === 'final'); return f.length === 1 && f[0].week >= 7 && f[0].heavy; })());

// ---------- light vs heavy, minutes ----------
ok('off days get heavy tasks, work days light ones', p.days.every(d => d.heavy === (getDay(d.iso, s).type === 'off')));
ok('content off days have a lab in the task', p.days.filter(d => d.phase === 'content' && d.heavy).every(d => d.kind === 'lab' && /Lab in your AWS playground account/.test(d.task)));
ok('content work days are one lecture, one doc page or flashcards', p.days.filter(d => d.phase === 'content' && !d.heavy).every(d => d.kind === 'lesson' && /^(Watch one lecture|Read the|Flashcards)/.test(d.task)));
ok('minutes match plan.studyMinutes', p.days.every(d => d.min === studyMinutes(d.iso, s).aws && S.studyFor(d.iso, s).aws.min === d.min));
ok('work day 20 min, off day 90 min', S.studyFor('2026-10-28', s).aws.min === 20 && S.studyFor('2026-10-30', s).aws.min === 90);
ok('studyFor heavy flag', S.studyFor('2026-10-30', s).aws.heavy === true && S.studyFor('2026-10-28', s).aws.heavy === false);
ok('Mandarin 15 min every day', p.days.every(d => S.studyFor(d.iso, s).mandarin.min === 15));
ok('no AWS on exam day or after', S.studyFor('2026-12-21', s).aws.min === 0 && S.studyFor('2026-12-21', s).aws.topic === null);
ok('no AWS before the start', S.studyFor('2026-10-25', s).aws.min === 0);
ok('no credentials asked for', !/password|secret access key|access key id/i.test(JSON.stringify(p.days.map(d => d.task))));

// ---------- DVA-C03 curriculum ----------
ok('exam is DVA-C03', DATA.exam === 'AWS Certified Developer – Associate (DVA-C03)' && S.examName() === DATA.exam);
ok('DVA-C03 weights 30/26/22/22', JSON.stringify(DATA.domains.map(d => [d.id, d.weight])) === JSON.stringify([['dev', 30], ['sec', 26], ['dep', 22], ['trb', 22]]));
ok('domain renamed Testing and Deployment', DATA.domains.find(d => d.id === 'dep').name === 'Testing and Deployment');
ok('weights marked preliminary with the AWS exam page link', DATA.weightsPreliminary === true && DATA.examGuideUrl === 'https://aws.amazon.com/certification/certified-developer-associate/');
ok('topic shares sum to 1 in each domain', DATA.domains.every(dm => Math.abs(DATA.topics.filter(t => t.domain === dm.id).reduce((a, t) => a + t.share, 0) - 1) < 1e-9));
const tp = id => DATA.topics.find(t => t.id === id);
ok('the 12 original topics are kept', ['iam', 's3', 'lambda', 'apigw', 'dynamo', 'msg', 'cfn', 'cicd', 'obs', 'kms', 'cognito', 'containers'].every(tp));
ok('AI security topic under Security', tp('aisec')?.domain === 'sec' && ['prompt injection', 'log', 'guardrail', 'privacy', 'tool'].every(w => JSON.stringify(tp('aisec')).toLowerCase().includes(w)));
ok('Bedrock, AgentCore, Amazon Q and Kiro under Development', tp('genai')?.domain === 'dev' && ['Bedrock', 'AgentCore', 'Amazon Q', 'Kiro', 'test', 'debug'].every(w => JSON.stringify(tp('genai')).includes(w)));
ok('containers topic covers ECR, ECS, EKS, Fargate', ['ECR', 'ECS', 'EKS', 'Fargate'].every(w => JSON.stringify(tp('containers')).includes(w)));
ok('Data Firehose and PrivateLink covered', JSON.stringify(DATA.topics).includes('Data Firehose') && JSON.stringify(DATA.topics).includes('PrivateLink'));
ok('out-of-scope topics not added', !/prompt engineering|\bRAG\b|retrieval-augmented|model selection|SageMaker|governance framework/i.test(JSON.stringify(DATA.topics)));
ok('new topics point to Skill Builder or AWS docs by name', ['aisec', 'genai'].every(id => /AWS Skill Builder|AWS docs/.test(tp(id).learn || '')));
ok('Bedrock labs say "if your playground allows it"', tp('genai').heavy.filter(h => /Bedrock/.test(h.lab)).every(h => /if your playground allows it/i.test(h.lab)));
ok('new-topic days show where to learn it', p.days.filter(d => d.topicId === 'aisec').every(d => /AWS docs|Skill Builder/.test(d.section)));

// ---------- coverage proportional to domain weight ----------
const content = p.days.filter(d => d.phase === 'content');
const ids = new Set(content.map(d => d.topicId));
ok('every topic appears in weeks 1–5', DATA.topics.every(t => ids.has(t.id)));
ok('every topic gets at least one off-day lab', DATA.topics.every(t => content.some(d => d.topicId === t.id && d.heavy)));
const byDom = {}, total = content.reduce((a, d) => a + d.min, 0);
for (const d of content) { const dom = DATA.topics.find(t => t.id === d.topicId).domain; byDom[dom] = (byDom[dom] || 0) + d.min; }
for (const dm of DATA.domains) {
  const share = byDom[dm.id] / total * 100;
  ok(`${dm.name}: ${share.toFixed(1)}% of content minutes, target ${dm.weight}% (±5)`, Math.abs(share - dm.weight) <= 5);
}
ok('Development gets the most time', byDom.dev > byDom.sec && byDom.dev > byDom.dep && byDom.dev > byDom.trb);
ok('topics follow the course order', (() => { const seq = content.map(d => DATA.topics.findIndex(t => t.id === d.topicId)); return seq.every((v, i) => !i || v >= seq[i - 1]); })());

// ---------- determinism and memo ----------
ok('same settings → same plan object (memoised)', S.planFor(st.getSettings()) === p);
const p2json = JSON.stringify(p.days);
st.setSetting('exam', '2026-12-21');
ok('rebuilt plan is identical (deterministic)', JSON.stringify(S.planFor(st.getSettings()).days) === p2json);

// ---------- changing the exam date regenerates ----------
st.setSetting('exam', '2027-01-25'); // 13 weeks
const q = S.planFor(st.getSettings());
ok('later exam → plan regenerates', q !== p && q.days.length === 91 && q.weeks === 13);
ok('13 weeks scale to 8 content, 2 practice, 3 review', q.phases.content === 56 && q.phases.practice === 70);
ok('scaled plan still covers every topic', DATA.topics.every(t => q.days.some(d => d.phase === 'content' && d.topicId === t.id)));
ok('scaled plan has one final exam at the end', q.days.filter(d => d.kind === 'final').length === 1 && q.days.filter(d => d.kind === 'final')[0].week >= 11);
st.setSetting('exam', '2026-11-30'); // 5 weeks
const r = S.planFor(st.getSettings());
ok('shorter span: 5 weeks, still content/practice/review', r.weeks === 5 && ['content', 'practice', 'review'].every(ph => r.days.some(d => d.phase === ph)));
st.setSetting('studyStart', '2026-11-02'); st.setSetting('exam', '2026-12-28');
const r2 = S.planFor(st.getSettings());
ok('new start date regenerates from that date', r2.days[0].iso === '2026-11-02' && r2.weeks === 8);
st.setSetting('exam', '2026-10-01');
ok('exam before start → empty plan, no throw', S.planFor(st.getSettings()).days.length === 0);
reset();

// ---------- weak areas ----------
S.setWeak('cognito', true);
const w = S.planFor(st.getSettings());
const firstReview = w.days.find(d => d.kind === 'review');
ok('marked topic is reviewed first in weeks 7–8', firstReview.topicId === 'cognito' && firstReview.weak === true);
ok('weak stored as study.weak', st.get('study').weak?.cognito === true);
ok('content weeks unchanged by marking', JSON.stringify(w.days.filter(d => d.phase === 'content').map(d => d.task)) === JSON.stringify(content.map(d => d.task)));
S.setWeak('cognito', false);
const rv = S.planFor(st.getSettings()).days.find(d => d.kind === 'review');
ok('without marks, review starts with the heaviest domain', DATA.topics.find(t => t.id === rv.topicId).domain === 'dev');
ok('page shows the exam name and preliminary-weights line', (() => { const h = study.view(ctxFor('2026-10-28'), ''); return h.includes('AWS Certified Developer – Associate (DVA-C03)') && /preliminary/.test(h) && h.includes('href="https://aws.amazon.com/certification/certified-developer-associate/" target="_blank" rel="noopener"'); })());
reset();

// ---------- logging per routine day ----------
const c = ctxFor('2026-10-28', { iso: '2026-10-29', min: 120 }); // 02:00 on 29 Oct, still routine day 28 Oct
study.click('study-done', { dataset: {} }, c);
ok('AWS done logs against ctx.rd, not the calendar date', st.get('study').log['2026-10-28']?.aws?.done === true && !st.get('study').log['2026-10-29']);
ok('ticking done fills planned minutes', S.logOf('2026-10-28').aws.min === 20);
study.change('study-min', { value: '35', dataset: { subj: 'aws' } }, c);
ok('AWS minutes input saves', S.logOf('2026-10-28').aws.min === 35);
study.change('study-min', { value: '12', dataset: { subj: 'mandarin' } }, c);
ok('Mandarin minutes input saves', S.logOf('2026-10-28').mandarin.min === 12);
study.click('study-man-done', { dataset: {} }, c);
ok('Mandarin done fills to plan', S.logOf('2026-10-28').mandarin.min === 15);
study.change('study-min', { value: '-4', dataset: { subj: 'aws' } }, c);
ok('negative minutes clamp to 0', S.logOf('2026-10-28').aws.min === 0);
ok('log shape', JSON.stringify(st.get('study').log['2026-10-28']) === JSON.stringify({ aws: { done: true, min: 0 }, mandarin: { min: 15 } }));
study.click('study-done', { dataset: { iso: '2026-11-01' } }, c);
ok('plan-page tick logs that day', S.logOf('2026-11-01').aws.done === true);

// ---------- weekly view ----------
const ws = S.weekStudy('2026-10-26', st.getSettings());
const planAws = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'].reduce((a, d) => a + studyMinutes(d, st.getSettings()).aws, 0);
ok('weekStudy plan sums studyMinutes', ws.aws.plan === planAws && ws.mandarin.plan === 105);
ok('weekStudy done sums logs', ws.aws.done === 0 + 90 && ws.mandarin.done === 15);
ok('plannedWeek shape for progress', JSON.stringify(S.plannedWeek('2026-10-26', st.getSettings())) === JSON.stringify({ aws: planAws, mandarin: 105 }));

// ---------- countdown, booking ----------
ok('examDays 26 Oct → 56', S.examDays(ctxFor('2026-10-26')) === 56);
ok('examDays exam day → 0', S.examDays(ctxFor('2026-12-21')) === 0);
ok('exam day says today', /exam is today/.test(S.todayCard(ctxFor('2026-12-21'))));
ok('after exam: neutral note', /has passed/.test(study.view(ctxFor('2026-12-23'), '')));
ok('Pearson VUE task shows until booked', /Book your exam on Pearson VUE/.test(S.todayCard(ctxFor('2026-10-28'))));
study.click('study-book', { dataset: {} }, ctxFor('2026-10-28'));
ok('booked hides the task', st.get('study').booked === true && !/Book your exam/.test(S.todayCard(ctxFor('2026-10-28'))));

// ---------- views render ----------
const v = ctxFor('2026-10-28');
const html = [study.view(v, ''), study.view(v, 'plan'), study.view(v, 'week'), study.view(v, 'week/2026-11-02'), S.todayCard(v)];
ok('views render', html.every(h => typeof h === 'string' && h.length > 100));
ok('Back to Today link at the top', html.slice(0, 3).every(h => h.trimStart().startsWith('<p class="study-back"><a href="#/today">Back to Today</a>')));
ok('Mandarin button opens a new tab safely', /href="https:\/\/bhavesh-perso\.github\.io\/Mandarin-app\/" target="_blank" rel="noopener">Open Mandarin app/.test(html[0]) && /Open Mandarin app/.test(html[4]));
ok('plan page lists all 56 days', (html[1].match(/class="study-day/g) || []).length === 56);
st.setSetting('mandarinUrl', 'javascript:alert(1)');
ok('unsafe Mandarin URL is not linked', !/javascript:/.test(study.view(ctxFor('2026-10-28'), '')));
reset();

// ---------- no data file ----------
S.setPlanData(null);
ok('without plan data the views still render', study.view(ctxFor('2026-10-28'), 'plan').includes('Continue the Stephane Maarek course'));
S.setPlanData(DATA);

console.log(fail ? `\n${fail} failed` : '\nAll study tests passed');
process.exit(fail ? 1 : 0);
