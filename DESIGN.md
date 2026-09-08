---
name: Chroneli
description: A time tracker that records what was accomplished, not only how long it took.
theme: shadcn default ("neutral") with four measured repairs — see §2. The theme
  picker in Settings lets a user replace every value below, so treat them as the
  shipped default rather than as the design.
presets: neutral (the values below), blue, indigo, violet, fuchsia, rose,
  amber, lime, emerald, teal; solid-sidebar — ink, midnight, plum, espresso,
  forest
radii: square (0), small (0.375rem), default (0.625rem), round (1rem)
colors:
  background: "oklch(1 0 0)"
  foreground: "oklch(0.145 0 0)"
  card: "oklch(1 0 0)"
  popover: "oklch(1 0 0)"
  primary: "oklch(0.205 0 0)"
  primary-foreground: "oklch(0.985 0 0)"
  secondary: "oklch(0.97 0 0)"
  muted: "oklch(0.97 0 0)"
  muted-foreground: "oklch(0.54 0 0)"   # repaired: 4.35:1 on --muted
  accent: "oklch(0.97 0 0)"
  destructive: "oklch(0.577 0.245 27.325)"
  border: "oklch(0.922 0 0)"          # divider, no floor
  input: "oklch(0.64 0 0)"            # repaired: control edge, 3.08:1 worst
  ring: "oklch(0.6 0 0)"              # repaired: was 2.58:1
  sidebar: "oklch(0.985 0 0)"
colors-dark:
  background: "oklch(0.145 0 0)"
  foreground: "oklch(0.985 0 0)"
  card: "oklch(0.205 0 0)"
  popover: "oklch(0.205 0 0)"
  primary: "oklch(0.922 0 0)"
  primary-foreground: "oklch(0.205 0 0)"
  secondary: "oklch(0.269 0 0)"
  muted: "oklch(0.269 0 0)"
  muted-foreground: "oklch(0.708 0 0)"
  accent: "oklch(0.269 0 0)"
  destructive: "oklch(0.704 0.191 22.216)"
  border: "oklch(1 0 0 / 10%)"        # divider, no floor
  input: "oklch(1 0 0 / 35%)"         # repaired: was 1.48:1
  ring: "oklch(0.556 0 0)"
  sidebar: "oklch(0.205 0 0)"
typography:
  title:
    fontFamily: "DM Sans Variable, system-ui, sans-serif"
    fontWeight: 500
    letterSpacing: "-0.01em"
  body:
    fontFamily: "DM Sans Variable, system-ui, sans-serif"
    fontWeight: 400
    lineHeight: 1.6
  duration:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontWeight: 400
    fontFeature: "tnum"
    letterSpacing: "-0.02em"
  label:
    fontFamily: "DM Sans Variable, system-ui, sans-serif"
    fontWeight: 500
    fontSize: "0.8125rem"
rounded:
  # Multiples of --radius, so all seven steps move with the picker. Identical to
  # Tailwind's own values at the shipped 0.625rem.
  sm: "calc(var(--radius) * 0.6)"    # 6px
  md: "calc(var(--radius) * 0.8)"    # 8px
  lg: "var(--radius)"                # 10px
  xl: "calc(var(--radius) * 1.4)"    # 14px
  2xl: "calc(var(--radius) * 1.6)"   # 16px
  3xl: "calc(var(--radius) * 2.4)"   # 24px
  4xl: "calc(var(--radius) * 3.2)"   # 32px
  full: "9999px"                     # genuinely circular things only
spacing:
  gutter: "1rem"
  cluster: "0.5rem"
  group: "0.75rem"
  band-y: "0.375rem"
  panel: "1.25rem"
  entry-row: "54px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "2.25rem"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "2.25rem"
  input-field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
  chip:
    backgroundColor: "{colors.background}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.full}"
    padding: "0.25rem 0.625rem"
    typography: "{typography.label}"
  timer-toggle:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.full}"
    size: "42px"
  entry-row:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    padding: "0 {spacing.gutter}"
    height: "{spacing.entry-row}"
  popover-surface:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.popover-foreground}"
    rounded: "{rounded.lg}"
  sidebar-rail:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.sidebar-foreground}"
---

# Design System: Chroneli

## 1. Overview

**The palette belongs to the user.**

This document described a hand-built colour system called "The Darkroom" for
most of its life: a warm dark room lit by one amber safelight, with its own
vocabulary (`--ground`, `--surface`, `--ink`, `--edge`, `--safelight`,
`--enlarger`, `--brass`, a seven-token `--rail` set, three gradient washes) and
every value argued out against WCAG floors in a 231-line
`styles.contrast.test.ts`.

It is gone, deliberately and at the product's request, because of the **theme
picker in Settings** — which now ships. A theme preset sets the standard shadcn
variables and nothing else, so a private vocabulary is exactly what breaks one:
every token the product invented would keep its old value while the standard
ones moved, and the app would render half-themed. `src/components/ui/` was
re-installed from the registry at the same time, so the vendored components are
the registry's too.

What replaces it is short enough to state here: **`src/styles.css` holds the
shadcn default palette, and that set is the whole palette.** Four values are
repaired against WCAG failures measured at real call sites — see §2 — and every
one of them is still a STANDARD shadcn token that a preset sets like any other.

A new colour token is a colour the theme picker cannot reach. If something needs
a shade the set does not have, it composes one at the call site out of these
(`bg-primary/15`, `color-mix`) rather than adding a name.

