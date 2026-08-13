import { PAPER } from "./paper"
import type { Rgb } from "./paper"

/**
 * A page as DATA, not as calls into pdf-lib.
 *
 * The split that makes this testable: `ops.ts` and `report-doc.ts` decide WHAT
 * is on each page and where, in plain objects a unit test can assert against,
 * and `render.ts` is the only file that touches the PDF library. Pagination is
 * the part that breaks, and asserting it by extracting text back out of a
 * generated binary is a test that fails for reasons that have nothing to do
 * with the layout.
 *
 * Coordinates are PDF user space: origin BOTTOM-LEFT, y increasing upward.
 */

export type TextOp = {
  kind: "text"
  x: number
  y: number
  text: string
  size: number
  bold?: boolean
  /** Where `x` sits relative to the glyphs: their start (`left`, the default),
   *  their end (`right`), or their midpoint (`center`). */
  align?: "left" | "right" | "center"
  color?: Rgb
}

export type RectOp = {
  kind: "rect"
  x: number
  y: number
  width: number
  height: number
  color: Rgb
}

/** An arbitrary filled path, given as SVG path data. Used for donut slices. */
export type PathOp = {
  kind: "path"
  x: number
  y: number
  d: string
  color: Rgb
}

/** A hatched region — absence. Rendered as diagonal strokes, never a fill. */
export type HatchOp = {
  kind: "hatch"
  x: number
  y: number
  width: number
  height: number
}

export type ImageOp = {
  kind: "image"
  x: number
  y: number
  width: number
  height: number
  data: Uint8Array
  format: "png" | "jpeg"
}

export type PdfOp = TextOp | RectOp | PathOp | HatchOp | ImageOp
export type PdfPage = { ops: Array<PdfOp> }

export function text(op: Omit<TextOp, "kind">): TextOp {
  return { kind: "text", ...op }
}

export function rect(op: Omit<RectOp, "kind">): RectOp {
  return { kind: "rect", ...op }
}

/**
 * DM Sans's real advance widths, 1/1000 em, for printable ASCII 32-126.
 *
 * NOT every character these documents draw — the em dash this file's own
 * `truncateToWidth` appends, the middot bulleting a note, an accented letter in
 * an imported description, and a non-breaking space inside a formatted currency
 * all fall through to `DEFAULT_ADVANCE`. That is the designed behaviour rather
 * than a gap (see its note), and it is only ever a rounding error in a wrap or
 * a hanging indent — but the table is ASCII, and claiming otherwise would make
 * the next person trust a measurement it cannot make.
 *
 * These are NOT retyped from a spec sheet — `render.ts` embeds the exact same
 * TTFs (`@expo-google-fonts/dm-sans`'s 400Regular and 700Bold), and these
 * numbers were read back out of THOSE embedded fonts via pdf-lib's own
 * `font.widthOfTextAtSize(char, 1000)`, the same method the previous
 * Helvetica table used. That matters more here than it did for Helvetica:
 * Helvetica's metrics are a fixed spec `pdf-lib` ships built in, but a TTF's
 * metrics are whatever that specific font file contains, and DM Sans is
 * measurably wider than Helvetica per character (mean advance ~532 here
 * against Helvetica's ~530 for regular, but individual glyphs — digits
 * especially — differ enough, e.g. "0" is 684 here against Helvetica's 556,
 * that reusing the old table would silently mis-measure every wrap,
 * truncation, and axis-tick collision this file computes.
 *
 * Regenerate by embedding the same two TTFs with `@pdf-lib/fontkit` and
 * calling `widthOfTextAtSize` for codes 32–126, if the DM Sans dependency
 * version ever changes its metrics.
 */
