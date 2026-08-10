import { describe, expect, it } from "vitest"
import {
  bucketDays,
  busiest,
  granularityFor,
  hourRows,
  hourTicks,
} from "@/lib/report-series"
import type { DayTotal } from "@/lib/report-series"

const HOUR = 3_600_000

function day(date: string, totalMs: number, over: Partial<DayTotal> = {}): DayTotal {
  return {
    day: date,
    totalMs,
    billableMs: 0,
    billableCents: 0,
    count: 1,
    ...over,
  }
}

describe("granularityFor", () => {
  it("keeps a month of work on daily bars", () => {
    expect(granularityFor("2026-07-01", "2026-07-31")).toBe("day")
  })

  it("switches to weeks once daily bars would become a comb", () => {
    expect(granularityFor("2026-01-01", "2026-06-30")).toBe("week")
  })

  it("switches to months past two years", () => {
    expect(granularityFor("2020-01-01", "2026-01-01")).toBe("month")
  })
})

describe("bucketDays — the days nothing happened on", () => {
  /*
   * The defect this exists for. `entries.rangeBreakdown` returns only days that
   * HOLD entries, so a fortnight with a Thursday off arrives as thirteen rows.
   * Drawing thirteen bars closes the gap: Thursday vanishes and the chart reads
   * as an unbroken run of work. The gap is the information.
   */
  it("draws a day with no entries rather than closing the gap", () => {
    const { buckets } = bucketDays(
      [day("2026-07-27", 8 * HOUR), day("2026-07-29", 6 * HOUR)],
      "2026-07-27",
      "2026-07-29"
    )

    expect(buckets.map((b) => b.key)).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
    ])
    expect(buckets[1].empty).toBe(true)
    expect(buckets[1].totalMs).toBe(0)
  })

  it("marks a day that has entries as not empty, even at zero tracked time", () => {
    const { buckets } = bucketDays(
      [day("2026-07-27", 0, { count: 2 })],
      "2026-07-27",
      "2026-07-27"
    )
    // "Nobody tracked anything" and "two zero-length entries" are different
    // facts, and only one of them is drawn as a hatch.
    expect(buckets[0].empty).toBe(false)
  })

  it("covers the whole requested range even when nothing at all was tracked", () => {
    const { buckets } = bucketDays([], "2026-07-27", "2026-08-02")
    expect(buckets).toHaveLength(7)
    expect(buckets.every((b) => b.empty)).toBe(true)
  })
})

describe("bucketDays — splitting the time", () => {
  it("keeps billable and non-billable summing to the total", () => {
    const { buckets } = bucketDays(
      [day("2026-07-27", 8 * HOUR, { billableMs: 5 * HOUR })],
      "2026-07-27",
      "2026-07-27"
    )
    expect(buckets[0].billableMs).toBe(5 * HOUR)
    expect(buckets[0].nonBillableMs).toBe(3 * HOUR)
    expect(buckets[0].billableMs + buckets[0].nonBillableMs).toBe(buckets[0].totalMs)
  })

  it("sums the days inside a week bucket", () => {
    const { granularity, buckets } = bucketDays(
      [day("2026-01-01", 2 * HOUR), day("2026-01-03", 3 * HOUR)],
      "2026-01-01",
      "2026-03-31"
    )
    expect(granularity).toBe("week")
    expect(buckets[0].totalMs).toBe(5 * HOUR)
    expect(buckets[0].count).toBe(2)
  })

  it("counts weeks from the range's own start, not from a calendar week", () => {
    // Snapping to a calendar week would put a half-height bar at each end of
    // every chart, which reads as a drop in workload rather than bucketing.
    const { buckets } = bucketDays([], "2026-01-01", "2026-03-31")
    expect(buckets[0].key).toBe("2026-01-01")
    expect(buckets[1].key).toBe("2026-01-08")
  })
})

