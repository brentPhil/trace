import { useEffect, useId, useRef, useState } from "react"
import { errorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * A value that reads as text until you click it, and is an input while you do.
 *
 * The correction this product actually sees is one field — a start time typed
 * five minutes off, a title with a typo — ten or more times a day. A modal
 * turns that two-second fix into open, change, save, close, so the list edits
 * in place instead. No save button either: Enter and blur both commit, which
 * are the two things a person does when they have finished typing.
 *
 * Escape reverts and hands focus back to the trigger, so a mistake costs one
 * key and never leaves focus stranded in a control that no longer exists.
 *
 * A parse failure keeps the field OPEN with the bad text still in it. Clearing
 * the input or silently reverting would throw away what the user typed and give
 * them nothing to correct — and blur would then commit the reverted value,
 * which is the worst of both.
 */
export function InlineEdit<T>({
  display,
  initialInput,
  ariaLabel,
  parse,
  onCommit,
  className,
  inputClassName,
  disabled = false,
  grow = false,
  placeholder,
}: {
  /** What is shown when not editing. */
  display: React.ReactNode
  /** What the input is seeded with when editing opens. */
  initialInput: string
  ariaLabel: string
  parse: (raw: string) => ParseOutcome<T>
  onCommit: (value: T) => void | Promise<void>
  className?: string
  inputClassName?: string
  disabled?: boolean
  /**
   * Whether the field fills the space available while editing.
   *
   * Off by default: a time or a duration should stay the width of the value it
   * holds, so opening one does not shove the columns beside it. A title is the
   * opposite — it is prose, it is usually longer than the row shows, and
   * editing it inside a box the width of the truncated text means typing into a
   * two-word window.
   */
  grow?: boolean
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState(initialInput)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const errorId = useId()
  // Guards the blur handler while Escape is unwinding, so cancelling does not
  // immediately commit on the way out.
  const cancelling = useRef(false)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const open = () => {
    if (disabled) return
    setRaw(initialInput)
    setError(null)
    setEditing(true)
  }

  /**
   * Hands focus back to the trigger the editor replaced.
   *
   * Required on EVERY path that closes the editor, not just Escape. The input
   * unmounts, so without this focus falls to <body> and the next Tab restarts
   * from the top of the document — a keyboard or screen-reader user loses their
   * place in the log on every successful edit, which is the common case rather
   * than the exceptional one.
   *
   * Skipped when the editor is closing because focus already moved somewhere
   * else (a click on another control), since stealing it back would fight the
   * user's own gesture.
   */
  const returnFocus = (force: boolean) => {
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (force || active === null || active === document.body) {
        triggerRef.current?.focus()
      }
      cancelling.current = false
    })
  }

  const cancel = () => {
    cancelling.current = true
    setEditing(false)
    setError(null)
    returnFocus(true)
  }

  /**
   * `fromKeyboard` is true for Enter and false for blur.
   *
   * Enter keeps focus in a control that is about to unmount, so it has to be
   * put back. A blur means focus has already gone somewhere the user chose, and
   * dragging it back to the trigger would undo their click.
   */
  const commit = async (fromKeyboard: boolean) => {
    if (cancelling.current) return

    const trimmed = raw.trim()
    // Unchanged is not an edit. Skipping the write avoids a pointless mutation
    // and, more importantly, a pointless refusal — blurring off a field the
    // user never touched must never raise an error.
    if (trimmed === initialInput.trim()) {
      setEditing(false)
      returnFocus(fromKeyboard)
      return
    }

    const parsed = parse(trimmed)
    if (!parsed.ok) {
      setError(parsed.message)
      inputRef.current?.focus()
      return
    }

    setEditing(false)
    setError(null)
    returnFocus(fromKeyboard)

    try {
      await onCommit(parsed.value)
    } catch (thrown) {
      // A refusal from the server reopens the field with the rejected text
      // still in it. Closing on a write that did not happen would show the old
      // value back in place with no explanation — the user would read that as
      // the edit being ignored, and try again.
      setRaw(trimmed)
      setError(errorMessage(thrown))
      setEditing(true)
    }
  }

  if (!editing) {
    return (
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={open}
        aria-label={ariaLabel}
        className={cn(
          "rounded-sm text-left",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          !disabled && "hover:bg-surface-raised/70",
          className
        )}
      >
        {display}
      </button>
    )
  }

  return (
    <span className={cn("relative inline-flex", grow && "min-w-0 flex-1")}>
      <input
        ref={inputRef}
        value={raw}
        aria-label={ariaLabel}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        placeholder={placeholder}
        onChange={(event) => {
          setRaw(event.target.value)
          if (error !== null) setError(null)
        }}
        onBlur={() => void commit(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            void commit(true)
          } else if (event.key === "Escape") {
            event.preventDefault()
            // Stops the key reaching a dialog or popover above this one. The
            // innermost thing a person is editing is the thing Escape means.
            event.stopPropagation()
            cancel()
          }
        }}
        className={cn(
          "w-full rounded-sm border bg-ground px-1.5 py-0.5",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          error === null ? "border-edge" : "border-alarm",
          inputClassName,
          className
        )}
      />
      {error === null ? null : (
        <span
          id={errorId}
          role="alert"
          className={cn(
            "absolute top-full left-0 z-20 mt-1 w-max max-w-[16rem] rounded-md",
            "border border-edge-soft bg-surface-raised px-2 py-1",
            "text-xs text-foreground shadow-lg"
          )}
        >
          {error}
        </span>
      )}
    </span>
  )
}
