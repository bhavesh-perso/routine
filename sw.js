/* Routine service worker.
   Bump VERSION on every release: the new name makes the browser install a fresh
   copy of every file below, and activate deletes the old cache.
   Strategy (addendum F29):
   - navigations and index.html: network first, cache as fallback (opens offline)
   - every other same-origin GET: cache first, then network (and cache it)
   - non-GET and cross-origin requests: not touched (YouTube, Mandarin app links)
   The new worker waits until the page posts {type:'SKIP_WAITING'}, so the app can
   show an "Update available — reload" banner instead of swapping files mid-use. */
const VERSION = 'routine-2026-10-27-1';

// Every app file, relative to this file. tests/pwa.test.js checks this list
// against the repo, so a new js/*.js, data/*.json, font or icon must be added here.
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/router.js',
  'js/storage.js',
  'js/schedule.js',
  'js/util.js',
  'js/plan.js',
  'js/chart.js',
  'js/today.js',
  'js/week.js',
  'js/gym.js',
  'js/gym-session.js',
  'js/food.js',
  'js/food-plan.js',
  'js/study.js',
  'js/progress.js',
  'js/settings.js',
  'js/ics.js',
  'js/pwa.js',
  'js/sheet.js',
  'js/shell.js',
  'data/exercises.json',
  'data/recipes.json',
  'data/foods.json',
  'data/aws-plan.json',
  'fonts/fraunces-600.woff2',
  'fonts/fraunces-700.woff2',
  'fonts/atkinson-400.woff2',
  'fonts/atkinson-700.woff2',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/favicon-32.png',
];

// Resolve against this file's location so the same code works under /routine/ and at /.
const url = (path) => new URL(path, self.location).href;
const INDEX = url('index.html');
const ROOT = url('./');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      // cache: 'reload' skips the HTTP cache so a release never precaches stale files.
      cache.addAll(ASSETS.map((p) => new Request(url(p), { cache: 'reload' })))
    )
  );
  // No skipWaiting() here on purpose: the page decides when to switch.
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;

  const isIndex = req.mode === 'navigate' || u.href.split(/[?#]/)[0] === INDEX || u.href.split(/[?#]/)[0] === ROOT;
  event.respondWith(isIndex ? networkFirst(req) : cacheFirst(req));
});

// The app is a single page with hash routes, so every navigation is index.html.
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    // no-cache: revalidate with the server so GitHub Pages' 10-minute HTTP cache
    // never hides a new release. A plain URL request avoids navigate-mode quirks.
    let res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    // Safari refuses redirected responses for navigations; rebuild a clean one.
    if (res.redirected) res = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
    const path = req.url.split(/[?#]/)[0];
    if (res.ok && (path === INDEX || path === ROOT)) cache.put(INDEX, res.clone());
    return res;
  } catch (err) {
    return (await cache.match(INDEX)) || (await cache.match(ROOT)) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') cache.put(req, res.clone());
  return res;
}
