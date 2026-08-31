import { cn } from "@/lib/utils"

/**
 * The one field treatment on the invoicing surfaces — the frame, the label, and
 * the refusal beneath.
 *
 * ONE DECLARATION, because `/invoices/new` puts a textarea, two date pickers,
 * two text boxes and a select on one page, and a page where five controls are
 * five independent class strings is a page where they drift. It lives here
 * rather than in `invoice-form.tsx` so `party-block.tsx` can share it without
 * importing its own parent.
 *
 * `bg-background` with an Edge border, NOT the `bg-card` fill `ui/input.tsx`
 * carries. The Adjacent Colour Rule is the reason and it is worth stating: a
 * border has TWO adjacent colours, and a token that clears 3:1 against the
 * page can fall under it against a panel. A background-filled control clears the 3:1 floor on
 * both sides of its border; a surface-filled control on a ground page does not
 * clear on the inside. DESIGN.md names this case — "a control that carries its
 * own `bg-background` fill may keep Edge instead" — and this is a whole form's
 * worth of controls that would otherwise inherit the weaker half.
 */
export const INVOICE_FIELD = cn(
  "w-full rounded-md border bg-background px-2 py-1.5 text-sm",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
)

/** The border a control wears while it is holding text the server refused.
 *  Alarm is never the only carrier — every caller pairs it with `aria-invalid`
 *  and a `role="alert"` sentence. */
export function fieldBorder(refused: boolean): string {
  return refused ? "border-destructive" : "border-input"
}

/**
 * A control's own name, above it.
 *
 * Sentence case and no tracked-out eyebrow — The Sentence Case Rule. A real
 * `<label>`, always: these components are only ever editors. The finished
 * document draws the same names as `<dt>`s, because there is no control for a
 * label to point at (see `InvoiceRecord`).
 */
export function FieldLabelled({
  label,
  htmlFor,
  srOnly,
  children,
}: {
  label: string
  htmlFor: string
  /** Hides the label visually while keeping it for assistive tech — for a
   *  control whose group `<legend>` already says the same word. Removing the
   *  `<label>` instead would leave the control unnamed. */
  srOnly?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className={cn(
          "text-[0.8125rem] font-medium text-muted-foreground",
          srOnly === true && "sr-only"
        )}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

/** The refusal under a control, or nothing. `role="alert"` so it is announced
 *  rather than merely drawn near a control the user has stopped looking at. */
export function FieldRefusal({ id, error }: { id: string; error?: string | null }) {
  if (error === null || error === undefined) return null
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {error}
    </p>
  )
}
