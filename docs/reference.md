# Reference

# PWA: install, offline, updates

Files: `manifest.webmanifest`, `sw.js`, `js/pwa.js`, `icons/` (+ `icons/make-icons.py`),
`fonts/` (+ licences), `styles/fonts.css`, head tags in `docs/parts/pwa-head.html`,
checks in `tests/pwa.test.js`.

## How offline works
- On install, `sw.js` precaches every file in its `ASSETS` list into a cache named `VERSION`
  (e.g. `routine-2026-10-26-1`). URLs are relative and resolved against `sw.js` itself, so the
  same file works under `/routine/` on GitHub Pages and at `/` on a local server.
- Opening the app (any navigation, or `index.html`): **network first**, cache as fallback.
  Online you always get the newest `index.html`; offline the cached one opens.
- Everything else from the same origin (JS, CSS, JSON, fonts, icons): **cache first**, then
  network (and the response is cached).
- Non-GET requests and other sites (YouTube search, the Mandarin app) are not touched by the
  service worker; they go straight to the network.

## Releasing an update
1. Change the files.
2. **Bump `VERSION` in `sw.js`** (e.g. `routine-2026-11-02-1`). Without this, cache-first means
   the phone keeps the old JS/CSS forever. Changing `sw.js` is what tells the browser a new
   version exists.
3. If you added a file (a new `js/*.js`, `data/*.json`, font or icon), add it to `ASSETS`.
   `node tests/pwa.test.js` fails and names any file that is missing or unlisted.
4. Push. GitHub Pages takes a minute or two.

What you see on the iPhone: the app checks for a new `sw.js` when it opens and when it comes
back to the foreground (at most every 30 minutes). The new version downloads in the background
and waits. A quiet banner says **"Update available — reload"**. Tapping it activates the new
version and reloads once. If you ignore it, the old version keeps working; the new one takes
over the next time the app is fully closed and reopened. Data in `localStorage` is not touched
by updates.

`js/pwa.js`: `initPwa({ onUpdate })` registers `./sw.js` with scope `./` (skipped on `file:` and
where service workers are unsupported; never throws). `onUpdate(apply)` is called once per
waiting worker, only when the page is already controlled (not on the very first install).
`apply()` posts `{type:'SKIP_WAITING'}` to the waiting worker and reloads on `controllerchange`,
with a guard against reload loops.

## Install on iPhone
1. Open `https://bhavesh-perso.github.io/routine/` in **Safari** (not Chrome or an in-app browser).
2. Tap **Share** (square with an arrow).
3. Tap **Add to Home Screen** (scroll down if needed), then **Add**.
4. Open Routine from the home screen. It runs full screen with its own icon. Open it once while
   online so every file is cached; after that it works offline.

## iOS limits
- **Storage can be cleared.** iOS may delete a home-screen app's data if it is unused for a long
  time or the phone runs low on space. The app asks for persistent storage on first run, but that
  is not a guarantee. **Export a JSON backup regularly** (Settings → Export; the app nudges after
  14 days).
- Home-screen apps and Safari have **separate storage**. Data entered in a Safari tab does not
  appear in the home-screen app and vice versa. Use the home-screen app.
- **No push notifications.** Reminders come from the `.ics` calendar export.
- **Service worker and Add to Home Screen need HTTPS.** The local preview
  (`http://<laptop-ip>:8000`) does not register the service worker on the phone, so offline mode,
  install and the update banner can only be tested on the live GitHub Pages URL.
  (`http://localhost` on the laptop itself does allow service workers.)
- GitHub Pages caches files for about 10 minutes; the service worker revalidates `index.html` and
  precaches with `cache: 'reload'`, so a release shows up as soon as Pages has deployed it.
- Status bar style is `black-translucent`: the page draws under the status bar, so the layout pads
  the top with `env(safe-area-inset-top)` (`viewport-fit=cover`). Zoom is not disabled
  (no `user-scalable=no` or `maximum-scale`); inputs use 16 px text so iOS does not zoom on focus.

## Fonts (bundled, offline)
| File | Font | Weight | Size |
|---|---|---|---|
| `fonts/fraunces-600.woff2` | Fraunces (display) | 600 | 18.1 KB |
| `fonts/fraunces-700.woff2` | Fraunces (display) | 700 | 18.2 KB |
| `fonts/atkinson-400.woff2` | Atkinson Hyperlegible (text) | 400 | 17.2 KB |
| `fonts/atkinson-700.woff2` | Atkinson Hyperlegible (text) | 700 | 17.5 KB |

Total about 71 KB. Latin subset, normal style only, from the npm packages
`@fontsource/fraunces@5.3.0` and `@fontsource/atkinson-hyperlegible@5.3.0`. `@font-face` rules
are in `styles/fonts.css` (`font-display: swap`); the two most-used files are preloaded in the
head. Italics are not bundled; the browser slants the regular face if italic is ever used.

