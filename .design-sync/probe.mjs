/* Ad-hoc render probe: opens one preview card in headless chromium and prints
 * console errors, page errors and the rendered text. Faster than a full
 * package-validate run when diagnosing a single blank card.
 *   node .design-sync/probe.mjs <group>/<Name> [story]
 */
import { chromium } from '../.ds-sync/node_modules/playwright/index.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [target, story] = process.argv.slice(2);
if (!target) {
  console.error('usage: node .design-sync/probe.mjs <group>/<Name> [story]');
  process.exit(1);
}
const name = target.split('/').pop();
const file = resolve(`ds-bundle/components/${target}/${name}.html`);
const url = pathToFileURL(file).href + (story ? `?story=${story}` : '');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(`console.error: ${m.text()}`);
});
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const info = await page.evaluate(() => {
  const root = document.querySelector('#root') ?? document.body;
  return {
    rootChildren: root.children.length,
    text: (root.innerText || '').trim().slice(0, 400),
    bodyHtmlLen: document.body.innerHTML.length,
    globals: Object.keys(window).filter((k) => k.startsWith('__ds') || k === 'Chroneli'),
    previewExports: window.__dsPreview ? Object.keys(window.__dsPreview) : null,
  };
});

console.log('url:', url);
console.log('root children:', info.rootChildren, '| body html len:', info.bodyHtmlLen);
console.log('globals:', info.globals.join(', '));
console.log('preview exports:', info.previewExports);
console.log('text:', JSON.stringify(info.text));
console.log('errors:', errs.length ? '\n  ' + errs.join('\n  ') : '(none)');
await browser.close();
