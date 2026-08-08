import { describe, expect, it } from "vitest"
import { dateToDay, dayToDate, formatDayRange, rangeTriggerLabel } from "./date-range-picker"

/*
 * The arithmetic behind the range picker, tested without a DOM: the
 * `DayString` <-> `Date` boundary conversion, and the trigger's label.
 *
 * The two-click selection state machine (`selectDay` / `previewRange`) that
 * used to be tested here is DELETED along with the hand-built calendar —
 * react-day-picker's own `mode="range"` owns selection now, and
 * `date-range-picker.test.tsx` covers it through the composed component.
 */

describe("dayToDate / dateToDay", () => {
  it("round-trips a DayString through a Date and back", () => {
    expect(dateToDay(dayToDate("2026-08-03"))).toBe("2026-08-03")
  })

  it("round-trips the first and last day of a month", () => {
    expect(dateToDay(dayToDate("2026-01-01"))).toBe("2026-01-01")
    expect(dateToDay(dayToDate("2026-12-31"))).toBe("2026-12-31")
  })

  it("round-trips a leap day", () => {
    expect(dateToDay(dayToDate("2024-02-29"))).toBe("2024-02-29")
  })

  it("produces a Date whose LOCAL calendar fields match the DayString", () => {
    // The trap this guards against: `new Date("2026-08-03")` parses as UTC
    // midnight, which prints as 2 August in every zone west of Greenwich.
    // `dayToDate` must never do that — it writes into local fields directly,
    // so the local getters below see 2026-08-03 no matter what zone this
    // test happens to run in.
    const date = dayToDate("2026-08-03")
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(7) // 0-indexed: August
    expect(date.getDate()).toBe(3)
  })

  it("is not fooled by a Date at a local time other than midnight", () => {
    // dateToDay must read the calendar day a Date falls on locally, not
    // reconstruct it via an instant — a Date built from local fields with an
    // afternoon hour is still "the same day" in dateToDay's terms.
    const date = new Date(2026, 7, 3, 23, 30)
    expect(dateToDay(date)).toBe("2026-08-03")
  })
})

describe("formatDayRange", () => {
  it("collapses a shared month and year", () => {
    expect(formatDayRange("2026-08-03", "2026-08-09")).toBe("3 – 9 Aug 2026")
  })

  it("names a single day once, with no dash", () => {
    expect(formatDayRange("2026-08-09", "2026-08-09")).toBe("9 Aug 2026")
  })

  it("names both months when the range crosses a month boundary", () => {
    expect(formatDayRange("2026-07-28", "2026-08-03")).toBe("28 Jul – 3 Aug 2026")
  })

  it("names both years when the range crosses a year boundary", () => {
    expect(formatDayRange("2026-12-29", "2027-01-04")).toBe(
      "29 Dec 2026 – 4 Jan 2027"
    )
  })
})

describe("rangeTriggerLabel", () => {
  const today = "2026-08-06"

  it("names the day when it is today's own day period", () => {
    expect(rangeTriggerLabel("day", today, today, today, 1)).toBe("Today")
  })

  it("names the week when it matches the current calendar week", () => {
    // Monday-start week containing 2026-08-06 is 3–9 Aug.
    expect(rangeTriggerLabel("week", "2026-08-03", "2026-08-09", today, 1)).toBe(
      "This week"
    )
  })

  it("names the month when it matches the current calendar month", () => {
    expect(rangeTriggerLabel("month", "2026-08-01", "2026-08-31", today, 1)).toBe(
      "This month"
    )
  })

  it("falls back to the formatted range for a stepped-away week", () => {
    // Still period "week", but no longer THIS week — "last week" is not
    // "this" anything.
    expect(rangeTriggerLabel("week", "2026-07-27", "2026-08-02", today, 1)).toBe(
      "27 Jul – 2 Aug 2026"
    )
  })

  it("formats a custom range regardless of whether it happens to span a week", () => {
    expect(rangeTriggerLabel("custom", "2026-08-03", "2026-08-09", today, 1)).toBe(
      "3 – 9 Aug 2026"
    )
  })

  it("honours weekStartDay when deciding whether a range is 'this week'", () => {
    // Sunday-start week containing 2026-08-06 is 2–8 Aug, not 3–9.
    expect(rangeTriggerLabel("week", "2026-08-03", "2026-08-09", today, 0)).toBe(
      "3 – 9 Aug 2026"
    )
    expect(rangeTriggerLabel("week", "2026-08-02", "2026-08-08", today, 0)).toBe(
      "This week"
    )
  })
})