**What this costs, stated rather than buried.** The old system spent colour on
meaning: one hue meant *running*, one meant *money*, one meant *act here*, and
every ratio in the app was measured. shadcn's default palette is monochrome
apart from `--destructive` and the five chart hues, so:

- **Running** is `--primary` — the same treatment as any affirmative control.
  It was never carried by hue alone (see The Over-Determined State Rule in §2),
  which is what made this affordable.
- **Money** has no colour at all any more. A currency amount is
  `text-foreground` in mono, distinguished by typeface, alignment and position.
  There is no slot in shadcn's set for "this figure is an amount".
- **Contrast is measured again, and it had to be.** The suite that held every
  floor was deleted with the palette it measured, on the argument that once the
  user picks the theme no fixed assertion can hold. That argument is true of a
  theme the USER authors and false of the palette this repo SHIPS — and shadcn's
  defaults are not accessible out of the box. `src/styles.contrast.test.ts` is
  back, measuring both ramps at the call sites; a picker built on an unmeasured
  base would inherit every failure into every preset.

What has **not** changed is everything this system was about besides hue:
tabular numerals, meaning never carried by colour alone, depth by tonal layering
rather than shadow, the log as a table rather than a stack of cards, and the
five anti-references in §6. Those are the parts a theme cannot move.

This system still explicitly rejects the two directions the category runs in —
the enterprise timesheet grid and the cheerful habit tracker — plus the
currently most-copied look in product design, the near-black-with-purple-glow
aesthetic. What is left is an instrument: quiet, neutral, exact.

**Key Characteristics:**
- The shadcn default palette in both ramps, with four measured repairs
- No colour token outside that set; shades composed at the call site
- Depth by tonal layering (background → card → popover), not shadow
- Numbers always monospaced and tabular
- Meaning never carried by colour alone
- Per-project hues are **data**, not theme

## 2. Colors

The full set is in `src/styles.css` and is reproduced in this file's
frontmatter. It is shadcn's "neutral" base, with the four repairs named below.
What follows is what each token is **for in this product**, which is the part a
registry cannot tell you.

### Semantic
- **`--primary`**: The affirmative action, the current selection, and the
  running state. The play/stop control, calendar range endpoints, checked
  states, the segmented control's selected cell, the timer bar's boundary while
  tracking. A high-contrast neutral in the shipped default — near-black on
  white, near-white on black — and a real hue under a preset that sets one,
  which is what makes a preset visible without a swatch to compare against.
- **`--destructive`**: Destructive and error only. Deleting an entry, a failed
  save, a validation failure. Never for warnings, never for "attention", never
  decoratively. It is the one hue in the neutral palette, and spending it on
  anything else spends the only signal left.
- **`--ring`**: Focus, everywhere. Never used as a fill.
- **`--accent`**: The hover/highlight fill for menu items, list rows and
  skeletons. It is one step off `--muted` in shadcn's set and is not an accent
  in the "brand colour" sense — the name is the registry's.

### Neutral
- **`--background`** the page, **`--card`** a panel or band, **`--popover`** a
  floating surface. In the light ramp all three are white and the separation is
  carried by `--border`; in the dark ramp they step 0.145 → 0.205 → 0.205. That
  asymmetry is shadcn's, not a mistake, and it is why §4 says a boundary must
  never rely on the tonal step alone.
- **`--foreground`** / **`--muted-foreground`**: primary and secondary text.
  `--muted-foreground` is the dimmest text permitted anywhere.
- **`--border`** and **`--input`** are **two boundary tones doing two jobs**,
  which is The Boundary Split below. shadcn ships them at the same value, which
  makes them one token with two names; here they diverge.

### Charts and projects
- **`--chart-1` … `--chart-5`**: shadcn's five series colours, used where a plot
  genuinely needs a hue — /reports' Earned chart is `--chart-1`. Everything else
  in a chart is on the neutral ramp.
- **`--project-*`**: twelve per-project hues, and they are **DATA, not theme**.
  A project's hue is stored per project and chosen by the user; it identifies a
  row the way a name does. A theme switch must not repaint work someone has
  already learned to recognise, so these are the one colour family in
  `styles.css` that a picked theme does not move. Only lightness differs between
  ramps (L 0.52 light, L 0.72 dark), so a project keeps its identity across a
  toggle.

### Named Rules

**The Over-Determined State Rule.** No state is carried by colour alone, and
this is now load-bearing rather than a nicety: with a monochrome palette, colour
frequently cannot carry it at all. "Is it running?" is answered five ways at
once — the glyph flips from play to stop, the bar's boundary goes from
`--input` to `--primary`, the duration goes from muted to primary, a dot
pulses, and the live region says "Recording". Adding a state means adding a
non-colour carrier for it, not picking a token.

**The Boundary Rule.** Anything the user can interact with is identified by a
border, not by a fill tint alone. `ui/input.tsx` and `ui/select.tsx` are the
worked example: base-luma ships them `border-transparent bg-input/50`, which
identifies a text field by a fill measuring about 1.05:1 against the page. They
are outlined here — `border-input bg-background` — which is also what upstream
shadcn does.

**The Boundary Split.** `--border` is a DIVIDER between passive content: a table
rule, a day boundary in the log, a panel frame, a band edge. WCAG imposes no
minimum on it and it stays quiet — dozens of call sites carry it, and making them all
clear 3:1 turns the log from one table into a grid. `--input` is the boundary of
something you can TYPE INTO, PRESS or TOGGLE, and clears 3:1 against every
surface a control lands on: 3.08:1 at the worst in the light ramp, 3.15:1 in the
dark, measured composited.