const DM_SANS_WIDTHS: Record<string, number> = {
  " ": 266,
  "!": 250,
  '"': 291,
  "#": 804,
  $: 580,
  "%": 786,
  "&": 734,
  "'": 159,
  "(": 373,
  ")": 373,
  "*": 480,
  "+": 550,
  ",": 182,
  "-": 541,
  ".": 198,
  "/": 392,
  "0": 684,
  "1": 312,
  "2": 576,
  "3": 591,
  "4": 607,
  "5": 610,
  "6": 628,
  "7": 534,
  "8": 608,
  "9": 628,
  ":": 202,
  ";": 227,
  "<": 550,
  "=": 550,
  ">": 550,
  "?": 524,
  "@": 1005,
  A: 664,
  B: 603,
  C: 717,
  D: 688,
  E: 565,
  F: 535,
  G: 758,
  H: 681,
  I: 234,
  J: 501,
  K: 584,
  L: 527,
  M: 841,
  N: 691,
  O: 774,
  P: 580,
  Q: 774,
  R: 594,
  S: 580,
  T: 561,
  U: 655,
  V: 669,
  W: 968,
  X: 603,
  Y: 580,
  Z: 541,
  "[": 314,
  "\\": 392,
  "]": 314,
  "^": 622,
  _: 660,
  "`": 213,
  a: 544,
  b: 626,
  c: 572,
  d: 627,
  e: 568,
  f: 340,
  g: 558,
  h: 575,
  i: 240,
  j: 243,
  k: 504,
  l: 223,
  m: 891,
  n: 574,
  o: 593,
  p: 626,
  q: 627,
  r: 370,
  s: 502,
  t: 392,
  u: 573,
  v: 527,
  w: 763,
  x: 496,
  y: 556,
  z: 458,
  "{": 427,
  "|": 234,
  "}": 427,
  "~": 550,
}

const DM_SANS_BOLD_WIDTHS: Record<string, number> = {
  " ": 235,
  "!": 309,
  '"': 367,
  "#": 857,
  $: 604,
  "%": 902,
  "&": 781,
  "'": 197,
  "(": 405,
  ")": 405,
  "*": 513,
  "+": 579,
  ",": 246,
  "-": 576,
  ".": 252,
  "/": 427,
  "0": 704,
  "1": 364,
  "2": 577,
  "3": 603,
  "4": 650,
  "5": 622,
  "6": 634,
  "7": 537,
  "8": 633,
  "9": 635,
  ":": 254,
  ";": 278,
  "<": 579,
  "=": 579,
  ">": 579,
  "?": 538,
  "@": 1046,
  A: 709,
  B: 638,
  C: 738,
  D: 707,
  E: 583,
  F: 556,
  G: 778,
  H: 714,
  I: 272,
  J: 541,
  K: 653,
  L: 558,
  M: 886,
  N: 729,
  O: 784,
  P: 614,
  Q: 784,
  R: 631,
  S: 604,
  T: 597,
  U: 685,
  V: 706,
  W: 1018,
  X: 670,
  Y: 635,
  Z: 577,
  "[": 377,
  "\\": 427,
  "]": 377,
  "^": 677,
  _: 725,
  "`": 235,
  a: 586,
  b: 655,
  c: 607,
  d: 655,
  e: 602,
  f: 371,
  g: 596,
  h: 618,
  i: 274,
  j: 274,
  k: 578,
  l: 267,
  m: 941,
  n: 617,
  o: 610,
  p: 655,
  q: 655,
  r: 409,
  s: 532,
  t: 433,
  u: 616,
  v: 565,
  w: 820,
  x: 571,
  y: 604,
  z: 490,
  "{": 470,
  "|": 272,
  "}": 470,
  "~": 579,
}

/**
 * Advance for a character neither table has — a curly quote or accented
 * letter pulled in from an imported description, say. Close to the tables'
 * own mean advance, so an occasional unknown glyph nudges a truncation point
 * by a character rather than corrupting the measurement; the alternative,
 * throwing, would take down a document export over one character in one row.
 */
const DEFAULT_ADVANCE = 570

/** The 1/1000-em advance units a string sums to under `table` — `textWidth`
 *  before the em-to-points conversion, and the shared core `wrapToWidth` and
 *  `hardBreak` both accumulate in, so that division only ever happens once
 *  per measured span (see the comment on `wrapToWidth`'s `spaceUnits`). */
function advanceUnits(str: string, table: Record<string, number>): number {
  let units = 0
  for (const ch of str) {
    units += table[ch] ?? DEFAULT_ADVANCE
  }
  return units
}

/** A string's width in points under the DM Sans this document actually
 *  embeds, matching what `render.ts`'s embedded TTFs will draw it at. Lets
 *  `report-doc.ts` measure text without importing pdf-lib and losing its
 *  purity. */
export function textWidth(str: string, size: number, bold: boolean): number {
  const table = bold ? DM_SANS_BOLD_WIDTHS : DM_SANS_WIDTHS
  return (advanceUnits(str, table) / 1000) * size
}

