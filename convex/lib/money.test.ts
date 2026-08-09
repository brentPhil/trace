import { describe, expect, it } from "vitest"
import { formatMoney, isValidCurrency, parseMoney } from "./money"

describe("parseMoney", () => {
  it("reads a bare integer as whole units", () => {
    expect(parseMoney("10")).toEqual({ ok: true, cents: 1000 })
  })

  it("reads two decimal places as cents", () => {
    expect(parseMoney("10.50")).toEqual({ ok: true, cents: 1050 })
  })

  it("strips a leading currency symbol", () => {
    expect(parseMoney("$10")).toEqual({ ok: true, cents: 1000 })
  })

  it("scales a single decimal digit as tenths", () => {
    expect(parseMoney("10.5")).toEqual({ ok: true, cents: 1050 })
  })

  it("accepts an explicit zero as a real rate, not a cleared one", () => {
    expect(parseMoney("0")).toEqual({ ok: true, cents: 0 })
  })

  it("treats an empty field as clearing the rate, not zero", () => {
    expect(parseMoney("")).toEqual({ ok: true, cents: null })
    expect(parseMoney("   ")).toEqual({ ok: true, cents: null })
  })

  it("tolerates surrounding whitespace", () => {
    expect(parseMoney("  10.50  ")).toEqual({ ok: true, cents: 1050 })
  })

  it("rejects what it cannot confidently read rather than guessing", () => {
    const junk = ["abc", "-5", "10.999", "$", "10.5.5", "1,000", "10 dollars", "10-", "NaN"]
    for (const input of junk) {
      expect(parseMoney(input), input).toEqual({ ok: false, reason: "unparseable" })
    }
  })
})

describe("formatMoney", () => {
  it("formats cents as a currency string using the given locale and currency", () => {
    expect(formatMoney(1050, "USD", "en-US")).toBe("$10.50")
  })

  it("uses the currency's own symbol and placement, not a hardcoded $", () => {
    expect(formatMoney(1050, "SGD", "en-SG")).toBe("$10.50")
    expect(formatMoney(1050, "EUR", "de-DE")).toBe("10,50 €")
  })
})

describe("isValidCurrency", () => {
  it("accepts real ISO 4217 codes", () => {
    expect(isValidCurrency("USD")).toBe(true)
    expect(isValidCurrency("SGD")).toBe(true)
    expect(isValidCurrency("JPY")).toBe(true)
  })

  it("rejects a code the runtime cannot resolve", () => {
    expect(isValidCurrency("XXXXXX")).toBe(false)
    expect(isValidCurrency("US")).toBe(false)
    expect(isValidCurrency("")).toBe(false)
  })
})
