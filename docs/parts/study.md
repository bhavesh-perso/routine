## Study (`js/study.js`, `data/aws-plan.json`, `styles/study.css`)

Exam: **AWS Certified Developer – Associate (DVA-C03)** on Mon 21 Dec 2026 (user decision, 26 Oct 2026).
DVA-C02 retires after 30 Nov 2026; DVA-C03 is available from 1 Dec 2026, registration opens 27 Oct 2026.
Domain weights are **preliminary** (Tutorials Dojo summary): Development with AWS Services 30, Security 26,
Testing and Deployment 22, Troubleshooting and Optimization 22. `aws-plan.json` has `weightsPreliminary:true`
and `examGuideUrl`; while it is true, #/study and #/study/plan show one neutral line linking to the AWS exam page.
Once the official exam guide is checked, update `domains[].weight` and set `weightsPreliminary:false`.

Routes: `#/study` (today's study), `#/study/plan` (every day of the plan), `#/study/week[/<mondayIso>]`
(minutes vs plan). No bottom tab: Today links to it and each page starts with "Back to Today".

### How the AWS plan is generated
- Span = `s.studyStart` (inclusive) to `s.exam` (exclusive). Default 26 Oct → 21 Dec 2026 = 56 days = 8 weeks.
  Week 1 starts on the start date (it is a Monday by default; weeks count from the start, not the calendar).
- Phases keep the 5 : 1 : 2 shape: weeks 1–5 content, week 6 Tutorials Dojo practice exams, weeks 7–8 review +
  final practice exam. Other spans scale in whole weeks (`phases(N)`: content = round(W·5/8), practice =
  max(1, round(W/8)), review = the rest, at least 1). Under 4 weeks it splits days instead.
- Minutes per day come only from `plan.studyMinutes(iso, s)` (20 on work days, 90 on off days, from `s.aws`),
  so Today, Week, the .ics export and this page always agree. Off day (`getDay().type === 'off'`) = heavy task,
  work day = light task. Overrides in Settings change which days are heavy.
- Content phase: 14 topics in learning order (IAM, S3, Lambda incl. VPC endpoints/PrivateLink, API Gateway,
  DynamoDB, SQS/SNS/EventBridge/Data Firehose, Bedrock + AgentCore + AI-assisted development (Amazon Q, Kiro),
  KMS/Secrets Manager, Cognito, AI security, CloudFormation/SAM, testing + CI/CD, containers (ECR, ECS, EKS,
  Fargate) + Elastic Beanstalk, CloudWatch/X-Ray). Each topic gets a minute budget = domain weight × topic
  `share` (shares sum to 1 per domain), raised to at least one long session so every topic gets a lab (the
  rest is re-shared by weight). The walker moves on once the cumulative budget is spent and the topic has had
  an off-day lab, and reserves enough days/off days for the remaining topics. With the default calendar the
  split is about 33.5 / 24 / 22.7 / 19.7 % (the one-lab floor for small topics pulls it slightly off target).
- Out of scope for DVA-C03 (not in the data): prompt engineering, RAG design, model selection, SageMaker AI,
  AI governance frameworks.
- Heavy content task = "Lectures: … Lab in your AWS playground account: … Then N questions." Light task = one
  lecture or a flashcard set. Lists cycle; a repeat heavy session is prefixed "Second pass."
- Practice week: each off day = one timed Tutorials Dojo exam (numbered). Work days before the first exam get
  flashcards; after it, reading explanations. If the week has no off day, the first day takes the exam.
- Review weeks: the last off day is the final practice exam. Earlier off days take review topics in order:
  topics marked "Needs review" first (course order), then the rest by domain weight, then by share. Work days
  follow up on the current review topic with flashcards/questions. Work days after the final exam review it.
- `planFor(s)` is pure and memoised on a key of every input it reads (dates, `s.aws`, shift settings,
  overrides, `study.weak`, data loaded). Changing the exam or start date in Settings rebuilds it on next render.
  Marking a topic weak can change review days that have already passed; logs are by date, so nothing is lost.
- Course sections are matched by Stephane Maarek's section NAME (`maarek` field). No section numbers. Course
  material may lag DVA-C03, so topics also have a `learn` field (AWS Skill Builder / AWS docs by name); topics
  with no `maarek` (Bedrock/AI dev, AI security) say "Study:"/"Read up on" instead of "Lectures". Bedrock labs
  say "if your playground allows it" (model access may need enabling); the app never asks for credentials.
- Practice exams: "Tutorials Dojo practice exams (use the DVA-C03 set if available, otherwise DVA-C02 and focus
  on the shared domains)". The final exam task also says to read up on the DVA-C03-only topics.
- If `data/aws-plan.json` fails to load, every day reads "Continue the Stephane Maarek course…" (no throw).

### Data
`study` area (localStorage `routine.v2.study`):
```
{ log: { [routineDayIso]: { aws: { done: bool, min: number }, mandarin: { min: number } } },
  booked: bool,                 // "Book your exam on Pearson VUE" ticked
  weak: { [topicId]: true } }   // NEW: topics marked "Needs review"; absent = none
```
Logs are keyed by `ctx.rd` (routine day), never the calendar date. Minutes are clamped to 0–600.
Ticking "AWS study done" fills the planned minutes if none were typed. "Mandarin 15 min done" sets minutes to
the plan; tapping again (with confirm) clears them.

`data/aws-plan.json`: `exam`, `bookingUrl`, `weightsPreliminary`, `weightsNote`, `examGuideUrl`, `courseNote`,
`domains[{id,name,weight}]`, `topics[{id,name,domain,share,maarek?,learn?,light[],heavy[{lectures,lab,questions}]}]`,
`practice{source,heavy,light,lightBefore}` (`{n}` = exam number), `review{heavy,light,final,afterFinal,guidance}`
(`{topic}`, `{section}`, `{lab}` placeholders). Lab text only; the app never asks for or stores credentials.

### Exports
- `default` module: `init()` fetches the JSON; `view(ctx, arg)`; `click`/`change` for `study-done`,
  `study-man-done`, `study-book`, `study-unbook`, `study-weak`, `study-min` (change; `data-subj`, `data-iso`).
- `todayCard(ctx)`: AWS minutes/topic/short task + done tick, Mandarin tick + "Open Mandarin app"
  (`target=_blank rel=noopener`, only http(s) URLs are linked), countdown, Pearson VUE task until booked.
- `studyFor(iso, s)` → `{ aws:{ min, topic, task, heavy, short, section, kind, week, phase }, mandarin:{ min } }`
  (topic/task are `null` when there is no AWS that day).
- `weekStudy(mondayIso, s)` → `{ aws:{plan,done}, mandarin:{plan,done} }`; `plannedWeek(mondayIso, s)` →
  `{ aws, mandarin }` (the shape progress.js reads via `ctx.studyPlanned`).
- `examDays(ctx)` = exam date − `ctx.iso` in days (0 on exam day, negative after).
- Also: `examName()`, `sourceOf(topic)`, `planFor(s)`, `phases(N)`, `reviewOrder(weak)`, `logOf(iso)`, `setLog(iso, fn)`, `isWeak`, `setWeak`,
  `setPlanData(data)` (tests), `planData()`.

### Gotchas
- Countdown uses the calendar date (`ctx.iso`), logs use the routine day (`ctx.rd`).
- The exam day itself has no AWS session (`studyMinutes` stops at `iso < s.exam`).
- Changing weights, topics or task text only needs `data/aws-plan.json`; keep each domain's shares summing to 1
  (a test checks it).