/**
 * Splits `word` into chunks that each measure `<= maxWidth`, for a single
 * token with no space for greedy wrapping to land on (an imported ticket ID
 * like `[B-CB-326]`, or a long unbroken identifier).
 *
 * Always advances by at least one character per chunk, even when a single
 * character's own advance exceeds `maxWidth` (a non-positive or vanishingly
 * small width) — the alternative, waiting for a character to "fit" a budget
 * that no character can, is what turns a bad column width into a hang
 * instead of a merely ugly page.
 *
 * Tracks a running unit total rather than re-measuring `current` from
 * scratch on every character — the same O(n²) pattern `wrapToWidth` below
 * was rewritten to avoid, just bounded by one word's length here instead of
 * a whole line's, so it never showed up as a real cost.
 */
function hardBreak(
  word: string,
  maxWidth: number,
  size: number,
  bold: boolean
): Array<string> {
  const table = bold ? DM_SANS_BOLD_WIDTHS : DM_SANS_WIDTHS
  const chunks: Array<string> = []
  let current = ""
  let currentUnits = 0
  for (const ch of word) {
    const candidateUnits = currentUnits + (table[ch] ?? DEFAULT_ADVANCE)
    if (current !== "" && (candidateUnits / 1000) * size > maxWidth) {
      chunks.push(current)
      current = ch
      currentUnits = table[ch] ?? DEFAULT_ADVANCE
    } else {
      current += ch
      currentUnits = candidateUnits
    }
  }
  if (current !== "") chunks.push(current)
  return chunks
}

/**
 * Greedy word-wrap, measured with `textWidth` so a line this returns is
 * exactly what `render.ts`'s embedded DM Sans will draw at that width.
 *
 * Replaces `truncateToWidth` for the breakdown table's DESCRIPTION cell:
 * truncation hides the text that justifies a billed line, which a client
 * reconciling the report against an invoice cannot accept. Wrapping keeps
 * every character, at the cost of the row needing more vertical space —
 * `report-doc.ts` is what makes row height follow this function's output
 * rather than a fixed constant.
 *
 * A word wider than `maxWidth` on its own (see `hardBreak`) is broken across
 * lines rather than left to overflow the column, which is the same overprint
 * `truncateToWidth` exists to prevent, just for a word instead of a sentence.
 */
export function wrapToWidth(
  str: string,
  maxWidth: number,
  size: number,
  bold: boolean
): Array<string> {
  if (str === "") return [""]

  const table = bold ? DM_SANS_BOLD_WIDTHS : DM_SANS_WIDTHS

  // Accumulated as integer 1/1000-em UNITS, not points, and converted to
  // points with ONE division at each comparison — not, as an earlier version
  // of this comment claimed, by summing three already-converted point values
  // (`textWidth(current) + textWidth(" ") + textWidth(piece)`). Converting
  // each term separately and adding the results is not exact: `(units /
  // 1000) * size` rounds per term, and three separately-rounded terms need
  // not sum to the same float as one division over their combined units —
  // they disagreed in roughly 3 of every 10 (word, space, word) triples,
  // by 1 ULP, which is only cosmetic (it can only flip a `candidateWidth ===
  // maxWidth` tie) but made the old comment's "exactly" false. Summing units
  // first is what actually reproduces the single-measurement result bit for
  // bit, while still tracking the running total incrementally instead of
  // re-measuring the whole growing line, character by character, for every
  // word — that re-measurement was the O(words²) cost this function replaced:
  // a line N words long paid for its first word's characters N more times on
  // the way to N+1.
  const spaceUnits = advanceUnits(" ", table)

  const lines: Array<string> = []
  let current = ""
  let currentUnits = 0

  for (const word of str.split(" ")) {
    const wordUnits = advanceUnits(word, table)
    const wordWidth = (wordUnits / 1000) * size
    const pieces =
      wordWidth > maxWidth ? hardBreak(word, maxWidth, size, bold) : [word]

    pieces.forEach((piece, pieceIndex) => {
      // The common case (`pieces` is just `[word]`) reuses `wordUnits` rather
      // than measuring `piece` again — the fix for the OTHER half of this
      // function's quadratic cost, where a word's width was measured once to
      // decide whether it needed hard-breaking and a second time as part of
      // the candidate line. A hard-broken piece has no such width in hand, so
      // it is measured once, here, and nowhere else.
      const pieceUnits =
        pieces.length === 1 ? wordUnits : advanceUnits(piece, table)

      // A piece past the first is a continuation of a hard-broken word, not a
      // new word — it must start its own line unconditionally (no leading
      // space to test a fit against), because `hardBreak` already sized it
      // assuming a fresh line's full budget, not whatever room `current` has
      // left over from the word's previous piece.
      if (pieceIndex > 0) {
        lines.push(current)
        current = piece
        currentUnits = pieceUnits
        return
      }
      if (current === "") {
        current = piece
        currentUnits = pieceUnits
        return
      }
      const candidateUnits = currentUnits + spaceUnits + pieceUnits
      if ((candidateUnits / 1000) * size <= maxWidth) {
        current = `${current} ${piece}`
        currentUnits = candidateUnits
      } else {
        lines.push(current)
        current = piece
        currentUnits = pieceUnits
      }
    })
  }
  if (current !== "") lines.push(current)

  // `str.split(" ")` on text with a doubled space (or a leading/trailing one)
  // yields empty-string words, which the loop above folds in harmlessly but
  // can leave `lines` itself empty for an all-space input — still one row,
  // same as the empty-string case above.
  return lines.length > 0 ? lines : [""]
}

