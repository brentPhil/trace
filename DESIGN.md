<!-- SEED: colors, typography, and motion are decided; spacing, radii, and components are not. Re-run /impeccable document once there's real UI to capture the actual tokens and generate the sidecar. -->
---
name: Trace
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

# Design System: Trace

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

A warm graphite room with two signal colours and nothing else.

### Primary
- **Enlarger** (`oklch(0.80 0.10 230)`): The running state, and nothing else.
  A live timer, an active entry row, the stop control while tracking. This is
  the only cold colour in the system and the only colour that ever animates.
  Reserving it is what makes a running timer findable in half a second.

### Secondary
- **Brass** (`oklch(0.76 0.10 85)`): Billable. Totals that will appear on an
  invoice, billable-marked entries, currency. Warm and metallic — a ledger
  tone, deliberately not the same family as anything that indicates activity.

### Tertiary
- **Alarm** (`oklch(0.68 0.17 25)`): Destructive and error only. Deleting an
  entry, a failed save, a validation failure. Never used for warnings, never
  for "attention", never decoratively.

### Neutral
- **Ground** (`oklch(0.18 0.008 75)`): The room. Page background. Warm-tinted
  so it reads as a lit space rather than a void.
- **Surface** (`oklch(0.22 0.008 75)`): Panels, list rows, the timer bar.
- **Surface Raised** (`oklch(0.26 0.008 75)`): Popovers, dialogs, menus.
- **Edge** (`oklch(0.5 0.01 75)`): The boundary of an interactive control —
  input borders, outline buttons. Measured at 3.15:1 against ground. This value
  is set by WCAG 2.2 SC 1.4.11, not by taste. Do not darken it.
- **Edge Soft** (`oklch(0.3 0.008 75)`): Dividers and separators between
  passive content, where no contrast minimum applies.
- **Ink** (`oklch(0.93 0.008 80)`): Primary text — entry titles, notes,
  durations. Warm ivory, ~12:1 on ground.
- **Ink Muted** (`oklch(0.68 0.010 75)`): Secondary text, timestamps, labels.
  ~5.9:1 on ground. This is the floor; nothing dimmer is permitted for text.

### Named Rules

**The Cold Light Rule.** Enlarger means running. It may not be used for links,
focus rings, selected states, primary buttons, or decoration. If a screen shows
cold light and nothing is being tracked, the screen is wrong.

**The Two Temperatures Rule.** Cold means happening now; warm means money.
These are the only two meanings colour carries. Anything else — status,
category, client — is encoded with text, shape, or position.

**The Boundary Rule.** Anything the user can interact with is identified by a
border at Edge or brighter, never by a fill tint alone. A dark surface makes
tinted fills tempting and they do not survive the 3:1 floor — the shadcn default
input measured 1.69:1 before this rule was applied.

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
- **Primary:** Ink on ground. Deliberately *not* the cold light — see The Cold
  Light Rule. On a page where nothing is running, the affirmative action is a
  high-contrast neutral.
- **Focus:** Neutral ring (`oklch(0.72 0.012 75)`), 3px at 30% plus a border
  shift. Measured at 7.6:1 against ground.

### Inputs / Fields
- **Style:** Outlined — 1px Edge border on Surface fill, `rounded-md`. base-luma
  ships border-transparent over a tinted fill, which identifies the control by
  fill alone at 1.69:1. See The Boundary Rule.
- **Focus:** Border shifts to ring, plus a 3px ring at 30%.
- **Error:** Border and message in Alarm, measured at 6.04:1. Always paired with
  `aria-invalid` on the control and `role="alert"` on the message — the colour
  is never the only carrier.

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
  prose the user can paste into Slack, not a chart grid.
- **Don't** use uppercase tracked-out eyebrow labels above sections.
- **Don't** use `border-left` or `border-right` above 1px as a coloured accent
  stripe on rows, cards, or callouts.
- **Don't** apply gradient text, anywhere, for any reason.

**Audit test:** if a screenshot could be mistaken for a Linear clone, the
borders are too dim and something is glowing. If it could be mistaken for a
terminal, the ground has lost its warmth and the mono has escaped the numbers.
