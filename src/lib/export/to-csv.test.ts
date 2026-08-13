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
      unpriced: false,
      averageDailyMs: HOUR,
      count: 1,
      truncated: false,
      percent: 100,
    },
    buckets: [],
    projects: [],
    titles,
    // Not exercised by these tests — `toCsv` reads the flat `titles` list
    // plus each row's own `weekStart`, never the grouped shape (see
    // report-rows.ts). Left empty rather than derived, so a bug in the
    // grouping logic cannot mask a bug here by accident.
    weeks: [],
    titlesTruncated: false,
    notesTruncated: false,
  }
}

const ONE: ReportRows["titles"] = [
  {
    project: "Acme",
    description: "Standup",
    weekStart: "2026-07-13",
    notes: [],
    totalMs: HOUR,
    percent: 100,
    billableCents: 1_000,
    unpriced: false,
  },
]

describe("toCsv", () => {
  it("leads with a header row and nothing else — a preamble is not a CSV", () => {
    const [header] = toCsv(rowsOf(ONE)).split("\r\n")
    expect(header).toBe(
      "Project,Week,Description,Duration,Decimal hours,Percent,Amount,Currency"
    )
  })

  it("writes both duration forms, so the reader need not convert either", () => {
    expect(toCsv(rowsOf(ONE)).split("\r\n")[1]).toBe(
      "Acme,2026-07-13,Standup,1:00:00,1.00,100,10.00,USD"
    )
  })

  // The whole reason the column exists: grouping or pivoting a flat export by
  // week needs a plain value to key on, and this is the DayString the backend
  // already attributed the row to — not re-derived on the client.
  it("writes the week as the plain DayString its rows were attributed to", () => {
    const csv = toCsv(rowsOf([{ ...ONE[0], weekStart: "2026-08-10" }]))
    expect(csv.split("\r\n")[1]).toBe("Acme,2026-08-10,Standup,1:00:00,1.00,100,10.00,USD")
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
          weekStart: "2026-07-13",
          notes: [],
          totalMs: HOUR,
          percent: 100,
          billableCents: 1_000,
          unpriced: false,
        },
      ])
    )

    expect(csv.split("\r\n")[1]).toBe(
      'Acme,2026-07-13,"Fixing ""toggle"" bleeding across Maintenance, Log\nEntries",1:00:00,1.00,100,10.00,USD'
    )
  })

  it("ends with a TOTAL record, so a truncated paste is visibly incomplete", () => {
    const lines = toCsv(rowsOf(ONE)).split("\r\n")
    // Week is blank on TOTAL, matching Description — the row spans every
    // week in the export, and it is not any one of them.
    expect(lines.at(-1)).toBe("TOTAL,,,1:00:00,1.00,100,10.00,USD")
  })

  it("writes an amount of nothing for an unpriced row rather than 0.00", () => {
    const csv = toCsv(
      rowsOf([{ ...ONE[0], billableCents: 0, unpriced: true }])
    )
    // Empty, not "0.00". Zero is a real rate somebody chose; unpriced is a
    // question nobody has answered, and the two must not share a cell value.
    expect(csv.split("\r\n")[1]).toBe("Acme,2026-07-13,Standup,1:00:00,1.00,100,,USD")
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
    expect(csv.split("\r\n").at(-1)).toBe("TOTAL,,,1:00:00,1.00,100,0.00,USD")
  })

  /*
   * IMPORTANT 4: the PDF and XLSX both state the truncation and unpriced
   * notes (report-doc.ts, to-xlsx.ts); this file previously stated neither,
   * so a capped CSV ended on a TOTAL exceeding the sum of its own rows with
   * nothing on the page to explain the gap. Trailing, not a leading
   * preamble — see the comment in to-csv.ts for why that distinction is
   * what keeps the file's own "no preamble" rule intact.
   */
  it("appends the truncation note as a trailing record, after TOTAL", () => {
    const lines = toCsv({ ...rowsOf(ONE), titlesTruncated: true }).split("\r\n")
    expect(lines.at(-2)).toBe("TOTAL,,,1:00:00,1.00,100,10.00,USD")
    expect(lines.at(-1)).toContain("Only the 500 highest-duration rows")
  })

  it("appends the unpriced note as a trailing record, after TOTAL", () => {
    const rows = rowsOf(ONE)
    const csv = toCsv({ ...rows, totals: { ...rows.totals, unpriced: true } })
    const lines = csv.split("\r\n")
    expect(lines.at(-2)).toBe("TOTAL,,,1:00:00,1.00,100,,USD")
    expect(lines.at(-1)).toBe(
      "Some billable time has no hourly rate and is not in the amount above."
    )
  })

  it("appends both notes when both apply, truncation first", () => {
    const rows = rowsOf(ONE)
    const csv = toCsv({
      ...rows,
      totals: { ...rows.totals, unpriced: true },
      titlesTruncated: true,
      notesTruncated: true,
    })
    const lines = csv.split("\r\n")
    // header, one body row, TOTAL, two trailing notes.
    expect(lines).toHaveLength(5)
    expect(lines.at(-2)).toContain("Only the 500 highest-duration rows")
    expect(lines.at(-1)).toBe(
      "Some billable time has no hourly rate and is not in the amount above."
    )
  })

  it("appends neither note when neither applies", () => {
    const lines = toCsv(rowsOf(ONE)).split("\r\n")
    expect(lines.at(-1)).toBe("TOTAL,,,1:00:00,1.00,100,10.00,USD")
  })
})
