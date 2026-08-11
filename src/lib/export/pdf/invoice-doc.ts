import { formatMoney } from "@shared/money"
import { formatRate } from "@/lib/format-money"
import {
  invoiceMetaRows,
  invoiceTotalsRows,
  quantityText,
} from "@/lib/invoice-document"
import { rect, text, textWidth, wrapToWidth } from "./ops"
import { PAGE, PAPER, TYPE } from "./paper"
import type { PdfOp, PdfPage } from "./ops"
import type { InvoiceDoc, InvoiceDocLine } from "@/lib/invoice-document"

/**
 * The invoice, as pages of ops.
 *
 * PURE — no Convex, no DOM, no clock, no async — and the same split
 * `report-doc.ts` documents: this file decides WHAT is on each page and where,
 * `render.ts` is the only file that touches pdf-lib. Pagination and column
 * geometry are the parts of a document that break, and they are asserted here
 * against plain objects rather than by extracting text back out of a binary.
 *
 * GEOMETRY ONLY. What the document SAYS — which meta rows exist, what the
 * totals block contains, how a quantity or a tax rate reads — moved to
 * `src/lib/invoice-document.ts` when `/invoices/$invoiceId` became a read-only
 * record of the same document. Two renderings that each decided those for
 * themselves would agree on the day they were written and not for long, and the
 * disagreement would only ever be visible with a client holding the PDF.
 *
 * Layout is the record page at print fidelity: the head, the two party blocks,
 * the line table, the totals, and the notes at the foot. No chart — an invoice
 * is a demand for money, not an analysis of a fortnight.
 */

const LEFT = PAGE.margin
const RIGHT = PAGE.width - PAGE.margin
const TOP = PAGE.height - PAGE.margin
const BOTTOM = PAGE.margin

/* Re-exported from the shape they now live in, so `to-pdf.ts` and the export
 * button keep importing the document's type from the module that prints it. */
export type { InvoiceDoc, InvoiceDocLine } from "@/lib/invoice-document"

/**
 * Where the line table's columns sit. Right-aligned columns give their right
 * edge, which is what `align: "right"` measures from.
 *
 * Exported so tests assert the no-overlap geometry against the same anchors
 * this file draws with, rather than duplicating the numbers — the same reason
 * `report-doc.ts` exports its own `COL`.
 *
 * DESCRIPTION takes everything left over, because on this document it is the
 * only cell whose content has no bound: a line is named for its project, and a
 * project name is whatever the user typed. Each numeric column's gap is sized
 * to clear ITS OWN worst-case string at the body size below, not its neighbour's
 * — every one is right-aligned, so a column's glyphs grow leftward into the gap
 * to its left. RATE gets 90 (`$99,999.99/hr`, the widest thing it draws, is
 * ~67pt) and AMOUNT gets 110 (`$999,999.99` is ~72pt, and the TOTAL row draws it
 * bold at `TYPE.strong`, which is wider still).
 */
export const COL = {
  description: LEFT,
  quantity: RIGHT - 200,
  rate: RIGHT - 110,
  amount: RIGHT,
} as const

/**
 * Real whitespace between two columns, not a rounding fudge — enough that
 * adjacent cells read as two columns rather than one run-on line. The same
 * constant and the same reason as `report-doc.ts`'s.
 */
const GUTTER = 10

/** The gap between two wrapped lines inside one cell, and the gap after a
 *  row's last line before the next row starts. They sum to the 20pt slot a
 *  single-line row occupies — the same pair, at the same values, as the report
 *  document, so the two look like one product's output. */
const LINE_HEIGHT = 12
const ROW_PADDING = 8

/** The vertical space a row of `lineCount` wrapped lines occupies, including
 *  the gap before the next row. ONE formula, shared by the packer and by every
 *  reservation below — two independent height calculations are two things that
 *  silently drift apart the next time either changes. */
function rowSlotHeight(lineCount: number): number {
  return lineCount * LINE_HEIGHT + ROW_PADDING
}

/** A block label's baseline to the baseline of the first line beneath it. */
const LABEL_GAP = 15

/** The column-header baseline to the first body row's slot. */
const COLUMN_HEADER_HEIGHT = 15

/** A continuation page's own heading slot, above its repeated column header. */
const CONTINUED_HEADING_HEIGHT = 30

