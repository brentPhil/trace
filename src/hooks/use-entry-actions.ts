import { useCallback, useMemo } from "react"
import { useToastManager } from "@/components/ui/toast"
import { useClassifierMutations, useClassifiers } from "@/hooks/use-classifiers"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { useEntryMutations } from "@/hooks/use-entry-mutations"
import { errorMessage } from "@/lib/error-message"
import { instantMovedToDay } from "@/lib/format-time"
import { withInheritedBillable } from "@/lib/inherit-billable"
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
 * already speaks, so this returns exactly that (less `onNoteSave`,
 * `onSittingClassify`, `onSittingNoteSave` and `onSittingRemove`, which are the
 * log's own note field and its sitting-shaped writes — they go through
 * `updateMany`, which `EntryLog` owns, and a calendar block never renders a
 * `SittingRow`) plus the one verb the popover adds.
 *
 * Passed DOWN as a prop from there, never reached for inside a row or a block —
 * see `EntryRow`'s own note on why. This hook is the one place the writes
 * originate.
 */
export type EntryActions = Omit<
  EntryRowActions,
  "onNoteSave" | "onSittingClassify" | "onSittingNoteSave" | "onSittingRemove"
> & {
  /**
   * A second entry with the same title, times and classification.
   *
   * Only meaningful for a COMPLETED entry: `entries.create` takes a definite
   * `endedAt`, and there is no honest value for one that is still running. The
   * callers hide the control rather than passing a guess.
   */
  onDuplicate: (entry: Entry) => void
  onRemoveMany: (entries: Array<Entry>) => Promise<boolean>
}

export function useEntryActions(timeZone: string): EntryActions {
  const { update, editTime, remove, removeMany, restore, restoreMany, create } =
    useEntryEditMutations()
  const { resume } = useEntryMutations()
  const { createProject: createProjectRaw, ensureTag } = useClassifierMutations()
  // Already queried (and cached) by every surface that renders a picker; read
  // here so `onClassify` can resolve a picked project's billable default.
  const { projectsById } = useClassifiers()
  const toasts = useToastManager()

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

  const onRemoveMany = useCallback(
    async (entries: Array<Entry>): Promise<boolean> => {
      const uniqueEntries = [...new Map(entries.map((entry) => [entry._id, entry])).values()]
      if (uniqueEntries.length === 0) return false

      try {
        await removeMany(uniqueEntries.map((entry) => entry._id))
      } catch (thrown) {
        toasts.add({ title: errorMessage(thrown), priority: "high", timeout: UNDO_MS })
        return false
      }

      toastWithUndo(toasts, {
        title: `Deleted ${uniqueEntries.length} ${uniqueEntries.length === 1 ? "record" : "records"}`,
        undo: () => restoreMany(uniqueEntries),
      })
      return true
    },
    [removeMany, restoreMany, toasts]
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
   * Nothing here catches a refusal anymore. It used to — historically
   * because this one closes its popover as it fires, so a control-less
   * rejection had nowhere to land — but `editTime` is optimistic by
   * construction now: it resolves as soon as the outbox journals it, and a
   * refusal is the outbox's own `dropped` event to report, not this
   * function's.
   */
  const onDayChange = useCallback(
    async (entry: Entry, day: string) => {
      const from = entry.startedAt
      let moved: number
      try {
        moved = instantMovedToDay(from, day, timeZone)
      } catch (thrown) {
        // Not an outbox refusal — an arithmetic failure before anything is
        // enqueued, so nothing downstream will report it.
        toasts.add({ title: errorMessage(thrown), priority: "high" })
        return
      }
      await editTime(entry._id, "day", moved)

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
      // them, so the row reflects the choice immediately. The write is optimistic
      // by construction now — it resolves as soon as the outbox journals it — so
      // a refusal is the outbox's own `dropped` event to report.
      onClassify: (entry, rawChange) => {
        // Assigning a billable client's project ticks the `$` in the same
        // write — promotion only, and an explicit `billable` always wins.
        // The rule and its boundaries are argued in `withInheritedBillable`.
        const change = withInheritedBillable(
          rawChange,
          entry.billable,
          rawChange.projectId == null ? null : projectsById.get(rawChange.projectId)
        )
        void update({
          entryId: entry._id,
          ...(change.projectId !== undefined ? { projectId: change.projectId } : {}),
          ...(change.tagIds !== undefined ? { tagIds: change.tagIds } : {}),
          ...(change.billable !== undefined ? { billable: change.billable } : {}),
        })
      },
      onCreateProject: createProject,
      onCreateTag: ensureTag,
      onRemove,
      onRemoveMany,
      // `resume` is `start` under another name — optimistic by construction,
      // so a refusal is the outbox's own `dropped` event to report.
      onResume: (entry) => {
        void resume(entry)
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
      onRemoveMany,
      onDuplicate,
      toasts,
      projectsById,
    ]
  )
}

/** How a toast names an entry. Starting the timer never requires a title, so
 *  the untitled case is ordinary rather than exceptional. */
function labelOf(entry: Entry): string {
  const title = entry.title.trim()
  return title === "" ? "entry" : `“${title}”`
}
