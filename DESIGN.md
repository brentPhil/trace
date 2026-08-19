<!-- SEED: colors, typography, and motion are decided; spacing, radii, and components are not. Re-run /impeccable document once there's real UI to capture the actual tokens and generate the sidecar. -->
---
name: Chroneli
description: A time tracker that records what was accomplished, not only how long it took.
colors:
  ground: "oklch(0.18 0.008 75)"
  surface: "oklch(0.22 0.008 75)"
  surface-raised: "oklch(0.26 0.008 75)"
  edge: "oklch(0.5 0.01 75)"
  edge-soft: "oklch(0.3 0.008 75)"
  ink: "oklch(0.93 0.008 80)"
  ink-muted: "oklch(0.68 0.010 75)"
  enlarger: "oklch(0.80 0.10 230)"
  brass: "oklch(0.76 0.10 85)"
  alarm: "oklch(0.68 0.17 25)"
  safelight: "oklch(0.74 0.16 45)"
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
---

# Design System: Chroneli

## 1. Overview

**Creative North Star: "The Darkroom"**

A darkroom is a space you work in for hours without eye strain, lit by an
ambient safelight that never demands attention. It is also where you find out
what you actually captured — which is precisely this product's premise. Hours
alone don't tell a freelancer what they did on Tuesday; the notes do.

The room is warm and dark. The one cold light is the enlarger, and it is on only
during a timed exposure. That is the whole colour system in one sentence: warm
graphite is the room, and cold light means *running right now*. Because the
running state is the only cold thing on the surface, it needs no legend and
survives peripheral vision, where hue is the first thing the eye loses.

This system explicitly rejects the two directions the category runs in — the
enterprise timesheet grid and the cheerful habit tracker — plus the currently
most-copied look in product design, the near-black-with-purple-glow aesthetic.
What is left is an instrument: quiet, warm, exact.

**Key Characteristics:**
- Warm dark ground, never blue-black and never pure black
- Cold light reserved exclusively for the running state
- Depth by tonal layering, not shadow
- Numbers always monospaced and tabular
- Meaning never carried by colour alone

## 2. Colors

A warm graphite room with three signal colours and nothing else.

### Primary
- **Enlarger** (`oklch(0.80 0.10 230)`): The running state, and nothing else.
  A live timer, an active entry row, the stop control while tracking. This is
  the only cold colour in the system and the only colour that ever animates.
  Reserving it is what makes a running timer findable in half a second.
- **Safelight** (`oklch(0.74 0.16 45)`): The accent: the darkroom's own working
  lamp, and the mark of *act here*. The affirmative action (`--primary` — the
  play button, a confirm), the current selection (calendar range endpoints,
  checked states), and the focus ring (`--ring`). It marks controls, never the
  state of the work itself — the room was pure graphite for a while and read as
  chrome; the safelight is what makes the one pressable thing on a screen read
  as the one pressable thing. Orange (hue 45, chroma 0.16), deliberately a full
  hue step from Brass's gold so "act here" and "money" cannot merge. 7.72:1 on
  ground, 7.11 on Surface, 6.36 on Surface Raised.

### Secondary
- **Brass** (`oklch(0.76 0.10 85)`): Money. A currency amount, and the mark
  that says a piece of work is billable. Warm and metallic — a ledger tone,
  deliberately not the same family as anything that indicates activity.

  **A brass figure is a currency amount.** A billable DURATION is not money —
  it is time that will become money — and it renders like every other duration,
  in Ink. "8h 12m" in brass reads as an amount, which is the one thing it is
  not, and the misreading is worst exactly where it matters: a range with
  billable hours on an unpriced project. /reports says
  `8h 12m billable ($499.20)` with the hours in Ink and only the parenthesised
  figure in brass; `TotalsRow` on /timer follows it.

  The billable MARK keeps brass, because a mark is not a figure and nobody
  reads a glyph as an amount: the `$` on an entry row, the billable toggle in
  the classifier pickers, the Billable filter chip, the billable-by-default
  checkbox on /projects. Each of those is also labelled or shaped, so the
  meaning still survives without colour.

### Tertiary
- **Alarm** (`oklch(0.68 0.17 25)`): Destructive and error only. Deleting an
  entry, a failed save, a validation failure. Never used for warnings, never
  for "attention", never decoratively.

