import { useEffect, useId, useRef, useState } from "react"
import { errorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"

/**
 * A labelled block of a document — `Billed to`, `Pay to` — that keeps its
 * newlines.
 *
 * NOT `InlineEdit`. That component is the right answer everywhere a value is
 * one line, and it is an `<input>`: Enter commits. Here Enter is a line break,
 * because a party block is `"Vessel Vanguard LLC\nBonita Springs, FL\n34134,
 * USA"` and those newlines are the address's shape — the same property
 * `clients.address` is stored verbatim for, carried through to the document
 * that prints it. So this is a `<textarea>`, and blur is the only commit.
 *
 * Everything else follows InlineEdit's rules deliberately, because a user
 * should not have to learn two editing behaviours in one product: blur saves,
 * Escape reverts, an unchanged value writes nothing, and a refusal keeps the
 * typed text on screen with the reason beside it rather than silently
 * restoring what the server still holds.
 */
export function PartyBlock({
  label,
  value,
  placeholder,
  emptyText,
  readOnly = false,
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  /** What the block says when it is empty and cannot be typed into. An absence
   *  stated as an absence — never a blank rectangle, which reads as a
   *  rendering fault on a document. */
  emptyText: string
  readOnly?: boolean
  /** Passed in, never reached for — see the component/Convex boundary in
   *  eslint.config.js. */
  onCommit: (next: string) => Promise<void>
}) {
  const [raw, setRaw] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  // `useId`, not the label: "Billed to" has a space in it, and an id with
  // whitespace is not one.
  const fieldId = useId()
  const errorId = useId()

  /*
   * The server's value wins between edits, but never while the field has
   * focus. Convex queries are live: an edit committed in another tab arrives
   * as a new `value` mid-sentence, and re-seeding then would delete what is
   * being typed. Blur is the only commit, so "not focused" is exactly "not
   * mid-edit".
   */
  useEffect(() => {
    if (document.activeElement !== ref.current) setRaw(value)
  }, [value])

  if (readOnly) {
    return (
      <Labelled label={label}>
        {value.trim() === "" ? (
          <p className="text-sm italic text-muted-foreground">{emptyText}</p>
        ) : (
          // `whitespace-pre-wrap` is the whole point: this is the block as the
          // document prints it, line breaks and all.
          <p className="text-sm whitespace-pre-wrap">{value}</p>
        )}
      </Labelled>
    )
  }

  const commit = async () => {
    const trimmed = raw.trim()
    // Unchanged is not an edit — the same rule InlineEdit follows, and for the
    // same reason: blurring off a field nobody touched must never write, and
    // must never raise.
    if (trimmed === value.trim()) {
      setRaw(value)
      return
    }
    try {
      await onCommit(trimmed)
      setError(null)
    } catch (thrown) {
      setError(errorMessage(thrown))
    }
  }

  return (
    <Labelled label={label} htmlFor={fieldId}>
      <textarea
        id={fieldId}
        ref={ref}
        rows={4}
        value={raw}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        onChange={(event) => {
          setRaw(event.target.value)
          if (error !== null) setError(null)
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            setRaw(value)
            setError(null)
          }
        }}
        className={cn(
          // The Boundary Rule: an editable control on ground is identified by
          // its border, never by a fill tint.
          "w-full resize-y rounded-md border bg-ground px-2 py-1.5 text-sm",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          error === null ? "border-edge" : "border-alarm"
        )}
      />
      {/* The colour is never the only carrier — DESIGN.md on error states. */}
      {error === null ? null : (
        <p id={errorId} role="alert" className="text-xs text-alarm">
          {error}
        </p>
      )}
    </Labelled>
  )
}

function Labelled({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {/* Sentence case, no tracked-out eyebrow — The Sentence Case Rule. */}
      {htmlFor === undefined ? (
        <span className="text-[0.8125rem] font-medium text-muted-foreground">{label}</span>
      ) : (
        <label
          htmlFor={htmlFor}
          className="text-[0.8125rem] font-medium text-muted-foreground"
        >
          {label}
        </label>
      )}
      {children}
    </div>
  )
}
