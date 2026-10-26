# Module contract (internal, for parallel build)

Read this before writing a module. The app is a static ES-module PWA, no framework, no build step,
served under `/routine/` on GitHub Pages, so **every path is relative** (`data/x.json`, never `/data/x.json`).

Spec sources, in order of priority (later wins on conflict):
1. `/mnt/user-data/uploads/prompt.md` — the build prompt (sections referenced below as §N).
2. `/mnt/user-data/uploads/decisions.md` — answers to questions.
3. `/mnt/user-data/uploads/prompt-addendum.md` — addendum, **wins over the prompt**. Ideas only from AGPL apps; never copy their code.
4. Notes in your agent brief (user feedback from chat).

Hard rules from the brief: dark theme, sentence case, plain active voice, no ALL-CAPS eyebrow labels,
no "→" on every button, tap targets ≥ 44 px, inputs font-size ≥ 16 px, contrast ≥ 4.5:1,
never weight-loss / calorie-cutting / "calories burned" language, never shame, neutral tone.
Date maths on integer day numbers only (`dayNum`, `isoOf`), never on timestamps. Times of day = minutes since midnight.
No external network requests at runtime except user-initiated links (YouTube search, Mandarin app).

## Files you may touch
Only the files named in your brief. Put your CSS in `styles/<module>.css` (it is concatenated into
`styles.css` later). Put tests in `tests/<module>.test.js` (plain node, `assert`-style, print PASS/FAIL,
exit non-zero on failure). Put your notes for the reference doc in `docs/parts/<module>.md`
(how it works, gotchas, data shape). Do not edit shared files (`js/storage.js`, `js/schedule.js`,
`js/plan.js`, `js/util.js`, `js/chart.js`, `js/app.js`, `styles/base.css`); if you need a change
there, describe it in your final report instead.

## Module shape
Each page module default-exports:
```js
export default {
  name: 'gym',                         // route name and data-act prefix
  async init() {},                     // optional: fetch('data/….json'); must not throw (catch and degrade)
  view(ctx, arg) { return '<h1 class="page-title">…</h1>…'; }, // HTML string for #/gym or #/gym/<arg>
  click(act, el, ctx) { return true; },  // act = el.dataset.act, e.g. 'gym-log-set'. Return true to re-render.
  change(act, el, ctx) { return false; },// fired on 'change' for inputs/selects with data-act. Return true to re-render.
  mounted(ctx) {},                     // optional: runs after every render of this page (timers, focus)
};
```
Also export named helpers that other screens call (listed per module below).

`ctx` = `{ s, iso, min, ms, rd, go(hash), rerender(), notify(msg) }`
- `s` settings object from `getSettings()` (see storage.js `DEFAULT_SETTINGS`).
- `iso` today's calendar date in Mauritius, `min` minutes since midnight now, `ms` = Date.now().
- `rd` the routine day (resets at wake, not midnight). **Log daily things against `ctx.rd`.**
- `go('#/gym/session')` navigates; `notify('Saved')` shows a short message.

Events: the app listens for `click` on `[data-act]` and `change` on `[data-act]` inside `<main>` and routes
by prefix (`gym-`, `food-`, `study-`, `prog-`, `set-`). Use `data-*` attributes for arguments.
`input` events are not routed (re-rendering while typing loses focus): read typed values on a button click.
Use `confirm()` for destructive actions. Use `<a href="#/food/plan">` for navigation.

Routes: `#/today`, `#/week`, `#/day/<iso>`, `#/gym[/<arg>]`, `#/food[/<arg>]`, `#/study[/<arg>]`,
`#/progress[/<arg>]`, `#/settings[/<arg>]`. Study is reached from Today (no tab).

