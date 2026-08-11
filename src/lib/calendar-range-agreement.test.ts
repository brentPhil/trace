import { describe, expect, it } from "vitest"
import { Temporal } from "temporal-polyfill"
import { addDays, startOfDay, weekWindow } from "@shared/day"

/*
 * The one place two date systems could disagree.
 *
 * FullCalendar v7 resolves timezones through temporal-polyfill; everything
 * else in this app resolves them through `Intl` in convex/lib/day.ts. Both are
 * correct implementations of the same rules, so they SHOULD agree about when a
 * local day begins — and if they ever stop, every block on the calendar shifts
 * relative to the day headers and nothing else in the suite would say so.
 *
 * This asserts the agreement directly, rather than trying to render the grid:
 * FullCalendar measures element geometry and jsdom reports every element as
 * zero-sized, so a rendered assertion here would be an assertion about
 * nothing.
 */

/** Midnight for a local day, computed the way FullCalendar's engine would. */
function temporalStartOfDay(day: string, timeZone: string): number {
  return Temporal.PlainDate.from(day)
    .toZonedDateTime({ timeZone })
    .epochMilliseconds
}

const ZONES = ["UTC", "Asia/Manila", "America/New_York", "Europe/Berlin"]

describe("day.ts and temporal agree about midnight", () => {
  it("agrees on an ordinary day in every zone we care about", () => {
    for (const zone of ZONES) {
      expect(temporalStartOfDay("2026-08-10", zone)).toBe(
        startOfDay("2026-08-10", zone)
      )
    }
  })

  it("agrees across a spring-forward boundary", () => {
    // 8 March 2026, America/New_York: 02:00 does not exist.
    for (const day of ["2026-03-07", "2026-03-08", "2026-03-09"]) {
      expect(temporalStartOfDay(day, "America/New_York")).toBe(
        startOfDay(day, "America/New_York")
      )
    }
  })

  it("agrees across a fall-back boundary", () => {
    // 1 November 2026, America/New_York: 01:00 happens twice.
    for (const day of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
      expect(temporalStartOfDay(day, "America/New_York")).toBe(
        startOfDay(day, "America/New_York")
      )
    }
  })

  it("agrees about a whole week's span, including a DST week", () => {
    for (const anchor of ["2026-08-11", "2026-03-08", "2026-11-01"]) {
      for (const weekStartDay of [0, 1]) {
        const week = weekWindow(anchor, "America/New_York", weekStartDay)
        expect(temporalStartOfDay(week.firstDay, "America/New_York")).toBe(
          week.fromMs
        )
        expect(
          temporalStartOfDay(addDays(week.lastDay, 1), "America/New_York")
        ).toBe(week.toMs)
      }
    }
  })
})
