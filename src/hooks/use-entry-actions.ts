import { useCallback, useMemo } from "react"
import { Toast } from "@/components/ui/toast"
import { useClassifierMutations } from "@/hooks/use-classifiers"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { useEntryMutations } from "@/hooks/use-entry-mutations"
import { errorMessage } from "@/lib/error-message"
import { instantMovedToDay } from "@/lib/format-time"
import { dayLabel } from "@/lib/group-entries"
import { UNDO_MS, toastWithUndo } from "@/lib/undo-toast"
import { addDays, dayOf } from "@shared/day"
import { formatCompactDuration } from "@shared/duration"
import { elapsedMs } from "@shared/entryTimes"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { Entry } from "@/lib/group-entries"

/**
 * Everything that may be done to an entry that already exists, in one place.
 *
 * IT USED TO LIVE INSIDE `entry-log.tsx`, and it moved because a second surface
 * now edits entries: the popover a calendar block opens. Two copies of "delete,
 * then offer the way back" would be two undo windows, two error postures and two
 * sentences for the same event — and the one that is used less would be the one
 * that quietly stopped matching. `EntryRowActions` is the vocabulary the log row
 * already speaks, so this returns exactly that (less `onNoteOpen`, which is the
 * log's own sheet) plus the one verb the popover adds.
 *
 * Passed DOWN as a prop from there, never reached for inside a row or a block —
 * see `EntryRow`'s own note on why. This hook is the one place the writes
 * originate.
 */
export type EntryActions = Omit<EntryRowActions, "onNoteOpen"> & {
  /**
   * A second entry with the same title, times and classification.
   *
   * Only meaningful for a COMPLETED entry: `entries.create` takes a definite
   * `endedAt`, and there is no honest value for one that is still running. The
   * callers hide the control rather than passing a guess.
   */
  onDuplicate: (entry: Entry) => void
}

