import { describe, expect, it } from "vitest"
import { addMonths, monthGrid, monthLabel, weekdayLabels } from "./month-grid"
import { weekdayOf } from "@shared/day"

/*
 * The calendar's arithmetic.
 *
 * Pure and tested hard, because a calendar is wrong in ways nobody notices
 * until a specific month comes round: the leap day, the month that needs a
 * sixth row, the one that fits in four. By then the bug is a year old.
 */

const MONDAY = 1
const SUNDAY = 0

describe("monthGrid", () => {
  it("always returns rows of exactly seven", () => {
    for (const day of [
      "2026-01-15",
      "2026-02-15",
      "2026-08-15",
      "2028-02-15",
    ]) {
      for (const start of [SUNDAY, MONDAY, 6]) {
        for (const week of monthGrid(day, start)) {
          expect(week).toHaveLength(7)
        }
      }
    }
  })

  it("starts every row on the configured first day of the week", () => {
    for (const start of [SUNDAY, MONDAY, 3, 6]) {
      const weeks = monthGrid("2026-08-15", start)
      for (const week of weeks) {
        // The first cell can be padding, so find the first real day and count
        // back to what the column's weekday must be.
        const index = week.findIndex((d) => d !== null)
        const day = week[index]
        expect(day).not.toBeNull()
        expect(weekdayOf(day as string)).toBe((start + index) % 7)
      }
    }
  })

  it("contains every day of the month exactly once, in order", () => {
    const days = monthGrid("2026-08-15", MONDAY)
      .flat()
      .filter((d): d is string => d !== null)
    expect(days).toHaveLength(31)
    expect(days[0]).toBe("2026-08-01")
    expect(days[30]).toBe("2026-08-31")
    expect(new Set(days).size).toBe(31)
    expect([...days].sort()).toEqual(days)
  })

  it("pads with nulls rather than spilling into the neighbouring months", () => {
    // August 2026 opens on a Saturday, so a Monday-first grid has five blanks
    // before the 1st. Showing 27–31 July there invites clicking a date that
    // silently jumps the calendar to another month.
    const first = monthGrid("2026-08-01", MONDAY)[0]
    expect(first.slice(0, 5)).toEqual([null, null, null, null, null])
    expect(first[5]).toBe("2026-08-01")
    expect(first[6]).toBe("2026-08-02")
  })

  it("shifts the padding when the week starts on Sunday", () => {
    const first = monthGrid("2026-08-01", SUNDAY)[0]
    expect(first.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(first[6]).toBe("2026-08-01")
  })

  it("gives February its leap day in a leap year and not otherwise", () => {
    const leap = monthGrid("2028-02-10", MONDAY)
      .flat()
      .filter((d) => d !== null)
    expect(leap).toHaveLength(29)
    expect(leap.at(-1)).toBe("2028-02-29")

    const common = monthGrid("2026-02-10", MONDAY)
      .flat()
      .filter((d) => d !== null)
    expect(common).toHaveLength(28)
    expect(common.at(-1)).toBe("2026-02-28")
  })

  it("grows to six rows when a long month needs them", () => {
    // 31 days starting on a Sunday, Monday-first: 6 leading blanks + 31 = 37
    // cells, which does not fit in five rows.
    expect(weekdayOf("2026-11-01")).toBe(SUNDAY)
    expect(monthGrid("2026-11-01", MONDAY)).toHaveLength(6)
  })

  it("uses only four rows for a February that starts on the first column", () => {
    // 28 days beginning exactly on the first column fits in four, and padding
    // it to a fixed five would draw an empty row.
    expect(weekdayOf("2027-02-01")).toBe(MONDAY)
    expect(monthGrid("2027-02-01", MONDAY)).toHaveLength(4)
  })

  it("never emits a trailing row that is entirely padding", () => {
    for (const day of [
      "2026-01-15",
      "2026-02-15",
      "2026-11-15",
      "2027-02-15",
    ]) {
      const weeks = monthGrid(day, MONDAY)
      expect(weeks.at(-1)?.some((d) => d !== null)).toBe(true)
    }
  })
})

describe("addMonths", () => {
  it("steps forward and back a month at a time", () => {
    expect(addMonths("2026-08-15", 1)).toBe("2026-09-15")
    expect(addMonths("2026-08-15", -1)).toBe("2026-07-15")
  })

  it("crosses the year boundary in both directions", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15")
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15")
  })

  it("clamps rather than rolling over into the next month", () => {
    // The trap: naive month arithmetic turns 31 January + 1 into 3 March. The
    // calendar only ever needs the MONTH, but a silent roll-over would skip
    // February entirely as the user pages forward.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28")
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29")
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28")
    expect(addMonths("2026-05-31", 1)).toBe("2026-06-30")
  })
})

describe("labels", () => {
  it("names the month and year", () => {
    expect(monthLabel("2026-08-15")).toBe("August 2026")
    expect(monthLabel("2027-01-01")).toBe("January 2027")
  })

  it("orders the weekday headings from the configured start", () => {
    expect(weekdayLabels(MONDAY)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ])
    expect(weekdayLabels(SUNDAY)[0]).toBe("Sun")
    expect(weekdayLabels(SUNDAY).at(-1)).toBe("Sat")
  })
})
