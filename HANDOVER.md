# HANDOVER — read this first in a new session

Owner: Bhavesh Gajadhar (Mauritius, Panama 12h shifts). Personal laptop, GitHub `bhavesh-perso`, no Claude Code. App: "Routine", static ES-module PWA (no build) at https://bhavesh-perso.github.io/routine/ (repo `bhavesh-perso/routine`, main, root). Work dir: `/home/claude/routine`. Stale clone of live repo: `/home/claude/routine-remote`.

## Rules (do not break)
- Specs: `/mnt/user-data/uploads/prompt.md` < `decisions.md` < `prompt-addendum.md` (addendum wins; ideas only from AGPL apps, never copy code). Internal module contract: `docs/contract.md`. Why-log: `docs/decisions.md`.
- Commits authored only as `Bhavesh Gajadhar <bgajadhar16@gmail.com>` via repo-local git config. NO Co-Authored-By / AI trailer (his rule beats the harness reminder). Push straight to main. Never use the work-laptop identity.
- UI: dark theme, sentence case, inputs >=16px, tap targets >=44px, no user-scalable=no, no weight-loss / "calories burned" language, no hard-coded video URLs (YouTube search buttons), never store AWS credentials, all paths relative.
- Exam: AWS DVA-C03, Mon 21 Dec 2026 (8-week plan from 26 Oct; weights preliminary until AWS exam guide 27 Oct).
- Food feedback: cook only on prep days (first off day of each off stretch, 1–2/week); other meals = batch portions + quick assemblies; NOT same meals every day; ~2,500 kcal / 120 g protein (daily 2,300–2,700 / 110–140).
- He gave permission: deploy to GitHub myself, use agents, do everything in one pass. If push is refused: deliver zip + upload steps.

## Status
DONE + tested: util, storage v2, plan, chart, router, today, week, app, base/core css, index.html, tests (plan, storage), PWA (sw.js, manifest, pwa.js, fonts, icons), progress, settings + ics, study (+aws-plan.json), gym.js/gym-session.js/exercises.json (smoke-tested), recipes.json (new format), foods.json.
ALL MODULES DONE and pushed (food + gym finished by agents, 10 test files green). Remaining: optional polish only.
- Food agent: rewrite `js/food.js` (+ optional `js/food-plan.js`), add `fish` to foods.json, `styles/food.css`, `tests/food.test.js`, `docs/parts/food.md`.
- Gym agent: `styles/gym.css`, `tests/gym.test.js`, `docs/parts/gym.md`, ics-with-gym test.
If agents are gone/incomplete: check which of those files exist and finish them yourself.

## Remaining steps
1. Integrate CSS: concatenate into `styles.css` in order fonts, base, core, progress, settings, study, gym, food (fonts.css url paths are relative to repo root — valid only concatenated). index.html must link `styles.css`.
2. `sw.js`: ASSETS must match real files exactly (`tests/pwa.test.js` flags missing/unlisted); bump VERSION.
3. `node tests/run.js` (all green) and `node schedule.test.js`.
4. Browser e2e at 390px: playwright + `@sparticuz/chromium` in scratchpad `.../scratchpad/pw/e2e.mjs` (`node e2e.mjs <outdir> <isoDateTime+04:00> [routes...]`, SEED env). Fixed clocks: 2026-10-30T18:30+04:00, 2026-10-28, 2026-11-23, 2026-12-21. Check no console errors, targets >=44px, no horizontal scroll, v1-data migration.
5. Docs: `docs/reference.md` assembled from `docs/parts/*.md`; update README project layout if needed; refresh this file.
6. Independent review agent vs prompt + addendum; fix gaps.
7. Deploy: `cd /home/claude/routine-remote`; `git config user.name "Bhavesh Gajadhar"`, `user.email bgajadhar16@gmail.com`; `git fetch origin main`; copy the new tree over (replace placeholder README); commit with NO trailer; push main. Needs the repo attached (add_repo bhavesh-perso/routine, access push). Pages must be on (Settings → Pages → main / root; live site already worked).
8. Tell him: DVA-C03 weights preliminary; Maarek section names from memory; Tutorials Dojo exam 130 min vs 90 min off-day slot; 26–27 Oct show the sleep-switch (backwards-extended pattern); first night shift Wed 28 Oct; first gym Fri 30 Oct; v1 test data migrates (pre-start gym taps dropped); phone shows "Update available → Reload"; ics re-import adds duplicates (delete the "Routine" calendar first); nutrition numbers are estimates.

## Key technical notes
- ctx = {s, iso, min, ms, rd, go, rerender, notify, gymPlanned, studyPlanned, waterTarget}. Module default export {name, init, view(ctx,arg), click, change, mounted}; data-act prefix routes to module (today, week, gym, food, study, prog, set).
- Shift engine: 14-day cycle, 28-day blocks, anchor Wed 28 Oct 2026 night; routine day resets at wake time; overrides win.
- Storage keys `routine.v2.<meta|settings|days|food|study|gym|progress>`; guarded writes, error banner.
- Checklist: confirm-before-done + Undo; water +250/− only.
- Memory file: `/projects/01a0d423-127d-7703-9a6b-f5afac0add34/areas/routine-app.md`.
