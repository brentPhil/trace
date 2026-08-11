import { describe, expect, it } from "vitest"
import { exportFilename, invoiceFilename } from "./download"

describe("exportFilename", () => {
  it("names the range, so two exports never collide in a downloads folder", () => {
    expect(exportFilename("2026-07-13", "2026-07-25", "csv")).toBe(
      "trace-report-2026-07-13_2026-07-25.csv"
    )
  })

  it("does not repeat a single-day range", () => {
    expect(exportFilename("2026-07-13", "2026-07-13", "pdf")).toBe(
      "trace-report-2026-07-13.pdf"
    )
  })
})

describe("invoiceFilename", () => {
  /* The NUMBER first: a client asking about "invoice 072726-0013" is asking
   * about this file, and the number is already unique per account, so the date
   * beside it is orientation rather than identity. */
  it("names the invoice, then the day it was issued", () => {
    expect(invoiceFilename("072726-0013", "2026-07-27")).toBe(
      "invoice-072726-0013-2026-07-27.pdf"
    )
  })
})
