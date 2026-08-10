import { parseDayString } from "@shared/day"
import { centiHours, formatClock } from "@shared/duration"
import { TITLE_CAP_NOTE, UNPRICED_NOTE } from "./report-rows"
import type { ReportRows } from "./report-rows"
// The package has no default "." export — only "/node", "/browser",
// "/universal", "/utility" subpaths (see its package.json `exports`). This
// runs in the browser, so `/browser` is the correct subpath for both the
// types here and the dynamic import in `xlsxBlob` below.
import type { SheetData } from "write-excel-file/browser"

/**
 * The report as a workbook.
 *
 * Split in two on purpose: `xlsxSheets` is a pure function producing the cell
 * model, and `xlsxBlob` is a four-line wrapper that hands it to the library.
 * Everything worth getting wrong — which cells are numbers, which are dates,
 * what an unpriced amount looks like — is therefore testable without unzipping
 * a binary in a unit test.
 *
 * NOT SheetJS. npm's `xlsx` is stuck at 0.18.5, abandoned there since 2023 with
 * known prototype-pollution and ReDoS advisories; SheetJS publishes to its own
 * CDN now, which is not a dependency this project should take on for a download
 * button.
 */

const BOLD = { fontWeight: "bold" } as const

/**
 * A duration in HOURS, as a number a spreadsheet can sum.
 *
 * Floored through `centiHours`, not `ms / 3_600_000`. `format: "0.00"` only
 * makes Excel ROUND the raw value for display — it does not floor it — so an
 * unfloored value here can render as MORE time than was recorded. 8h 11m 42s
 * is 8.195 unfloored, which Excel shows as 8.20, while the CSV exported from
 * the same entry prints 8.19: two documents in the same email disagreeing
 * about the same duration.
 */
function hours(ms: number) {
  return { value: centiHours(ms) / 100, type: Number, format: "0.00" } as const
}

/**
 * Money as a number, or an empty cell.
 *
 * `null` rather than `0` for unpriced work, for the reason the CSV states: a
 * pivot table sums a zero and reports a confident wrong total, where it skips
 * a blank.
 */
function money(cents: number, currency: string, unpriced: boolean) {
  if (unpriced) return null
  return { value: cents / 100, type: Number, format: `#,##0.00" "${currency}` } as const
}

/**
 * A `DayString` as a real date cell at UTC midnight.
 *
 * UTC, not local: the calendar date was already decided server-side by
 * convex/lib/day.ts under the user's stored zone, and re-interpreting it in the
 * browser's zone is how a Monday becomes the previous Sunday in a pivot.
 */
function date(day: string) {
  const { year, month, day: d } = parseDayString(day)
  return {
    value: new Date(Date.UTC(year, month - 1, d)),
    type: Date,
    format: "yyyy-mm-dd",
  } as const
}

function text(value: string, bold = false) {
  return { value, type: String, ...(bold ? BOLD : {}) } as const
}

function summarySheet(rows: ReportRows): SheetData {
  const { meta, totals } = rows
  const data: SheetData = [
    [text("Summary report", true)],
    [text("From"), text(meta.from)],
    [text("To"), text(meta.to)],
    [],
    [text("Total hours", true), hours(totals.totalMs)],
    [text("Billable hours", true), hours(totals.billableMs)],
    [text("Billable %", true), { value: totals.billablePercent, type: Number, format: "0.00" }],
    [
      text("Amount", true),
      money(totals.billableCents, meta.currency, totals.unpriced),
    ],
    [text("Average daily hours", true), hours(totals.averageDailyMs)],
    [text("Days worked", true), { value: meta.daysWorked, type: Number }],
    [text("Entries", true), { value: totals.count, type: Number }],
    [],
    [text("Project", true), text("Hours", true), text("%", true), text("Amount", true)],
    ...rows.projects.map((project) => [
      text(project.name),
      hours(project.totalMs),
      { value: project.percent, type: Number, format: "0.00" } as const,
      money(project.billableCents, meta.currency, project.unratedBillableMs > 0),
    ]),
  ]

  if (totals.unpriced) {
    data.push([], [text("Note"), text(UNPRICED_NOTE)])
  }
  if (rows.titlesTruncated) {
    data.push([], [text("Note"), text(TITLE_CAP_NOTE)])
  }
  return data
}

function byDaySheet(rows: ReportRows): SheetData {
  return [
    [
      text("Date", true),
      text("Hours", true),
      text("Billable hours", true),
      text("Entries", true),
    ],
    ...rows.buckets.map((bucket) => [
      date(bucket.key),
      hours(bucket.totalMs),
      hours(bucket.billableMs),
      { value: bucket.count, type: Number } as const,
    ]),
  ]
}

function breakdownSheet(rows: ReportRows): SheetData {
  const { currency } = rows.meta
  return [
    [
      text("Project", true),
      text("Week", true),
      text("Description", true),
      text("Duration", true),
      text("Hours", true),
      text("%", true),
      text("Amount", true),
    ],
    ...rows.titles.map((row) => [
      text(row.project),
      // A real Date cell, not text — the same rule `date()` already applies
      // to the By-day sheet, and for the same reason: it is a value a pivot
      // can group by, not a string a formula has to re-parse first.
      date(row.weekStart),
      text(row.description),
      // The clock form stays as text beside the numeric one: it is what the
      // reference report prints, and a reader reconciling against that PDF
      // needs the same string to compare against.
      text(formatClock(row.totalMs)),
      hours(row.totalMs),
      { value: row.percent, type: Number, format: "0.00" } as const,
      money(row.billableCents, currency, row.unpriced),
    ]),
    [
      text("TOTAL", true),
      null, // no single week, matching Description's own null below
      null,
      text(formatClock(rows.totals.totalMs), true),
      hours(rows.totals.totalMs),
      {
        value: rows.totals.totalMs === 0 ? 0 : 100,
        type: Number,
        format: "0.00",
      } as const,
      money(rows.totals.billableCents, currency, rows.totals.unpriced),
    ],
  ]
}

export function xlsxSheets(rows: ReportRows): Array<{ sheet: string; data: SheetData }> {
  return [
    { sheet: "Summary", data: summarySheet(rows) },
    { sheet: "By day", data: byDaySheet(rows) },
    { sheet: "Breakdown", data: breakdownSheet(rows) },
  ]
}

export async function xlsxBlob(rows: ReportRows): Promise<Blob> {
  // Dynamic, so the library never reaches the main bundle. A user who does not
  // export pays nothing for the button.
  const { default: writeXlsxFile } = await import("write-excel-file/browser")
  return await writeXlsxFile(xlsxSheets(rows)).toBlob()
}
