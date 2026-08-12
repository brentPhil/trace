import { useState } from "react"
import { DayList } from "@/components/entries/day-list"
import { NoteSheet } from "@/components/entries/note-sheet"
import { useClassifiers } from "@/hooks/use-classifiers"
import { useEntryActions } from "@/hooks/use-entry-actions"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import type { ReactNode } from "react"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { DurationDisplay } from "@/lib/format-total"
import type { DayGroup, Entry } from "@/lib/group-entries"

/**
 * The log, and everything a row can do to itself.
 *
 * The writes live in `useEntryActions` rather than in the rows so there is one
 * place where an entry changes, one place that raises the undo toast, and one
 * place that knows what to do when the server refuses. Rows stay renderable
 * against fixtures.
 *
 * THEY USED TO LIVE IN THIS FILE. They moved out when a calendar block gained
 * an editor of its own: two implementations of "delete, then offer the way
 * back" would be two undo windows and two sentences for one event. All that is
 * left here is the one action a LOG has and a grid does not — opening the note
 * sheet, which this component owns.
 *
 * The SHAPE of the undo toast — window, Undo button, what happens when the undo
 * is itself refused — is `src/lib/undo-toast.ts`, so the sheet below can report
 * a dismissal in the same words without a second copy of it.
 */
export function EntryLog({
  groups,
  timeZone,
  use12Hour,
  weekStartDay,
  display,
  empty,
}: {
  groups: Array<DayGroup>
  timeZone: string
  use12Hour: boolean
  /** 0 = Sunday. The calendar's first column must match the week totals. */
  weekStartDay: number
  display?: DurationDisplay
  /** Forwarded to `DayList` — see there for why the default isn't right for
   * every page that renders a log. */
  empty?: ReactNode
}) {
  const { setNote } = useEntryEditMutations()
  const { projects, tags } = useClassifiers()
  const entryActions = useEntryActions(timeZone)

  const [noteEntry, setNoteEntry] = useState<Entry | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)

  const actions: EntryRowActions = {
    ...entryActions,
    onNoteOpen: (entry) => {
      setNoteEntry(entry)
      setNoteOpen(true)
    },
  }

  // The sheet reads the LIVE row when one is still found in `groups`, falling
  // back to the snapshot only if the entry has since been removed (deleted,
  // or paginated out from under it) — so it stays in sync with edits made
  // elsewhere while it is open, rather than going stale mid-sentence.
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
        weekStartDay={weekStartDay}
        projects={projects}
        tags={tags}
        actions={actions}
        display={display}
        empty={empty}
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

