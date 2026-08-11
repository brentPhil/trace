import { InvoiceLines } from "@/components/invoices/invoice-lines"
import { invoiceMetaRows } from "@/lib/invoice-document"
import { cn } from "@/lib/utils"
import { dayOf } from "@shared/day"

type Line = {
  kind: "time" | "custom"
  description: string
  quantityCentis: number
  unitCents: number
  amountCents: number
}

type Invoice = {
  number: string
  billedTo: string
  payTo: string
  currency: string
  issuedAt: number
  dueAt: number
  purchaseOrder?: string
  paymentTerms?: string
  notes?: string
  taxes: ReadonlyArray<{ label: string; basisPoints: number }>
  lines: ReadonlyArray<Line>
}

/**
 * The invoice as the client received it. NO INPUTS, anywhere.
 *
 * This is the page a freelancer opens to answer "what did I actually send
 * them?", and the honest answer is a document rather than a form with the values
 * already filled in. A form cannot answer it: a control looks the same whether
 * its contents were sent or typed thirty seconds ago and abandoned, and the two
 * mean opposite things when a client is disputing a figure over the phone.
 *
 * IT MUST NOT DRIFT FROM THE PDF, which is the same document on paper. Both ask
 * `src/lib/invoice-document.ts` what the document says — which meta rows exist,
 * what the totals block contains, how a quantity and a tax rate read — and each
 * keeps only its own presentation. So an unset purchase order is an absent row
 * here exactly as it is on the paper, the dates read in the same format, and the
 * total is a single `invoiceTotals` call neither rendering performs twice.
 *
 * The one thing this shows that the paper cannot is nothing at all: no
 * "Currency" row, no page numbers, no "(continued)" heading. Those are
 * properties of paper, not of the document.
 *
 * Declared structurally rather than imported from the generated Convex API —
 * the boundary `eslint.config.js` enforces — which also keeps it renderable in a
 * test from a plain object.
 */
export function InvoiceRecord({
  invoice,
  timeZone,
}: {
  invoice: Invoice
  timeZone: string
}) {
  /* The user's STORED zone, never the browser's — the one rule every date in
   * this feature follows, and the reason `invoice-document.ts` takes days
   * rather than instants. A freelancer checking an invoice from an airport must
   * read the date they raised it on. */
  const metaRows = invoiceMetaRows({
    number: invoice.number,
    billedTo: invoice.billedTo,
    payTo: invoice.payTo,
    currency: invoice.currency,
    issuedOn: dayOf(invoice.issuedAt, timeZone),
    dueOn: dayOf(invoice.dueAt, timeZone),
    purchaseOrder: invoice.purchaseOrder,
    paymentTerms: invoice.paymentTerms,
    notes: invoice.notes,
    taxes: invoice.taxes,
    lines: invoice.lines,
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        {/* A `<dl>` for the same reason the editor's grid is one: this is a
            document's name/value list, and it is what makes "Due date" read as
            the name of the value beside it. */}
        <dl className="flex flex-col gap-2">
          {metaRows.map((row) => (
            <div key={row.label} className="grid grid-cols-[9rem_1fr] items-baseline gap-3">
              <dt className="text-[0.8125rem] font-medium text-muted-foreground">
                {row.label}
              </dt>
              {/* Tabular on every one of them: a number, a date and an invoice
                  id are all digits somebody reads down a column. */}
              <dd className="min-w-0 text-sm tabular">{row.value}</dd>
            </div>
          ))}
        </dl>
        <LogoSlot />
      </div>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <PartyBlockRecord label="Billed to" value={invoice.billedTo} />
        <PartyBlockRecord label="Pay to" value={invoice.payTo} />
      </div>

      <InvoiceLines
        lines={invoice.lines}
        currency={invoice.currency}
        taxes={invoice.taxes}
      />

      {/* At the FOOT, under the total, exactly where the paper puts it: this is
          the message to the client — where to send the money, the terms, the
          thanks — and it is read after the figure it is about. An empty notes
          block prints nothing at all rather than an empty heading; nobody was
          ever promised a note, so there is no absence to state. */}
      {invoice.notes === undefined || invoice.notes === "" ? null : (
        <div className="max-w-prose">
          <PartyBlockRecord label="Notes" value={invoice.notes} />
        </div>
      )}
    </div>
  )
}

/**
 * A block of the document printed verbatim.
 *
 * `whitespace-pre-line` is the whole component. `billedTo` is
 * `"Vessel Vanguard LLC\nBonita Springs, FL\n34134, USA"` and those newlines are
 * the address's shape — the same property the textarea in the editor keeps and
 * the same property `blockLines` honours on paper. Rendered into HTML without
 * it, a three-line address collapses onto one line, on the one screen whose
 * claim is that this is what the client got.
 *
 * `<dt>`/`<dd>`, not `<label>`: there is no control here for a label to be
 * attached to, and a `<label>` pointing at nothing is a promise of a control
 * that does not exist.
 *
 * An empty block still prints its heading. `payTo` is empty on every invoice
 * `createFromRange` raises — nothing in a range of time entries says who the
 * freelancer is — and the paper prints the label over the gap for the same
 * reason: a client looking for where to send the money finds the question,
 * rather than a document that never asked it.
 */
function PartyBlockRecord({ label, value }: { label: string; value: string }) {
  return (
    <dl className="flex min-w-0 flex-1 flex-col gap-1.5">
      <dt className="text-[0.8125rem] font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm whitespace-pre-line">{value}</dd>
    </dl>
  )
}

/**
 * The logo, as a reserved space and nothing more.
 *
 * Uploading one needs Convex file storage and is deliberately deferred — the
 * plan names it as the natural first follow-up. It renders as a dashed
 * placeholder rather than a `+ Logo` button because a control that cannot do
 * anything is worse than an obvious gap: the gap is honest, the button is a
 * promise. `aria-hidden` for the same reason — there is nothing here to
 * announce and nothing to do.
 */
function LogoSlot() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "hidden h-20 w-32 shrink-0 items-center justify-center rounded-md",
        "border border-dashed border-edge-soft text-xs text-muted-foreground sm:flex"
      )}
    >
      Logo
    </div>
  )
}
