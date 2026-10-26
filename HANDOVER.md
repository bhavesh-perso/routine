# HANDOVER — read first in new session

Owner: Bhavesh Gajadhar (Mauritius, 12h shifts). App "Routine" = static ES-module PWA, no build. Live https://bhavesh-perso.github.io/routine/ (repo `bhavesh-perso/routine`, main, root). Local clone: `C:\Users\bhali\claude\routine` (Windows, Claude Code).

## Rules (do not break)
- Commits author `Bhavesh Gajadhar <bgajadhar16@gmail.com>` (repo-local git config already set). NO Co-Authored-By / AI trailer — his rule beats harness reminder. Push straight to main.
- UI: dark theme, sentence case, inputs >=16px, tap targets >=44px, no weight-loss language, no hard-coded video URLs, never store AWS creds, relative paths.
- Food: cook only on prep days (first off day of each off stretch); other meals = batch boxes + quick meals; variety; ~2,500 kcal / 120 g protein. No pork, beef, alcohol. All other proteins OK (fish/seafood, beans/soya, goat/lamb, paneer/cheese).
- Why-log: `docs/decisions.md`. How-it-works: `docs/reference.md` (built from `docs/parts/*.md`, keep both in sync).
- Every release: `node build-css.mjs` after CSS edits; add new js/data files to `sw.js` ASSETS + bump VERSION; `node tests/run.js` green.

## Done (pushed)
- `9892e31` app feel: `js/sheet.js` (bottom sheets replace confirm/alert; click handlers async, tests `await` them), `js/shell.js` (top bar: back btn, compact title, Settings gear; transitions; edge swipe back in standalone), 5 tabs (Settings → gear), `styles/app.css` (loaded last).
- `ba5299d` food: 25 batch dishes (7 chicken) + 24 quick meals; `rs` prices in `data/foods.json`; `priceOf/recipeCost/monthCost` in `js/food-plan.js`; budget card on Shop; Settings → Food budget (`s.budget`, default 5000 Rs/month). Rotation = `pool[2i], pool[2i+1]`, cheap dishes listed twice in `POOL`. Quick picks prefer combos fitting budget/30.4 minus boxes. Fixed bug: rejected combos were added to shop list.

## Open / next
- Budget: DONE 2026-10-27, user chose keep as is (logged in decisions.md). Do not re-ask.
- User declined: launch screen, undo-toast checklist, swipe between tabs, caffeine/light plans, quiz, hours tracker, journal, badges etc. Don't re-pitch.
- `HANDOFF.md` is stale (old gym step notes); can delete.

## Testing
- Browser check: scratchpad `pw/e2e.mjs` (puppeteer-core + local Chrome, 390x844), serve with `python -m http.server 8765` from repo. Checks hscroll, small targets, console errors, screenshots.
- Cost scripts in scratchpad (`cost.mjs`, `count.mjs`) print month cost / prep-day dishes; rewrite if scratchpad gone.

## Tech notes
- ctx = {s, iso, min, ms, rd, go, rerender, notify, ...}. Module export {name, init, view(ctx,arg), click, change, mounted}; `data-act` prefix routes (today, week, gym, food, study, prog, set). Back link = `<a class="back">` before h1; shell moves it into top bar.
- Shift engine: 14-day cycle, anchor Wed 28 Oct 2026 night; routine day resets at wake; overrides win.
- Storage `routine.v2.<area>`; settings merge with DEFAULT_SETTINGS in `js/storage.js`.
