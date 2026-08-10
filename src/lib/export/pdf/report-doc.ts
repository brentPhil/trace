import { formatClock, formatDecimalHours } from "@shared/duration"
import { formatMoney } from "@shared/money"
import { parseDayString } from "@shared/day"
import { TITLE_CAP_NOTE, UNPRICED_NOTE } from "../report-rows"
import { barColumns, donutSlices, rect, text } from "./ops"
import { PAGE, PAPER, paperColorFor } from "./paper"
import type { PdfOp, PdfPage } from "./ops"
import type { ReportRows } from "../report-rows"

/**
 * The report, as pages of ops.
 *
 * PURE — no pdf-lib, no DOM, no clock. Pagination is the part of a document
 * that breaks, and this is what lets it be asserted directly instead of by
 * extracting text back out of a generated binary and hoping the extractor and
 * the writer agree about word order.
 *
 * Four blocks, matching the reference report and retitled for a single-user
 * product: Toggl's "member" axis is meaningless here, so its two member blocks
 * become project ones.
 */

const LEFT = PAGE.margin
const RIGHT = PAGE.width - PAGE.margin
const TOP = PAGE.height - PAGE.margin
const BOTTOM = PAGE.margin

/** Where the breakdown table's columns sit. Right-aligned columns give their
 *  right edge, which is what `align: "right"` measures from. */
const COL = {
  project: LEFT,
  description: LEFT + 120,
  duration: RIGHT - 190,
  hours: RIGHT - 130,
  percent: RIGHT - 70,
  amount: RIGHT,
} as const

const ROW_HEIGHT = 16
const HEADER_GAP = 26

/** `2026-07-13` as `07/13/2026`, the reference report's own format. */
function us(day: string): string {
  const { year, month, day: date } = parseDayString(day)
  return `${String(month).padStart(2, "0")}/${String(date).padStart(2, "0")}/${year}`
}

function moneyOr(cents: number, currency: string, unpriced: boolean): string {
  return unpriced ? "—" : formatMoney(cents, currency)
}

function tile(x: number, y: number, label: string, value: string, brass = false): Array<PdfOp> {
  return [
    text({ x, y, text: label, size: 8, color: PAPER.inkMuted }),
    text({
      x,
      y: y - 18,
      text: value,
      size: 16,
      bold: true,
      // Brass is a CURRENCY amount and nothing else. A billable duration is
      // time that will become money, not money, and renders as ordinary ink.
      color: brass ? PAPER.brass : PAPER.ink,
    }),
  ]
}