## Shared modules (read-only for you)
- `js/schedule.js`: `getDay(iso, s)` → `{ date, cycleDay, type:'work'|'off', block:'night'|'morning', shiftStart, shiftEnd, endsNextDay, isFirstOffAfterWork, isLastOffBeforeWork, isBlockSwitchDay, override }`; `dayNum`, `isoOf`, `describeShift(iso, s)`.
- `js/util.js`: `toMin('HH:MM')`, `fmt(min)`, `addDays(iso,n)`, `esc(text)` (**escape all user text**), `dow(iso)` (0=Sun), `dowName`, `mondayOf(iso)`, `dayLabel(iso)` ("Wed 28 Oct"), `monthLabel`, `nowLocal()`, `round1`.
- `js/plan.js`: `dayPlan(iso, s)` → blocks `{ start, end, kind, label, slot?, tight?, loc? }` (minutes relative to the date's midnight; ≥1440 = next day; kinds: sleep, weigh, meal, study, walk, reminder, drive, shift, gym, cook). `wakeFor(iso,s)`, `bedFor(iso,s)`, `routineDayAt(iso,min,s)`, `styleKey(iso,s)` / `gymSlotKey(iso,s)` → 'nightWork'|'nightOff'|'morningWork'|'morningOff', `isPrepDay(iso,s)` (batch-cook day = first off day of each off stretch), `studyMinutes(iso,s)` → `{aws, mandarin}`, `switchCard(iso,s)`, `timeLabel(min)`. Gym times come from the gym module via a provider the app registers.
- `js/chart.js`: `lineChart(points[{x: iso|number, y}], { label, unit, decimals })` → SVG figure HTML.
- `js/storage.js`: `get(area)`, `update(area, fn)` (fn mutates the area object; saves only that area; returns false if the save failed — the app already shows the error banner), `getSettings()`, `setSetting('a.b', v)`, `getDayLog(iso)`, `setDayLog(iso, patch)`, `getMeta()`, `markBackup()`, `sizeBytes()`, `exportAll()`, `parseImport(obj, todayIso)`, `replaceAll(data)`, `resetAll()`, `version()`.

## Data shapes (one localStorage key per area: `routine.v2.<area>`)
- `meta`: `{ schema:2, firstUse:iso, lastBackup:ms|null, persistAsked:bool }`
- `settings`: only values the user changed (merged over `DEFAULT_SETTINGS`). `overrides[iso] = { kind:'off'|'leave'|'sick'|'work'|'custom', block?, start?, end? }`.
- `days[iso]`: `{ junk:bool, water:ml, walk:bool }` (checklist; routine-day keyed)
- `food`: `{ log: { [iso]: [ { n:name, k:kcal, p:protein_g, meal:'m1'|'m2'|'m3'|'snack'|null, t:'HH:MM'|null, src?:id, qty?:number } ] }, recent:[foodKey], shop:{ [weekMondayIso]: {itemKey:true} }, staples:{ ['YYYY-MM']: {itemKey:true} }, cooked:{ recipeId: iso }, swaps:{ [iso]: { m1?:id, … } } }`
- `study`: `{ log: { [iso]: { aws:{ done:bool, min:number }, mandarin:{ min:number } } }, booked:bool }`
- `gym`: `{ sessions: { [id]: Session }, active:id|null, rest:{ startedAt:ms, sec:number }|null, skips:{ [iso]:true }, moves:{ [fromIso]: toIso }, prefs:{ [exId]: { inc, round } } }`
  - `Session = { id, rd, planIso, kind, loc, light, short, startedAt:ms, endedAt:ms|null, feel:'bad'|'ok'|'good'|null, notes, ex:[ { id, from?, sets:[ { type:'warm'|'work', plan:{ w?, r?, sec?, rest }, done:null|{ w?, r?, rl?, rr?, sec?, rpe?, at:ms } } ] } ] }`
  - A session is done when `endedAt` is set. It belongs to the routine day it started on (`rd`).
- `progress`: `{ weighins: { [iso]: { kg, belly, notes, m:{ [name]: cm } } }, measures:[name] }`

## Named exports other screens use
- gym.js: `planAll(s)`, `sessionFor(iso, s)` → `{ iso, kind, loc, start:'HH:MM', end:'HH:MM', cardio, light, done, week, phase }|null`, `todayCard(ctx)`, `missedOn(iso, s)` (planned, not done, not skipped), `moveTargets(iso, s)` → [iso], `moveSession(from, to)`, `skipSession(iso)`, `restoreSession(iso)`, `exerciseName(id)`, `historyFor(exId)`, `prs()`, `weekVolume(mondayIso)`.
- food.js: `todayCard(ctx)`, `mealsFor(iso, s)` → `{ m1, m2, m3, snack }` each `{ name, k, p, recipe?:id, prep?:bool }`, `prepFor(iso, s)` → `{ cook:[{id,name,portions}], note }|null`, `totals(iso)` → `{ k, p }`.
- study.js: `todayCard(ctx)`, `studyFor(iso, s)` → `{ aws:{ min, topic, task, heavy }, mandarin:{ min } }`, `weekStudy(mondayIso, s)` → `{ aws:{plan,done}, mandarin:{plan,done} }`, `examDays(ctx)`.
- progress.js: `todayCard(ctx)` (weigh-in prompt on weigh day, Sunday review link on Sunday), `latestWeight()` → kg|null.
- settings.js: `backupBanner(ctx)` → HTML ('' when not needed).
- ics.js: `buildIcs(s, fromIso, days=56)` → string.
- pwa.js: `initPwa({ onUpdate })` registers `sw.js`; `onUpdate(applyFn)` is called when a new version is waiting.

## Shared CSS classes (styles/base.css)
`.page-title` (serif h1), `.muted`, `.num`, `.note` (`.alert`, `.calm`), `.list`, `.rules` (hairline list),
`.row`, `.grow`, `.item`, `.tile`, `.btn` (`.primary`, `.ghost`, `.small`, `.wide`, `aria-pressed`),
`.check` (checkbox-style toggle), `.chips`, `.field` (label span + input), `.toggle`, `details.fold`,
`.seg` (sub-tabs; mark current with `aria-current="page"`), `.bar>b` (progress), `.tag`.
Tokens: `--ink --slate --line --bone --mist --ember --indigo --indigo-hi --display --text`.
Avoid identical cards everywhere: mix `.rules` lists, plain sections and the occasional `.tile`.
