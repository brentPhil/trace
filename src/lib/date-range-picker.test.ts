import { describe, expect, it } from "vitest"
import {
  formatDayRange,
  previewRange,
  rangeTriggerLabel,
  selectDay,
} from "./date-range-picker"

/*
 * The arithmetic behind the range picker, tested without a DOM: the two-click
 * state machine, the hover preview it drives, and the trigger's label.
 */

describe("selectDay", () => {
  it("arms a start on the first click, with nothing committed yet", () => {
    const result = selectDay(null, "2026-08-03")
    expect(result.state).toEqual({ anchor: "2026-08-03" })
    expect(result.committed).toBeNull()
  })

  it("commits the range on the second click, forward from the anchor", () => {
    const armed = selectDay(null, "2026-08-03").state
    const result = selectDay(armed, "2026-08-09")
    expect(result.committed).toEqual({ from: "2026-08-03", to: "2026-08-09" })
    expect(result.state).toBeNull()
  })

  it("commits a single-day range when the second click repeats the anchor", () => {
    const armed = selectDay(null, "2026-08-03").state
    const result = selectDay(armed, "2026-08-03")
    expect(result.committed).toEqual({ from: "2026-08-03", to: "2026-08-03" })
  })

  it("restarts from an earlier click rather than inverting the range", () => {
    // The trap this exists to close: clicking 1 Aug after arming 9 Aug must
    // not produce { from: "2026-08-09", to: "2026-08-01" }.
    const armed = selectDay(null, "2026-08-09").state
    const result = selectDay(armed, "2026-08-01")
    expect(result.committed).toBeNull()
    expect(result.state).toEqual({ anchor: "2026-08-01" })
  })

  it("a restarted selection still completes normally on its own second click", () => {
    const armed = selectDay(null, "2026-08-09").state
    const restarted = selectDay(armed, "2026-08-01").state
    const result = selectDay(restarted, "2026-08-05")
    expect(result.committed).toEqual({ from: "2026-08-01", to: "2026-08-05" })
  })
})

describe("previewRange", () => {
  it("is null with nothing armed", () => {
    expect(previewRange(null, "2026-08-05")).toBeNull()
  })

  it("previews forward from the anchor to the hovered day", () => {
    const armed = { anchor: "2026-08-03" }
    expect(previewRange(armed, "2026-08-09")).toEqual({
      from: "2026-08-03",
      to: "2026-08-09",
    })
  })

  it("previews only the hovered day when it precedes the anchor", () => {
    // Matches what a click there would actually do: restart, not invert.
    const armed = { anchor: "2026-08-09" }
    expect(previewRange(armed, "2026-08-01")).toEqual({
      from: "2026-08-01",
      to: "2026-08-01",
    })
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