Licences: both fonts are under the **SIL Open Font License 1.1**, which allows bundling and
redistribution with the app (not selling the fonts on their own). Full texts:
`fonts/OFL-Fraunces.txt` (Copyright 2020 The Fraunces Project Authors) and
`fonts/OFL-AtkinsonHyperlegible.txt` (Copyright 2020 Braille Institute of America, Inc.).

## Icon
Generated by `python3 icons/make-icons.py` (Pillow). A disc split by a dark horizon: the top half
is an Ember sun (morning block), the bottom half is indigo with a Bone crescent moon (night
block), on Ink. No transparency (iOS would fill it with black). The maskable icon keeps the mark
inside the central 80% safe zone with a full-bleed Ink background. Outputs: `apple-touch-icon.png`
(180), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `favicon-32.png`.

## Palette
| Name | Hex | Use |
|---|---|---|
| Ink | `#11141a` | background, `theme_color`, `background_color`, icon background |
| Slate | `#1b2029` | raised surfaces |
| Bone | `#ece9e2` | main text, icon moon |
| Mist | `#9aa3b5` | secondary text, outlines |
| Ember | `#f0a53a` | accent, morning block, icon sun |
| Indigo | `#26305c` | night block (icon uses the lighter `#5a6bc4` so it reads on Ink) |

## Gotchas
- `styles/fonts.css` is concatenated into the root `styles.css`, so its `url('fonts/…')` paths
  are relative to the repo root. Do not link `styles/fonts.css` directly.
- Forgetting to bump `VERSION` is the classic mistake: the phone keeps serving old files.
- `sw.js` must stay at the repo root: a worker can only control pages at or below its own folder.

# Progress module (`js/progress.js`, `styles/progress.css`)

## Routes
| Route | Screen |
|---|---|
| `#/progress` | Latest weigh-in, change since start per measure, a line chart per measure, recent weigh-ins (each with Edit) |
| `#/progress/weigh[/<iso>]` | Weigh-in form. Defaults to `ctx.rd`; the date input jumps to that date's entry. Future dates are refused. |
| `#/progress/gym` | Weekly training (last 8 weeks: sessions, kg volume, bodyweight reps, hold seconds), volume chart of completed weeks, PRs per exercise with an estimated-1RM chart |
| `#/progress/study` | AWS and Mandarin minutes per week (last 8 weeks), vs plan when `ctx.studyPlanned` exists |
| `#/progress/habits` | 12-week checklist heatmap (Mon–Sun columns) + per-habit day counts |
| `#/progress/month` | One block per month (up to 12): weigh-in change, gym sessions, volume, study minutes, checklist days, average protein and kcal |
| `#/progress/review` | 2-minute review for the current Mon–Sun week (works any day; shows "n days so far" mid-week) |

Sub-navigation is a `.seg` with Body / Gym / Study / Habits / Months. The review and weigh-in form sit outside it and link back.

## Data
`progress = { weighins: { [iso]: { kg|null, belly|null, notes, m:{ [name]: cm } } }, measures:[name] }`
- Custom measurements (addendum E25): names live in `measures` (max 8, case-insensitive unique, "weight"/"belly"/"kg" reserved). Removing a name only hides it from the form and charts; values stay in each weigh-in, so adding the name again brings the history back.
- A weigh-in needs at least one value. Sanity ranges: kg 25–250, belly 30–200 cm, custom 5–250 cm. Inputs accept a comma decimal ("68,4").
- Everything else is read straight from storage (no imports of gym/food/study):
  - gym volume and PRs: done sessions only (`endedAt` set), working sets only (`type !== 'warm'`), sets with `done` only. Volume = w × reps; one-sided sets add `rl + rr`. Sets with no weight and reps count as bodyweight reps; sets with only `sec` count as hold seconds. Neither is added to kg volume.
  - PRs: heaviest weight (ties broken by reps), most reps at each weight, best Epley e1RM `w × (1 + r/30)` (r = 1 gives w), longest hold, most bodyweight reps. For one-sided sets the weaker side's reps count toward records. Per-session best e1RM gives the chart history.
  - study minutes: `study.log[iso].aws.min + mandarin.min`.
  - food averages: kcal and protein averaged over days that have at least one entry (empty days are not counted as zero).
  - checklist day "completed" = junk + walk ticked and water ≥ target. Target comes from `ctx.waterTarget(iso)` when the app provides it, otherwise `s.water.gym` if a gym session was logged on that routine day, else `s.water.rest`.
