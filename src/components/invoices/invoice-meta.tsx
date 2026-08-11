import { useId } from "react"
import { InlineEdit } from "@/components/entries/inline-edit"
import { cn } from "@/lib/utils"
import { dayOf, startOfDay } from "@shared/day"

/**
 * The document head's field grid: number, dates, purchase order, terms.
 *
 * Every date on it is read and written in the user's STORED zone, never the
 * browser's. A freelancer who invoices from an airport must not find the
 * document dated a day either side of what they raised it on, and `dayOf` /
 * `startOfDay` are the one place that decision lives.
 *
 * BUFFERED. `onChange` updates the editor's draft and writes nothing — the
 * whole head goes to the server when Save is pressed. So it is synchronous, it
 * cannot be refused, and there is no per-field save state left in here; a
 * refusal arrives later, from the one Save that sent all eight fields, and it
 * arrives as `errors` keyed by the field it is about.
 */
export function InvoiceMeta({
  number,
  issuedAt,
  dueAt,
  purchaseOrder,
  paymentTerms,
  timeZone,
  errors,
  onChange,
}: {
  number: string
  issuedAt: number
  dueAt: number
  purchaseOrder: string
  paymentTerms: string
  timeZone: string
  /** The last Save's refusals, by field. Empty on a form that has not been
   *  refused, which is every form until somebody presses Save. */
  errors?: {
    issuedAt?: string
    dueAt?: string
    purchaseOrder?: string
    paymentTerms?: string
  }
  /** Passed in, never reached for — see the component/Convex boundary in
   *  eslint.config.js. A patch into the editor's draft, not a write. */
  onChange: (patch: {
    issuedAt?: number
    dueAt?: number
    purchaseOrder?: string
    paymentTerms?: string
  }) => void
}) {
  return (
    <dl className="flex flex-col gap-2">
      {/*
        The number is READ-ONLY here, and not because the editor is unfinished.
        It is the invoice's identity, minted one past the highest sequence ever
        used against a bounded uniqueness scan (see INVOICE_NUMBER_SCAN_LIMIT),
        and letting an edit renumber a document is how two invoices come to
        claim the same id. Ink, never brass: an identifier is not money.
      */}
      <Row label="Invoice number">
        <span className="text-sm tabular">{number}</span>
      </Row>

      <Row label="Invoice date">
        <DateField
          label="Invoice date"
          instant={issuedAt}
          timeZone={timeZone}
          error={errors?.issuedAt}
          onPick={(next) => onChange({ issuedAt: next })}
        />
      </Row>

      <Row label="Due date">
        <DateField
          label="Due date"
          instant={dueAt}
          timeZone={timeZone}
          error={errors?.dueAt}
          onPick={(next) => onChange({ dueAt: next })}
        />
        {/*
          ADVISORY, NOT A REFUSAL — and the two are different acts here.
          `invoices.update` deliberately does not check one date against the
          other, because it is a patch and may be handed either date alone (see
          that function's comment). Saying nothing was the other half of that
          decision going wrong: nothing on the document drew the relationship, so
          the mistake was only "visible" to a reader who already knew to look.

          This recomputes every render from the two values AS TYPED — the draft,
          not the stored pair — so it answers before a Save rather than after
          one, which is the whole point of a form that buffers. It is
          order-independent by construction and costs nothing server-side.
          Compared as DAYS rather than instants: an invoice raised at 14:00 has
          an `issuedAt` mid-afternoon while a picked due date is midnight, so an
          instant comparison would warn about a due date on the same day.
          `status` rather than `alert` — nothing has failed and nothing is
          blocked — and muted rather than Alarm, which DESIGN.md reserves for
          destructive and error, never for a warning.
        */}
        {dayOf(dueAt, timeZone) < dayOf(issuedAt, timeZone) ? (
          <p role="status" className="mt-1 text-xs text-muted-foreground">
            This due date is before the invoice date, so this document asks to be
            paid before it was raised.
          </p>
        ) : null}
      </Row>

      <Row label="Purchase order">
        <TextField
          label="Purchase order"
          value={purchaseOrder}
          error={errors?.purchaseOrder}
          onCommit={(next) => onChange({ purchaseOrder: next })}
        />
      </Row>

      <Row label="Payment terms">
        <TextField
          label="Payment terms"
          value={paymentTerms}
          error={errors?.paymentTerms}
          onCommit={(next) => onChange({ paymentTerms: next })}
        />
      </Row>
    </dl>
  )
}

