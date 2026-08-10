import { formatClock, formatDecimalHours } from "@shared/duration"
import { formatMoney } from "@shared/money"
import { parseDayString } from "@shared/day"
import { TITLE_CAP_NOTE, UNPRICED_NOTE } from "../report-rows"
import { axisTickIndices, barColumns, donutSlices, rect, text, truncateToWidth } from "./ops"
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

/**
 * One tile's fixed anatomy: label, value, and an optional muted sub-line.
 *
 * Every tile draws all three slots the same way so a reader learns the shape
 * once. Before this, Billable Hours had no sub-line and instead concatenated
 * its percent onto the value string (`40:17:00  100%`), which reads as one
 * figure rather than two — the sub-line is where a qualifier like that
 * belongs, matching how Average Daily Hours already states its divisor.
 */
function tile(
  x: number,
  y: number,
  label: string,
  value: string,
  opts: { brass?: boolean; subLine?: string } = {}
): Array<PdfOp> {
  const ops: Array<PdfOp> = [
    text({ x, y, text: label, size: 8, color: PAPER.inkMuted }),
    text({
      x,
      y: y - 18,
      text: value,
      size: 16,
      bold: true,
      // Brass is a CURRENCY amount and nothing else. A billable duration is
      // time that will become money, not money, and renders as ordinary ink.
      color: opts.brass ? PAPER.brass : PAPER.ink,
    }),
  ]
  if (opts.subLine) {
    ops.push(text({ x, y: y - 32, text: opts.subLine, size: 7, color: PAPER.inkMuted }))
  }
  return ops
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
    // P1-6: the percent used to be glued onto the duration string
    // (`40:17:00  100%`), which reads as one figure. It is a qualifier of the
    // duration, not part of it, so it gets the tile's sub-line — the same
    // slot Average Daily Hours already uses for its divisor below.
    ...tile(LEFT + tileWidth, tileY, "Billable Hours", formatClock(totals.billableMs), {
      subLine: `${totals.billablePercent}% of total`,
    }),
    ...tile(
      LEFT + tileWidth * 2,
      tileY,
      "Amount",
      moneyOr(totals.billableCents, meta.currency, totals.unratedBillableMs >= totals.billableMs),
      { brass: true }
    ),
    /*
     * The divisor, stated. "7.6 h/day" over a fortnight with weekends off is a
     * different claim from "9.0 h/day over 11 days worked", and the first one
     * argues against the user in a rate conversation. Leaving the reader to
     * infer which was used is the same defect as an unqualified amount.
     */
    ...tile(LEFT + tileWidth * 3, tileY, "Average Daily Hours", formatClock(totals.averageDailyMs), {
      subLine: `over ${meta.daysWorked} days worked`,
    })
  )

  if (totals.unratedBillableMs > 0) {
    ops.push(
      text({ x: LEFT, y: tileY - 48, text: UNPRICED_NOTE, size: 8, color: PAPER.inkMuted })
    )
  }

  // ---- Block 2: duration by day ------------------------------------------
  /*
   * P1-4: roughly 40% of the page was blank because the chart and donut were
   * sized as if they had to compete with a breakdown table that, in fact,
   * never shares this page (pagination starts the table on page 2). Sized
   * instead against the actual space between the tiles and the footer, with
   * the gap ABOVE this heading (tileY - chartTop) left alone — that one is
   * already generous — and the block's own height taking the freed room.
   */
  const chartTop = tileY - 78
  const CHART_HEIGHT = 200
  const chartBox = { x: LEFT, y: chartTop - 10 - CHART_HEIGHT, width: RIGHT - LEFT, height: CHART_HEIGHT }
  ops.push(
    text({ x: LEFT, y: chartTop, text: "Duration by day", size: 11, bold: true }),
    ...barColumns(rows.buckets, chartBox)
  )

  // P0-2: thin the x-axis ticks so labels stop colliding. A 31-day range at
  // 6pt across this box's width drew all 31 and `Mon 10` overlapped `Mon 1`;
  // `axisTickIndices` measures the widest label actually present and steps
  // by however many buckets that takes, always keeping the first and last so
  // the axis still states its own range.
  const slot = rows.buckets.length === 0 ? 0 : chartBox.width / rows.buckets.length
  const bucketLabels = rows.buckets.map((bucket) => bucket.label)
  axisTickIndices(bucketLabels, chartBox.width, 6, false).forEach((index) => {
    ops.push(
      text({
        x: chartBox.x + index * slot,
        y: chartBox.y - 11,
        text: bucketLabels[index],
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
  const DONUT_RADIUS = 95
  const DONUT_INNER = 55
  /*
   * P0-3: the donut overlapped its own heading. `donutSlices` is drawn
   * through render.ts's `drawSvgPath`, which treats the path's origin as
   * (op.x, PAGE.height) and flips y (`scale(1, -1)`) — SVG paths are y-DOWN,
   * everything else in this file is y-UP. So a point at svg-space y = V lands
   * at real page y = PAGE.height - V, and `cy` must be given in that flipped
   * space, not as a real page coordinate.
   *
   * The previous code passed `donutTop - 62` straight through as if it were
   * already a real, y-up coordinate. It wasn't: run through the flip, that
   * placed the donut's real top edge at PAGE.height - (donutTop - 62), which
   * for this layout lands ABOVE donutTop — above the heading whose baseline
   * IS donutTop. Converting a real target position with `PAGE.height - y`
   * before applying the radius, as below, makes the top edge land exactly
   * `DONUT_HEADING_CLEARANCE` points below the heading's baseline by
   * construction, for any radius — not by nudging either number until a
   * render happened to look right.
   */
  const DONUT_HEADING_CLEARANCE = 20 // heading's own ~8pt cap height plus a visual gutter
  const donutCenterY = donutTop - DONUT_HEADING_CLEARANCE - DONUT_RADIUS
  const cx = LEFT + DONUT_RADIUS + 12
  const cy = PAGE.height - donutCenterY
  ops.push(
    text({ x: LEFT, y: donutTop, text: "Project distribution", size: 11, bold: true })
  )

  const slices = donutSlices(
    rows.projects.map((project) => project.totalMs),
    cx,
    cy,
    DONUT_RADIUS,
    DONUT_INNER
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

  // P1-7: the %/duration columns used to sit at the page's right margin,
  // separated from the project name by whatever space happened to be left
  // over. Anchoring them a fixed distance from the legend's own start (as the
  // breakdown table's columns already are from LEFT) keeps the row reading
  // as one unit regardless of how wide the page's content area is.
  const legendX = cx + DONUT_RADIUS + 26
  const LEGEND_COL = { name: 14, percent: 150, duration: 205 }
  rows.projects.forEach((project, index) => {
    const y = donutTop - 24 - index * 15
    ops.push(
      rect({
        x: legendX,
        y,
        width: 8,
        height: 8,
        color: paperColorFor(project.color),
      }),
      text({ x: legendX + LEGEND_COL.name, y: y + 1, text: project.name, size: 9 }),
      text({
        x: legendX + LEGEND_COL.percent,
        y: y + 1,
        text: `${project.percent}%`,
        size: 9,
        align: "right",
        color: PAPER.inkMuted,
      }),
      text({
        x: legendX + LEGEND_COL.duration,
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

/*
 * P0-1: a long description ran straight through the DURATION column — text
 * was drawn at a column x with no width limit, so `[B-CB-326] Building Crew
 * Training CSV and PDF download` overprinted `7:51:34` on a document a
 * client reconciles against an invoice. `CELL_GAP` is the visual breathing
 * room reserved before the next column starts, subtracted from the raw
 * distance between two column x's so a truncated cell never touches its
 * neighbour even at the widest string that still fits.
 */
const CELL_GAP = 8
const PROJECT_CELL_WIDTH = COL.description - COL.project - CELL_GAP
const DESCRIPTION_CELL_WIDTH = COL.duration - COL.description - CELL_GAP

function breakdownRow(row: ReportRows["titles"][number], y: number, currency: string): Array<PdfOp> {
  const project = truncateToWidth(row.project, PROJECT_CELL_WIDTH, 8, false)
  const description = truncateToWidth(row.description, DESCRIPTION_CELL_WIDTH, 8, false)
  return [
    text({ x: COL.project, y, text: project, size: 8, color: PAPER.inkMuted }),
    text({ x: COL.description, y, text: description, size: 8 }),
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