Both are standard shadcn tokens, which is what makes the split legal under §1's
rule — a preset sets `--input` exactly as it sets `--border`. Inventing a third
tone (this system had `--edge-raised` once) is the private vocabulary the reset
removed. Deciding which one a border wants is one question: *can the user type
into, press or toggle the thing it encloses?* A card that merely CONTAINS
controls is still a divider — the frame is not the control.

**The Adjacent Colour Rule.** A border has **two** adjacent colours — the fill
inside it and the layer outside it — and SC 1.4.11 is measured against each. "3:1
against the background" is not a property of a token, it is a property of a
token *on a particular layer*. This is the rule that used to be enforced by
`styles.contrast.test.ts`; it is now the thing the theme picker must check,
because it is how a control that passes on one page fails on another with
neither file changing.

**The Hatch Rule.** Gaps, untracked time, and entries missing a note are marked
with a hatch or dashed treatment, never a colour. Absence is a texture, not a
hue. This is how never-colour-alone is satisfied structurally rather than as a
bolt-on, and it is **more** important now that there are fewer hues to spend.

**The Monochrome Chart Rule.** A chart of past work carries no hue unless its
axis earns one. Series separate on the neutral ramp. See §5 Charts.

### The four repairs

Every one is a WCAG failure measured at a real call site, not a preference, and
each carries its figure where it is declared in `src/styles.css`:

| token | shadcn | here | why |
|---|---|---|---|
| light `--muted-foreground` | 0.556 | **0.54** | 4.35:1 as body text on `--muted` (`ui/avatar.tsx`), under SC 1.4.3 |
| light `--ring` | 0.708 | **0.6** | 2.58:1 — a focus indicator you cannot see |
| light `--sidebar-ring` | 0.708 | **0.6** | mirrors `--ring` |
| light `--input` | 0.922 | **0.64** | the control half of the split |
| dark `--input` | 10% white | **35% white** | 1.48:1 |

0.66 was the obvious light `--input` and gives 3.11:1 on white — but 2.85:1
inside a `--muted` band, which is where a filter chip actually sits. That is The
Adjacent Colour Rule biting, and it is why the values above are the worst case
across eight surfaces rather than the figure against the page.

### What is still failing

Recorded rather than repaired, because fixing it is a palette decision rather
than a defect repair — `src/styles.contrast.test.ts` holds both as ratchets that
may be tightened and never loosened:

- **The light chart ramp.** `--chart-4` measures **1.72:1** on `--card` and
  `--chart-5` **2.13:1** — series you cannot see — and the two are **14.35
  degrees** apart in hue, so they are also the same colour as each other. Dark
  `--chart-1` is **2.62:1**. Only `--chart-1` is spent today (the earnings line),
  and dark `--chart-1` shares its value with `--sidebar-primary`, so moving one
  moves the other.

### Presets

A preset is a **complete pair of ramps** under one `data-theme` attribute on
`<html>`. Two ship: **Neutral** (the base palette above) and **Indigo** (hue
265, spent as a saturated `--primary` and a whisper of the same hue through the
neutrals).

Four things about the mechanism are load-bearing, and the first is the whole
design:

1. **The values live in `src/styles.css` as ordinary CSS**, never written to the
   DOM as inline custom properties. `documentElement.style.setProperty` is the
   obvious implementation — it is what tweakcn does — and it works right up
   until the user toggles light/dark, because **an inline declaration outranks
   both `:root` and `.dark`**. Every token applied that way freezes at its last
   written value. That approach only works in a codebase with no `.dark` ramp to
   conflict with. `theme.test.tsx` asserts the absence of an inline style
   directly, because this is the mistake that will be made again.
2. **Selectors are `:root`-qualified.** A bare `[data-theme="x"]` is (0,1,0) —
   a tie with `:root` AND `.dark`, broken by source order.
3. **The default has no block.** A fresh install has written no attribute, so a
   `:root[data-theme="neutral"]` block would never reach the people who have
   never opened the picker.
4. **Preset and polarity are orthogonal.** A preset ships both ramps and never
   states a polarity; light/dark/system never states a palette. Two controls,
   two storage keys, no combinatorial grid.

`src/lib/theme-presets.ts` restates the ramps in TypeScript so the picker can
draw a swatch of a theme the page is **not** wearing — a `var()` there resolves
to the active theme, so every card would preview the same colours.
`theme-presets.test.ts` parses `styles.css` and compares the two key-for-key; a
swatch showing one colour and applying another is the bug it exists to prevent.

**Adding a preset is data.** A new entry plus its two CSS blocks, and
`styles.contrast.test.ts` measures it automatically — it ranges over presets ×
ramps, so a palette cannot land under the floor silently. That is the practical
argument for a closed set over a free-form editor: a theme the user authors
cannot be asserted about, and a theme the product ships can be.

**Which hues are offerable is decided by measurement, not taste** — see the
header of `src/lib/theme-presets.ts`, which states the three rules. In short:
chroma is clamped to the sRGB gamut per hue; the 4.5:1 floor leaves an unusable
band between L 0.55 and 0.62, so a primary is either dark-with-white-text or
light-with-dark-text and never in between; and a hue that cannot hold C 0.14 as
a dark primary INVERTS to a light one — which is how Amber, Lime and Teal ship
at all. Still excluded: anything within about 40° of `--destructive` (a primary
that reads as the error colour spends the one signal a monochrome palette has
left), and Sky, which is Teal's washed band a second time.

