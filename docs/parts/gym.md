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
