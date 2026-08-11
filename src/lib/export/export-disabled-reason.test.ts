import { describe, expect, it } from "vitest"
import { exportDisabledReason, invoiceDisabledReason } from "./export-disabled-reason"
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

/*
 * `Create invoice` refuses the same three states in the same order — the order
 * lives once, in `rangeBlocker` — and says different things about them, because
 * an export of a floor is a wrong report while an invoice raised from one is a
 * client under-billed.
 *
 * It used to refuse a FOURTH state, a page narrowed by anything but its dates,
 * back when `createFromRange` took a range and nothing else and would therefore
 * have billed a superset of the rows on screen. The mutation now takes the
 * filter too, so that refusal is gone and the tests below say so explicitly
 * rather than merely stopping asserting it — a deleted test is invisible, and
 * this one guarded a real hazard until the day the hazard was removed.
 */
describe("invoiceDisabledReason", () => {
  it("refuses while the breakdown has not arrived at all", () => {
    expect(invoiceDisabledReason(undefined, false)).toBe("Still totalling this period.")
  })

  it("refuses a truncated range by naming the under-billing, not the floor", () => {
    // The wording is the difference from `exportDisabledReason` and is the
    // point: what a floor DOES on an invoice is bill a client for less than
    // they owe, and the sentence has to say so rather than describe a figure.
    const reason = invoiceDisabledReason(breakdownOf({ truncated: true }), false)
    expect(reason).toContain("under-bill")
    expect(reason).toContain("Narrow the dates.")
  })

  it("refuses an empty range", () => {
    expect(invoiceDisabledReason(breakdownOf({ count: 0 }), false)).toBe(
      "Nothing tracked in this period to invoice."
    )
  })

  it("raises an invoice from a settled, complete range", () => {
    expect(invoiceDisabledReason(breakdownOf({}), false)).toBe(null)
  })

  /*
   * WHERE THE FOURTH REFUSAL'S REPLACEMENT LIVES, since it cannot live here.
   * "A narrowed page still raises an invoice, and that invoice bills the
   * narrowing" is a statement about the filters, and this function no longer
   * takes any — so it is asserted where the filters exist: on the route
   * (src/routes/_authed/-reports.test.tsx, "Reports — Create invoice") and on
   * the mutation (convex/invoices.test.ts, the two-client range filtered to
   * one). Both are load-bearing; neither is duplicated here.
   */

  /* An unproven range still outranks everything: a truncated scan's own `count`
   * is a floor, so nothing about what it contains is established yet. */
  it("reports the truncation, not emptiness, when both are true", () => {
    expect(invoiceDisabledReason(breakdownOf({ truncated: true, count: 0 }), false)).toContain(
      "under-bill"
    )
  })
})
