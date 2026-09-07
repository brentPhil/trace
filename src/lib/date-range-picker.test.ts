import { describe, expect, it } from "vitest"
import { daysBetween } from "@/lib/history-filters"
import { addDays } from "@shared/day"
import {
  REPORTS_DEFAULT_PRESET,
  REPORTS_PRESETS,
  activeReportsPreset,
  dateToDay,
  dayToDate,
  formatDayRange,
  quarterWindow,
  rangeTriggerLabel,
  reportsDefaultFilters,
  reportsPresetWindow,
  yearWindow,
} from "./date-range-picker"

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

describe("quarterWindow", () => {
  it("bounds each of the four calendar quarters", () => {
    expect(quarterWindow("2026-02-14")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    })
    expect(quarterWindow("2026-05-01")).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    })
    expect(quarterWindow("2026-09-30")).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    })
    expect(quarterWindow("2026-11-02")).toEqual({
      from: "2026-10-01",
      to: "2026-12-31",
    })
  })

  it("is the same window from the first and the last day of a quarter", () => {
    // The boundary days are the ones an off-by-one puts in the wrong quarter,
    // and a report scoped to the wrong quarter looks exactly like a quiet one.
    expect(quarterWindow("2026-07-01")).toEqual(quarterWindow("2026-09-30"))
  })

  it("does not run a December anchor's quarter into the next year", () => {
    expect(quarterWindow("2026-12-31")).toEqual({
      from: "2026-10-01",
      to: "2026-12-31",
    })
  })

  it("gives Q1 of the NEXT year for the day after a December anchor's quarter", () => {
    // The year seam, walked rather than asserted about: the day after Q4 ends
    // has to be the first day of Q1, and that quarter has to belong to 2027.
    const q4 = quarterWindow("2026-12-15")
    const next = quarterWindow(addDays(q4.to, 1))
    expect(next).toEqual({ from: "2027-01-01", to: "2027-03-31" })
  })

  it("ends Q1 of a leap year on 31 March, whatever February did", () => {
    expect(quarterWindow("2028-02-29")).toEqual({
      from: "2028-01-01",
      to: "2028-03-31",
    })
  })
})

describe("yearWindow", () => {
  it("bounds the calendar year a day falls in", () => {
    expect(yearWindow("2026-08-06")).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    })
  })

  it("is the same window from either end of the year", () => {
    expect(yearWindow("2026-01-01")).toEqual(yearWindow("2026-12-31"))
  })

  it("is 366 days long in a leap year and 365 otherwise", () => {
    // The one observable difference a leap year makes to a year window, and
    // the only way to catch a `to` built from a table rather than from a date.
    const leap = yearWindow("2028-06-01")
    expect(daysBetween(leap.from, leap.to) + 1).toBe(366)
    const plain = yearWindow("2026-06-01")
    expect(daysBetween(plain.from, plain.to) + 1).toBe(365)
  })
})

describe("reportsPresetWindow", () => {
  const today = "2026-08-06" // a Thursday
  const monday = 1

  it("bounds the two 'last' spans on calendar boundaries, not on today", () => {
    expect(reportsPresetWindow("last-week", today, monday)).toEqual({
      from: "2026-07-27",
      to: "2026-08-02",
    })
    expect(reportsPresetWindow("last-month", today, monday)).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    })
  })

  it("makes 'last 2 weeks' the two finished weeks, never the one today is in", () => {
    expect(reportsPresetWindow("last-two-weeks", today, monday)).toEqual({
      from: "2026-07-20",
      to: "2026-08-02",
    })
    // Its second week is exactly "Last week" — the two spans nest.
    expect(reportsPresetWindow("last-two-weeks", today, monday).to).toBe(
      reportsPresetWindow("last-week", today, monday).to
    )
  })

  it("excludes the current week from 'last 2 weeks' even on that week's first day", () => {
    // A Monday. Fourteen days back from the week's first day is still the
    // week before last's first day; the window must not slide into this week.
    expect(reportsPresetWindow("last-two-weeks", "2026-08-03", monday)).toEqual({
      from: "2026-07-20",
      to: "2026-08-02",
    })
  })

  it("rolls 'last month' back over the year boundary", () => {
    expect(reportsPresetWindow("last-month", "2026-01-09", monday)).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    })
  })

  it("ends 'last month' on 29 February in a leap year", () => {
    // The month whose length is not a constant, reached the way a user
    // reaches it: from the month after it.
    expect(reportsPresetWindow("last-month", "2028-03-15", monday)).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    })
  })

  it("honours weekStartDay for all three of the week spans", () => {
    expect(reportsPresetWindow("this-week", today, 0)).toEqual({
      from: "2026-08-02",
      to: "2026-08-08",
    })
    expect(reportsPresetWindow("last-week", today, 0)).toEqual({
      from: "2026-07-26",
      to: "2026-08-01",
    })
    expect(reportsPresetWindow("last-two-weeks", today, 0)).toEqual({
      from: "2026-07-19",
      to: "2026-08-01",
    })
  })

  it("gives every preset a window whose ends are in order", () => {
    // Cheap, and it is the invariant every figure on /reports depends on:
    // `rangeOf` turns these into a half-open instant pair, and an inverted
    // one scans nothing at all while looking like a quiet quarter.
    for (const preset of REPORTS_PRESETS) {
      const window = reportsPresetWindow(preset, today, monday)
      expect(window.from <= window.to).toBe(true)
    }
  })
})

describe("activeReportsPreset", () => {
  const today = "2026-08-06"

  it("names the preset a range exactly matches", () => {
    const quarter = reportsPresetWindow("this-quarter", today, 1)
    expect(activeReportsPreset(quarter.from, quarter.to, today, 1)).toBe(
      "this-quarter"
    )
  })

  it("names nothing once the range has been stepped off a preset", () => {
    const quarter = reportsPresetWindow("this-quarter", today, 1)
    expect(
      activeReportsPreset(addDays(quarter.from, -1), quarter.to, today, 1)
    ).toBeNull()
  })
})

describe("reportsDefaultFilters", () => {
  it("opens /reports on the current quarter", () => {
    const filters = reportsDefaultFilters("2026-08-06", 1)
    expect({ from: filters.from, to: filters.to }).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    })
  })

  it("opens on the preset the rail badges as the default", () => {
    // The badge and the opening range are one fact. Asserted together so a
    // change to either has to move the other.
    const filters = reportsDefaultFilters("2026-08-06", 1)
    expect(activeReportsPreset(filters.from, filters.to, "2026-08-06", 1)).toBe(
      REPORTS_DEFAULT_PRESET
    )
  })

  it("leaves every non-date filter at its default", () => {
    const filters = reportsDefaultFilters("2026-08-06", 1)
    expect(filters.projectId).toBeNull()
    expect(filters.billableOnly).toBe(false)
    expect(filters.text).toBe("")
    expect(filters.presets).toEqual([])
  })
})
