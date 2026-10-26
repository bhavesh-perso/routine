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
