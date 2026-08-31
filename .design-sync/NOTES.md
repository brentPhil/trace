# design-sync notes — Chroneli

Repo-specific gotchas for future syncs. Read this before re-running.

## Shape

- Chroneli is an **app, not a published library**: `private: true`, no `main` /
  `module` / `exports`, and `node_modules/chroneli` does not exist. So the
  converter runs with an explicit `--entry` pointing at a committed barrel,
  `.design-sync/ds-entry.ts`, which re-exports every module in
  `src/components/ui`.
- Because there is no shipped `.d.ts` tree, component discovery finds nothing on
  its own (`exported PascalCase symbols: 0` in the build log is EXPECTED, not a
  fault). The component list comes entirely from `componentSrcMap`, which also
  pins each name to its source file — required, because the sub-parts do not
  match the fuzzy-find patterns (`CardHeader` lives in `card.tsx`, and there is
  no `card-header.tsx` for the finder to land on).
- `.design-sync/scaffold.mjs` regenerates the barrel, the per-component docs and
  `componentSrcMap` from `src/components/ui/*.tsx`. **Re-run it after adding or
  removing a shadcn component** — it is the first half of `cfg.buildCmd`.

## Grouping

`ui` is in the converter's GENERIC_DIR set, so src-path-derived groups collapse
to `general` for all 133 components — a flat, unusable picker. Grouping instead
comes from the `category` frontmatter in `.design-sync/docs/<Name>.md`
(Actions / Forms / Layout / Navigation / Overlays / Feedback / Data Display).
The category map lives in `scaffold.mjs`; edit it there, not in the generated
docs. Doc files carrying the `autostub` marker are rewritten on every scaffold
run; delete that marker line to hand-own a doc.

## CSS

- Tailwind v4 source CSS cannot ship as-is. `.design-sync/build-css.mjs`
  compiles `src/styles.css` (via `.design-sync/build/ds-css-entry.css`) into
  `.design-sync/build/compiled.css`, which is `cfg.cssEntry`. All 14
  `data-theme` presets, the `.dark` ramp and the four measured repairs come
  through unchanged — nothing is redeclared, so the palette rule in CLAUDE.md
  holds.
- **The fontsource `@font-face` rules are stripped from the compiled CSS on
  purpose.** Tailwind inlines them verbatim and their `url(./files/*.woff2)`
  stays relative to the fontsource package, so it dangles once served from the
  bundle root. The real faces ship through `cfg.extraFonts`, which copies the
  woff2s into `fonts/` and rewrites the urls. If you ever drop the stripping
  step, you get a broken `@font-face` shadowing the working one for the same
  family. `build-css.mjs` reports how many it dropped (currently 12).
- `ds-css-entry.css` also carries an `@source inline(...)` safelist. Tailwind
  only emits classes it can see, and the design agent writes layout glue this
  repo has never written — without the safelist those utilities silently do
  nothing in a generated design. Colour utilities are safelisted only against
  the closed shadcn token set.

## Known render warns (checked on re-sync — an unrecorded warn is new)

- `[TOKENS_MISSING] --enlarger, --ink` — **false positive.** These are named
  only inside the comment block in `src/styles.css` that explains the retired
  Darkroom palette. The token scanner reads comment text. No code references
  them; do not go looking for a stale token.
- `[TOKENS_MISSING] --toast-index, --toast-swipe-movement-x/y, --toast-height`
  — set at runtime by the toast primitive's own JS. Expected absent from a
  static stylesheet.
- `[TOKENS_MISSING] --project-color, --day-group-gap` — set inline per row by
  product components. Expected absent.
- `[RENDER_THIN] Dialog, Sheet, SheetHeader, SheetFooter` — "rendered height is
  1px". **Benign, confirmed from the screenshots.** These four are
  `position: fixed` portalled surfaces, so the measured height of the mounted
  root collapses even though the surface paints correctly. All four were
  visually verified rendering in full.

## Preview authoring

- Previews import from `'chroneli'` (the `pkg` name); `@/lib/utils` and
  `lucide-react` also resolve, so previews can be written exactly like app code.
- Icons take `data-icon="inline-start"` / `"inline-end"` — the Button base class
  keys its padding compensation off those attributes
  (`has-data-[icon=inline-start]:pl-2.5`). Without them icon buttons are
  visibly over-padded.
- This DS is **base-ui**, not Radix. Composition uses `render={<X />}`, NOT
  `asChild` (e.g. `<DialogClose render={<Button variant="ghost">Cancel</Button>} />`).
- **Overlays must be given a viewport at least 640px wide.** `DialogFooter` and
  friends are mobile-first: below the `sm:` breakpoint the footer stacks
  reversed, which puts the destructive action above Cancel and misrepresents the
  desktop layout. `cfg.overrides.Dialog` uses `720x420`. Same reasoning applies
  to Sheet and any other footer-bearing surface.
- Overlays also need `cardMode: "single"` — their content is `position: fixed`
  and centred, so two stories in one card render exactly on top of each other.
