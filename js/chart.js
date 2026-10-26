// Hand-rolled SVG line chart (no library). points: [{ x: 'YYYY-MM-DD' | number, y: number }]
import { dayNum } from './schedule.js';
import { esc } from './util.js';

export function lineChart(points, { label = 'Chart', unit = '', height = 160, width = 340, decimals = 1 } = {}) {
  const pts = points.filter(p => Number.isFinite(p.y));
  if (pts.length === 0) return `<p class="muted">No data yet.</p>`;
  const xs = pts.map(p => typeof p.x === 'string' ? dayNum(p.x) : p.x), ys = pts.map(p => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.12; y0 -= pad; y1 += pad;
  const L = 40, R = 10, T = 12, B = 22, W = width - L - R, H = height - T - B;
  const sx = x => L + (x - x0) / (x1 - x0) * W, sy = y => T + (1 - (y - y0) / (y1 - y0)) * H;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(xs[i]).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const f = v => (Math.round(v * 10 ** decimals) / 10 ** decimals).toString();
  const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  const first = pts[0], last = pts.at(-1), change = last.y - first.y;
  const xl = p => typeof p.x === 'string' ? `${+p.x.slice(8)}/${+p.x.slice(5, 7)}` : String(p.x);
  return `<figure class="chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}: ${pts.length} points, latest ${f(last.y)}${unit}, change ${change >= 0 ? '+' : ''}${f(change)}${unit}">
  ${ticks.map(t => `<line x1="${L}" x2="${width - R}" y1="${sy(t).toFixed(1)}" y2="${sy(t).toFixed(1)}" stroke="#2c3441"/><text x="${L - 6}" y="${(sy(t) + 4).toFixed(1)}" text-anchor="end" fill="#9aa3b5" font-size="11">${f(t)}</text>`).join('')}
  <path d="${d}" fill="none" stroke="#f0a53a" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${pts.map((p, i) => `<circle cx="${sx(xs[i]).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3" fill="#f0a53a"/>`).join('')}
  <text x="${L}" y="${height - 6}" fill="#9aa3b5" font-size="11">${esc(xl(first))}</text>
  <text x="${width - R}" y="${height - 6}" fill="#9aa3b5" font-size="11" text-anchor="end">${esc(xl(last))}</text>
  </svg><figcaption class="muted">Latest ${f(last.y)}${unit} · ${change >= 0 ? '+' : ''}${f(change)}${unit} since ${esc(xl(first))}</figcaption></figure>`;
}
