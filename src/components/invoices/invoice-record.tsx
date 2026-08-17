import { InvoiceLines } from "@/components/invoices/invoice-lines"
import { invoiceMetaRows } from "@/lib/invoice-document"
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
  logoUrl: string | null
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
 * `src/lib/invoice-document.ts` what the document SAYS — which meta rows exist,
 * what the totals block contains, how a quantity and a tax rate read — and each
 * keeps only its own presentation.
 *
 * THAT FIDELITY NOW EXTENDS TO THE LAYOUT, which is the half a shared module
 * cannot enforce. The paper draws, in order: the word Invoice, the meta rows,
 * the two party blocks side by side at the left and middle of the measure, the
 * line table, the totals stacked under the columns they summarise, and the notes
 * at the foot (`invoiceDocPages` in src/lib/export/pdf/invoice-doc.ts). This
 * draws the same six things in the same order, at the same relative weights —
 * so a freelancer checking the screen against the PDF is checking one document
 * twice, not comparing two.
 *
 * WHERE IT DELIBERATELY DIFFERS, and each difference is a property of the
 * medium rather than of the document:
 *
 *   - The screen is a warm dark ground and the paper is white. Nothing about
 *     the document changes; `PAPER` (pdf/paper.ts) exists because a `bg-ground`
 *     PDF is one nobody can print.
 *   - The paper's column headers are set in caps because at 8pt on paper caps
 *     are what separates a header from a figure. On screen they are sentence
 *     case — The Sentence Case Rule, and the header row has a rule under it and
 *     a muted tone to do that work. See `InvoiceLines`.
 *   - No page numbers, no "(continued)" heading, no logo placeholder. The first
 *     two are properties of paper. The third was here and is GONE: a dashed
 *     `Logo` box on the one screen whose claim is fidelity showed the freelancer
 *     something the client never receives, and reserving space for an unbuilt
 *     feature is not worth breaking the claim the whole page rests on.
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
    /*
     * The document as an OBJECT on the page, not as the page's own contents.
     *
     * One tonal step up from ground with a single hairline — the frame
     * DESIGN.md already specifies for the report charts, reused rather than
     * re-decided, so a panel in this product is one declaration. No shadow: the
     * document does not float (The Tonal Depth Rule), and this is the whole
     * reason it can look like a sheet without looking like paper simulation.
     *
     * Full width, `p-6` inside its own border — the page's `px-4` gutter is on
     * the element above, per The One Measure Rule, and this panel adds its own
     * inset because a document's text should not sit on its own edge.
     */
    <article className="flex flex-col gap-8 rounded-lg border border-edge-soft bg-surface p-6">
      <div className="flex flex-col gap-6">
        {/*
          THE MASTHEAD, and it is inside the document rather than above it.
          The paper opens with the word "Invoice" set large and bold at the top
          left; the page used to answer that with a `text-sm font-semibold`
          heading OUTSIDE the record, which read as a section label on an app
          screen rather than as the first line of a document. It is an `<h1>`
          because it is this page's subject.
        */}
        <div className="flex min-h-12 items-start justify-between gap-6">
          <h1 className="text-2xl font-medium tracking-[-0.01em]">Invoice</h1>
          {invoice.logoUrl === null ? null : (
            <img
              src={invoice.logoUrl}
              alt=""
              className="max-h-12 max-w-40 object-contain"
            />
          )}
        </div>

        {/* A `<dl>`: this is a document's name/value list, and it is what makes
            "Due date" read as the name of the value beside it. */}
        <dl className="flex flex-col gap-2">
          {metaRows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[9rem_1fr] items-baseline gap-3"
            >
              <dt className="text-[0.8125rem] font-medium text-muted-foreground">
                {row.label}
              </dt>
              {/* Tabular on every one of them: a number, a date and an invoice
                  id are all digits somebody reads down a column. */}
              <dd className="font-mono tabular-nums tracking-[-0.02em] min-w-0 text-sm">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/*
        TWO EQUAL HALVES, matching the paper exactly: `headOps` draws Billed to
        at the left margin and Pay to at `LEFT + (RIGHT - LEFT) / 2`. A `grid`
        rather than two flexed children, because flex-basis would let a long
        address move the second block and the two documents would then disagree
        about where the reader's eye goes for "where do I send the money".
      */}
      <div className="grid gap-6 sm:grid-cols-2">
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
    </article>
  )
}

/**
 * A block of the document printed verbatim.
 *
 * `whitespace-pre-line` is the whole component. `billedTo` is
 * `"Vessel Vanguard LLC\nBonita Springs, FL\n34134, USA"` and those newlines are
 * the address's shape — the same property the textarea on /invoices/new keeps
 * and the same property `blockLines` honours on paper. Rendered into HTML
 * without it, a three-line address collapses onto one line, on the one screen
 * whose claim is that this is what the client got.
 *
 * `leading-relaxed` and full Ink on the value: an address is read as an address,
 * a line at a time, and the label above it is the only part that is secondary.
 *
 * `<dt>`/`<dd>`, not `<label>`: there is no control here for a label to be
 * attached to, and a `<label>` pointing at nothing is a promise of a control
 * that does not exist.
 *
 * An empty block still prints its heading. `payTo` is empty on every invoice
 * raised before /invoices/new existed, and the paper prints the label over the
 * gap for the same reason: a client looking for where to send the money finds
 * the question, rather than a document that never asked it.
 */
function PartyBlockRecord({ label, value }: { label: string; value: string }) {
  return (
    <dl className="flex min-w-0 flex-col gap-1.5">
      <dt className="text-[0.8125rem] font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm leading-relaxed whitespace-pre-line">{value}</dd>
    </dl>
  )
}
