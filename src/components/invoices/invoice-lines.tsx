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
      than wrap into unreadable stacks — and the `min-w` on the table is what
      makes that promise true. The three numeric columns are fixed widths
      summing to 416px; inside a 279px panel `table-fixed` handed the
      DESCRIPTION column whatever was left, which was nothing, so on a phone
      every line was a row of figures with no name against it. The minimum keeps
      128px of description in view and lets the row scroll to reach the rest,
      which is what the scrolling was for.
    */
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] table-fixed border-collapse text-base">
        <caption className="sr-only">Invoice lines, in the order they print</caption>
        {/*
          SENTENCE CASE, where the paper sets these in caps.
          A deliberate difference and one of only three (see `InvoiceRecord`):
          at 10pt on paper, caps are what separates a header from a figure, while
          on screen there is a rule under the row and a muted tone already doing
          that work — and a tracked-out uppercase eyebrow is the scaffold
          DESIGN.md rejects by name. The ORDER is identical, which is the part
          that matters: description, quantity, rate, amount, left to right, the
          same as `COL` in pdf/invoice-doc.ts.
        */}
        <thead>
          <tr className="border-b border-edge-soft text-sm font-medium text-muted-foreground">
            <th scope="col" className="pr-4 py-2.5 text-left">
              Description
            </th>
            <th scope="col" className="w-28 px-4 py-2.5 text-right">
              Quantity
            </th>
            <th scope="col" className="w-36 px-4 py-2.5 text-right">
              Rate
            </th>
            <th scope="col" className="w-40 pl-4 py-2.5 text-right">
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
              <td colSpan={4} className="pr-4 py-5 text-muted-foreground">
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
              <th scope="row" className="truncate pr-4 py-3 text-left font-normal">
                {line.description}
              </th>
              {/* Decimal hours, 2 dp, floored — a QUANTITY, not money, so Ink.
                  A billable duration is time that will become money and renders
                  like every other duration (The Two Temperatures Rule). */}
              <td className="px-4 py-3 text-right font-mono tabular-nums tracking-[-0.02em]">
                {quantityText(line.quantityCentis)}
              </td>
              {/* Muted, the same treatment /projects gives a project's rate:
                  it is the multiplier beside the figure, not the figure. */}
              <td className="px-4 py-3 text-right font-mono tabular-nums tracking-[-0.02em] text-muted-foreground">
                {line.kind === "time"
                  ? formatRate(line.unitCents, currency)
                  : formatMoney(line.unitCents, currency)}
              </td>
              {/* The one brass column: a currency amount, in this invoice's own
                  snapshotted currency. */}
              <td className="pl-4 py-3 text-right font-medium font-mono tabular-nums tracking-[-0.02em] text-brass">
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

                The paper draws it at `INVOICE_TYPE.strong` (15) over a body of
                12, and the screen answers with `text-xl` over `text-base`. Both
                are the same 1.25 ratio, so the two renderings put their emphasis
                in the same place and by the same amount. It was `text-base` over
                `text-sm` before the document was set larger throughout; keeping
                that pair would have left the TOTAL the same size as an ordinary
                line's amount.
              */}
              <th
                scope="row"
                colSpan={3}
                className={
                  row.strong
                    ? "pr-4 pt-4 pb-2.5 text-right text-xl font-semibold"
                    : "pr-4 py-2.5 text-right text-sm font-medium text-muted-foreground"
                }
              >
                {row.label}
              </th>
              <td
                className={
                  row.strong
                    ? "pl-4 pt-4 pb-2.5 text-right text-xl font-semibold font-mono tabular-nums tracking-[-0.02em] text-brass"
                    : "pl-4 py-2.5 text-right font-medium font-mono tabular-nums tracking-[-0.02em] text-brass"
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