// ---------------------------------------------------------------------------
// Text blocks
// ---------------------------------------------------------------------------

/**
 * A free-text block — `Billed to`, `Pay to`, `Notes` — as the lines it prints.
 *
 * NEWLINES ARE HONOURED VERBATIM, then each of the user's own lines is wrapped
 * to the column. Both halves are load-bearing and they pull in opposite
 * directions: an address and a bank block are shaped by their line breaks (an
 * account number, an IBAN and a SWIFT code run together is a block a client
 * cannot read a figure off), so the breaks cannot be collapsed — and a single
 * pasted line longer than the column must not run off the paper or into the
 * block beside it, so it cannot be left unwrapped either.
 *
 * A blank line the user typed survives as a blank line: `wrapToWidth` returns
 * `[""]` for an empty string, which is exactly one empty printed line, and the
 * spacing between a bank block and the thank-you under it is something the
 * writer chose.
 *
 * An empty block is NO lines at all rather than one empty one — a label with a
 * single blank line under it reserves height for nothing.
 */
function blockLines(raw: string, maxWidth: number): Array<string> {
  if (raw === "") return []
  // `\r\n` as well as `\n`: a block pasted from a Windows document keeps its
  // carriage returns, and a stray `\r` drawn as a glyph is a black box on a
  // client's invoice.
  return raw.split(/\r?\n/).flatMap((line) => wrapToWidth(line, maxWidth, TYPE.body, false))
}

/** A labelled block of free text, drawn from `y` downward. */
function blockOps(label: string, x: number, y: number, lines: ReadonlyArray<string>): Array<PdfOp> {
  const ops: Array<PdfOp> = [
    text({ x, y, text: label, size: TYPE.tick, color: PAPER.inkMuted }),
  ]
  lines.forEach((line, n) => {
    ops.push(text({ x, y: y - LABEL_GAP - n * LINE_HEIGHT, text: line, size: TYPE.body }))
  })
  return ops
}

// ---------------------------------------------------------------------------
// The head
// ---------------------------------------------------------------------------

/** The label column of the meta grid, wide enough for `Purchase order` at
 *  `TYPE.tick` with room to spare. */
const META_LABEL_WIDTH = 110
const META_ROW_HEIGHT = 16

/** Half the content width, less a gutter, so the two party blocks sit side by
 *  side the way the editor renders them. */
const PARTY_WIDTH = (RIGHT - LEFT) / 2 - GUTTER

/**
 * The document head: the title, the meta grid, and the two party blocks —
 * everything above the line table, on the FIRST page only.
 *
 * Returns the ops together with the y the table may start at, rather than
 * leaving the caller to re-derive that from the same inputs. The head's height
 * is content-driven (an optional meta row is absent, not blank; a party block
 * is as tall as the address in it), and a second derivation of it is how the
 * table comes to overprint the block above it for one particular address.
 */
function headOps(invoice: InvoiceDoc): { ops: Array<PdfOp>; tableTop: number } {
  const ops: Array<PdfOp> = [
    text({ x: LEFT, y: TOP, text: "Invoice", size: TYPE.title, bold: true }),
  ]

  /* Which rows exist, and what they say, is the DOCUMENT's decision and lives
   * in `invoice-document.ts` — the record page draws the same list. What is
   * decided here is only where they sit on the paper. */
  let y = TOP - 34
  for (const { label, value } of invoiceMetaRows(invoice)) {
    ops.push(
      text({ x: LEFT, y, text: label, size: TYPE.tick, color: PAPER.inkMuted }),
      text({ x: LEFT + META_LABEL_WIDTH, y, text: value, size: TYPE.body })
    )
    y -= META_ROW_HEIGHT
  }

  const partiesTop = y - 14
  const billed = blockLines(invoice.billedTo, PARTY_WIDTH)
  const payTo = blockLines(invoice.payTo, PARTY_WIDTH)
  ops.push(
    ...blockOps("Billed to", LEFT, partiesTop, billed),
    ...blockOps("Pay to", LEFT + (RIGHT - LEFT) / 2, partiesTop, payTo)
  )

  /*
   * Both party blocks are LABELS even when empty, and only the taller one
   * decides where the table starts.
   *
   * `payTo` is empty on every invoice `createFromRange` raises — nothing in a
   * range of time entries says who the freelancer is — and printing the heading
   * over nothing is the honest rendering of that: a client looking for where to
   * send the money finds the question, not a document that never asked it.
   */
  const partyLines = Math.max(billed.length, payTo.length)
  const partiesBottom = partiesTop - LABEL_GAP - Math.max(0, partyLines - 1) * LINE_HEIGHT

  return { ops, tableTop: partiesBottom - 30 }
}

