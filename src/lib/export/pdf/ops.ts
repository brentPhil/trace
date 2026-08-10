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
  align?: "left" | "right"
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
export type PathOp = { kind: "path"; x: number; y: number; d: string; color: Rgb }

/** A hatched region — absence. Rendered as diagonal strokes, never a fill. */
export type HatchOp = { kind: "hatch"; x: number; y: number; width: number; height: number }

export type PdfOp = TextOp | RectOp | PathOp | HatchOp
export type PdfPage = { ops: Array<PdfOp> }

export function text(op: Omit<TextOp, "kind">): TextOp {
  return { kind: "text", ...op }
}

export function rect(op: Omit<RectOp, "kind">): RectOp {
  return { kind: "rect", ...op }
}

/**
 * Adobe's standard Helvetica advance widths, 1/1000 em, for printable ASCII
 * 32-126 — every character an export string in this app actually draws.
 * `render.ts` embeds the same `StandardFonts.Helvetica`/`HelveticaBold`, and
 * these numbers were read back out of that exact embedded font
 * (`font.widthOfTextAtSize`), not retyped from a spec sheet, so a truncation
 * decision made here matches what pdf-lib will actually lay out a page with.
 */
const HELVETICA_WIDTHS: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667,
  "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
  ".": 278, "/": 278, "0": 556, "1": 556, "2": 556, "3": 556, "4": 556,
  "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 278, ";": 278,
  "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015, A: 667, B: 667,
  C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667,
  L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 278, "\\": 278,
  "]": 278, "^": 469, _: 556, "`": 333, a: 556, b: 556, c: 500, d: 556,
  e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
  n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500,
  w: 722, x: 500, y: 500, z: 500, "{": 334, "|": 260, "}": 334, "~": 584,
}

const HELVETICA_BOLD_WIDTHS: Record<string, number> = {
  " ": 278, "!": 333, '"': 474, "#": 556, $: 556, "%": 889, "&": 722,
  "'": 238, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
  ".": 278, "/": 278, "0": 556, "1": 556, "2": 556, "3": 556, "4": 556,
  "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 333, ";": 333,
  "<": 584, "=": 584, ">": 584, "?": 611, "@": 975, A: 722, B: 722,
  C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722,
  L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 333, "\\": 278,
  "]": 333, "^": 584, _: 556, "`": 333, a: 556, b: 611, c: 556, d: 611,
  e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889,
  n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556,
  w: 778, x: 556, y: 556, z: 500, "{": 389, "|": 280, "}": 389, "~": 584,
}

/**
 * Advance for a character neither table has — a curly quote or accented
 * letter pulled in from an imported description, say. Close to the tables'
 * own mean advance, so an occasional unknown glyph nudges a truncation point
 * by a character rather than corrupting the measurement; the alternative,
 * throwing, would take down a document export over one character in one row.
 */
const DEFAULT_ADVANCE = 556

/** A string's Helvetica width in points, matching what `render.ts`'s embedded
 *  `StandardFonts` will actually draw it at. Lets `report-doc.ts` measure
 *  text without importing pdf-lib and losing its purity. */
export function helveticaWidth(str: string, size: number, bold: boolean): number {
  const table = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS
  let units = 0
  for (const ch of str) {
    units += table[ch] ?? DEFAULT_ADVANCE
  }
  return (units / 1000) * size
}

const ELLIPSIS = "…"

/**
 * Shortens `text` to fit `maxWidth`, appending a one-character ellipsis.
 *
 * Fixes the overprint where a long description ran straight through the
 * DURATION column: text was drawn at a column x with no width limit, so two
 * cells' glyphs landed on top of each other on a document a client
 * reconciles line by line against an invoice.
 */