- Monthly weigh-in change = latest weigh-in in the month minus the last weigh-in before the month (or the month's first one if none), labelled "since <date>".

## Exports
`default` module (`init`, `view(ctx, arg)`, `click`, `change`), `todayCard(ctx)`, `latestWeight()`, plus helpers used by tests:
`weighins()`, `weighinOn(iso)`, `saveWeighin(iso, entry)`, `deleteWeighin(iso)`, `measures()`, `addMeasure(name)`, `removeMeasure(name)`, `series(key)`, `changeSinceStart(key)` (key `'kg' | 'belly' | 'm:<name>'`), `gymTotals(from,to)`, `gymWeek(monday)`, `prs()`, `epley(w,r)`, `studyTotals(from,to)`, `foodAverages(from,to)`, `habitsOn(iso,s,ctx)`, `checklistDays(from,to,s,ctx)`, `monthSummary(ym,s,ctx,upTo)`, `weekReview(monday,ctx)`, `habitGrid(ctx)`, `exName(id)`, `parseNum(v)`.

## Optional ctx hooks
- `ctx.gymPlanned(mondayIso) → number` — planned sessions that week (Sunday review "x of y planned").
- `ctx.studyPlanned(mondayIso) → { aws, mandarin }` — planned minutes (review and study page).
- `ctx.waterTarget(iso) → ml` — exact water target for a routine day (checklist completion).
Without them the screens show done counts only, with no "planned" wording.

## Gotchas
- `click` returns `false` after `ctx.go(...)` (save, delete, date change) because navigation re-renders; it returns `true` after adding or removing a measurement. Adding a measurement re-renders the form, so numbers typed but not saved are cleared.
- The heatmap writes the count (0–3) as a digit in every cell and the grid has an `aria-label` summary, so colour is never the only signal. Days before first use and after today are dashed, empty cells.
- Charts use the shared `lineChart`; the weekly volume chart leaves out the current, unfinished week.
- `init()` fetches `data/exercises.json` for names; if that fails, the exercise id is shown.
- Tone: no weight-loss, "burned", BMI or BMR wording. The test suite checks rendered pages for those words.

## Tests
`node tests/progress.test.js` — weigh-in save/edit/delete with custom measurements, change since start, weekly volume without warm-ups or unfinished sessions, PR detection, monthly aggregation, Sunday review numbers with and without hooks, Today card, wording check.

# Settings, backup and calendar export

Files: `js/settings.js`, `js/ics.js`, `styles/settings.css`, `tests/settings.test.js`, `tests/ics.test.js`.

## Settings screen (`#/settings`, `#/settings/<section>`)

Eight `details.fold` sections: `shifts`, `overrides` (changed days), `sleep`, `gym`, `food`, `study`,
`progress`, `data`. A link such as `#/settings/data` opens that section and scrolls to it. Which
sections are open is kept in module memory, so re-rendering after a save doesn't collapse them.

Every field saves on `change` (when you leave it) through `setSetting(path, value)` and shows
"Saved". Inputs carry `data-act="set-field" data-path="…" data-kind="time|date|int|text|url"`.
Checkboxes use `set-bool`; equipment uses `set-equip` (`data-gym`, `data-item`).

Validation happens before anything is saved. Invalid values stay in the field (kept as a draft),
get an inline error and `aria-invalid`, and nothing changes in storage:
- Block length and anchor go through `schedule.validateSettings` (block length must be a multiple of 14).
- Times must be `HH:MM`. A shift or sleep window can't start and end at the same minute.
- The exam has to be after the study start.
- Numbers respect the input's `min`/`max`.
- Gym slots are stored as one `'HH:MM-HH:MM'` string (`s.gymSlots.<dayType>`). The screen shows two
  inputs (`data-path="gymSlots.nightOff#0"` / `#1`), and the end has to be after the start. Slot labels: nightWork =
  "After a night shift (next morning)", nightOff = "Night-block off day", morningWork = "After a morning shift",
  morningOff = "Morning-block off day". Hint under the heading: on night shifts the session is the next morning,
  after the drive home and before sleep. A nightWork slot starting before wake is read as the next calendar
  morning (see Gym).
- Gym naming: "Gym near home" / "Gym near work" everywhere (which-gym selects, equipment fieldsets, dumbbell
  fields, "Showers at the gym near work"). Equipment note: runs work on a treadmill or outside.
- Dumbbell lists (`s.dumbbells.home|work`) are typed as `2, 4, 6`. `parseDumbbells` accepts commas,
  semicolons, spaces and an optional `kg`, removes duplicates, sorts them and rejects anything
  outside 0–100 kg.

Sleep: each day type has a sleep and wake time. Wake = the end of the window (storage derives
`s.wake` from it). The screen shows each window's length and never suggests a longer one.

### Defaults (`DEFAULT_SETTINGS` in `js/storage.js`)
- Sleep: nightWork 09:30-16:00, nightOff 09:30-16:30 (moved later so the post-shift gym fits before bed);
  morningWork 21:45-04:30, morningOff 23:15-06:15 unchanged.
- Gym: `gym.start` 2026-10-31, `lightWeek` on. `gymSlots`: nightWork 07:50-08:50 (next morning), nightOff
  18:00-19:15, morningWork 19:15-20:00, morningOff 17:00-18:15. `gymLoc`: nightWork home, nightOff home,
  morningWork work, morningOff home.
- Equipment (both gyms): barbell, rack, machines, dumbbells, cables, bench, treadmill, bike. Dumbbells (both
  gyms): 2-30 kg in steps of 2.
- Protein 130 g (kcal stays 2500).

### One-time default cleanup (`cleanOldDefaults`, flag `meta.defaults2`)
Settings are stored as diffs on the defaults, so a stored value equal to an OLD default was never a real choice.
`runMigrations` runs `cleanOldDefaults` after the schema migration. Once only (flag `meta.defaults2`, returns
false after): for each pair in `OLD_DEFAULTS` the stored value is deleted when it equals the old default (JSON
compare), emptied parent objects are removed, and the new default applies. Anything else the user set stays.
Old defaults: sleep nightWork 08:15-15:00, nightOff 09:00-16:00, gymSlots nightWork 15:30-16:30, morningWork
19:10-19:55, `gym.start` 2026-10-30, protein 120, equipment dumbbells + bench, dumbbells 2-20 kg.

## Changed days (overrides)

`s.overrides[iso] = { kind, block?, start?, end? }`. Week/day screens set overrides too, but this
list is the one place to see them all. Upcoming ones are listed first; past ones are folded away.
- `addOverride(iso, kind, start?, end?)`: `kind` is `off | sick | leave | work-night | work-morning | custom`.
  `work-*` becomes `{ kind:'work', block }`. A `custom` shift gets `block:'night'` if it starts at or after
  12:00 or runs past midnight, otherwise `'morning'` (the same rule as week.js). That block decides which sleep rules apply.
- `clearOverride(iso)` deletes the key, so the pattern applies again.

## Backup

- **Export:** `exportAll()` → `routine-backup-YYYY-MM-DD.json`. `shareOrDownload(text, name, type)`
  uses `navigator.share({ files })` when `navigator.canShare({ files })` allows it. On iPhone that
  opens the share sheet, where you pick Save to Files / iCloud Drive. Otherwise it falls back to an
  `<a download>` with an object URL. `markBackup()` runs after a share or download. It does not run
  if you cancel the share sheet (`AbortError`). Any other share error falls back to a download.
  Safari only allows `share()` straight from a tap, so the export handler doesn't await anything first.
- **Import:** a file input (`accept="application/json,.json"`, `data-act="set-import"`) is laid over the
  "Import backup" button. The flow is: read the text, `JSON.parse`, `parseImport(obj, ctx.iso)` (this
  validates and migrates v1), show counts per area in a `confirm()`, then `replaceAll()`. Errors appear as
  an alert note under the buttons. Nothing is written until you confirm.
- **Reset all data:** two `confirm()` dialogs, then `resetAll()`.
- **Stored size:** `sizeBytes()` in KB, next to the ≈ 5 MB localStorage limit.

`backupBanner(ctx)` (used on Today) returns a quiet `.note.calm` with a link to `#/settings/data` when:
- the last backup is more than 14 days old (by Mauritius date) → "Last backup was N days ago."
- there has never been a backup and `meta.firstUse` is more than 14 days old → "You haven't exported a backup yet."

Otherwise it returns `''`, which includes a fresh install with no data.

## Calendar export (`js/ics.js`)

`buildIcs(s, fromIso, days = 56, { now })` → RFC 5545 text. Export calendar starts from the routine
day (so a night shift that is under way is included) and covers 8 weeks.

- Events are the `shift`, `gym`, `run`, `study` and `weigh` blocks of `plan.dayPlan(iso, s)`, so the calendar
  matches the app exactly. Gym blocks only exist once the app has registered the gym provider
  (`plan.setProviders`). The tests register a stub.
- Times are local, `DTSTART;TZID=Indian/Mauritius:…`, with a `VTIMEZONE` that has one `STANDARD`
  component (+0400 → +0400, no DST). Block minutes ≥ 1440 roll to the next date (a night shift on
  28 Oct ends `20261029T070000`). Negative minutes roll to the previous date. `DTSTAMP` is UTC.
- Weigh-ins (5 min in the plan) are stretched to 10 min so they show properly in Calendar.
  Shifts are `TRANSP:OPAQUE` (busy); everything else is `TRANSPARENT`.
- Every event has `BEGIN:VALARM / ACTION:DISPLAY / TRIGGER:-PT15M`.
- UIDs: `YYYYMMDD-<kind>@routine.bhavesh-perso`, plus `-1`, `-2` when a day has more than one block of
  the same kind. The same plan always produces the same UIDs. Changing settings that move a block to
  another date changes that event's UID.
- Lines end in CRLF and are folded at 75 octets (UTF-8 safe). Text is escaped (`\\ \; \, \n`).

### Importing on iPhone

1. Settings → Backup and data → **Export calendar (.ics)** → in the share sheet, choose **Save to Files**
   (or AirDrop / Mail it to yourself).
2. Open `routine-calendar.ics` from Files (or the mail attachment). iOS shows the events with
   **Add All**. Tap it and choose a calendar.
3. Use a dedicated calendar: first create one called **Routine** in the Calendar app
   (Calendars → Add Calendar). Then the imported events are easy to hide, check or delete in one go.

### What re-importing does on iPhone

The file carries stable UIDs, and some calendar apps use them to update events instead of
duplicating them. Don't rely on that with iOS Calendar: importing a file with Add All generally
adds the events again, so you get duplicates. To refresh the 8 weeks (for example after changing
shift times or adding a changed day):
1. Delete the old events first. The simplest way is to delete the whole **Routine** calendar
   (Calendar → Calendars → ⓘ next to Routine → Delete Calendar), then create it again.
2. Import the fresh file into it.

The alerts are ordinary calendar alerts, so they work with the app closed. That is why the app uses
this instead of push notifications.

## Tests

`node tests/settings.test.js` and `node tests/ics.test.js` (in-memory localStorage, no DOM).

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

## Gym (`js/gym.js`, `js/gym-session.js`, `data/exercises.json`, `styles/gym.css`, `tests/gym.test.js`)

Routes: `#/gym` (overview), `#/gym/day/<iso>` (preview of a planned day), `#/gym/session` (active session or the
start screen), `#/gym/summary/<id>`, `#/gym/ex` and `#/gym/ex/<id>` (how-to, chart, records, progression prefs),
`#/gym/history`. Today shows `todayCard(ctx)`. `gym.js` owns planning, progression and records; `gym-session.js`
owns the active session (guided and list logging, rest timer, wake lock, sound, finish, summary).

### Planner (`planAll(s)`, `sessionFor(iso, s)`)
- Start `s.gym.start` (default Sat 31 Oct 2026). Week n = whole 7-day blocks from the start. Same 5-day rotation
  from week 1. Planning is a greedy walk over days (`build`), memoised on settings + today +
  plan version (bumped by start, finish, skip, move, restore via `saveGym(fn, true)`) + run-plan version.
- Day facts (`dayInfo`): slot from `s.gymSlots[gymSlotKey(iso)]`. A slot that starts before that date's wake is
  on the NEXT calendar morning (`nextDay`, minutes +1440). `abs = n*1440 + a` (absolute start minute). Usable only
  when it ends by bed; on a work day a `nextDay` slot also needs start >= shift end + drive (`s.drive`), a same-day
  slot must not overlap the shift; off-day same-day slots start at or after wake. Morning-block work days use
  19:15-20:00 at the work gym, flagged `tight`. Night-block work days: `nightWork` slot 07:50-08:50 = the morning
  after the night shift, at the home gym (flagged `nextDay`, belongs to the work day's plan).
- Caps (`allowed(n, i, s, has)`, constants at the top of `gym.js`): `MAX_WEEK` 5 sessions per rolling 7 days;
  `MAX_RUN` 3 training days in a row; `MAX_WORK_WEEK` 3 on work days per rolling 7; `MAX_TIGHT_WEEK` 2 tight
  sessions per rolling 7; `MIN_GAP` 20 h between two session starts (compares `abs`). `moveTargets` uses the same
  `allowed`.
- Off days take sessions freely. A work day only tops up (`prefer`): used when the 3 days before + off days in the
  next 3 that can still take a session (slot ok, 20 h gap kept) + itself fit under the weekly cap.
- Sets per exercise: 2 in weeks 1-2, in light weeks, and in sessions with an attached test run; else 3.
- Light week (`isLightWeek`): week 9, 17, 25, ... when `s.gym.lightWeek`. 2 sets, weights about 80% of the last
  non-light working weight, rounded to the nearest real dumbbell. Light sessions never feed progression.
- Order: Upper, Lower, Push, Pull, Legs (`KINDS`). It only moves forward when a session is logged. A planned day in
  the past that was not done is `missed` and does not advance the counter, so the next session is the same
  workout. Future sessions project the order. A logged session with an unknown old kind advances the
  counter by one. Templates in `data/exercises.json` (machines + free weights): Upper (machine chest press, cable
  row, DB shoulder press, lat pulldown, lateral raise, triceps pushdown), Lower (leg press, DB RDL, leg curl, leg
  extension, hip abduction, machine calf raise), Push (DB bench, machine shoulder press, incline DB press, pec
  deck, lateral raise, triceps pushdown), Pull (lat pulldown, cable row, DB row, face pull, cable curl, hammer
  curl), Legs (barbell squat, barbell RDL, split squat, hip adduction, machine calf raise, cable crunch). Old
  templates stay in the data for old logs. Exercises needing unticked equipment swap to their alt.
- Skip: `skips[iso]=true`; the day is excluded and the session rolls to the next valid day. Skipping a moved
  session skips its original day. Move: `moves[from]=to` (forced onto `to`, `from` excluded); `moveTargets` only
  offers days (today to +7) that keep all rules. `restoreSession` clears both. Moving back to the original day
  clears the move.
- Slot object: `{ iso, kind, loc, start, end, time, nextDay, run, cardio, light, done, week, tight, ... }`.
  `cardio` is the attached run's estimated minutes (0 when none), kept for the provider contract. `locName(loc)` =
  "Gym near home" / "Gym near work"; `whenText(x)` = "Tomorrow morning HH:MM-HH:MM (after the shift)" for
  `nextDay`, else `x.time`. Week, Day and Today screens use both.
- The `.ics` export and `dayPlan` use the providers the app registers:
  `setProviders({ gymFor: G.sessionFor, runFor: G.runFor })`.

### Running plan (`js/run.js`, `data/run-plan.json`, `tests/run.test.js`)
`run.js` is pure (no DOM, no storage). `gym.js` calls it from the planner; `gym-session.js` renders the cards.
`gym.js` fetches `data/run-plan.json` in `init` (`setRunData`); no file = no runs.
- Shape: `{ goal:{km,min}, blocks:{Base,Build,Strength,Speed}: text, paceOffset:{easy:75,tempo:15,interval:-15,race:0},
  easyPace:{block: s/km before any test}, weeks:[52 x { w, block, runs:[A,B,C] }] }`. A run def:
  `{ type: walkrun|easy|long|tempo|interval|test, title, text, min? | km?, goal?, pace? }`. `pace` names the offset.
  Blocks: Base wk 1-12 (walk/run, then easy), Build 13-24, Strength 25-36, Speed 37-52. Time trials (`test`) in
  weeks 12, 24, 36, 52. Goal 10 km under 45 min.
- Run week = gym week. `runWeekOf(w)`: after week 52 the plan repeats weeks 41-52. Only complete weeks are planned.
- Assignment (`assignWeek(w, sessions, days)`): each week has runs A, B, C. Candidates are the week's non-leg
  sessions (Upper/Push/Pull, never Lower/Legs), not tight. Runs go after the lift on the same day (attached,
  `slot.run`, `slot.cardio = estMin`) or on a free off day (standalone). Standalone runs and attached runs never
  count toward gym caps.
  - Weeks 1-11: A, B, C attach in date order; extras are dropped from the end.
  - Week 12 on: C (long run / time trial) is placed first and is not dropped while any non-leg session or free day
    exists, then B, then A (A drops first, then B). C fallback chain: standalone on a free off day with a usable
    slot (prefers one not before a leg day) > off-day Upper/Push/Pull > any non-tight session (`nextDay` last) >
    standalone on any other free off day > the last non-leg session of the week even if tight. Rank for B/A:
    off-day session, then same-day, then `nextDay`.
  - `first` flag: a test attached to a session is done first, fresh (run card shown before the exercises); that
    session gets 2 sets and a short lift. Other runs come after the exercises.
- Paces: `riegel10k(sec, km) = sec * (10/km)^1.06`; race pace = Riegel of the latest logged test, per km
  (`racePaceOf`). Target = race + offset (easy +75, tempo +15, interval -15, race 0 s/km). Before a test: easy runs
  use `easyPace[block]`, others show "Log a test run to get exact paces". `paceText` =
  `m:ss/km · treadmill X.X km/h · incline 1%`. Walk/run text: run 7.5-8.5 km/h, walk 5.5-6 km/h, incline 1%.
- Estimate (`estMin`): `def.min`, else `km x easy pace / 60` (+10 min warm-up and cool-down for tests). It feeds
  session length and the calendar.
- Logging: Run card (time as `47.5` or `47:30`, distance in km; `parseMin`/`parseKm`/`validateRun`: 0.1-60 km,
  1-600 min) on the session screen, the run screen `#/gym/run/<iso>` and standalone days. Edit and Delete
  supported. `logRun(iso, km, min, s, now, opts)` fills the planned run of that date. Free "Log a run" form on the
  gym overview (`opts.free = { type: easy|long|test, today }`): any date up to today, run of the chosen type; a
  date with a planned run fills that one instead. A logged test sets paces at once.
- `gym.runs` (in the gym area): `{ [iso]: { key:'A'|'B'|'C'|null, type, title, km, min, at, free? } }`. One run per
  date. Written only through `saveGym`.
- Provider `runFor(iso, s)` -> `{ title, start, end, km, key, estMin }` for a standalone run, else null.
  Standalone start = the day's gym slot start, length = estimate. `runOn(iso, s)` = attached or standalone;
  `weekRuns(w, s)` = this week's A/B/C with day and done flag.
- Planner output: attached `x.run = { key, week, block, ...def, estMin, first? }`; `planAll` also keeps the
  standalone runs (`memo.runs`).
- `dayPlan`: a `run` block `Run: <title>` (standalone, after the day's meals; `settle` treats `run` as busy so meals
  move off it). Gym block label gains " + run N min" and reads "Gym: Upper (gym near home)". `ics.js` exports
  `run` blocks (kinds: shift, gym, run, study, weigh). Week and Day screens show the run line; Today tile shows
  "Tomorrow HH:MM" for a `nextDay` session and the run title on a standalone day.
- Running card (gym overview, `runningCard`): block + run week (+ "repeat" after 52), goal, block text, this week's
  runs (when, done), latest test and race pace, next test week, best 5 km and best 10 km (`bestOver`, +-0.1 km),
  and the free "Log a run" form.

### Data shape (`gym` area; see docs/contract.md)
`{ sessions, active, rest, skips, moves, prefs, runs }` (`runs`: see Running plan). A session holds `ex:[{ id, from?, sets:[{ type, plan, done }] }]`.
`done` is `{ w?, r?, rl?, rr?, sec?, rpe?, at }`; `skip:true` on a set means skipped. Warm-up sets (`type:'warm'`)
never count to volume, records, history or progression. One-sided moves log `rl`/`rr`; reps for records = the weaker
side, volume = both sides. Only `saveGym` writes this area. A session belongs to the routine day it started on (`rd`)
and keeps `planIso` (the plan day it fills, which differs after a move).

### Progression, records, warm-ups
- `suggest(exId, loc, s)` (kg): all sets at the top of the range and no set at effort 9+ gives the next weight
  (`nextWeight`: +increment, then up to the next dumbbell that exists when rounding is on; if none is heavier the
  weight stays and reps are suggested). Effort 9+ holds. Reps below the range two sessions in a row holds. Otherwise
  the lowest reps + 1. Bodyweight adds a rep, timed holds add 5 s. Increment and rounding are per exercise in `prefs`
  (defaults 2.5 kg, rounding on for dumbbell moves). Dumbbell list per gym is `s.dumbbells[loc]`.
- e1RM is Epley: `w * (1 + r/30)`, equal to `w` at 1 rep. Records: heaviest, best e1RM, most reps at each weight,
  most bodyweight reps, longest hold. `checkPR` flags nothing the first time an exercise is logged.
- Warm-up sets: before the first big lift only (`big:true` in the data), about 50% then 75% of the working weight,
  rounded down to real dumbbells, only when the weight is above the lightest dumbbell. They use 60 s rest.
- Session length (`estimateMin`) = sets x (work + rest) + 5 min warm-up + the attached run's minutes; work is 40 s per set, 80 s for
  one-sided moves, or the timed seconds. `planFor` compares it to the slot and offers a shorter version (first 4
  exercises, 2 sets, no run). Week 1 rests 90 s; later weeks 90 s for big lifts, 60 s otherwise.

### Rest timer
`gym.rest = { startedAt, sec }` is written when a set is logged (only if more sets remain). The clock is always
`restLeft(rest, now)` computed from the stored timestamps, so it survives app switches and reloads. `mounted` ticks a
1 s interval only while the clock node exists and left > 0. The two-tone beep plays only if the rest ended less than 3 s
ago while the page is open (no background alerts; iOS needs the first tap, done in `unlockAudio`). The screen wake
lock is held only on the session screen and is released on finish or discard.

### Styling (`styles/gym.css`)
Classes: `gym-now` (today/next tile), `gym-up` (coming-up list), `gym-acts`, `gym-plan`, `gym-how`, `gym-guided`,
`gym-exname`, `gym-target`, `gym-lb`, `gym-pr`, `gym-edit`, `gym-upnext`, `gym-inputs`/`gym-in`, `gym-rpe` (5-column grid),
`gym-rest` (`.over` when done), `gym-clock`, `gym-rest-msg`, `gym-list`, `gym-sets`, `gym-set` (`.done`), `gym-finish`,
`gym-safety`, `gym-sum`. Base tokens only; every control at least 44 px, inputs 16 px+.

### Gotchas
- Dates are integer day numbers; times of day are minutes. Do not compare timestamps for day logic.
- Records in the summary and the live "New PR" flag follow the same rule (nothing on the first logged session).
- The A/B counter is computed on every build from logged sessions; never store it.
- `_setToday(iso)` pins "today" for tests; the app derives it from `routineDayAt`.
- Tap handlers read typed values from inputs by id (`gym-in-<field>-<suffix>`) on click; `input` events are not routed.
- Swapping an exercise mid-session keeps the sets already done under the original and inserts the replacement after it.

# Food module (`js/food.js`, `js/food-plan.js`, `styles/food.css`)

## Routes (`#/food/...`)
| Route | Screen |
|---|---|
| `#/food` | Today: totals vs target (~2,500 kcal / 120 g, g/kg from the latest weigh-in), planned meals with **Log this meal**, per-meal swap, logged list, recents, household portions, custom food, whey toggle (off by default) |
| `/week[/<iso>]` | Plan for Mon–Sun with kcal and protein per day, batch-cook days marked |
| `/prep/<iso>` | What to cook on a batch-cook day: ingredients, numbered steps, where each box goes |
| `/shop[/<iso>]` | Weekly fresh list (Mon–Sun) and monthly staples list (calendar month of that Monday), tick-off, pack sizes, extras from `foods.json` |
| `/recipes`, `/recipe/<id>` | Library, "Watch how" (YouTube search link), mark as cooked |
| `/skills` | One-new-recipe-a-week checklist, cooked map |

## How the plan works
- Cooking happens only on prep days (`isPrepDay`: first off day of each off stretch). Each prep day cooks 2 batch dishes x 4 boxes. Dishes come from `POOL` in `food-plan.js` by prep-day ordinal counted from 2026-10-26 (`pool[2i]`, `pool[2i+1]`): 25 dishes, the cheapest listed twice (31 entries, at least 4 apart), so consecutive prep days never share a dish and every dish comes round once per ~16 prep days.
- Boxes are eaten from the prep day until the next prep day: work days use 2 boxes (night: Meal 1 + packed Meal 2; morning: packed Meal 2 + Meal 3), off days and prep days use 1 (Meal 2; the prep day's is fresh). Dishes alternate; on two-box days the order flips on odd day numbers. Worst case is 8 boxes between prep days, which is what a prep day cooks. `batchFor`, `boxesNeeded`, `whereBoxesGo` expose this.
- Every other slot is a quick item (`recipes.json` `quick`, filtered by `slots`; pack-for-work only on work days) picked by search: rotated by day number, the first combination that puts the day in 2,400–2,650 kcal and 115–135 g protein and differs from yesterday. `topups` (milk, banana, peanuts...) are added when a day is still under target. Plans chain from 2026-10-26 and are memoised per settings object.
- `extra: true` quick recipes (fish and potatoes) are never planned; they show up in the swap list.
- Nutrition is always computed from `foods.json` (per 100 g; `pcs` foods use `shop.each`). No fixed kcal/protein numbers live in recipes.
- Swaps: `food.swaps[iso][slot] = recipeId`. A swap replaces that meal only; the box it replaced stays in the fridge or freezer and later days do not move.

## Budget (Rs per month, `s.budget`, default 5,000)
- Every shop food has `rs` in `foods.json` (estimated Mauritius price per kg, litre or piece, 2026; eggs, milk, chicken and rice checked against Numbeo/blog prices Oct 2026). `priceOf`, `recipeCost` (per box/serving), `listCost`, `monthCost` in `food-plan.js`.
- `monthCost` prices what the month's plan eats (fresh + staples), not the packs bought.
- Quick-meal picks: among combinations in the kcal/protein band that differ from yesterday, the first (rotation order) whose quick meals + top-ups fit `budget / 30.4 - boxes eaten` wins; otherwise the cheapest such combination.
- Shop screen shows the month estimate vs budget and the week's fresh cost; recipes show Rs per box.

## Data
- `food = { log:{[rd]:[{ n,k,p,meal,t,src?,qty? }]}, recent:[ 'r:<recipeId>' | portionId ], shop:{[mondayIso]:{key:true}}, staples:{['YYYY-MM']:{key:true}}, cooked:{recipeId:iso}, swaps:{[iso]:{slot:id}} }`
- Logging uses `ctx.rd`; `t` is the time of day when tapped (`ctx.min`), `meal` the slot.
- Protein per kg reads `get('progress').weighins` directly (latest entry with kg).
- Recipe rules (tested): <= 8 ingredients excluding `basics`, no pork/beef/alcohol, every ingredient key exists in `foods.json`.
- Shop quantities are summed from `dayDetail(...).uses` (full batch recipes counted on the prep day, quick items and top-ups on the day eaten). Pack suggestion: biggest packs first, then the smallest pack that covers the rest.

## Exports
`food.js`: default module, `todayCard(ctx)`, `mealsFor(iso,s)`, `prepFor(iso,s)`, `totals(iso)`, `logEntry`, `removeEntry`, `setSwap`, `markCooked`, `tick`, `latestKg`, `ingText`, `loadData`.
`food-plan.js` (pure, no DOM): `setData`, `mealsFor`, `dayDetail`, `prepFor`, `dishesFor`, `batchFor`, `boxesNeeded`, `whereBoxesGo`, `slotOptions`, `groceryFor`, `packsFor`, `monthRange`, `nutrition`, `perServing`.

## Gotchas
- Data loads in `init()` (fetch of `data/foods.json` and `data/recipes.json`); until then the screens show a reload note and the plan is empty.
- Tests set data with `setData` and mock `localStorage` as `tests/storage.test.js` does.
