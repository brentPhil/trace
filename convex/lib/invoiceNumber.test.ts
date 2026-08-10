import { describe, expect, it } from "vitest"
import { nextInvoiceNumber, parseInvoiceSequence } from "./invoiceNumber"

describe("parseInvoiceSequence", () => {
  it("reads the sequence out of the reference format", () => {
    expect(parseInvoiceSequence("072726-0013")).toBe(13)
  })

  it("ignores anything that is not this format, rather than guessing", () => {
    for (const junk of ["", "13", "INV-13", "072726", "072726-", "072726-abc"]) {
      expect(parseInvoiceSequence(junk), junk).toBeNull()
    }
  })

  it("reads a hand-edited number back, so a user's own scheme still advances", () => {
    expect(parseInvoiceSequence("010126-0999")).toBe(999)
  })
})

describe("nextInvoiceNumber", () => {
  const JUL_27 = Date.parse("2026-07-27T15:00:00Z")

  it("formats MMDDYY-NNNN, matching the reference invoice", () => {
    expect(nextInvoiceNumber(JUL_27, "UTC", [])).toBe("072726-0001")
  })

  /*
   * ONE PAST THE HIGHEST EVER USED, not a count of invoices.
   *
   * A count reuses a number after a deletion, and two documents claiming to be
   * #072726-0013 is the kind of thing a client's bookkeeper notices and the
   * freelancer cannot explain.
   */
  it("continues past the highest sequence ever used, not the count", () => {
    expect(nextInvoiceNumber(JUL_27, "UTC", ["072726-0001", "072726-0013"])).toBe(
      "072726-0014"
    )
  })

  it("does not reuse a number after one is deleted", () => {
    // Only 0013 survives; the next must still be 0014, never 0002.
    expect(nextInvoiceNumber(JUL_27, "UTC", ["072726-0013"])).toBe("072726-0014")
  })

  it("counts across dates, because the sequence is per user, not per day", () => {
    expect(nextInvoiceNumber(JUL_27, "UTC", ["010126-0042"])).toBe("072726-0043")
  })

  it("ignores unparseable numbers instead of throwing", () => {
    expect(nextInvoiceNumber(JUL_27, "UTC", ["INV-7", "072726-0003"])).toBe("072726-0004")
  })

  /* The date is the user's local one. A late-evening invoice in Manila must not
   * be numbered with the previous day because the server is in UTC. */
  it("uses the local date in the given zone", () => {
    const lateInManila = Date.parse("2026-07-27T16:30:00Z") // 00:30 on the 28th
    expect(nextInvoiceNumber(lateInManila, "Asia/Manila", [])).toBe("072826-0001")
  })
})
