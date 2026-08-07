import { useCallback, useState } from "react"
import { DayList } from "@/components/entries/day-list"
import { NoteSheet } from "@/components/entries/note-sheet"
import { Toast } from "@/components/ui/toast"
import { useClassifierMutations, useClassifiers } from "@/hooks/use-classifiers"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { useEntryMutations } from "@/hooks/use-entry-mutations"
import { errorMessage } from "@/lib/error-message"
import { formatCompactDuration } from "@shared/duration"
import { elapsedMs } from "@shared/entryTimes"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { DayGroup, Entry } from "@/lib/group-entries"

/** Long enough to notice and reach, short enough not to linger. */
const UNDO_MS = 6_000

/**
 * The log, and everything a row can do to itself.
 *
 * The writes live here rather than in the rows so there is one place where an
 * entry changes, one place that raises the undo toast, and one place that knows
 * what to do when the server refuses. Rows stay renderable against fixtures.
 */
export function EntryLog({
  groups,
  timeZone,
  use12Hour,
}: {
  groups: Array<DayGroup>
  timeZone: string
  use12Hour: boolean
}) {
  const { setNote, update, editTime, remove, restore } = useEntryEditMutations()
  const { resume } = useEntryMutations()
  const { projects, tags } = useClassifiers()
  const { createProject: createProjectRaw, ensureTag } = useClassifierMutations()
  const toasts = Toast.useToastManager()

  const createProject = useCallback(
    async (name: string) => await createProjectRaw({ name }),
    [createProjectRaw]
  )

  const [noteEntry, setNoteEntry] = useState<Entry | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)

  /**
   * Deletes, then offers the way back.
   *
   * The snapshot is captured BEFORE the mutation, because after it the row is
   * gone from every query the toast could read it from — and the toast has to
   * be able to name what it removed and to put that exact row back.
   */
  const onRemove = useCallback(
    (entry: Entry) => {
      const title = entry.title.trim()
      const label = title === "" ? "entry" : `“${title}”`

      void (async () => {
        try {
          await remove(entry._id)
        } catch (thrown) {
          toasts.add({ title: errorMessage(thrown), priority: "high", timeout: UNDO_MS })
          return
        }

        toasts.add({
          title: `Deleted ${label}`,
          description: formatCompactDuration(elapsedMs(entry, Date.now())),
          timeout: UNDO_MS,
          actionProps: {
            children: "Undo",
            onClick: () => {
              void restore(entry).catch((thrown: unknown) => {
                toasts.add({ title: errorMessage(thrown), priority: "high" })
              })
            },
          },
        })
      })()
    },
    [remove, restore, toasts]
  )

  const actions: EntryRowActions = {
    // Errors here are deliberately left to propagate: InlineEdit catches them
    // and reopens the field with the rejected text still in it, which is a
    // better place to report a bad time than a toast at the bottom of the page.
    onTitleChange: async (entry, title) => {
      await update({ entryId: entry._id, title })
    },
    onTimeChange: async (entry, field, instantMs) => {
      await editTime(entry._id, field, instantMs)
    },
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
    onNoteOpen: (entry) => {
      setNoteEntry(entry)
      setNoteOpen(true)
    },
    onRemove,
    onResume: (entry) => {
      void resume(entry).catch((thrown: unknown) => {
        toasts.add({ title: errorMessage(thrown), priority: "high" })
      })
    },
  }

  // The sheet reads a snapshot rather than the live row, so it does not
  // re-render out from under someone mid-sentence. Its own save is what puts
  // the new note back into the list.
  const liveNoteEntry =
    noteEntry === null
      ? null
      : (groups
          .flatMap((group) => group.entries)
          .find((entry) => entry._id === noteEntry._id) ?? noteEntry)

  return (
    <>
      <DayList
        groups={groups}
        timeZone={timeZone}
        use12Hour={use12Hour}
        projects={projects}
        tags={tags}
        actions={actions}
      />
      <NoteSheet
        entry={liveNoteEntry}
        open={noteOpen}
        onOpenChange={setNoteOpen}
        onSave={setNote}
      />
    </>
  )
}
