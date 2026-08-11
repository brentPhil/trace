import { useId, useState } from "react"
import { InlineEdit } from "@/components/entries/inline-edit"
import { errorMessage } from "@/lib/error-message"
import { format } from "@/lib/report-series"
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
  readOnly = false,
  onChange,
}: {
  number: string
  issuedAt: number
  dueAt: number
  purchaseOrder: string | undefined
  paymentTerms: string | undefined
  timeZone: string
  readOnly?: boolean
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
          readOnly={readOnly}
          onPick={async (next) => await onChange({ issuedAt: next })}
        />
      </Row>

      <Row label="Due date">
        <DateField
          label="Due date"
          instant={dueAt}
          timeZone={timeZone}
          readOnly={readOnly}
          onPick={async (next) => await onChange({ dueAt: next })}
        />
      </Row>

      <Row label="Purchase order">
        <TextField
          label="Purchase order"
          value={purchaseOrder}
          readOnly={readOnly}
          onCommit={async (next) => await onChange({ purchaseOrder: next })}
        />
      </Row>

      <Row label="Payment terms">
        <TextField
          label="Payment terms"
          value={paymentTerms}
          readOnly={readOnly}
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
 */
function DateField({
  label,
  instant,
  timeZone,
  readOnly,
  onPick,
}: {
  label: string
  instant: number
  timeZone: string
  readOnly: boolean
  onPick: (instant: number) => Promise<void>
}) {
  const id = useId()
  const errorId = useId()
  const [error, setError] = useState<string | null>(null)
  const day = dayOf(instant, timeZone)

  if (readOnly) {
    return (
      <span className="text-sm tabular">
        {format(day, { day: "numeric", month: "short", year: "numeric" })}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        id={id}
        type="date"
        aria-label={label}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        value={day}
        onChange={(event) => {
          const picked = event.target.value
          // An emptied date input is the browser saying "mid-typing", not
          // "this invoice has no date". Ignored rather than written: a
          // document always carries both.
          if (picked === "") return
          // No cast: `DayString` is a documented alias for `string`, and the
          // input's own value is already YYYY-MM-DD, which is the whole reason
          // this is a date input rather than a parsed text field.
          void onPick(startOfDay(picked, timeZone)).then(
            () => setError(null),
            // A refusal is shown BESIDE the field it came from rather than as
            // a toast: the date is still on screen and is the thing to fix.
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
 * missing value rather than as an absent one. The em dash is the same "state
 * the absence" treatment `formatRate` gives a project with no rate.
 */
function TextField({
  label,
  value,
  readOnly,
  onCommit,
}: {
  label: string
  value: string | undefined
  readOnly: boolean
  onCommit: (next: string) => Promise<void>
}) {
  const set = value !== undefined && value !== ""
  return (
    <InlineEdit<string>
      display={
        <span className={cn("text-sm", !set && "italic text-muted-foreground")}>
          {set ? value : readOnly ? "—" : "Not set"}
        </span>
      }
      initialInput={value ?? ""}
      ariaLabel={label}
      placeholder="Optional"
      disabled={readOnly}
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
