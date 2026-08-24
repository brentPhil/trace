import { describe, expect, it } from "vitest"
import { COL, LOGO_BOX, invoiceDocPages } from "./invoice-doc"
import { PAGE, TYPE } from "./paper"
import { textWidth } from "./ops"
import type { InvoiceDoc, InvoiceDocLine } from "./invoice-doc"
import type { PdfOp } from "./ops"

const BOTTOM = PAGE.margin

function makeLine(over: Partial<InvoiceDocLine> = {}): InvoiceDocLine {
  return {
    kind: "time",
    description: "Vessel Vanguard",
    quantityCentis: 9880,
    unitCents: 1_000,
    amountCents: 98_800,
    ...over,
  }
}

function makeInvoice(over: Partial<InvoiceDoc> = {}): InvoiceDoc {
  return {
    number: "072726-0013",
    billedTo: "Vessel Vanguard\nBonita Springs, FL\n34134, USA",
    payTo: "Brent Ortega\n1 Harbour Way",
    currency: "USD",
    issuedOn: "2026-07-27",
    dueOn: "2026-08-26",
    taxes: [],
    lines: [makeLine()],
    ...over,
  }
}

/** Every string drawn on a page, for assertions that do not care about layout. */
function textOf(page: { ops: Array<PdfOp> }): Array<string> {
  return page.ops.filter((op) => op.kind === "text").map((op) => op.text)
}

function textOps(page: {
  ops: Array<PdfOp>
}): Array<Extract<PdfOp, { kind: "text" }>> {
  return page.ops.filter(
    (op): op is Extract<PdfOp, { kind: "text" }> => op.kind === "text"
  )
}

/**
 * The description cells of the body rows.
 *
 * Isolated by the BAND they occupy, not by their column anchor alone:
 * `COL.description` is `LEFT`, and the title, the meta labels, both party
 * blocks and the notes all sit at `LEFT` too — several of them at the body size
 * as well, since a party block is prose printed at reading size. The band
 * between the DESCRIPTION header and the Subtotal row is what actually
 * distinguishes a line's description from an address that happens to share its
 * left edge, and getting this wrong makes the geometry invariant below pass on
 * text it was never measuring.
 */
function descriptionOpsOf(page: { ops: Array<PdfOp> }) {
  const ops = textOps(page)
  const top = ops.find((op) => op.text === "DESCRIPTION")?.y ?? PAGE.height
  const bottom = ops.find((op) => op.text === "Subtotal")?.y ?? 0
  return ops.filter(
    (op) =>
      op.x === COL.description &&
      op.size === TYPE.body &&
      op.y < top &&
      op.y > bottom
  )
}

