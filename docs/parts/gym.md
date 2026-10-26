## Gym (`js/gym.js`, `js/gym-session.js`, `data/exercises.json`, `styles/gym.css`, `tests/gym.test.js`)

Routes: `#/gym` (overview), `#/gym/day/<iso>` (preview of a planned day), `#/gym/session` (active session or the
start screen), `#/gym/summary/<id>`, `#/gym/ex` and `#/gym/ex/<id>` (how-to, chart, records, progression prefs),
`#/gym/history`. Today shows `todayCard(ctx)`. `gym.js` owns planning, progression and records; `gym-session.js`
owns the active session (guided and list logging, rest timer, wake lock, sound, finish, summary).

### Planner (`planAll(s)`, `sessionFor(iso, s)`)
- Start `s.gym.start` (default Fri 30 Oct 2026). Week n = whole 7-day blocks from the start; phase 1 = weeks 1-4,
  2 = 5-8, 3 = 9+. Planning is a greedy walk over days (`build`), memoised on settings + today + a plan version
  that is bumped by start, finish, skip, move and restore (`saveGym(fn, true)`).
- Day facts (`dayInfo`): the slot comes from `s.gymSlots[gymSlotKey(iso)]`; a day is usable only when the slot is
  inside wake-bed, does not overlap the shift, and is not the nap day after a night block. Morning-block work days
  use 19:10-19:55 at the work gym and are flagged `tight`; night-block work days use 15:30-16:30 at home.
- Caps per rolling 7 days: 3 (phase 1), 4 (phase 2), 4 or 5 (phase 3), never more than 3 training days in a row,
  never 7. Phase 1 uses off days only. Work-day sessions: at most 1 per rolling 7 days (2 when phase 3 allows 5).
- Phase 3 gate (`fiveAllowed`): 5 sessions only when every planned session in the 14 days before was done.
  Future sessions count as done, skipped sessions are not planned sessions. Otherwise phase 3 plans Upper/Lower
  and shows "4 solid sessions beat 5 tired ones."
- Light week (`isLightWeek`): week 9, 17, 25, ... when `s.gym.lightWeek`. 2 sets, weights about 80% of the last
  non-light working weight, rounded to the nearest real dumbbell. Light sessions never feed progression.
- A/B order only moves forward when a session is logged. A planned day in the past that was not done is `missed`
  and does not advance the counter, so the next session is the same workout. Future sessions project the order.
  Order restarts at each phase change. Phase 1: Full Body A/B, phase 2: Upper/Lower, phase 3 (gate open):
  Upper, Lower, Push, Pull, Legs.
- Skip: `skips[iso]=true`; the day is excluded and the session rolls to the next valid day. Skipping a moved
  session skips its original day. Move: `moves[from]=to` (forced onto `to`, `from` excluded); `moveTargets` only
  offers days (today to +7) that keep all rules. `restoreSession` clears both. Moving back to the original day
  clears the move.
- Cardio: 10 min in weeks 1-2, +5 per week, capped at 30, on at most 3 sessions per rolling 7 days, never on a
  tight day. Machine is the first ticked of treadmill, bike, rower, else a brisk outdoor walk.
- The `.ics` export and `dayPlan` use `sessionFor` through the provider the app registers:
  `setProviders({ gymFor: gym.sessionFor })`. The slot object has `kind, loc, start, end, cardio` as the provider
  contract needs.

### Data shape (`gym` area; see docs/contract.md)
`{ sessions, active, rest, skips, moves, prefs }`. A session holds `ex:[{ id, from?, sets:[{ type, plan, done }] }]`.
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
- Session length (`estimateMin`) = sets x (work + rest) + 5 min warm-up + cardio; work is 40 s per set, 80 s for
  one-sided moves, or the timed seconds. `planFor` compares it to the slot and offers a shorter version (first 4
  exercises, 2 sets, no cardio). Week 1 rests 90 s; later weeks 90 s for big lifts, 60 s otherwise.

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
