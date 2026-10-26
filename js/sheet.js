// App-style bottom sheets instead of the browser's confirm()/alert() boxes.
// ask() resolves true/false, tell() resolves when dismissed. Outside a browser (tests) they fall back to globalThis.confirm.
import { esc } from './util.js';

let open = null; // { wrap, done, back } while a sheet is showing

function show({ title, text, ok, cancel, danger }) {
  const doc = globalThis.document;
  if (!doc?.body) return Promise.resolve(!cancel || !globalThis.confirm || !!globalThis.confirm(text));
  open?.done(false);
  return new Promise(resolve => {
    const wrap = doc.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet-back" data-sheet="no"></div>
      <div class="sheet" role="alertdialog" aria-modal="true" ${title ? 'aria-labelledby="sheet-t"' : 'aria-label="Confirm"'} aria-describedby="sheet-d">
        <span class="sheet-grip" aria-hidden="true"></span>
        ${title ? `<h2 id="sheet-t">${esc(title)}</h2>` : ''}
        <div id="sheet-d" class="sheet-text">${String(text).split(/\n{2,}/).map(p => `<p>${esc(p)}</p>`).join('')}</div>
        <div class="sheet-acts">
          <button type="button" class="btn wide ${danger ? 'danger' : 'primary'}" data-sheet="yes">${esc(ok)}</button>
          ${cancel ? `<button type="button" class="btn wide ghost" data-sheet="no">${esc(cancel)}</button>` : ''}
        </div>
      </div>`;
    const back = doc.activeElement, shell = [...doc.querySelectorAll('body > main, body > nav, body > header, body > #fab')];
    shell.forEach(el => { el.inert = true; });
    const done = val => {
      if (open?.wrap !== wrap) return;
      open = null;
      doc.removeEventListener('keydown', key, true);
      shell.forEach(el => { el.inert = false; });
      wrap.classList.add('closing');
      setTimeout(() => wrap.remove(), 180);
      back?.focus?.({ preventScroll: true });
      resolve(val);
    };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Tab') { // keep focus inside the sheet
        const b = [...wrap.querySelectorAll('button')], i = b.indexOf(doc.activeElement);
        e.preventDefault(); b[(i + (e.shiftKey ? -1 : 1) + b.length) % b.length].focus();
      }
    };
    wrap.addEventListener('click', e => { const v = e.target.closest('[data-sheet]')?.dataset.sheet; if (v) done(v === 'yes'); });
    doc.addEventListener('keydown', key, true);
    doc.body.appendChild(wrap);
    open = { wrap, done };
    wrap.querySelector(danger && cancel ? '[data-sheet="no"].btn' : '[data-sheet="yes"]').focus({ preventScroll: true });
  });
}

export const ask = (text, { title = '', ok = 'OK', cancel = 'Cancel', danger = false } = {}) => show({ title, text, ok, cancel, danger });
export const tell = (text, { title = '', ok = 'OK' } = {}) => show({ title, text, ok, cancel: '', danger: false });