describe("invoiceDocPages — the head", () => {
  it("states the document's identity: number and both dates", () => {
    const [first] = invoiceDocPages(makeInvoice())
    const strings = textOf(first)

    expect(strings).toContain("Invoice")
    expect(strings).toContain("072726-0013")
    // The same MM/DD/YYYY the report document dates itself with — the two are
    // read side by side by the same client.
    expect(strings).toContain("07/27/2026")
    expect(strings).toContain("08/26/2026")
  })

  it("adds one top-right logo box and shifts no part of the head", () => {
    const bytes = new Uint8Array([1, 2, 3])
    const withoutLogo = invoiceDocPages(makeInvoice())[0]
    const withLogo = invoiceDocPages(
      makeInvoice({ logo: { bytes, format: "png" } })
    )[0]

    expect(withoutLogo.ops.filter((op) => op.kind === "image")).toHaveLength(0)
    expect(withLogo.ops.filter((op) => op.kind === "image")).toEqual([
      {
        kind: "image",
        x: PAGE.width - PAGE.margin - LOGO_BOX.width,
        y: PAGE.height - PAGE.margin - LOGO_BOX.height,
        ...LOGO_BOX,
        data: bytes,
        format: "png",
      },
    ])

    /*
     * NOTHING MOVES. The box sits in the band the first two meta rows occupy —
     * see LOGO_BOX — so a logo costs the head no height and the word Invoice,
     * the invoice number and everything under them land on the same y whether
     * an account has uploaded one or not. The head used to be pushed down by a
     * band the height of the box, which is the empty stripe this asserts is
     * gone: checking the FIRST meta row and the table header pins both ends of
     * the head, so a shift reintroduced anywhere between them fails here.
     */
    const yOf = (page: { ops: Array<PdfOp> }, value: string) =>
      textOps(page).find((op) => op.text === value)?.y
    expect(yOf(withLogo, "Invoice")).toBe(yOf(withoutLogo, "Invoice"))
    expect(yOf(withLogo, "Invoice number")).toBe(
      yOf(withoutLogo, "Invoice number")
    )
    expect(yOf(withLogo, "DESCRIPTION")).toBe(yOf(withoutLogo, "DESCRIPTION"))
  })

  it("spends no first-page row budget on the logo, and never repeats it", () => {
    const lines = Array.from({ length: 80 }, (_, n) =>
      makeLine({ description: `Logo line ${n}` })
    )
    const withoutLogo = invoiceDocPages(makeInvoice({ lines }))
    const withLogo = invoiceDocPages(
      makeInvoice({
        lines,
        logo: { bytes: new Uint8Array([9]), format: "jpeg" },
      })
    )
    const firstPageRows = (pages: Array<{ ops: Array<PdfOp> }>) =>
      textOf(pages[0]).filter((value) => /^Logo line \d+$/.test(value)).length

    // Equal, not smaller: the logo draws beside the meta rows rather than
    // above them, so the first page fits exactly as many lines with one as
    // without. This used to be `toBeLessThan` — a page of billable work lost
    // to a stripe of white space.
    expect(firstPageRows(withLogo)).toBe(firstPageRows(withoutLogo))
    expect(
      withLogo.flatMap((page) => page.ops).filter((op) => op.kind === "image")
    ).toHaveLength(1)
  })

  /*
   * No Currency row. An earlier version printed one, on the reasoning that "$
   * alone does not distinguish USD from CAD" — which is true of the character
   * and false of this product's output. `formatMoney` goes through
   * `Intl.NumberFormat` at `MONEY_LOCALE`, which renders CAD as `CA$`, AUD as
   * `A$` and SGD as `SGD `, so a bare `$` on a Chroneli invoice IS unambiguous.
   *
   * The row was therefore restating what every amount on the page already
   * said. This asserts it stays gone, and the CAD case is what proves the
   * reasoning rather than just the removal.
   */
  it("names no currency of its own, because every amount already carries one", () => {
    expect(textOf(invoiceDocPages(makeInvoice())[0])).not.toContain("USD")

    const canadian = textOf(
      invoiceDocPages(makeInvoice({ currency: "CAD" }))[0]
    )
    expect(canadian).not.toContain("CAD")
    // Not merely absent — disambiguated where it counts, in the figures.
    expect(canadian.some((text) => text.includes("CA$"))).toBe(true)
  })

  /*
   * An unset optional field is an ABSENT row, never a printed "Not set". A form
   * can say "Not set" because there it is an invitation to fill the box in; on
   * paper there is nothing to fill in, and the product talking about its own
   * empty form fields on a client's invoice is noise on a document that has to
   * be signed off.
   */
  it("omits an unset purchase order and payment terms rather than printing a placeholder", () => {
    const strings = textOf(invoiceDocPages(makeInvoice())[0])
    expect(strings).not.toContain("Purchase order")
    expect(strings).not.toContain("Payment terms")
    expect(strings.some((s) => /not set/i.test(s))).toBe(false)
  })

  it("prints a purchase order and payment terms when the invoice carries them", () => {
    const strings = textOf(
      invoiceDocPages(
        makeInvoice({ purchaseOrder: "PO-4471", paymentTerms: "Net 30" })
      )[0]
    )
    expect(strings).toContain("Purchase order")
    expect(strings).toContain("PO-4471")
    expect(strings).toContain("Payment terms")
    expect(strings).toContain("Net 30")
  })

  /*
   * THE PARTY BLOCKS ARE VERBATIM. Those newlines are the address's shape — the
   * property `clients.address` is stored unnormalised for, carried all the way
   * onto the paper. A block collapsed onto one line is a wrong document.
   */
  it("prints each party block's own lines, in order, without collapsing them", () => {
    const [first] = invoiceDocPages(makeInvoice())
    const strings = textOf(first)

    expect(strings).toContain("Billed to")
    for (const line of [
      "Vessel Vanguard",
      "Bonita Springs, FL",
      "34134, USA",
    ]) {
      expect(strings).toContain(line)
    }
    expect(strings).toContain("Pay to")
    expect(strings).toContain("1 Harbour Way")
    // Not one run-on string anywhere.
    expect(strings.some((s) => s.includes("Bonita Springs, FL 34134"))).toBe(
      false
    )
  })

  /*
   * The other half of verbatim: a single pasted line longer than the block's
   * own column must WRAP, not run under the block beside it or off the paper.
   */
  it("wraps a party line too long for its column instead of overrunning the page", () => {
    const long =
      "Vessel Vanguard Marine Services International Holdings Limited, Registered Office"
    const [first] = invoiceDocPages(makeInvoice({ billedTo: long }))
    const partyWidth = (PAGE.width - 2 * PAGE.margin) / 2 - 10

    const drawn = textOps(first).filter((op) =>
      long.startsWith(op.text.slice(0, 6))
    )
    expect(drawn.length).toBeGreaterThan(1)
    for (const op of drawn) {
      expect(textWidth(op.text, op.size, op.bold ?? false)).toBeLessThanOrEqual(
        partyWidth
      )
    }
  })

  /* `createFromRange` leaves `payTo` empty — nothing in a range of time entries
   * says who the freelancer is. The heading still prints: a client looking for
   * where to send the money finds the question rather than a document that
   * never asked it. */
  it("keeps the Pay to heading even when the block is empty", () => {
    const strings = textOf(invoiceDocPages(makeInvoice({ payTo: "" }))[0])
    expect(strings).toContain("Pay to")
  })
})

