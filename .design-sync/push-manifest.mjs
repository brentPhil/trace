/* Builds the upload manifests for the incremental push, straight from the live
 * ds-bundle/ tree (never a stale list from a previous run).
 *
 *   node .design-sync/push-manifest.mjs [--batch A,B,C | --all]
 *
 * Writes .design-sync/.cache/push.json as {base, batch, chunks} where chunks
 * are <=200 paths each, already split so binary-heavy dirs stay small. */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'ds-bundle';
const CACHE = '.design-sync/.cache';

// The 21 family roots the user scoped for authored previews.
const ROOTS = [
  'Button', 'Input', 'Label', 'Separator', 'Skeleton', 'Calendar', 'Card',
  'Dialog', 'Sheet', 'Popover', 'Tooltip', 'DropdownMenu', 'Select', 'Tabs',
  'Sidebar', 'Toast', 'Toaster', 'Empty', 'Field', 'Avatar', 'ChartContainer',
];

const walk = (d, acc = []) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name).split(/[\\/]/).join('/');
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
};

const check = JSON.parse(readFileSync(`${OUT}/.render-check.json`, 'utf8'));
const bad = check.filter((x) => x.bad).map((x) => x.name);
const scoped = [...new Set([...ROOTS, ...bad])].sort();

mkdirSync(CACHE, { recursive: true });
writeFileSync(
  `${CACHE}/scoped.json`,
  JSON.stringify({ roots: ROOTS, bad, scoped, unscopedClean: check.filter((x) => !scoped.includes(x.name)).map((x) => x.name) }, null, 2),
);

const all = walk(OUT).map((p) => p.replace(new RegExp(`^${OUT}/`), ''));
const isBase = (p) =>
  /^(_vendor|tokens|fonts|guidelines)\//.test(p) ||
  ['_ds_bundle.js', '_ds_bundle.css', 'styles.css', 'README.md'].includes(p);
const base = all.filter(isBase);

const byComp = new Map();
for (const p of all) {
  const m = /^components\/[^/]+\/([^/]+)\//.exec(p) ?? /^_preview\/([^.]+)\./.exec(p);
  if (!m) continue;
  if (!byComp.has(m[1])) byComp.set(m[1], []);
  byComp.get(m[1]).push(p);
}

const argv = process.argv.slice(2);
const iBatch = argv.indexOf('--batch');
let names;
if (argv.includes('--all')) names = [...byComp.keys()].sort();
else if (iBatch !== -1) names = argv[iBatch + 1].split(',').map((s) => s.trim()).filter(Boolean);
else names = check.filter((x) => !scoped.includes(x.name)).map((x) => x.name);

const missing = names.filter((n) => !byComp.has(n));
const batch = names.flatMap((n) => byComp.get(n) ?? []);

const withBase = argv.includes('--no-base') ? batch : [...base, ...batch];
const CHUNK = 200;
const chunks = [];
for (let i = 0; i < withBase.length; i += CHUNK) chunks.push(withBase.slice(i, i + CHUNK));

writeFileSync(`${CACHE}/push.json`, JSON.stringify({ base, batch, chunks }, null, 2));
for (const [i, c] of chunks.entries()) {
  writeFileSync(`${CACHE}/push-chunk-${i + 1}.json`, JSON.stringify(c.map((p) => ({ path: p, localPath: p }))));
}
console.log(
  `components: ${names.length}${missing.length ? ` (MISSING from bundle: ${missing.join(', ')})` : ''}\n` +
    `base ${argv.includes('--no-base') ? 'omitted' : base.length} | batch files ${batch.length} | total ${withBase.length} | chunks ${chunks.length}`,
);
console.log(chunks.map((c, i) => `  chunk ${i + 1}: ${c.length}`).join('\n'));
if (existsSync(`${OUT}/_ds_needs_recompile`)) console.log('sentinel: present');
