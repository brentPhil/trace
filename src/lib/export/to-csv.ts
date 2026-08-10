import { formatClock, formatDecimalHours } from "@shared/duration"
import { TITLE_CAP_NOTE, UNPRICED_NOTE } from "./report-rows"
import type { ReportRows } from "./report-rows"

/**
 * The breakdown table, and only it.
 *
 * A CSV exists to be pasted into something else. Reproducing the PDF's four
 * blocks here — tiles, a chart's worth of daily rows, a donut's ranking — would
 * produce a file with four different row shapes in it, which no spreadsheet can
 * read as a table and no script can parse without a state machine. The other
 * blocks are what XLSX has sheets for.
 *
 * No preamble either. A "Summary report from … to …" line above the header is
 * the single most common reason a CSV opens with everything in column A.
 */

/** RFC 4180: quote only when we must, and double an embedded quote. */
function cell(value: string): string {
  return /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function record(values: ReadonlyArray<string>): string {
  return values.map(cell).join(",")
}

/**
 * An amount, or nothing at all.
 *
 * `0.00` and "nobody has set a rate for this" are different claims, and
 * `billableCents: 0` alone cannot tell them apart — which is the same
 * distinction `unratedBillableMs` exists to carry on /reports. An empty cell is
 * the honest rendering of the second; a spreadsheet sums it as zero either way,
 * but a human reading the column can see which rows were never priced.
 */
function amount(cents: number, unpriced: boolean): string {
  return unpriced ? "" : (cents / 100).toFixed(2)
}

const HEADER = [
  "Project",
  "Week",
  "Description",
  "Duration",
  "Decimal hours",
  "Percent",
  "Amount",
  "Currency",
]

export function toCsv(rows: ReportRows): string {
  const { currency } = rows.meta

  const body = rows.titles.map((row) =>
    record([
      row.project,
      // The plain DayString the backend attributed the row to (see
      // convex/entries.ts) — not a formatted span like the PDF's week
      // headings, so a spreadsheet can sort or pivot on it directly.
      row.weekStart,
      row.description,
      formatClock(row.totalMs),
      formatDecimalHours(row.totalMs),
      String(row.percent),
      amount(row.billableCents, row.unpriced),
      currency,
    ])
  )

  /*
   * A TOTAL record, last.
   *
   * The row that makes an incomplete paste visible: a reader who copied half
   * the file has a total that does not match its own rows, instead of a
   * plausible smaller number with nothing to contradict it.
   */
  const total = record([
    "TOTAL",
    "", // no single week — same reason Description is blank here
    "",
    formatClock(rows.totals.totalMs),
    formatDecimalHours(rows.totals.totalMs),
    // NOT `billablePercent` — that measures the range's billable SHARE, and
    // this column measures each row's share of TOTAL DURATION instead. A
    // range with hours but zero billable work has `billablePercent: 0`;
    // branching this cell on it printed "0" beneath a column of rows whose
    // own Percents summed to 100, a CSV visibly contradicting its own rows.
    // `totals.percent` is the ONE place that answers "0 unless there was any
    // duration at all" — see report-rows.ts — read here rather than
    // re-derived, so this file cannot drift from to-xlsx.ts and report-doc.ts.
    String(rows.totals.percent),
    amount(rows.totals.billableCents, rows.totals.unpriced),
    currency,
  ])

  /*
   * IMPORTANT 4: the truncation and unpriced notes, as trailing records AFTER
   * TOTAL — the PDF and XLSX both state them (report-doc.ts, to-xlsx.ts) and
   * this file previously stated neither, so a capped CSV ended on a TOTAL
   * exceeding the sum of its own rows with nothing on the page to explain it.
   *
   * Trailing, not a leading preamble: the file's own "no preamble" rule above
   * exists because a line ABOVE the header is what makes Excel read the
   * WHOLE file as one ragged column (it commits to the header row's shape
   * before it has seen anything past it). A record appended after every real
   * row and the TOTAL cannot cause that — the header and all of `body` are
   * already parsed as an ordinary table by the time a reader (or Excel)
   * reaches it.
   */
  const notes: Array<string> = []
  if (rows.titlesTruncated) notes.push(record([TITLE_CAP_NOTE]))
  if (rows.totals.unpriced) notes.push(record([UNPRICED_NOTE]))

  return [record(HEADER), ...body, total, ...notes].join("\r\n")
}

/**
 * The CSV as a file, with a UTF-8 BOM.
 *
 * The BOM is not decoration. Excel on Windows opens a BOM-less UTF-8 CSV in the
 * system ANSI codepage, which turns every non-ASCII character in a project name
 * or a title into mojibake — and this product's users are freelancers billing
 * across borders. `text/csv;charset=utf-8` alone does not reach Excel, because
 * Excel reads the bytes, not the Blob's type.
 */
export function csvBlob(rows: ReportRows): Blob {
  return new Blob(["\uFEFF", toCsv(rows)], { type: "text/csv;charset=utf-8" })
}