export function useEntryActions(timeZone: string): EntryActions {
  const { update, editTime, remove, restore, create } = useEntryEditMutations()
  const { resume } = useEntryMutations()
  const { createProject: createProjectRaw, ensureTag } = useClassifierMutations()
  const toasts = Toast.useToastManager()

  const createProject = useCallback(
    async (name: string) => await createProjectRaw({ name }),
    [createProjectRaw]
  )

  /**
   * Deletes, then offers the way back.
   *
   * The snapshot is captured BEFORE the mutation, because after it the row is
   * gone from every query the toast could read it from — and the toast has to
   * be able to name what it removed and to put that exact row back.
   */
  const onRemove = useCallback(
    (entry: Entry) => {
      void (async () => {
        try {
          await remove(entry._id)
        } catch (thrown) {
          toasts.add({ title: errorMessage(thrown), priority: "high", timeout: UNDO_MS })
          return
        }

        toastWithUndo(toasts, {
          title: `Deleted ${labelOf(entry)}`,
          description: formatCompactDuration(elapsedMs(entry, Date.now())),
          undo: () => restore(entry),
        })
      })()
    },
    [remove, restore, toasts]
  )

  /**
   * Re-dates an entry, then says so.
   *
   * The only edit that takes a row off the screen it was made on: past midnight
   * in either direction the entry leaves this day's group, and on the Today page
   * it leaves the view entirely. Every other edit leaves something to look at,
   * so this is the one that owes the user a sentence — otherwise a row simply
   * vanishes under the pointer and the day total corrects itself for no visible
   * reason.
   *
   * Undo carries the original START INSTANT rather than the original day, so it
   * restores the exact time. Re-deriving it from a day string would re-resolve
   * the offset and could land an hour out across a DST boundary — putting the
   * entry back somewhere it never was.
   *
   * The write is caught here rather than left to propagate, unlike the other
   * row edits. Those commit into a control that is still on screen and can
   * reopen with the rejected value in it; this one closes its popover as it
   * fires, so a rejection had nowhere to land at all — the optimistic update
   * moved the row, Convex rolled it back, the row jumped home with no
   * explanation, and the failure surfaced only as an unhandled promise
   * rejection in the console. Same treatment `onRemove` above already gives a
   * delete that fails.
   */
  const onDayChange = useCallback(
    async (entry: Entry, day: string) => {
      const from = entry.startedAt
      try {
        await editTime(entry._id, "day", instantMovedToDay(from, day, timeZone))
      } catch (thrown) {
        toasts.add({ title: errorMessage(thrown), priority: "high", timeout: UNDO_MS })
        return
      }

      // The same label the day headers use, so the toast names the heading the
      // row has just gone to rather than a raw date string.
      const today = dayOf(Date.now(), timeZone)
      toastWithUndo(toasts, {
        title: `Moved to ${dayLabel(day, today, addDays(today, -1))}`,
        undo: () => editTime(entry._id, "day", from),
      })
    },
    [editTime, timeZone, toasts]
  )

  /**
   * Copies an entry onto the same span of time.
   *
   * `entries.create` and nothing new: the same mutation the add-entry dialog
   * writes through, carrying the fields the entry already has. THE NOTE IS NOT
   * COPIED, for the reason `resume` gives — a note is an account of what
   * happened during one specific interval, and putting it on a second row makes
   * the copy look like something the user wrote about work that has not
   * happened.
   *
   * Undo is the delete, so the vocabulary is the one every reversible write in
   * this product already uses. A duplicate that cannot be taken back in one
   * click is a control people are right to be afraid of.
   */
  const onDuplicate = useCallback(
    (entry: Entry) => {
      // Guarded rather than trusted: the callers hide the control while an
      // entry is running, and a hidden control is not a contract.
      if (entry.endedAt === null) return
      const endedAt = entry.endedAt

      void (async () => {
        let entryId
        try {
          const result = await create({
            title: entry.title,
            startedAt: entry.startedAt,
            endedAt,
            projectId: entry.projectId,
            tagIds: entry.tagIds,
            billable: entry.billable,
          })
          entryId = result.entryId
        } catch (thrown) {
          toasts.add({ title: errorMessage(thrown), priority: "high", timeout: UNDO_MS })
          return
        }

        toastWithUndo(toasts, {
          title: `Duplicated ${labelOf(entry)}`,
          undo: () => remove(entryId),
        })
      })()
    },
    [create, remove, toasts]
  )

  /*
   * ONE OBJECT, STABLE WHILE ITS INPUTS ARE — the half this hook was missing.
   *
   * Four of the members went through `useCallback` and the returned object was
   * a fresh literal every render with five fresh arrows in it, so the identity
   * that actually crosses the prop boundary changed on every tick anyway and
   * the four bought nothing. On /timer that is once a second. The failure that
   * makes it worth fixing rather than deleting is the quiet one: the moment a
   * consumer is wrapped in `memo`, the four look like they are doing the job
   * and are not.
   *
   * So all of it is memoised, and the object is what callers may compare.
   */
  return useMemo(
    () => ({
      // Errors here are deliberately left to propagate: InlineEdit catches them
      // and reopens the field with the rejected text still in it, which is a
      // better place to report a bad time than a toast at the bottom of the page.
      onTitleChange: async (entry, title) => {
        await update({ entryId: entry._id, title })
      },
      onTimeChange: async (entry, field, instantMs) => {
        await editTime(entry._id, field, instantMs)
      },
      onDayChange,
      onDurationChange: async (entry, ms) => {
        await editTime(entry._id, "duration", ms)
      },
      // Classifier changes are fire-and-forget with an optimistic update behind
      // them, so the row reflects the choice immediately. A failure surfaces as a
      // toast rather than reverting silently.
      onClassify: (entry, change) => {
        void update({
          entryId: entry._id,
          ...(change.projectId !== undefined ? { projectId: change.projectId } : {}),
          ...(change.tagIds !== undefined ? { tagIds: change.tagIds } : {}),
          ...(change.billable !== undefined ? { billable: change.billable } : {}),
        }).catch((thrown: unknown) => {
          toasts.add({ title: errorMessage(thrown), priority: "high" })
        })
      },
      onCreateProject: createProject,
      onCreateTag: ensureTag,
      onRemove,
      onResume: (entry) => {
        void resume(entry).catch((thrown: unknown) => {
          toasts.add({ title: errorMessage(thrown), priority: "high" })
        })
      },
      onDuplicate,
    }),
    [
      update,
      editTime,
      resume,
      createProject,
      ensureTag,
      onDayChange,
      onRemove,
      onDuplicate,
      toasts,
    ]
  )
}

/** How a toast names an entry. Starting the timer never requires a title, so
 *  the untitled case is ordinary rather than exceptional. */
function labelOf(entry: Entry): string {
  const title = entry.title.trim()
  return title === "" ? "entry" : `“${title}”`
}
