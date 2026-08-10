import { describe, expect, it } from "vitest"
import { toCsv } from "./to-csv"
import { xlsxSheets } from "./to-xlsx"
import { COL, reportPages } from "./pdf/report-doc"
import { PAPER, TYPE } from "./pdf/paper"
import type { PdfOp } from "./pdf/ops"
import type { ReportRows } from "./report-rows"

const HOUR = 3_600_000

/**
 * IMPORTANT 1 — the three writers must agree on whether the grand-total
 * Amount is a real figure or a floor, because they are handed to the same
 * client in the same email. `unpriced` is computed here exactly the way
 * `reportRows` now computes it (see report-rows.ts): ANY unrated billable
 * time makes the figure a floor, never "ALL of it" — a range with zero
 * billable time at all (`unratedBillableMs: 0`) is a real zero, not a floor.
 */
function totalsFor(over: {
  billableMs: number
  billableCents: number
  unratedBillableMs: number
}): ReportRows["totals"] {
  return {
    totalMs: HOUR,
    billableMs: over.billableMs,
    billablePercent: 100,
    billableCents: over.billableCents,
    unratedBillableMs: over.unratedBillableMs,
    averageDailyMs: HOUR,
    count: 1,
    truncated: false,
    unpriced: over.unratedBillableMs > 0,
  }
}

function rowsWithTotals(totals: ReportRows["totals"]): ReportRows {
  const titles: ReportRows["titles"] = [
    {
      project: "Acme",
      description: "Standup",
      weekStart: "2026-07-13",
      totalMs: totals.totalMs,
      centiHours: 100,
      percent: 100,
      billableCents: totals.billableCents,
      unpriced: totals.unpriced,
    },
  ]
  return {
    meta: { from: "2026-07-13", to: "2026-07-13", currency: "USD", daysWorked: 1, granularity: "day" },
    totals,
    buckets: [],
    projects: [],
    titles,
    weeks: [
      {
        weekStart: "2026-07-13",
        label: "13 Jul 2026",
        rows: titles,
        subtotal: {
          totalMs: totals.totalMs,
          centiHours: 100,
          percent: 100,
          billableCents: totals.billableCents,
          unpriced: totals.unpriced,
        },
      },
    ],
    titlesTruncated: false,
  }
}

/** The PDF's grand-TOTAL row's Amount cell, as printed text. */
function pdfTotalAmount(rows: ReportRows): string | undefined {
  const pages = reportPages(rows)
  const last = pages.at(-1)!
  const op = last.ops.find(
    (o): o is Extract<PdfOp, { kind: "text" }> =>
      o.kind === "text" && o.x === COL.amount && o.size === TYPE.strong && o.align === "right"
  )
  return op?.text
}

/** The PDF's summary-tile Amount value (the third of the four tile values). */
function pdfTileAmount(rows: ReportRows): string | undefined {
  const [first] = reportPages(rows)
  const values = first.ops.filter(
    (o): o is Extract<PdfOp, { kind: "text" }> => o.kind === "text" && o.size === TYPE.tileValue
  )
  return values[2]?.text
}

function csvTotalAmount(rows: ReportRows): string {
  // Not `lines.at(-1)` — IMPORTANT 4 appends note records AFTER TOTAL, so
  // the TOTAL line itself must be found by its own leading field.
  const totalLine = toCsv(rows)
    .split("\r\n")
    .find((line) => line.startsWith("TOTAL,"))!
  return totalLine.split(",").at(-2)! // Amount is second-to-last, before Currency
}

function xlsxTotalAmount(rows: ReportRows): unknown {
  const breakdown = xlsxSheets(rows).find((s) => s.sheet === "Breakdown")!
  const total = breakdown.data.at(-1)!
  return (total[6] as { value: number } | null)?.value ?? null
}

