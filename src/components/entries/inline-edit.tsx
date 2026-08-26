import { useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
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
  multiline = false,
  maxLength,
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
  /**
   * PROSE, in a textarea that grows to fit it.
   *
   * The one field in the log that is neither a value nor a name: a note is
   * sentences, it holds the paragraph breaks the writer typed, and it is
   * routinely longer than the row it belongs to. Three behaviours change with
   * it and each one would be wrong for a title:
   *
   *   - Enter inserts a newline instead of committing. A note that cannot hold
   *     two sentences is not worth collecting.
   *   - Opening puts the caret at the END rather than selecting the value. A
   *     selected title is a convenience — retyping four words is the usual
   *     edit. A selected note is a hazard: the next keystroke destroys a
   *     paragraph the user came back to add one line to.
   *   - The box sizes itself to its content, so reading what you already wrote
   *     does not mean scrolling a four-line window.
   *
   * Everything else — blur commits, Escape reverts, a refusal reopens with the
   * rejected text — is deliberately identical, because those are the parts that
   * make an inline field predictable across the whole row.
   */
  multiline?: boolean
  /** Hard cap on what the field will accept, forwarded to the element so the
   *  browser enforces it rather than a validator refusing after the fact. */
  maxLength?: number
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState(initialInput)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const errorId = useId()
  // Guards the blur handler while Escape is unwinding, so cancelling does not
  // immediately commit on the way out.
  const cancelling = useRef(false)

  useEffect(() => {
    if (!editing) return
    const field = inputRef.current
    if (field === null) return
    field.focus()
    if (multiline) {
      // Caret to the end, nothing selected — see `multiline` above for why the
      // title's select-all is the wrong gesture on a paragraph.
      field.setSelectionRange(field.value.length, field.value.length)
    } else {
      field.select()
    }
  }, [editing, multiline])

  /**
   * The textarea's height, recomputed from its own content.
   *
   * `height: auto` first and then `scrollHeight`, which is the only way to let
   * a textarea SHRINK: `scrollHeight` never reports less than the current
   * height, so measuring without the reset makes the box a one-way ratchet that
   * stays tall after the text is cut back.
   *
   * The ceiling is CSS (`max-h` on the field), not a number here — past it the
   * textarea scrolls like any other, which is the right answer for a note long
   * enough to be a page of its own.
   */
  const autoSize = (field: HTMLTextAreaElement | null) => {
    if (field === null) return
    field.style.height = "auto"
    field.style.height = `${field.scrollHeight}px`
  }

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
      // `px-0`: this trigger wears its caller's text verbatim — a title, a
      // duration — and the row it sits in aligns on that text's own left edge,
      // so the size's horizontal padding would shift every field in the log by
      // 4px against the day header above it.
      <Button
        ref={triggerRef}
        type="button"
        variant="quiet"
        size="row-trigger"
        disabled={disabled}
        onClick={open}
        aria-label={ariaLabel}
        className={cn(
          "px-0 py-0 text-left text-[length:inherit] text-inherit",
          !disabled && "hover:bg-surface-raised/70",
          className
        )}
      >
        {display}
      </Button>
    )
  }

  /**
   * Shared by both fields, so the two keys that mean the same thing everywhere
   * in this component keep meaning it.
   *
   * ENTER IS THE ONE THAT FORKS. On a single-line field it is "I have finished
   * typing"; in a paragraph it is a line break, and the explicit commit moves
   * to ⌘/Ctrl+Enter — the same pairing the note editor used when it was a
   * dialog, so the key someone already has in their fingers still works.
   * Escape is identical in both: revert, and give focus back.
   */
  const onKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    if (event.key === "Enter") {
      if (multiline && !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      void commit(true)
    } else if (event.key === "Escape") {
      event.preventDefault()
      // Stops the key reaching a dialog or popover above this one. The
      // innermost thing a person is editing is the thing Escape means.
      event.stopPropagation()
      cancel()
    }
  }

  const fieldProps = {
    value: raw,
    "aria-label": ariaLabel,
    "aria-invalid": error !== null,
    "aria-describedby": error === null ? undefined : errorId,
    placeholder,
    maxLength,
    onBlur: () => void commit(false),
    onKeyDown,
  }

  if (multiline) {
    return (
      /*
        `block`, not the `inline-flex` below: a note's editor is a paragraph
        that takes the row's whole width, and an inline box would sit on the
        text baseline of the line it replaced.

        `className` is deliberately NOT applied here, unlike the single-line
        branch. It dresses the TRIGGER — for a note that means a 20px clipped
        box, a hatch, negative margins — and every one of those is wrong on the
        editor that replaces it. `inputClassName` is the field's own slot.
      */
      <span className="relative block w-full">
        <textarea
          {...fieldProps}
          /*
           * A CALLBACK REF, so the first measurement happens on the paint that
           * mounts the field rather than a keystroke later. The editor opens
           * seeded with an existing note, and a box sized for `rows={1}` until
           * something is typed would make the reader scroll to see what they
           * already wrote — which is the complaint this replaced a dialog to
           * answer. `rows={1}` is the floor `autoSize` measures up from;
           * `min-h-24` below is what the box actually opens at when the note is
           * short or empty.
           */
          ref={(field) => {
            inputRef.current = field
            autoSize(field)
          }}
          rows={1}
          onChange={(event) => {
            setRaw(event.target.value)
            autoSize(event.target)
            if (error !== null) setError(null)
          }}
          className={cn(
            "block w-full resize-none rounded-sm border bg-ground px-1.5 py-1",
            "max-h-[24rem] min-h-24 text-sm leading-relaxed",
            "placeholder:text-muted-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            error === null ? "border-edge" : "border-alarm",
            inputClassName
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

  return (
    <span className={cn("relative inline-flex", grow && "min-w-0 flex-1")}>
      <input
        {...fieldProps}
        ref={inputRef as React.RefObject<HTMLInputElement>}
        onChange={(event) => {
          setRaw(event.target.value)
          if (error !== null) setError(null)
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
