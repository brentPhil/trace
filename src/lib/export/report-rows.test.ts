import { describe, expect, it } from "vitest"
import { percentOf, reportRows, shareCents } from "./report-rows"
import { NO_PROJECT_LABEL } from "@/lib/report-series"
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
    notesTruncated: false,
    ...over,
  }
}

const RANGE = {
  from: "2026-07-13",
  to: "2026-07-15",
  currency: "USD",
  timeZone: "UTC",
  use12Hour: true,
} as const

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
            weekStart: "2026-07-13",
            notes: [],
            entries: [],
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

    expect(rows.projects[0].name).toBe(NO_PROJECT_LABEL)
    expect(rows.titles[0].project).toBe(NO_PROJECT_LABEL)
    // An untitled entry gets a stated placeholder too — an empty description
    // cell reads as a rendering fault, not as work nobody named.
    expect(rows.titles[0].description).toBe("(no description)")
  })

  it("gives a single full-range row 100% and no unpriced flag", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: 29_520_000,
        titles: [
          {
            projectId: null,
            project: "Acme",
            title: "Standup",
            weekStart: "2026-07-13",
            notes: [],
            entries: [],
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
            weekStart: "2026-07-13",
            notes: [],
            entries: [],
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

describe("reportRows — weeks", () => {
  /*
   * `weekStart` is what the backend attributes each title row to (see
   * convex/entries.ts). Grouping it here rather than in the backend keeps
   * `entries.rangeBreakdown` a single scan — the export just re-partitions
   * the SAME flat list the Summary tab already draws from.
   */
  it("groups rows by weekStart, ascending, dropping nothing from the flat list", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: 3 * HOUR,
        titles: [
          {
            projectId: null,
            project: "Acme",
            title: "Second week",
            weekStart: "2026-07-20",
            notes: [],
            entries: [],
            totalMs: HOUR,
            billableMs: 0,
            billableCents: 0,
            unratedBillableMs: 0,
            count: 1,
          },
          {
            projectId: null,
            project: "Acme",
            title: "First week, row A",
            weekStart: "2026-07-13",
            notes: [],
            entries: [],
            totalMs: HOUR,
            billableMs: 0,
            billableCents: 0,
            unratedBillableMs: 0,
            count: 1,
          },
          {
            projectId: null,
            project: "Acme",
            title: "First week, row B",
            weekStart: "2026-07-13",
            notes: [],
            entries: [],
            totalMs: HOUR,
            billableMs: 0,
            billableCents: 0,
            unratedBillableMs: 0,
            count: 1,
          },
        ],
      }),
      { ...RANGE, from: "2026-07-13", to: "2026-07-26" }
    )

    expect(rows.weeks.map((w) => w.weekStart)).toEqual(["2026-07-13", "2026-07-20"])
    expect(rows.weeks[0].rows).toHaveLength(2)
    expect(rows.weeks[1].rows).toHaveLength(1)
    // Nothing lost or duplicated between the flat list and the grouped one.
    expect(rows.weeks.flatMap((w) => w.rows)).toHaveLength(rows.titles.length)
  })

  it("labels a week that stays within one month with the reference format", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: HOUR,
        titles: [
          {
            projectId: null,
            project: "Acme",
            title: "Standup",
            weekStart: "2026-08-03",
            notes: [],
            entries: [],
            totalMs: HOUR,
            billableMs: 0,
            billableCents: 0,
            unratedBillableMs: 0,
            count: 1,
          },
        ],
      }),
      { ...RANGE, from: "2026-08-03", to: "2026-08-09" }
    )

    expect(rows.weeks[0].label).toBe("3 – 9 Aug 2026")
  })

  it("clamps a week's label to the report's own range rather than claiming unqueried days", () => {
    // The requested range starts mid-week (Wednesday), so the week's real
    // calendar span begins two days before `from` — those two days were never
    // queried and the label must not claim them, the same principle
    // `report-series.ts`'s `titleOf` already applies to weekly chart labels.
    const rows = reportRows(
      breakdownOf({
        totalMs: HOUR,
        titles: [
          {
            projectId: null,
            project: "Acme",
            title: "Standup",
            weekStart: "2026-08-03", // the Monday; range starts Wednesday the 5th
            notes: [],
            entries: [],
            totalMs: HOUR,
            billableMs: 0,
            billableCents: 0,
            unratedBillableMs: 0,
            count: 1,
          },
        ],
      }),
      { ...RANGE, from: "2026-08-05", to: "2026-08-09" }
    )

    expect(rows.weeks[0].label).toBe("5 – 9 Aug 2026")
  })

  it("computes each week's subtotal from its own rows", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: 3 * HOUR,
        billableCents: 300,
        titles: [
          {
            projectId: null,
            project: "Acme",
            title: "A",
            weekStart: "2026-07-13",
            notes: [],
            entries: [],
            totalMs: HOUR,
            billableMs: HOUR,
            billableCents: 100,
            unratedBillableMs: 0,
            count: 1,
          },
          {
            projectId: null,
            project: "Acme",
            title: "B",
            weekStart: "2026-07-13",
            notes: [],
            entries: [],
            totalMs: 2 * HOUR,
            billableMs: 2 * HOUR,
            billableCents: 200,
            unratedBillableMs: 0,
            count: 1,
          },
        ],
      }),
      { ...RANGE, from: "2026-07-13", to: "2026-07-19" }
    )

    expect(rows.weeks[0].subtotal.totalMs).toBe(3 * HOUR)
    expect(rows.weeks[0].subtotal.billableCents).toBe(300)
    expect(rows.weeks[0].subtotal.unpriced).toBe(false)
  })

  /*
   * THE INVARIANT a reader will question: a row's percent is its share of the
   * WHOLE RANGE, not of the week it landed in — so summing every row's percent
   * across every week still totals 100%, matching the grand TOTAL row. If rows
   * were percented against their own week, two different weeks' "50%" rows
   * would mean two different durations with nothing on the page to say so.
   */
  it("keeps each row's percent as its share of the range, not of its week", () => {
    const rows = reportRows(
      breakdownOf({
        totalMs: 4 * HOUR,
        titles: [
          {
            projectId: null,
            project: "Acme",
            title: "Small week",
            weekStart: "2026-07-13",
            notes: [],
            entries: [],
            totalMs: HOUR, // 1 of 4 hours in the RANGE -> 25%, not 100% of its own 1h week
            billableMs: 0,
            billableCents: 0,
            unratedBillableMs: 0,
            count: 1,
          },
          {
            projectId: null,
            project: "Acme",
            title: "Big week",
            weekStart: "2026-07-20",
            notes: [],
            entries: [],
            totalMs: 3 * HOUR,
            billableMs: 0,
            billableCents: 0,
            unratedBillableMs: 0,
            count: 1,
          },
        ],
      }),
      { ...RANGE, from: "2026-07-13", to: "2026-07-26" }
    )

    expect(rows.weeks[0].rows[0].percent).toBe(25)
    expect(rows.weeks[1].rows[0].percent).toBe(75)
    const summed = rows.weeks.flatMap((w) => w.rows).reduce((n, r) => n + r.percent, 0)
    expect(summed).toBe(100)
  })

  it("gives an empty range no weeks, rather than one empty week", () => {
    const rows = reportRows(breakdownOf(), RANGE)
    expect(rows.weeks).toEqual([])
  })
})

