import { describe, expect, it } from "vitest"
import { PROJECT_COLORS } from "@shared/palette"
import { PAPER, paperColorFor } from "./paper"
import { axisTickIndices, barColumns, donutSlices, textWidth, wrapToWidth } from "./ops"

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
    const [slice] = donutSlices([1], 100, 100, 40, 24)
    expect(slice.d.match(/A/g)).toHaveLength(4)
  })

  /*
   * IMPORTANT 2's fix: a caller pairing each returned slice with something
   * else it keeps per-value (a colour, a legend label) must not assume the
   * slice at position N came from `values[N]` — zero-length values are
   * skipped, so position and source index diverge as soon as one exists.
   * `index` is what lets the caller pair correctly regardless.
   */
  it("carries each slice's ORIGINAL index, not its position among the returned slices", () => {
    const slices = donutSlices([3, 0, 1], 100, 100, 40, 24)
    expect(slices.map((s) => s.index)).toEqual([0, 2])
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

  /*
   * Proportional scaling means a real bar can shrink below the fixed
   * measured-zero tick: one minute against an 8-hour peak in this 50pt box
   * scales to under a point, shorter than the 1pt mark drawn for a day with
   * NO entry. That inverts the chart's meaning — a day with real work reads
   * shorter than a day with none — which is unacceptable on a document a
   * client reconciles. A non-zero bar must always outdraw the zero mark.
   */
  it("draws a genuinely tiny non-zero bar taller than the measured-zero mark", () => {
    const ONE_MINUTE = 60_000
    const EIGHT_HOURS = 8 * 60 * 60_000
    const ops = barColumns(
      [
        { billableMs: EIGHT_HOURS, nonBillableMs: 0, empty: false },
        { billableMs: ONE_MINUTE, nonBillableMs: 0, empty: false },
        { billableMs: 0, nonBillableMs: 0, empty: false },
      ],
      BOX
    )
    const rects = ops.filter((op) => op.kind === "rect")
    expect(rects).toHaveLength(3)
    const [, tinyBar, zeroMark] = rects
    expect(tinyBar.height).toBeGreaterThan(zeroMark.height)
  })
})

describe("textWidth", () => {
  it("falls back to a default advance instead of throwing on a character outside the table", () => {
    expect(() => textWidth("café — a title", 8, false)).not.toThrow()
    expect(textWidth("café — a title", 8, false)).toBeGreaterThan(0)
  })
})

describe("wrapToWidth", () => {
  // The report's own reference case (P0-1), reused: long enough that a single
  // line at a realistic description-column width must break somewhere.
  const LONG = "[B-CB-326] Building Crew Training CSV and PDF download"

  it("splits a long description into more than one line, every line within the width", () => {
    const maxWidth = 80
    const lines = wrapToWidth(LONG, maxWidth, 8, false)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(textWidth(line, 8, false)).toBeLessThanOrEqual(maxWidth)
    }
  })

  it("reassembles to the original words in order, so wrapping never drops text", () => {
    const lines = wrapToWidth(LONG, 80, 8, false)
    expect(lines.join(" ")).toBe(LONG)
  })

  /*
   * Imported ticket titles carry unbroken tokens like `[B-CB-326]` — an ID
   * with no space for greedy word-wrap to land on. Without a hard break, a
   * token wider than the column just overflows it exactly like the ellipsis
   * bug this feature replaces; WITH one, no returned line may exceed maxWidth
   * even when the token itself is the entire input.
   */
  it("hard-breaks a single token longer than the width, never exceeding it", () => {
    const token = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-supercalifragilisticexpialidocious"
    const maxWidth = 40
    expect(textWidth(token, 8, false)).toBeGreaterThan(maxWidth)

    const lines = wrapToWidth(token, maxWidth, 8, false)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(textWidth(line, 8, false)).toBeLessThanOrEqual(maxWidth)
    }
    expect(lines.join("")).toBe(token)
  })

  it("returns at least one entry for an empty string, so a row still occupies a line", () => {
    expect(wrapToWidth("", 100, 8, false)).toEqual([""])
  })

  /*
   * Greedy-MAXIMALITY, not just "fits": every line but the last must be as
   * full as the greedy algorithm can make it, so appending the next line's
   * first word would overflow `maxWidth`. The existing "every line <=
   * maxWidth" assertion only catches the running width UNDER-counting the
   * inter-word space (lines would run long); it still passes if the space is
   * OVER-counted, because an over-count just breaks lines earlier than truly
   * necessary and every line produced is still, individually, <= maxWidth.
   *
   * The width has to be a TIGHT fit for that to be catchable at all: `LONG`
   * at a loose width breaks so far short of the boundary that an over-counted
   * space still leaves the next word overflowing anyway, and the assertion
   * would pass whether or not the bug is present. Four equal-width words and
   * a budget sized for exactly two of them (plus one real inter-word space,
   * plus a hair of slack) is tight enough that over-counting the space by
   * even one extra `spaceWidth` forces an early break this check can see.
   */
  it("packs each line as full as it can go — the next line's first word would always overflow", () => {
    const size = 8
    const wordWidth = textWidth("TEST", size, false)
    const spaceWidth = textWidth(" ", size, false)
    const maxWidth = wordWidth * 2 + spaceWidth + 0.01
    const lines = wrapToWidth("TEST TEST TEST TEST", maxWidth, size, false)
    expect(lines).toEqual(["TEST TEST", "TEST TEST"])
    for (let i = 0; i < lines.length - 1; i++) {
      const nextFirstWord = lines[i + 1].split(" ")[0]
      expect(
        textWidth(`${lines[i]} ${nextFirstWord}`, size, false)
      ).toBeGreaterThan(maxWidth)
    }
  })

  /*
   * A description budget can legitimately reach zero (an extreme duration
   * string can consume the whole reserved gap — see `descriptionMaxWidth` in
   * report-doc.ts). Every character's advance is positive, so a naive
   * "consume while it still fits" loop never terminates at width <= 0. This
   * must return, not hang the test runner.
   */
  it("terminates rather than looping forever at a zero or negative width", () => {
    expect(() => wrapToWidth("some real text", 0, 8, false)).not.toThrow()
    expect(wrapToWidth("some real text", 0, 8, false).length).toBeGreaterThan(0)
    expect(() => wrapToWidth("some real text", -10, 8, false)).not.toThrow()
    expect(wrapToWidth("some real text", -10, 8, false).length).toBeGreaterThan(0)
  })

  it("keeps a short string on one line, unchanged", () => {
    expect(wrapToWidth("Short", 200, 8, false)).toEqual(["Short"])
  })
})

describe("axisTickIndices", () => {
  // The observed defect: a 31-day range at 6pt across ~465pt, where `Mon 10`
  // overlapped into `Mon 1`.
  const labels = Array.from({ length: 31 }, (_, n) => `Mon ${n + 1}`)

  it("emits materially fewer labels than one per bucket on a colliding 31-day axis", () => {
    const indices = axisTickIndices(labels, 465, 6, false)
    expect(indices.length).toBeLessThan(31)
    expect(indices.length).toBeLessThan(20)
  })

  it("always includes the first and last bucket, so the axis still states its own range", () => {
    const indices = axisTickIndices(labels, 465, 6, false)
    expect(indices[0]).toBe(0)
    expect(indices.at(-1)).toBe(30)
  })

  it("keeps every label when they already fit without collision", () => {
    const few = ["Mon 13", "Tue 14", "Wed 15"]
    expect(axisTickIndices(few, 500, 6, false)).toEqual([0, 1, 2])
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