**The solid-sidebar presets invert one family, not the theme.** Ink, Midnight,
Plum, Espresso and Forest keep a light content ramp and paint the rail as a
dark solid in BOTH ramps. That is what shadcn's parallel `--sidebar-*` token
family is for: the rail draws every piece of its text, its borders and its
focus ring from its own eight tokens (`ui/sidebar.tsx`), so the content ramp's
inks never land on the dark surface — the account popup is `--popover`, the
rail dims with `sidebar-foreground/70` and focuses with `--sidebar-ring`.
`styles.contrast.test.ts` therefore sweeps `--muted-foreground`, `--input` and
`--ring` over the six CONTENT surfaces only, and holds the rail to its own
floors per ramp: 4.5:1 for its text including the 70% dim step, 3:1 for its
ring. Collapsing those sweeps back into one "every token on every surface"
loop would outlaw this whole preset family while catching nothing real.

### Radius

A third axis, orthogonal to both others: `data-radius` on `<html>`, four steps
(Square / Small / Default / Round), the same attribute-and-cascade mechanism the
presets use, and the same "the default has no block" rule.

**Every step of the scale is a MULTIPLE of `--radius`, including `2xl`, `3xl`
and `4xl`.** That is what makes the control mean anything: Tailwind ships those
three as static 1/1.5/2rem, and the vendored shadcn components reach for them 22
times against 13 uses of the four smaller steps — so declaring only the small
end moved about a third of the app and left the rest, which reads as a broken
setting rather than a subtle one.

Multiples rather than offsets for a second reason: `calc(0rem - 4px)` is a
negative border-radius, which is invalid, so at Square the declaration would be
dropped and the element would silently keep whatever it had.

**`rounded-full` does not follow the radius, and should not.** A project dot, an
avatar, the timer's 42px disc and a 1px progress bar are circles, not rounded
rectangles. The places that DID need to follow — the filter chip, the tabs, and
the Button base itself — were pills by way of `rounded-full` or `rounded-4xl`
and are now on the `2xl` step.

**The CLAMP is why the step matters, not the look.** `border-radius` clamps at
half the element's height, so on a 32px control every value above 16px paints
the identical pill — a button on the `4xl` step (32px at the default, 19px at
Small) never visibly responded to the picker until Sharp. `2xl` is 16px at the
default — within a pixel of the clamp, so the shipped pill look is unchanged —
and it crosses UNDER the clamp at the very next step down, which is what makes
Small read as the rounded rectangle it claims to be. When putting a new
pill-shaped control on the scale, pick the smallest step that still clamps at
the default; a larger one only adds dead range to the picker.

### Retired rules

Named here so that reading an old commit, comment, or file header does not send
anyone looking for tokens that no longer exist.

- **The Exposure Rule** (`--enlarger` means running and nothing else) — the
  token is gone; running is `--primary`.
- **The One Accent Rule** (one accent colour in both ramps, at the only
  lightness that could clear 3:1 against all twelve surfaces) — the accent is
  `--primary`, which shadcn deliberately inverts between ramps.
- **The Two Temperatures Rule** (brass means money, safelight means act here) —
  there is no money colour.
- **The Falloff Rule** and **The Three Surfaces Rule** (the three darken-only
  washes) — there are no gradients; see §4.
- **The Recessed Chrome Rule** (one near-black rail in both ramps) — the sidebar
  is `--sidebar`, which follows the theme like everything else.
- **The Cold Light Rule** — retired earlier, superseded by The Exposure Rule,
  and now retired twice over.

## 3. Typography

**Body / UI Font:** DM Sans Variable (with `system-ui`, sans-serif)
**Duration / Numeric Font:** IBM Plex Mono (with `ui-monospace`, monospace)

**The two typefaces survived the reset**, because they are the product's own and
are not what a colour theme changes. A geometric sans paired with a humanist
mono is a real contrast axis, not two sans-serifs that almost match: DM Sans
stays neutral and legible at small sizes for eight hours; Plex Mono is warmer
and squarer than the default developer monos, keeping numbers from reading as
terminal output.

With the palette monochrome, **typography is now doing more of the work it used
to share with colour** — a currency amount is told from a duration by typeface,
alignment and position rather than by hue.

### Hierarchy
- **Display** (500, `clamp(1.75rem, 4vw, 2.5rem)`, 1.1): The running duration
  when it is the primary object on screen. Rare.
- **Title** (500, `1rem`, 1.4, `-0.01em`): Entry titles. The most-read text in
  the product.
- **Body** (400, `0.9375rem`, 1.6): Notes and prose. Capped at 65–75ch.
- **Duration** (400, mono, `tnum`, `-0.02em`): Every duration, timestamp, and
  total, at any size.
- **Label** (500, `0.8125rem`): Field labels and column headers. Sentence case.

### Named Rules

**The Tabular Rule.** Every digit the user reads is monospaced with tabular
figures. A running timer whose width jitters as it counts is a defect, and
history columns must align on the decimal without effort. Spelled
`font-mono tabular-nums tracking-[-0.02em]` at each call site.

**The Sentence Case Rule.** Labels are sentence case. No tracked-out uppercase
eyebrows — that is the scaffold this system is avoiding, and it makes an
instrument look like a landing page.

**The One Measure Rule.** There is **no page measure**. Every page takes the
full width, and a bare `max-w-[…]` literal on a page container is a defect.

- The log is a TABLE, not prose — the trailing cluster pins right and the title
  takes what is left. This covers the timer bar, /timer's totals and filter
  band, /reports' header, summary and charts, day headers, and entry rows. A
  1100px measure was tried here for one release and traded a wide row for a
  dead band of page beside every row.