### Neutral
- **Ground** (`oklch(0.18 0.008 75)`): The room. Page background. Warm-tinted
  so it reads as a lit space rather than a void.
- **Surface** (`oklch(0.22 0.008 75)`): Panels, list rows, the timer bar.
- **Surface Raised** (`oklch(0.26 0.008 75)`): Popovers, dialogs, menus.
- **Edge** (`oklch(0.5 0.01 75)`): The boundary of an interactive control that
  sits **on the ground** — input borders, outline buttons on the page itself.
  **3.15:1 against ground, and only against ground: 2.90:1 on Surface and
  2.60:1 on Surface Raised.** That distinction was missing for a long time and
  is how several controls shipped under the floor. This value is set by WCAG
  2.2 SC 1.4.11, not by taste. Do not darken it.
- **Edge Raised** (`oklch(0.56 0.01 75)`): The same boundary for a control that
  sits on a panel, a band, or a popover — a filter chip in /timer's
  `bg-surface` strip, a month stepper inside a calendar. 4.05:1 on ground,
  3.73:1 on Surface, 3.34:1 on Surface Raised, so it clears wherever it lands.
  A control that carries its own `bg-ground` fill may keep Edge instead: the
  border is then adjacent to ground on its inner side and clears there.
- **Edge Soft** (`oklch(0.3 0.008 75)`): Dividers and separators between
  passive content, where no contrast minimum applies.
- **Skeleton** (`oklch(0.34 0.008 75)`): Loading placeholders, and nothing
  else. 1.59:1 against ground. It is decorative, so no WCAG floor applies —
  but `--muted` (which resolves to Surface) measured **1.09:1** and halved
  again at the trough of `animate-pulse`, which is a blank page with an
  invisible pulse on it, not a loading state.
- **Ink** (`oklch(0.93 0.008 80)`): Primary text — entry titles, notes,
  durations. Warm ivory, ~12:1 on ground.
- **Ink Muted** (`oklch(0.68 0.010 75)`): Secondary text, timestamps, labels.
  ~5.9:1 on ground. This is the floor; nothing dimmer is permitted for text.

### Named Rules

**The Cold Light Rule.** Enlarger means running. It may not be used for links,
focus rings, selected states, primary buttons, or decoration. If a screen shows
cold light and nothing is being tracked, the screen is wrong.

**The Two Temperatures Rule.** Cold means happening now; warm splits in two:
brass gold means money, safelight orange means *act here*. These are the only
meanings colour carries. Anything else — status, category, client — is encoded
with text, shape, or position. (The green ring on an accepted meeting avatar is
the one standing exception, and the guest summary restates it in words.)

**The Boundary Rule.** Anything the user can interact with is identified by a
border at Edge or brighter, never by a fill tint alone. A dark surface makes
tinted fills tempting and they do not survive the 3:1 floor — the shadcn default
input measured 1.69:1 before this rule was applied.

**The Adjacent Colour Rule.** A border has **two** adjacent colours — the fill
inside it and the layer outside it — and SC 1.4.11 is measured against each. So
"3:1 against ground" is not a property of a token, it is a property of a token
*on a particular layer*. Before using a border colour, ask what is on both
sides of it: a fill-less control inherits whatever it is sitting on, which is
how a chip that passed on /reports failed on /timer without either file
changing. Every ratio quoted in this document is computed from the tokens by
`src/styles.contrast.test.ts`; add the measurement there rather than to a
commit message.

**The Hatch Rule.** Gaps, untracked time, and entries missing a note are marked
with a hatch or dashed treatment, never a colour. Absence is a texture, not a
hue. This is also how the never-colour-alone commitment gets satisfied
structurally rather than as a bolt-on.

## 3. Typography

**Body / UI Font:** DM Sans Variable (with `system-ui`, sans-serif)
**Duration / Numeric Font:** IBM Plex Mono (with `ui-monospace`, monospace)

**Character:** A geometric sans paired with a humanist mono — a real contrast
axis, not two sans-serifs that almost match. DM Sans stays neutral and legible
at small sizes for eight hours; Plex Mono is warmer and squarer than the
default developer monos, keeping numbers from reading as terminal output.

> Resolves an existing conflict: `src/styles.css` currently loads both Nunito
> Sans and DM Sans. Two near-identical humanist/geometric sans-serifs read as an
> accident. **Nunito Sans is to be removed.**