describe("invoiceDocPages — the lines", () => {
  it("draws the four column headers", () => {
    const strings = textOf(invoiceDocPages(makeInvoice())[0])
    for (const header of ["DESCRIPTION", "QUANTITY", "RATE", "AMOUNT"]) {
      expect(strings).toContain(header)
    }
  })

  it("prints the quantity as decimal hours, the rate per hour, and the stored amount", () => {
    const strings = textOf(invoiceDocPages(makeInvoice())[0])
    expect(strings).toContain("98.80")
    expect(strings).toContain("$10.00/hr")
    expect(strings).toContain("$988.00")
  })

  /* A custom charge is a PRICE, not a rate — `$50.00`, never `$50.00/hr`. The
   * editor's own distinction, reused rather than restated. */
  it("prints a custom charge's unit as a price rather than an hourly rate", () => {
    const strings = textOf(
      invoiceDocPages(
        makeInvoice({
          lines: [
            makeLine({
              kind: "custom",
              description: "Hosting",
              unitCents: 5_000,
              amountCents: 5_000,
            }),
          ],
        })
      )[0]
    )
    expect(strings).toContain("$50.00")
    expect(strings).not.toContain("$50.00/hr")
  })

  /*
   * THE PENNY PROBLEM, printed. `amountCents` is stored, and it can legitimately
   * differ from quantity × rate by a cent or two (see `lineAmountCents`). The
   * document must print the STORED figure — a PDF that recomputed would disagree
   * with the invoice's own total and with the figure the editor showed.
   */
  it("prints the stored amount, never quantity × rate recomputed", () => {
    const strings = textOf(
      invoiceDocPages(
        makeInvoice({
          // 98.80 x $10.00 would be $988.00; this line stores something else.
          lines: [makeLine({ amountCents: 98_777 })],
        })
      )[0]
    )
    expect(strings).toContain("$987.77")
    expect(strings).not.toContain("$988.00")
  })

  /*
   * DESCRIPTIONS WRAP, THEY NEVER TRUNCATE. The text that justifies a billed
   * amount is the text a client reconciles the amount against, and `…` is the
   * one thing that cannot be reconciled.
   */
  it("wraps a long description across lines rather than cutting it with an ellipsis", () => {
    const description =
      "Offshore vessel maintenance logs, crew training CSV and PDF download, and the quarterly reconciliation against the client's own export"
    const [first] = invoiceDocPages(
      makeInvoice({ lines: [makeLine({ description })] })
    )

    const drawn = descriptionOpsOf(first)
    expect(drawn.length).toBeGreaterThan(1)
    for (const op of drawn) expect(op.text.endsWith("…")).toBe(false)
    // Every word survives, in order — wrapping must not silently drop any of it.
    expect(drawn.map((op) => op.text).join(" ")).toBe(description)
  })

  /*
   * THE GEOMETRY INVARIANT, asserted as geometry rather than by eye — the same
   * one `report-doc.test.ts` pins, because it is the same bug one document over.
   *
   * QUANTITY is right-aligned: `COL.quantity` is where its glyphs END and they
   * extend LEFTWARD from there. A description budget measured "up to
   * COL.quantity" (the anchor the quantity text ends at, not where it begins)
   * leaves the region the quantity itself occupies double-claimed — 25.5pt of
   * proven overprint on the report document, on a page a client reconciles
   * against an invoice. This fixture is the worst case: a description long
   * enough to wrap several times beside the widest quantity the column draws.
   */
  it("keeps every wrapped description line clear of where the quantity text actually begins", () => {
    const [first] = invoiceDocPages(
      makeInvoice({
        lines: [
          makeLine({
            description:
              "Offshore vessel maintenance logs, crew training CSV and PDF download, and the quarterly reconciliation against the client's own export",
            // 123456.78 hours — as wide as this column's string ever gets.
            quantityCentis: 12_345_678,
            amountCents: 123_456_780,
          }),
        ],
      })
    )

    const drawn = descriptionOpsOf(first)
    const quantityOp = textOps(first).find(
      (op) =>
        op.x === COL.quantity && op.align === "right" && op.size === TYPE.body
    )
    expect(drawn.length).toBeGreaterThan(1)
    expect(quantityOp).toBeDefined()
    if (quantityOp === undefined) return

    const quantityStartX =
      COL.quantity -
      textWidth(quantityOp.text, quantityOp.size, quantityOp.bold ?? false)

    for (const op of drawn) {
      const endX =
        COL.description + textWidth(op.text, op.size, op.bold ?? false)
      expect(endX).toBeLessThan(quantityStartX)
    }
  })

  /*
   * A range that priced nothing is a real, reachable document: every project in
   * it was unrated, so every hour was excluded rather than billed at nothing.
   * Stating the absence and totalling it at zero beats a document that looks
   * complete and quietly asks for no money.
   */
  it("states an empty line list and still totals it, on one page", () => {
    const pages = invoiceDocPages(makeInvoice({ lines: [] }))
    expect(pages).toHaveLength(1)
    const strings = textOf(pages[0])
    expect(strings).toContain("No lines on this invoice.")
    expect(strings).toContain("Total")
    expect(strings).toContain("$0.00")
  })
})

