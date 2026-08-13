import { cn } from "@/lib/utils"

/**
 * A note as the log draws it: the prose itself, or the hatch inviting one.
 *
 * EXTRACTED FROM `EntryRow` rather than copied into `SittingRow`, because the
 * two comments below are the kind that go stale in one copy and not the other
 * — and a note rendered two different ways in one list is exactly the drift
 * this component exists to prevent. A row passes its own note; a sitting passes
 * every member's, joined.
 */
export function NoteLine({
  note,
  notesExpanded,
  onOpen,
}: {
  /** Already trimmed and, for a sitting, already joined. */
  note: string
  notesExpanded: boolean
  onOpen: () => void
}) {
  const hasNote = note !== ""

  return (
    <div
      className={cn(
        "flex min-w-0 items-center",
        // A FIXED 20px BOX, so a day of mixed written/empty notes does not
        // ripple — except when the note is the thing being read, where a
        // fixed height is exactly the clip being lifted. `min-h-5` keeps
        // the floor (and with it the 54px row) for the one-line case.
        notesExpanded ? "min-h-5" : "h-5"
      )}
    >
      {hasNote ? (
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "touch-target -mx-1 min-w-0 max-w-full rounded-sm px-1 py-0.5 text-left",
            "text-muted-foreground transition-colors",
            "hover:bg-surface-raised/70 hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            // A STEP UP IN SIZE, and not only in room. `text-xs` is a
            // label size — right for a line you glance past on the way to
            // the duration, wrong for the only prose in the product once
            // it is what you came to read. `text-sm` is the body size the
            // note sheet writes it at, so reading it in the log and
            // reading it in the editor are the same act of reading.
            notesExpanded ? "text-sm leading-relaxed" : "text-xs"
          )}
        >
          {/*
            `truncate` lives on this span rather than on the button, and it
            has to. `truncate` sets overflow:hidden, and `.touch-target` sets
            position:relative — which makes the button the containing block
            for its OWN ::after, so the 2px the pseudo-element hangs above
            and below is clipped off by the overflow rule meant for the text.
            The control silently stayed 20px and missed WCAG 2.2 SC 2.5.8,
            while the class that was supposed to fix it was right there in
            the list. Clipping the text one level in leaves the button's own
            overflow visible.

            Expanded, the same span drops `truncate` for `whitespace-pre-wrap`
            — PRE-wrap and not plain wrapping, because a note is written in
            a textarea where Enter inserts a newline (`note-sheet.tsx`), so
            the paragraph breaks the user typed are part of what they wrote.
            `break-words` is for the other half of the same promise: a
            pasted URL or a 60-character ticket slug has no space to break
            at and would otherwise push the whole row sideways.
          */}
          <span
            className={cn(
              "block",
              notesExpanded ? "whitespace-pre-wrap break-words" : "truncate"
            )}
          >
            {note}
          </span>
        </button>
      ) : (
        // ALWAYS visible, never a hover reveal. PRODUCT.md: missing notes are
        // "visible, not absent". Hiding this until hover would make the one
        // thing the product exists to capture the one thing you cannot see is
        // missing — and it leaves a dead gap in the row besides.
        //
        // The hatch is the carrier (The Hatch Rule): absence is a texture,
        // never a colour, so it survives colour blindness and reads in
        // peripheral vision. It is an invitation, not a warning — which is
        // why it is quiet, and why nothing about it blocks or nags.
        <button
          type="button"
          onClick={onOpen}
          className={cn(
            "hatch-empty touch-target -mx-0.5 flex h-5 items-center rounded-sm px-1.5 text-xs",
            "text-muted-foreground/70 transition-colors",
            "hover:text-foreground focus-visible:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          + add note
        </button>
      )}
    </div>
  )
}
