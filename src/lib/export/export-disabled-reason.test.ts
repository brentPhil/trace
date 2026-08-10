import { describe, expect, it } from "vitest"
import { exportDisabledReason } from "./export-disabled-reason"
import { EMPTY_BREAKDOWN } from "@/lib/report-series"
import type { Breakdown } from "@/lib/report-series"

/*
 * The single most consequential rule on /reports, pinned down at the
 * function level rather than through a route test — see the file under
 * test for why the priority order is what it is.
 */

function breakdownOf(over: Partial<Breakdown>): Breakdown {
  return { ...EMPTY_BREAKDOWN, count: 1, ...over }
}

describe("exportDisabledReason", () => {
  it("refuses while the breakdown has not arrived at all", () => {
    expect(exportDisabledReason(undefined, false)).toBe("Still totalling this period.")
  })

  it("refuses while what's on screen is a carried-over placeholder", () => {
    // A defined breakdown that is nonetheless STALE — the previous range's
    // figures, kept on screen by `placeholderData` while the new range's
    // query is in flight. Exporting it would silently document the wrong
    // period.
    expect(exportDisabledReason(breakdownOf({}), true)).toBe(
      "Still totalling this period."
    )
  })

  it("refuses a truncated range with the floor warning", () => {
    expect(exportDisabledReason(breakdownOf({ truncated: true }), false)).toBe(
      "This period is too large to total exactly — the figures are a floor, not the real total. Narrow the dates."
    )
  })

  it("refuses an empty range", () => {
    expect(exportDisabledReason(breakdownOf({ count: 0 }), false)).toBe(
      "Nothing tracked in this period."
    )
  })

  it("enables export once a real, complete, non-empty range has settled", () => {
    expect(exportDisabledReason(breakdownOf({ truncated: false, count: 1 }), false)).toBe(
      null
    )
  })

  /*
   * PRIORITY, pinned: a range that is BOTH truncated and (as far as the
   * partial scan can tell) empty must report the TRUNCATION, not the empty
   * reason.
   *
   * Reasoning: `truncated` means the server stopped scanning before it
   * reached the end of the range, so `count` is itself only a count of what
   * it managed to scan — it is a floor, exactly like every other figure on
   * this page. Reporting "Nothing tracked in this period" would assert a
   * negative the scan was never in a position to prove: there may be entries
   * past the point it gave up. "Nothing tracked" is a claim about the WHOLE
   * range; only an untruncated scan has actually looked at the whole range.
   * The truncation warning is the true statement available here, so it must
   * win.
   */
  it("prioritises the truncation warning over the empty-range reason", () => {
    expect(exportDisabledReason(breakdownOf({ truncated: true, count: 0 }), false)).toBe(
      "This period is too large to total exactly — the figures are a floor, not the real total. Narrow the dates."
    )
  })

  it("prioritises the loading reason over a truncated range", () => {
    // The placeholder branch is checked first in the source, so a stale
    // placeholder that happens to carry `truncated: true` from the PREVIOUS
    // range must not leak that previous range's truncation warning either.
    expect(exportDisabledReason(breakdownOf({ truncated: true }), true)).toBe(
      "Still totalling this period."
    )
  })
})
