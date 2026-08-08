import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { errorMessage } from "@/lib/error-message"
import { formatCompactDuration } from "@shared/duration"
import { elapsedMs } from "@shared/entryTimes"
import { cn } from "@/lib/utils"
import type { Entry } from "@/lib/group-entries"
import type { Id } from "../../../convex/_generated/dataModel"

const MAX_NOTE_LENGTH = 2_000

/**
 * The fifteen-second window.
 *
 * Raised the moment a timer stops, and reachable afterwards from any row. It
 * asks for the one thing this product is built around and nothing else: no
 * project picker, no tag field, no billable toggle. Every extra control here is
 * a reason to press Escape, and an entry that gets skipped is worth less than
 * one with a bad note.
 *
 * Three ways out, all of them cheap: Escape, Skip, and clicking away. Skipping
 * is a legitimate answer — the hatch in the row keeps the invitation open for
 * later, so nothing is lost by declining now. A dialog that punished skipping
 * would train people to stop the timer somewhere else.
 */
export function NoteSheet({
  entry,
  open,
  onOpenChange,
  onSave,
}: {
  entry: Entry | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Passed in, not reached for — see TimerBarActions on why. */
  onSave: (entryId: Id<"timeEntries">, note: string) => Promise<void>
}) {
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /*
   * Seeded when the sheet OPENS, and never again while it is open.
   *
   * `entry` is a reactive query result, so listing `entry.note` as a dependency
   * makes this live-bound rather than seeded — and then any change to that note
   * from anywhere replaces the whole textarea and drops the caret to the end.
   * "Anywhere" is not exotic: a second tab, another device, or this very
   * dialog's own optimistic update being rolled back after a failed save. The
   * user is mid-sentence and their sentences are the product.
   *
   * Keyed on `_id` as well as `open` so that reopening the sheet on a DIFFERENT
   * entry re-seeds; an entry cannot change `_id` while a sheet is open on it,
   * so the optimistic-id instability that affects the timer bar cannot bite
   * here.
   */
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    const id = open ? (entry?._id ?? null) : null
    if (seededFor.current === id) return
    seededFor.current = id
    if (id !== null) setValue(entry?.note ?? "")
    // Cleared alongside the text. Left behind, a failed save's alarm line was
    // still sitting there the next time the sheet opened — on a different
    // entry, about a write that is no longer pending.
    setError(null)
  }, [open, entry?._id, entry?.note])

  if (entry === null) return null

  const title = entry.title.trim()
  const duration = formatCompactDuration(elapsedMs(entry, Date.now()))

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(entry._id, value)
      onOpenChange(false)
    } catch (thrown) {
      // Without this the dialog simply stayed open with no explanation, and the
      // user would close it believing the note was written. The entry being
      // deleted in another tab while this sheet is open is not a stretch — the
      // undo toast for exactly that is on screen for six seconds.
      setError(errorMessage(thrown))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup
        initialFocus={textareaRef}
        aria-label={`Note for ${title === "" ? "this entry" : title}`}
      >
        {/*
          A read-only header, not editable fields. It exists to answer "which
          entry is this?" in one glance and then get out of the way. Making the
          title editable here would invite a second job at the exact moment the
          user is trying to leave.
        */}
        <div className="flex items-baseline justify-between gap-3">
          <Dialog.Title className="truncate">
            {title === "" ? (
              <span className="text-muted-foreground italic">No description</span>
            ) : (
              title
            )}
          </Dialog.Title>
          <span className="shrink-0 text-sm tabular text-muted-foreground">
            {duration}
          </span>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="note-sheet-field" className="sr-only">
            What did you do?
          </label>
          <textarea
            id="note-sheet-field"
            ref={textareaRef}
            value={value}
            maxLength={MAX_NOTE_LENGTH}
            rows={4}
            placeholder="What did you actually do? A sentence is plenty."
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              // Enter alone inserts a newline: this is prose, and a note that
              // cannot hold two sentences is not worth collecting.
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void save()
              }
            }}
            className={cn(
              "w-full resize-none rounded-md border border-edge-soft bg-ground",
              "px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            )}
          />
          {error === null ? (
            <p className="text-xs text-muted-foreground">
              This is what the recap is written from.
            </p>
          ) : (
            <p role="alert" className="text-xs text-alarm">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <Dialog.Close
            render={
              <Button variant="ghost" size="sm">
                Skip
              </Button>
            }
          />
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            Save
            <kbd
              aria-hidden="true"
              className="ml-1.5 text-[0.65rem] opacity-60"
            >
              ⌘↵
            </kbd>
          </Button>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  )
}
