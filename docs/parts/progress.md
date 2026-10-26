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
