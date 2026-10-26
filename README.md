# Routine

A personal daily-routine app for 12-hour shift work: it tells you what today is (night shift, morning shift or off day), when to sleep, eat, train and study, and keeps a short checklist.
It plans gym sessions, meals with batch-cooking days, grocery lists and an AWS exam study plan around the shift calendar.
Static web app (no server, no account), works offline and installs on an iPhone home screen. Live at https://bhavesh-perso.github.io/routine/.

## First deploy
1. Create a public repo named `routine` on github.com under `bhavesh-perso` (empty, no README).
2. Put these files in it and push to `main` (`git push origin main`), or upload them on github.com with **Add file → Upload files**.
3. On github.com open the repo → **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`, folder `/ (root)` → Save**.
4. Wait 1–2 minutes until the Pages section shows the site is live.
5. Open https://bhavesh-perso.github.io/routine/ in Safari on the iPhone.

## Add it to the iPhone home screen
Open the live URL in Safari → tap **Share** → **Add to Home Screen** → **Add**. Open it from the home-screen icon from then on. Offline use and updates need the live (HTTPS) site, not a local preview.

When a new version is published, the app shows **Update available** with a Reload button.

## Back up and restore
Safari on iPhone can clear website data, so export a backup regularly (the app reminds you after 14 days).
- **Back up:** Settings → Data → **Export backup**. The share sheet opens: choose **Save to Files** (iCloud Drive). On a computer the file downloads as `routine-backup-YYYY-MM-DD.json`.
- **Restore:** Settings → Data → **Import backup**, pick the file, check the summary, confirm. Older backups are upgraded automatically.

## Calendar alerts (.ics)
Settings → Data → **Export calendar (.ics)** creates the next 8 weeks of shifts, gym sessions, study blocks and the weekly weigh-in, each with an alert 15 minutes before.
On iPhone: open the file (from the share sheet or Files) → **Add All** → choose a calendar. A separate calendar named "Routine" (create it first in the Calendar app) keeps these events apart.
Re-importing: iPhone Calendar usually adds the events again instead of updating them, even though each event has a stable ID. Before importing a fresh file, delete the old ones (easiest: delete the "Routine" calendar and create it again).

## Run the tests
Needs Node.js 18 or newer.
```
node schedule.test.js      # shift engine
node tests/run.js          # every test file
```
Each test prints PASS/FAIL lines and exits non-zero if anything fails.

## Local preview
```
python3 -m http.server 8000      # or: npx serve
```
Then open http://localhost:8000 (or http://<laptop-ip>:8000 on a phone on the same Wi-Fi; on Windows find the IP with `ipconfig`, on macOS with `ipconfig getifaddr en0`). The service worker and Add to Home Screen only work on the live HTTPS site.

## Project layout
`index.html`, `styles.css`, `js/` (ES modules: `app`, `router`, `storage`, `schedule`, `plan`, `today`, `week`, `gym`, `food`, `study`, `progress`, `settings`, `ics`, `pwa`, `chart`, `util`), `data/` (exercises, recipes, foods, AWS plan), `sw.js`, `manifest.webmanifest`, `icons/`, `fonts/`, `tests/`, `docs/decisions.md` (why), `docs/reference.md` (how it works), `HANDOFF.md` (where things stand).
