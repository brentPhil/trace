import { Empty } from "@/components/ui/empty"
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
 * The lines and what they come to — READ-ONLY, in both the editor and the
 * record.
 *
 * Editing them — a RATE column that can be typed into, custom charges, taxes —
 * is Task 6, and none of it is here. What is here is the document's own
 * figures, because an invoice page showing an address and no money is not a
 * document anybody would recognise.
 *
 * Every number is the STORED one. Nothing here recomputes an amount from a
 * quantity and a rate: the printed figure is a fact about the day the invoice
 * was raised, not a function of today's rounding. The totals come from
 * `invoiceTotalsRows` — the SAME derivation the PDF prints from, which is the
 * point of it existing: the record page's whole claim is that it shows the
 * document the client received, and a screen that summed the lines a second time
 * would be one rounding rule away from making that claim false.
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
  if (lines.length === 0) {
    return (
      <Empty>
        No lines on this invoice. Lines come from the range it was raised from on
        Reports — billable time on a project with a rate. Time nobody has priced
        is left off rather than billed at nothing.
      </Empty>
    )
  }

  const totals = invoiceTotalsRows(lines, taxes)

  return (
    <div className="overflow-x-auto rounded-md border border-edge-soft">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Invoice lines, in the order they print</caption>
        <thead>
          <tr className="border-b border-edge-soft text-[0.8125rem] font-medium text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left">
              Description
            </th>
            <th scope="col" className="w-24 px-3 py-2 text-right">
              Quantity
            </th>
            <th scope="col" className="w-32 px-3 py-2 text-right">
              Rate
            </th>
            <th scope="col" className="w-32 px-3 py-2 text-right">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr
              // The description is not unique — two custom charges may share
              // one — and the row's position in a print order IS its identity
              // here: this table is read-only, so nothing reorders under it.
              key={`${index}-${line.description}`}
              className="border-b border-edge-soft last:border-b-0"
            >
              <th scope="row" className="truncate px-3 py-2 text-left font-normal">
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
              <td className="px-3 py-2 text-right font-medium tabular text-brass">
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
              <th
                scope="row"
                colSpan={3}
                className={
                  row.strong
                    ? "px-3 py-2 text-right text-sm font-semibold"
                    : "px-3 py-2 text-right text-[0.8125rem] font-medium text-muted-foreground"
                }
              >
                {row.label}
              </th>
              <td
                className={
                  row.strong
                    ? "px-3 py-2 text-right text-sm font-semibold tabular text-brass"
                    : "px-3 py-2 text-right font-medium tabular text-brass"
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
