import { describe, expect, it } from "vitest"
import { periodTotals } from "./period-totals"
import type { Entry } from "./group-entries"

/*
 * The Timer page's list is paginated, and its totals must NOT be derived from
 * it. A figure summed from loaded pages silently means "of the rows fetched so
 * far" — the number that ends up understated on an invoice with nothing on
 * screen to reveal it.
 *
 * Making that impossible is a matter of input: this function takes the
 * week-bounded query's rows, and the paginated list is not one of its
 * arguments, so it cannot depend on how much has loaded.
 */

const HOUR = 3_600_000
const NOON = Date.UTC(2026, 7, 8, 12) // Sat 8 Aug 2026

function entry(over: Partial<Entry> & { startedAt: number }): Entry {
  const durationMs = over.durationMs === undefined ? HOUR : over.durationMs
  return {
    _id: `e-${over.startedAt}` as Entry["_id"],
    _creationTime: 0,
    userId: "u",
    clientKey: `k-${over.startedAt}`,
    title: "Work",
    endedAt: durationMs === null ? null : over.startedAt + durationMs,
    durationMs,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: 0,
    deletedAt: null,
    ...over,
  }
}

describe("periodTotals", () => {
  it("is all zero for no entries", () => {
    expect(periodTotals([], "UTC", "2026-08-08", NOON)).toEqual({
      todayMs: 0,
      weekMs: 0,
      billableMs: 0,
    })
  })

  it("separates today from the rest of the week", () => {
    const totals = periodTotals(
      [
        entry({ startedAt: NOON - 2 * HOUR }), // today
        entry({ startedAt: NOON - 48 * HOUR }), // Thursday
      ],
      "UTC",
      "2026-08-08",
      NOON
    )

    expect(totals.todayMs).toBe(HOUR)
    expect(totals.weekMs).toBe(2 * HOUR)
  })

  it("counts only billable entries in the billable total", () => {
    const totals = periodTotals(
      [
        entry({ startedAt: NOON - 2 * HOUR, billable: true }),
        entry({ startedAt: NOON - 3 * HOUR }),
      ],
      "UTC",
      "2026-08-08",
      NOON
    )

    expect(totals.billableMs).toBe(HOUR)
    expect(totals.weekMs).toBe(2 * HOUR)
  })

  /** The running entry has no row in the log, but its time is real. */
  it("includes a running entry's elapsed time", () => {
    const totals = periodTotals(
      [entry({ startedAt: NOON - 90_000, durationMs: null })],
      "UTC",
      "2026-08-08",
      NOON
    )

    expect(totals.todayMs).toBe(90_000)
    expect(totals.weekMs).toBe(90_000)
  })

  it("attributes an entry to the day it STARTED, in the user's zone", () => {
    // 23:30 UTC on 8 Aug is 11:30 on 9 Aug in Auckland.
    const late = Date.UTC(2026, 7, 8, 23, 30)
    const totals = periodTotals(
      [entry({ startedAt: late })],
      "Pacific/Auckland",
      "2026-08-09",
      late
    )

    expect(totals.todayMs).toBe(HOUR)
  })
})
