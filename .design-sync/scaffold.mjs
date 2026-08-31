/* Regenerates the design-sync scaffold from src/components/ui/*.tsx:
 *   - .design-sync/ds-entry.ts        the barrel the converter bundles
 *   - .design-sync/docs/<Name>.md     per-component doc (sets <group> via `category`)
 *   - componentSrcMap in config.json  pins every export to its source file
 * Re-run after adding or removing a shadcn component:
 *   node .design-sync/scaffold.mjs
 * Hand-written doc bodies are preserved (only files carrying the AUTOSTUB
 * marker are rewritten), so enriching a doc is safe across re-runs. */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const UI = 'src/components/ui';
const DOCS = '.design-sync/docs';
const MARKER = '<!-- autostub: rewritten by scaffold.mjs; delete this line to hand-own -->';

// Family -> the group the DS pane sorts cards under.
const CATEGORY = {
  'button.tsx': 'Actions',
  'input.tsx': 'Forms',
  'label.tsx': 'Forms',
  'field.tsx': 'Forms',
  'select.tsx': 'Forms',
  'calendar.tsx': 'Forms',
  'card.tsx': 'Layout',
  'separator.tsx': 'Layout',
  'tabs.tsx': 'Navigation',
  'sidebar.tsx': 'Navigation',
  'dialog.tsx': 'Overlays',
  'popover.tsx': 'Overlays',
  'dropdown-menu.tsx': 'Overlays',
  'sheet.tsx': 'Overlays',
  'tooltip.tsx': 'Overlays',
  'toast.tsx': 'Feedback',
  'skeleton.tsx': 'Feedback',
  'empty.tsx': 'Feedback',
  'avatar.tsx': 'Data Display',
  'chart.tsx': 'Data Display',
};

// Root component per family, where it is not the first export.
const ROOT = {
  'dropdown-menu.tsx': 'DropdownMenu',
  'toast.tsx': 'Toast',
  'chart.tsx': 'ChartContainer',
};

// Suffix -> the role that part plays inside its family. First match wins,
// so more specific patterns are listed before the generic ones.
const ROLE = [
  [/Provider$/, "Context provider - wrap the subtree in it so the family's parts can read shared state."],
  [/Portal$/, 'Renders its children into a portal at the document root, escaping parent overflow and stacking contexts.'],
  [/Overlay$/, 'The dimmed backdrop layered behind the surface.'],
  [/SubTrigger$/, 'The item that opens a nested submenu on hover or focus.'],
  [/SubContent$/, 'The floating surface of a nested submenu.'],
  [/SubButton$/, 'The interactive control of a nested row.'],
  [/SubItem$/, 'A single row within a nested group.'],
  [/Trigger$/, 'The control that opens the surface. Renders as the child element passed to it.'],
  [/ScrollUpButton$/, 'Scrolls the list up when the options overflow.'],
  [/ScrollDownButton$/, 'Scrolls the list down when the options overflow.'],
  [/DayButton$/, 'The control rendered for a single day cell.'],
  [/Content$/, 'The surface itself - holds the body.'],
  [/Header$/, 'The header slot, typically holding the title and description.'],
  [/Footer$/, 'The footer slot, typically holding the confirming and dismissing actions.'],
  [/Title$/, 'The accessible title. Always present one so assistive tech can name the surface.'],
  [/Description$/, 'The supporting line under the title.'],
  [/Close$/, 'The control that dismisses the surface.'],
  [/CheckboxItem$/, 'A menu row carrying a checked state.'],
  [/RadioItem$/, 'A menu row within a radio group - one selection at a time.'],
  [/RadioGroup$/, 'Groups radio rows so exactly one is selected.'],
  [/Shortcut$/, 'Right-aligned keyboard-shortcut hint inside a row.'],
  [/Separator$/, 'A dividing rule between groups.'],
  [/Sub$/, 'Wraps a nested submenu and its trigger.'],
  [/Badge$/, 'A small count or status marker attached to the row.'],
  [/Skeleton$/, 'The loading placeholder shape for this row.'],
  [/Action$/, 'A secondary control aligned to the trailing edge.'],
  [/Item$/, 'A single selectable row.'],
  [/Group$/, 'Groups related items under one heading.'],
  [/Legend$/, 'The caption naming a set of related fields.'],
  [/Label$/, 'The heading that names a group, or the text labelling the control.'],
  [/Set$/, 'Groups related fields under one legend.'],
  [/Error$/, 'The validation message shown when the field is invalid.'],
  [/Media$/, 'The illustrative icon or graphic slot.'],
  [/Value$/, 'Renders the current selection, or the placeholder when empty.'],
  [/Viewport$/, 'The region the surfaces are rendered into.'],
  [/Rail$/, 'The thin edge strip that toggles the collapsed state on click.'],
  [/Inset$/, 'The main content region that sits beside the sidebar and reflows with it.'],
  [/Input$/, 'A text input styled for this context.'],
  [/Image$/, 'The image itself; hands off to the fallback when it cannot load.'],
  [/Fallback$/, 'Shown while the image loads or when it fails - typically initials.'],
  [/Count$/, 'The overflow count shown after the visible items.'],
  [/Menu$/, 'The list container for the rows.'],
  [/Container$/, 'Supplies config, sizing and CSS variables to the chart beneath it.'],
  [/Tooltip$/, 'The hover-tooltip behaviour for the chart.'],
  [/Style$/, 'Injects the per-chart CSS custom properties the config declares.'],
];

