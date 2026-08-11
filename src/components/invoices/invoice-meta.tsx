import { useId, useState } from "react"
import { InlineEdit } from "@/components/entries/inline-edit"
import { errorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import { dayOf, startOfDay } from "@shared/day"

/**
 * The document head's field grid: number, dates, purchase order, terms.
 *
 * Every date on it is read and written in the user's STORED zone, never the
 * browser's. A freelancer who invoices from an airport must not find the
 * document dated a day either side of what they raised it on, and `dayOf` /
 * `startOfDay` are the one place that decision lives.
 */
export function InvoiceMeta({
  number,
  issuedAt,
  dueAt,
  purchaseOrder,
  paymentTerms,
  timeZone,
  onChange,
}: {
  number: string
  issuedAt: number
  dueAt: number
  purchaseOrder: string | undefined
  paymentTerms: string | undefined
  timeZone: string
  /** Passed in, never reached for — see the component/Convex boundary in
   *  eslint.config.js. A patch, so one blur is one write. */
  onChange: (patch: {
    issuedAt?: number
    dueAt?: number
    purchaseOrder?: string
    paymentTerms?: string
  }) => Promise<void>
}) {
  return (
    <dl className="flex flex-col gap-2">
      {/*
        The number is READ-ONLY here, and not because the editor is unfinished.
        It is the invoice's identity, minted one past the highest sequence ever
        used against a bounded uniqueness scan (see INVOICE_NUMBER_SCAN_LIMIT),
        and letting a blur renumber a document is how two invoices come to
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
          onPick={async (next) => await onChange({ issuedAt: next })}
        />
      </Row>

      <Row label="Due date">
        <DateField
          label="Due date"
          instant={dueAt}
          timeZone={timeZone}
          onPick={async (next) => await onChange({ dueAt: next })}
        />
        {/*
          ADVISORY, NOT A REFUSAL — and the two are different acts here.
          `invoices.update` deliberately does not check one date against the
          other, because autosave commits one field per blur and an ordering
          rule would refuse or accept the same edit depending on which date was
          blurred first (see that function's comment). Saying nothing was the
          other half of that decision going wrong: nothing on the document drew
          the relationship, so the mistake was only "visible" to a reader who
          already knew to look.

          This recomputes every render from the two values as they stand, so it
          is order-independent by construction and costs nothing server-side.
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
          onCommit={async (next) => await onChange({ purchaseOrder: next })}
        />
      </Row>

      <Row label="Payment terms">
        <TextField
          label="Payment terms"
          value={paymentTerms}
          onCommit={async (next) => await onChange({ paymentTerms: next })}
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
 * Saved on CHANGE rather than on blur, unlike the text beside it. A picker
 * commits a whole date at once, so there is no half-typed state to protect;
 * the selects on /settings save the same way, and for the same reason.
 *
 * THE PICK SURVIVES A REFUSAL. Controlled straight off `instant`, a rejected
 * save left React re-rendering the previous value, so the date the user chose
 * vanished at the same moment the message beside it said the date on screen was
 * the thing to fix — the one autosave path in the product that discarded input,
 * where `PartyBlock` and `InlineEdit` both keep it. `pending` holds the chosen
 * day until the write lands, and only the write clears it.
 */
function DateField({
  label,
  instant,
  timeZone,
  onPick,
}: {
  label: string
  instant: number
  timeZone: string
  onPick: (instant: number) => Promise<void>
}) {
  const id = useId()
  const errorId = useId()
  const [error, setError] = useState<string | null>(null)
  /** The day the user picked, held only until the write that would make it the
   *  stored one either lands or is refused. */
  const [pending, setPending] = useState<string | null>(null)
  const day = dayOf(instant, timeZone)

  return (
    <div className="flex flex-col gap-1">
      <input
        id={id}
        type="date"
        aria-label={label}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        value={pending ?? day}
        onChange={(event) => {
          const picked = event.target.value
          // An emptied date input is the browser saying "mid-typing", not
          // "this invoice has no date". Ignored rather than written: a
          // document always carries both.
          if (picked === "") return
          setPending(picked)
          // No cast: `DayString` is a documented alias for `string`, and the
          // input's own value is already YYYY-MM-DD, which is the whole reason
          // this is a date input rather than a parsed text field.
          void onPick(startOfDay(picked, timeZone)).then(
            () => {
              // Cleared only if this pick is still the one on screen. A second
              // pick made while the first was in flight would otherwise be
              // replaced by the first one's now-stored value.
              setPending((current) => (current === picked ? null : current))
              setError(null)
            },
            // A refusal is shown BESIDE the field it came from rather than as
            // a toast: the date is still on screen and is the thing to fix —
            // which is only true because `pending` is NOT cleared here.
            (thrown: unknown) => setError(errorMessage(thrown))
          )
        }}
        className={cn(
          "rounded-md border bg-ground px-2 py-1 text-sm tabular",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          error === null ? "border-edge" : "border-alarm"
        )}
      />
      {error === null ? null : (
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
 * "not set" rather than an em dash because there is no longer a frozen invoice
 * for which the absence would be permanent: this one is an invitation.
 */
function TextField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string | undefined
  onCommit: (next: string) => Promise<void>
}) {
  const set = value !== undefined && value !== ""
  return (
    <InlineEdit<string>
      display={
        <span className={cn("text-sm", !set && "italic text-muted-foreground")}>
          {set ? value : "Not set"}
        </span>
      }
      initialInput={value ?? ""}
      ariaLabel={label}
      placeholder="Optional"
      className="-mx-1 px-1 py-0.5 text-sm"
      inputClassName="w-56 text-sm"
      // Anything is a legal reference, including nothing: clearing the field is
      // how it is unset, and the server turns an empty string into an absent
      // column rather than storing two spellings of "not set". Length is
      // refused server-side, and that refusal reopens the field with the text
      // still in it.
      parse={(raw) => ({ ok: true, value: raw })}
      onCommit={onCommit}
    />
  )
}
