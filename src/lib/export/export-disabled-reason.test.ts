import { describe, expect, it } from "vitest"
import { exportDisabledReason, invoiceDisabledReason } from "./export-disabled-reason"
import { defaultFilters } from "@/lib/history-filters"
import { EMPTY_BREAKDOWN } from "@/lib/report-series"
import { dayOf } from "@shared/day"
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
 * client under-billed. It also refuses a fourth state Export has no reason to.
 */
describe("invoiceDisabledReason", () => {
  const today = dayOf(Date.parse("2026-08-05T12:00:00Z"), "UTC")
  const plain = defaultFilters(today, 1)

  it("refuses while the breakdown has not arrived at all", () => {
    expect(invoiceDisabledReason(undefined, false, plain)).toBe(
      "Still totalling this period."
    )
  })

  it("refuses a truncated range by naming the under-billing, not the floor", () => {
    // The wording is the difference from `exportDisabledReason` and is the
    // point: what a floor DOES on an invoice is bill a client for less than
    // they owe, and the sentence has to say so rather than describe a figure.
    const reason = invoiceDisabledReason(breakdownOf({ truncated: true }), false, plain)
    expect(reason).toContain("under-bill")
    expect(reason).toContain("Narrow the dates.")
  })

  it("refuses an empty range", () => {
    expect(invoiceDisabledReason(breakdownOf({ count: 0 }), false, plain)).toBe(
      "Nothing tracked in this period to invoice."
    )
  })

  it("raises an invoice from a settled, complete, unfiltered range", () => {
    expect(invoiceDisabledReason(breakdownOf({}), false, plain)).toBe(null)
  })

  /*
   * THE FOURTH REFUSAL, which Export does not make and must not: an export
   * documents what is on screen, filters and all, and is right to. An invoice
   * is raised by `createFromRange` from the DATES ALONE — it re-reads the
   * period server-side and never sees the project picker, the text box or the
   * preset chips — so with one of those active the invoice is the wider answer
   * and would bill work the page is not showing.
   */
  it("refuses a range narrowed by a project, some text, or a preset chip", () => {
    for (const narrowing of [
      { projectId: "p1" },
      { text: "invoice" },
      { presets: ["no-project" as const] },
    ]) {
      const reason = invoiceDisabledReason(breakdownOf({}), false, {
        ...plain,
        ...narrowing,
      })
      expect(reason, JSON.stringify(narrowing)).toContain("raised from the dates alone")
      // Export is unaffected by any of them.
      expect(exportDisabledReason(breakdownOf({}), false)).toBe(null)
    }
  })

  /*
   * `billableOnly` is NOT a narrowing. `createFromRange` always bills billable
   * time only, so the chip moves the page TOWARDS what the invoice does rather
   * than away from it — and leaving it off is the documented rule ("billable
   * time on a project with a rate"), not a divergence to refuse over.
   */
  it("does not treat the billable chip as a narrowing", () => {
    expect(invoiceDisabledReason(breakdownOf({}), false, { ...plain, billableOnly: true })).toBe(
      null
    )
  })

  it("treats whitespace in the text box as no filter at all", () => {
    expect(invoiceDisabledReason(breakdownOf({}), false, { ...plain, text: "   " })).toBe(null)
  })

  /* PRIORITY: an unproven range outranks a narrowed one. A truncated scan's
   * own `count` is a floor, so nothing about what it contains — including
   * whether the filters matter — is established yet. */
  it("reports the truncation, not the filters, when both are true", () => {
    const reason = invoiceDisabledReason(breakdownOf({ truncated: true }), false, {
      ...plain,
      text: "invoice",
    })
    expect(reason).toContain("under-bill")
  })

  /* And the filters outrank "empty", because with one active "nothing tracked"
   * is a claim about the filtered rows and the invoice would not be raised from
   * those. */
  it("reports the filters, not emptiness, when both are true", () => {
    const reason = invoiceDisabledReason(breakdownOf({ count: 0 }), false, {
      ...plain,
      text: "invoice",
    })
    expect(reason).toContain("raised from the dates alone")
  })
})