// ---------------------------------------------------------------------------
// The line table
// ---------------------------------------------------------------------------

/** The column header, drawn identically on every page of the table. Repeated
 *  rather than drawn once: a continuation page with unlabelled columns is a
 *  page of unattributed numbers. */
function columnHeaderOps(y: number): Array<PdfOp> {
  const label = (x: number, caption: string, align?: "right"): PdfOp =>
    text({ x, y, text: caption, size: TYPE.tick, align, color: PAPER.inkMuted })
  return [
    label(COL.description, "DESCRIPTION"),
    label(COL.quantity, "QUANTITY", "right"),
    label(COL.rate, "RATE", "right"),
    label(COL.amount, "AMOUNT", "right"),
    rect({ x: LEFT, y: y - 7, width: RIGHT - LEFT, height: 0.5, color: PAPER.rule }),
  ]
}

/** A line's RATE cell. `formatRate` for tracked time (`$10.00/hr` — the
 *  multiplier a client reproduces the amount with), plain money for a custom
 *  charge, which is a price and not a rate. The editor's own rule, reused
 *  rather than restated. */
function rateText(line: InvoiceDocLine, currency: string): string {
  return line.kind === "time"
    ? formatRate(line.unitCents, currency)
    : formatMoney(line.unitCents, currency)
}

/**
 * A row's DESCRIPTION cell, pre-wrapped, plus the height that gives the row.
 *
 * Computed once per row up front, because the packer (deciding what fits on a
 * page) and the drawer (turning a placed row into ops) need the SAME wrapped
 * lines — wrapping a second time at draw time risks the two disagreeing about
 * a row's height and what actually gets drawn into it.
 */
type SizedLine = {
  line: InvoiceDocLine
  descriptionLines: Array<string>
  height: number
}

/**
 * One line's ops, its description block starting at `firstLineY`.
 *
 * DESCRIPTIONS WRAP, THEY NEVER TRUNCATE — the text that justifies a billed
 * amount must survive onto the document a client reconciles it against, and
 * `…` is the one thing that cannot be reconciled. Row heights follow the wrap.
 *
 * The three numeric cells are centred against the whole description block
 * rather than pinned to its first line: a two-line description with its amount
 * glued to the top line reads as though the second line belongs to the row
 * below. Centring an ODD line count lands on the middle line's own baseline; an
 * EVEN count lands between the two middle lines, which is what "centred against
 * the block" means when there is no middle line to pin to.
 */
function lineRowOps(sized: SizedLine, firstLineY: number, currency: string): Array<PdfOp> {
  const { line, descriptionLines } = sized
  const centerY = firstLineY - ((descriptionLines.length - 1) * LINE_HEIGHT) / 2

  const ops: Array<PdfOp> = descriptionLines.map((wrapped, n) =>
    text({ x: COL.description, y: firstLineY - n * LINE_HEIGHT, text: wrapped, size: TYPE.body })
  )
  ops.push(
    // A QUANTITY is not money — decimal hours are ordinary ink, and the Two
    // Temperatures Rule reserves brass for the amount three columns over.
    text({
      x: COL.quantity,
      y: centerY,
      text: quantityText(line.quantityCentis),
      size: TYPE.body,
      align: "right",
    }),
    // Muted, the same treatment the editor and /projects give a rate: it is the
    // multiplier beside the figure, not the figure.
    text({
      x: COL.rate,
      y: centerY,
      text: rateText(line, currency),
      size: TYPE.body,
      align: "right",
      color: PAPER.inkMuted,
    }),
    text({
      x: COL.amount,
      y: centerY,
      text: formatMoney(line.amountCents, currency),
      size: TYPE.body,
      align: "right",
      // Brass is a CURRENCY amount and nothing else (DESIGN.md).
      color: PAPER.brass,
    })
  )
  return ops
}

/** A totals row: a label right-aligned into the RATE column and its amount in
 *  the AMOUNT column, so the figures stack directly under the ones they
 *  summarise. */
