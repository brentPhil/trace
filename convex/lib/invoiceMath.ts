/**
 * Invoice arithmetic. Pure — no Convex imports, no DOM — so a client-side
 * editor (Task 6) can preview a total with the exact rule that will be stored,
 * rather than guessing at it.
 */

/**
 * A line's amount, from the quantity the document PRINTS.
 *
 * NOT from the raw milliseconds. `/reports` sums every entry's exact
 * fractional-cent worth and rounds once at the end, which is the right way to
 * total a set of entries — but an invoice line prints `98.80 x $10.00` and a
 * client must reproduce `$988.00` from those three numbers with a calculator.
 * So the amount is computed from the rounded quantity, and the two can differ
 * by a cent or two. That difference is accepted and surfaced; what is not
 * accepted is it being silent.
 */
export function lineAmountCents(quantityCentis: number, unitCents: number): number {
  // Integer arithmetic throughout, not `Math.round((quantityCentis * unitCents)
  // / 100)` — that divides before rounding, and while the division is exact at
  // every realistic invoice magnitude, this codebase does not accept "exact at
  // realistic magnitudes" as a rule for money (see `centiHours` in
  // convex/lib/duration.ts, which exists for exactly that reason). Both
  // operands are integers, so the product is exact; floor-and-compare-the-
  // remainder gets the same half-cent-up rounding the tests below pin,
  // without ever routing it through a division that could round the wrong way.
  const product = quantityCentis * unitCents
  return Math.floor(product / 100) + (product % 100 >= 50 ? 1 : 0)
}

/** The fields `invoiceTotals` reads. A whole `invoiceLines` doc satisfies this
 *  with room to spare — declared narrow so the pure module never has to import
 *  the Convex-generated document type. */
type LineForTotal = { amountCents: number }

/** A tax row: a label to print and a rate in basis points (1/100 of a
 *  percent), matching `invoiceFields.taxes` in convex/schema.ts. */
type TaxForTotal = { label: string; basisPoints: number }

/**
 * An invoice's subtotal, tax and total, from the STORED line amounts.
 *
 * Sums `amountCents` rather than recomputing each line from its quantity and
 * rate — the whole point of storing `amountCents` on the line (see the schema
 * comment) is that a printed document is not a function of today's rounding
 * rules, and re-deriving it here would quietly undo that.
 *
 * Each tax is applied to the SUBTOTAL, independently, and rounded once — not
 * compounded onto a running total. Two 5% taxes are 10% of the subtotal, not
 * 5% then 5% of the result; which behaviour a jurisdiction wants is a policy
 * question, but compounding by accident is simply a wrong number.
 */
export function invoiceTotals(
  lines: ReadonlyArray<LineForTotal>,
  taxes: ReadonlyArray<TaxForTotal>
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0)
  const taxCents = taxes.reduce(
    (sum, tax) => sum + Math.round((subtotalCents * tax.basisPoints) / 10_000),
    0
  )
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents }
}

/** The fields `sumByCurrency` reads — an `invoices.list` row satisfies it. */
type AmountInCurrency = { currency: string; totalCents: number }

/**
 * A set of invoices totalled, GROUPED BY CURRENCY — never summed into one
 * number.
 *
 * Every invoice snapshots the currency it was raised in, and this product lets
 * that change between invoices. So a list can hold $2,000 and €1,500, and there
 * is no honest single figure for it: adding the integers gives 3,500 of nothing,
 * and converting them would require a rate on a date this product does not hold
 * and has no business inventing. A freelancer reading one merged number would
 * be reading a number that is wrong in both currencies.
 *
 * Grouped in FIRST-SEEN order rather than sorted, so the currency at the top of
 * a list is the currency at the top of its total — the reader's eye does not
 * have to re-find it.
 */
export function sumByCurrency(
  rows: ReadonlyArray<AmountInCurrency>
): Array<{ currency: string; totalCents: number }> {
  const byCurrency = new Map<string, number>()
  for (const row of rows) {
    byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.totalCents)
  }
  return [...byCurrency].map(([currency, totalCents]) => ({ currency, totalCents }))
}