export function truncateToWidth(
  str: string,
  maxWidth: number,
  size: number,
  bold: boolean
): string {
  if (helveticaWidth(str, size, bold) <= maxWidth) return str

  const budget = maxWidth - helveticaWidth(ELLIPSIS, size, bold)
  if (budget <= 0) return ELLIPSIS

  let cut = str.length
  while (cut > 0 && helveticaWidth(str.slice(0, cut), size, bold) > budget) {
    cut -= 1
  }
  return str.slice(0, cut) + ELLIPSIS
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
 */
function hardBreak(word: string, maxWidth: number, size: number, bold: boolean): Array<string> {
  const chunks: Array<string> = []
  let current = ""
  for (const ch of word) {
    const candidate = current + ch
    if (current !== "" && helveticaWidth(candidate, size, bold) > maxWidth) {
      chunks.push(current)
      current = ch
    } else {
      current = candidate
    }
  }
  if (current !== "") chunks.push(current)
  return chunks
}

/**
 * Greedy word-wrap, measured with `helveticaWidth` so a line this returns is
 * exactly what `render.ts`'s embedded Helvetica will draw at that width.
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

  const lines: Array<string> = []
  let current = ""

  for (const word of str.split(" ")) {
    const pieces =
      helveticaWidth(word, size, bold) > maxWidth
        ? hardBreak(word, maxWidth, size, bold)
        : [word]

    pieces.forEach((piece, pieceIndex) => {
      // A piece past the first is a continuation of a hard-broken word, not a
      // new word — it must start its own line unconditionally (no leading
      // space to test a fit against), because `hardBreak` already sized it
      // assuming a fresh line's full budget, not whatever room `current` has
      // left over from the word's previous piece.
      if (pieceIndex > 0) {
        lines.push(current)
        current = piece
        return
      }
      if (current === "") {
        current = piece
        return
      }
      const candidate = `${current} ${piece}`
      if (helveticaWidth(candidate, size, bold) <= maxWidth) {
        current = candidate
      } else {
        lines.push(current)
        current = piece
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
  bold: boolean,
  gutter = 4
): Array<number> {
  if (labels.length === 0) return []
  if (labels.length === 1) return [0]

  const slot = totalWidth / labels.length
  const widest = Math.max(...labels.map((label) => helveticaWidth(label, size, bold)))
  const step = Math.max(1, Math.ceil((widest + gutter) / slot))

  const indices: Array<number> = []
  for (let i = 0; i < labels.length; i += step) indices.push(i)

  const last = labels.length - 1
  if (indices.at(-1) !== last) indices.push(last)
  return indices
}

const TAU = Math.PI * 2

function pointOn(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
}

/**
 * A donut, as one SVG path per slice.
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
): Array<string> {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  if (total <= 0) return []

  const paths: Array<string> = []
  let angle = -Math.PI / 2 // Twelve o'clock, which is where a reader starts.

  for (const value of values) {
    if (value <= 0) continue
    const sweep = (value / total) * TAU
    const end = angle + sweep
    // Split anything past a half-turn, which also covers the full-circle case.
    const mid = angle + sweep / 2
    const large = 0

    const [ox1, oy1] = pointOn(cx, cy, outer, angle)
    const [oxm, oym] = pointOn(cx, cy, outer, mid)
    const [ox2, oy2] = pointOn(cx, cy, outer, end)
    const [ix2, iy2] = pointOn(cx, cy, inner, end)
    const [ixm, iym] = pointOn(cx, cy, inner, mid)
    const [ix1, iy1] = pointOn(cx, cy, inner, angle)

    paths.push(
      [
        `M ${ox1} ${oy1}`,
        `A ${outer} ${outer} 0 ${large} 1 ${oxm} ${oym}`,
        `A ${outer} ${outer} 0 ${large} 1 ${ox2} ${oy2}`,
        `L ${ix2} ${iy2}`,
        `A ${inner} ${inner} 0 ${large} 0 ${ixm} ${iym}`,
        `A ${inner} ${inner} 0 ${large} 0 ${ix1} ${iy1}`,
        "Z",
      ].join(" ")
    )
    angle = end
  }
  return paths
}

const COLUMN_GAP = 3

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
 * A stacked bar per span, scaled to the tallest one.
 *
 * An empty span is HATCHED, never drawn as a bar of height zero (the Hatch
 * Rule): a zero-height bar and "no data arrived" are the same picture, and the
 * gap where somebody took a Thursday off is information the chart exists to
 * carry.
 */
export function barColumns(
  values: ReadonlyArray<{ billableMs: number; nonBillableMs: number; empty: boolean }>,
  box: { x: number; y: number; width: number; height: number }
): Array<PdfOp> {
  if (values.length === 0) return []

  const tallest = Math.max(
    ...values.map((value) => value.billableMs + value.nonBillableMs)
  )
  const slot = box.width / values.length
  const barWidth = Math.max(1, slot - COLUMN_GAP)

  const ops: Array<PdfOp> = []
  values.forEach((value, index) => {
    const x = box.x + index * slot + COLUMN_GAP / 2

    if (value.empty) {
      ops.push({ kind: "hatch", x, y: box.y, width: barWidth, height: box.height })
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
    const boost = rawTotal > 0 && rawTotal < MIN_BAR_HEIGHT ? MIN_BAR_HEIGHT / rawTotal : 1
    const billable = rawBillable * boost
    const nonBillable = rawNonBillable * boost

    if (billable > 0) {
      ops.push(rect({ x, y: box.y, width: barWidth, height: billable, color: PAPER.bar }))
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
        rect({ x, y: box.y, width: barWidth, height: ZERO_MARK_HEIGHT, color: PAPER.bar })
      )
    }
  })
  return ops
}
