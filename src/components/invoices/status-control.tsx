import { cn } from "@/lib/utils"

export type InvoiceStatus = "draft" | "issued" | "paid"

/**
 * The status, as a word.
 *
 * A coloured dot is the obvious control here and this system forbids it:
 * meaning is never carried by colour alone. There is no colour that could
 * carry it either — cold means running and warm means money, and a draft
 * invoice is neither. So the word IS the signal.
 *
 * One map, imported by both the list and the editor, because "Issued" is a
 * word a client reads on a document and two spellings of it would be two
 * products.
 */
export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  paid: "Paid",
}

/**
 * What this control offers from where the invoice already is.
 *
 * NOT every status: Draft appears only when the invoice is already in it.
 * Going BACK to draft is the unlock — the act that thaws a document somebody
 * has been sent — and it lives on its own button beside the fields it
 * unfreezes, not in the same menu as "mark it paid". The server enforces the
 * same line one step at a time (`invoices.setStatus`), so this list is the
 * shape of that rule rather than a second, softer version of it.
 *
 * `paid -> issued` IS offered, because un-paying is a correction rather than
 * an unlock: it says the money did not arrive, and the document stays frozen
 * either way.
 */
const CHOICES: Record<InvoiceStatus, ReadonlyArray<InvoiceStatus>> = {
  draft: ["draft", "issued"],
  issued: ["issued", "paid"],
  paid: ["issued", "paid"],
}

/**
 * The top-right control, and the one place an invoice's status changes.
 *
 * It is a `<select>` rather than the reference's `[Draft ▾]` menu button for
 * the reason /settings' fields are: it is a choice among three named states,
 * the platform's own keyboard and screen-reader behaviour is already right for
 * that, and there is nothing here a popup would add but a focus trap to get
 * wrong.
 */
export function StatusControl({
  status,
  disabled = false,
  onChange,
}: {
  status: InvoiceStatus
  disabled?: boolean
  /** Passed in, never reached for — see the component/Convex boundary in
   *  eslint.config.js. */
  onChange: (next: InvoiceStatus) => void
}) {
  return (
    <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
      Status
      <select
        aria-label="Status"
        value={status}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as InvoiceStatus)}
        className={cn(
          // `border-edge`, not `border-edge-soft`: this is an interactive
          // control sitting on the page's own ground — The Boundary Rule.
          "rounded-md border border-edge bg-ground px-2 py-1 text-sm text-foreground",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "disabled:opacity-50"
        )}
      >
        {CHOICES[status].map((choice) => (
          <option key={choice} value={choice}>
            {STATUS_LABEL[choice]}
          </option>
        ))}
      </select>
    </label>
  )
}
