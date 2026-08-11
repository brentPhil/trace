import { useId } from "react"
import { cn } from "@/lib/utils"

/**
 * A labelled block of a document — `Billed to`, `Pay to`, `Notes` — that keeps
 * its newlines.
 *
 * NOT `InlineEdit`. That component is the right answer everywhere a value is
 * one line, and it is an `<input>`: Enter commits. Here Enter is a line break,
 * because a party block is `"Vessel Vanguard LLC\nBonita Springs, FL\n34134,
 * USA"` and those newlines are the address's shape — the same property
 * `clients.address` is stored verbatim for, carried through to the document
 * that prints it. So this is a `<textarea>`.
 *
 * IT NO LONGER SAVES ON BLUR, and it is the only field in this product that
 * does not. It is CONTROLLED — the invoice editor owns the value, buffers it,
 * and writes the whole head when Save is pressed. See that route's comment for
 * the argument; the short version is that a document you send to a client is
 * not a settings row, and the user asked to choose when it is written.
 *
 * The consequence for this component is that it holds no state at all, which
 * also removed the subtlest thing in it: a `useEffect` that re-seeded from the
 * server only while the field was unfocused, because a live query delivering
 * someone else's edit mid-sentence would otherwise delete what was being typed.
 * That problem did not go away, it MOVED — a buffered form has the same race
 * across eight fields at once, and the route answers it there, once, rather
 * than eight times with a focus check.
 *
 * Escape still reverts, because a user should not have to learn two editing
 * behaviours in one product. What it reverts TO is now the stored value rather
 * than the last committed one, which is the same sentence it always was.
 */
export function PartyBlock({
  label,
  value,
  placeholder,
  error,
  onChange,
  onRevert,
}: {
  label: string
  value: string
  /** What the empty field shows instead of a blank rectangle. It is the
   *  placeholder rather than a rendered sentence because these blocks are
   *  ALWAYS editable — nothing in this product freezes an invoice — so there is
   *  no read-only state for an absence to be stated in. */
  placeholder?: string
  /** The server's refusal for THIS field, from the last Save. Passed in rather
   *  than caught here: one Save can be refused for one of eight fields, and only
   *  the caller that sent them knows which. */
  error?: string | null
  onChange: (next: string) => void
  /** Escape. Puts the stored value back in this one field, leaving the rest of
   *  the form's unsaved edits alone. */
  onRevert?: () => void
}) {
  // `useId`, not the label: "Billed to" has a space in it, and an id with
  // whitespace is not one.
  const fieldId = useId()
  const errorId = useId()
  const refused = error !== null && error !== undefined

  return (
    <Labelled label={label} htmlFor={fieldId}>
      <textarea
        id={fieldId}
        rows={4}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={refused}
        aria-describedby={refused ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            // Stops the key reaching a dialog or popover above this one. The
            // innermost thing a person is editing is the thing Escape means.
            event.stopPropagation()
            onRevert?.()
          }
        }}
        className={cn(
          // The Boundary Rule: an editable control on ground is identified by
          // its border, never by a fill tint.
          "w-full resize-y rounded-md border bg-ground px-2 py-1.5 text-sm",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          refused ? "border-alarm" : "border-edge"
        )}
      />
      {/* The colour is never the only carrier — DESIGN.md on error states. */}
      {refused ? (
        <p id={errorId} role="alert" className="text-xs text-alarm">
          {error}
        </p>
      ) : null}
    </Labelled>
  )
}

function Labelled({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {/* Sentence case, no tracked-out eyebrow — The Sentence Case Rule. A real
          `<label>`, always: this component is only ever an editor. The document
          as the client received it is drawn by `InvoiceRecord`, where the same
          name is a `<dt>` because there is no control for it to label. */}
      <label htmlFor={htmlFor} className="text-[0.8125rem] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}
