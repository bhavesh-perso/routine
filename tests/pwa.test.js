// PWA checks: service-worker asset list, manifest, icons, relative paths.
// Run: node tests/pwa.test.js   (plain node, no packages; exits 1 on failure)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const exists = (p) => existsSync(join(ROOT, p));
const listDir = (dir, ext) =>
  exists(dir) ? readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`) : [];

let failed = 0;
function check(name, problems) {
  if (problems.length === 0) { console.log(`PASS ${name}`); return; }
  failed++;
  console.log(`FAIL ${name}`);
  for (const p of problems) console.log(`     - ${p}`);
}

// --- sw.js ---------------------------------------------------------------
const sw = read('sw.js');
const block = sw.match(/const ASSETS\s*=\s*\[([\s\S]*?)\];/);
const assets = block ? [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]) : [];

check('sw.js has a VERSION constant', /const VERSION\s*=\s*['"][^'"]+['"]/.test(sw) ? [] : ['no const VERSION = \'…\'']);
check('sw.js has an ASSETS list', assets.length ? [] : ['could not find const ASSETS = [ … ]']);

check('ASSETS paths are relative',
  assets.filter((a) => a.startsWith('/') || /^[a-z]+:/i.test(a)).map((a) => `${a} is absolute`));

const files = assets.map((a) => (a === './' ? 'index.html' : a.replace(/^\.\//, '')));
check('every ASSETS entry exists in the repo',
  files.filter((f) => !exists(f)).map((f) => `listed in sw.js but missing on disk: ${f}`));

const mustList = [
  'index.html', 'styles.css', 'manifest.webmanifest',
  ...listDir('js', '.js'), ...listDir('data', '.json'),
  ...listDir('fonts', '.woff2'), ...listDir('icons', '.png'),
];
check('every app file is in ASSETS',
  mustList.filter((f) => exists(f) && !files.includes(f)).map((f) => `on disk but not listed in sw.js ASSETS: ${f}`));

const swCode = sw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // strip comments
const installBlock = (swCode.match(/addEventListener\(\s*['"]install['"][\s\S]*?\n\}\);/) || [''])[0];
check('sw.js waits for SKIP_WAITING instead of skipping on install', [
  ...(/skipWaiting\s*\(/.test(installBlock) ? ['install handler calls skipWaiting()'] : []),
  ...(/SKIP_WAITING/.test(swCode) ? [] : ['no SKIP_WAITING message handler']),
]);

// --- manifest ------------------------------------------------------------
let manifest = null;
try { manifest = JSON.parse(read('manifest.webmanifest')); } catch (e) { check('manifest.webmanifest is valid JSON', [e.message]); }

function pngSize(path) {
  const b = readFileSync(join(ROOT, path));
  const sig = '89504e470d0a1a0a';
  if (b.subarray(0, 8).toString('hex') !== sig || b.subarray(12, 16).toString() !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
}

if (manifest) {
  const problems = [];
  for (const k of ['start_url', 'scope']) {
    if (typeof manifest[k] !== 'string' || manifest[k].startsWith('/') || /^[a-z]+:/i.test(manifest[k])) problems.push(`${k} must be relative, got ${manifest[k]}`);
  }
  if (manifest.display !== 'standalone') problems.push('display must be standalone');
  if (!manifest.name || !manifest.short_name) problems.push('name and short_name are required');
  check('manifest basics and relative start_url/scope', problems);

  const iconProblems = [];
  const icons = manifest.icons || [];
  if (!icons.some((i) => /maskable/.test(i.purpose || ''))) iconProblems.push('no maskable icon');
  if (!icons.some((i) => i.sizes === '192x192')) iconProblems.push('no 192x192 icon');
  if (!icons.some((i) => i.sizes === '512x512' && !/maskable/.test(i.purpose || ''))) iconProblems.push('no 512x512 "any" icon');
  for (const icon of icons) {
    if (icon.src.startsWith('/') || /^[a-z]+:/i.test(icon.src)) { iconProblems.push(`${icon.src} is absolute`); continue; }
    if (!exists(icon.src)) { iconProblems.push(`${icon.src} is missing`); continue; }
    const size = pngSize(icon.src);
    if (!size) { iconProblems.push(`${icon.src} is not a PNG`); continue; }
    if (`${size.w}x${size.h}` !== icon.sizes) iconProblems.push(`${icon.src} is ${size.w}x${size.h}, manifest says ${icon.sizes}`);
  }
  check('manifest icons exist with the stated pixel sizes', iconProblems);
}

const fixed = { 'icons/apple-touch-icon.png': 180, 'icons/favicon-32.png': 32 };
check('apple-touch-icon and favicon sizes, no transparency', Object.entries(fixed).flatMap(([p, n]) => {
  if (!exists(p)) return [`${p} is missing`];
  const s = pngSize(p);
  if (!s) return [`${p} is not a PNG`];
  const out = [];
  if (s.w !== n || s.h !== n) out.push(`${p} is ${s.w}x${s.h}, expected ${n}x${n}`);
  if (p.includes('apple') && (s.colorType === 4 || s.colorType === 6)) out.push(`${p} has an alpha channel`);
  return out;
}));

// --- index.html and head snippet ------------------------------------------
function absolutePaths(html) {
  return [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)]
    .map((m) => m[1]).filter((v) => v.startsWith('/'));
}
function viewportProblems(html, file) {
  const vp = (html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i) || [''])[0];
  const out = [];
  if (!vp) out.push(`${file}: no viewport meta`);
  if (/user-scalable\s*=\s*no|maximum-scale/i.test(vp)) out.push(`${file}: viewport disables zoom (addendum F30)`);
  if (vp && !/viewport-fit=cover/.test(vp)) out.push(`${file}: viewport lacks viewport-fit=cover`);
  return out;
}

if (exists('docs/parts/pwa-head.html')) {
  const head = read('docs/parts/pwa-head.html');
  check('pwa-head.html uses relative paths and a zoomable viewport', [
    ...absolutePaths(head).map((p) => `absolute path ${p}`),
    ...viewportProblems(head, 'pwa-head.html'),
  ]);
}

if (exists('index.html')) {
  const html = read('index.html');
  check('index.html uses no absolute "/" paths in src/href', absolutePaths(html).map((p) => `absolute path ${p}`));
  check('index.html viewport keeps zoom and covers the notch', viewportProblems(html, 'index.html'));
  const needs = [
    [/rel=["']manifest["']/i, 'link rel="manifest"'],
    [/rel=["']apple-touch-icon["']/i, 'link rel="apple-touch-icon"'],
    [/apple-mobile-web-app-capable/i, 'meta apple-mobile-web-app-capable'],
    [/apple-mobile-web-app-status-bar-style/i, 'meta apple-mobile-web-app-status-bar-style'],
    [/name=["']theme-color["']/i, 'meta theme-color'],
  ];
  check('index.html has the PWA head tags (docs/parts/pwa-head.html)',
    needs.filter(([re]) => !re.test(html)).map(([, what]) => `missing ${what}`));
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll PWA checks passed');
process.exit(failed ? 1 : 0);