describe("invoiceDocPages — the totals", () => {
  it("sums the stored line amounts into a subtotal and a total", () => {
    const strings = textOf(
      invoiceDocPages(
        makeInvoice({
          lines: [
            makeLine({ amountCents: 98_800 }),
            makeLine({ amountCents: 1_200 }),
          ],
        })
      )[0]
    )
    expect(strings).toContain("Subtotal")
    expect(strings).toContain("Total")
    expect(strings).toContain("$1,000.00")
  })

  /* A tax line a client cannot check is a tax line a client queries. The rate is
   * on the document beside the label, and each row is the same `taxLineCents`
   * the total is summed from — so the rows and the total cannot round apart. */
  it("prints each tax on its own row, with its rate, and adds them into the total", () => {
    const strings = textOf(
      invoiceDocPages(
        makeInvoice({
          lines: [makeLine({ amountCents: 100_000 })],
          taxes: [
            { label: "VAT", basisPoints: 2_000 },
            { label: "City levy", basisPoints: 825 },
          ],
        })
      )[0]
    )
    expect(strings).toContain("VAT 20%")
    expect(strings).toContain("$200.00")
    expect(strings).toContain("City levy 8.25%")
    expect(strings).toContain("$82.50")
    expect(strings).toContain("$1,282.50")
  })

  it("formats every amount in the invoice's own snapshotted currency", () => {
    const strings = textOf(
      invoiceDocPages(
        makeInvoice({
          currency: "EUR",
          lines: [makeLine({ amountCents: 100_000 })],
        })
      )[0]
    )
    expect(strings.filter((s) => s.startsWith("€"))).not.toHaveLength(0)
    expect(strings.some((s) => s.startsWith("$"))).toBe(false)
  })
})

describe("invoiceDocPages — the notes", () => {
  const NOTES = "Bank transfer to Acme Bank\nAccount 1234-5678\n\nThank you!"

  it("prints the notes at the foot, below the total, with their line breaks intact", () => {
    const pages = invoiceDocPages(makeInvoice({ notes: NOTES }))
    const last = pages[pages.length - 1]
    const strings = textOf(last)

    expect(strings).toContain("Notes")
    for (const line of [
      "Bank transfer to Acme Bank",
      "Account 1234-5678",
      "Thank you!",
    ]) {
      expect(strings).toContain(line)
    }

    const label = textOps(last).find((op) => op.text === "Notes")
    const total = textOps(last).find((op) => op.text === "Total")
    expect(label).toBeDefined()
    expect(total).toBeDefined()
    // Lower on the page than the figure it is about: a message about where to
    // send the money is read AFTER the amount, not beside the invoice date.
    expect(label!.y).toBeLessThan(total!.y)
  })

  /* Nothing at all when there is no note — not an empty heading. There is no
   * absence to state, because nobody was ever promised a note. */
  it("prints no heading at all when the notes are empty", () => {
    for (const invoice of [makeInvoice(), makeInvoice({ notes: "" })]) {
      const pages = invoiceDocPages(invoice)
      expect(pages.flatMap(textOf)).not.toContain("Notes")
    }
  })

  /* The notes are reserved out of every page's budget, so they land under the
   * total on the last page rather than orphaned onto one of their own. */
  it("keeps a long note on the same page as the total it follows", () => {
    const pages = invoiceDocPages(
      makeInvoice({
        notes: `${NOTES}\n${"Payment is due within thirty days of the invoice date. ".repeat(5)}`,
        lines: Array.from({ length: 40 }, (_, n) =>
          makeLine({ description: `Line ${n}` })
        ),
      })
    )
    const pageOf = (needle: string) =>
      pages.findIndex((page) => textOf(page).includes(needle))

    expect(pages.length).toBeGreaterThan(1)
    expect(pageOf("Notes")).toBe(pages.length - 1)
    expect(pageOf("Total")).toBe(pages.length - 1)
  })
})

