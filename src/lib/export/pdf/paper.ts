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

/**
 * The document's type scale, in points.
 *
 * Every step below is chosen so an adjacent pair sits at roughly a 1.15–1.25
 * ratio — a dense document (a table with six columns repeated over several
 * pages) reads as noise if its sizes vary more than that between elements a
 * reader compares directly, like a column header against the body text below
 * it. `title` and `tileValue` are the two exceptions: both are meant to read
 * as a page's headline figures, set apart from the working type beneath them,
 * so their own ratio (1.11) is deliberately tighter than the working scale's.
 *
 * The previous scale — footer 7, ticks/labels 6–7, body 8, TOTAL 9, block
 * headings 11, tile value and title both 16 — put six of those eight sizes
 * at 6–9pt, near the floor of comfortable print legibility at A4, and gave
 * the title no size of its own to read as primary with (it matched the tile
 * value exactly). This scale is a full step up at every tier except the
 * footer, which is deliberately exempt: `footer` is the one place genuinely
 * tiny type is still acceptable, a page number nobody needs to read from
 * across the room.
 */
export const TYPE = {
  /** `Page N / M` — the one place tiny type is still acceptable. */
  footer: 7,
  /** Column headers, axis ticks, a tile's label and sub-line: captions that
   *  sit beside something larger and must stay legible, not blend into it. */
  tick: 8.5,
  /** Table body text, the donut legend, and the qualifying notes below the
   *  tiles and the TOTAL row — this document's main reading size. */
  body: 10,
  /** The TOTAL row: bold, and one step above the body it summarises. */
  strong: 12,
  /** A block's own heading ("Duration by day", "Project distribution",
   *  "Project and description breakdown"). */
  heading: 14,
  /** A summary tile's value — the page's second-level figure, confidently
   *  larger than the block headings around it. */
  tileValue: 18,
  /** The report title — the page's primary figure. Capped at 20: the title
   *  string's format is fixed-width (`Summary report from MM/DD/YYYY to
   *  MM/DD/YYYY`), and 20pt bold DM Sans is the largest size that still
   *  clears the page's content width with real margin (474pt of 499pt
   *  available); 22pt already overruns it. */
  title: 20,
} as const

/**
 * THE INVOICE READS LARGER THAN THE REPORT, and the two documents are on
 * separate scales because they are asking the reader for different things.
 *
 * The report is an ANALYSIS the freelancer runs on their own work: charts, a
 * breakdown that can run to hundreds of rows over several pages, read by
 * someone who already knows what they are looking at. Density is a feature
 * there — a scale that halves the rows per page makes the document worse.
 *
 * The invoice is a DEMAND FOR MONEY sent to somebody else. It is short (a
 * handful of lines, usually one page), it is read once, by a stranger to the
 * work, who reconciles four figures off it and files it. Nothing is bought by
 * fitting more onto the page, and everything is lost if a client squints at
 * the amount they are being asked to pay. `TYPE.body` at 10pt is a comfortable
 * table size for the report and it is small for a document somebody prints,
 * scans, or reads on a phone in a mail client.
 *
 * The steps hold `TYPE`'s own 1.15–1.25 ratio between adjacent tiers, with the
 * same exemption for the title: the word "Invoice" is a masthead rather than
 * the top of the working scale, so its jump is deliberately larger. At 30pt
 * bold DM Sans it measures ~126pt of the 499pt content width, and the logo box
 * begins 347pt in — the two cannot meet.
 *
 * A SEPARATE OBJECT rather than a raise to `TYPE`, because `report-doc.ts`
 * reads every tier above and its geometry (chart boxes, axis ticks, a legend
 * sized to its longest label) is tuned to those numbers. One scale for two
 * documents would mean this change silently re-laid-out the report as well.
 */
export const INVOICE_TYPE = {
  /** `Page N / M`. Still the smallest thing on the page, but no longer at the
   *  floor — a page number on a document that may be printed and stapled is
   *  worth being able to read. */
  footer: 8,
  /** Column headers, meta labels, and a block's own label (`Billed to`). */
  tick: 10,
  /** The document's reading size: every line's description, every figure, the
   *  party blocks and the notes. */
  body: 12,
  /** The TOTAL row — the one figure the document exists to state. */
  strong: 15,
  /** A continuation page's `Invoice … (continued)` heading. */
  heading: 17,
  /** The masthead. See above for why it is exempt from the working ratio. */
  title: 30,
} as const

