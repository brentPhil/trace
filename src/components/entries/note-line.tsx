import { InlineEdit } from "@/components/entries/inline-edit"
import { HATCH_EMPTY } from "@/lib/hatch"
import { cn } from "@/lib/utils"

/** The cap the note field enforces. It was the dialog's; the editor moved into
 *  the row, the limit came with it. */
const MAX_NOTE_LENGTH = 2_000

/**
 * A note as the log draws it — and, when you click it, edits it.
 *
 * EXTRACTED FROM `EntryRow` rather than copied into `SittingRow`, because the
 * comments below are the kind that go stale in one copy and not the other — and
 * a note rendered two different ways in one list is exactly the drift this
 * component exists to prevent. A row passes its own note; a sitting passes every
 * member's, joined, and writes back to all of them.
 *
 * IT USED TO OPEN A DIALOG. `NoteSheet` was a modal with a textarea, a Save
 * button, a Skip button, an in-memory draft store keyed per target, and a
 * save-on-dismiss path with its own undo toast — all of it machinery for the
 * one hazard a modal creates and an inline field does not: a dismissal that
 * throws away what you typed. The note is now the same gesture as the title
 * beside it (`InlineEdit`) — click, type, blur or ⌘↵ to keep, Escape to revert —
 * so there is no dismissal to lose anything on, and the whole apparatus went
 * with the dialog.
 *
 * WHAT THAT COST, stated rather than quietly dropped: a note save no longer
 * raises an Undo. The dialog's undo existed because dismissal wrote text the
 * user had not asked to save; here every write is a deliberate commit, and the
 * inverse of a wrong one is the field itself, still one click away with the old
 * text still in it. A server refusal is not silent either — `InlineEdit` reopens
 * with the rejected text and the reason attached to the field.
 */
export function NoteLine({
  note,
  notesExpanded,
  onSave,
}: {
  /** Already trimmed and, for a sitting, already joined. */
  note: string
  notesExpanded: boolean
  /** Writes this note to every entry the line stands for. */
  onSave: (note: string) => void | Promise<void>
}) {
  const hasNote = note !== ""

  return (
    /*
      NO HEIGHT OF ITS OWN any more — the 20px box moved down onto the trigger
      (see below). A fixed height here clipped the editor the moment the field
      opened, since this element does not know that it has.

      A COLUMN, and `items-start` is load-bearing in it. The trigger has to stay
      the width of the words in it — stretched, its hover fill would run the
      whole row and read as a band rather than as a control — while the editor
      that replaces it takes the full width, which it does through its own
      `w-full` rather than through the alignment here.
    */
    <div className="flex min-w-0 flex-col items-start">
      <InlineEdit<string>
        multiline
        initialInput={note}
        // The note's own text is IN the name, not replaced by it — the same
        // shape `EditableTitle` uses (`Description: …`). An `aria-label` of
        // "Edit note" would override the prose inside the trigger, so the one
        // reader who cannot see the line would be told a control exists and
        // never told what it says.
        ariaLabel={hasNote ? `Note: ${note}` : "Add note"}
        // A note has no syntax to get wrong: every string is a valid note, so
        // this never refuses. The generic still earns its keep — `InlineEdit`'s
        // refusal path is what surfaces a SERVER error on the field, and that
        // is reached through `onCommit` rather than through here.
        parse={(raw) => ({ ok: true as const, value: raw })}
        onCommit={onSave}
        placeholder="What did you actually do? A sentence is plenty."
        maxLength={MAX_NOTE_LENGTH}
        className={
          hasNote
            ? cn(
                // A FIXED 20px BOX, so a day of mixed written/empty notes does
                // not ripple — except when the note is the thing being read,
                // where a fixed height is exactly the clip being lifted.
                // `min-h-5` keeps the floor for the one-line case; each caller
                // pins its own row height to that floor via
                // `--entry-row-height` (`EntryRow`, `SittingRow`), so this
                // component only has to answer for its own 20px and never for
                // either caller's total.
                notesExpanded ? "min-h-5" : "h-5",
                // That 20px floor is under WCAG 2.2 SC 2.5.8's 24px minimum,
                // so the hit area grows through a pseudo-element instead of
                // padding: exactly -2px above and below gets there without the
                // row growing with it.
                "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-['']",
                "-mx-1 min-w-0 max-w-full justify-start px-1 py-0.5 text-left whitespace-normal",
                "hover:bg-surface-raised/70",
                // A STEP UP IN SIZE, and not only in room. `text-xs` is a label
                // size — right for a line you glance past on the way to the
                // duration, wrong for the only prose in the product once it is
                // what you came to read. `text-sm` is the body size the editor
                // writes it at, so reading it in the log and editing it are the
                // same act of reading.
                notesExpanded ? "text-sm leading-relaxed" : "text-xs"
              )
            : cn(
                "relative after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-['']",
                HATCH_EMPTY,
                "-mx-0.5 h-5 px-1.5 text-xs",
                "text-muted-foreground/70 focus-visible:text-foreground"
              )
        }
        display={
          hasNote ? (
            /*
              `truncate` lives on this span rather than on the trigger, and it
              has to. `truncate` sets overflow:hidden, and the hit-area rule
              above sets position:relative — which makes the trigger the
              containing block for its OWN ::after, so the 2px the
              pseudo-element hangs above and below is clipped off by the
              overflow rule meant for the text. The control silently stayed
              20px and missed WCAG 2.2 SC 2.5.8, while the class that was
              supposed to fix it was right there in the list. Clipping the text
              one level in leaves the trigger's own overflow visible.

              Expanded, the same span drops `truncate` for `whitespace-pre-wrap`
              — PRE-wrap and not plain wrapping, because a note is written in a
              textarea where Enter inserts a newline, so the paragraph breaks
              the user typed are part of what they wrote. `break-words` is for
              the other half of the same promise: a pasted URL or a
              60-character ticket slug has no space to break at and would
              otherwise push the whole row sideways.
            */
            <span
              className={cn(
                "block",
                notesExpanded ? "whitespace-pre-wrap break-words" : "truncate"
              )}
            >
              {note}
            </span>
          ) : (
            // ALWAYS visible, never a hover reveal. PRODUCT.md: missing notes
            // are "visible, not absent". Hiding this until hover would make the
            // one thing the product exists to capture the one thing you cannot
            // see is missing — and it leaves a dead gap in the row besides.
            //
            // The hatch is the carrier (The Hatch Rule): absence is a texture,
            // never a colour, so it survives colour blindness and reads in
            // peripheral vision. It is an invitation, not a warning — which is
            // why it is quiet, and why nothing about it blocks or nags.
            <>+ add note</>
          )
        }
      />
    </div>
  )
}