/**
 * One labelled line of the head.
 *
 * A `<dl>` rather than a table or a stack of divs: this is a document's
 * name/value list, which is the one thing a definition list is for, and it is
 * what makes "Due date" read as the name of the value beside it rather than as
 * a heading over a column.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-baseline gap-3">
      {/* Sentence case, no tracked-out eyebrow — The Sentence Case Rule. */}
      <dt className="text-[0.8125rem] font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

/**
 * A date, in the stored zone.
 *
 * `<input type="date">` for the reason `ManualEntryDialog` gives: its value is
 * already a YYYY-MM-DD string, which is exactly the `DayString` the day module
 * takes, so there is no locale parsing between the picker and the domain — and
 * the platform's own calendar and keyboard come with it.
 *
 * THE PICK SURVIVES A REFUSAL, and it now does so for free. It used to need a
 * `pending` day held here, because the input was controlled straight off the
 * STORED instant and a rejected write re-rendered the previous value — the date
 * the user chose vanished at the same moment the message beside it said the date
 * on screen was the thing to fix. Buffering deleted that machinery rather than
 * fixing it: the instant handed in IS the draft, so a refused Save leaves the
 * picked date exactly where it was and this component has no state at all.
 */
function DateField({
  label,
  instant,
  timeZone,
  error,
  onPick,
}: {
  label: string
  instant: number
  timeZone: string
  error?: string
  onPick: (instant: number) => void
}) {
  const id = useId()
  const errorId = useId()

  return (
    <div className="flex flex-col gap-1">
      <input
        id={id}
        type="date"
        aria-label={label}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        value={dayOf(instant, timeZone)}
        onChange={(event) => {
          const picked = event.target.value
          // An emptied date input is the browser saying "mid-typing", not
          // "this invoice has no date". Ignored rather than recorded: a
          // document always carries both.
          if (picked === "") return
          // No cast: `DayString` is a documented alias for `string`, and the
          // input's own value is already YYYY-MM-DD, which is the whole reason
          // this is a date input rather than a parsed text field.
          onPick(startOfDay(picked, timeZone))
        }}
        className={cn(
          "rounded-md border bg-ground px-2 py-1 text-sm tabular",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          error === undefined ? "border-edge" : "border-alarm"
        )}
      />
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-xs text-alarm">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * A short optional reference, edited in place.
 *
 * `InlineEdit` rather than a permanent input, because these two are usually
 * unset and an empty box beside "Purchase order" on a document reads as a
 * missing value rather than as an absent one. "Not set" is the same "state the
 * absence" treatment `formatRate` gives a project with no rate — and it says
 * "not set" rather than an em dash because there is no frozen invoice for which
 * the absence would be permanent: this one is an invitation.
 *
 * `InlineEdit` IS UNCHANGED, and that matters: it still commits on blur and on
 * Enter, exactly as it does on every entry row in the product. What changed is
 * what "commit" reaches — the editor's draft rather than the server — so this
 * field learns nothing new and the rest of the app keeps the behaviour it has.
 * The refusal is therefore drawn OUTSIDE it, under the closed field, because by
 * the time a Save is refused this control has long since committed and closed.
 */
function TextField({
  label,
  value,
  error,
  onCommit,
}: {
  label: string
  value: string
  error?: string
  onCommit: (next: string) => void
}) {
  const errorId = useId()
  const set = value !== ""
  return (
    <div className="flex flex-col gap-1">
      <InlineEdit<string>
        display={
          <span className={cn("text-sm", !set && "italic text-muted-foreground")}>
            {set ? value : "Not set"}
          </span>
        }
        initialInput={value}
        ariaLabel={label}
        placeholder="Optional"
        className="-mx-1 px-1 py-0.5 text-sm"
        inputClassName="w-56 text-sm"
        // Anything is a legal reference, including nothing: clearing the field is
        // how it is unset, and the server turns an empty string into an absent
        // column rather than storing two spellings of "not set". Length is
        // refused server-side, on Save, and that refusal is drawn below.
        parse={(raw) => ({ ok: true, value: raw })}
        onCommit={onCommit}
      />
      {error === undefined ? null : (
        <p id={errorId} role="alert" className="text-xs text-alarm">
          {error}
        </p>
      )}
    </div>
  )
}
