import { describe, expect, it } from "vitest"
import { NO_PROJECT, percentOf, reportRows } from "./report-rows"
import type { Breakdown } from "@/lib/report-series"

const HOUR = 3_600_000

function breakdownOf(over: Partial<Breakdown> = {}): Breakdown {
  return {
    totalMs: 0,
    billableMs: 0,
    count: 0,
    runningCount: 0,
    truncated: false,
    billableCents: 0,
    unratedBillableMs: 0,
    days: [],
    projects: [],
    hours: Array.from({ length: 24 }, () => 0),
    titles: [],
    titlesTruncated: false,
    ...over,
  }
}

const RANGE = { from: "2026-07-13", to: "2026-07-15", currency: "USD" } as const

describe("percentOf", () => {
  it("gives two decimal places, matching the reference report", () => {
    expect(percentOf(2_880_000, 355_680_000)).toBe(0.81)
    expect(percentOf(355_680_000, 355_680_000)).toBe(100)
  })

  it("answers zero for an empty whole rather than NaN", () => {
    expect(percentOf(0, 0)).toBe(0)
    expect(percentOf(5, 0)).toBe(0)
  })
})

describe("reportRows — totals", () => {
  it("averages over days that hold work, not calendar days", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: 9 * HOUR,
        count: 3,
        days: [
          { day: "2026-07-13", totalMs: 5 * HOUR, billableMs: 0, billableCents: 0, count: 2 },
          { day: "2026-07-15", totalMs: 4 * HOUR, billableMs: 0, billableCents: 0, count: 1 },
        ],
      }),
      RANGE
    )

    // Two days worked out of three in range. Dividing by three would report
    // 3h/day for someone who worked four and five.
    expect(rows.meta.daysWorked).toBe(2)
    expect(rows.totals.averageDailyMs).toBe(4.5 * HOUR)
  })

  it("reports a zero average for an empty range rather than dividing by zero", () => {
    const rows = reportRows(breakdownOf(), RANGE)
    expect(rows.totals.averageDailyMs).toBe(0)
    expect(rows.totals.billablePercent).toBe(0)
  })

  it("carries truncation through, because the caller must refuse on it", () => {
    expect(reportRows(breakdownOf({ truncated: true }), RANGE).totals.truncated).toBe(true)
  })
})

describe("reportRows — buckets", () => {
  it("densifies the range, so a day off stays visible as a gap", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: 9 * HOUR,
        days: [
          { day: "2026-07-13", totalMs: 5 * HOUR, billableMs: 0, billableCents: 0, count: 1 },
          { day: "2026-07-15", totalMs: 4 * HOUR, billableMs: 0, billableCents: 0, count: 1 },
        ],
      }),
      RANGE
    )

    expect(rows.buckets.map((b) => b.key)).toEqual([
      "2026-07-13",
      "2026-07-14",
      "2026-07-15",
    ])
    expect(rows.buckets[1]).toMatchObject({ empty: true, totalMs: 0 })
  })
})

describe("reportRows — projects and descriptions", () => {
  it("names the unassigned bucket rather than printing an empty cell", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: HOUR,
        projects: [
          {
            projectId: null,
            name: "",
            color: "",
            totalMs: HOUR,
            billableMs: 0,
            billableCents: 0,
            unratedBillableMs: 0,
            count: 1,
          },
        ],
        titles: [
          {
            projectId: null,
            project: "",
            title: "",
            totalMs: HOUR,
            billableMs: 0,
            billableCents: 0,
            unratedBillableMs: 0,
            count: 1,
          },
        ],
      }),
      RANGE
    )

    expect(rows.projects[0].name).toBe(NO_PROJECT)
    expect(rows.titles[0].project).toBe(NO_PROJECT)
    // An untitled entry gets a stated placeholder too — an empty description
    // cell reads as a rendering fault, not as work nobody named.
    expect(rows.titles[0].description).toBe("(no description)")
  })

  it("carries decimal hours per row, so a writer never re-derives them", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: 29_520_000,
        titles: [
          {
            projectId: null,
            project: "Acme",
            title: "Standup",
            totalMs: 29_520_000,
            billableMs: 29_520_000,
            billableCents: 98_800,
            unratedBillableMs: 0,
            count: 1,
          },
        ],
      }),
      RANGE
    )

    expect(rows.titles[0].centiHours).toBe(820)
    expect(rows.titles[0].percent).toBe(100)
    expect(rows.titles[0].unpriced).toBe(false)
  })

  it("marks a row unpriced when any of its billable time has no rate", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: HOUR,
        titles: [
          {
            projectId: null,
            project: "Acme",
            title: "Standup",
            totalMs: HOUR,
            billableMs: HOUR,
            billableCents: 0,
            unratedBillableMs: HOUR,
            count: 1,
          },
        ],
      }),
      RANGE
    )

    expect(rows.titles[0].unpriced).toBe(true)
  })
})
