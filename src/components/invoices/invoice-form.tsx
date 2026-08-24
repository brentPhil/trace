import { useId } from "react"
import {
  FieldLabelled,
  FieldRefusal,
  INVOICE_FIELD,
  fieldBorder,
} from "@/components/invoices/field"
import { PartyBlock } from "@/components/invoices/party-block"
import { cn } from "@/lib/utils"
import { dueBeforeIssue } from "@/lib/invoice-draft"
import { supportedCurrencies } from "@shared/money"
import type { InvoiceDraft, InvoiceFieldErrors } from "@/lib/invoice-draft"
import type { DayString } from "@shared/day"

/**
 * Everything a range of time entries cannot tell you, asked once.
 *
 * THE ONLY MOMENT THIS PRODUCT HAS. An invoice is write-once: what is typed
 * here is frozen the instant the document is minted, and there is no editor
 * afterwards to fill a gap in. That is why every field is a permanent control
 * rather than the click-to-edit "Not set" affordance the deleted editor used —
 * "Not set" is an invitation you can accept later, and here there is no later.
 *
 * THREE GROUPS, because eight boxes in a column is a list rather than a
 * document: who the document is between, what it says about itself, and the
 * message at the foot of it. They are real `<fieldset>`s, so the grouping is
 * announced rather than merely drawn — and they run in the order the finished
 * document prints them, which is the order the record page and the PDF share.
 *
 * Controlled by the route, which owns the draft and sends it. This component
 * holds no state and reaches for nothing — the boundary eslint.config.js
 * enforces — so it renders against a plain object in a test.
 */
