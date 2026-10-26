// node build-css.mjs — joins styles/*.css into styles.css (fonts first). Run after editing any CSS.
import { readFileSync, writeFileSync } from 'node:fs';
const order = ['fonts', 'base', 'core', 'progress', 'settings', 'study', 'gym', 'food', 'home'];
writeFileSync('styles.css', order.map(n => readFileSync(`styles/${n}.css`, 'utf8')).join('\n'));
console.log('styles.css written');