function summaryPage(rows: ReportRows): PdfPage {
  const { meta, totals } = rows
  const ops: Array<PdfOp> = []

  ops.push(
    text({
      x: LEFT,
      y: TOP,
      text: `Summary report from ${us(meta.from)} to ${us(meta.to)}`,
      size: 16,
      bold: true,
    })
  )

  // ---- Block 1: the four tiles -------------------------------------------
  const tileY = TOP - 52
  const tileWidth = (RIGHT - LEFT) / 4
  ops.push(
    ...tile(LEFT, tileY, "Total Hours", formatClock(totals.totalMs)),
    ...tile(
      LEFT + tileWidth,
      tileY,
      "Billable Hours",
      `${formatClock(totals.billableMs)}  ${totals.billablePercent}%`
    ),
    ...tile(
      LEFT + tileWidth * 2,
      tileY,
      "Amount",
      moneyOr(totals.billableCents, meta.currency, totals.unratedBillableMs >= totals.billableMs),
      true
    ),
    ...tile(
      LEFT + tileWidth * 3,
      tileY,
      "Average Daily Hours",
      formatClock(totals.averageDailyMs)
    ),
    /*
     * The divisor, stated. "7.6 h/day" over a fortnight with weekends off is a
     * different claim from "9.0 h/day over 11 days worked", and the first one
     * argues against the user in a rate conversation. Leaving the reader to
     * infer which was used is the same defect as an unqualified amount.
     */
    text({
      x: LEFT + tileWidth * 3,
      y: tileY - 32,
      text: `over ${meta.daysWorked} days worked`,
      size: 7,
      color: PAPER.inkMuted,
    })
  )

  if (totals.unratedBillableMs > 0) {
    ops.push(
      text({ x: LEFT, y: tileY - 48, text: UNPRICED_NOTE, size: 8, color: PAPER.inkMuted })
    )
  }

  // ---- Block 2: duration by day ------------------------------------------
  const chartTop = tileY - 78
  const chartBox = { x: LEFT, y: chartTop - 130, width: RIGHT - LEFT, height: 120 }
  ops.push(
    text({ x: LEFT, y: chartTop, text: "Duration by day", size: 11, bold: true }),
    ...barColumns(rows.buckets, chartBox)
  )

  const slot = rows.buckets.length === 0 ? 0 : chartBox.width / rows.buckets.length
  rows.buckets.forEach((bucket, index) => {
    ops.push(
      text({
        x: chartBox.x + index * slot,
        y: chartBox.y - 11,
        text: bucket.label,
        size: 6,
        color: PAPER.inkMuted,
      })
    )
  })

  // Both series named. DESIGN.md: meaning is never carried by colour alone,
  // and a legend is what discharges that for a stacked bar.
  ops.push(
    rect({ x: LEFT, y: chartBox.y - 28, width: 8, height: 8, color: PAPER.bar }),
    text({ x: LEFT + 12, y: chartBox.y - 27, text: "Billable", size: 8, color: PAPER.inkMuted }),
    rect({ x: LEFT + 66, y: chartBox.y - 28, width: 8, height: 8, color: PAPER.barMuted }),
    text({
      x: LEFT + 78,
      y: chartBox.y - 27,
      text: "Non-billable",
      size: 8,
      color: PAPER.inkMuted,
    })
  )

  // ---- Block 3: project distribution -------------------------------------
  const donutTop = chartBox.y - 58
  const cx = LEFT + 60
  const cy = donutTop - 62
  ops.push(
    text({ x: LEFT, y: donutTop, text: "Project distribution", size: 11, bold: true })
  )

  const slices = donutSlices(
    rows.projects.map((project) => project.totalMs),
    cx,
    cy,
    52,
    30
  )
  slices.forEach((d, index) => {
    ops.push({
      kind: "path",
      x: 0,
      y: 0,
      d,
      color: paperColorFor(rows.projects[index]?.color ?? ""),
    })
  })

  rows.projects.forEach((project, index) => {
    const y = donutTop - 24 - index * 15
    ops.push(
      rect({
        x: cx + 84,
        y,
        width: 8,
        height: 8,
        color: paperColorFor(project.color),
      }),
      text({ x: cx + 98, y: y + 1, text: project.name, size: 9 }),
      text({
        x: RIGHT - 90,
        y: y + 1,
        text: `${project.percent}%`,
        size: 9,
        align: "right",
        color: PAPER.inkMuted,
      }),
      text({
        x: RIGHT,
        y: y + 1,
        text: formatClock(project.totalMs),
        size: 9,
        align: "right",
      })
    )
  })

  return { ops }
}

const BREAKDOWN_TITLE = "Project and description breakdown"

/** The block heading plus the column header, drawn identically on every page
 *  of the table. Repeated rather than drawn once: a continuation page with
 *  unlabelled columns is a page of unattributed numbers. */
function breakdownHeader(): Array<PdfOp> {
  const y = TOP - 24
  return [
    text({ x: LEFT, y: TOP, text: BREAKDOWN_TITLE, size: 11, bold: true }),
    text({ x: COL.project, y, text: "PROJECT", size: 7, color: PAPER.inkMuted }),
    text({ x: COL.description, y, text: "DESCRIPTION", size: 7, color: PAPER.inkMuted }),
    text({ x: COL.duration, y, text: "DURATION", size: 7, align: "right", color: PAPER.inkMuted }),
    text({ x: COL.hours, y, text: "HOURS", size: 7, align: "right", color: PAPER.inkMuted }),
    text({ x: COL.percent, y, text: "%", size: 7, align: "right", color: PAPER.inkMuted }),
    text({ x: COL.amount, y, text: "AMOUNT", size: 7, align: "right", color: PAPER.inkMuted }),
    rect({ x: LEFT, y: y - 6, width: RIGHT - LEFT, height: 0.5, color: PAPER.rule }),
  ]
}