function totalsRowOps(
  y: number,
  label: string,
  cents: number,
  currency: string,
  opts: { strong?: boolean } = {}
): Array<PdfOp> {
  const size = opts.strong ? TYPE.strong : TYPE.body
  return [
    text({
      x: COL.rate,
      y,
      text: label,
      size,
      bold: opts.strong,
      align: "right",
      color: opts.strong ? undefined : PAPER.inkMuted,
    }),
    text({
      x: COL.amount,
      y,
      text: formatMoney(cents, currency),
      size,
      bold: opts.strong,
      align: "right",
      color: PAPER.brass,
    }),
  ]
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

/** A blank row's worth of space between the last line and the rule above the
 *  totals — without it the totals read as belonging to whichever line above
 *  them happens to have wrapped onto the fewest lines, which is exactly the
 *  visual bug variable row heights introduce. */
const TOTALS_GAP = rowSlotHeight(1)

/** The totals to the notes. Wider than a row gap because these are two
 *  different kinds of thing: the sum, and a sentence to a person. */
const NOTES_GAP = 24

export function invoiceDocPages(invoice: InvoiceDoc): Array<PdfPage> {
  const { currency } = invoice
  const head = headOps(invoice)

  /*
   * THE DESCRIPTION'S BUDGET, and the bug it exists to close.
   *
   * QUANTITY is right-aligned: `COL.quantity` is where its glyphs END, and they
   * extend LEFTWARD from there by the string's own width. Measuring the
   * description "up to COL.quantity" measures up to a line the quantity text
   * has already crossed — the two cells' claimed regions then overlap by
   * exactly the width of whatever quantity is on that row, which is how the
   * report document shipped 25.5pt of proven overprint. Truncating to that same
   * anchor would not have helped; only reserving room for the text itself does.
   *
   * Measured over the quantities ACTUALLY DRAWN rather than a hardcoded
   * reservation: the column position is one constant for the whole document,
   * and a reservation sized for `98.80` reopens the overprint the day somebody
   * invoices `1234.50` hours. `0` when there are no lines — `Math.max()` of
   * nothing is `-Infinity`, which would silently hand the description column
   * more width than the page has.
   */
  const maxQuantityTextWidth = invoice.lines.reduce(
    (widest, line) =>
      Math.max(widest, textWidth(quantityText(line.quantityCentis), TYPE.body, false)),
    0
  )
  const descriptionMaxWidth =
    COL.quantity - maxQuantityTextWidth - GUTTER - COL.description

  const sized: Array<SizedLine> = invoice.lines.map((line) => {
    const descriptionLines = wrapToWidth(line.description, descriptionMaxWidth, TYPE.body, false)
    return { line, descriptionLines, height: rowSlotHeight(descriptionLines.length) }
  })

  /*
   * THE TAIL — the totals block and the notes — is reserved out of EVERY page's
   * budget, not just the last one.
   *
   * Pagination is a single forward pass that cannot know which page will turn
   * out to be last until it has built it, so every page must leave room in case
   * IT is the one that ends up holding the tail. Pages that turn out not to be
   * last carry unused trailing whitespace instead, which is the accepted trade:
   * the alternative is a total split from its own lines, or a notes block — the
   * message telling a client where to send the money — orphaned onto a page of
   * its own after the document appears to have ended.
   *
   * Both are sized from their own real content (one row per tax, one line per
   * wrapped note line), never a constant that stops being true.
   */
  /*
   * The totals block, derived ONCE for both the reservation and the drawing —
   * and by the same `invoiceTotalsRows` the record page reads. `invoiceTotals`
   * is called in there, over the STORED `amountCents`, so a printed document
   * stays a fact about the day it was raised rather than a function of today's
   * rounding, and the screen and the paper cannot disagree by a cent.
   *
   * The height follows the rows rather than a `2 + taxes.length` written out
   * beside them: a totals block that grows a row and a reserve that does not is
   * the total printed off the bottom of the page.
   */
  const totals = invoiceTotalsRows(invoice.lines, invoice.taxes)
  const totalsHeight = TOTALS_GAP + totals.length * rowSlotHeight(1)

  const noteLines = blockLines(invoice.notes ?? "", RIGHT - LEFT)
  const notesHeight =
    noteLines.length === 0 ? 0 : NOTES_GAP + LABEL_GAP + noteLines.length * LINE_HEIGHT

  const tailReserve = totalsHeight + notesHeight

  /** Where the table's column header sits on a given page: under the head on
   *  page one, under the continuation heading on every page after it. */
  const tableTopOf = (pageIndex: number): number =>
    pageIndex === 0 ? head.tableTop : TOP - CONTINUED_HEADING_HEIGHT

  const budgetOf = (pageIndex: number): number =>
    tableTopOf(pageIndex) - COLUMN_HEADER_HEIGHT - BOTTOM - tailReserve

  /*
   * Height-accumulating pagination: fill a page until the next row would cross
   * that page's own reserved budget, then start a new one. A fixed rows-per-page
   * count cannot be right once rows wrap — and the budget differs per page
   * anyway, because page one also carries the head.
   *
   * `current.length > 0` is the escape hatch for a single row taller than a
   * whole page's budget: it still gets its own (overflowing) page rather than
   * vanishing from the document. On an invoice that means a description long
   * enough to wrap past a page, which is a bad-looking page rather than a
   * missing charge.
   */
  const rowPages: Array<Array<SizedLine>> = []
  let current: Array<SizedLine> = []
  let used = 0
  for (const row of sized) {
    if (current.length > 0 && used + row.height > budgetOf(rowPages.length)) {
      rowPages.push(current)
      current = []
      used = 0
    }
    current.push(row)
    used += row.height
  }
  rowPages.push(current)

  const pages: Array<PdfPage> = rowPages.map((rows, pageIndex) => {
    const isLast = pageIndex === rowPages.length - 1
    const tableTop = tableTopOf(pageIndex)
    const ops: Array<PdfOp> =
      pageIndex === 0
        ? [...head.ops]
        : [
            // The number, again. A page three that does not name the document
            // it belongs to is a page of unattributed money the moment it is
            // separated from page one — which printed paper is.
            text({
              x: LEFT,
              y: TOP,
              text: `Invoice ${invoice.number} (continued)`,
              size: TYPE.heading,
              bold: true,
            }),
          ]
    ops.push(...columnHeaderOps(tableTop))

    let cursor = tableTop - COLUMN_HEADER_HEIGHT
    for (const row of rows) {
      ops.push(...lineRowOps(row, cursor - LINE_HEIGHT, currency))
      cursor -= row.height
    }

    /*
     * An invoice with no lines still prints its table and its totals.
     *
     * A range that priced nothing is a real, reachable document — every project
     * in it was unrated, so every hour was excluded rather than billed at
     * nothing (see `createFromRange`). Dropping the table would leave a
     * document that looks complete and simply asks for no money; stating the
     * absence and totalling it at zero is the same choice the editor's own
     * empty state makes.
     */
    if (isLast && rows.length === 0) {
      ops.push(
        text({
          x: COL.description,
          y: cursor - LINE_HEIGHT,
          text: "No lines on this invoice.",
          size: TYPE.body,
          color: PAPER.inkMuted,
        })
      )
      cursor -= rowSlotHeight(1)
    }

    if (isLast) {
      ops.push(
        rect({ x: LEFT, y: cursor - 2, width: RIGHT - LEFT, height: 0.5, color: PAPER.rule })
      )
      cursor -= TOTALS_GAP
      for (const row of totals) {
        ops.push(
          ...totalsRowOps(cursor - LINE_HEIGHT, row.label, row.cents, currency, {
            strong: row.strong,
          })
        )
        cursor -= rowSlotHeight(1)
      }

      /*
       * THE NOTES, at the foot, on the last page, under the total.
       *
       * This is the message to the client — where to send the money, the terms
       * the one-line `Payment terms` field is too short to hold, the thanks —
       * and it is read AFTER the figure it is about, which is why it is here and
       * not in the meta grid. An empty notes block prints nothing at all, not an
       * empty heading: there is no absence to state, because nobody was ever
       * promised a note.
       */
      if (noteLines.length > 0) {
        cursor -= NOTES_GAP
        ops.push(...blockOps("Notes", LEFT, cursor, noteLines))
      }
    }

    return { ops }
  })

  pages.forEach((page, n) => {
    page.ops.push(
      text({
        x: RIGHT,
        y: BOTTOM - 18,
        text: `Page ${n + 1} / ${pages.length}`,
        size: TYPE.footer,
        align: "right",
        color: PAPER.inkMuted,
      })
    )
  })

  return pages
}