describe("the three writers agree on the grand-total Amount", () => {
  it("shows a real zero for a range with no billable time at all — 0 is a real amount, not a floor", () => {
    const rows = rowsWithTotals(totalsFor({ billableMs: 0, billableCents: 0, unratedBillableMs: 0 }))

    expect(pdfTotalAmount(rows)).not.toBe("—")
    expect(pdfTileAmount(rows)).not.toBe("—")
    expect(csvTotalAmount(rows)).toBe("0.00")
    expect(xlsxTotalAmount(rows)).toBe(0)
  })

  it("blanks the amount when ALL billable time is unpriced", () => {
    const rows = rowsWithTotals(
      totalsFor({ billableMs: HOUR, billableCents: 0, unratedBillableMs: HOUR })
    )

    expect(pdfTotalAmount(rows)).toBe("—")
    expect(pdfTileAmount(rows)).toBe("—")
    expect(csvTotalAmount(rows)).toBe("")
    expect(xlsxTotalAmount(rows)).toBeNull()
  })

  it("blanks the amount when only SOME billable time is unpriced — the figure would understate", () => {
    const rows = rowsWithTotals(
      totalsFor({ billableMs: 2 * HOUR, billableCents: 500, unratedBillableMs: HOUR })
    )

    expect(pdfTotalAmount(rows)).toBe("—")
    expect(pdfTileAmount(rows)).toBe("—")
    expect(csvTotalAmount(rows)).toBe("")
    expect(xlsxTotalAmount(rows)).toBeNull()
  })

  it("shows the real amount when everything billable is priced", () => {
    const rows = rowsWithTotals(
      totalsFor({ billableMs: HOUR, billableCents: 1_000, unratedBillableMs: 0 })
    )

    expect(pdfTotalAmount(rows)).not.toBe("—")
    expect(pdfTileAmount(rows)).not.toBe("—")
    expect(csvTotalAmount(rows)).toBe("10.00")
    expect(xlsxTotalAmount(rows)).toBe(10)
  })

  it("never colours a dashed TOTAL amount as currency — brass is for real amounts only", () => {
    const rows = rowsWithTotals(
      totalsFor({ billableMs: HOUR, billableCents: 0, unratedBillableMs: HOUR })
    )
    const pages = reportPages(rows)
    const op = pages
      .at(-1)!
      .ops.find(
        (o): o is Extract<PdfOp, { kind: "text" }> =>
          o.kind === "text" && o.x === COL.amount && o.size === TYPE.strong && o.align === "right"
      )
    expect(op?.color).not.toEqual(PAPER.brass)
  })
})

/*
 * Extends to-xlsx.test.ts's own "writes the TOTAL row's percent as 0 for an
 * empty range" test to all three writers — that test already covers XLSX;
 * the PDF hardcoded "100%" unconditionally (report-doc.ts) and would have
 * disagreed with both CSV and XLSX for an empty range.
 */
describe("the three writers agree on the grand-total Percent for an empty range", () => {
  it("all print 0%, not 100%, when there is no duration for 100% to be a share of", () => {
    const totals = totalsFor({ billableMs: 0, billableCents: 0, unratedBillableMs: 0 })
    const empty: ReportRows = {
      meta: { from: "2026-07-13", to: "2026-07-13", currency: "USD", daysWorked: 0, granularity: "day" },
      totals: { ...totals, totalMs: 0, count: 0 },
      buckets: [],
      projects: [],
      titles: [],
      weeks: [],
      titlesTruncated: false,
    }

    expect(toCsv(empty).split("\r\n").at(-1)!.split(",")[5]).toBe("0")

    const breakdown = xlsxSheets(empty).find((s) => s.sheet === "Breakdown")!
    expect(breakdown.data.at(-1)![5]).toMatchObject({ value: 0 })

    // No titles means no breakdown page is emitted (see reportPages) — put
    // one nominal row in so the TOTAL row itself is drawn.
    const withRow = rowsWithTotals({ ...totals, totalMs: 0, count: 0 })
    const pages = reportPages(withRow)
    const percentOp = pages
      .at(-1)!
      .ops.find(
        (o): o is Extract<PdfOp, { kind: "text" }> =>
          o.kind === "text" && o.x === COL.percent && o.size === TYPE.strong && o.align === "right"
      )
    expect(percentOp?.text).toBe("0%")
  })
})