/**
 * THE TABULAR RULE IS NOT APPLIED ON PAPER, and this is the record of why —
 * because it is a named DESIGN.md rule (§3) being deliberately not followed,
 * which without a note here reads as an oversight nobody noticed.
 *
 * The rule says every duration, timestamp and total is IBM Plex Mono with
 * `tnum`, so "history columns align on the decimal without effort". On screen
 * they do. In this document every figure is DM Sans, whose digits are
 * proportional (`0` is 684 units against `1`'s 312), so right-aligning the
 * Duration and Amount columns aligns their right edges but not their decimal
 * points.
 *
 * It was attempted and it cannot ship. pdf-lib 1.17.1's bundled
 * `@pdf-lib/fontkit` 1.1.1 throws `RangeError: Trying to access beyond buffer
 * length` parsing IBM Plex Mono's SPACE glyph — it has no contours, and
 * fontkit's `_getCBox` reads past the zero-length `glyf` entry. Every weight
 * (400/500/600/700) fails identically; a space-free string draws fine, which is
 * what makes it a trap rather than an obvious blocker. `formatMoney` pins
 * `en-US` and renders any currency without a narrow symbol as `AED 10.50` — with
 * U+00A0 — so of the 39 currencies `supportedCurrencies()` offers, most would
 * crash the export the moment an amount was drawn in mono.
 *
 * Reconsider if pdf-lib upgrades its fontkit, or if another tabular-figure face
 * with a contoured space is embedded. Until then the alignment cost is accepted
 * and the columns stay right-aligned, which is what carries most of the benefit
 * for strings of a fixed format.
 */

export type Rgb = readonly [number, number, number]

export const PAPER = {
  /** Body text. Near-black, warm, never pure #000 — pure black on white is
   *  harsher in print than on a screen. */
  ink: [0.11, 0.10, 0.09],
  /** Labels, axis ticks, the footer.
   *
   * Measured against white per WCAG 2.1's relative-luminance formula: this
   * triple is 5.51:1, clearing the 4.5:1 floor for text carrying information
   * with room to spare (the commonly-cited minimum-AA grey, #767676, is only
   * 4.54:1) — so it is left as-is rather than darkened. What actually made
   * this text hard to read was size (6–8pt) and typeface, not this colour;
   * see `TYPE` above and `render.ts`'s embedded DM Sans. */
  inkMuted: [0.42, 0.41, 0.39],
  /** Table rules and separators — a column header's underline, the rule that
   *  closes a week, the one above TOTAL. Structural: it says "a block ends
   *  here". */
  rule: [0.82, 0.81, 0.79],
  /**
   * The hairline between two body rows, and a chart's gridlines.
   *
   * Deliberately fainter than `rule`: these repeat dozens of times per page and
   * exist to let the eye track ACROSS a row (a wrapped two-line description on
   * the left, its amount 460pt away on the right), not to divide the document
   * into parts. At `rule`'s weight a 22-row table reads as a grid of boxes,
   * which is the enterprise-timesheet look DESIGN.md rejects by name.
   */
  ruleFaint: [0.91, 0.90, 0.885],
  /**
   * The tinted strip a week opens on in the breakdown — the one filled shape
   * in the document that is not data.
   *
   * A fill rather than a rule because the week is the breakdown's only
   * grouping and has to be findable halfway down a page of five hundred rows;
   * a rule at `rule`'s weight had already proved indistinguishable from the
   * ruling that used to run under every row. Warm rather than neutral grey, on
   * the same hue the paper's ink is warmed toward, so the band reads as part of
   * this document rather than as a highlight applied to it.
   *
   * Light enough that the bold label on top of it clears the text-contrast
   * floor comfortably — the label is `ink` (0.11), which is ~15:1 here — and
   * that the strip survives a black-and-white printer as a tint rather than a
   * smear.
   */
  band: [0.945, 0.940, 0.930],
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
