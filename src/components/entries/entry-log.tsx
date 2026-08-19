import { useEffect, useMemo, useRef, useState } from "react"
import { useAnnounce } from "@/components/a11y/announcer"
import { BulkEntryActions } from "@/components/entries/bulk-entry-actions"
import { DayList } from "@/components/entries/day-list"
import { NoteSheet } from "@/components/entries/note-sheet"
import { Toast } from "@/components/ui/toast"
import { useClassifiers } from "@/hooks/use-classifiers"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { pruneSelection, toggleSelection } from "@/lib/entry-selection"
import { errorMessage } from "@/lib/error-message"
import { joinNotes } from "@/lib/group-sittings"
import { withInheritedBillable } from "@/lib/inherit-billable"
import { cn } from "@/lib/utils"
import { dayOf } from "@shared/day"
import type { ReactNode } from "react"
import type { EntrySelectionController } from "@/components/entries/day-list"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { NoteTarget } from "@/components/entries/note-sheet"
import type { EntryActions } from "@/hooks/use-entry-actions"
import type { DurationDisplay } from "@/lib/format-total"
import type { DayGroup, Entry } from "@/lib/group-entries"
import type { Id } from "../../../convex/_generated/dataModel"

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
 * left here are the two things a LOG has and a grid does not — opening the note
 * sheet, and holding the SELECTION, both of which this component owns.
 *
 * Selection lives here rather than in `DayList` because it spans days: one set
 * covers every group on screen, and a day header's own checkbox is just one
 * more way into it. It is deliberately local and temporary — no schema field,
 * no setting, gone on reload — because it describes what the reader is doing
 * this minute, not anything true about an entry. Both `/timer` and `/reports`
 * therefore get the whole behaviour by rendering this component, with no
 * selection state of their own.
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
  const toasts = Toast.useToastManager()

  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)

  const [selectedIds, setSelectedIds] = useState<Set<Id<"timeEntries">>>(
    new Set()
  )
  const [deleting, setDeleting] = useState(false)
  // The control the last toggle came from, so a Clear can put focus back where
  // the reader left it instead of dropping it on <body>.
  const lastSelectionControl = useRef<HTMLInputElement | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const announce = useAnnounce()

  const liveEntries = useMemo(
    () => groups.flatMap((group) => group.entries),
    [groups]
  )
  const liveIds = useMemo(
    () => liveEntries.map((entry) => entry._id),
    [liveEntries]
  )
  const liveById = useMemo(
    () => new Map(liveEntries.map((entry) => [entry._id, entry])),
    [liveEntries]
  )

  /*
   * WHAT IS SELECTED AND STILL ON SCREEN.
   *
   * Derived on every render rather than read straight from state, so a row
   * that vanished between renders — deleted in another tab, filtered out,
   * paginated away — stops counting toward the bar immediately. The state
   * itself is pruned by the effect below; this is what makes the render in
   * between honest.
   */
  const selectedLiveIds = pruneSelection(selectedIds, liveIds)

  useEffect(() => {
    setSelectedIds((current) => {
      const next = pruneSelection(current, liveIds)
      // Returning `current` unchanged is what stops this from looping. `groups`
      // is rebuilt by the page on most renders, so `liveIds` is a fresh array
      // nearly every time and this effect runs constantly; `pruneSelection`
      // always allocates a new Set, and handing React a new object every pass
      // would re-render forever. Pruning only ever REMOVES, so equal size means
      // equal contents — and the identical reference makes React bail out.
      return next.size === current.size ? current : next
    })
  }, [liveIds])

  const selection: EntrySelectionController = {
    selectedIds: selectedLiveIds,
    onToggle: (entryIds, origin) => {
      lastSelectionControl.current = origin
      setSelectedIds((current) => {
        // Prune INSIDE the updater as well: `current` may still hold ids that
        // died since the last commit, and they would otherwise be counted in
        // the announcement and revived into the next delete.
        const next = toggleSelection(pruneSelection(current, liveIds), entryIds)
        announce(
          `${next.size} ${next.size === 1 ? "record" : "records"} selected`
        )
        return next
      })
    },
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
    announce("Selection cleared")
    requestAnimationFrame(() => lastSelectionControl.current?.focus())
  }

  const deleteSelection = async () => {
    // Snapshots, not ids: `onRemoveMany` raises an Undo that has to restore
    // these rows in full, and after the delete lands they are no longer
    // anywhere to be read back from.
    const entries = [...selectedLiveIds]
      .map((entryId) => liveById.get(entryId))
      .filter((entry): entry is Entry => entry !== undefined)
    if (entries.length === 0 || deleting) return

    setDeleting(true)
    const deleted = await entryActions.onRemoveMany(entries)
    setDeleting(false)
    // A refusal keeps the selection exactly as it was. The action has already
    // said what went wrong; clearing here would make the retry a re-selection.
    if (!deleted) return

    setSelectedIds(new Set())
    announce(
      `Deleted ${entries.length} ${entries.length === 1 ? "record" : "records"}`
    )
    // The rows that held focus are gone. Send it to the log itself rather than
    // letting it fall to <body>, so the next Tab resumes here.
    requestAnimationFrame(() => logRef.current?.focus())
  }

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
    /*
     * THE WHOLE GROUP, IN ONE MUTATION, UNDER ONE UNDO.
     *
     * `onRemoveMany` and not `onRemove` per member: it dedupes, deletes in a
     * single call, and raises one toast that names the count and puts every
     * row back. A loop would raise a toast per member, and a refusal on the
     * third would leave the sitting half-standing with two Undos to find.
     *
     * The promise is deliberately dropped. `onRemoveMany` reports its own
     * failure as a toast and answers `false`, and unlike `deleteSelection`
     * above there is no selection state here to keep or clear on the strength
     * of that answer — the sitting is a disclosure over rows the query owns,
     * so a refusal simply leaves the group on screen.
     */
    onSittingRemove: (entries) => {
      void entryActions.onRemoveMany(entries)
    },
    onSittingClassify: (entries, rawChange) => {
      /*
       * The same billable inheritance the single row gets (`use-entry-actions`).
       * "Currently billable" for a GROUP is `every`: promotion applies as long
       * as at least one member is still unticked, and writing `true` onto a
       * member that already carries it is a no-op rather than a reversal — the
       * promote-only boundary holds member by member.
       */
      const change = withInheritedBillable(
        rawChange,
        entries.every((entry) => entry.billable),
        rawChange.projectId == null
          ? null
          : projects.find((project) => project._id === rawChange.projectId)
      )
      void updateMany({
        entryIds: entries.map((entry) => entry._id),
        ...change,
        // `projectId` is already `Id | null` in `Classification`, which is the
        // shape `updateMany` takes — null clears, absent leaves alone.
      }).catch((thrown: unknown) => {
        // Same reasoning as the row's own classify (`use-entry-actions.ts`):
        // a failure here reverts every member's optimistic patch at once,
        // including `billable`, which reaches invoices — silence would let
        // the reader believe a discarded change had stuck.
        toasts.add({ title: errorMessage(thrown), priority: "high" })
      })
    },
    onSittingNoteOpen: (entries) => {
      // Title + project is unique within a single day, NOT within the whole
      // log -- this log renders many days, and recurring work (the ordinary
      // case grouping exists to serve) means the same title+project sitting
      // recurs on different days. Leaving the day out of the key collided
      // two days' sittings onto one entry in `drafts` (note-sheet.tsx): note
      // Aug 9's "Crew dropdowns", dismiss before the save lands, then open
      // Aug 8's "Crew dropdowns" -- it would seed from Aug 9's still-pending
      // draft, and a second dismissal would write Aug 9's prose onto Aug
      // 8's entries.
      //
      // The day is derived from `entries[0].startedAt` rather than looked
      // up from `groups[].day`: a sitting cannot cross a day boundary
      // (`toLogItems` only ever runs on one `DayGroup`'s own `entries`), so
      // every member's `startedAt` already resolves, via the same `dayOf`,
      // to exactly the day this sitting was grouped under -- the same
      // computation `groupByDay` used to place it there in the first place.
      // That makes it the direct source rather than a stand-in for one, and
      // it works without re-finding this sitting inside `groups` by
      // reference.
      const day = dayOf(entries[0].startedAt, timeZone)
      setNoteTarget({
        entryIds: entries.map((entry) => entry._id),
        key: `sitting\u0000${day}\u0000${entries[0].title.trim()}\u0000${entries[0].projectId ?? ""}`,
        title: entries[0].title,
        note: joinNotes(entries),
        totalMs: entries.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0),
      })
      setNoteOpen(true)
    },
  }

  // The sheet reads the LIVE rows when they are still found in `groups`,
  // falling back to the snapshot only if every one has since been removed
  // (deleted, or paginated out from under it) — so it stays in sync with edits
  // made elsewhere while it is open, rather than going stale mid-sentence.
  //
  // `entryIds` ITSELF stays the snapshot below, deliberately, even though
  // `live` is computed here — the save still targets every id `noteTarget`
  // was built with, not just the ones still found in `groups`. Narrowing to
  // `live` would silently under-write a member that merely paginated out of
  // view, dropping it from the sitting's save with nothing on screen to say
  // so. The snapshot instead lets a genuinely deleted member fail the WHOLE
  // save with `NOT_FOUND` — reported by `onSittingClassify`'s toast above (or
  // the note sheet's own error state, for a note save) rather than silently
  // dropped from a partial write.
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
      // construction ONLY AT THE MOMENT THE TARGET IS BUILT — `entryIds` is
      // fixed then, from `toLogItems`' grouping key, but a member can be
      // retitled out of the sitting while this sheet stays open (its own
      // title edit is unreachable from here, but nothing stops a resume,
      // another tab, or a calendar edit from doing it). If that happens,
      // `live[0]` may be the departed member, now carrying its new title —
      // and `joinNotes(live)` and the `totalMs` sum just below share exactly
      // the same staleness. Nothing to fix here: the sheet re-seeds fresh on
      // its next open, which is where the target is rebuilt from scratch.
      title: live[0].title,
      note: joinNotes(live),
      totalMs: live.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0),
    }
  })()

  return (
    <>
      <div
        ref={logRef}
        role="region"
        aria-label="Time entries"
        // Focusable only programmatically — `deleteSelection` lands focus here
        // once the selected rows are gone. It is not a tab stop.
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || selectedLiveIds.size === 0) return
          event.preventDefault()
          setSelectedIds(new Set())
          announce("Selection cleared")
        }}
        // Only while the bar is up: it is fixed to the viewport, so without
        // this the last row of the log sits underneath it.
        className={cn("relative", selectedLiveIds.size > 0 && "pb-20")}
      >
        <DayList
          groups={groups}
          timeZone={timeZone}
          use12Hour={use12Hour}
          weekStartDay={weekStartDay}
          projects={projects}
          tags={tags}
          actions={actions}
          selection={selection}
          display={display}
          empty={empty}
          notesExpanded={notesExpanded}
          grouped={grouped}
        />
        {/*
          Fixed to the viewport rather than sticky inside the log, because both
          Timer and Reports scroll the document and neither gives the log an
          inner scroll container — a sticky bar would simply scroll away with
          the rows it acts on.

          `z-40` against the toast viewport's `z-50`, so the Undo raised by the
          delete this bar triggers always lands ABOVE it rather than behind.
          The outer layer is `pointer-events-none` so the strip of empty space
          either side of the bar does not swallow clicks on the log beneath.
        */}
        {selectedLiveIds.size === 0 ? null : (
          <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
            <div className="pointer-events-auto">
              <BulkEntryActions
                count={selectedLiveIds.size}
                deleting={deleting}
                onDelete={() => void deleteSelection()}
                onClear={clearSelection}
              />
            </div>
          </div>
        )}
      </div>
      <NoteSheet
        target={liveNoteTarget}
        open={noteOpen}
        onOpenChange={setNoteOpen}
        onSave={(entryIds, note) => updateMany({ entryIds, note })}
      />
    </>
  )
}
