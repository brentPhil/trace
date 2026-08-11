import { formatClock, formatDecimalHours } from "@shared/duration"
import { formatMoney } from "@shared/money"
import { parseDayString } from "@shared/day"
import { TITLE_CAP_NOTE, UNPRICED_NOTE } from "../report-rows"
import {
  axisTickIndices,
  barColumns,
  donutSlices,
  rect,
  text,
  textWidth,
  wrapToWidth,
} from "./ops"
import { PAGE, PAPER, TYPE, paperColorFor } from "./paper"
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
// Exported so tests can assert the no-overlap geometry directly against the
// same anchors this file draws with, instead of duplicating the numbers.
//
// `description` sits at LEFT + 100, not the wider LEFT + 120 this used to be.
// This app's own project names are short ("Sealogs", "No project" — see
// NO_PROJECT_LABEL in report-series.ts) while descriptions are imported ticket
// titles that run long; a project column sized for names nobody has just
// starves the column that actually needs the room. 100pt comfortably fits a
// name like "Vessel Vanguard" (~78pt at the body size below) with room to
// spare.
//
// The numeric columns' own gaps (60 / 60 / 80) are each sized to clear that
// COLUMN's own worst-case string at the body/TOTAL sizes below, not the
// column to its left — HOURS is right-aligned, so it is HOURS's width that
// must fit inside the duration→hours gap, and so on rightward. AMOUNT gets
// the widest gap (80, not 60) because a formatted currency string
// (`$99,999.99`) is the widest thing any of these four columns ever draws.
export const COL = {
  project: LEFT,
  description: LEFT + 100,
  duration: RIGHT - 200,
  hours: RIGHT - 140,
  percent: RIGHT - 80,
  amount: RIGHT,
} as const

/**
 * A row's height is no longer one fixed constant — it is `lines * LINE_HEIGHT
 * + ROW_PADDING`, driven by how many lines the DESCRIPTION (and, when it's
 * the wider cell, PROJECT) wrapped to. `LINE_HEIGHT` is the gap between two
 * wrapped lines within one cell; `ROW_PADDING` is the gap after a row's last
 * line before the next row starts. The two sum to 20 — the row height every
 * single-line row (still the common case) occupies at the body size below —
 * scaled up from the 16 a single-line row occupied at the old 8pt body text,
 * in the same proportion the body size itself grew (8pt → 10pt).
 */
const LINE_HEIGHT = 12
const ROW_PADDING = 8

/** The vertical space a row of `lineCount` wrapped lines actually occupies,
 *  including the gap before the next row. The one formula both the packer
 *  (`reportPages`) and the TOTAL-row reservation below must agree on — two
 *  independent height calculations are two things that can silently drift
 *  apart the next time either changes. */
function rowSlotHeight(lineCount: number): number {
  return lineCount * LINE_HEIGHT + ROW_PADDING
}

const HEADER_GAP = 33

/**
 * `2026-07-13` as `07/13/2026`, the reference report's own format.
 *
 * Exported, and imported by `invoice-doc.ts` rather than restated there: the
 * two documents this product prints are read side by side by the same client,
 * and a report dated `07/13/2026` beside an invoice dated `13/07/2026` is a
 * pair of documents nobody can tell apart on a July 13th.
 */