const FAMILY_DOC = {
  Button: 'The primary action control. Variants carry the emphasis ramp; sizes carry the density ramp.',
  Input: 'A single-line text field.',
  Label: 'An accessible label bound to a control.',
  Separator: 'A horizontal or vertical dividing rule.',
  Skeleton: 'A loading placeholder occupying the shape of the content still arriving.',
  Calendar: 'A month grid for picking a single date or a range.',
  Card: 'A bounded surface grouping related content.',
  Dialog: 'A modal surface that interrupts, for a decision that has to be made now.',
  Sheet: 'A surface sliding in from an edge, for secondary flows that keep their context.',
  Popover: 'A non-modal floating surface anchored to its trigger.',
  Tooltip: 'A short hover or focus hint. Never put essential information here alone.',
  DropdownMenu: 'A menu of actions opened from a trigger.',
  Select: 'A single-choice picker over a list of options.',
  Tabs: 'Switches between sibling panels inside one view.',
  Sidebar: 'The app-shell navigation rail: collapsible, responsive, and keyboard reachable.',
  Toast: 'A transient message announcing the result of an action.',
  Toaster: 'The host that renders queued toasts. Mount it once, near the app root.',
  Empty: 'The empty state of a region: what is missing, and the way out of it.',
  Field: 'The form-row primitive - label, control, description and validation error as one unit.',
  Avatar: 'A person or entity marker: an image with an initials fallback.',
  ChartContainer: 'The wrapper supplying config, sizing and CSS variables to a Recharts chart.',
};

function exportsOf(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (let n of m[1].split(',')) {
      n = n.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Z][A-Za-z0-9]*$/.test(n)) names.add(n);
    }
  }
  for (const m of src.matchAll(/^export\s+(?:function|const)\s+([A-Z][A-Za-z0-9]*)/gm)) names.add(m[1]);
  return [...names];
}

const files = readdirSync(UI)
  .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
  .sort();
mkdirSync(DOCS, { recursive: true });

const srcMap = {};
const entryLines = [
  '/* Generated by .design-sync/scaffold.mjs - the surface design-sync bundles.',
  ' * Re-exports every component in src/components/ui. Do not edit by hand. */',
];

let stubs = 0;
let kept = 0;
for (const f of files) {
  const src = readFileSync(join(UI, f), 'utf8');
  const names = exportsOf(src);
  if (!names.length) continue;
  entryLines.push(`export * from '../${UI}/${f.replace(/\.tsx$/, '')}';`);
  const category = CATEGORY[f] ?? 'general';
  const root = ROOT[f] ?? names.find((n) => FAMILY_DOC[n]) ?? names[0];
  for (const name of names) {
    srcMap[name] = `${UI}/${f}`;
    const p = join(DOCS, `${name}.md`);
    if (existsSync(p) && !readFileSync(p, 'utf8').includes(MARKER)) {
      kept++;
      continue;
    }
    let desc = FAMILY_DOC[name];
    if (!desc) {
      const role = ROLE.find(([rx]) => rx.test(name))?.[1];
      desc = role ? `Part of the \`${root}\` family. ${role}` : `Part of the \`${root}\` family.`;
    }
    const compose =
      name === root ? '' : `\nCompose it inside \`${root}\` - it is not meant to stand alone.\n`;
    writeFileSync(p, `---\ncategory: ${category}\n---\n${MARKER}\n\n# ${name}\n\n${desc}\n${compose}`);
    stubs++;
  }
}
/* The chart family is a set of WRAPPERS around recharts: ChartContainer feeds
 * its children straight to recharts' own ResponsiveContainer. Anything that
 * imports `BarChart` from recharts directly gets a SECOND copy of the library,
 * and the chart renders empty - container and children end up from different
 * instances. Re-exporting the primitives here gives every consumer one copy,
 * and it is what makes the chart family usable by the design agent at all.
 *
 * `Tooltip`, `Legend` and `Label` are deliberately NOT re-exported: recharts
 * exports those names too and they would collide with this design system's
 * own. ChartTooltip / ChartLegend are the wrappers to use instead. */
const RECHARTS_REEXPORTS = [
  'Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell',
  'ComposedChart', 'LabelList', 'Line', 'LineChart', 'Pie', 'PieChart',
  'PolarAngleAxis', 'PolarGrid', 'RadialBar', 'RadialBarChart', 'ReferenceLine',
  'ResponsiveContainer', 'Scatter', 'ScatterChart', 'XAxis', 'YAxis', 'ZAxis',
];
entryLines.push(
  '',
  '/* recharts primitives the chart family composes with - one shared copy.',
  ' * Tooltip/Legend/Label are omitted: they collide with this DS\'s own names. */',
  `export { ${RECHARTS_REEXPORTS.join(', ')} } from 'recharts';`,
);

writeFileSync('.design-sync/ds-entry.ts', entryLines.join('\n') + '\n');

const cfgPath = '.design-sync/config.json';
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
cfg.componentSrcMap = Object.fromEntries(
  Object.entries(srcMap).sort(([a], [b]) => a.localeCompare(b)),
);
writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');

console.log(
  `entry: ${entryLines.length - 2} modules | components: ${Object.keys(srcMap).length} | docs: ${stubs} written, ${kept} hand-owned kept`,
);
