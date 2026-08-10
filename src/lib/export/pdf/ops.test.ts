import { describe, expect, it } from "vitest"
import { PROJECT_COLORS } from "@shared/palette"
import { PAPER, paperColorFor } from "./paper"
import { barColumns, donutSlices } from "./ops"

describe("donutSlices", () => {
  it("returns one path per non-zero value", () => {
    expect(donutSlices([3, 1], 100, 100, 40, 24)).toHaveLength(2)
  })

  it("skips a zero-length slice rather than emitting a degenerate arc", () => {
    expect(donutSlices([3, 0, 1], 100, 100, 40, 24)).toHaveLength(2)
  })

  it("draws nothing at all for an empty total", () => {
    expect(donutSlices([], 100, 100, 40, 24)).toEqual([])
    expect(donutSlices([0, 0], 100, 100, 40, 24)).toEqual([])
  })

  /*
   * A single 100% slice is the reference report's own case (one member, one
   * project). An arc of exactly 360 degrees has identical start and end points,
   * which most renderers draw as nothing at all.
   */
  it("closes a full circle as two arcs rather than one degenerate one", () => {
    const [path] = donutSlices([1], 100, 100, 40, 24)
    expect(path.match(/A/g)).toHaveLength(4)
  })
})

describe("barColumns", () => {
  const BOX = { x: 0, y: 0, width: 100, height: 50 }

  it("scales the tallest column to the full height", () => {
    const ops = barColumns(
      [
        { billableMs: 100, nonBillableMs: 0, empty: false },
        { billableMs: 50, nonBillableMs: 0, empty: false },
      ],
      BOX
    )
    const heights = ops.filter((op) => op.kind === "rect").map((op) => op.height)
    expect(heights[0]).toBe(50)
    expect(heights[1]).toBe(25)
  })

  it("stacks non-billable above billable, so the two always sum to the column", () => {
    const ops = barColumns([{ billableMs: 50, nonBillableMs: 50, empty: false }], BOX)
    const rects = ops.filter((op) => op.kind === "rect")
    expect(rects).toHaveLength(2)
    expect(rects[0].height + rects[1].height).toBe(50)
  })

  /*
   * The Hatch Rule. A day with nothing tracked is not a bar of height zero —
   * that reads as "no data arrived" — it is an absence, and absence is a
   * texture.
   */
  it("hatches an empty span instead of drawing a zero-height bar", () => {
    const ops = barColumns([{ billableMs: 0, nonBillableMs: 0, empty: true }], BOX)
    expect(ops.some((op) => op.kind === "hatch")).toBe(true)
    expect(ops.some((op) => op.kind === "rect")).toBe(false)
  })

  it("draws nothing but hatch when every span is empty, rather than dividing by zero", () => {
    const ops = barColumns(
      [
        { billableMs: 0, nonBillableMs: 0, empty: true },
        { billableMs: 0, nonBillableMs: 0, empty: true },
      ],
      BOX
    )
    expect(ops.every((op) => op.kind === "hatch")).toBe(true)
  })

  /*
   * `Bucket.empty` is `count === 0`, not `totalMs === 0`. A day holding only a
   * zero-length entry is `empty: false` with zero duration, and before this
   * fix drew NEITHER a bar (both segments are zero height) NOR a hatch (the
   * span isn't empty) — a silent blank gap identical to what a rendering bug
   * would produce. It must be visibly a measured zero, not absence and not
   * nothing.
   */
  it("marks a zero-duration span that has an entry, rather than leaving a blank gap", () => {
    const ops = barColumns(
      [
        { billableMs: 100, nonBillableMs: 0, empty: false },
        { billableMs: 0, nonBillableMs: 0, empty: false },
      ],
      BOX
    )
    expect(ops.some((op) => op.kind === "hatch")).toBe(false)

    const rects = ops.filter((op) => op.kind === "rect")
    expect(rects).toHaveLength(2)
    const zeroMark = rects[1]
    expect(zeroMark.height).toBeGreaterThan(0)
    expect(zeroMark.y).toBe(BOX.y)
  })
})

describe("paperColorFor palette coverage", () => {
  /*
   * PROJECT_INK is a private table keyed by convex/lib/palette.ts's own key
   * set. A colour added there later must fail HERE, not silently render as
   * `inkMuted` grey in an exported chart — so every key must resolve to
   * something other than the fallback.
   */
  it("has a distinct ink entry for every key of PROJECT_COLORS", () => {
    for (const key of PROJECT_COLORS) {
      expect(paperColorFor(key)).not.toEqual(PAPER.inkMuted)
    }
  })
})
