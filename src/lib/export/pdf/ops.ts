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
 * DM Sans's real advance widths, 1/1000 em, for printable ASCII 32-126 —
 * every character an export string in this app actually draws.
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
  " ": 266, "!": 250, '"': 291, "#": 804, $: 580, "%": 786, "&": 734,
  "'": 159, "(": 373, ")": 373, "*": 480, "+": 550, ",": 182, "-": 541,
  ".": 198, "/": 392, "0": 684, "1": 312, "2": 576, "3": 591, "4": 607,
  "5": 610, "6": 628, "7": 534, "8": 608, "9": 628, ":": 202, ";": 227,
  "<": 550, "=": 550, ">": 550, "?": 524, "@": 1005, A: 664, B: 603,
  C: 717, D: 688, E: 565, F: 535, G: 758, H: 681, I: 234, J: 501, K: 584,
  L: 527, M: 841, N: 691, O: 774, P: 580, Q: 774, R: 594, S: 580, T: 561,
  U: 655, V: 669, W: 968, X: 603, Y: 580, Z: 541, "[": 314, "\\": 392,
  "]": 314, "^": 622, _: 660, "`": 213, a: 544, b: 626, c: 572, d: 627,
  e: 568, f: 340, g: 558, h: 575, i: 240, j: 243, k: 504, l: 223, m: 891,
  n: 574, o: 593, p: 626, q: 627, r: 370, s: 502, t: 392, u: 573, v: 527,
  w: 763, x: 496, y: 556, z: 458, "{": 427, "|": 234, "}": 427, "~": 550,
}

const DM_SANS_BOLD_WIDTHS: Record<string, number> = {
  " ": 235, "!": 309, '"': 367, "#": 857, $: 604, "%": 902, "&": 781,
  "'": 197, "(": 405, ")": 405, "*": 513, "+": 579, ",": 246, "-": 576,
  ".": 252, "/": 427, "0": 704, "1": 364, "2": 577, "3": 603, "4": 650,
  "5": 622, "6": 634, "7": 537, "8": 633, "9": 635, ":": 254, ";": 278,
  "<": 579, "=": 579, ">": 579, "?": 538, "@": 1046, A: 709, B: 638,
  C: 738, D: 707, E: 583, F: 556, G: 778, H: 714, I: 272, J: 541, K: 653,
  L: 558, M: 886, N: 729, O: 784, P: 614, Q: 784, R: 631, S: 604, T: 597,
  U: 685, V: 706, W: 1018, X: 670, Y: 635, Z: 577, "[": 377, "\\": 427,
  "]": 377, "^": 677, _: 725, "`": 235, a: 586, b: 655, c: 607, d: 655,
  e: 602, f: 371, g: 596, h: 618, i: 274, j: 274, k: 578, l: 267, m: 941,
  n: 617, o: 610, p: 655, q: 655, r: 409, s: 532, t: 433, u: 616, v: 565,
  w: 820, x: 571, y: 604, z: 490, "{": 470, "|": 272, "}": 470, "~": 579,
}

/**
 * Advance for a character neither table has — a curly quote or accented
 * letter pulled in from an imported description, say. Close to the tables'
 * own mean advance, so an occasional unknown glyph nudges a truncation point
 * by a character rather than corrupting the measurement; the alternative,
 * throwing, would take down a document export over one character in one row.
 */
const DEFAULT_ADVANCE = 570

/** A string's width in points under the DM Sans this document actually
 *  embeds, matching what `render.ts`'s embedded TTFs will draw it at. Lets
 *  `report-doc.ts` measure text without importing pdf-lib and losing its
 *  purity. */
export function textWidth(str: string, size: number, bold: boolean): number {
  const table = bold ? DM_SANS_BOLD_WIDTHS : DM_SANS_WIDTHS
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
  if (textWidth(str, size, bold) <= maxWidth) return str

  const budget = maxWidth - textWidth(ELLIPSIS, size, bold)
  if (budget <= 0) return ELLIPSIS

  let cut = str.length
  while (cut > 0 && textWidth(str.slice(0, cut), size, bold) > budget) {
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
    if (current !== "" && textWidth(candidate, size, bold) > maxWidth) {
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

  const lines: Array<string> = []
  let current = ""

  for (const word of str.split(" ")) {
    const pieces =
      textWidth(word, size, bold) > maxWidth
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
      if (textWidth(candidate, size, bold) <= maxWidth) {
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
  const widest = Math.max(...labels.map((label) => textWidth(label, size, bold)))
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