describe("invoiceDocPages — pagination", () => {
  const manyLines = (count: number, over: Partial<InvoiceDocLine> = {}) =>
    makeInvoice({
      lines: Array.from({ length: count }, (_, n) =>
        makeLine({ description: `Line ${n}`, ...over })
      ),
    })

  it("flows a long line list onto further pages", () => {
    expect(invoiceDocPages(manyLines(120)).length).toBeGreaterThan(1)
  })

  /* A continuation page with unlabelled columns is a page of unattributed
   * numbers, and one that does not name its own invoice is unattributed money
   * the moment it is separated from page one — which printed paper is. */
  it("repeats the column header and names the invoice on every continuation page", () => {
    const pages = invoiceDocPages(manyLines(120))
    for (const page of pages) {
      expect(textOf(page)).toContain("DESCRIPTION")
      expect(textOf(page)).toContain("AMOUNT")
    }
    for (const page of pages.slice(1)) {
      expect(textOf(page)).toContain("Invoice 072726-0013 (continued)")
    }
  })

  it("puts the totals block on the last page and nowhere else", () => {
    const pages = invoiceDocPages(manyLines(120))
    const withTotal = pages.filter((page) => textOf(page).includes("Total"))
    expect(withTotal).toHaveLength(1)
    expect(withTotal[0]).toBe(pages[pages.length - 1])
    // And the Subtotal is on that same page — a subtotal split from the total
    // it feeds is the split this reservation exists to prevent.
    expect(textOf(withTotal[0])).toContain("Subtotal")
  })

  it("numbers every page as N / M, with M the real count", () => {
    const pages = invoiceDocPages(manyLines(120))
    pages.forEach((page, index) => {
      expect(textOf(page)).toContain(`Page ${index + 1} / ${pages.length}`)
    })
  })

  /*
   * The invariant variable row heights put directly at risk: a page's real
   * height now depends on how many lines each description wrapped to, so a
   * fixed rows-per-page count cannot guarantee this. A fixture where every
   * description wraps is the case most likely to push a row's last line — or
   * the reserved totals block — under the margin.
   */
  it("keeps every drawn row inside the bottom margin, with a wrapping-heavy fixture", () => {
    const pages = invoiceDocPages(
      makeInvoice({
        notes: "Bank transfer to Acme Bank\nAccount 1234-5678",
        taxes: [{ label: "VAT", basisPoints: 2_000 }],
        lines: Array.from({ length: 40 }, (_, n) =>
          makeLine({
            description: `[B-CB-${300 + n}] Reconciling offshore vessel maintenance logs against the client's own crew training CSV export for the quarter`,
          })
        ),
      })
    )
    expect(pages.length).toBeGreaterThan(1)

    for (const page of pages) {
      for (const op of page.ops) {
        if (op.kind !== "text") continue
        // The footer is deliberately drawn IN the bottom margin, at
        // `BOTTOM - 18`; it is not a row and is exempt by design.
        if (/^Page \d+ \/ \d+$/.test(op.text)) continue
        expect(op.y).toBeGreaterThanOrEqual(BOTTOM)
      }
    }
  })

  /* Every line is on the document exactly once — the failure a page-packing
   * pass makes silently is dropping or repeating a row at a boundary, and on an
   * invoice that is a charge that vanishes or is billed twice. */
  it("draws every line exactly once across the pages", () => {
    const pages = invoiceDocPages(manyLines(120))
    const drawn = pages.flatMap(textOf).filter((s) => /^Line \d+$/.test(s))
    expect(drawn).toHaveLength(120)
    expect(new Set(drawn).size).toBe(120)
  })
})
