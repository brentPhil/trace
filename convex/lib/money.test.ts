import { describe, expect, it } from "vitest"
import { formatMoney, isValidCurrency, parseMoney, supportedCurrencies } from "./money"

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

  /*
   * The symbol a user pastes is whatever their bank writes, and for most of
   * the world that is not a bare `$`. Refusing "S$10" from an SGD user while
   * the rejection message showed a dollar sign was the specific failure.
   */
  it("strips a compound symbol built from letters plus a sign", () => {
    expect(parseMoney("S$10", "SGD")).toEqual({ ok: true, cents: 1000 })
    expect(parseMoney("R$10.50", "BRL")).toEqual({ ok: true, cents: 1050 })
    expect(parseMoney("US$10", "USD")).toEqual({ ok: true, cents: 1000 })
    expect(parseMoney("HK$10", "HKD")).toEqual({ ok: true, cents: 1000 })
  })

  it("strips the currency's own symbol, wherever the user puts it", () => {
    expect(parseMoney("kr 10", "SEK")).toEqual({ ok: true, cents: 1000 })
    expect(parseMoney("10 kr", "SEK")).toEqual({ ok: true, cents: 1000 })
    expect(parseMoney("R 10.50", "ZAR")).toEqual({ ok: true, cents: 1050 })
  })

  it("strips the ISO code itself, which is what formatMoney renders for many currencies", () => {
    // `formatMoney(1000, "SGD")` is literally "SGD 10.00", so a figure copied
    // back out of the display has to round-trip.
    expect(parseMoney("SGD 10.00", "SGD")).toEqual({ ok: true, cents: 1000 })
    expect(parseMoney("sgd10", "SGD")).toEqual({ ok: true, cents: 1000 })
  })

  it("still refuses letters that are not this currency's symbol", () => {
    expect(parseMoney("kr 10", "USD")).toEqual({ ok: false, reason: "unparseable" })
    expect(parseMoney("abc10", "USD")).toEqual({ ok: false, reason: "unparseable" })
    expect(parseMoney("10 dollars", "USD")).toEqual({ ok: false, reason: "unparseable" })
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

  /*
   * The app SSRs. An unpinned locale renders `$61.00` on a server in en-US and
   * `61,00 $` on a client in de-DE — a React hydration mismatch on a money
   * figure, and a display that the /projects editor's own `parseMoney` would
   * then refuse. Every other formatter in this codebase pins one deliberately
   * (src/lib/format-time.ts, convex/lib/day.ts); this one now does too.
   */
  it("pins a locale rather than inheriting the runtime's", () => {
    expect(formatMoney(1050, "USD")).toBe("$10.50")
    // The separator ICU puts between a bare code and its amount is U+00A0,
    // not a space. Escaped rather than pasted, so a re-encode of this file
    // cannot quietly turn it into an ordinary space.
    expect(formatMoney(6_100, "SGD")).toBe("SGD\u00A061.00")
  })

  /*
   * `formatRate` runs once per project row. Constructing an
   * `Intl.NumberFormat` is expensive relative to formatting with one — the
   * same reason src/lib/format-time.ts and convex/lib/day.ts hoist theirs.
   */
  it("constructs one formatter per (locale, currency), not one per call", () => {
    // A counting Proxy rather than `vi.spyOn`: a vitest mock function is not a
    // usable `Intl.NumberFormat` constructor, so `new` through it yields an
    // object with no `.format`. `Reflect.construct` keeps the real one.
    const real = Intl.NumberFormat
    let constructed = 0
    const counting = new Proxy(real, {
      construct: (target, args: Array<unknown>) => {
        constructed += 1
        return Reflect.construct(target, args) as object
      },
    })
    Object.defineProperty(Intl, "NumberFormat", { configurable: true, value: counting })
    try {
      // A currency no other test in this file has warmed the cache with.
      expect(formatMoney(1000, "CAD")).toBe("CA$10.00")
      formatMoney(2000, "CAD")
      formatMoney(3000, "CAD")
      expect(constructed).toBe(1)
    } finally {
      Object.defineProperty(Intl, "NumberFormat", { configurable: true, value: real })
    }
  })
})

describe("supportedCurrencies", () => {
  it("is the runtime's own ISO 4217 list, narrowed to hundredths currencies", () => {
    expect(supportedCurrencies()).toContain("USD")
    expect(supportedCurrencies()).toContain("SGD")
    expect(supportedCurrencies()).toContain("EUR")
    // Every offered code really does divide into hundredths, which is the
    // assumption the word `cents` bakes in.
    for (const code of supportedCurrencies()) {
      const digits = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
      }).resolvedOptions().maximumFractionDigits
      expect(digits, code).toBe(2)
    }
  })

  it("leaves out the currencies this module cannot represent honestly", () => {
    // JPY has no minor unit and KWD has three digits of it. Offering them in
    // the picker while storing hundredths is what made `formatMoney(1050,
    // "JPY")` render a silently-rounded "11" and KWD render three decimals
    // that `parseMoney` then refused to read back.
    expect(supportedCurrencies()).not.toContain("JPY")
    expect(supportedCurrencies()).not.toContain("KWD")
    expect(supportedCurrencies()).not.toContain("BHD")
    expect(supportedCurrencies()).not.toContain("TND")
  })

  /*
   * The whole point of the list being a function rather than a constant.
   * Narrowing it constructs 162 throwaway `Intl.NumberFormat`s, so a caller
   * that asks twice — /settings re-renders on every keystroke elsewhere on the
   * page — must not pay twice, and nobody who never asks must pay at all.
   */
  it("builds the list once and hands back the same frozen array after that", () => {
    const first = supportedCurrencies()
    expect(supportedCurrencies()).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
  })
})

describe("isValidCurrency", () => {
  it("accepts real ISO 4217 codes", () => {
    expect(isValidCurrency("USD")).toBe(true)
    expect(isValidCurrency("SGD")).toBe(true)
    expect(isValidCurrency("NOK")).toBe(true)
  })

  /*
   * `Intl.NumberFormat` accepts ANY three ASCII letters as WELL-FORMED — it
   * checks shape, not membership — so the old try/catch guard passed "ABC",
   * "XYZ" and "QQQ" while its own error message claimed to know currencies,
   * and `formatMoney(1050, "ABC")` then rendered "ABC 10.50" forever.
   */
  it("rejects a well-formed code that is not a real currency", () => {
    expect(isValidCurrency("ABC")).toBe(false)
    expect(isValidCurrency("XYZ")).toBe(false)
    expect(isValidCurrency("QQQ")).toBe(false)
  })

  it("rejects a real code in the wrong case, because that is not what is stored", () => {
    expect(isValidCurrency("usd")).toBe(false)
    expect(isValidCurrency("Usd")).toBe(false)
  })

  it("rejects a currency the picker does not offer", () => {
    // The guard and the /settings dropdown read the same list, so a code the
    // picker will not show is a code the server will not store.
    expect(isValidCurrency("JPY")).toBe(false)
    expect(isValidCurrency("KWD")).toBe(false)
  })

  it("rejects a code the runtime cannot resolve", () => {
    expect(isValidCurrency("XXXXXX")).toBe(false)
    expect(isValidCurrency("US")).toBe(false)
    expect(isValidCurrency("")).toBe(false)
  })
})
