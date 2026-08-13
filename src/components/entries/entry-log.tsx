import { useState } from "react"
import { DayList } from "@/components/entries/day-list"
import { NoteSheet } from "@/components/entries/note-sheet"
import { useClassifiers } from "@/hooks/use-classifiers"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { joinNotes } from "@/lib/group-sittings"
import type { ReactNode } from "react"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { NoteTarget } from "@/components/entries/note-sheet"
import type { EntryActions } from "@/hooks/use-entry-actions"
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
  actions: entryActions,
  notesExpanded,
  grouped,
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
  /**
   * What a row may do to its entry, from `useEntryActions`.
   *
   * PASSED IN, not reached for — which is a change, and the reason is /timer.
   * That page already calls the hook for the calendar popover's sake, and this
   * component called it again: on the default List view both instances were
   * live, only this one's was read, and a full set of
   * `useConvexMutation(...).withOptimisticUpdate(...)` closures was rebuilt
   * every second for the one nobody used. The hook's stated goal is one place
   * where an entry changes, so there is now literally one instance per page.
   */
  actions: EntryActions
  /** Forwarded to `DayList`, and from there to every row: whether a note is
   *  written out in full or clipped to one line. The page owns it, because it
   *  is a mode the reader is in rather than a property of any one entry. */
  notesExpanded?: boolean
  /** Forwarded to `DayList` — the user's `groupEntries` setting. See there for
   *  why the component's own default is the opposite of the setting's. */
  grouped?: boolean
}) {
  const { updateMany } = useEntryEditMutations()
  const { projects, tags } = useClassifiers()

  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)

  const actions: EntryRowActions = {
    ...entryActions,
    onNoteOpen: (entry) => {
      setNoteTarget({
        entryIds: [entry._id],
        key: entry._id,
        title: entry.title,
        note: entry.note ?? "",
        totalMs: entry.durationMs ?? 0,
      })
      setNoteOpen(true)
    },
  }

  // The sheet reads the LIVE rows when they are still found in `groups`,
  // falling back to the snapshot only if every one has since been removed
  // (deleted, or paginated out from under it) — so it stays in sync with edits
  // made elsewhere while it is open, rather than going stale mid-sentence.
  const liveNoteTarget = (() => {
    if (noteTarget === null) return null
    const byId = new Map(
      groups.flatMap((group) => group.entries).map((entry) => [entry._id, entry])
    )
    const live = noteTarget.entryIds
      .map((id) => byId.get(id))
      .filter((entry): entry is Entry => entry !== undefined)
    if (live.length === 0) return noteTarget
    return {
      ...noteTarget,
      // A rename made in another tab or on another device must show up here
      // too — the sheet header, the dialog's accessible name, and the undo
      // toast's label all read `title`. A sitting's members share a title by
      // construction (it is half the grouping key), so the first live
      // member's is correct whether this target is a row or a sitting.
      title: live[0].title,
      note: joinNotes(live),
      totalMs: live.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0),
    }
  })()

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
        notesExpanded={notesExpanded}
        grouped={grouped}
      />
      <NoteSheet
        target={liveNoteTarget}
        open={noteOpen}
        onOpenChange={setNoteOpen}
        onSave={(entryIds, note) => updateMany({ entryIds, note })}
      />
    </>
  )
}

