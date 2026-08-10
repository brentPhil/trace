/// <reference types="vite/client" />
import { describe, expect, it } from "vitest"
import { invoiceTotals, lineAmountCents } from "./invoiceMath"

describe("lineAmountCents", () => {
  /* The reference invoice: 98:48:00 -> 98.80 h at $10.00/hr -> $988.00. A
   * client must be able to reproduce this from the three printed numbers. */
  it("reproduces the reference invoice line exactly", () => {
    expect(lineAmountCents(9880, 1000)).toBe(98_800)
  })

  it("rounds the product to the nearest cent, once", () => {
    // 7.33 h at $61.00 = 447.13 exactly.
    expect(lineAmountCents(733, 6100)).toBe(44_713)
    // 0.01 h at $61.00 = 0.61 exactly.
    expect(lineAmountCents(1, 6100)).toBe(61)
    // Half-cent rounds up, stated so it cannot drift.
    expect(lineAmountCents(1, 50)).toBe(1) // 0.005 -> 0.01
  })

  it("prices a zero rate as zero rather than refusing it", () => {
    expect(lineAmountCents(9880, 0)).toBe(0)
  })
})

describe("invoiceTotals", () => {
  it("sums the stored line amounts rather than recomputing them", () => {
    const lines = [{ amountCents: 98_800 }, { amountCents: 1_200 }]
    expect(invoiceTotals(lines, []).subtotalCents).toBe(100_000)
  })

  /* Taxes apply to the SUBTOTAL, each rounded once, and are not compounded —
   * two 5% taxes are 10% of the subtotal, not 5% then 5% of the result. Which
   * of those a jurisdiction wants is a policy question; compounding silently
   * is a wrong number. */
  it("applies each tax to the subtotal, not to the running total", () => {
    const lines = [{ amountCents: 100_000 }]
    const taxes = [
      { label: "GST", basisPoints: 500 },
      { label: "PST", basisPoints: 500 },
    ]
    const { taxCents, totalCents } = invoiceTotals(lines, taxes)
    expect(taxCents).toBe(10_000)
    expect(totalCents).toBe(110_000)
  })

  it("totals an empty invoice as zero rather than NaN", () => {
    expect(invoiceTotals([], [])).toEqual({ subtotalCents: 0, taxCents: 0, totalCents: 0 })
  })
})
