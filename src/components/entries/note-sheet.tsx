import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Toast } from "@/components/ui/toast"
import { errorMessage } from "@/lib/error-message"
import { UNDO_MS, toastWithUndo } from "@/lib/undo-toast"
import { formatCompactDuration } from "@shared/duration"
import { cn } from "@/lib/utils"
import type { Id } from "../../../convex/_generated/dataModel"

const MAX_NOTE_LENGTH = 2_000

/**
 * The in-memory backstop, keyed by the target's `key`. MODULE SCOPE, not a ref.
 *
 * It is written when a dismissal starts a save, and dropped the moment that
 * save succeeds (or a dismissal had nothing to save). A failed or still-in-
 * flight save keeps it, which is the whole point: there, the user's own words
 * are the only copy that exists anywhere.
 *
 * IT LIVES HERE BECAUSE THE COMPONENT DOES NOT LIVE LONG ENOUGH. As a
 * `useRef` it belonged to one mount of this sheet, and this sheet is a child of
 * `EntryLog` — which /timer unmounts when the view switches to Calendar, and
 * which /reports mounts a second, separate copy of. So the copy of record for a
 * failed save was destroyed by a tab click or by any navigation away, with no
 * route back to it. The doc comment below already scoped the promise to the
 * page's lifetime ("Lost on page reload, same as any other unsynced client
 * state") — which is exactly a module-level Map's lifetime, and was never the
 * ref's.
 *
 * Bounded by the same two paths that always bounded it: delete on success, and
 * delete when a dismissal found nothing to save.
 */
const drafts = new Map<string, string>()

/**
 * Empties the draft store. FOR TESTS ONLY — module state outlives `cleanup()`,
 * so without this a draft armed by one test seeds the textarea in the next.
 * There is no product path that throws a pending draft away.
 */
export function clearNoteDrafts() {
  drafts.clear()
}

/**
 * What a note is being written for.
 *
 * A TARGET RATHER THAN AN ENTRY, because a note now belongs to a piece of
 * work and a piece of work can be several entries — see the
 * sitting-as-the-unit spec. A row builds a one-member target, so there is
 * exactly one path through this component and it cannot behave differently
 * depending on where it was opened from.
 */
export type NoteTarget = {
  /** Every entry this note will be written to. One for a row, many for a sitting. */
  entryIds: Array<Id<"timeEntries">>
  /**
   * Stable identity for re-seeding and for the `drafts` map.
   *
   * NOT the first entry's id: a sitting's membership changes when a member is
   * retitled out of it, and keying on a member would hand the user back a
   * draft written for a different set of rows.
   */
  key: string
  title: string
  note: string
  totalMs: number
}

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
 *
 * All three used to be lossy: none of them checked whether `value` still
 * matched the saved note, so a half-written sentence and an accidental
 * Escape were indistinguishable from a deliberate Skip. PRODUCT.md calls a
 * lost note worse than friction, and a confirm dialog would be friction on
 * every dismissal to prevent a mistake on a few — the ban on
 * modal-as-first-thought stays. Instead: dismissal with unsaved text now
 * SAVES that text on the way out and reports it in the same undo-toast
 * vocabulary delete and re-date use — literally the same, via
 * `toastWithUndo`, rather than a third hand-rolled copy of it — an
 * action already taken, reversible for `UNDO_MS`. `drafts` keeps a copy in
 * memory too, keyed by the target's `key`, so if the save is still in flight
 * (or fails) and the sheet is reopened on the same target before the page
 * unloads, the user's own text wins over whatever the server most recently
 * agreed to. See `handleDismiss` below, and `drafts` above for why that copy
 * outlives this component rather than the mount it was typed in.
 */
