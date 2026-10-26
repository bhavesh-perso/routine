// node tests/run.js — runs schedule.test.js and every tests/*.test.js; exits non-zero if any fail.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const files = ['schedule.test.js', ...readdirSync(root + 'tests').filter(f => f.endsWith('.test.js')).sort().map(f => 'tests/' + f)];
let failed = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [f], { cwd: root, encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).trim().split('\n');
  console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${f} — ${lines.filter(l => l.startsWith('PASS')).length} passed${r.status ? ', ' + lines.filter(l => /^FAIL|Error/.test(l)).slice(0, 5).join(' | ') : ''}`);
  if (r.status !== 0) failed.push(f);
}
console.log(failed.length ? `\n${failed.length} test file(s) failed` : `\nAll ${files.length} test files passed`);
process.exit(failed.length ? 1 : 0);
