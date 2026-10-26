# Decisions (ADR-lite)

Durable "why" behind the app. Newest last. The full brief is the build prompt plus its addendum; these entries record answers and choices made along the way.

## 2026-10-25 — Brief answers
- Repo `bhavesh-perso/routine`, public, GitHub Pages from `main` / root, no custom domain. Live URL https://bhavesh-perso.github.io/routine/.
- Commits authored only by Bhavesh Gajadhar <bgajadhar16@gmail.com>, repo-local git config. No AI attribution anywhere.
- Shift pattern: 14-day cycle (work work off off off work work off off work work work off off), anchor Wed 28 Oct 2026 = cycle day 0, 28-day blocks alternating night (19:00–07:00) and morning (07:00–19:00). Dates before the anchor extend the pattern backwards (true modulo).
- Per-day overrides (leave/off, sick, swap to work, custom times) win over the pattern.
- Daily things reset at wake time, not midnight, on every day type ("routine day").
- Sleep windows are fixed by the user: night work 08:15–15:00, night off 09:00–16:00 (incl. the first off day after nights; no "normal hours" toggle), morning work 21:45–04:30, morning off 23:15–06:15 (21:45 if the next day is work). Never suggest 8–9 h.
- Block switch: nights → mornings: nap 08:15–11:30 after the last shift, sleep 21:45, next night 21:45–04:30. Mornings → nights: bed 2 h later on each of the two off days (01:15→08:15, 03:15→10:15). No pre-shift nap added.
- Study: AWS DVA-C02, exam Mon 21 Dec 2026, plan from Mon 26 Oct (8 weeks). AWS 20 min on work days, 90 min on off days; Mandarin 15 min every day. Labs in the employer's AWS playground; the app never stores credentials.
- Gym: start Fri 30 Oct 2026, phased ramp 3 → 4 → 5 sessions per rolling 7 days, Phase 3 only with 100% of planned sessions in the last 14 days. Light week every 8 weeks at phase changes. Default equipment dumbbells + bench. Work gym after the shift in the morning block. "Move to…" day picker, no drag.
- Food: track kcal and protein, ~2,500 kcal / 120 g. No pork, beef or alcohol. Vegetables hidden in dishes (frozen mixed veg). No whey by default. Grocery lists metric, budget-first, weekly fresh + monthly staples.
- Declined: sleep-quality check, monthly photo reminder, shift snack checklist, a rest timer that survives screen lock, push notifications.

## 2026-10-26 — Built in chat, delivered as files
- No Claude Code on the personal laptop, so the app is built in a chat session and delivered as files/zip that Bhavesh uploads to GitHub himself. The session can read the repo but cannot push to it.

## 2026-10-26 — Checklist taps confirm before completing
- Tapping a checklist item asks "Mark … as done?" and then stays done; tapping again does nothing. A small Undo button (with its own confirmation) reverses a genuine mistake. Water uses +250 / − only. Reason: accidental taps were unticking items.

## 2026-10-26 — Addendum applied (ideas from open-source apps)
- The addendum wins over the prompt where they disagree. Ideas only; no code copied from AGPL projects.
- Storage split by area under separate keys (`routine.v2.meta|settings|days|food|study|gym|progress`), every read/write guarded, failures shown in a banner. Schema 2 migrates the single-key v1 store automatically; gym taps logged in v1 before the plan start or in the future were test taps and are dropped.
- Gym logging records planned vs done per set, warm-up vs working sets, RPE, left/right for one-sided moves, seconds for timed moves; the rest timer is computed from stored timestamps; sessions in progress are saved on every tap and resumed.

## 2026-10-26 — Meal plan reworked after feedback
- Feedback: the recipe library was too much cooking for 2,500 kcal / 120 g every day, but the same four meals every day is not wanted either. Decision: proper cooking happens only on prep days (the batch-cook day = first off day of each off stretch, about 1–2 per week); every other meal is assembled from the batch plus no-cook or ≤10-minute options, rotating so no day repeats the one before. See `docs/reference.md` → Food.

## 2026-10-26 — Day-plan details not spelled out in the brief
- Switch days run on a daytime rhythm; meal/study/walk times on those shorter days scale between wake and bedtime, and anything landing inside gym, study or cooking moves to just after it.
- "Pack shift food and gym bag" shows before leaving on night work days and before bed on any day that is followed by a work day.
- The 26–27 Oct off days fall in a (backwards-extended) morning block, so they show the mornings → nights sleep switch ahead of the first night shift on 28 Oct, which matches shifting sleep later before nights.
- A routine day runs from wake to the next wake; minutes in a day plan are relative to that date's midnight (a night shift ending 07:00 next day is 1860).

## 2026-10-27 — Feel like an app, not a webpage
- Stays a PWA on GitHub Pages: a native iOS app would need a Mac, Xcode and a paid Apple developer account; an Android wrapper doesn't help on an iPhone.
- Browser `confirm()`/`alert()` boxes replaced by bottom sheets (`js/sheet.js`); click handlers that ask are async. Checklist still confirms before done (see 2026-10-26).
- Top bar with back button, compact title on scroll and a Settings gear (`js/shell.js`); Settings left the tab bar, which now has 5 tabs.
- Screen transitions follow direction (deeper = from the right, back = from the left, tabs fade). Swipe from the left edge goes back, only in the installed app because Safari has its own edge swipe.
- Lists are grouped cards with tappable rows; the gym "Coming up" rows open the day screen, which holds Move/Skip.

## 2026-10-27 — More recipes, monthly budget
- Feedback: too much chicken curry; wants many more easy recipes and a food budget of about Rs 5,000 a month. Fish/seafood, beans/lentils/soya, goat/lamb and paneer/cheese are all fine (still no pork, beef, alcohol).
- 17 new batch dishes (25 in all, 7 with chicken) and 10 new quick meals; same rules (≤ 8 ingredients, ≤ 30 min active, 4 boxes of 450–850 kcal / 30–65 g).
- Prices added per food; Settings → Food has the monthly budget. With real 2026 prices the plan comes to about Rs 5,400–6,300 a month at 2,500 kcal / 120 g; the planner leans on cheap dishes (twice in the rotation) and cheap quick meals but does not drop variety or targets to force 5,000.
- Fixed: rejected meal combinations were being added to the shopping list.
- Follow-up: kept as is (no dishes dropped, targets unchanged). Budget card simply shows the plan runs over; raise the budget in Settings if wanted.
