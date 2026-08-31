/* Compiles the app's Tailwind stylesheet into the single static file
 * design-sync ships as `cssEntry`.
 *
 * Two things happen here that a plain `tailwindcss -i` would not do:
 *
 * 1. The fontsource `@font-face` rules that `src/styles.css` pulls in are
 *    STRIPPED. Tailwind inlines them verbatim, so their `url(./files/*.woff2)`
 *    stays relative to the fontsource package and dangles once the CSS is
 *    served from the bundle root. The real faces are supplied instead through
 *    `cfg.extraFonts`, which copies the woff2s into `fonts/` and rewrites the
 *    urls to match. Leaving both in place would ship a broken @font-face ahead
 *    of the working one for the same family.
 *
 * 2. The scanned source set is widened past `src/` (see ds-css-entry.css). The
 *    design agent writes its own layout glue, and Tailwind only emits classes
 *    it can see at build time - so utilities this repo happens not to use today
 *    would silently do nothing in a generated design.
 *
 * Run: node .design-sync/build-css.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ENTRY = '.design-sync/build/ds-css-entry.css';
const OUT = '.design-sync/build/compiled.css';
const CLI = '.ds-sync/node_modules/@tailwindcss/cli/dist/index.mjs';

mkdirSync('.design-sync/build', { recursive: true });
execFileSync(process.execPath, [CLI, '-i', ENTRY, '-o', OUT], { stdio: 'inherit' });

const before = readFileSync(OUT, 'utf8');

// Drop every @font-face whose src points into a package-relative ./files/ dir.
// Balanced-brace scan rather than a regex: @font-face bodies contain no nested
// braces, but matching lazily across the whole sheet is fragile enough to be
// worth doing properly.
let out = '';
let i = 0;
let dropped = 0;
while (i < before.length) {
  const at = before.indexOf('@font-face', i);
  if (at === -1) {
    out += before.slice(i);
    break;
  }
  const open = before.indexOf('{', at);
  const close = before.indexOf('}', open);
  if (open === -1 || close === -1) {
    out += before.slice(i);
    break;
  }
  const block = before.slice(at, close + 1);
  out += before.slice(i, at);
  if (/url\(\.\/files\//.test(block)) dropped++;
  else out += block;
  i = close + 1;
}

writeFileSync(OUT, out);
const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(
  `compiled.css: ${kb(out.length)} (${kb(before.length)} before) - dropped ${dropped} dangling @font-face rule(s); faces ship via cfg.extraFonts`,
);
