import { describe, expect, it } from "vitest"
import { exportDisabledReason, invoiceDisabledReason } from "./export-disabled-reason"
import { SET_A_RATE_NOTE } from "@/lib/export/report-rows"
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

/**
 * A range with billable time actually in it.
 *
 * `EMPTY_BREAKDOWN` has `billableMs: 0`, so a bare `breakdownOf({})` is a range
 * of purely NON-billable entries — a state `invoiceDisabledReason` refuses on
 * its own. Every test below that is about some OTHER refusal has to start from
 * a range that would otherwise be invoiceable, or it passes for the wrong
 * reason and would keep passing if the refusal it names were deleted.
 */
function billableRange(over: Partial<Breakdown> = {}): Breakdown {
  return breakdownOf({ billableMs: 3_600_000, ...over })
}

/** How many lines `invoiceLineDrafts` priced. One is enough for a document. */
const ONE_LINE = 1
const NO_LINES = 0

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
    // `NO_LINES` is what /reports genuinely passes here: with no breakdown
    // there are no buckets to price, so the count is zero. The loading sentence
    // still has to win — nothing is known about rates before the scan lands,
    // and "set a rate" would be an instruction derived from no evidence.
    expect(invoiceDisabledReason(undefined, false, NO_LINES)).toBe(
      "Still totalling this period."
    )
  })

  it("refuses a truncated range by naming the under-billing, not the floor", () => {
    // The wording is the difference from `exportDisabledReason` and is the
    // point: what a floor DOES on an invoice is bill a client for less than
    // they owe, and the sentence has to say so rather than describe a figure.
    const reason = invoiceDisabledReason(billableRange({ truncated: true }), false, ONE_LINE)
    expect(reason).toContain("under-bill")
    expect(reason).toContain("Narrow the dates.")
  })

  it("refuses an empty range", () => {
    expect(invoiceDisabledReason(breakdownOf({ count: 0 }), false, NO_LINES)).toBe(
      "Nothing tracked in this period to invoice."
    )
  })

  /*
   * NOTHING BILLABLE IS NOT AN EMPTY RANGE, and /reports is the only page that
   * can tell them apart. It scans with whatever the billable chip says, so a
   * range of purely non-billable entries arrives here with `count > 0` and
   * `billableMs === 0` — past every check above, and pointed at a create page
   * that hard-codes `billableOnly: true` and would find nothing at all.
   *
   * The sentence names the BILLABLE rule rather than a rate, because that is
   * the fix: turn the chip on, or pick a different period. Sending this user to
   * Settings for an hourly rate would be the wrong screen.
   */
  it("refuses a range whose tracked time is all non-billable", () => {
    expect(invoiceDisabledReason(breakdownOf({ count: 4 }), false, NO_LINES)).toBe(
      "Nothing in this period is billable, and an invoice bills billable time only."
    )
  })

  /*
   * THE DOCUMENT WITH NOTHING ON IT — billable hours that no rate covers.
   *
   * `count` cannot see this: it counts billable ENTRIES, and a range full of
   * them still prices no lines if no project carries a rate and the account has
   * no default. `invoiceLineDrafts` skips those buckets rather than guessing,
   * so the mutation would insert a numbered, permanent, un-deletable $0.00
   * invoice — which is why `createFromRange` refuses it as `NO_PRICED_TIME` and
   * why the control is dead before the click as well.
   *
   * Asserted against `SET_A_RATE_NOTE` rather than a retyped sentence: the same
   * constant `BillPreview` prints under a partly-unpriced range. Two phrasings
   * of "go and set a rate" is how the button and the note start naming two
   * different screens.
   */
  it("refuses a billable range that would price no lines, and says where a rate is set", () => {
    const reason = invoiceDisabledReason(billableRange(), false, NO_LINES)
    expect(reason).toContain("no lines and a $0.00 total")
    expect(reason).toContain(SET_A_RATE_NOTE)
  })

  it("raises an invoice from a settled, complete range that prices something", () => {
    expect(invoiceDisabledReason(billableRange(), false, ONE_LINE)).toBe(null)
  })

  /* ONE priced bucket is a document. The rule is about a range that prices
   * NOTHING, not about a range with unpriced time in it — that one is stated
   * under the preview and billed short on purpose. */
  it("allows a mixed range, where only some of the billable time is priced", () => {
    expect(
      invoiceDisabledReason(billableRange({ unratedBillableMs: 7_200_000 }), false, ONE_LINE)
    ).toBe(null)
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
    expect(
      invoiceDisabledReason(breakdownOf({ truncated: true, count: 0 }), false, NO_LINES)
    ).toContain("under-bill")
  })

  /*
   * THE ORDER OF THE TWO NEW REFUSALS, which is the consequential half of them:
   * a range that prices no lines is USUALLY also a range with no billable time,
   * so whichever is checked first is the sentence almost every user reads. Each
   * names a different screen, and the two below fix the direction so a reorder
   * cannot quietly start sending people to the wrong one.
   */

  /* A truncated scan proves nothing about pricing either — the buckets it did
   * see are a floor, so "no rate anywhere" is a claim it cannot make. */
  it("reports the truncation, not the missing rate, when both are true", () => {
    expect(
      invoiceDisabledReason(billableRange({ truncated: true }), false, NO_LINES)
    ).toContain("under-bill")
  })

  /* Nothing tracked outranks nothing billable, and has to: a range with no
   * entries in it trivially has no billable ones, and "turn the billable chip
   * on" is useless advice about a period that is simply empty. */
  it("reports the empty range, not the billable rule, when both are true", () => {
    expect(invoiceDisabledReason(breakdownOf({ count: 0 }), false, NO_LINES)).toBe(
      "Nothing tracked in this period to invoice."
    )
  })

  /* And nothing billable outranks the missing rate. A rate on a project cannot
   * put non-billable time on an invoice, so naming Settings here would be a fix
   * that changes nothing. */
  it("reports the billable rule, not the missing rate, when both are true", () => {
    expect(invoiceDisabledReason(breakdownOf({ count: 4 }), false, NO_LINES)).not.toContain(
      SET_A_RATE_NOTE
    )
  })
})