/** The small clearance kept between two neighbouring axis labels' widest
 *  extents — enough that thinned ticks still read as separate labels rather
 *  than one run-on string. Every call site (production and every test) used
 *  the same value, so it is a fact about how this axis is drawn, not a
 *  parameter callers ever had reason to vary. */
const AXIS_LABEL_GUTTER = 4

/**
 * Which bucket indices get an x-axis label, thinned so they stop colliding.
 *
 * A 31-day range at 6pt draws 31 labels across ~465pt of chart width; at that
 * density `Mon 10` overlaps into `Mon 1` and the axis becomes unreadable.
 * Rather than shrinking the type or rotating labels (both ruled out), this
 * measures the widest label actually present and renders every Nth bucket at
 * the step that clears a small gutter between neighbours — always keeping
 * the first and last bucket so the axis still states its own range even when
 * thinned.
 */
export function axisTickIndices(
  labels: ReadonlyArray<string>,
  totalWidth: number,
  size: number,
  bold: boolean
): Array<number> {
  if (labels.length === 0) return []
  if (labels.length === 1) return [0]

  const slot = totalWidth / labels.length
  const widest = Math.max(
    ...labels.map((label) => textWidth(label, size, bold))
  )
  const step = Math.max(1, Math.ceil((widest + AXIS_LABEL_GUTTER) / slot))

  const indices: Array<number> = []
  for (let i = 0; i < labels.length; i += step) indices.push(i)

  const last = labels.length - 1
  if (indices.at(-1) !== last) indices.push(last)
  return indices
}

const TAU = Math.PI * 2

function pointOn(
  cx: number,
  cy: number,
  radius: number,
  angle: number
): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
}

/** One donut slice's path, paired with the index of the VALUE it was built
 *  from in the input array — not its position among the returned slices.
 *  Zero-length values are skipped (see `donutSlices` below), so those two
 *  indices diverge the moment any value is zero; a caller matching this
 *  slice back to whatever else it keeps per-value (a colour, a legend
 *  label) must use `index`, not its position in this array. */
export type DonutSlice = { d: string; index: number }

/**
 * A donut, as one SVG path per non-zero-length slice, each carrying the
 * index of its own source value.
 *
 * Zero-length slices are skipped rather than emitted as degenerate arcs, and a
 * single 100% slice — the reference report's own case, one project — is drawn
 * as TWO 180-degree arcs per edge. One arc of exactly 360 degrees has identical
 * start and end points, which most renderers resolve to nothing at all: the
 * chart would silently vanish in exactly the case it is most likely to be used.
 */
