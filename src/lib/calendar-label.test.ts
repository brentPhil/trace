import { describe, expect, it } from "vitest"
import { calendarLabel } from "./calendar-label"

/*
 * The stepper's text.
 *
 * Toggl's "W33" is deliberately absent and the absence is tested by omission:
 * ISO week numbers are Monday-based by definition and this app's week start is
 * configurable, so under weekStartDay 0 the number would name a week other
 * than the one on screen.
 */

const TODAY = "2026-08-11" // a Tuesday

describe("calendarLabel — day", () => {
  it("names today", () => {
    expect(calendarLabel("2026-08-11", "2026-08-11", "day", TODAY)).toBe(
      "Today · Tue 11 Aug"
    )
  })

  it("names yesterday", () => {
    expect(calendarLabel("2026-08-10", "2026-08-10", "day", TODAY)).toBe(
      "Yesterday · Mon 10 Aug"
    )
  })

  it("gives any other day its date alone", () => {
    expect(calendarLabel("2026-08-07", "2026-08-07", "day", TODAY)).toBe(
      "Fri 7 Aug"
    )
  })
})

describe("calendarLabel — week and 5day", () => {
  it("prefixes the week containing today", () => {
    expect(calendarLabel("2026-08-10", "2026-08-16", "week", TODAY)).toBe(
      "This week · 10–16 Aug"
    )
  })

  it("prefixes a 5-day range in the week containing today", () => {
    // Mon-Fri. Today is Tuesday, so it is inside the range.
    expect(calendarLabel("2026-08-10", "2026-08-14", "5day", TODAY)).toBe(
      "This week · 10–14 Aug"
    )
  })

  it("still says This week when today is the weekend a 5-day range hides", () => {
    // Saturday 15 Aug: not in Mon-Fri, but it IS this week. Dropping the
    // prefix here would tell the user they were looking at some other week.
    expect(calendarLabel("2026-08-10", "2026-08-14", "5day", "2026-08-15")).toBe(
      "This week · 10–14 Aug"
    )
  })

  it("drops the prefix for another week", () => {
    expect(calendarLabel("2026-08-03", "2026-08-09", "week", TODAY)).toBe(
      "3–9 Aug"
    )
  })

  it("names both months when the range crosses one", () => {
    expect(calendarLabel("2026-07-27", "2026-08-02", "week", TODAY)).toBe(
      "27 Jul – 2 Aug"
    )
  })

  it("names both years when the range crosses one", () => {
    expect(calendarLabel("2026-12-28", "2027-01-03", "week", TODAY)).toBe(
      "28 Dec 2026 – 3 Jan 2027"
    )
  })

  it("uses an en dash, per the house style for a range", () => {
    // formatTimeRange in src/lib/format-time.ts sets the precedent.
    expect(calendarLabel("2026-08-03", "2026-08-09", "week", TODAY)).toContain(
      "–"
    )
    expect(calendarLabel("2026-08-03", "2026-08-09", "week", TODAY)).not.toContain(
      " - "
    )
  })
})