- No global `cfg.provider` is needed. Context-hungry parts (Sidebar\*, Toast\*,
  Tooltip\*) are composed inside their own provider within the preview, which is
  the only true render anyway.

### Base UI constraints that cost a debugging cycle

- **`DropdownMenuLabel` must have a `DropdownMenuGroup` (or
  `DropdownMenuRadioGroup`) ancestor.** A label placed directly under
  `DropdownMenuContent` throws `MenuGroupContext is missing` and the entire card
  renders blank with no visible clue.
- **`SelectContent` needs `alignItemWithTrigger={false}`** to present well in a
  card. The default (`true`) aligns the selected row over the trigger, covering
  it and clipping the first group's label off the top edge.
- **`Sidebar` needs `collapsible="none"`** in a preview. The default
  (`offcanvas`) is `fixed inset-y-0 h-svh` and `hidden md:flex`, so it escapes
  the card and measures zero.
- **`Avatar` sizes through its `size` prop, never a `size-*` class.** The prop
  sets `data-size`, which is what scales the fallback's text step and the
  badge — sizing by class shrinks the circle and clips the initials.
- **Toast has no static form.** It only exists inside a provider driven by a
  manager, so its preview composes a real `Toaster` with its own
  `createToastManager()` and seeds it on mount. Create the manager per component
  instance, not at module scope, or every cell in a grid card pushes onto one
  shared queue.

### recharts must be a single copy

`ChartContainer` feeds its children straight to recharts' own
`ResponsiveContainer`. A preview that imports `BarChart` from `'recharts'`
directly gets a SECOND copy of the library and **the chart renders completely
empty with no error** — container and children come from different instances.
`.design-sync/ds-entry.ts` therefore re-exports the recharts primitives from the
bundle (see `RECHARTS_REEXPORTS` in `scaffold.mjs`); import them from
`'chroneli'`. `Tooltip`, `Legend` and `Label` are deliberately excluded — those
names collide with the design system's own.

### Card size is NOT what the local screenshots show

`package-validate` always screenshots at 1200x800, so single-mode cards (Toast,
Dialog, the overlays) look sparse in `_screenshots/`. The product sizes each
card from the `viewport="WxH"` attribute on its `@dsCard` line, which is what
`cfg.overrides.<Name>.viewport` sets. Judge those cards from
`_screenshots/review/` (captured at the declared viewport), not from the
validate screenshots.

## Structural sub-parts that render blank

16 components render an empty `<div>` when handed no children, so they never
fall back to the floor card and the render check flags them `blank`/`bad`:
AvatarGroupCount, Empty, FieldSeparator, SelectGroup, SheetFooter, SheetHeader,
SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenuItem,
SidebarMenuSkeleton, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
SidebarProvider. They are authored with real children rather than skipped.

## Re-sync risks

- **Playwright/chromium pinning.** The render check needs the playwright release
  whose `browsers.json` pins a cached chromium build. This machine had chromium
  1223 and 1228 cached; `playwright@1.61.1` pins 1228 and launches clean.
  `playwright@1.62.x` pins 1234 and would trigger a ~200MB download. Verify
  before installing.
- **`cfg.buildCmd` must run before the converter.** It regenerates both the
  barrel/docs/srcMap and the compiled CSS. A converter run against a stale
  `compiled.css` silently ships the previous palette.
- **`compiled.css` is gitignored** (build output). A fresh clone has no
  stylesheet until `buildCmd` runs.
- Adding a shadcn component changes `componentSrcMap` and the barrel; the
  scaffold handles it, but a NEW family also needs a `CATEGORY` entry in
  `scaffold.mjs` or it lands in `general`.
- The `@source inline(...)` safelist is a judgement call frozen in
  `ds-css-entry.css`. If designs come back with a utility that does nothing,
  that list is the place to widen.

## Helper scripts in this directory

- `scaffold.mjs` — regenerates `ds-entry.ts`, `docs/*.md` and `componentSrcMap`.
  **Run it after adding or removing a shadcn component**; it is the first half
  of `cfg.buildCmd`. A brand-new family also needs a `CATEGORY` entry, or it
  lands in `general`.
- `build-css.mjs` — compiles `build/ds-css-entry.css` into the shipped
  stylesheet and strips the dangling fontsource `@font-face` rules. Second half
  of `cfg.buildCmd`.
- `push-manifest.mjs` — regenerates the upload file list from the live
  `ds-bundle/`. `--all` for a full close-out, `--batch A,B` for a subset.
- `probe.mjs` — opens one preview card in headless chromium and prints its
  console/page errors and rendered text. Far faster than a full
  `package-validate` run when a single card comes up blank; it is how the
  `MenuGroupContext` and duplicate-recharts failures were found. It imports
  playwright from `../.ds-sync/node_modules`, so it only works after the
  converter deps are installed.

The one-shot generators used to create the 15 sub-part previews and to write
the initial grade files were deliberately NOT kept: re-running them would
silently overwrite hand-tuned previews, and grades are carried forward by the
uploaded `_ds_sync.json` anchor rather than by anything in the repo.