function breakdownRow(row: ReportRows["titles"][number], y: number, currency: string): Array<PdfOp> {
  return [
    text({ x: COL.project, y, text: row.project, size: 8, color: PAPER.inkMuted }),
    text({ x: COL.description, y, text: row.description, size: 8 }),
    text({ x: COL.duration, y, text: formatClock(row.totalMs), size: 8, align: "right" }),
    text({ x: COL.hours, y, text: formatDecimalHours(row.totalMs), size: 8, align: "right" }),
    text({ x: COL.percent, y, text: `${row.percent}%`, size: 8, align: "right", color: PAPER.inkMuted }),
    text({
      x: COL.amount,
      y,
      text: moneyOr(row.billableCents, currency, row.unpriced),
      size: 8,
      align: "right",
      color: row.unpriced ? PAPER.inkMuted : PAPER.brass,
    }),
  ]
}

export function reportPages(rows: ReportRows): Array<PdfPage> {
  const pages: Array<PdfPage> = [summaryPage(rows)]
  const { currency } = rows.meta

  /*
   * The TOTAL row is reserved a slot on the last page from the start.
   *
   * Paginating the rows first and appending the total afterwards puts it alone
   * on a fifth page whenever the rows happen to fill the fourth — a document
   * whose final page is one number with no table above it.
   */
  const perPage = Math.floor((TOP - HEADER_GAP - BOTTOM - ROW_HEIGHT * 2) / ROW_HEIGHT)

  let index = 0
  do {
    const slice = rows.titles.slice(index, index + perPage)
    const ops = breakdownHeader()
    slice.forEach((row, n) => {
      ops.push(...breakdownRow(row, TOP - HEADER_GAP - (n + 1) * ROW_HEIGHT, currency))
    })
    index += perPage

    const last = index >= rows.titles.length
    if (last) {
      const y = TOP - HEADER_GAP - (slice.length + 2) * ROW_HEIGHT
      ops.push(
        rect({ x: LEFT, y: y + ROW_HEIGHT - 4, width: RIGHT - LEFT, height: 0.5, color: PAPER.rule }),
        text({ x: COL.project, y, text: "TOTAL", size: 9, bold: true }),
        text({ x: COL.duration, y, text: formatClock(rows.totals.totalMs), size: 9, bold: true, align: "right" }),
        text({ x: COL.hours, y, text: formatDecimalHours(rows.totals.totalMs), size: 9, bold: true, align: "right" }),
        text({ x: COL.percent, y, text: "100%", size: 9, bold: true, align: "right" }),
        text({
          x: COL.amount,
          y,
          text: moneyOr(
            rows.totals.billableCents,
            currency,
            rows.totals.unratedBillableMs >= rows.totals.billableMs
          ),
          size: 9,
          bold: true,
          align: "right",
          color: PAPER.brass,
        })
      )
      if (rows.titlesTruncated) {
        ops.push(
          text({ x: LEFT, y: y - 20, text: TITLE_CAP_NOTE, size: 8, color: PAPER.inkMuted })
        )
      }
      if (rows.totals.unratedBillableMs > 0) {
        ops.push(
          text({ x: LEFT, y: y - 34, text: UNPRICED_NOTE, size: 8, color: PAPER.inkMuted })
        )
      }
    }

    pages.push({ ops })
  } while (index < rows.titles.length)

  /*
   * An empty range gets the summary page and nothing else. A breakdown page
   * holding a header, a rule and a TOTAL of zero is a page that says "here is
   * the work" above no work.
   */
  const finished = rows.titles.length === 0 ? [pages[0]] : pages

  finished.forEach((page, n) => {
    page.ops.push(
      text({
        x: RIGHT,
        y: BOTTOM - 18,
        text: `Page ${n + 1} / ${finished.length}`,
        size: 7,
        align: "right",
        color: PAPER.inkMuted,
      })
    )
  })

  return finished
}
