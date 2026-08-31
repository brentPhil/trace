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
 *     the document changes; `PAPER` (pdf/paper.ts) exists because a `bg-background`
 *     PDF is one nobody can print.
 *   - The paper's column headers are set in caps because at 10pt on paper caps
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
     * Full width, `p-8` inside its own border — the page's `px-4` gutter is on
     * the element above, per The One Measure Rule, and this panel adds its own
     * inset because a document's text should not sit on its own edge. The inset
     * grew with the type: 24px of margin around 12pt-equivalent text reads as a
     * document, around 16px-equivalent text it reads as a cramped panel.
     */
    <article className="flex flex-col gap-10 rounded-lg border border-border bg-card p-8">
      <div className="flex flex-col gap-4">
        {/*
          THE MASTHEAD, and it is inside the document rather than above it.
          The paper opens with the word "Invoice" set large and bold at the top
          left; the page used to answer that with a `text-sm font-semibold`
          heading OUTSIDE the record, which read as a section label on an app
          screen rather than as the first line of a document. It is an `<h1>`
          because it is this page's subject.

          `gap-4` under it, not `gap-6`, and the title no longer shares a row
          with the logo: both are the same correction. The row used to be
          `min-h-12` — the logo's own height — so on any invoice with a logo the
          word Invoice sat alone above 48px of nothing and the meta rows began
          somewhere below it. 16px puts the title's baseline about the same
          distance above the first meta row as `TOP` sits above `TOP - 48` on the
          paper, at this size: one title, then the figures it introduces.

          `text-4xl`, up from `text-2xl`, tracking the paper's own masthead from
          20pt to 30pt. This is the first thing a reader sees and the only word
          on the document that has no competition for space — `INVOICE_TYPE` in
          pdf/paper.ts argues the whole raise, and the argument is the same on
          either medium.
        */}
        <h1 className="text-4xl font-medium tracking-[-0.015em]">Invoice</h1>

        {/*
          THE LOGO IS LEVEL WITH THE META ROWS, which is where the paper draws
          it: `LOGO_BOX` occupies `TOP - 64 .. TOP` while the rows start at
          `TOP - 48`, so on both renderings the mark sits opposite the invoice
          number rather than above it.

          `max-h-16 max-w-56`, matching the paper's raise from 160x48 to 200x64.
          A mark small enough to be tasteful is a mark nobody can identify, and
          this is the one element on the document that is not the product's
          design but the freelancer's own.

          `items-start` so a short mark hangs from the top of the group instead
          of centring itself against a five-row grid, and the `<dl>` keeps
          `min-w-0` — it is the flex child that must be allowed to give, so a
          wide logo shortens the value column rather than pushing it out of the
          panel.

          THE ROW BREAKS BELOW `sm`, and it has to. Side by side on a 375px
          phone the mark and the label column together claim more than the panel
          has, and `min-w-0` resolves that by giving the VALUE column what is
          left — which measured 0px: the invoice number, both dates, the PO and
          the payment terms all present and all zero pixels wide, on the page
          whose entire claim is that it shows what the client received. Stacked,
          each gets the full measure.

          `flex-col-reverse`, so the mark sits ABOVE the details rather than
          under them: that is what a letterhead does, and it is the same reading
          order the paper gives (mark at the top of the page, details beneath
          and beside it). It costs nothing in the accessibility tree — the image
          is `alt=""`, decorative, and is skipped either way, so DOM order and
          reading order still agree for anyone not looking at it.
        */}
        <div className="flex flex-col-reverse items-start gap-6 sm:flex-row sm:justify-between sm:gap-8">
          {/* A `<dl>`: this is a document's name/value list, and it is what
              makes "Due date" read as the name of the value beside it. */}
          {/* `w-full` while stacked: `items-start` on the row above sizes
              every child to its own content, which left the whole meta list as
              wide as its longest VALUE (99px) with the rest of the panel empty
              beside it.

              `sm:flex-1` for the same reason at the other end: content-sized,
              the value column measured 93px on a 1280px screen, so a
              `Payment terms` of "Net 30 from receipt of invoice" wrapped to
              three lines with 700px of empty panel beside it. Capped at
              `max-w-xl` — the block is a document header, not a table, and a
              value column running the full 1200px would leave the label and
              its value at opposite ends of the room. */}
          <dl className="flex w-full min-w-0 flex-col gap-2.5 sm:w-auto sm:max-w-xl sm:flex-1">
            {metaRows.map((row) => (
              <div
                key={row.label}
                /* STACKED BELOW `sm`, two columns from there. A 168px label
                   column inside a 279px panel leaves 111px for a value, and a
                   `Payment terms` of "Net 30 from receipt" then wraps to four
                   words a line. The label reads as a heading over its value
                   when they stack, which is the same relationship the grid
                   states horizontally. */
                className="grid grid-cols-1 items-baseline gap-x-3 gap-y-0.5 sm:grid-cols-[10.5rem_1fr]"
              >
                <dt className="text-sm font-medium text-muted-foreground">
                  {row.label}
                </dt>
                {/* Tabular on every one of them: a number, a date and an
                    invoice id are all digits somebody reads down a column. */}
                <dd className="min-w-0 font-mono text-base tracking-[-0.02em] tabular-nums">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          {invoice.logoUrl === null ? null : (
            <img
              src={invoice.logoUrl}
              alt=""
              className="max-h-16 max-w-56 shrink-0 object-contain"
            />
          )}
        </div>
      </div>

      {/*
        TWO EQUAL HALVES, matching the paper exactly: `headOps` draws Billed to
        at the left margin and Pay to at `LEFT + (RIGHT - LEFT) / 2`. A `grid`
        rather than two flexed children, because flex-basis would let a long
        address move the second block and the two documents would then disagree
        about where the reader's eye goes for "where do I send the money".
      */}
      <div className="grid gap-8 sm:grid-cols-2">
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
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-base leading-relaxed whitespace-pre-line">{value}</dd>
    </dl>
  )
}