### Hierarchy
- **Display** (500, `clamp(1.75rem, 4vw, 2.5rem)`, 1.1): The running duration
  when it is the primary object on screen. Rare.
- **Title** (500, `1rem`, 1.4, `-0.01em`): Entry titles. The most-read text in
  the product.
- **Body** (400, `0.9375rem`, 1.6): Notes and recap prose. Capped at 65–75ch.
  *(The recap was **REMOVED 2026-08-08**; this size still applies to notes,
  the only prose that remains.)*
- **Duration** (400, mono, `tnum`, `-0.02em`): Every duration, timestamp, and
  total, at any size.
- **Label** (500, `0.8125rem`): Field labels and column headers. Sentence case.

### Named Rules

**The Tabular Rule.** Every digit the user reads is monospaced with tabular
figures. A running timer whose width jitters as it counts is a defect, and
history columns must align on the decimal without effort.

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
  rule spans something instead of running 1329px under a 272px `<select>`.
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

Shadows barely read on a dark ground and drift toward the glow-on-near-black
aesthetic named as an anti-reference. Layering is expressed by stepping the
neutral ramp — ground to surface to surface-raised — with a one-pixel edge where
a boundary must be unambiguous.

The single exception is genuinely floating UI: popovers, dialogs, and menus may
carry one soft ambient shadow to separate them from the page beneath, because
tonal separation alone is insufficient when content scrolls behind them.

### Named Rules

**The Tonal Depth Rule.** If two surfaces need separating, step the ramp or add
an edge. Reach for a shadow only when the element genuinely floats above
scrolling content.

**The No Glow Rule.** Coloured shadows, glows, and halos are prohibited
throughout, including on the running state. Cold light marks the running entry;
it does not bloom.

## 5. Components

Partial. Only what the auth screens forced a decision on is recorded here; the
rest of `src/components/ui/` is still stock shadcn `base-luma` and is not
documented, because documenting a placeholder would enshrine it as a decision.

### Buttons
- **Shape:** Crisp, not pill — `rounded-md` (~0.36rem at `--radius: 0.45rem`).
  base-luma ships `rounded-4xl`, which computes to ~1.17rem and reads as a pill
  on a 36px control. That is the "rounded-everything" look this system rejects.
- **Primary:** Ground text on Safelight. Deliberately *not* the cold light —
  see The Cold Light Rule. The affirmative action wears the accent; it was a
  high-contrast neutral (ink on ground) until the room gained the safelight,
  and read as chrome rather than as the one thing the page wants pressed.
- **Focus:** The Safelight (`--ring` resolves to it) — a **border shift** to
  that colour, plus a 3px halo of it at 30% opacity. The two carry very
  different weight and the numbers must stay attached to the right one:
  - The **border shift** is what satisfies SC 2.4.11/1.4.11: **7.72:1** against
    ground, 7.11:1 against surface.
  - The **30% halo** is decoration: **1.74:1** over ground. It is nowhere near
    an indicator on its own.

  A single "measured at 7.6:1" attached to the halo is how a focus style
  shipped with the border shift dropped and the number still "checking out".

- **Focus, when the border already carries state.** Some controls cannot spend
  their border on focus because it is already saying something else — the timer
  bar's border is Edge when idle and `enlarger/50` while running. Those use an
  **outline** instead of a border shift:
  `has-[input:focus-visible]:outline-2 outline-offset-2 outline-ring`. The
  `outline-offset-2` is load-bearing: it puts ground on *both* sides of the
  outline, so the figure is **~7.72:1 whatever the control's own fill and
  border are doing** — idle or running, the same number. It also leaves the
  border underneath untouched, so a cold boundary keeps saying "recording"
  while focus gets its own indicator. This is the answer for any future
  control in the same position.

### Inputs / Fields
- **Style:** Outlined — 1px Edge border on Surface fill, `rounded-md`. base-luma
  ships border-transparent over a tinted fill, which identifies the control by
  fill alone at 1.69:1. See The Boundary Rule.
- **Focus:** Border shifts to ring, plus a 3px ring at 30%.
- **Error:** Border and message in Alarm, measured at 6.04:1. Always paired with
  `aria-invalid` on the control and `role="alert"` on the message — the colour
  is never the only carrier.

