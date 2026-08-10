import { describe, expect, it } from "vitest"
import { reportPages } from "./report-doc"
import type { ReportRows } from "../report-rows"

const HOUR = 3_600_000

function rowsWith(titleCount: number, over: Partial<ReportRows> = {}): ReportRows {
  return {
    meta: {
      from: "2026-07-13",
      to: "2026-07-25",
      currency: "USD",
      daysWorked: 11,
      granularity: "day",
    },
    totals: {
      totalMs: 355_680_000,
      billableMs: 355_680_000,
      billablePercent: 100,
      billableCents: 98_800,
      unratedBillableMs: 0,
      averageDailyMs: 32_334_545,
      count: titleCount,
      truncated: false,
    },
    buckets: [
      {
        key: "2026-07-13",
        label: "Mon 13",
        title: "Mon, 13 Jul 2026",
        totalMs: 5 * HOUR,
        billableMs: 5 * HOUR,
        nonBillableMs: 0,
        billableCents: 5_000,
        earnedCents: 5_000,
        count: 1,
        empty: false,
      },
    ],
    projects: [
      {
        name: "Vessel Vanguard",
        color: "amber",
        totalMs: 355_680_000,
        percent: 100,
        billableCents: 98_800,
        unratedBillableMs: 0,
      },
    ],
    titles: Array.from({ length: titleCount }, (_, n) => ({
      project: "Vessel Vanguard",
      description: `CB-${n} Fixing something`,
      totalMs: HOUR,
      centiHours: 100,
      percent: 1,
      billableCents: 1_000,
      unpriced: false,
    })),
    titlesTruncated: false,
    ...over,
  }
}

/** Every string drawn on a page, for assertions that do not care about layout. */
function textOf(page: { ops: Array<{ kind: string }> }): Array<string> {
  return page.ops
    .filter((op): op is { kind: "text"; text: string } => op.kind === "text")
    .map((op) => op.text)
}

describe("reportPages", () => {
  it("leads with the range, as the reference report does", () => {
    const [first] = reportPages(rowsWith(1))
    expect(textOf(first)).toContain("Summary report from 07/13/2026 to 07/25/2026")
  })

  it("puts the four summary tiles on the first page", () => {
    const [first] = reportPages(rowsWith(1))
    const strings = textOf(first)
    for (const label of [
      "Total Hours",
      "Billable Hours",
      "Amount",
      "Average Daily Hours",
    ]) {
      expect(strings).toContain(label)
    }
  })

  it("labels the average's divisor rather than leaving the reader to guess it", () => {
    const [first] = reportPages(rowsWith(1))
    expect(textOf(first)).toContain("over 11 days worked")
  })

  it("draws both chart blocks on the first page", () => {
    const [first] = reportPages(rowsWith(1))
    const strings = textOf(first)
    expect(strings).toContain("Duration by day")
    expect(strings).toContain("Project distribution")
  })

  it("flows a long breakdown onto further pages", () => {
    const pages = reportPages(rowsWith(120))
    expect(pages.length).toBeGreaterThan(2)
  })

  /*
   * The property that makes the table readable when it spans four pages, which
   * the reference report does. A continuation page whose columns are unlabelled
   * is a page of unattributed numbers.
   */
  it("repeats the column header on every breakdown page", () => {
    const pages = reportPages(rowsWith(120))
    const breakdownPages = pages.filter((page) =>
      textOf(page).includes("Project and description breakdown")
    )
    expect(breakdownPages.length).toBeGreaterThan(1)
    for (const page of breakdownPages) {
      expect(textOf(page)).toContain("DESCRIPTION")
      expect(textOf(page)).toContain("DURATION")
    }
  })

  it("ends with a TOTAL row on the last page and nowhere else", () => {
    const pages = reportPages(rowsWith(120))
    const withTotal = pages.filter((page) => textOf(page).includes("TOTAL"))
    expect(withTotal).toHaveLength(1)
    expect(withTotal[0]).toBe(pages.at(-1))
  })

  it("numbers every page as N / M, with M the real count", () => {
    const pages = reportPages(rowsWith(120))
    pages.forEach((page, index) => {
      expect(textOf(page)).toContain(`Page ${index + 1} / ${pages.length}`)
    })
  })

  it("carries the capped-list sentence onto the document, not just the screen", () => {
    const pages = reportPages(rowsWith(3, { titlesTruncated: true }))
    expect(pages.flatMap(textOf)).toContain(
      "Only the 500 longest descriptions are listed. Narrow the range for a complete breakdown."
    )
  })

  it("qualifies the amount when some billable time was never priced", () => {
    const pages = reportPages(
      rowsWith(3, {
        totals: { ...rowsWith(3).totals, unratedBillableMs: HOUR },
      })
    )
    expect(pages.flatMap(textOf)).toContain(
      "Some billable time has no hourly rate and is not in the amount above."
    )
  })

  it("produces one page for an empty range rather than none", () => {
    const empty = rowsWith(0, {
      buckets: [],
      projects: [],
      totals: { ...rowsWith(0).totals, totalMs: 0, billableMs: 0, count: 0 },
    })
    expect(reportPages(empty)).toHaveLength(1)
  })
})