describe("shareCents", () => {
  it("splits in proportion and sums exactly to the whole", () => {
    expect(shareCents(1_000, [1, 1, 1])).toEqual([334, 333, 333])
    expect(shareCents(1_000, [3, 1])).toEqual([750, 250])
  })

  it("hands the leftover cents to the largest remainders, not the first entries", () => {
    // 100 over 2:1 is 66.67 and 33.33 — the spare cent goes to the .67,
    // wherever it sits.
    expect(shareCents(100, [2, 1])).toEqual([67, 33])
    expect(shareCents(100, [1, 2])).toEqual([33, 67])
  })

  it("gives a weightless entry nothing, and a weightless row nothing at all", () => {
    expect(shareCents(500, [0, 2, 0])).toEqual([0, 500, 0])
    expect(shareCents(500, [0, 0])).toEqual([0, 0])
  })
})

describe("reportRows — entries", () => {
  const AUG_3_0905_UTC = Date.parse("2026-08-03T09:05:00Z")

  function rowWith(
    entries: Breakdown["titles"][number]["entries"],
    over: Partial<Breakdown["titles"][number]> = {}
  ): Breakdown {
    const totalMs = entries.reduce((sum, entry) => sum + entry.durationMs, 0)
    return breakdownOf({
      totalMs,
      titles: [
        {
          projectId: null,
          project: "Acme",
          title: "Standup",
          weekStart: "2026-08-03",
          notes: [],
          entries,
          totalMs,
          billableMs: totalMs,
          billableCents: 1_000,
          unratedBillableMs: 0,
          count: entries.length,
          ...over,
        },
      ],
    })
  }

  const entry = (startedAt: number, durationMs = HOUR, billable = true) => ({
    startedAt,
    endedAt: startedAt + durationMs,
    durationMs,
    billable,
  })

  it("writes each entry's day, start and end in the user's own zone and clock", () => {
    const breakdown = rowWith([entry(AUG_3_0905_UTC)])
    const range = { ...RANGE, from: "2026-08-03", to: "2026-08-09" } as const

    expect(reportRows(breakdown, range).titles[0].entries[0]).toMatchObject({
      day: "2026-08-03",
      start: "9:05 AM",
      end: "10:05 AM",
      totalMs: HOUR,
    })
    expect(
      reportRows(breakdown, { ...range, use12Hour: false }).titles[0].entries[0]
    ).toMatchObject({ start: "09:05", end: "10:05" })
    // Twelve hours ahead of UTC, the same instant is the evening — and still
    // the same day, which is the day the backend attributed it to.
    expect(
      reportRows(breakdown, { ...range, timeZone: "Pacific/Auckland" }).titles[0].entries[0]
    ).toMatchObject({ day: "2026-08-03", start: "9:05 PM", end: "10:05 PM" })
  })

  /* The PDF prints the row's amount and the CSV prints its entries'. A client
   * adding up the second must land on the first. */
  it("shares the row's own amount over its billable entries, to the cent", () => {
    const rows = reportRows(
      rowWith(
        [
          entry(AUG_3_0905_UTC, HOUR),
          entry(AUG_3_0905_UTC + 2 * HOUR, HOUR / 2, false),
          entry(AUG_3_0905_UTC + 4 * HOUR, 2 * HOUR),
        ],
        { billableCents: 1_000 }
      ),
      RANGE
    )
    const cents = rows.titles[0].entries.map((row) => row.billableCents)

    expect(cents).toEqual([333, 0, 667])
    expect(cents.reduce((sum, value) => sum + value, 0)).toBe(rows.titles[0].billableCents)
  })

  it("marks only the billable entries of an unrated row as unpriced", () => {
    const rows = reportRows(
      rowWith([entry(AUG_3_0905_UTC), entry(AUG_3_0905_UTC + 2 * HOUR, HOUR, false)], {
        billableCents: 0,
        unratedBillableMs: HOUR,
      }),
      RANGE
    )
    expect(rows.titles[0].entries.map((row) => row.unpriced)).toEqual([true, false])
  })

  it("gives each entry its share of the whole range, like its row", () => {
    const rows = reportRows(
      rowWith([entry(AUG_3_0905_UTC, HOUR), entry(AUG_3_0905_UTC + 2 * HOUR, 3 * HOUR)]),
      RANGE
    )
    expect(rows.titles[0].entries.map((row) => row.percent)).toEqual([25, 75])
  })
})