export function donutSlices(
  values: ReadonlyArray<number>,
  cx: number,
  cy: number,
  outer: number,
  inner: number
): Array<DonutSlice> {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= 0) return []

  const slices: Array<DonutSlice> = []
  let angle = -Math.PI / 2 // Twelve o'clock, which is where a reader starts.

  values.forEach((value, index) => {
    if (value <= 0) return
    const sweep = (value / total) * TAU
    const end = angle + sweep
    // Always split into two arcs, even for an ordinary partial slice that
    // is nowhere near a half-turn: an SVG arc command cannot express a sweep
    // of exactly 360 degrees (start and end points coincide, so most
    // renderers draw nothing), and the one slice that CAN reach 360 degrees
    // — a single value holding the whole total — is built by this same code
    // path, not a special case of it. Splitting unconditionally means that
    // slice never has to be detected or branched on.
    const mid = angle + sweep / 2
    const large = 0

    const [ox1, oy1] = pointOn(cx, cy, outer, angle)
    const [oxm, oym] = pointOn(cx, cy, outer, mid)
    const [ox2, oy2] = pointOn(cx, cy, outer, end)
    const [ix2, iy2] = pointOn(cx, cy, inner, end)
    const [ixm, iym] = pointOn(cx, cy, inner, mid)
    const [ix1, iy1] = pointOn(cx, cy, inner, angle)

    slices.push({
      d: [
        `M ${ox1} ${oy1}`,
        `A ${outer} ${outer} 0 ${large} 1 ${oxm} ${oym}`,
        `A ${outer} ${outer} 0 ${large} 1 ${ox2} ${oy2}`,
        `L ${ix2} ${iy2}`,
        `A ${inner} ${inner} 0 ${large} 0 ${ixm} ${iym}`,
        `A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1}`,
        "Z",
      ].join(" "),
      index,
    })
    angle = end
  })
  return slices
}

/**
 * A single line, cut to fit `maxWidth`, with an ellipsis marking the cut.
 *
 * THE ONE PLACE THIS IS RIGHT is a chart legend, and the doctrine everywhere
 * else in this pipeline is the opposite: `wrapToWidth` exists precisely because
 * truncation hides the text that justifies a billed line, which a client
 * reconciling the report against an invoice cannot accept. A legend is not that
 * text. It is a recognition aid beside a coloured swatch (DESIGN.md, §5: "Colour
 * is a recognition aid there, never the information"), it sits in a fixed 17pt
 * rhythm that a wrapped name would break, and — unlike the breakdown table — it
 * has a hard vertical budget: twelve projects is the palette's own maximum, and
 * twelve two-line rows run off the bottom of the page. The full project name
 * survives in the breakdown table's PROJECT column, which does wrap.
 *
 * Returns the ellipsis alone rather than an empty string when not even one
 * character fits, so a cell that cannot be drawn still reads as elided text
 * rather than as a missing value.
 */
export function truncateToWidth(
  str: string,
  maxWidth: number,
  size: number,
  bold: boolean
): string {
  if (textWidth(str, size, bold) <= maxWidth) return str
  const ellipsis = "…"
  const budget = maxWidth - textWidth(ellipsis, size, bold)
  const table = bold ? DM_SANS_BOLD_WIDTHS : DM_SANS_WIDTHS

  let units = 0
  let cut = ""
  for (const ch of str) {
    units += table[ch] ?? DEFAULT_ADVANCE
    if ((units / 1000) * size > budget) break
    cut += ch
  }
  // `trimEnd`: cutting mid-phrase often lands on a space, and "Vessel …" reads
  // as a gap where a word was rather than as one elided name.
  return `${cut.trimEnd()}${ellipsis}`
}

const COLUMN_GAP = 3

/**
 * The widest a single bar may be drawn, however few there are.
 *
 * `slot - COLUMN_GAP` alone is only a sensible width when the slots are
 * narrow. A one-bucket range — a single day exported on its own, which is an
 * ordinary thing to do — gave that one bar the plot's entire 472pt width, and a
 * 472×280pt filled rectangle does not read as a bar at all; it reads as a
 * shaded panel with an axis drawn beside it. Capping and centring leaves every
 * multi-bar chart byte-identical (below the cap, `(slot - barWidth) / 2` IS
 * `COLUMN_GAP / 2`) and makes the degenerate case look like the chart it is.
 */
const MAX_BAR_WIDTH = 28

/**
 * The measured-zero tick's height. A real bar must always clear this, or a
 * genuine (if tiny) duration reads as less certain than an explicit zero —
 * see `MIN_BAR_HEIGHT` below.
 */
const ZERO_MARK_HEIGHT = 1

