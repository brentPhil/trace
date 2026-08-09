import { describe, expect, it } from "vitest"
import { formatRate, rateHelp } from "./format-money"

const NBSP = String.fromCharCode(160)

describe("formatRate", () => {
  /*
   * The distinction the whole function exists for. "No rate set" and "$0.00/hr"
   * are different facts: the first contributes nothing to the billable amount
   * on /reports, the second is an explicit pro-bono price that shows up as a
   * real zero. Collapsing them would make "nobody has priced this yet"
   * indistinguishable from "priced at nothing".
   */
  it("distinguishes an unset rate from an explicit zero", () => {
    expect(formatRate(undefined, "USD")).toBe("No rate set")
    expect(formatRate(0, "USD")).toBe("$0.00/hr")
  })

  it("renders a rate with the currency's own symbol and placement", () => {
    expect(formatRate(6_100, "USD")).toBe("$61.00/hr")
    expect(formatRate(1_050, "GBP")).toBe(`${String.fromCharCode(163)}10.50/hr`)
    expect(formatRate(6_100, "SGD")).toBe(`SGD${NBSP}61.00/hr`)
  })

  /*
   * /projects server-renders. If this varied with the runtime's locale the
   * server would emit "$61.00/hr" and a de-DE browser would hydrate
   * "61,00 $/hr" — a React hydration mismatch on a money figure. `formatMoney`
   * pins the locale; this asserts the pin reaches here.
   */
  it("does not vary with the runtime's own locale", () => {
    expect(formatRate(6_100, "EUR")).toBe(`${String.fromCharCode(8364)}61.00/hr`)
  })
})

describe("rateHelp", () => {
  /*
   * The old text was the constant string "Try 10, 10.50, or $10", shown to
   * every user regardless of currency. An SGD user was told to type a dollar
   * sign by the very message rejecting what they had typed.
   */
  it("shows an example in the user's own currency, not a hardcoded dollar", () => {
    expect(rateHelp("USD")).toContain("$10.50")
    expect(rateHelp("GBP")).toContain(`${String.fromCharCode(163)}10.50`)
    expect(rateHelp("SGD")).toContain(`SGD${NBSP}10.50`)
    expect(rateHelp("SGD")).not.toContain("$")
  })

  it("still names the bare forms, which are what the field actually wants", () => {
    expect(rateHelp("SGD")).toContain("10.50")
    expect(rateHelp("SGD")).toContain("blank")
  })
})
