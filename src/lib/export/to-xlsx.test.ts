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
      totalMs: 3 * HOUR,
      centiHours: 300,
      percent: 100,
      billableCents: 3_000,
      unpriced: false,
    },
  ],
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
    expect(first[3]).toEqual({ value: 3, type: Number, format: "0.00" })
  })

  it("writes amounts as currency-formatted numbers, not strings", () => {
    const breakdown = xlsxSheets(ROWS).find((s) => s.sheet === "Breakdown")!
    const [, first] = breakdown.data
    expect(first[5]).toEqual({ value: 30, type: Number, format: '#,##0.00" "USD' })
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
      titles: [{ ...ROWS.titles[0], billableCents: 0, unpriced: true }],
    }
    const breakdown = xlsxSheets(unpriced).find((s) => s.sheet === "Breakdown")!
    expect(breakdown.data[1][5]).toBeNull()
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