- /projects and /settings were capped at a 46rem `--form-measure` until
  2026-08-10. Both were the same mistake, and the mistake is worth naming
  because it will be tempting again: **a row with an empty middle looks broken
  at 1600px, and narrowing the page only hides it.** /projects reads like an
  entry row once its rate sits between the name and the actions; /settings puts
  each section's label and hint in a column beside its control, so the section
  rule spans something instead of running 1329px under a 272px control.
- **Prose is capped where the prose is** — one column of one component — never
  by shrinking a page around it. A settings hint has a reading measure; the
  page it sits on does not.

**Every block is left-flush.** Never `mx-auto`. Centring makes a page's left
edge a function of its own width, so a full-width log and a 46rem settings
column would start in two different places — and neither would line up with
the timer bar, which lives in the shell and belongs to no page. Padding is
`px-4` on the content element itself, never on its parent and never inside a
reusable component: a cap measured inside a padded parent lands somewhere
different from the same cap measured inside an unpadded one, and a component
that carries the page's gutter forces its next caller to compensate.
Backgrounds, borders, hover fills and sticky headers stay on the parent, so
the log still reads as edge-to-edge bands.

## 4. Elevation

Flat. Depth is tonal, not cast.

Layering is expressed by stepping the neutral ramp — `--background` to `--card`
to `--popover` — with a one-pixel `--border` where a boundary must be
unambiguous. Shadows barely read on a dark ground and drift toward the
glow-on-near-black aesthetic named as an anti-reference in §6.

The single exception is genuinely floating UI: popovers, dialogs, and menus
carry one soft ambient shadow to separate them from the page beneath, because
tonal separation alone is insufficient when content scrolls behind them.

**In the light ramp the tonal step is zero.** shadcn's defaults put
`--background`, `--card` and `--popover` all at pure white, so a panel is told
from the page by its border and its shadow and by nothing else. That is a
change from the old system, where each layer was a measured step, and it is why
the rule below is stated as "step the ramp **or** add an edge" rather than as a
preference for the step.

**There are no gradients.** The three structural washes — room, rail, floating
surface — went with the darkroom palette, along with the `--*-deep` floor tokens
that anchored them and the `tailwind-merge` extension in `src/lib/utils.ts` that
taught `cn()` they were background-*images* rather than colours. `cn` is stock
`twMerge` over `clsx` again. If a gradient utility is ever added back, that
extension is what has to come with it: the failure is invisible in a browser
(the gradient is opaque and covers the same box) and shows up only as a missing
fallback colour.

### Named Rules

**The Tonal Depth Rule.** If two surfaces need separating, step the ramp or add
an edge. Reach for a shadow only when the element genuinely floats above
scrolling content.

**The No Glow Rule.** Coloured shadows, glows, and halos are prohibited
throughout, including on the running state. `--primary` marks the running entry;
it does not bloom.

## 5. Components

What is recorded here is what has been DECIDED. `src/components/ui/` is the
shadcn registry's output and is deliberately not documented component by
component — describing a vendored file would enshrine the registry's choices as
this product's.

### The Shadcn-First Rule

**Reach for a shadcn component before a native control or a hand-rolled one.**
If `src/components/ui/` does not have it yet, add it —
`npx shadcn@latest add <name>`. Do not hand-roll a control that shadcn ships,
and do not leave a bare `<select>`, `<input type="file">`, `<dialog>` or
`<details>` in the product because it was quicker.

The reason is not fashion, it is that **the engine's own chrome is the one thing
on a page not drawn by this design system**. A native `<select>` renders the
platform's dropdown — its own radius, its own focus ring, its own popup — and it
sits in a column of controls that are all drawn from the ramp.

**Do not correct a vendored component. Override at the call site.** This is the
rule that changed, and it changed because correcting them is what made
`npx shadcn@latest add --overwrite` unrunnable: every vendored file had been
hand-edited, so re-installing meant re-deriving a dozen corrections and repairing
a hundred call sites. With a theme picker shipping, re-adding a component has to
be an ordinary thing to do.

So: pass a `className`. tailwind-merge resolves same-group conflicts, so an
override *replaces* the registry's value rather than racing it in the cascade.
`SIDEBAR_RAIL_INSIDE_EDGE` in `src/components/shell/app-sidebar.tsx` is the
worked example — shadcn centres the drag rail *on* the divider, putting 8px of
`e-resize` cursor over every entry row in the log, and one exported class string
at the call site pulls it back inside the sidebar.

`eslint.config.js` exempts `src/components/ui/**` from four stylistic rules the
registry's house style trips, for the same reason: a lint fix that has to be
re-applied after every `add` is how a vendored file quietly stops being
vendored.

**The six exceptions**, each of which is behaviour, types or an accessibility
floor rather than taste, and each carrying a comment in the file saying so:

1. `ui/button.tsx` — four **additive** sizes (`icon-row`, `chip`, `row-trigger`,
   `badge`). Pure geometry, no variant or colour overridden. Their controls sit
   inside boxes whose heights are load-bearing and derived elsewhere; dropping
   them does not restore a default look, it breaks a layout.
2. `ui/select.tsx` — `Select` wraps the registry's Root to swallow Base UI's
   `onValueChange(null)` once. Not one Select in this product is clearable, so
   the alternative is the same impossible-case guard at eight call sites.
