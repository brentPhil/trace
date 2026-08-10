/**
 * The app is a warm graphite room; a document is paper.
 *
 * A `bg-ground` PDF is one nobody can print and a recipient reads as broken, so
 * the palette is re-derived at paper luminance here — once, in a table — rather
 * than inverted ad hoc at each draw call.
 *
 * DESIGN.md's rules survive the trip and are what this table encodes: brass is
 * currency amounts and nothing else (the Two Temperatures Rule), and no series
 * is identified by its colour alone — every one is labelled in the layout.
 *
 * Values are sRGB 0..1 triples, which is what pdf-lib's `rgb()` takes.
 */

export const PAGE = {
  /** A4 portrait in PostScript points, matching the reference report. */
  width: 595.28,
  height: 841.89,
  margin: 48,
} as const

export type Rgb = readonly [number, number, number]

export const PAPER = {
  /** Body text. Near-black, warm, never pure #000 — pure black on white is
   *  harsher in print than on a screen. */
  ink: [0.11, 0.10, 0.09],
  /** Labels, axis ticks, the footer. */
  inkMuted: [0.42, 0.41, 0.39],
  /** Table rules and separators. */
  rule: [0.82, 0.81, 0.79],
  /** Money, and only money. */
  brass: [0.55, 0.42, 0.09],
  /** A billable bar segment. */
  bar: [0.35, 0.44, 0.52],
  /** A non-billable bar segment — same hue, lighter, and always labelled, so
   *  the distinction never rests on the colour. */
  barMuted: [0.72, 0.76, 0.80],
  /** The Hatch Rule's stroke: absence, drawn as texture. */
  hatch: [0.86, 0.85, 0.83],
} as const satisfies Record<string, Rgb>

/**
 * A project's palette key at paper luminance.
 *
 * Falls back to `inkMuted` for a key this table does not know, rather than
 * throwing: a project colour added to `convex/lib/palette.ts` later must not
 * break an export of last year's work.
 */
/*
 * All twelve keys of `convex/lib/palette.ts`, and exactly those.
 *
 * DERIVED, not invented: each is the app's own `--project-*` oklch from
 * src/styles.css — every one of which is `oklch(0.72 C H)`, tuned for a dark
 * room — re-rendered at L = 0.55 for white paper, keeping its chroma and hue.
 * The trailing figure is the result's contrast against white; the floor for a
 * filled shape is 3:1 (WCAG 2.2 SC 1.4.11) and the worst here is 4.51:1.
 *
 * L = 0.55 is the LIGHTEST value that clears 4.5:1 across all twelve, so it
 * keeps as much of each hue's identity as legibility allows.
 */
const PROJECT_INK: Record<string, Rgb> = {
  slate: [0.412, 0.450, 0.491], // 4.84:1
  rose: [0.687, 0.299, 0.377], // 5.20:1
  coral: [0.690, 0.317, 0.225], // 5.15:1
  amber: [0.655, 0.359, 0.0], // 5.05:1
  olive: [0.462, 0.465, 0.102], // 4.77:1
  moss: [0.265, 0.515, 0.208], // 4.61:1
  sage: [0.233, 0.508, 0.373], // 4.64:1
  teal: [0.0, 0.525, 0.455], // 4.51:1
  cyan: [0.0, 0.512, 0.535], // 4.59:1
  indigo: [0.363, 0.411, 0.739], // 5.00:1
  violet: [0.494, 0.366, 0.696], // 5.12:1
  plum: [0.607, 0.323, 0.585], // 5.20:1
}

export function paperColorFor(paletteKey: string): Rgb {
  return PROJECT_INK[paletteKey] ?? PAPER.inkMuted
}