/**
 * The floor for a bar with a real, non-zero duration. Set above
 * `ZERO_MARK_HEIGHT` rather than equal to it, so a boosted bar can never
 * land exactly on the tick and read as ambiguous between "measured, tiny"
 * and "measured, zero".
 */
const MIN_BAR_HEIGHT = 1.5

/**
 * A stacked bar per span, scaled so that `maxMs` fills `box.height`.
 *
 * An empty span is HATCHED, never drawn as a bar of height zero (the Hatch
 * Rule): a zero-height bar and "no data arrived" are the same picture, and the
 * gap where somebody took a Thursday off is information the chart exists to
 * carry.
 *
 * `maxMs` IS THE AXIS TOP, and passing it is what keeps the bars and the
 * gridlines drawn behind them telling the same story. Scaling to the tallest
 * BAR instead — which is what this did before there was an axis — puts the
 * tallest bar flush against the plot's ceiling while the top gridline says a
 * rounder, larger number, so every bar on the page reads high by the ratio
 * between them. On a document a client reconciles against an invoice, a chart
 * that overstates by 20% is worse than a chart with no scale at all, because
 * the scale is what invites the reader to trust it. Defaults to the tallest bar
 * so a caller with no axis still gets the old, self-scaled behaviour.
 */
export function barColumns(
  values: ReadonlyArray<{
    billableMs: number
    nonBillableMs: number
    empty: boolean
  }>,
  box: { x: number; y: number; width: number; height: number },
  maxMs?: number
): Array<PdfOp> {
  if (values.length === 0) return []

  const tallest =
    maxMs ??
    Math.max(...values.map((value) => value.billableMs + value.nonBillableMs))
  const slot = box.width / values.length
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(1, slot - COLUMN_GAP))
  // Centred in its slot rather than offset by half a gap: the two are the same
  // number whenever the cap is not binding, and only the capped case moves.
  const barInset = (slot - barWidth) / 2

  const ops: Array<PdfOp> = []
  values.forEach((value, index) => {
    const x = box.x + index * slot + barInset

    if (value.empty) {
      ops.push({
        kind: "hatch",
        x,
        y: box.y,
        width: barWidth,
        height: box.height,
      })
      return
    }

    // `tallest` is only zero when every span is empty, which the branch above
    // has already taken — but a non-empty span holding a zero-length entry
    // reaches here, so the guard stays.
    const scale = tallest <= 0 ? 0 : box.height / tallest
    const rawBillable = value.billableMs * scale
    const rawNonBillable = value.nonBillableMs * scale
    const rawTotal = rawBillable + rawNonBillable

    // Proportional scaling alone can draw a genuinely tiny non-zero duration
    // shorter than the fixed measured-zero tick: one minute against an
    // 8-hour peak in a tall chart lands under a third of a point. That
    // states a day with real work as LESS than a day with none — on a
    // document a client reconciles line by line, the worst error this
    // pipeline can make. Floor the total at `MIN_BAR_HEIGHT` and redistribute
    // the two segments in their original ratio; a bar already taller than
    // the floor is untouched, so ordinary columns keep their proportional
    // reading.
    const boost =
      rawTotal > 0 && rawTotal < MIN_BAR_HEIGHT ? MIN_BAR_HEIGHT / rawTotal : 1
    const billable = rawBillable * boost
    const nonBillable = rawNonBillable * boost

    if (billable > 0) {
      ops.push(
        rect({
          x,
          y: box.y,
          width: barWidth,
          height: billable,
          color: PAPER.bar,
        })
      )
    }
    if (nonBillable > 0) {
      ops.push(
        rect({
          x,
          y: box.y + billable,
          width: barWidth,
          height: nonBillable,
          color: PAPER.barMuted,
        })
      )
    }

    /*
     * `empty` is `count === 0`, not `totalMs === 0` — a span holding only a
     * zero-length entry is `empty: false` and reaches here with both segments
     * at zero height, so neither push above fires. Left alone, that is a blank
     * column indistinguishable from a rendering fault; hatching it would be
     * wrong too, since it claims "no data arrived" when an entry did. A
     * baseline tick says the third thing that actually happened: measured,
     * and zero.
     */
    if (billable <= 0 && nonBillable <= 0) {
      ops.push(
        rect({
          x,
          y: box.y,
          width: barWidth,
          height: ZERO_MARK_HEIGHT,
          color: PAPER.bar,
        })
      )
    }
  })
  return ops
}