3. `ui/popover.tsx` — `PopoverClose` re-exported (ten call sites close a popover
   from inside it and the registry ships no Close), and `anchor` added to the
   Positioner `Pick` (two calendar popovers anchor to a FullCalendar element
   rather than to a trigger they rendered).
4. `ui/calendar.tsx` — `labels` and `formatWeekdayName` restored so a day
   announces the same way the app's other date grid does, `aria-current="date"`
   on today, `showOutsideDays={false}` so a click cannot silently land in
   another month, and `ref` actually attached to the day button (the registry
   declares it, wires an effect to it, and never attaches it — dead code that
   leaves the focus that effect exists to move never happening).
5. `ui/sidebar.tsx` — `sidebarMenuButtonVariants` added to the export list, so
   the shell's own header can wear the nav button's geometry instead of
   re-deriving it.
6. `ui/input.tsx`, `ui/select.tsx`, `ui/button.tsx` (outline), `ui/field.tsx`,
   `ui/sidebar.tsx` (`SidebarInput`) and `ui/tabs.tsx` — the control boundary,
   moved from `border-transparent bg-input/50` to `border-input bg-background`.
   This is The Boundary Rule in §2, and the registry's own styling fails it: a
   fill at 1.05:1 is not an identification. The fill states that were reading
   `--input` (`bg-input/30`, `bg-input/40`) moved to `--accent`, because
   `--input` is a boundary tone now and a 35%-white hover plate is not a hover
   plate. The boundary genuinely lives in these files, so this is the one
   category where editing the vendored component beats a call-site override.
7. **Geometry corrections**, each a registry default that is wrong at every
   call site at once — the case where a fix in the vendored file beats the same
   override repeated everywhere:
   - `ui/button.tsx` base and `ui/tabs.tsx` (list + trigger):
     `rounded-4xl`/`rounded-full` → `rounded-2xl`. A fixed or clamp-saturated
     radius never responds to the radius picker; `2xl` paints identically at
     the default and releases one step down (the clamp rule, §2 Radius).
   - `ui/input.tsx` and `ui/select.tsx`'s trigger: `rounded-3xl` →
     `rounded-md`, the field radius every hand-drawn input in the app uses.
   - `ui/tabs.tsx`: the `!` removed from the base `border-transparent!`, which
     was dead-coding the registry's own `dark:data-active:border-input` — in
     dark, the active tab had no visible state at all.

**The exception to the exception is a control the platform genuinely does
better**, and there is currently one: the native date input on a touch keyboard.
A native control kept for a stated reason is a decision; one kept because nobody
replaced it is debt.

### Buttons
- **Primary** is `--primary` with `--primary-foreground` — a high-contrast
  neutral, near-black on white and near-white on black. It is the affirmative
  action and, since the reset, the running state as well.
- **Ghost** is the log's row-action treatment: no fill at rest, an `--accent`
  plate on hover. It replaced a `quiet` variant (muted text warming to full
  foreground, no plate) that this system added because a plate behind every row
  action reads as the row lighting up rather than the control under the cursor.
  That is a real observation and the reason is preserved here; the variant is
  not, because it was an edit to a vendored file.
- **Shape** is the registry's, at `--radius: 0.625rem`.
- **Focus** is `--ring`: a border shift plus a 3px halo at 30% opacity. The two
  carry very different weight and a measurement must stay attached to the right
  one — the **border shift** is what satisfies SC 2.4.11/1.4.11; the **halo** is
  decoration and is nowhere near an indicator on its own. A single ratio
  attached to the halo is how a focus style ships with the border shift dropped
  and the number still "checking out".
- **Focus, when the border already carries state.** Some controls cannot spend
  their border on focus because it is already saying something else — the timer
  bar's border is `--input` when idle and `--primary` while running. Those use
  an **outline** instead: `outline-2 outline-offset-2 outline-ring`. The
  `outline-offset-2` is load-bearing: it puts the page's own background on
  *both* sides of the outline, so the indicator reads the same whatever the
  control's fill and border are doing, and it leaves the border underneath free
  to keep saying "recording".

### Inputs / Fields
- **Outlined** — an `--input` edge on a `--background` fill, registry radius.
  `--input`, not `--border`: a field is a control, so its edge takes the 3:1
  half of The Boundary Split. A control identified by fill alone is the failure
  this system has hit before; see The Boundary Rule.
- **Focus:** border shifts to ring, plus the 3px halo.
- **Error:** border and message in `--destructive`, always paired with
  `aria-invalid` on the control and `role="alert"` on the message — the colour
  is never the only carrier.

### Charts

Built on shadcn's chart block (recharts). They live on **/reports → Summary**,
which is a tab beside Detailed rather than a page of its own, so one FilterBar
governs both and the two can never describe different rows.

- **Frame:** `bg-card`, one `border` hairline, `rounded-lg`, no shadow — The
  Tonal Depth Rule.
- **`ChartContainer` takes `config={{}}`** here, deliberately. `config` exists so
  shadcn can emit a `--color-<key>` variable per series, and every series in this
  app names its own colour — a `--chart-*` token, or a project's `--project-*`
  data hue. There is nothing for the container to declare.
- **The Monochrome Rule.** A chart of past work carries **no hue**. Series are
  separated on the neutral ramp — `--foreground` against `--muted-foreground` —
  which is the same tonal layering the surfaces use.
  - **The project chart is the one exception**, and it is the exception the
    project palette exists for: twelve capped, legible hues, every bar sitting
    beside its own name. Colour is a recognition aid there, never the
    information.
  - **An axis may earn a hue.** /reports' Earned chart plots currency amounts and
    draws in `--chart-1`. The daily chart plots billable *hours* on the neutral
    ramp, because those are a duration rather than an amount.
