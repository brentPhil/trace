import { Play, Trash2 } from "lucide-react"
import {
  EditableDuration,
  EditableTimeRange,
  EditableTitle,
} from "@/components/entries/editable-fields"
import { cn } from "@/lib/utils"
import type { Entry } from "@/lib/group-entries"

/**
 * What a row can do. Passed in rather than reached for with a hook, so the row
 * stays renderable against fixtures and the writes all originate in one place.
 */
export type EntryRowActions = {
  onTitleChange: (entry: Entry, title: string) => Promise<void>
  onTimeChange: (entry: Entry, field: "start" | "end", instantMs: number) => Promise<void>
  onDurationChange: (entry: Entry, ms: number) => Promise<void>
  onNoteOpen: (entry: Entry) => void
  onRemove: (entry: Entry) => void
  onResume: (entry: Entry) => void
}

/**
 * One tracked entry.
 *
 * Column order follows the eye's job: what it was, then where it belongs, then
 * when, then how long. The duration is last and right-aligned so a column of
 * them aligns on the digit — the whole reason for the Tabular Rule.
 *
 * Every field on the row is editable in place. There is no detail view and no
 * save button, because the correction this product actually sees is one field
 * mistyped, ten times a day, and a modal turns that into four gestures.
 */
export function EntryRow({
  entry,
  timeZone,
  use12Hour,
  actions,
}: {
  entry: Entry
  timeZone: string
  use12Hour: boolean
  actions: EntryRowActions
}) {
  const title = entry.title.trim()
  const note = (entry.note ?? "").trim()
  const hasNote = note !== ""

  return (
    <div
      className={cn(
        "group flex min-h-[50px] items-center gap-2 px-3",
        "border-b border-edge-soft/60 last:border-b-0",
        "transition-colors hover:bg-surface/60"
      )}
    >
      {/*
        4 + 20 + 2 + 20 + 4 = the 50px the row is specified at, so `min-h` is a
        floor the content sits exactly on rather than a number it fights. The
        note slot is a fixed 20px box because the hatch carries a border and the
        written note does not — left to size themselves, a day of mixed rows
        would ripple by two pixels down the whole column.
      */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <EditableTitle
            entry={entry}
            onCommit={(next) => actions.onTitleChange(entry, next)}
          />
          {entry.billable ? (
            // Brass means money — The Two Temperatures Rule. Paired with a
            // glyph so it survives without colour.
            // `leading-5` matters as much as the colour here: an unsized span
            // establishes a 24px line box from the inherited 16px base, so
            // without it every billable row is four pixels taller than every
            // non-billable one and the whole log develops a stutter.
            <span
              className="flex shrink-0 items-center text-xs leading-5 text-brass"
              title="Billable"
            >
              <span aria-hidden="true" className="font-semibold">
                $
              </span>
              <span className="sr-only">Billable</span>
            </span>
          ) : null}
        </div>

        {/*
          The slot is 20px so the row lands on 50, but a 20px control is under
          WCAG 2.2's 24px target minimum. `touch-target` (styles.css) extends
          the hit area with a pseudo-element instead of padding, so the target
          grows without the row growing with it.
        */}
        <div className="flex h-5 min-w-0 items-center">
          {hasNote ? (
            <button
              type="button"
              onClick={() => actions.onNoteOpen(entry)}
              className={cn(
                "touch-target -mx-1 max-w-full truncate rounded-sm px-1 py-0.5 text-left",
                "text-xs text-muted-foreground transition-colors",
                "hover:bg-surface-raised/70 hover:text-foreground",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              )}
            >
              {note}
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
              onClick={() => actions.onNoteOpen(entry)}
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
      </div>

      <EditableTimeRange
        entry={entry}
        timeZone={timeZone}
        use12Hour={use12Hour}
        onCommit={(field, value) => actions.onTimeChange(entry, field, value)}
      />

      <EditableDuration
        entry={entry}
        onCommit={(ms) => actions.onDurationChange(entry, ms)}
      />

      {/*
        Row controls stay in the layout at all times and fade in on hover or
        focus, rather than being added and removed. Reserving the space means
        the columns to their left do not shift when the pointer crosses a row —
        and it is what lets the keyboard reach them at all.

        On a touch screen they are simply always visible. There is no hover on a
        phone, so a hover-revealed control is not subtle there, it is absent:
        delete and resume would be unreachable by any means.
      */}
      <div className="flex shrink-0 items-center gap-0.5">
        <RowButton
          label={`Resume ${title === "" ? "this entry" : title}`}
          onClick={() => actions.onResume(entry)}
        >
          <Play className="size-4" />
        </RowButton>
        <RowButton
          label={`Delete ${title === "" ? "this entry" : title}`}
          onClick={() => actions.onRemove(entry)}
          destructive
        >
          <Trash2 className="size-4" />
        </RowButton>
      </div>
    </div>
  )
}

function RowButton({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-muted-foreground",
        "opacity-100 sm:opacity-0",
        "transition-[opacity,color] sm:group-hover:opacity-100",
        "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:outline-none",
        destructive ? "hover:text-alarm" : "hover:text-foreground",
        "motion-reduce:transition-none"
      )}
    >
      {children}
    </button>
  )
}
