import { formatRate } from "@/lib/format-money"
import { invoiceTotalsRows, quantityText } from "@/lib/invoice-document"
import { formatMoney } from "@shared/money"

type Line = {
  kind: "time" | "custom"
  description: string
  quantityCentis: number
  unitCents: number
  amountCents: number
}

/**
 * The lines and what they come to — READ-ONLY, and there is no other kind.
 *
 * THREE CALLERS, one table. `/invoices/$invoiceId` draws the stored lines,
 * `to-pdf.ts` prints the same rows on paper through `invoice-document.ts`, and
 * `/invoices/new` draws the lines that are ABOUT to be stored (`BillPreview`).
 * That third one is why the column order and the totals block being one
 * declaration matters most: a preview whose table differed from the record's
 * would be showing the user a document they are not about to raise.
 *
 * Every number is the one it will be. Nothing here recomputes an amount from a
 * quantity and a rate: on the record the printed figure is a fact about the day
 * the invoice was raised, not a function of today's rounding, and on the preview
 * it is `invoiceLineDrafts`' own arithmetic passed straight through. The totals
 * come from `invoiceTotalsRows` — the SAME derivation the PDF prints from, and a
 * screen that summed the lines a second time would be one rounding rule away
 * from making this page's whole claim false.
 */
export function InvoiceLines({
  lines,
  currency,
  taxes,
}: {
  lines: ReadonlyArray<Line>
  currency: string
  taxes: ReadonlyArray<{ label: string; basisPoints: number }>
}) {
  const totals = invoiceTotalsRows(lines, taxes)

  return (
    /*
      RULES, NOT A BOX. The paper draws one hairline under the column header and
      one above the totals and nothing else (`columnHeaderOps` in
      pdf/invoice-doc.ts) — a table is structured by its rows, and an invoice is
      the one document where the reader's eye should run straight down the
      Amount column without a frame around it.

      It used to carry a full `rounded-md border`, which was also a box drawn
      inside a box the moment the record became a panel — the same objection
      that keeps the dashed `Empty` frame out of the no-lines cell below.

      `overflow-x-auto` stays: four columns of figures on a phone scroll rather
      than wrap into unreadable stacks.
    */
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Invoice lines, in the order they print</caption>
        {/*
          SENTENCE CASE, where the paper sets these in caps.
          A deliberate difference and one of only three (see `InvoiceRecord`):
          at 8pt on paper, caps are what separates a header from a figure, while
          on screen there is a rule under the row and a muted tone already doing
          that work — and a tracked-out uppercase eyebrow is the scaffold
          DESIGN.md rejects by name. The ORDER is identical, which is the part
          that matters: description, quantity, rate, amount, left to right, the
          same as `COL` in pdf/invoice-doc.ts.
        */}
        <thead>
          <tr className="border-b border-edge-soft text-[0.8125rem] font-medium text-muted-foreground">
            <th scope="col" className="pr-3 py-2 text-left">
              Description
            </th>
            <th scope="col" className="w-24 px-3 py-2 text-right">
              Quantity
            </th>
            <th scope="col" className="w-32 px-3 py-2 text-right">
              Rate
            </th>
            <th scope="col" className="w-32 pl-3 py-2 text-right">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {/*
            NO LINES IS A DOCUMENT, not a missing one — a range where every
            project was unrated bills nothing, because time nobody priced is
            left off rather than charged at zero (see `createFromRange`).

            So the sentence stands where the rows would be and the totals below
            still print, which is precisely what the PDF does. This used to
            return an `Empty` before it reached `invoiceTotalsRows`, so the
            client's paper said `Total $0.00` and the freelancer's screen said
            nothing at all — the drift `invoice-document.ts` exists to prevent,
            arriving at the one place that module was not asked.

            Not the shared `Empty` frame: its dashed border inside the table's
            own border is a box drawn around a box. The table is the frame here.
          */}
          {lines.length === 0 ? (
            <tr>
              <td colSpan={4} className="pr-3 py-4 text-muted-foreground">
                No lines on this invoice. Lines come from the range it was raised
                from on Reports — billable time on a project with a rate. Time
                nobody has priced is left off rather than billed at nothing.
              </td>
            </tr>
          ) : null}
          {lines.map((line, index) => (
            <tr
              // The description is not unique — two custom charges may share
              // one — and the row's position in a print order IS its identity
              // here: this table is read-only, so nothing reorders under it.
              key={`${index}-${line.description}`}
              className="border-b border-edge-soft last:border-b-0"
            >
              <th scope="row" className="truncate pr-3 py-2 text-left font-normal">
                {line.description}
              </th>
              {/* Decimal hours, 2 dp, floored — a QUANTITY, not money, so Ink.
                  A billable duration is time that will become money and renders
                  like every other duration (The Two Temperatures Rule). */}
              <td className="px-3 py-2 text-right tabular">
                {quantityText(line.quantityCentis)}
              </td>
              {/* Muted, the same treatment /projects gives a project's rate:
                  it is the multiplier beside the figure, not the figure. */}
              <td className="px-3 py-2 text-right tabular text-muted-foreground">
                {line.kind === "time"
                  ? formatRate(line.unitCents, currency)
                  : formatMoney(line.unitCents, currency)}
              </td>
              {/* The one brass column: a currency amount, in this invoice's own
                  snapshotted currency. */}
              <td className="pl-3 py-2 text-right font-medium tabular text-brass">
                {formatMoney(line.amountCents, currency)}
              </td>
            </tr>
          ))}
        </tbody>

        {/*
          A `<tfoot>`, which is what makes this a total rather than three rows
          that happen to be last: assistive tech announces it as the table's
          summary, and a browser printing a long table repeats it. The same
          device /invoices' own list footer uses, and the same reason its label
          is a `<th scope="row">` — the number the eye lands on needs something
          naming it.
        */}
        <tfoot>
          {totals.map((row) => (
            <tr
              key={row.label}
              /* Edge above the block, Edge Soft between its rows: the heavier
                 rule separates the lines from what they add up to, the lighter
                 one separates a subtotal from a tax. */
              className={row.label === "Subtotal" ? "border-t border-edge" : undefined}
            >
              {/*
                THE TOTAL IS A STEP LARGER, not merely bolder — the eye has to
                land on it without reading the block.

                The paper draws it at `TYPE.strong` (12) over a body of 10, and
                the screen used to answer that with `text-sm` for both: same
                size, heavier weight, on the one figure the whole document
                exists to state. `text-base` over `text-sm` is the same ratio,
                so the two renderings put their emphasis in the same place.
              */}
              <th
                scope="row"
                colSpan={3}
                className={
                  row.strong
                    ? "pr-3 pt-3 pb-2 text-right text-base font-semibold"
                    : "pr-3 py-2 text-right text-[0.8125rem] font-medium text-muted-foreground"
                }
              >
                {row.label}
              </th>
              <td
                className={
                  row.strong
                    ? "pl-3 pt-3 pb-2 text-right text-base font-semibold tabular text-brass"
                    : "pl-3 py-2 text-right font-medium tabular text-brass"
                }
              >
                {formatMoney(row.cents, currency)}
              </td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  )
}
