// Service-worker registration and update detection (addendum F29).
// initPwa({ onUpdate }) registers sw.js; when a new version is installed and
// waiting, it calls onUpdate(apply). apply() tells the waiting worker to take
// over and reloads the page once it does. Never throws.

const CHECK_EVERY_MS = 30 * 60 * 1000;
const RELOAD_FLAG = 'routine.pwa.reloadedAt';

export function initPwa({ onUpdate } = {}) {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return; // file:// cannot register a worker
    const notify = typeof onUpdate === 'function' ? onUpdate : () => {};
    register(notify);
  } catch (err) {
    console.warn('Service worker setup skipped', err);
  }
}

async function register(notify) {
  let reg;
  try {
    reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  } catch (err) {
    console.warn('Service worker registration failed', err);
    return;
  }

  let offered = null;
  const offer = (worker) => {
    // Only offer an update when a page is already controlled (not on first install).
    if (!worker || offered === worker || !navigator.serviceWorker.controller) return;
    offered = worker;
    notify(() => apply(worker));
  };

  if (reg.waiting) offer(reg.waiting);

  reg.addEventListener('updatefound', () => {
    const next = reg.installing;
    if (!next) return;
    next.addEventListener('statechange', () => {
      if (next.state === 'installed') offer(reg.waiting || next);
    });
  });

  // Look for a new release when the app comes back to the foreground.
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastCheck < CHECK_EVERY_MS) return;
    lastCheck = Date.now();
    reg.update().catch(() => {}); // offline: try again next time
  });
}

let reloading = false;

function apply(worker) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    // Guard against a reload loop if something keeps swapping controllers.
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_FLAG)) || 0; } catch (e) { /* storage blocked */ }
    if (Date.now() - last < 10000) return;
    try { sessionStorage.setItem(RELOAD_FLAG, String(Date.now())); } catch (e) { /* ignore */ }
    reloading = true;
    location.reload();
  });
  try {
    worker.postMessage({ type: 'SKIP_WAITING' });
  } catch (err) {
    location.reload();
  }
}