describe("bucketDays — the earnings curve", () => {
  it("accumulates, so the last point is the period's whole amount", () => {
    const { buckets } = bucketDays(
      [
        day("2026-07-27", HOUR, { billableCents: 6_100 }),
        day("2026-07-28", HOUR, { billableCents: 4_000 }),
        day("2026-07-29", HOUR, { billableCents: 900 }),
      ],
      "2026-07-27",
      "2026-07-29"
    )
    expect(buckets.map((b) => b.earnedCents)).toEqual([6_100, 10_100, 11_000])
  })

  it("holds its level across a day with no earnings rather than dropping to zero", () => {
    // A cumulative line that returns to zero on an unbilled Saturday would say
    // the money had been taken back.
    const { buckets } = bucketDays(
      [day("2026-07-27", HOUR, { billableCents: 6_100 }), day("2026-07-29", HOUR)],
      "2026-07-27",
      "2026-07-29"
    )
    expect(buckets.map((b) => b.earnedCents)).toEqual([6_100, 6_100, 6_100])
  })
})

describe("bucketDays — labels", () => {
  it("names a day by weekday and date, so 'did I work the Saturday' is answerable", () => {
    const { buckets } = bucketDays([], "2026-07-27", "2026-07-27")
    expect(buckets[0].label).toBe("Mon 27")
    // The comma is en-GB's own, and the same one the log's day headers carry
    // once they include a year — matching them is the point.
    expect(buckets[0].title).toBe("Mon, 27 Jul 2026")
  })

  it("never claims a final partial week reaches past the range asked for", () => {
    const { buckets } = bucketDays([], "2026-01-01", "2026-03-05")
    const last = buckets[buckets.length - 1]
    expect(last.title.endsWith("5 Mar 2026")).toBe(true)
  })
})

describe("busiest", () => {
  it("finds the heaviest span", () => {
    const { buckets } = bucketDays(
      [day("2026-07-27", 2 * HOUR), day("2026-07-28", 9 * HOUR)],
      "2026-07-27",
      "2026-07-28"
    )
    expect(busiest(buckets)?.key).toBe("2026-07-28")
  })

  it("breaks a tie toward the earlier span, not toward iteration order", () => {
    const { buckets } = bucketDays(
      [day("2026-07-27", 2 * HOUR), day("2026-07-28", 2 * HOUR)],
      "2026-07-27",
      "2026-07-28"
    )
    expect(busiest(buckets)?.key).toBe("2026-07-27")
  })

  it("is null when nothing was tracked, rather than naming an empty day", () => {
    const { buckets } = bucketDays([], "2026-07-27", "2026-07-28")
    expect(busiest(buckets)).toBeNull()
  })
})

describe("hourTicks", () => {
  /*
   * Recharts' own scale over a 9.9-hour day is 0h, 3h, 5h, 8h, 10h — gridlines
   * that are neither evenly spaced nor evenly valued. A reader estimating a bar
   * against that is being misled by the one part of a chart that has to be
   * beyond question.
   */
  it("steps in hours a person thinks in", () => {
    expect(hourTicks(9.9 * HOUR).map((ms) => ms / HOUR)).toEqual([0, 2, 4, 6, 8, 10])
  })

  it("leaves the tallest bar under the last gridline, never touching the ceiling", () => {
    const ticks = hourTicks(8 * HOUR)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(8 * HOUR)
  })

  it("keeps a real scale when nothing was tracked at all", () => {
    // A single 0h tick would be a domain of zero height, which recharts draws
    // as bars of infinite height.
    expect(hourTicks(0).map((ms) => ms / HOUR)).toEqual([0, 1])
  })

  it("stays at five ticks or fewer however long the period is", () => {
    for (const hours of [0.5, 3, 7, 9.9, 25, 60, 200, 1_000]) {
      expect(hourTicks(hours * HOUR).length).toBeLessThanOrEqual(6)
    }
  })
})

describe("hourRows", () => {
  it("always returns all twenty-four hours in clock order", () => {
    // Dropping the empty ones would squeeze a nine-to-five into the width of a
    // whole day and destroy the shape the chart exists to show.
    const rows = hourRows([], false)
    expect(rows).toHaveLength(24)
    expect(rows.map((r) => r.hour)).toEqual([...Array(24).keys()])
    expect(rows.every((r) => r.totalMs === 0)).toBe(true)
  })

  it("labels in the user's clock format", () => {
    const hours = Array.from({ length: 24 }, () => 0)
    expect(hourRows(hours, false)[9].label).toBe("09:00")
    expect(hourRows(hours, true)[9].label).toBe("9am")
    expect(hourRows(hours, true)[0].label).toBe("12am")
    expect(hourRows(hours, true)[12].label).toBe("12pm")
    expect(hourRows(hours, true)[13].label).toBe("1pm")
  })
})