### Charts

Built on shadcn's chart block (recharts). They live on **/reports → Summary**,
which is a tab beside Detailed rather than a page of its own, so one FilterBar
governs both and the two can never describe different rows.

- **Frame:** `bg-surface`, one `edge-soft` border, `rounded-lg`, no shadow —
  The Tonal Depth Rule. shadcn's own `Card` was removed rather than overridden:
  it ships `rounded-4xl`, `shadow-md` and a `ring-foreground/5`, which is three
  rules broken at once, and a component you have to correct at every call site
  is worse than a fifteen-line panel that is right by construction.
- **The Monochrome Rule.** A chart of past work carries **no hue**. Cold means
  running and warm means money (The Two Temperatures Rule), and a bar of last
  Tuesday is neither. Series are separated on the neutral ramp — Ink against Ink
  Muted — which is the same tonal layering the surfaces use.
  - **The project chart is the one exception**, and it is the exception the
    palette already exists for: twelve capped, legible hues, with the two
    reserved ones absent by construction, and every bar sitting beside its own
    name. Colour is a recognition aid there, never the information.
  - **Money may be brass, when the axis is money.** /reports' Earned chart plots
    currency amounts and is brass throughout. The daily chart plots the same
    billable hours in Ink, because those are a duration.
- **The Hatch Rule applies to plots.** A span with nothing tracked is drawn as a
  short hatched stub, not as bare axis — a missing bar and a zero bar look
  identical, and the eye closes the gap. "No project" is hatched for the same
  reason: an absence is a texture, never a thirteenth colour. The SVG pattern
  and `.hatch-empty` must stay the same angle, spacing and token.
- **Axes are styled by prop, not by stylesheet.** Recharts writes `fill="#666"`
  onto every tick as a presentation attribute (~2.4:1 on Surface). shadcn's
  wrapper tries to undo that with a descendant selector and it did not take
  here. Ticks are Ink Muted, set through `AXIS` in
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
  no `prefers-reduced-motion` alternative. An instrument does not need its
  numbers to fly in.
- **Figures are a readout, not tiles.** The four numbers above the charts are
  label-figure-hairline on the page's own ground. A card per metric, with its
  own border and icon, is the hero-metric template §6 rejects.

Re-run `/impeccable document` in scan mode once the timer and history surfaces
exist; that pass generates the full section and the `.impeccable/design.json`
sidecar.

## 6. Do's and Don'ts

### Do:
- **Do** reserve Enlarger (`oklch(0.80 0.10 230)`) exclusively for the running
  state. It is the most valuable pixel budget in the product.
- **Do** set every duration, timestamp, and total in IBM Plex Mono with
  `font-variant-numeric: tnum`.
- **Do** keep body and note text at or above `oklch(0.68 0.010 75)` on ground —
  roughly 5.9:1, and the dimmest text permitted anywhere.
- **Do** pair every colour-carried meaning with text, icon, or hatch, so state
  survives colour blindness and peripheral vision alike.
- **Do** express depth by stepping ground → surface → surface-raised.
- **Do** give every transition a `prefers-reduced-motion` alternative. A running
  timer already updates continuously; that is the only motion guaranteed to be
  on screen, and it must stay readable when everything else stops.

### Don't:
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
- **Don't** let the recap render as an **analytics dashboard**. It is written
  prose the user can paste into Slack, not a chart grid. **REMOVED 2026-08-08**
  along with the recap.
  - **Reports now has charts** (/reports → Summary, added 2026-08-10), so the
    concern this line raised is live again in a new place — and the answer is
    not "no charts", it is the Charts section in §5. Four panels, all four cuts
    of the ONE question the page exists to answer, monochrome unless the axis
    earns a hue. The thing to keep refusing is a *grid of unrelated metrics*:
    if a panel does not help answer "where did this period go", it is a tile,
    and tiles are the template this system rejects.
- **Don't** use uppercase tracked-out eyebrow labels above sections.
- **Don't** use `border-left` or `border-right` above 1px as a coloured accent
  stripe on rows, cards, or callouts.
- **Don't** apply gradient text, anywhere, for any reason.

**Audit test:** if a screenshot could be mistaken for a Linear clone, the
borders are too dim and something is glowing. If it could be mistaken for a
terminal, the ground has lost its warmth and the mono has escaped the numbers.
