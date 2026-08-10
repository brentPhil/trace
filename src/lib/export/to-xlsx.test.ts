import { describe, expect, it } from "vitest"
import { xlsxSheets } from "./to-xlsx"
import type { ReportRows } from "./report-rows"

const HOUR = 3_600_000

const ROWS: ReportRows = {
  meta: {
    from: "2026-07-13",
    to: "2026-07-25",
    currency: "USD",
    daysWorked: 2,
    granularity: "day",
  },
  totals: {
    totalMs: 3 * HOUR,
    billableMs: 3 * HOUR,
    billablePercent: 100,
    billableCents: 3_000,
    unratedBillableMs: 0,
    averageDailyMs: 1.5 * HOUR,
    count: 2,
    truncated: false,
  },
  buckets: [
    {
      key: "2026-07-13",
      label: "Mon 13",
      title: "Mon, 13 Jul 2026",
      totalMs: 2 * HOUR,
      billableMs: 2 * HOUR,
      nonBillableMs: 0,
      billableCents: 2_000,
      earnedCents: 2_000,
      count: 1,
      empty: false,
    },
  ],
  projects: [
    {
      name: "Acme",
      color: "amber",
      totalMs: 3 * HOUR,
      percent: 100,
      billableCents: 3_000,
      unratedBillableMs: 0,
    },
  ],
  titles: [
    {
      project: "Acme",
      description: "Standup",
      weekStart: "2026-07-13",
      totalMs: 3 * HOUR,
      centiHours: 300,
      percent: 100,
      billableCents: 3_000,
      unpriced: false,
    },
  ],
  // Not exercised by these tests — `xlsxSheets` reads the flat `titles` list
  // plus each row's own `weekStart`, never the grouped shape (see
  // report-rows.ts).
  weeks: [],
  titlesTruncated: false,
}

describe("xlsxSheets", () => {
  it("writes three sheets, named for what a reader is looking for", () => {
    expect(xlsxSheets(ROWS).map((s) => s.sheet)).toEqual([
      "Summary",
      "By day",
      "Breakdown",
    ])
  })

  /*
   * The whole reason this is XLSX and not a second CSV. A duration written as
   * the string "3:00:00" cannot be summed, averaged or charted; the recipient
   * retypes the column, which is the transcription step this feature exists to
   * delete.
   */
  it("writes durations as numbers, so the recipient can sum the column", () => {
    const breakdown = xlsxSheets(ROWS).find((s) => s.sheet === "Breakdown")!
    const [, first] = breakdown.data
    expect(first[4]).toEqual({ value: 3, type: Number, format: "0.00" })
  })

  /*
   * A real Date cell, at UTC midnight — the same rule the By-day sheet's own
   * date column follows, and for the same reason: the calendar date was
   * already decided server-side under the user's stored zone, so
   * re-interpreting it in the browser's zone at render time is how a Monday
   * becomes the previous Sunday in a pivot.
   */
  it("writes the week as a real Date cell, so a pivot can group by it", () => {
    const breakdown = xlsxSheets(ROWS).find((s) => s.sheet === "Breakdown")!
    const [, first] = breakdown.data
    expect(first[1]).toMatchObject({ type: Date, format: "yyyy-mm-dd" })
    expect((first[1] as { value: Date }).value.toISOString()).toBe(
      "2026-07-13T00:00:00.000Z"
    )
  })

  /*
   * 8h 11m 42s (29_502_000 ms) is 8.195 hours unfloored but 8.19 floored — the
   * two diverge exactly when a bare `ms / HOUR` division and `centiHours()`
   * round different ways. `format: "0.00"` only makes Excel ROUND the cell for
   * display; the underlying `value` an unfloored `hours()` would write is
   * 8.195, which Excel shows as 8.20. The same entry then reads 8.20 in this
   * workbook and 8.19 in the CSV exported from identical data — two documents
   * in one email that disagree, which is the failure this export pipeline
   * exists to prevent.
   */
  it("floors the hours it writes, so the workbook never shows more time than the CSV for the same entry", () => {
    const floored = {
      ...ROWS,
      titles: [{ ...ROWS.titles[0], totalMs: 29_502_000, centiHours: 819 }],
    }
    const breakdown = xlsxSheets(floored).find((s) => s.sheet === "Breakdown")!
    const [, first] = breakdown.data
    expect((first[4] as { value: number }).value).toBe(8.19)
  })

  it("writes amounts as currency-formatted numbers, not strings", () => {
    const breakdown = xlsxSheets(ROWS).find((s) => s.sheet === "Breakdown")!
    const [, first] = breakdown.data
    expect(first[6]).toEqual({ value: 30, type: Number, format: '#,##0.00" "USD' })
  })

  it("writes days as real dates, so a pivot can group them by week", () => {
    const byDay = xlsxSheets(ROWS).find((s) => s.sheet === "By day")!
    const [, first] = byDay.data
    expect(first[0]).toMatchObject({ type: Date, format: "yyyy-mm-dd" })
    expect((first[0] as { value: Date }).value.toISOString()).toBe(
      "2026-07-13T00:00:00.000Z"
    )
  })

  it("leaves an unpriced amount empty rather than writing a zero a pivot would sum", () => {
    const unpriced = {
      ...ROWS,
      totals: { ...ROWS.totals, unratedBillableMs: 1 },
      titles: [{ ...ROWS.titles[0], billableCents: 0, unpriced: true }],
    }
    const breakdown = xlsxSheets(unpriced).find((s) => s.sheet === "Breakdown")!
    expect(breakdown.data[1][6]).toBeNull()
    // The TOTAL row has its own unpriced branch — money(rows.totals.billableCents,
    // currency, rows.totals.unratedBillableMs > 0) — separate from the body row's,
    // and asserting only the body row above left this one able to regress to `0`
    // unseen.
    const total = breakdown.data.at(-1)!
    expect(total[6]).toBeNull()
  })

  /*
   * `to-csv.ts` writes `rows.totals.totalMs === 0 ? 0 : 100` for this cell, for
   * exactly this reason: a range with nothing in it has nothing to be 100% of.
   * A hardcoded 100 here would export 100% in the workbook and 0% in the CSV
   * from identical data.
   */
  it("writes the TOTAL row's percent as 0 for an empty range, matching the CSV's 0-not-100", () => {
    const empty = {
      ...ROWS,
      totals: { ...ROWS.totals, totalMs: 0 },
      titles: [],
    }
    const breakdown = xlsxSheets(empty).find((s) => s.sheet === "Breakdown")!
    const total = breakdown.data.at(-1)!
    expect(total[5]).toEqual({ value: 0, type: Number, format: "0.00" })
  })

  it("leaves the TOTAL row's Week cell blank — it is not any one week", () => {
    const breakdown = xlsxSheets(ROWS).find((s) => s.sheet === "Breakdown")!
    const total = breakdown.data.at(-1)!
    expect(total[1]).toBeNull()
  })

  it("says out loud when the description list was capped", () => {
    const capped = { ...ROWS, titlesTruncated: true }
    const summary = xlsxSheets(capped).find((s) => s.sheet === "Summary")!
    const flat = summary.data
      .flat()
      .map((cell) => (cell as { value?: unknown } | null)?.value)
    expect(flat).toContain(
      "Only the 500 longest descriptions are listed. Narrow the range for a complete breakdown."
    )
  })
})
