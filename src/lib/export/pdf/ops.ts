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
