// App chrome around each screen: top bar (back button, compact title, Settings gear),
// direction-aware screen transitions and swipe-from-the-left-edge to go back.
import { esc } from './util.js';

const svg = d => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const CHEVRON = svg('<path d="M15 5l-7 7 7 7"/>');
const GEAR = svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>');

const doc = globalThis.document;
const bar = doc.getElementById('appbar'), main = doc.getElementById('main');
let dir = 'fwd', stack = [], watch = null;

// Tab taps fade, back links slide in from the left, everything else slides in from the right.
doc.addEventListener('click', e => {
  const a = e.target.closest?.('a[href^="#/"]'); if (!a) return;
  dir = a.closest('nav.tabs') ? 'tab' : a.matches('.ab-back') ? 'back' : 'fwd';
}, true);

// Called after every render. Moves the screen's back link and title into the top bar.
export function chrome(route, changed) {
  const key = route.name + '/' + route.arg, h1 = main.querySelector('h1'), back = main.querySelector('a.back');
  const title = h1?.textContent.trim() || '';
  bar.innerHTML = `<div class="ab-in">
    <div class="ab-side">${back ? `<a class="ab-back" href="${esc(back.getAttribute('href'))}">${CHEVRON}<span>${esc(back.textContent.trim())}</span></a>` : ''}</div>
    <div class="ab-title" aria-hidden="true">${esc(title)}</div>
    <div class="ab-side ab-r">${route.name === 'settings' || back ? '' : `<a class="ab-icon" href="#/settings" aria-label="Settings">${GEAR}</a>`}</div></div>`;
  back?.remove();

  watch?.disconnect();
  bar.classList.toggle('titled', false);
  if (h1 && 'IntersectionObserver' in globalThis) {
    watch = new IntersectionObserver(([en]) => bar.classList.toggle('titled', !en.isIntersecting && en.boundingClientRect.top < 80), { rootMargin: `-${bar.offsetHeight}px 0px 0px 0px` });
    watch.observe(h1);
  }
  if (!changed) return;
  if (dir === 'tab') stack = [key];
  else if (stack.at(-2) === key) { stack.pop(); dir = 'back'; } // browser back lands on the previous screen
  else if (dir === 'back') { while (stack.length && stack.at(-1) !== key) stack.pop(); if (!stack.length) stack = [key]; }
  else stack.push(key);
  main.classList.remove('nav-fwd', 'nav-back', 'nav-tab'); void main.offsetWidth;
  main.classList.add('nav-' + dir);
  dir = 'fwd';
}

// Swipe right from the left edge = back. Only in the installed app; Safari has its own edge swipe.
const standalone = () => globalThis.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
let sx = null, sy = 0, dx = 0, horiz = null;
addEventListener('touchstart', e => {
  const t = e.touches[0];
  sx = t.clientX < 24 && standalone() && bar.querySelector('.ab-back') && !doc.querySelector('.sheet-wrap') ? t.clientX : null;
  sy = t.clientY; dx = 0; horiz = null;
}, { passive: true });
addEventListener('touchmove', e => {
  if (sx === null) return;
  const t = e.touches[0]; dx = t.clientX - sx;
  if (horiz === null && (Math.abs(dx) > 10 || Math.abs(t.clientY - sy) > 10)) horiz = dx > Math.abs(t.clientY - sy);
  if (horiz) main.style.transform = `translateX(${Math.max(0, dx)}px)`;
}, { passive: true });
addEventListener('touchend', () => {
  if (sx === null || !horiz) { sx = null; return; }
  sx = null; main.style.transform = '';
  const b = bar.querySelector('.ab-back');
  if (dx > 90 && b) { dir = 'back'; location.hash = b.getAttribute('href'); }
});
