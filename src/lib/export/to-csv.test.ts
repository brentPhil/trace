import { describe, expect, it } from "vitest"
import { toCsv } from "./to-csv"
import type { ReportRows } from "./report-rows"

const HOUR = 3_600_000

function rowsOf(titles: ReportRows["titles"]): ReportRows {
  return {
    meta: {
      from: "2026-07-13",
      to: "2026-07-25",
      currency: "USD",
      daysWorked: 1,
      granularity: "day",
    },
    totals: {
      totalMs: HOUR,
      billableMs: HOUR,
      billablePercent: 100,
      billableCents: 1_000,
      unratedBillableMs: 0,
      averageDailyMs: HOUR,
      count: 1,
      truncated: false,
    },
    buckets: [],
    projects: [],
    titles,
    titlesTruncated: false,
  }
}

const ONE: ReportRows["titles"] = [
  {
    project: "Acme",
    description: "Standup",
    totalMs: HOUR,
    centiHours: 100,
    percent: 100,
    billableCents: 1_000,
    unpriced: false,
  },
]

describe("toCsv", () => {
  it("leads with a header row and nothing else — a preamble is not a CSV", () => {
    const [header] = toCsv(rowsOf(ONE)).split("\r\n")
    expect(header).toBe(
      "Project,Description,Duration,Decimal hours,Percent,Amount,Currency"
    )
  })

  it("writes both duration forms, so the reader need not convert either", () => {
    expect(toCsv(rowsOf(ONE)).split("\r\n")[1]).toBe(
      "Acme,Standup,1:00:00,1.00,100,10.00,USD"
    )
  })

  it("separates records with CRLF, per RFC 4180", () => {
    expect(toCsv(rowsOf(ONE))).toContain("\r\n")
  })

  /*
   * Real entry titles contain all three. A title is free text the user typed
   * while working, and "Fixing view - toggle bleeding across Maintenance, Log
   * Entries, and vessels" is taken verbatim from the reference report.
   */
  it("quotes and doubles the three characters that break a CSV", () => {
    const csv = toCsv(
      rowsOf([
        {
          project: "Acme",
          description: 'Fixing "toggle" bleeding across Maintenance, Log\nEntries',
          totalMs: HOUR,
          centiHours: 100,
          percent: 100,
          billableCents: 1_000,
          unpriced: false,
        },
      ])
    )

    expect(csv.split("\r\n")[1]).toBe(
      'Acme,"Fixing ""toggle"" bleeding across Maintenance, Log\nEntries",1:00:00,1.00,100,10.00,USD'
    )
  })

  it("ends with a TOTAL record, so a truncated paste is visibly incomplete", () => {
    const lines = toCsv(rowsOf(ONE)).split("\r\n")
    expect(lines.at(-1)).toBe("TOTAL,,1:00:00,1.00,100,10.00,USD")
  })

  it("writes an amount of nothing for an unpriced row rather than 0.00", () => {
    const csv = toCsv(
      rowsOf([{ ...ONE[0], billableCents: 0, unpriced: true }])
    )
    // Empty, not "0.00". Zero is a real rate somebody chose; unpriced is a
    // question nobody has answered, and the two must not share a cell value.
    expect(csv.split("\r\n")[1]).toBe("Acme,Standup,1:00:00,1.00,100,,USD")
  })

  it("agrees with its own body rows even when the range is entirely non-billable", () => {
    // billablePercent is the share that's billable, which is legitimately 0
    // for a range that holds hours but no billable work. The Percent column
    // measures share of *duration*, not billability, so gating TOTAL's
    // Percent on billablePercent prints 0 beneath rows that sum to 100 — a
    // CSV that visibly contradicts itself.
    const rows = rowsOf(ONE)
    const csv = toCsv({
      ...rows,
      totals: {
        ...rows.totals,
        billableMs: 0,
        billablePercent: 0,
        billableCents: 0,
      },
    })
    expect(csv.split("\r\n").at(-1)).toBe("TOTAL,,1:00:00,1.00,100,0.00,USD")
  })
})