export function usDate(day: string): string {
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
    text({ x, y, text: label, size: TYPE.tick, color: PAPER.inkMuted }),
    text({
      x,
      y: y - 22,
      text: value,
      size: TYPE.tileValue,
      bold: true,
      // Brass is a CURRENCY amount and nothing else. A billable duration is
      // time that will become money, not money, and renders as ordinary ink.
      color: opts.brass ? PAPER.brass : PAPER.ink,
    }),
  ]
  if (opts.subLine) {
    ops.push(text({ x, y: y - 38, text: opts.subLine, size: TYPE.tick, color: PAPER.inkMuted }))
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
      text: `Summary report from ${usDate(meta.from)} to ${usDate(meta.to)}`,
      size: TYPE.title,
      bold: true,
    })
  )

  // ---- Block 1: the four tiles -------------------------------------------
  const tileY = TOP - 65
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
      moneyOr(totals.billableCents, meta.currency, totals.unpriced),
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

  if (totals.unpriced) {
    ops.push(
      text({ x: LEFT, y: tileY - 58, text: UNPRICED_NOTE, size: TYPE.body, color: PAPER.inkMuted })
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
  const chartTop = tileY - 94
  const CHART_HEIGHT = 200
  const chartBox = { x: LEFT, y: chartTop - 10 - CHART_HEIGHT, width: RIGHT - LEFT, height: CHART_HEIGHT }
  ops.push(
    text({ x: LEFT, y: chartTop, text: "Duration by day", size: TYPE.heading, bold: true }),
    ...barColumns(rows.buckets, chartBox)
  )

  // P0-2: thin the x-axis ticks so labels stop colliding. A 31-day range at
  // `TYPE.tick` across this box's width drew all 31 and `Mon 10` overlapped
  // `Mon 1`; `axisTickIndices` measures the widest label actually present and
  // steps by however many buckets that takes, always keeping the first and
  // last so the axis still states its own range. Raising the tick size (was
  // 6pt) only shrinks the gap `axisTickIndices` has to work with, which is
  // exactly what it is for — it thins further, it does not stop working.
  const slot = rows.buckets.length === 0 ? 0 : chartBox.width / rows.buckets.length
  const bucketLabels = rows.buckets.map((bucket) => bucket.label)
  axisTickIndices(bucketLabels, chartBox.width, TYPE.tick, false).forEach((index) => {
    ops.push(
      text({
        x: chartBox.x + index * slot,
        y: chartBox.y - 16,
        text: bucketLabels[index],
        size: TYPE.tick,
        color: PAPER.inkMuted,
      })
    )
  })

  // Both series named. DESIGN.md: meaning is never carried by colour alone,
  // and a legend is what discharges that for a stacked bar.
  ops.push(
    rect({ x: LEFT, y: chartBox.y - 33, width: 9, height: 9, color: PAPER.bar }),
    text({ x: LEFT + 13, y: chartBox.y - 32, text: "Billable", size: TYPE.body, color: PAPER.inkMuted }),
    rect({ x: LEFT + 80, y: chartBox.y - 33, width: 9, height: 9, color: PAPER.barMuted }),
    text({
      x: LEFT + 93,
      y: chartBox.y - 32,
      text: "Non-billable",
      size: TYPE.body,
      color: PAPER.inkMuted,
    })
  )

  // ---- Block 3: project distribution -------------------------------------
  const donutTop = chartBox.y - 70
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
  const DONUT_HEADING_CLEARANCE = 25 // heading's own ~10pt cap height (TYPE.heading) plus a visual gutter
  const donutCenterY = donutTop - DONUT_HEADING_CLEARANCE - DONUT_RADIUS
  const cx = LEFT + DONUT_RADIUS + 12
  const cy = PAGE.height - donutCenterY
  ops.push(
    text({ x: LEFT, y: donutTop, text: "Project distribution", size: TYPE.heading, bold: true })
  )

  // IMPORTANT 2: `donutSlices` skips any project with `totalMs <= 0`, so the
  // slices it returns are no longer in one-to-one POSITION with
  // `rows.projects` the moment such a project exists — indexing
  // `rows.projects[sliceIndex]` (the previous code) shifts every slice AFTER
  // a zero-duration project onto the NEXT project's colour, while the legend
  // below (which walks `rows.projects` directly and draws every project,
  // zero-duration ones included) still names the right one beside the wrong
  // swatch. Each slice now carries the INDEX of the value it was built from,
  // so colour and legend are paired by source rather than by position.
  const slices = donutSlices(
    rows.projects.map((project) => project.totalMs),
    cx,
    cy,
    DONUT_RADIUS,
    DONUT_INNER
  )
  slices.forEach((slice) => {
    ops.push({
      kind: "path",
      x: 0,
      y: 0,
      d: slice.d,
      color: paperColorFor(rows.projects[slice.index]?.color ?? ""),
    })
  })

  // P1-7: the %/duration columns used to sit at the page's right margin,
  // separated from the project name by whatever space happened to be left
  // over. Anchoring them a fixed distance from the legend's own start (as the
  // breakdown table's columns already are from LEFT) keeps the row reading
  // as one unit regardless of how wide the page's content area is.
  const legendX = cx + DONUT_RADIUS + 26
  const LEGEND_COL = { name: 15, percent: 155, duration: 215 }
  rows.projects.forEach((project, index) => {
    const y = donutTop - 27 - index * 17
    ops.push(
      rect({
        x: legendX,
        y,
        width: 9,
        height: 9,
        color: paperColorFor(project.color),
      }),
      text({ x: legendX + LEGEND_COL.name, y: y + 1, text: project.name, size: TYPE.body }),
      text({
        x: legendX + LEGEND_COL.percent,
        y: y + 1,
        text: `${project.percent}%`,
        size: TYPE.body,
        align: "right",
        color: PAPER.inkMuted,
      }),
      text({
        x: legendX + LEGEND_COL.duration,
        y: y + 1,
        text: formatClock(project.totalMs),
        size: TYPE.body,
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
  const y = TOP - 30
  return [
    text({ x: LEFT, y: TOP, text: BREAKDOWN_TITLE, size: TYPE.heading, bold: true }),
    text({ x: COL.project, y, text: "PROJECT", size: TYPE.tick, color: PAPER.inkMuted }),
    text({ x: COL.description, y, text: "DESCRIPTION", size: TYPE.tick, color: PAPER.inkMuted }),
    text({
      x: COL.duration,
      y,
      text: "DURATION",
      size: TYPE.tick,
      align: "right",
      color: PAPER.inkMuted,
    }),
    text({ x: COL.hours, y, text: "HOURS", size: TYPE.tick, align: "right", color: PAPER.inkMuted }),
    text({ x: COL.percent, y, text: "%", size: TYPE.tick, align: "right", color: PAPER.inkMuted }),
    text({
      x: COL.amount,
      y,
      text: "AMOUNT",
      size: TYPE.tick,
      align: "right",
      color: PAPER.inkMuted,
    }),
    rect({ x: LEFT, y: y - 7, width: RIGHT - LEFT, height: 0.5, color: PAPER.rule }),
  ]
}

/*
 * P0-1: a long description ran straight through the DURATION column — text
 * was drawn at a column x with no width limit, so `[B-CB-326] Building Crew
 * Training CSV and PDF download` overprinted `7:51:34` on a document a
 * client reconciles against an invoice.
 *
 * A first truncation pass measured the description's budget as the raw
 * distance up to `COL.duration` minus a gap. That still collided, because
 * DURATION is right-aligned: `COL.duration` is where its glyphs END, and
 * they extend LEFTWARD from there by the string's own width. Measuring "up
 * to COL.duration" measures up to a line the duration text has already
 * crossed — the two cells' claimed regions overlap by exactly the width of
 * whatever duration is on that row.
 *
 * PROJECT has no equivalent bug: it is left-aligned, so its own anchor
 * (`COL.project`) is already where its text BEGINS, and its budget already
 * correctly stops at the next column's start.
 *
 * `GUTTER` is real, deliberate whitespace between columns (not a rounding
 * fudge) — enough that adjacent cells read as two columns rather than one
 * run-on line even when both are truncated to their limit.
 */
const GUTTER = 10
const PROJECT_CELL_WIDTH = COL.description - COL.project - GUTTER

/** A row's DESCRIPTION and PROJECT cells, pre-wrapped, plus the line-count
 *  that determines how tall the row's slot is. Computed once per row up
 *  front — the packer (deciding what fits on a page) and the drawer (turning
 *  a placed row into ops) both need the SAME wrapped lines, and recomputing
 *  `wrapToWidth` a second time at draw time risks the two disagreeing about
 *  a row's height versus what actually gets drawn into it. */
type SizedRow = {
  row: ReportRows["titles"][number]
  descriptionLines: Array<string>
  projectLines: Array<string>
  height: number
}

function sizeRow(row: ReportRows["titles"][number], descriptionMaxWidth: number): SizedRow {
  const descriptionLines = wrapToWidth(row.description, descriptionMaxWidth, TYPE.body, false)
  const projectLines = wrapToWidth(row.project, PROJECT_CELL_WIDTH, TYPE.body, false)
  const lineCount = Math.max(descriptionLines.length, projectLines.length)
  return { row, descriptionLines, projectLines, height: rowSlotHeight(lineCount) }
}

/*
 * P0-1 (original defect, now generalised to N lines): a long description ran
 * straight through the DURATION column — text was drawn at a column x with
 * no width limit, so `[B-CB-326] Building Crew Training CSV and PDF
 * download` overprinted `7:51:34` on a document a client reconciles against
 * an invoice. Wrapping instead of truncating keeps the text but reopens the
 * same risk per LINE, not just once per row, if a line's own width is ever
 * measured wrong — `wrapToWidth` is what now guarantees each returned line's
 * width already fits `descriptionMaxWidth`, so this function only has to
 * draw what it's given.
 *
 * DURATION is right-aligned: `COL.duration` is where its glyphs END, and
 * they extend LEFTWARD from there. `descriptionMaxWidth` (computed once for
 * the whole document below) already reserves room up to where the widest
 * duration on the page BEGINS, not merely up to the column's anchor.
 *
 * `firstLineY` is where the FIRST line of the description/project block
 * sits; the numeric columns are vertically centred against that whole block
 * rather than pinned to the first line, matching the reference report — a
 * two-line description with its duration glued to the top line reads as
 * though the second line belongs to the row below.
 */
/**
 * One item in the breakdown table's page-packing sequence: a week's own
 * heading, one of its (already-sized) rows, or its subtotal.
 *
 * Flattening the table into this sequence — rather than pagination knowing
 * about weeks directly — is what lets a single accumulate-until-full pass
 * place headings, rows and subtotals with one shared budget, the same way
 * the pre-weeks version paginated a flat list of rows.
 */
type Block =
  | { kind: "heading"; label: string; height: number }
  | { kind: "row"; sized: SizedRow; height: number }
  | { kind: "subtotal"; week: ReportRows["weeks"][number]; height: number }

function weekHeadingOp(label: string, y: number): PdfOp {
  return text({ x: LEFT, y, text: label, size: TYPE.body, bold: true })
}

/**
 * The four right-aligned numeric columns — DURATION, HOURS, %, AMOUNT — laid
 * out once and shared by a body row, a week's subtotal, and the grand TOTAL.
 * Written out three times before this, the file's own comments each pointed
 * at the other two copies to explain a rule ("brass is a CURRENCY amount and
 * nothing else") that a near-miss had already shown could drift between them
 * — a fourth copy is how it actually would.
 *
 * `mutedPercent` is the one deliberate difference between call sites: a body
 * row and a week's subtotal both print % in muted ink because they are
 * subordinate to the page's real total, while the TOTAL row itself is left
 * at the row's own ink because it is already bold/`TYPE.strong` and reads as
 * the page's own emphasis, not a figure to de-emphasise further.
 */
function numericColumnsOps(
  y: number,
  opts: {
    durationMs: number
    percent: number
    billableCents: number
    currency: string
    unpriced: boolean
    size: number
    bold: boolean
    mutedPercent: boolean
  }
): Array<PdfOp> {
  const { durationMs, percent, billableCents, currency, unpriced, size, bold, mutedPercent } = opts
  return [
    text({ x: COL.duration, y, text: formatClock(durationMs), size, bold, align: "right" }),
    text({ x: COL.hours, y, text: formatDecimalHours(durationMs), size, bold, align: "right" }),
    text({
      x: COL.percent,
      y,
      text: `${percent}%`,
      size,
      bold,
      align: "right",
      color: mutedPercent ? PAPER.inkMuted : undefined,
    }),
    text({
      x: COL.amount,
      y,
      text: moneyOr(billableCents, currency, unpriced),
      size,
      bold,
      align: "right",
      // Brass is a CURRENCY amount and nothing else (DESIGN.md) — never
      // hardcoded, the one rule all three numeric-column call sites share.
      color: unpriced ? PAPER.inkMuted : PAPER.brass,
    }),
  ]
}

/** A week's subtotal row — same columns as a body row, bold like TOTAL but
 *  at body size so it reads as a subordinate figure, not a second grand
 *  total. Labelled "Subtotal" in the PROJECT column, matching where TOTAL's
 *  own label sits. */
function weekSubtotalOps(
  week: ReportRows["weeks"][number],
  y: number,
  currency: string
): Array<PdfOp> {
  return [
    text({ x: COL.project, y, text: "Subtotal", size: TYPE.body, bold: true }),
    ...numericColumnsOps(y, {
      durationMs: week.subtotal.totalMs,
      percent: week.subtotal.percent,
      billableCents: week.subtotal.billableCents,
      currency,
      unpriced: week.subtotal.unpriced,
      size: TYPE.body,
      bold: true,
      mutedPercent: true,
    }),
  ]
}

function breakdownRow(
  sized: SizedRow,
  firstLineY: number,
  currency: string
): Array<PdfOp> {
  const { row, descriptionLines, projectLines } = sized
  const lineCount = Math.max(descriptionLines.length, projectLines.length)
  // Centring an ODD line count lands exactly on the middle line's own
  // baseline; an EVEN count lands the numbers in the gap between the two
  // middle lines, which is what "centred against the block" means when
  // there is no single middle line to pin to.
  const centerY = firstLineY - ((lineCount - 1) * LINE_HEIGHT) / 2

  const ops: Array<PdfOp> = []
  descriptionLines.forEach((line, n) => {
    ops.push(
      text({ x: COL.description, y: firstLineY - n * LINE_HEIGHT, text: line, size: TYPE.body })
    )
  })
  projectLines.forEach((line, n) => {
    ops.push(
      text({
        x: COL.project,
        y: firstLineY - n * LINE_HEIGHT,
        text: line,
        size: TYPE.body,
        color: PAPER.inkMuted,
      })
    )
  })
  ops.push(
    ...numericColumnsOps(centerY, {
      durationMs: row.totalMs,
      percent: row.percent,
      billableCents: row.billableCents,
      currency,
      unpriced: row.unpriced,
      size: TYPE.body,
      bold: false,
      mutedPercent: true,
    })
  )
  return ops
}

export function reportPages(rows: ReportRows): Array<PdfPage> {
  const pages: Array<PdfPage> = [summaryPage(rows)]
  const { currency } = rows.meta

  /*
   * The description's budget must reserve room for the widest DURATION that
   * will actually be drawn at this fixed column position — not a guessed
   * constant. A hardcoded reservation sized for `7:51:34` silently reopens
   * this exact overprint the moment a range is long enough to produce
   * `123:45:07` (unpadded hours, so the string only grows), which is exactly
   * the heavy month a freelancer most wants to export. Measured over every
   * body row AND the TOTAL row — TOTAL is bold, so it is measured bold — since
   * the column position is one constant for the whole document, not per-row.
   */
  const maxDurationTextWidth = Math.max(
    ...rows.titles.map((row) => textWidth(formatClock(row.totalMs), TYPE.body, false)),
    textWidth(formatClock(rows.totals.totalMs), TYPE.strong, true)
  )
  const descriptionMaxWidth = COL.duration - maxDurationTextWidth - GUTTER - COL.description

  /*
   * The TOTAL row is reserved a slot on the last page from the start, sized
   * against its OWN actual height (via `rowSlotHeight`) rather than a
   * hardcoded number — TOTAL's cells never wrap (its PROJECT cell is the
   * literal string "TOTAL" and its DESCRIPTION cell is empty), so this is
   * always one line, but it goes through the same formula the body rows do
   * so the two can never silently drift apart.
   *
   * `TOTAL_GAP` is a full blank row's worth of space between the last body
   * row and the rule above TOTAL — without it, TOTAL reads as though it
   * belongs to whichever row above it happens to wrap onto the fewest lines,
   * exactly the visual bug variable row heights would otherwise introduce.
   *
   * This reserve is subtracted from EVERY page's budget below, not only the
   * final one — pagination is a single forward pass that doesn't know which
   * page will turn out to be last until it's built it, so every page must
   * leave enough room in case IT turns out to be the one holding TOTAL. Pages
   * that aren't last simply carry unused trailing whitespace instead.
   */
  const TOTAL_GAP = rowSlotHeight(1)
  const totalRowHeight = rowSlotHeight(1)
  const totalReserve = TOTAL_GAP + totalRowHeight

  const pageBodyHeight = TOP - HEADER_GAP - BOTTOM
  const perPageBudget = pageBodyHeight - totalReserve

  /*
   * Height-accumulating pagination over BLOCKS (headings, rows, subtotals),
   * not just rows — fill a page until the next block would cross the
   * reserved budget, then start a new one. A fixed rows-per-page count (the
   * pre-wrapping approach) assumed every row the same height, which
   * wrapping makes false, and treating headings/subtotals as ordinary blocks
   * in the SAME accumulator is what lets a single pass paginate the whole
   * table without a week ever needing to know which page it landed on.
   *
   * THE ORPHAN RULE lives here: a week's heading and its own first row are
   * placed as one atomic step (`pairHeight` below), guarded by the SAME
   * "would this cross the budget" check every other block uses. Without the
   * pairing, an ordinary per-block check places the heading wherever it
   * fits — including a sliver of room too small for the row that has to
   * follow it — and a heading with its first row bumped to the next page
   * reads as an announcement of a week with no work in it. `current.length
   * > 0` is what stops a heading+row pair (or a single oversized row) taller
   * than a whole page's budget from being dropped entirely: it still gets
   * its own (overflowing) page rather than vanishing from the document —
   * the same escape hatch the original per-row version relied on.
   */
  const rowPages: Array<Array<Block>> = []
  let current: Array<Block> = []
  let used = 0

  function breakPage(): void {
    rowPages.push(current)
    current = []
    used = 0
  }

  for (const week of rows.weeks) {
    const sizedWeekRows = week.rows.map((row) => sizeRow(row, descriptionMaxWidth))
    const headingHeight = rowSlotHeight(1)
    const firstRowHeight = sizedWeekRows[0]?.height ?? 0

    if (current.length > 0 && used + headingHeight + firstRowHeight > perPageBudget) {
      breakPage()
    }
    current.push({ kind: "heading", label: week.label, height: headingHeight })
    used += headingHeight

    sizedWeekRows.forEach((sized, index) => {
      // The first row is placed UNCONDITIONALLY, right after its heading —
      // the pair check above already decided whether the two fit together,
      // and re-checking here would let this row alone bump to a fresh page
      // while its heading stays behind, recreating the exact orphan the pair
      // check exists to prevent.
      if (index > 0 && used + sized.height > perPageBudget) {
        breakPage()
      }
      current.push({ kind: "row", sized, height: sized.height })
      used += sized.height
    })

    const subtotalHeight = rowSlotHeight(1)
    if (used + subtotalHeight > perPageBudget) breakPage()
    current.push({ kind: "subtotal", week, height: subtotalHeight })
    used += subtotalHeight
  }
  rowPages.push(current)

  rowPages.forEach((pageBlocks, pageIndex) => {
    const isLastPage = pageIndex === rowPages.length - 1
    const ops = breakdownHeader()

    // `cursor` is the y just below whatever was drawn last — the top
    // boundary the next block (or TOTAL) starts filling from.
    let cursor = TOP - HEADER_GAP
    for (const block of pageBlocks) {
      if (block.kind === "heading") {
        ops.push(weekHeadingOp(block.label, cursor - LINE_HEIGHT))
        cursor -= block.height
      } else if (block.kind === "row") {
        const firstLineY = cursor - LINE_HEIGHT
        ops.push(...breakdownRow(block.sized, firstLineY, currency))
        cursor -= block.height
      } else {
        ops.push(...weekSubtotalOps(block.week, cursor - LINE_HEIGHT, currency))
        cursor -= block.height
      }
    }

    if (isLastPage) {
      const ruleY = cursor
      cursor -= TOTAL_GAP
      const y = cursor - LINE_HEIGHT
      ops.push(
        rect({ x: LEFT, y: ruleY - 2, width: RIGHT - LEFT, height: 0.5, color: PAPER.rule }),
        text({ x: COL.project, y, text: "TOTAL", size: TYPE.strong, bold: true }),
        // `totals.percent` — the one derivation report-rows.ts computes (see
        // `percentOf(totalMs, totalMs)` there) — not a hardcoded "100%",
        // which disagreed with CSV/XLSX for an empty range, where there is
        // no duration for 100% to be a share OF. `mutedPercent: false`
        // because TOTAL is already the page's own emphasis (bold, strong
        // size), not a subordinate figure the way a body row's or a week's
        // subtotal's % is.
        ...numericColumnsOps(y, {
          durationMs: rows.totals.totalMs,
          percent: rows.totals.percent,
          billableCents: rows.totals.billableCents,
          currency,
          unpriced: rows.totals.unpriced,
          size: TYPE.strong,
          bold: true,
          mutedPercent: false,
        })
      )
      cursor -= totalRowHeight
      if (rows.titlesTruncated) {
        ops.push(
          text({ x: LEFT, y: y - 26, text: TITLE_CAP_NOTE, size: TYPE.body, color: PAPER.inkMuted })
        )
      }
      if (rows.totals.unpriced) {
        ops.push(
          text({ x: LEFT, y: y - 44, text: UNPRICED_NOTE, size: TYPE.body, color: PAPER.inkMuted })
        )
      }
    }

    pages.push({ ops })
  })

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
        size: TYPE.footer,
        align: "right",
        color: PAPER.inkMuted,
      })
    )
  })

  return finished
}