export function NoteSheet({
  target,
  open,
  onOpenChange,
  onSave,
}: {
  target: NoteTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Passed in, not reached for — see TimerBarActions on why. */
  onSave: (entryIds: Array<Id<"timeEntries">>, note: string) => Promise<void>
}) {
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const toasts = Toast.useToastManager()

  /*
   * Seeded when the sheet OPENS, and never again while it is open.
   *
   * The `seededFor` ref, not the dependency list, is what makes this
   * seed-once: it records which target's turn already ran, and the effect
   * bails out the moment `id` matches it again. `target` is built from a
   * reactive query result, so without that guard this would be live-bound
   * instead — any change to `target.note` from anywhere would replace the
   * whole textarea and drop the caret to the end. "Anywhere" is not exotic: a
   * second tab, another device, or this very dialog's own optimistic update
   * being rolled back after a failed save. The user is mid-sentence and their
   * sentences are the product.
   *
   * `target?.key` is listed as a dependency because `id` is built from it —
   * that's what lets a reopen on a DIFFERENT target re-seed. A row's key is
   * its entry's `_id`, which cannot change while a sheet is open on it, so
   * the optimistic-id instability that affects the timer bar cannot bite
   * here. `target?.note` is listed too, because it's read below as the
   * fallback value — not because a note change alone should trigger
   * anything. It doesn't: `id` stays the same, so the ref guard turns that
   * extra run into a no-op before `setValue` is ever reached.
   */
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    const id = open ? (target?.key ?? null) : null
    if (seededFor.current === id) return
    seededFor.current = id
    // A pending draft outranks the server's note: it is either about to
    // overwrite that note anyway (a save is in flight) or already tried to
    // and failed, and either way the user's own words should be what they
    // see, not whatever the last successful write happened to be.
    if (id !== null) setValue(drafts.get(id) ?? target?.note ?? "")
    // Cleared alongside the text. Left behind, a failed save's alarm line was
    // still sitting there the next time the sheet opened — on a different
    // target, about a write that is no longer pending.
    setError(null)
  }, [open, target?.key, target?.note])

  if (target === null) return null

  const title = target.title.trim()
  const duration = formatCompactDuration(target.totalMs)

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(target.entryIds, value)
      // Written by the deliberate path, so nothing here still needs the
      // in-memory backstop.
      drafts.delete(target.key)
      onOpenChange(false)
    } catch (thrown) {
      // Without this the dialog simply stayed open with no explanation, and the
      // user would close it believing the note was written. An entry being
      // deleted in another tab while this sheet is open is not a stretch — the
      // undo toast for exactly that is on screen for six seconds.
      setError(errorMessage(thrown))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Escape, a click on the backdrop, and Skip all resolve to a single
   * `onOpenChange(false)` — Base UI funnels every dismissal reason through
   * `Dialog.Root`'s prop, including its own `Dialog.Close` (Skip). The
   * explicit Save button above does not run through here: it already awaits
   * `onSave` and only closes once that has succeeded.
   *
   * If the draft on screen still differs from the target's saved note, this
   * is now the moment that gets written, not the moment it gets thrown away.
   * The sheet still closes immediately — no blocking, no confirm dialog, the
   * same "cheap to leave" the sheet's header comment promises — and a toast
   * reports what happened with an Undo that puts the previous note back,
   * raised through the same `toastWithUndo` delete and re-date go through.
   *
   * `previous` is `target.note` — for a sitting, already the JOINED string,
   * not each member's own text. Undo is a true inverse for the case this
   * feature exists to serve, the same note typed twice: there, every member
   * already held exactly `previous`. For a sitting whose members genuinely
   * disagreed, undo restores the joined text but not which words were whose
   * — that split is gone the moment this save lands, not the moment undo
   * runs. See the spec's Risks section for the same limit stated in full.
   *
   * The `toasts` manager is the one thing this component reaches for rather
   * than takes as a prop. Lifting the whole sequence into `EntryLog` would put
   * the toast beside the other two — but `drafts` is spliced through it at
   * three points (armed before the write, dropped on success, re-armed by
   * Undo) and would have to go with it, and the draft-survival semantics those
   * three points encode are pinned by tests here that render this sheet alone.
   * The duplication that mattered — the window and the toast shape — is gone;
   * this last thread is not worth trading that coverage for.
   */
  const handleDismiss = (nextOpen: boolean) => {
    if (!nextOpen) {
      const previous = target.note
      const draft = value
      if (draft !== previous) {
        drafts.set(target.key, draft)
        const label = title === "" ? "entry" : `“${title}”`
        void onSave(target.entryIds, draft)
          .then(() => {
            // The server now holds this text, so the backstop has done its
            // job. Kept, it would outrank `target.note` in the seeding effect
            // for the rest of this mount — and the NEXT change to that note
            // from anywhere else would be invisible on reopen, then written
            // back over by the next dismissal. The failed path below
            // deliberately keeps it: there, the draft is the only copy.
            drafts.delete(target.key)
            toastWithUndo(toasts, {
              title: `Saved note for ${label}`,
              undo: () => {
                // Re-armed BEFORE the inverse write, for the same reason the
                // dismissal arms it before its own: from here until that write
                // lands, the previous note is a value only this tab holds.
                drafts.set(target.key, previous)
                return onSave(target.entryIds, previous)
              },
            })
          })
          .catch((thrown: unknown) => {
            // The draft is already sitting in `drafts`, so nothing here is
            // gone — just not yet on the server. Reopening the sheet on this
            // target will show it again rather than silently reverting to the
            // old note.
            toasts.add({
              title: `Note not saved: ${errorMessage(thrown)}`,
              priority: "high",
              timeout: UNDO_MS,
            })
          })
      } else {
        drafts.delete(target.key)
      }
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleDismiss}>
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
          <span className="shrink-0 text-sm font-mono tabular-nums tracking-[-0.02em] text-muted-foreground">
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
              "w-full resize-none rounded-md border border-edge bg-ground",
              "px-3 py-2 text-sm leading-relaxed placeholder:text-muted-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            )}
          />
          {error === null ? (
            <p className="text-xs text-muted-foreground">
              Reports searches note text, so this is what makes the entry
              findable later.
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