- **The Hatch Rule applies to plots.** A span with nothing tracked is drawn as a
  short hatched stub, not as bare axis — a missing bar and a zero bar look
  identical, and the eye closes the gap. "No project" is hatched for the same
  reason: an absence is a texture, never a thirteenth colour.
- **Axes are styled by prop, not by stylesheet.** Recharts writes `fill="#666"`
  onto every tick as a presentation attribute. shadcn's wrapper tries to undo
  that with a descendant selector and it did not take here. Ticks are
  `--muted-foreground`, set through `AXIS` in
  `src/components/reports/chart-frame.tsx` — a selector aimed at a vendored
  library's internal class names fails silently, and dimmer-than-the-floor is
  exactly the failure nobody notices.
- **Gridlines are round numbers.** Recharts divides the observed maximum by five
  and rounds, which over a 9.9-hour day gives 0h/3h/5h/8h/10h — unevenly spaced
  AND unevenly valued. `hourTicks` picks a step people think in. The scale is
  the one part of a chart that must be beyond question.
- **Nothing animates.** Every series sets `isAnimationActive={false}`. Recharts
  grows bars from zero via `requestAnimationFrame`, which never fires in an
  unpainted tab — the charts rendered as empty plots with axes the first time
  they were checked. Convex queries are live besides, so every push and every
  range change would replay the entrance, and a vendored entrance animation has
  no `prefers-reduced-motion` alternative.
- **Figures are a readout, not tiles.** The four numbers above the charts are
  label-figure-hairline on the page's own background. A card per metric, with its
  own border and icon, is the hero-metric template §6 rejects.

### Cards / Containers

`ui/card.tsx` is vendored again (it arrived as a dependency of another
component). It is not used by any product surface, and the reasons this system
built panels by hand still hold — prefer the two shapes below.

- **The panel, where a frame is genuinely needed:** `bg-card`, one `border`
  hairline, `rounded-lg`, no shadow.
- **The band, which is the more common answer:** a full-bleed strip of `--card`
  between two hairlines, marking the boundary between a page's chrome and the
  rows it is about. `FilterBand` is the component; a day header in the log is the
  same shape. Prefer a band to a card: it separates without detaching, and it
  keeps the page reading as one table rather than as a stack of tiles.
- **Internal padding** is the gutter (1rem) horizontally. Vertical rhythm
  belongs to the band, never to the caller — a second `py-*` at the call site is
  how one strip ends up taller than the identical strip on another page.

### Navigation

- **A collapsible left rail**, never a top nav. It is the only persistent
  chrome; the timer bar above the outlet belongs to no page and is not
  navigation.
- **`--sidebar` against the page's background**, one hairline on the inner edge.
  It follows the theme like every other surface — the near-black rail with the
  amber wash that this document used to specify in both ramps is gone with the
  rest of the darkroom.
- **Items:** registry radius, label at the label role, icon at 16px. Rest is
  muted; hover and current both fill to `--sidebar-accent`. Current is
  additionally `font-medium` and carries `aria-current` — the fill is never the
  only carrier.
- **The drag rail sits inside the sidebar's own edge** — see
  `SIDEBAR_RAIL_INSIDE_EDGE` under The Shadcn-First Rule. shadcn's default hangs
  half of a 16px strip over the page, which silently swallows clicks on the
  leftmost 8px of every entry row.
- **Collapsed to an icon rail** at `md` and below the trigger is a hamburger;
  the rail becomes a sheet. Icons keep their labels as tooltips at zero delay,
  because an icon-only rail with a delayed tooltip is an unlabelled control.
- **Direct names, not umbrellas.** Timer, Reports, Projects, Invoices,
  Settings. Nothing is called Home or Overview.

### Chips

- **Style:** `rounded-full`, `px-2.5 py-1`, label role at `text-xs`, on
  `--background` inside a `--card` band so it steps away from the band rather
  than into it.
- **Border:** `--input`. A chip carries no fill of its own and sits on a band
  rather than on the page, which is the exact case The Boundary Split exists
  for — the divider tone measures under 3:1 there, and did when this system
  spelled the same distinction `edge` versus `edge-raised`.
- **Selected:** fill plus `aria-pressed`. The two adjacent spellings of "on" in
  the app — a segmented tab and a toggle button — use the same fill
  deliberately, so two controls in one row do not say the same state two ways.

### The Timer Bar

The signature component: one wide title field, the classifiers collapsed to
icons in a footer strip, the elapsed time, and one round control that both
starts and stops.

- **The section IS the primary input's boundary**, so its border is an
  interactive control boundary under SC 1.4.11, not a divider — which is
  exactly The Boundary Split, and why it is `--input` when idle rather than
  `--border`. `--primary` while running. The two cross-fade at 100ms.
- **Focus is an outline, not a border shift**, because the border is already
  saying something else. See Buttons.
- **The toggle** is a 42px disc, `--primary` in both states,
  `active:scale-[0.96]` on press. It is never disabled: anything that can refuse
  a start is a reason someone stops tracking.
- **Running is carried four ways, none of them colour alone** — and with a
  monochrome palette that is now the whole mechanism rather than a safety net:
  the border shift, the icon changing from play to stop, the accessible name
  changing from "Start timer" to "Stop timer", and the duration ticking beside
  it.

### The Entry Row

