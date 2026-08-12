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
    averageDailyMs: HOUR,
    count: 1,
    truncated: false,
    unpriced: over.unratedBillableMs > 0,
    // Every case in this fixture keeps `totalMs: HOUR` above, so the TOTAL
    // row's own share of itself is always the non-empty answer.
    percent: 100,
  }
}

function rowsWithTotals(totals: ReportRows["totals"]): ReportRows {
  const titles: ReportRows["titles"] = [
    {
      project: "Acme",
      description: "Standup",
      weekStart: "2026-07-13",
      totalMs: totals.totalMs,
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

/** The PDF's grand-TOTAL row's Percent cell, as printed text. */
/*
 * THE PDF NO LONGER PRINTS A PERCENT COLUMN, so there is no third reading to
 * compare — see `COL` in report-doc.ts for why the column was cut (its 60pt
 * went to DESCRIPTION, which was wrapping ticket titles into ~145pt).
 *
 * What survives here is the CSV/XLSX pair, and the distinctive fixture below is
 * still the point: a writer that re-derives the percent from `totalMs` instead
 * of reading the shared field cannot produce 42.
 *
 * What is NO LONGER GUARDED is the PDF against the other two. That is the exact
 * shape of the defect this file was created for — three writers disagreeing
 * about one number — so it is worth being plain that the risk did not go away,
 * it went out of scope: the PDF cannot disagree about a figure it does not
 * print. If the column ever returns, this helper returns with it.
 */
function pdfPrintsNoPercentColumn(rows: ReportRows): boolean {
  return !("percent" in COL)
    && reportPages(rows).every((page) =>
      page.ops.every((o) => o.kind !== "text" || !o.text.endsWith("%"))
    )
}

function csvTotalPercent(rows: ReportRows): string {
  const totalLine = toCsv(rows)
    .split("\r\n")
    .find((line) => line.startsWith("TOTAL,"))!
  return totalLine.split(",")[5] // Percent is the sixth field
}

function xlsxTotalPercent(rows: ReportRows): unknown {
  const breakdown = xlsxSheets(rows).find((s) => s.sheet === "Breakdown")!
  const total = breakdown.data.at(-1)!
  return (total[5] as { value: number } | null)?.value ?? null
}

/*
 * All three writers must read `rows.totals.percent` — the ONE derivation
 * `report-rows.ts` now computes (see `percentOf(totalMs, totalMs)` there) —
 * rather than each re-deriving `totalMs === 0 ? 0 : 100` on its own. A
 * fixture with a deliberately distinctive `percent` (42, unreachable by any
 * totalMs-based rule a writer might reinvent) is what proves a writer is
 * actually reading the shared field rather than happening to compute the
 * same answer by coincidence.
 */
describe("the three writers agree on the grand-total Percent", () => {
  it("all print totals.percent verbatim, not a re-derived totalMs-based rule", () => {
    const totals = totalsFor({ billableMs: HOUR, billableCents: 1_000, unratedBillableMs: 0 })
    const rows = rowsWithTotals({ ...totals, percent: 42 })

    expect(csvTotalPercent(rows)).toBe("42")
    expect(xlsxTotalPercent(rows)).toBe(42)
    // And the PDF prints no percent at all — asserted rather than assumed, so
    // that reintroducing the column without restoring its agreement check
    // fails here rather than shipping a third, unguarded reading.
    expect(pdfPrintsNoPercentColumn(rows)).toBe(true)
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
      totals: { ...totals, totalMs: 0, count: 0, percent: 0 },
      buckets: [],
      projects: [],
      titles: [],
      weeks: [],
      titlesTruncated: false,
    }

    expect(toCsv(empty).split("\r\n").at(-1)!.split(",")[5]).toBe("0")

    const breakdown = xlsxSheets(empty).find((s) => s.sheet === "Breakdown")!
    expect(breakdown.data.at(-1)![5]).toMatchObject({ value: 0 })

    // The PDF's own reading of this is gone with its percent column. The
    // hazard it guarded — a hardcoded "100%" that disagreed with both other
    // writers on an empty range — is unreachable now for the same reason, and
    // `report-doc.ts`'s TOTAL row carries a note so the literal does not come
    // back if the column does.
    const withRow = rowsWithTotals({ ...totals, totalMs: 0, count: 0, percent: 0 })
    expect(pdfPrintsNoPercentColumn(withRow)).toBe(true)
  })
})
