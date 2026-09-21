import { describe, expect, it } from "vitest"
import { lineAmountCents } from "@shared/invoiceMath"
import { DAY, INVOICE, RUNNING_ENTRY, WEEK } from "./sample-data"

/*
 * The landing page prints these numbers to strangers. A sample invoice whose
 * amounts disagree with the rule the real invoice uses would be the page
 * contradicting its own claim ("every line prints hours × rate").
 */
describe("landing sample data", () => {
  it("prices every invoice line with the real invoice rule", () => {
    for (const line of INVOICE.lines) {
      expect(line.amountCents).toBe(
        lineAmountCents(line.quantityCentis, line.unitCents)
      )
    }
  })

  it("has exactly one entry without a note, so the hatch is shown once", () => {
    expect(DAY.entries.filter((e) => e.note === null)).toHaveLength(1)
  })

  it("lays the day out in order with no overlaps", () => {
    for (const [i, e] of DAY.entries.entries()) {
      expect(e.endMinute).toBeGreaterThan(e.startMinute)
      const next = DAY.entries[i + 1]
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (next) expect(next.startMinute).toBeGreaterThanOrEqual(e.endMinute)
    }
  })

  it("has exactly one empty day in the week strip", () => {
    expect(WEEK.days.filter((d) => d.ms === 0)).toHaveLength(1)
  })

  it("agrees with the day log: WEEK's Tue equals the sum of DAY's entries", () => {
    const dayTotalMs = DAY.entries.reduce(
      (sum, e) => sum + (e.endMinute - e.startMinute) * 60_000,
      0
    )
    const tue = WEEK.days.find((d) => d.label === "Tue")
    expect(tue?.ms).toBe(dayTotalMs)
  })

  it("never bills more than was tracked", () => {
    const trackedMs = WEEK.days.reduce((sum, d) => sum + d.ms, 0)
    // centis are hundredths of an hour: 36_000 ms each
    expect(WEEK.billableCentis * 36_000).toBeLessThanOrEqual(trackedMs)
  })

  it("starts the running timer at 1:47:12", () => {
    expect(RUNNING_ENTRY.elapsedSeconds).toBe(1 * 3600 + 47 * 60 + 12)
  })
})
