import { useId } from "react"
import {
  FieldLabelled,
  FieldRefusal,
  INVOICE_FIELD,
  fieldBorder,
} from "@/components/invoices/field"
import { cn } from "@/lib/utils"

/**
 * A labelled block of a document — `Billed to`, `Pay to`, `Notes` — that keeps
 * its newlines.
 *
 * NOT `InlineEdit`. That component is the right answer everywhere a value is
 * one line, and it is an `<input>`: Enter commits. Here Enter is a line break,
 * because a party block is `"Vessel Vanguard LLC\nBonita Springs, FL\n34134,
 * USA"` and those newlines are the address's shape — the same property
 * `clients.address` is stored verbatim for, the same property `blockLines`
 * honours on paper, and the same property `whitespace-pre-line` restores on the
 * record page.
 *
 * IT SAVES NOTHING, and no longer because a form buffers it. It belongs to
 * `/invoices/new`, which is the only place in this product these blocks are
 * ever typed: an invoice is write-once, so there is nothing to save INTO until
 * the document is minted, and afterwards there is nothing to save at all. The
 * route owns the draft and this holds no state — which is what lets it be
 * rendered against a plain string in a test.
 *
 * A refusal arrives from the one mutation that sent all eight fields, so which
 * field a message is about is the caller's knowledge, not this component's.
 */
export function PartyBlock({
  label,
  srOnlyLabel,
  value,
  placeholder,
  error,
  onChange,
}: {
  label: string
  /** See `FieldLabelled`'s `srOnly` — for the Notes block, whose group legend
   *  already says the word. */
  srOnlyLabel?: boolean
  value: string
  /** What the empty field shows instead of a blank rectangle. A placeholder
   *  rather than a rendered sentence because this control is always editable:
   *  the finished document states its absences, and that is `InvoiceRecord`. */
  placeholder?: string
  error?: string | null
  onChange: (next: string) => void
}) {
  // `useId`, not the label: "Billed to" has a space in it, and an id with
  // whitespace is not one.
  const fieldId = useId()
  const errorId = useId()
  const refused = error !== null && error !== undefined

  return (
    <FieldLabelled label={label} htmlFor={fieldId} srOnly={srOnlyLabel}>
      <textarea
        id={fieldId}
        rows={4}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={refused}
        aria-describedby={refused ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(INVOICE_FIELD, "resize-y", fieldBorder(refused))}
      />
      <FieldRefusal id={errorId} error={error} />
    </FieldLabelled>
  )
}