- **A table row, not a card.** 54px (`--entry-row-height`), full-bleed, one
  gutter, a `border-t-2` between days and nothing between rows within a day.
- **Every field edits in place** — title, time, duration, note, classifiers are
  all inline triggers in the row itself, never a modal. Controls that must fit
  inside the row's height take padding-only sizing (`size="row-trigger"`,
  `size="icon-row"`) and reach SC 2.5.8's 24px through an `after:` hit area
  rather than by growing the box.
- **Row actions are `ghost`.** They were a `quiet` variant with no hover plate;
  see Buttons for why that was better and why it is gone.

### Motion vocabulary

Motion conveys state and nothing else. It lives here rather than in a section of
its own because every value below belongs to a component.

- **100ms `ease-out`** for a control answering a press or a state change (the
  timer toggle's scale and fill, the bar's boundary, a popover's entrance). They
  share the number so that a single state change reads as one event.
- **150ms** for a dialog, **200ms** for a toast — larger surfaces, longer throw.
- **Symmetric enter and exit.** A popover scales from
  `origin-[var(--transform-origin)]` — the trigger, resolved after any flip —
  and leaves the same way. A surface that arrives one way and departs another
  reads as two unrelated events.
- **Name the real property.** Tailwind v4 compiles `scale-*` to `scale:` and
  `translate-*` to `translate:`, not to `transform`. A hand-written
  `transition-[…]` list naming `transform` therefore matches nothing: the value
  snaps while its neighbours cross-fade. It shipped in three components before
  it was caught, because it is invisible in the class list. `transition` and
  `transition-transform` both resolve to `transform, translate, scale, rotate`
  and are safe — the trap is only ever the hand-written list, because that is
  the only form where the author supplies the properties.
- **Every displacement carries `motion-reduce:transition-none`.** The transform
  itself stays; only its interpolation is dropped. A running timer already
  updates continuously and must stay readable when everything else stops.
- **No entrance animation on data.** Charts set `isAnimationActive={false}`;
  rows do not fly in. An instrument does not need its numbers to arrive.

## 6. Do's and Don'ts

### Do:
- **Do** treat the token set in `src/styles.css` as closed. A new colour token
  is a colour the theme picker cannot reach; compose the shade you need at the
  call site instead.
- **Do** set every duration, timestamp, and total in IBM Plex Mono with
  `font-variant-numeric: tnum`.
- **Do** pair every colour-carried meaning with text, icon, shape, or hatch. This
  was always the rule and is now the *only* mechanism for most states, because
  the palette is monochrome.
- **Do** express depth by stepping `--background` → `--card` → `--popover`, and
  add an edge when the step alone does not carry it — which in the light ramp is
  always, since shadcn puts all three at white.
- **Do** override a vendored component at the call site rather than editing it,
  so `npx shadcn@latest add --overwrite` stays a safe command.
- **Do** name the property a transition actually animates. `scale-*` compiles to
  `scale:` and `translate-*` to `translate:`; a list naming `transform` animates
  neither.
- **Do** give everything that MOVES a `prefers-reduced-motion` alternative —
  anything transitioning `translate`, `scale`, `rotate`, a position or a box
  dimension. Drop the tween, keep the end state.
  - **Colour and opacity transitions may stay.** They are not vestibular, and an
    instant colour change is still a colour change — nothing a control says is
    lost by removing the fade. Reserve the opt-out for displacement, where it is
    doing real work.

### Don't:
- **Don't** reintroduce a private colour vocabulary. That is the entire reason
  this document was rewritten: a token the theme picker does not set is a
  surface that stays the wrong colour when someone picks a theme.
- **Don't** build the **near-black-with-purple-glow aesthetic** — subtle
  purple-blue gradients, thin low-contrast borders, glow on hover. It is the
  most-copied look in product design right now and would make this
  indistinguishable from everything else shipping.
- **Don't** drift to **terminal-native dark mode** — pure black, neon green or
  cyan, monospace body text, scanlines. It is the obvious escape from generic
  SaaS and therefore its own cliché.
- **Don't** build **gamified productivity** — no streaks, badges, confetti,
  mascots, or productivity scores. Shame mechanics around untracked hours
  actively damage trust in a billing tool.
- **Don't** build **enterprise timesheet software** — no approval grids, nested
  project taxonomies, or submit-at-end-of-week ceremony.
- **Don't** build **generic SaaS startup** — no purple-to-blue gradients,
  floating 3D blobs, glassmorphic cards, or the big-number hero-metric template.
- **Don't** build a **playful consumer app** — no rounded-everything, bright
  illustration, emoji-forward copy, or cheerful anthropomorphism.
- **Don't** let /reports become an **analytics dashboard**. Four panels, all four
  cuts of the ONE question the page exists to answer, monochrome unless the axis
  earns a hue. The thing to keep refusing is a *grid of unrelated metrics*: if a
  panel does not help answer "where did this period go", it is a tile, and tiles
  are the template this system rejects.
- **Don't** use uppercase tracked-out eyebrow labels above sections.
- **Don't** use `border-left` or `border-right` above 1px as a coloured accent
  stripe on rows, cards, or callouts.
- **Don't** apply gradient text, anywhere, for any reason.

**Audit test:** if a screenshot could be mistaken for a Linear clone, the
borders are too dim and something is glowing. If it could be mistaken for a
terminal, the mono has escaped the numbers.

**And one the reset added:** if a screen still looks right after you swap
`src/styles.css` for a different shadcn theme, the component is correct. If it
does not, it is holding a colour the theme cannot reach.