export function InvoiceForm({
  draft,
  errors,
  onChange,
}: {
  draft: InvoiceDraft
  /** Refusals from the last attempt, keyed by the field `createFromRange`
   *  named in `meta.field`. Never a toast: the text that was refused is still
   *  in the box, and the sentence belongs beside it. */
  errors: InvoiceFieldErrors
  onChange: (patch: Partial<InvoiceDraft>) => void
}) {
  return (
    <div className="flex flex-col gap-7">
      <Group legend="Parties">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <PartyBlock
            label="Billed to"
            value={draft.billedTo}
            placeholder={"Client name\nStreet\nCity, country"}
            error={errors.billedTo}
            onChange={(billedTo) => onChange({ billedTo })}
          />
          {/*
            The field this whole page exists for. `createFromRange` leaves it
            empty — nothing in a range of time entries says who the freelancer
            is, and this product has no pay-to setting to read one from — so
            every invoice raised before this form existed went to a client with
            the "where do I send the money" question unanswered.

            It now OPENS WITH THE LAST INVOICE'S BLOCK (`invoices.lastDetails`,
            through `newInvoiceDraft`), which is the same answer arrived at one
            step further along: asking once is right, asking every month for the
            same bank details is the product forgetting what it was told. Still
            a plain box with the text in it — a carried-over value the user can
            read and overwrite, not a setting hidden behind a page.
          */}
          <PartyBlock
            label="Pay to"
            value={draft.payTo}
            placeholder={"Your name\nStreet\nCity, country"}
            error={errors.payTo}
            onChange={(payTo) => onChange({ payTo })}
          />
        </div>
      </Group>

      <Group legend="Document">
        {/* Two columns from `sm`, in the order the head prints: the dates the
            document turns on, then the two references, then the currency every
            figure below it is denominated in. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <DateField
            label="Invoice date"
            value={draft.issuedOn}
            error={errors.issuedAt}
            onChange={(issuedOn) => onChange({ issuedOn })}
          />
          <DateField
            label="Due date"
            value={draft.dueOn}
            error={errors.dueAt}
            onChange={(dueOn) => onChange({ dueOn })}
            /*
              ADVISORY, NOT A REFUSAL, and the distinction is the mutation's:
              `createFromRange` deliberately does not compare the two dates,
              because "due on receipt" is real and back-dating a document to the
              day the work finished is ordinary. Recomputed from the values AS
              TYPED, so it answers before the document is minted — the only
              moment it can still be fixed. `status` rather than `alert`
              (nothing has failed, nothing is blocked) and muted rather than
              Alarm, which DESIGN.md reserves for destructive and error and
              never for a warning.
            */
            note={
              dueBeforeIssue(draft)
                ? "This due date is before the invoice date, so the document asks to be paid before it was raised."
                : undefined
            }
          />
          <TextField
            label="Purchase order"
            value={draft.purchaseOrder}
            placeholder="Optional"
            error={errors.purchaseOrder}
            onChange={(purchaseOrder) => onChange({ purchaseOrder })}
          />
          <TextField
            label="Payment terms"
            value={draft.paymentTerms}
            placeholder="Net 30"
            error={errors.paymentTerms}
            onChange={(paymentTerms) => onChange({ paymentTerms })}
          />
          {draft.mergeLines ? (
            <TextField
              label="Summary description"
              value={draft.summaryDescription}
              error={errors.summaryDescription}
              onChange={(summaryDescription) =>
                onChange({ summaryDescription })
              }
            />
          ) : null}
          <CurrencyField
            value={draft.currency}
            error={errors.currency}
            onChange={(currency) => onChange({ currency })}
          />
        </div>
      </Group>

      <Group legend="Notes">
        {/*
          `PartyBlock` again rather than a second multiline editor: this is
          prose printed verbatim at the foot of the document, exactly as an
          address block is, and a user should not have to learn two editing
          behaviours in one product. What actually goes here is a bank block —
          account, IBAN, SWIFT, a line of thanks — whose newlines are its shape.
        */}
        <PartyBlock
          label="Notes"
          srOnlyLabel
          value={draft.notes}
          placeholder={"Bank transfer to …\nAccount 1234-5678\n\nThank you!"}
          error={errors.notes}
          onChange={(notes) => onChange({ notes })}
        />
      </Group>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * One group of the form, named.
 *
 * A real `<fieldset>`/`<legend>`, so "Parties" is announced as the name of the
 * boxes under it rather than drawn above them. Sentence case and no rule
 * beneath — The Sentence Case Rule, and a hairline under a two-field group is
 * chrome the spacing already provides.
 */
function Group({
  legend,
  children,
}: {
  legend: string
  children: React.ReactNode
}) {
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className="mb-3 text-sm font-medium">{legend}</legend>
      {children}
    </fieldset>
  )
}

/**
 * A date, in the STORED zone.
 *
 * `<input type="date">` because its value is already a `YYYY-MM-DD` string,
 * which is exactly the `DayString` the day module takes — no locale parsing
 * between the picker and the domain, and the platform's own calendar and
 * keyboard come with it. The draft holds the day rather than an instant for the
 * same reason; the conversion happens once, on the way to the mutation.
 */
function DateField({
  label,
  value,
  error,
  note,
  onChange,
}: {
  label: string
  value: DayString
  error?: string
  note?: string
  onChange: (day: DayString) => void
}) {
  const id = useId()
  const errorId = useId()

  return (
    <FieldLabelled label={label} htmlFor={id}>
      <input
        id={id}
        type="date"
        value={value}
        aria-label={label}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => {
          // An emptied date input is the browser saying "mid-typing", not
          // "this invoice has no date". Ignored rather than recorded: a
          // document always carries both.
          if (event.target.value === "") return
          onChange(event.target.value)
        }}
        className={cn(
          INVOICE_FIELD,
          "font-mono tracking-[-0.02em] tabular-nums",
          fieldBorder(error !== undefined)
        )}
      />
      {note === undefined ? null : (
        <p role="status" className="text-xs text-muted-foreground">
          {note}
        </p>
      )}
      <FieldRefusal id={errorId} error={error} />
    </FieldLabelled>
  )
}

/** A short single-line reference. Bounded server-side; the refusal lands here. */
function TextField({
  label,
  value,
  placeholder,
  error,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  error?: string
  onChange: (next: string) => void
}) {
  const id = useId()
  const errorId = useId()

  return (
    <FieldLabelled label={label} htmlFor={id}>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
        className={cn(INVOICE_FIELD, fieldBorder(error !== undefined))}
      />
      <FieldRefusal id={errorId} error={error} />
    </FieldLabelled>
  )
}

/**
 * The currency this document is DENOMINATED IN, snapshotted at creation.
 *
 * Prefilled from `userSettings.currency` and then the invoice's own forever:
 * the account setting may change and a document that has been sent may not
 * follow it. The list is narrowed to currencies whose minor unit really is a
 * hundredth (`supportedCurrencies`), and `createFromRange` checks that same
 * list server-side, so the picker and the validator cannot disagree.
 *
 * No Currency ROW is printed on the finished document — every amount there is
 * already written in its own symbol, so a row spelling out "USD" restates what
 * `$530.30` has said four times (see `invoiceMetaRows`). It is a control here
 * and a restatement there, which is exactly the difference this field turns on.
 */
function CurrencyField({
  value,
  error,
  onChange,
}: {
  value: string
  error?: string
  onChange: (currency: string) => void
}) {
  const id = useId()
  const errorId = useId()
  const supported = supportedCurrencies()
  const codes = supported.length > 0 ? supported : [value, "USD"]
  // A code outside the list is still shown, so a value already chosen is never
  // silently swapped for something else under the user — the same fallback
  // /settings' own field makes.
  const options = codes.includes(value) ? codes : [value, ...codes]

  return (
    <FieldLabelled label="Currency" htmlFor={id}>
      <select
        id={id}
        value={value}
        aria-label="Currency"
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
        className={cn(INVOICE_FIELD, fieldBorder(error !== undefined))}
      >
        {options.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <FieldRefusal id={errorId} error={error} />
    </FieldLabelled>
  )
}
