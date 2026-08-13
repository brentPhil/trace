import { formatClock } from "@shared/duration"
import { formatMoney } from "@shared/money"
import { hourTicks } from "@/lib/report-series"
import { usDate } from "../../us-date"
import { NOTES_CAP_NOTE, TITLE_CAP_NOTE, UNPRICED_NOTE } from "../report-rows"
import {
  axisTickIndices,
  barColumns,
  donutSlices,
  rect,
  text,
  textWidth,
  truncateToWidth,
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

/**
 * How far a week's rows are inset from the band that opens the week.
 *
 * The band spans the full content width; its rows sit inside it. That indent is
 * what makes the band read as a container rather than as one more line of text,
 * and it is the whole separation mechanism now that the per-row rules are gone —
 * DESIGN.md's "every block is left-flush" governs PAGE blocks, and a week is a
 * group within one, not a block of its own.
 *
 * Modest on purpose: the description is the widest thing this document prints,
 * and every point spent here is a point it loses.
 */
const LIST_INDENT = 12

/**
 * Where the breakdown's two numeric columns sit. Right-aligned columns give
 * their right edge, which is what `align: "right"` measures from.
 *
 * Exported so tests can assert the no-overlap geometry directly against the
 * same anchors this file draws with, instead of duplicating the numbers.
 *
 * THIS IS NO LONGER A TABLE, and the shape is why the column list is down to
 * two. A five-column grid with a rule under every row read as an approval
 * sheet — the enterprise-timesheet look DESIGN.md rejects by name — so the
 * breakdown is now a LIST grouped under week bands: the project sits on its
 * own muted line, the description runs full width beneath it, and only the two
 * figures a reader scans down stay in columns. What separates one row from the
 * next is whitespace, not ruling.
 *
 * HOURS IS GONE. It restated DURATION in the unit AMOUNT is computed from, and
 * the argument for keeping it was the audit trail: `7:51:34` → `7.86` →
 * `$471.60` is the arithmetic a client reconciles. That argument was for a
 * table; on a list, a third figure per row is a third thing to skip past on
 * every one of five hundred rows, and the middle term is the one nobody reads
 * aloud. It survives in full in the CSV and XLSX writers, which carry every
 * column — this is the human-readable cut, not the data. (`%` went earlier, for
 * a related reason recorded in git: a column of "0%" and "1%".)
 *
 * PROJECT is no longer a column either. It was a fixed 100pt gutter sized for
 * names this app does not have ("Sealogs", "No project"), spent on every row
 * whether or not the project changed, while the description — an imported
 * ticket title that genuinely runs long — wrapped to three lines beside it.
 * Moving it above the description gives that width back.
 *
 * The two gaps are each sized to clear their OWN column's worst-case string at
 * the body and Total sizes below, not their neighbour's, since both are
 * right-aligned and grow leftward: AMOUNT gets the wider one (110) because a
 * formatted currency string (`$999,999.99`) is the widest thing either draws.
 */
export const COL = {
  description: LEFT + LIST_INDENT,
  duration: RIGHT - 110,
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

/**
 * The leading between two note lines.
 *
 * Tighter than `LINE_HEIGHT` because notes are set at `TYPE.tick` rather than
 * `TYPE.body`, and leading that does not follow the size it is setting reads as
 * a gap rather than as a paragraph. A five-note row is the common heavy case
 * and this is what keeps it from taking half a page.
 */
const NOTE_LINE_HEIGHT = 10

/**
 * The step from a row's LAST description baseline to its FIRST note baseline.
 *
 * Larger than `NOTE_LINE_HEIGHT` because it spans a size change — 10pt body
 * down to 8.5pt caption — and a step sized for the smaller of the two crowds
 * the note against the description it belongs to.
 *
 * It has to appear in `sizeRow`'s height as well as in the drawer, and it did
 * not: the reserve allotted a plain `NOTE_LINE_HEIGHT` for a line the drawer
 * places 14pt down, so a row with notes ended up with 4pt of trailing
 * whitespace where a bare row has the full `ROW_PADDING` of 8. That never
 * overran anything, but whitespace is now the ENTIRE separation between rows
 * (see WEEK_GAP's note on the hairlines coming out), so halving it halves the
 * only thing telling two rows apart.
 */
const NOTE_BLOCK_LEAD = 14

/** The Total row to the first footnote under it. Wider than a row gap because
 *  these are two different kinds of thing: the sum, and a caveat about how the
 *  document was produced. */
const FOOTNOTE_GAP = 22

/** The vertical space a row of `lineCount` wrapped lines actually occupies,
 *  including the gap before the next row. The one formula both the packer
 *  (`reportPages`) and the TOTAL-row reservation below must agree on — two
 *  independent height calculations are two things that can silently drift
 *  apart the next time either changes. */
function rowSlotHeight(lineCount: number): number {
  return lineCount * LINE_HEIGHT + ROW_PADDING
}

const HEADER_GAP = 33

function moneyOr(cents: number, currency: string, unpriced: boolean): string {
  return unpriced ? "—" : formatMoney(cents, currency)
}

/** The range, as this document names it in its title and repeats it on every
 *  continuation page. One phrasing, because two would drift. */
function rangeText(meta: ReportRows["meta"]): string {
  return `${usDate(meta.from)} to ${usDate(meta.to)}`
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
/** A tile's own share of the content width — four across, edge to edge. */
const TILE_WIDTH = (RIGHT - LEFT) / 4

/**
 * The largest size at or below `TYPE.tileValue` that keeps `value` inside its
 * own tile, floored so it can never shrink into the caption sizes around it.
 *
 * A tile value is drawn at a FIXED x with no cell boundary to stop it, so a
 * long one simply prints over the tile to its right: `$999,999.99` at 18pt bold
 * is ~131pt against a 124.8pt tile, and the two tiles' figures then run
 * together into one unreadable number. This is the same overprint the breakdown
 * table's DESCRIPTION column had — except an amount cannot be wrapped (a
 * currency figure broken across two lines is two figures) and must not be
 * truncated (an elided amount is a wrong amount), so the remaining lever is the
 * size. Width scales linearly with point size, so one division finds the fit
 * exactly rather than stepping down a ladder until something looks right.
 *
 * The floor is `TYPE.strong`, the step the TOTAL row uses: below that a
 * headline figure stops reading as a headline. A value wide enough to overflow
 * even at the floor is a nine-figure amount, which this product has no other
 * handling for either.
 */
function tileValueSize(value: string): number {
  const perPoint = textWidth(value, 1, true)
  if (perPoint <= 0) return TYPE.tileValue
  const fitted = (TILE_WIDTH - 8) / perPoint
  return Math.max(TYPE.strong, Math.min(TYPE.tileValue, fitted))
}

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
      size: tileValueSize(value),
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

/** `1 day` / `2 days`. Written once because this document counts three
 *  different things and "over 1 days worked" reached a client on every
 *  single-day export. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * The plot area's left inset — room for the y-axis's own labels.
 *
 * Sized against `24h`/`48h` (the widest tick `hourTicks` produces before its
 * step outgrows a day) at `TYPE.tick`, plus a gutter, so a label never touches
 * the leftmost bar. The plot is inset rather than the labels hung outside the
 * margin: a document that prints anything in its own margin is a document that
 * gets clipped by somebody's printer.
 */
const AXIS_GUTTER = 8
const AXIS_LABEL_WIDTH = 18

/**
 * The y-axis: a gridline and a label per round-hour tick, behind the bars.
 *
 * THE SCALE IS THE ONE PART OF A CHART THAT MUST BE BEYOND QUESTION (DESIGN.md,
 * §5 Charts) — and until this existed the PDF's chart had no scale at all. It
 * was a row of bars with a day label under each and nothing to read a height
 * against, so the tallest bar could have been four hours or fourteen and
 * nothing on the page said which. The screen version of this same chart has
 * carried round-number gridlines since it shipped; the exported one, which is
 * the copy that reaches a client, did not.
 *
 * `hourTicks` is the app's own, shared with the on-screen chart, so the two
 * renderings of the same range cannot label a gridline differently — the exact
 * failure `hourAxis`'s docstring describes.
 *
 * Drawn BEFORE the bars by every caller, so a gridline reads as ruling behind
 * the data rather than a line struck through it.
 */
function hourAxisOps(
  ticks: ReadonlyArray<number>,
  box: { x: number; y: number; width: number; height: number }
): Array<PdfOp> {
  // `.at(-1)` rather than `ticks[ticks.length - 1]`: it is typed as possibly
  // absent, which an empty array genuinely is, and `?? 0` then falls into the
  // guard below instead of dividing by `undefined`.
  const top = ticks.at(-1) ?? 0
  if (top <= 0) return []

  const ops: Array<PdfOp> = []
  for (const tick of ticks) {
    const y = box.y + (tick / top) * box.height
    ops.push(
      // The zero line is the baseline the bars stand on and reads as structure,
      // not as ruling — every other gridline is the fainter weight so the bars
      // stay the loudest thing in the plot.
      rect({
        x: box.x,
        y,
        width: box.width,
        height: 0.5,
        color: tick === 0 ? PAPER.rule : PAPER.ruleFaint,
      }),
      text({
        x: box.x - AXIS_GUTTER,
        // Half a cap-height up, so the label reads as sitting ON its gridline
        // rather than hanging beneath it.
        y: y - 3,
        text: `${Math.round(tick / 3_600_000)}h`,
        size: TYPE.tick,
        align: "right",
        color: PAPER.inkMuted,
      })
    )
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
      text: `Summary report from ${rangeText(meta)}`,
      size: TYPE.title,
      bold: true,
    }),
    // The title sat on nothing, 65pt above the first thing it introduced, and
    // read as adrift on the page rather than as this document's masthead. A
    // hairline is what closes that gap without spending a size step on it.
    rect({ x: LEFT, y: TOP - 16, width: RIGHT - LEFT, height: 0.5, color: PAPER.rule })
  )

  // ---- Block 1: the four tiles -------------------------------------------
  const tileY = TOP - 58
  const tileWidth = TILE_WIDTH
  ops.push(
    /*
     * ALL FOUR TILES NOW FILL ALL THREE SLOTS. `tile`'s own docstring says a
     * reader learns the shape once, and two of the four were leaving the
     * sub-line empty — which reads as a missing figure rather than as a figure
     * that needs no qualifier. Both additions are facts nothing else on this
     * page states: the entry count is the sample the whole document is drawn
     * from, and the currency is otherwise only inferable from a `$` glyph that
     * several supported currencies do not use.
     */
    ...tile(LEFT, tileY, "Total hours", formatClock(totals.totalMs), {
      subLine: plural(totals.count, "entry", "entries"),
    }),
    // P1-6: the percent used to be glued onto the duration string
    // (`40:17:00  100%`), which reads as one figure. It is a qualifier of the
    // duration, not part of it, so it gets the tile's sub-line — the same
    // slot Average daily hours already uses for its divisor below.
    ...tile(LEFT + tileWidth, tileY, "Billable hours", formatClock(totals.billableMs), {
      subLine: `${totals.billablePercent}% of total`,
    }),
    ...tile(
      LEFT + tileWidth * 2,
      tileY,
      "Amount",
      moneyOr(totals.billableCents, meta.currency, totals.unpriced),
      { brass: true, subLine: meta.currency }
    ),
    /*
     * The divisor, stated. "7.6 h/day" over a fortnight with weekends off is a
     * different claim from "9.0 h/day over 11 days worked", and the first one
     * argues against the user in a rate conversation. Leaving the reader to
     * infer which was used is the same defect as an unqualified amount.
     */
    ...tile(LEFT + tileWidth * 3, tileY, "Average daily hours", formatClock(totals.averageDailyMs), {
      subLine: `over ${plural(meta.daysWorked, "day", "days")} worked`,
    })
  )

  if (totals.unpriced) {
    ops.push(
      text({ x: LEFT, y: tileY - 62, text: UNPRICED_NOTE, size: TYPE.body, color: PAPER.inkMuted })
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
   *
   * The heights below are what remained of that budget after the y-axis
   * arrived: the plot grew (200 → 228) because it is this page's primary
   * evidence, and the donut shrank (95 → 82 radius) to pay for a legend wide
   * enough to carry a fourth column. Together they land the donut's bottom
   * edge ~84pt above the footer, which reads as a bottom margin rather than as
   * the third of a page that used to be left over.
   */
  const chartTop = tileY - 96
  const CHART_HEIGHT = 228
  const chartBox = {
    x: LEFT + AXIS_LABEL_WIDTH + AXIS_GUTTER,
    y: chartTop - 22 - CHART_HEIGHT,
    width: RIGHT - LEFT - AXIS_LABEL_WIDTH - AXIS_GUTTER,
    height: CHART_HEIGHT,
  }

  ops.push(text({ x: LEFT, y: chartTop, text: "Duration by day", size: TYPE.heading, bold: true }))

  /*
   * AN EMPTY BLOCK STATES ITS ABSENCE; it does not draw its furniture over
   * nothing. With no buckets there is no scale to state, and drawing one
   * anyway put a labelled `1h`/`0h` axis and a Billable/Non-billable legend
   * around 228pt of blank paper — a chart claiming to measure a series that is
   * not there. `invoice-doc.ts` already settled this for its own empty table
   * ("stating the absence and totalling it at zero"), and the two documents are
   * handed over together.
   *
   * The block also COLLAPSES rather than reserving its full height, so what
   * follows moves up instead of sitting below a void. `chartBlockBottom` is
   * what the next block measures from; in the populated case it is exactly the
   * legend baseline the old fixed geometry used, so nothing moves.
   */
  let chartBlockBottom: number
  if (rows.buckets.length === 0) {
    ops.push(
      text({
        x: LEFT,
        y: chartTop - 20,
        text: "Nothing was tracked in this range.",
        size: TYPE.body,
        color: PAPER.inkMuted,
      })
    )
    chartBlockBottom = chartTop - 20
  } else {
    chartBlockBottom = chartBox.y - 33
    /* ONE axis top for the gridlines and the bars alike — see `barColumns`. The
     * domain is the tallest STACK, not the tallest billable segment, because the
     * two segments are stacked and it is their sum that has to fit. */
    const tallestStack = Math.max(
      0,
      ...rows.buckets.map((bucket) => bucket.billableMs + bucket.nonBillableMs)
    )
    const ticks = hourTicks(tallestStack)
    ops.push(...hourAxisOps(ticks, chartBox), ...barColumns(rows.buckets, chartBox, ticks.at(-1)))

  // P0-2: thin the x-axis ticks so labels stop colliding. A 31-day range at
  // `TYPE.tick` across this box's width drew all 31 and `Mon 10` overlapped
  // `Mon 1`; `axisTickIndices` measures the widest label actually present and
  // steps by however many buckets that takes, always keeping the first and
  // last so the axis still states its own range. Raising the tick size (was
  // 6pt) only shrinks the gap `axisTickIndices` has to work with, which is
  // exactly what it is for — it thins further, it does not stop working.
    const slot = chartBox.width / rows.buckets.length
    const bucketLabels = rows.buckets.map((bucket) => bucket.label)
    axisTickIndices(bucketLabels, chartBox.width, TYPE.tick, false).forEach((index) => {
      const label = bucketLabels[index]
      /*
       * CENTRED UNDER ITS OWN BAR, THEN CLAMPED TO THE PAGE.
       *
       * Anchoring a label at its slot's left EDGE (what this did before) points
       * it at the gap before the bar rather than at the bar, which on a thinned
       * axis — where a kept label may be six buckets from its neighbour — reads
       * as labelling the wrong day. The clamp is not defensive tidying: the last
       * kept tick is the last bucket, its slot is the rightmost one on the plot,
       * and `Fri 31` centred there ran ~8pt past the right margin. It did so
       * left-anchored too, which is a label printed in the paper's own margin.
       */
      const width = textWidth(label, TYPE.tick, false)
      const centered = chartBox.x + index * slot + slot / 2
      const x = Math.min(Math.max(centered, chartBox.x + width / 2), RIGHT - width / 2)
      ops.push(
        text({
          x,
          y: chartBox.y - 15,
          text: label,
          size: TYPE.tick,
          align: "center",
          color: PAPER.inkMuted,
        })
      )
    })

    // Both series named. DESIGN.md: meaning is never carried by colour alone,
    // and a legend is what discharges that for a stacked bar.
    ops.push(
      rect({ x: LEFT, y: chartBox.y - 34, width: 9, height: 9, color: PAPER.bar }),
      text({
        x: LEFT + 13,
        y: chartBox.y - 33,
        text: "Billable",
        size: TYPE.body,
        color: PAPER.inkMuted,
      }),
      rect({ x: LEFT + 80, y: chartBox.y - 34, width: 9, height: 9, color: PAPER.barMuted }),
      text({
        x: LEFT + 93,
        y: chartBox.y - 33,
        text: "Non-billable",
        size: TYPE.body,
        color: PAPER.inkMuted,
      })
    )
  }

  // ---- Block 3: project distribution -------------------------------------
  // Measured from whatever the chart block actually ended at, so an empty
  // chart does not leave this one stranded below 228pt of blank paper.
  const donutTop = chartBlockBottom - 33
  const DONUT_RADIUS = 82
  const DONUT_INNER = 47
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
  const DONUT_HEADING_CLEARANCE = 28 // heading's own ~10pt cap height (TYPE.heading) plus a visual gutter
  const donutCenterY = donutTop - DONUT_HEADING_CLEARANCE - DONUT_RADIUS
  const cx = LEFT + DONUT_RADIUS + 8
  const cy = PAGE.height - donutCenterY
  ops.push(
    text({ x: LEFT, y: donutTop, text: "Project distribution", size: TYPE.heading, bold: true })
  )

  /*
   * Same rule as the chart block above: no projects, no furniture. Drawing the
   * populated branch over an empty list put a four-column header
   * (Project / Share / Duration / Amount) above no rows, and left the hole's
   * `0:00:00 tracked` label floating on bare paper with no ring around it —
   * a caption for a chart that was never drawn.
   */
  if (rows.projects.length === 0) {
    ops.push(
      text({
        x: LEFT,
        y: donutTop - 20,
        text: "No project time in this range.",
        size: TYPE.body,
        color: PAPER.inkMuted,
      })
    )
    return { ops }
  }

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

  /*
   * THE HOLE, LABELLED. A donut's centre is the one place a reader looks for
   * the whole the slices are shares OF, and this one was empty — so "51.6%"
   * beside a slice was a share of a figure printed 300pt away in a tile. The
   * range's own total closes that without adding a figure the document did not
   * already state.
   *
   * Centred through `align: "center"` rather than by measuring here: the
   * measurement that matters is the embedded font's, and `render.ts` is the
   * only file that has it.
   */
  ops.push(
    text({
      x: cx,
      y: donutCenterY + 2,
      text: formatClock(totals.totalMs),
      size: TYPE.body,
      bold: true,
      align: "center",
    }),
    text({
      x: cx,
      y: donutCenterY - 11,
      text: "tracked",
      size: TYPE.tick,
      align: "center",
      color: PAPER.inkMuted,
    })
  )

  /*
   * P1-7: the %/duration columns used to sit at the page's right margin,
   * separated from the project name by whatever space happened to be left
   * over. Anchoring them a fixed distance from the legend's own start (as the
   * breakdown table's columns already are from LEFT) keeps the row reading
   * as one unit regardless of how wide the page's content area is.
   *
   * AMOUNT IS THE FOURTH COLUMN, and it is the reason the donut gave up 13pt
   * of radius. What a project EARNED over the range appears nowhere else in
   * this document: the breakdown table totals by description and by week, the
   * tiles total the range, and neither answers "what is this client worth this
   * month" — the question a freelancer carrying three clients opens the report
   * to ask. The empty band to the right of the legend was the space it needed.
   *
   * Unpriced is judged per project from `unratedBillableMs`, the same "ANY
   * unrated billable time means this figure is a floor" rule `ReportRows`
   * documents for the grand total, so a legend row cannot claim a complete
   * amount the TOTAL row would dash out.
   */
  const legendX = cx + DONUT_RADIUS + 24
  const LEGEND_COL = { name: 14, percent: 160, duration: 228, amount: RIGHT - legendX }

  const legendCell = (
    x: number,
    y: number,
    value: string,
    opts: { bold?: boolean; color?: (typeof PAPER)[keyof typeof PAPER] } = {}
  ): PdfOp =>
    text({ x: legendX + x, y, text: value, size: TYPE.body, align: "right", ...opts })

  // The legend is a table, so it names its own columns — the same reason the
  // breakdown table repeats its header on every page. Four unlabelled numbers
  // beside a colour is a row a reader has to decode.
  const legendHeadY = donutTop - 24
  ops.push(
    text({
      x: legendX + LEGEND_COL.name,
      y: legendHeadY,
      text: "Project",
      size: TYPE.tick,
      color: PAPER.inkMuted,
    }),
    ...(["percent", "duration", "amount"] as const).map((key, n) =>
      text({
        x: legendX + LEGEND_COL[key],
        y: legendHeadY,
        text: ["Share", "Duration", "Amount"][n],
        size: TYPE.tick,
        align: "right",
        color: PAPER.inkMuted,
      })
    ),
    rect({
      x: legendX,
      y: legendHeadY - 7,
      width: RIGHT - legendX,
      height: 0.5,
      color: PAPER.rule,
    })
  )

  /*
   * THE NAME'S BUDGET, measured — the same reservation the breakdown table's
   * DESCRIPTION column computes, and for the same reason it needs one.
   *
   * SHARE is right-aligned, so `LEGEND_COL.percent` is where its glyphs END and
   * they extend LEFTWARD by the string's own width. A name drawn with no bound
   * ran straight through them: `Vessel Vanguard Maritime` (~124pt at
   * `TYPE.body`) against a 113pt gap overprinted `15.36%`, on the one block of
   * this document that states what each client is worth. Measuring against the
   * WIDEST share actually on the page, rather than a constant sized for `100%`,
   * is what keeps that closed for a two-decimal share like `15.36%` — which is
   * the shape `percentOf` produces for every project in a busy month.
   */
  const widestShare = Math.max(
    0,
    ...rows.projects.map((project) => textWidth(`${project.percent}%`, TYPE.body, false))
  )
  const nameMaxWidth = LEGEND_COL.percent - widestShare - GUTTER - LEGEND_COL.name

  rows.projects.forEach((project, index) => {
    const y = donutTop - 42 - index * 17
    const unpriced = project.unratedBillableMs > 0
    ops.push(
      rect({
        x: legendX,
        y,
        width: 9,
        height: 9,
        color: paperColorFor(project.color),
      }),
      text({
        x: legendX + LEGEND_COL.name,
        y: y + 1,
        text: truncateToWidth(project.name, nameMaxWidth, TYPE.body, false),
        size: TYPE.body,
      }),
      legendCell(LEGEND_COL.percent, y + 1, `${project.percent}%`, { color: PAPER.inkMuted }),
      legendCell(LEGEND_COL.duration, y + 1, formatClock(project.totalMs)),
      // Brass is a CURRENCY amount and nothing else — the same rule, and the
      // same dash-when-unpriced treatment, as every other amount in this file.
      legendCell(
        LEGEND_COL.amount,
        y + 1,
        moneyOr(project.billableCents, meta.currency, unpriced),
        { color: unpriced ? PAPER.inkMuted : PAPER.brass }
      )
    )
  })

  return { ops }
}

export const BREAKDOWN_TITLE = "Project and description breakdown"

/**
 * The block heading plus the column header, drawn identically on every page of
 * the table. Repeated rather than drawn once: a continuation page with
 * unlabelled columns is a page of unattributed numbers.
 *
 * THE RANGE IS REPEATED TOO. Printed paper separates, and a page three carrying
 * a table of hours and dollars with nothing naming what it covers is a page of
 * unattributed money the moment it leaves the stapler.
 *
 * There is deliberately NO "(continued)" marker. It was here, and it was
 * telling the reader something the page already shows: the footer says
 * `Page 3 / 4`, which states both that pages precede this one and how many
 * follow — strictly more than the word did. Repeating the TITLE and the RANGE
 * is what carries attribution; annotating the repetition is caption for a
 * reader who has been assumed not to notice a page number.
 *
 * COLUMN HEADERS ARE SENTENCE CASE, not the tracked-out `PROJECT` /
 * `DESCRIPTION` they were. DESIGN.md's Sentence Case Rule names column headers
 * explicitly, and uppercase labels are the scaffold the system rejects for
 * making an instrument look like a landing page.
 *
 * ONLY THE TWO NUMERIC COLUMNS ARE LABELLED. A `Description` label survived the
 * move to a list and had stopped being true: the first line of every row is now
 * the PROJECT, with the description on the line beneath it, so the label sat
 * over something that was not directly under it. Duration and Amount are still
 * columns in the strict sense — one figure per row, right-aligned, scanned
 * downward — and those are the two a reader needs named.
 */
function breakdownHeader(meta: ReportRows["meta"]): Array<PdfOp> {
  const y = TOP - 30
  const label = (x: number, caption: string, align?: "right"): PdfOp =>
    text({ x, y, text: caption, size: TYPE.tick, align, color: PAPER.inkMuted })
  return [
    text({ x: LEFT, y: TOP, text: BREAKDOWN_TITLE, size: TYPE.heading, bold: true }),
    text({
      x: RIGHT,
      y: TOP,
      text: rangeText(meta),
      size: TYPE.body,
      align: "right",
      color: PAPER.inkMuted,
    }),
    label(COL.duration, "Duration", "right"),
    label(COL.amount, "Amount", "right"),
    rect({ x: LEFT, y: y - 7, width: RIGHT - LEFT, height: 0.5, color: PAPER.rule }),
  ]
}

/*
 * P0-1: a long description ran straight through the DURATION column — text was
 * drawn at a column x with no width limit, so `[B-CB-326] Building Crew
 * Training CSV and PDF download` overprinted `7:51:34` on a document a client
 * reconciles against an invoice.
 *
 * A first truncation pass measured the description's budget as the raw distance
 * up to `COL.duration` minus a gap. That still collided, because DURATION is
 * right-aligned: `COL.duration` is where its glyphs END, and they extend
 * LEFTWARD from there by the string's own width. Measuring "up to COL.duration"
 * measures up to a line the duration text has already crossed — the two cells'
 * claimed regions overlap by exactly the width of whatever duration is on that
 * row.
 *
 * `GUTTER` is real, deliberate whitespace (not a rounding fudge) — enough that
 * a description and the duration beside it read as two things rather than one
 * run-on line even when the description fills its budget exactly.
 */
const GUTTER = 10

/**
 * The bullet a note line is marked with, and the extra indent its text carries
 * beyond the row's own.
 *
 * A note is a DIFFERENT KIND of thing from the description above it — the
 * description names the work, the note says how it went — and on a document a
 * client reads, the two must not be mistakable for one another. It is set
 * smaller and muted for that reason, and indented under the description so it
 * reads as belonging to that row rather than starting a new one.
 */
const NOTE_BULLET = "·"
const NOTE_INDENT = 14

/**
 * The hanging indent a note's CONTINUATION lines carry, so wrapped text aligns
 * under the first line's text rather than under its bullet.
 *
 * Measured from the bullet-and-space actually drawn rather than guessed, so it
 * stays correct if the marker ever changes.
 */
const NOTE_HANG = textWidth(`${NOTE_BULLET} `, TYPE.tick, false)

/**
 * The most note LINES one row may draw.
 *
 * THE BOUND THAT KEEPS A ROW ON ITS PAGE. The packer places a row atomically —
 * a description and the figures on its first line cannot be separated — and
 * falls back to letting an oversized row overflow a page of its own. That was a
 * safe trade while a row's height was bounded by a wrapped ticket title. Notes
 * broke it: the server permits `NOTES_PER_ROW_LIMIT` (5) notes of
 * `MAX_NOTE_LENGTH` (2,000) characters each, and 10,000 characters at this
 * width and size is ~150 lines — roughly 1,500pt on a 713pt page body.
 * Everything past the bottom margin is drawn at a y pdf-lib silently discards,
 * so note text would disappear from a client's document with no marker at all.
 *
 * 34 lines is ~2,200 characters, so ONE maximal note still prints whole, and it
 * bounds the tallest row this document can produce (a 500-character
 * description wraps to nine lines) at ~470pt. That it actually fits the
 * smallest per-page budget is asserted by a test rather than trusted to this
 * arithmetic.
 *
 * Clipping here is reported, never silent: it feeds the same `NOTES_CAP_NOTE`
 * footnote the server's own character budget does.
 */
const NOTE_LINES_PER_ROW_LIMIT = 34

/**
 * A row, pre-measured: the project line, the wrapped description, and the
 * wrapped notes, plus the height all of that occupies.
 *
 * Computed once per row up front — the packer (deciding what fits on a page)
 * and the drawer (turning a placed row into ops) both need the SAME wrapped
 * lines, and recomputing `wrapToWidth` at draw time risks the two disagreeing
 * about a row's height versus what actually gets drawn into it.
 *
 * `noteLines` is flat, not per-note: a note that wraps to three lines and three
 * one-line notes occupy the same space and are drawn by the same loop, so the
 * bullet is baked into the first line of each note here rather than tracked as
 * structure the drawer would have to re-derive.
 */
type NoteLine = {
  text: string
  /** A continuation of the note above it, so it is drawn at the hanging
   *  indent and carries no bullet of its own. */
  hanging: boolean
}

type SizedRow = {
  row: ReportRows["titles"][number]
  descriptionLines: Array<string>
  noteLines: Array<NoteLine>
  /** Some of this row's notes exceeded `NOTE_LINES_PER_ROW_LIMIT` and are not
   *  drawn. Collected across the document so the footnote can say so. */
  notesClipped: boolean
  height: number
}

/**
 * A row's own height: one line for the project, its description's lines, its
 * notes' lines, and the gap before the next row.
 *
 * The project line is unconditional even when the project is "" — `reportRows`
 * substitutes `NO_PROJECT_LABEL` for that, so there is always something to
 * draw, and a row that sometimes has the line and sometimes does not would give
 * the list two different rhythms.
 */
function sizeRow(row: ReportRows["titles"][number], descriptionMaxWidth: number): SizedRow {
  const descriptionLines = wrapToWidth(row.description, descriptionMaxWidth, TYPE.body, false)
  /*
   * Notes wrap into the description's own column, measured at `TYPE.tick` —
   * the size they are drawn at. Measuring them at the body size would
   * over-estimate every line and wrap them earlier than they need to, which on
   * a five-note row is several wasted lines.
   *
   * Wrapped WITHOUT the bullet and to the HUNG width, so every line of a note —
   * first or continuation — is measured against the column its text actually
   * occupies. Prefixing the bullet before wrapping (the obvious shape) makes
   * the first line one bullet narrower than the rest and leaves continuations
   * aligned under the marker instead of under the text.
   *
   * WHOLE NOTES WHILE THEY FIT `NOTE_LINES_PER_ROW_LIMIT`, matching the rule
   * the server applies to its own character budget: half a note is a sentence
   * that stops mid-clause on a document a client reads. The single exception is
   * a FIRST note too long to fit on its own — there, clipping beats dropping,
   * because dropping leaves the row silent about work somebody did write up,
   * and the footnote says either way.
   */
  const noteWidth = descriptionMaxWidth - NOTE_INDENT - NOTE_HANG
  const noteLines: Array<NoteLine> = []
  let notesClipped = false
  for (const note of row.notes) {
    const wrapped: Array<NoteLine> = wrapToWidth(note, noteWidth, TYPE.tick, false).map(
      (line, n) => ({ text: line, hanging: n > 0 })
    )
    if (noteLines.length + wrapped.length > NOTE_LINES_PER_ROW_LIMIT) {
      notesClipped = true
      if (noteLines.length === 0) noteLines.push(...wrapped.slice(0, NOTE_LINES_PER_ROW_LIMIT))
      break
    }
    noteLines.push(...wrapped)
  }

  return {
    row,
    descriptionLines,
    noteLines,
    notesClipped,
    // The note block costs its own lead-in plus one `NOTE_LINE_HEIGHT` per line
    // AFTER the first — the first line's step from the description is the
    // lead-in itself. Nothing at all when there are no notes.
    height:
      rowSlotHeight(1 + descriptionLines.length) +
      (noteLines.length === 0
        ? 0
        : NOTE_BLOCK_LEAD + (noteLines.length - 1) * NOTE_LINE_HEIGHT),
  }
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

/**
 * The air a week band takes above itself, and the air its subtotal takes below.
 *
 * These are now the ONLY separation in the breakdown. The per-row hairline that
 * used to close every body row is gone: with a rule under all five hundred rows
 * the document read as an approval grid — the enterprise-timesheet look
 * DESIGN.md rejects by name — and the thing it was solving (losing which row an
 * amount belonged to) is solved better by the row's own shape, since each one
 * now opens with a project line and the figures sit on the description's first
 * line rather than floating at its midpoint.
 *
 * Spending the separation on POSITION and one tinted band, rather than on more
 * type sizes, is what keeps the list at two levels: a week opens on a band, a
 * row opens on white.
 *
 * Both are folded into their block's own `height` so the packer reserves them.
 * A separator the drawer adds and the packer does not know about is a document
 * that overruns its last page by exactly the number of weeks on it.
 */
const WEEK_GAP = 18
const SUBTOTAL_SPACE = 10

/** The band's own height, and where the label's baseline sits inside it. */
const BAND_HEIGHT = 20
const BAND_BASELINE = 6

/**
 * A week's band: a tinted full-width strip carrying the week's label.
 *
 * A FILL rather than a rule, and it is the one filled shape in the document.
 * The week is the only grouping in the breakdown, it has to survive being found
 * halfway down a page of five hundred rows, and a rule at this weight had
 * already proved too quiet — it was indistinguishable from the row hairlines
 * running under everything else. A band is unambiguous at a glance and costs no
 * type size to say.
 *
 * `y` is the bottom of the band, which is where the block's cursor already is.
 */
function weekBandOps(label: string, y: number): Array<PdfOp> {
  return [
    rect({ x: LEFT, y, width: RIGHT - LEFT, height: BAND_HEIGHT, color: PAPER.band }),
    text({ x: LEFT + LIST_INDENT, y: y + BAND_BASELINE, text: label, size: TYPE.body, bold: true }),
  ]
}

/**
 * The two right-aligned numeric columns — DURATION and AMOUNT — laid out once
 * and shared by a body row, a week's subtotal, and the grand Total. Written out
 * three times before this, the file's own comments each pointed at the other
 * two copies to explain a rule ("brass is a CURRENCY amount and nothing else")
 * that a near-miss had already shown could drift between them — a fourth copy
 * is how it actually would.
 *
 * Down from four columns: `%` went on 2026-08-12 and HOURS with the move to a
 * list (see COL). Each removal deleted an argument this took rather than a
 * branch inside it, which is why the three call sites stayed identical.
 */
function numericColumnsOps(
  y: number,
  opts: {
    durationMs: number
    billableCents: number
    currency: string
    unpriced: boolean
    size: number
    bold: boolean
  }
): Array<PdfOp> {
  const { durationMs, billableCents, currency, unpriced, size, bold } = opts
  return [
    text({ x: COL.duration, y, text: formatClock(durationMs), size, bold, align: "right" }),
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
    // At the list's own indent, so it sits under the descriptions it sums
    // rather than out at the week band's edge.
    text({ x: COL.description, y, text: "Subtotal", size: TYPE.body, bold: true }),
    ...numericColumnsOps(y, {
      durationMs: week.subtotal.totalMs,
      billableCents: week.subtotal.billableCents,
      currency,
      unpriced: week.subtotal.unpriced,
      size: TYPE.body,
      bold: true,
    }),
  ]
}

/**
 * One row of the list: the project, the description, the two figures, and the
 * notes when the export carries them.
 *
 * THE FIGURES SIT ON THE FIRST DESCRIPTION LINE, not centred against the block.
 * Centring was right when this was a table — rows were adjacent and separated
 * only by a hairline, so a duration glued to a two-line description's top line
 * read as though the second line belonged to the row below. On a list that
 * reasoning inverts: rows are separated by real whitespace and each one now
 * OPENS with its own project line, so the row's start is unambiguous, while a
 * row can run to eight lines once notes are on and a figure floating at the
 * midpoint of that has no relationship to anything a reader can point at. The
 * first line is where the row begins, and that is where its total belongs.
 */
function breakdownRow(
  sized: SizedRow,
  firstLineY: number,
  currency: string
): Array<PdfOp> {
  const { row, descriptionLines, noteLines } = sized

  // The project leads, muted and small — it is the row's heading, not its
  // content, and on a run of rows under one client it is the thing the eye
  // skips once it has been read.
  const ops: Array<PdfOp> = [
    text({
      x: COL.description,
      y: firstLineY,
      // Bounded to the list's own width. The project line has no column to its
      // right to collide with — the figures sit one line below it — so what it
      // can run off is the PAPER, and a name that leaves the page is text a
      // printer silently clips. Truncated rather than wrapped because a
      // two-line project heading over a one-line description inverts the row's
      // own hierarchy; at this size the bound is ~100 characters, which no real
      // project name reaches.
      text: truncateToWidth(row.project, RIGHT - COL.description, TYPE.tick, false),
      size: TYPE.tick,
      color: PAPER.inkMuted,
    }),
  ]

  const descriptionTop = firstLineY - LINE_HEIGHT
  descriptionLines.forEach((line, n) => {
    ops.push(
      text({ x: COL.description, y: descriptionTop - n * LINE_HEIGHT, text: line, size: TYPE.body })
    )
  })

  ops.push(
    ...numericColumnsOps(descriptionTop, {
      durationMs: row.totalMs,
      billableCents: row.billableCents,
      currency,
      unpriced: row.unpriced,
      size: TYPE.body,
      bold: false,
    })
  )

  // The last description baseline, then the block's lead-in. Written as the
  // same two terms `sizeRow` reserves, so the two cannot drift.
  const notesTop =
    descriptionTop - (descriptionLines.length - 1) * LINE_HEIGHT - NOTE_BLOCK_LEAD
  noteLines.forEach((line, n) => {
    ops.push(
      text({
        x: COL.description + NOTE_INDENT + (line.hanging ? NOTE_HANG : 0),
        y: notesTop - n * NOTE_LINE_HEIGHT,
        // The bullet leads the note's FIRST line only — repeating it on every
        // wrapped line would turn one note into several.
        text: line.hanging ? line.text : `${NOTE_BULLET} ${line.text}`,
        size: TYPE.tick,
        color: PAPER.inkMuted,
      })
    )
  })

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
   * EVERY ROW SIZED UP FRONT, before the footnotes are decided.
   *
   * Sizing is what discovers whether any row's notes had to be clipped to keep
   * it on its page (`NOTE_LINES_PER_ROW_LIMIT`), and that answer is an input to
   * the footnote block — whose own height every page then reserves. Sizing
   * lazily inside the week loop below, as this did, made the footnote depend on
   * work that had not happened yet.
   *
   * Keyed by the week's own `weekStart` rather than by position: `rows.weeks`
   * is a partition of `rows.titles`, so every week's rows are here exactly once.
   */
  const sizedByWeek = new Map(
    rows.weeks.map((week) => [
      week.weekStart,
      week.rows.map((row) => sizeRow(row, descriptionMaxWidth)),
    ])
  )
  const anyNotesClipped = [...sizedByWeek.values()]
    .flat()
    .some((sized) => sized.notesClipped)

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

  /*
   * THE FOOTNOTES, WRAPPED AND MEASURED BEFORE PAGINATION — and both halves of
   * that are fixes.
   *
   * They were drawn as ONE unbroken `text` op each, at hardcoded `y - 26` /
   * `y - 44` offsets. `TITLE_CAP_NOTE` is a 230-character sentence: ~1,265pt at
   * `TYPE.body` against 499pt of content width, so it ran two and a half
   * page-widths off the right edge and a reader saw a sentence that stopped
   * mid-word. It only ever appears on a truncated export, which is exactly the
   * document that most needs its warning read.
   *
   * Their HEIGHT was also never reserved, so on a last page that filled up they
   * printed below the bottom margin. Wrapping makes that worse (three notes can
   * now be nine lines), so the lines are computed up front and their height
   * joins `TOTAL_GAP` and the Total row in the reserve every page carries.
   */
  const footnoteLines = [
    rows.titlesTruncated ? TITLE_CAP_NOTE : null,
    /*
     * ONE sentence for BOTH ways notes can go missing — the server's character
     * budget running out (`rows.notesTruncated`) and a single row's notes being
     * too tall for a page (`anyNotesClipped`). They are different mechanisms
     * with the same consequence for the reader, and `NOTES_CAP_NOTE` already
     * says the thing that is true of both: some notes are not shown.
     *
     * Only ever reached when notes were asked for in the first place — a row
     * with no notes cannot clip, and `notesTruncated` is false by construction
     * when they were not requested. On an export that prints no notes there is
     * nothing missing to report, and saying so would invent a defect.
     */
    rows.notesTruncated || anyNotesClipped ? NOTES_CAP_NOTE : null,
    rows.totals.unpriced ? UNPRICED_NOTE : null,
  ]
    .filter((note): note is string => note !== null)
    // A blank line's worth of space after each, so two notes read as two
    // statements about the document rather than as one paragraph. Modelled as
    // a trailing null line so the height is just `length * LINE_HEIGHT`.
    .flatMap((note) => [...wrapToWidth(note, RIGHT - LEFT, TYPE.body, false), null])

  const footnoteReserve =
    footnoteLines.length === 0 ? 0 : FOOTNOTE_GAP + footnoteLines.length * LINE_HEIGHT

  const totalReserve = TOTAL_GAP + totalRowHeight + footnoteReserve

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
    const sizedWeekRows = sizedByWeek.get(week.weekStart) ?? []
    // The band's own separation from the week above it is part of the band's
    // block, and the subtotal's trailing space is part of the subtotal's — see
    // WEEK_GAP / SUBTOTAL_SPACE. Reserved here, spent identically by the drawer
    // below.
    const headingHeight = BAND_HEIGHT + WEEK_GAP
    const firstRowHeight = sizedWeekRows[0]?.height ?? 0

    if (current.length > 0 && used + headingHeight + firstRowHeight > perPageBudget) {
      breakPage()
    }
    current.push({ kind: "heading", label: week.label, height: headingHeight })
    used += headingHeight

    /*
     * A WEEK THAT SPANS A PAGE BREAK RE-ANNOUNCES ITSELF.
     *
     * The orphan rule above keeps a heading from being stranded at the foot of
     * a page without its first row. It says nothing about the other end, and
     * that end broke: a week whose rows ran past the page boundary left its
     * later rows — and its `Subtotal` — on a page that never names the week
     * they belong to. The observed case put three rows and a bold
     * `Subtotal 24:30:00` at the top of page three under nothing at all, which
     * on a document a client reconciles is a total of unattributed hours.
     *
     * The band carries the week's OWN label, unannotated. A repeated band at
     * the top of a page is already the convention for a group that spans a
     * break — the same one a repeated column header uses two lines above it —
     * and the footer's `Page 3 / 4` has already said that pages precede this
     * one. A "(continued)" suffix on top of both was caption for a reader
     * assumed not to have noticed either.
     *
     * Re-announcing costs one heading slot per break, charged to the new page's
     * budget here so the packer stays honest about what it placed.
     */
    function reopenWeek(): void {
      breakPage()
      current.push({ kind: "heading", label: week.label, height: headingHeight })
      used += headingHeight
    }

    sizedWeekRows.forEach((sized, index) => {
      // The first row is placed UNCONDITIONALLY, right after its heading —
      // the pair check above already decided whether the two fit together,
      // and re-checking here would let this row alone bump to a fresh page
      // while its heading stays behind, recreating the exact orphan the pair
      // check exists to prevent.
      if (index > 0 && used + sized.height > perPageBudget) {
        reopenWeek()
      }
      current.push({ kind: "row", sized, height: sized.height })
      used += sized.height
    })

    const subtotalHeight = rowSlotHeight(1) + SUBTOTAL_SPACE
    if (used + subtotalHeight > perPageBudget) reopenWeek()
    current.push({ kind: "subtotal", week, height: subtotalHeight })
    used += subtotalHeight
  }
  rowPages.push(current)

  rowPages.forEach((pageBlocks, pageIndex) => {
    const isLastPage = pageIndex === rowPages.length - 1
    const ops = breakdownHeader(rows.meta)

    // `cursor` is the y just below whatever was drawn last — the top
    // boundary the next block (or TOTAL) starts filling from.
    let cursor = TOP - HEADER_GAP
    for (const block of pageBlocks) {
      if (block.kind === "heading") {
        // The gap is spent ABOVE the band, so a week opens on white and the
        // block's total height still matches what the packer reserved.
        cursor -= block.height
        ops.push(...weekBandOps(block.label, cursor))
      } else if (block.kind === "row") {
        ops.push(...breakdownRow(block.sized, cursor - LINE_HEIGHT, currency))
        cursor -= block.height
      } else {
        ops.push(...weekSubtotalOps(block.week, cursor - LINE_HEIGHT, currency))
        cursor -= block.height
        // The week closes on a rule spanning only the LIST, not the full page
        // width the band spans — the band opens the week edge to edge, and a
        // closing rule of the same span would read as a second band rather
        // than as the end of the one that is open.
        ops.push(
          rect({
            x: COL.description,
            y: cursor + 4,
            width: RIGHT - COL.description,
            height: 0.5,
            color: PAPER.rule,
          })
        )
      }
    }

    if (isLastPage) {
      cursor -= TOTAL_GAP
      const y = cursor - LINE_HEIGHT
      ops.push(
        /*
         * The rule sits BELOW the gap, immediately above the row it opens —
         * the conventional ledger form, and now the only form available: the
         * last block on this page is a week's subtotal, which closes on a rule
         * of its own, so drawing this one at the top of the gap (where it used
         * to be) put two full-weight rules 5pt apart and read as a printing
         * fault. A gap between them is what makes them two statements — this
         * week ended, and here is the whole range.
         */
        rect({ x: LEFT, y: cursor + 4, width: RIGHT - LEFT, height: 0.5, color: PAPER.rule }),
        // "Total", not "TOTAL" — DESIGN.md's Sentence Case Rule, the same one
        // that took the column headers above out of uppercase. Its weight and
        // its size step are what make it the grand total; the caps were adding
        // a third signal to a row that already had two.
        text({ x: COL.description, y, text: "Total", size: TYPE.strong, bold: true }),
        // `rows.totals.percent` used to be drawn here, and the comment that
        // stood in this place is worth keeping the point of: it was deliberately
        // the derivation `report-rows.ts` computes rather than a hardcoded
        // "100%", because on an EMPTY range there is no duration for 100% to be
        // a share of, and the hardcoded version disagreed with CSV and XLSX
        // there. The field is still computed and still exported by both of
        // those writers — only this column is gone. If % ever returns to the
        // PDF, it comes back from `rows.totals.percent` and not from a literal.
        ...numericColumnsOps(y, {
          durationMs: rows.totals.totalMs,
          billableCents: rows.totals.billableCents,
          currency,
          unpriced: rows.totals.unpriced,
          size: TYPE.strong,
          bold: true,
        })
      )
      cursor -= totalRowHeight

      // Laid out from one cursor over the lines measured above — with three
      // possible notes of one to three lines each, the hardcoded `y - 26` /
      // `y - 44` offsets could not place the second, let alone the third.
      let footnoteY = cursor - FOOTNOTE_GAP
      for (const line of footnoteLines) {
        if (line !== null) {
          ops.push(text({ x: LEFT, y: footnoteY, text: line, size: TYPE.body, color: PAPER.inkMuted }))
        }
        footnoteY -= LINE_HEIGHT
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
