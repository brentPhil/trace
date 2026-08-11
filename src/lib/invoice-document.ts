import { invoiceTotals, taxLineCents } from "@shared/invoiceMath"
import { usDate } from "./us-date"

/**
 * ONE document, two renderings.
 *
 * `/invoices/$invoiceId` shows the invoice as the client received it and
 * `to-pdf.ts` prints the same thing onto paper. Those are two renderings of one
 * document, and the failure they invite is drift: a subtotal computed twice, a
 * `Purchase order` row the screen states as "Not set" and the paper omits, a tax
 * shown as `20%` in one place and `20.00%` in the other. None of that is
 * visible in a diff — it is only visible when a client holds the PDF and the
 * freelancer is looking at the screen.
 *
 * So the decisions that make a document a document — which meta rows exist,
 * what the totals block contains, how a rate reads — live here, once, and both
 * renderings ask this module. What each rendering keeps for itself is
 * PRESENTATION: pdf-lib coordinates on one side, Tailwind and semantic HTML on
 * the other. This module contains no geometry and no markup.
 *
 * Pure — no Convex, no DOM, no clock.
 */

/**
 * A line as the document needs it — no Convex ids, no `userId`, no `sortKey`.
 * The caller hands over lines already in print order, which is what
 * `invoices.get` returns.
 */
export type InvoiceDocLine = {
  kind: "time" | "custom"
  description: string
  /** Hundredths of an hour, the stored unit. 9880 prints as `98.80`. */
  quantityCentis: number
  unitCents: number
  /** STORED, never recomputed from quantity × rate — see the schema comment
   *  and `invoiceTotals`. This module prints it; it does not derive it. */
  amountCents: number
}

/**
 * Everything printed, and nothing else.
 *
 * `issuedOn` / `dueOn` are DAY STRINGS, not instants, and that is the one place
 * this type is deliberately not the stored shape. A day is only a day once a
 * zone has been chosen, the zone is the user's STORED one (never the browser's,
 * never the server's), and resolving it here would make a pure document module a
 * second reader of settings. The caller — which already holds the zone to render
 * the editor's own date fields — resolves both with `dayOf` and passes the
 * answer, so this file has no clock in it and a test can pin a date without
 * pinning a timezone database.
 */
export type InvoiceDoc = {
  number: string
  billedTo: string
  payTo: string
  currency: string
  issuedOn: string
  dueOn: string
  purchaseOrder?: string
  paymentTerms?: string
  notes?: string
  taxes: ReadonlyArray<{ label: string; basisPoints: number }>
  lines: ReadonlyArray<InvoiceDocLine>
}

/**
 * `825` basis points as `8.25%`, `2000` as `20%`.
 *
 * Trailing zeros dropped, because a tax line reads as a rate a human quoted
 * ("plus 20% VAT"), not as a fixed-precision figure — and `20.00%` beside a
 * label somebody typed is the document looking machine-generated at the one
 * place a client checks arithmetic by hand.
 */
export function percentOfBasisPoints(basisPoints: number): string {
  return `${String(Number((basisPoints / 100).toFixed(2)))}%`
}

/**
 * The head's name/value rows, in printed order.
 *
 * An UNSET optional field is an ABSENT ROW, never a printed "Not set". The
 * editor says "Not set" because there it is an invitation — a control to click.
 * On a finished document there is nothing to click, and a line reading
 * `Purchase order  Not set` is the product talking about its own form fields on
 * someone else's invoice.
 *
 * No Currency row. Every amount below is already written by `formatMoney` in
 * the invoice's own currency, symbol and all, so a row spelling out "USD"
 * restates what `$530.30` has said four times by the time the reader reaches
 * the total. The currency remains a SNAPSHOT on the document and remains what
 * the figures are formatted from — it just is not a fact the paper has to state
 * twice. It stays on the editor, where it is a control rather than a
 * restatement.
 *
 * `usDate` on both, which is the reason this is shared rather than reimplemented
 * beside each renderer: the record page's whole claim is that it shows the
 * document as the client received it, and a screen showing `5 Aug 2026` beside a
 * PDF printing `08/05/2026` breaks that claim on the two values a payment
 * dispute turns on.
 */
export function invoiceMetaRows(invoice: InvoiceDoc): Array<{ label: string; value: string }> {
  const rows = [
    { label: "Invoice number", value: invoice.number },
    { label: "Invoice date", value: usDate(invoice.issuedOn) },
    { label: "Due date", value: usDate(invoice.dueOn) },
  ]
  if (invoice.purchaseOrder !== undefined && invoice.purchaseOrder !== "") {
    rows.push({ label: "Purchase order", value: invoice.purchaseOrder })
  }
  if (invoice.paymentTerms !== undefined && invoice.paymentTerms !== "") {
    rows.push({ label: "Payment terms", value: invoice.paymentTerms })
  }
  return rows
}

/** A row of the totals block: what it is called, what it is worth, and whether
 *  it is the figure the reader is looking for. */
export type InvoiceTotalsRow = { label: string; cents: number; strong: boolean }

/**
 * The totals block: Subtotal, one row per tax, Total.
 *
 * ONE `invoiceTotals` call, over the STORED `amountCents` — never quantity ×
 * rate recomputed, and never a second sum written beside the first. Each tax row
 * is drawn with `taxLineCents`, the very function `invoiceTotals` sums, so the
 * rows and the total cannot round apart.
 *
 * The rate is appended to whatever the user called the tax: a client checking
 * `$988.00 + 20%` by hand needs the multiplier on the document, and a label
 * alone ("VAT") does not carry it. A label that already spells out its own
 * percent will read it twice, which is worth less than a tax line nobody can
 * verify.
 */
export function invoiceTotalsRows(
  lines: ReadonlyArray<{ amountCents: number }>,
  taxes: ReadonlyArray<{ label: string; basisPoints: number }>
): Array<InvoiceTotalsRow> {
  const { subtotalCents, totalCents } = invoiceTotals(lines, taxes)
  return [
    { label: "Subtotal", cents: subtotalCents, strong: false },
    ...taxes.map((tax) => ({
      label: `${tax.label} ${percentOfBasisPoints(tax.basisPoints)}`,
      cents: taxLineCents(subtotalCents, tax.basisPoints),
      strong: false,
    })),
    { label: "Total", cents: totalCents, strong: true },
  ]
}

/**
 * `9880` as `98.80` — hundredths of an hour, printed as the decimal hours the
 * client multiplies by the rate.
 *
 * Shared rather than written out twice, which is exactly the class of drift this
 * module exists for: the screen and the paper cannot round a quantity
 * differently if there is only one expression of it.
 */
export function quantityText(quantityCentis: number): string {
  return (quantityCentis / 100).toFixed(2)
}
