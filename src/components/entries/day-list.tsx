import { useState } from "react"
import { EntryRow } from "@/components/entries/entry-row"
import { SelectionCheckbox } from "@/components/entries/selection-checkbox"
import { SittingRow } from "@/components/entries/sitting-row"
import { Skeleton } from "@/components/ui/skeleton"
import { selectionState } from "@/lib/entry-selection"
import { formatTotal } from "@/lib/format-total"
import { toLogItems } from "@/lib/group-sittings"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { SelectionTarget } from "@/components/entries/selection-checkbox"
import type { DayGroup, Entry } from "@/lib/group-entries"
import type { DurationDisplay } from "@/lib/format-total"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

export type EntrySelectionController = {
  selectedIds: ReadonlySet<Id<"timeEntries">>
  onToggle: (
    entryIds: Array<Id<"timeEntries">>,
    origin: HTMLInputElement
  ) => void
}

/**
 * The log: entries under day headers, newest first.
 *
 * This is the only list view in the product. Every "report" is this same view
 * with a filter applied, because Chroneli's entries are meaningful one at a
 * time — the aggregation layer a conventional tracker needs exists to
 * compensate for prose being absent, and here it is not.
 */
export function DayList({
  groups,
  timeZone,
  use12Hour,
  weekStartDay,
  projects,
  tags,
  actions,
  selection,
  display = "hms",
  empty,
  notesExpanded = false,
  grouped = false,
}: {
  groups: Array<DayGroup>
  timeZone: string
  use12Hour: boolean
  weekStartDay: number
  projects: Array<Doc<"projects">>
  tags: Array<Doc<"tags">>
  actions: EntryRowActions
  selection?: EntrySelectionController
  display?: DurationDisplay
  /** Whether every note is written out in full instead of clipped to its line.
   *  One mode over the whole log, set by the page — see `entry-row.tsx`. */
  notesExpanded?: boolean
  /**
   * What to show for zero groups. Defaults to the Timer onboarding copy
   * below, which is only true on Timer: an empty Timer log really does mean
   * "nothing tracked yet". Reports reaches the same zero-groups state while
   * a filter matches nothing, or a date range holds no entries — neither of
   * which is onboarding, so it supplies its own message here instead of
   * inheriting Timer's.
   *
   * `null` means "render nothing", and is distinct from omitting the prop.
   * `empty ?? <EmptyLog/>` made that inexpressible — `null` fell back to the
   * onboarding copy, so the only way for a caller to draw nothing was to stop
   * rendering the log entirely. Timer did exactly that, and unmounted
   * `NoteSheet` and every held note draft along with it.
   */
  empty?: ReactNode
  /**
   * Collapse repeats of one title+project within a day behind a count.
   *
   * DEFAULTS OFF while `userSettings.groupEntries` defaults ON, and both are
   * deliberate: the component stays honest in isolation and every existing
   * caller and test keeps asserting the flat log, while the two pages pass the
   * user's own preference in. A reader who finds only this default should not
   * conclude the feature ships disabled.
   */
  grouped?: boolean
}) {
  /*
   * WHICH SITTINGS ARE OPEN, keyed by `day\0key`.
   *
   * In memory and per-tab: a disclosure is a thing the reader is doing right
   * now, not a property of the data, so it resets on reload. It lives HERE
   * rather than in the row so that /timer's deliberate keeping-`EntryLog`-
   * mounted across a change of range (see that page, and `note-sheet.tsx`)
   * carries the open groups through with the note drafts.
   */
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const targetFor = (
    entries: Array<Entry>,
    label: string
  ): SelectionTarget | undefined => {
    if (selection === undefined) return undefined
    const entryIds = entries.map((entry) => entry._id)
    return {
      label,
      state: selectionState(entryIds, selection.selectedIds),
      onToggle: (origin) => selection.onToggle(entryIds, origin),
    }
  }

  /*
   * ONE SPELLING OF A ROW, for the two places that draw one: on its own, and
   * as a member of a sitting. They are the same row — a member is not a
   * reduced version of an entry — so the props that say so are written here
   * rather than twice below, where the next one added would land on one call
   * site and silently skip the other.
   */
  const row = (entry: Entry, showNote = true) => (
    <EntryRow
      key={entry._id}
      entry={entry}
      timeZone={timeZone}
      use12Hour={use12Hour}
      weekStartDay={weekStartDay}
      projects={projects}
      tags={tags}
      actions={actions}
      selection={targetFor(
        [entry],
        `Select ${entry.title.trim() === "" ? "untitled entry" : entry.title.trim()}`
      )}
      notesExpanded={notesExpanded}
      showNote={showNote}
    />
  )

  if (groups.length === 0) {
    return <>{empty !== undefined ? empty : <EmptyLog />}</>
  }

  return (
    <div className="flex flex-col">
      {groups.map((group, groupIndex) => (
        <section
          key={group.day}
          data-day-group={group.day}
          aria-label={group.label}
          className={cn(
            "flex flex-col",
            groupIndex > 0 && "border-t-2 border-edge"
          )}
        >
          {/*
            `top-(--log-sticky-top)`, not `top-0`. A page that owns a sticky
            band sets that variable to the height of everything above this
            (see `Page`, and its `sticky`); inside the shell and without one, it is
            the timer bar's height alone (see `app-shell.tsx`), so a log on
            any other page still clears the bar rather than sliding under it.
            The `0px` in styles.css is the last resort: the variable must
            always resolve to a length, because an unset one makes `top`
            compute to `auto` and the header quietly stops sticking.
          */}
          <header
            className={cn(
              "sticky top-(--log-sticky-top) z-10 border-b border-edge-soft bg-ground/95",
              "py-2 backdrop-blur-sm"
            )}
          >
            {/*
              `w-full px-4`, exactly as `EntryRow` does it, so the day label
              starts on the same pixel as the entry titles underneath it and
              the day total lands on the same right edge as their durations.
              The padding lives HERE and not on the header, because the
              header's background and border are meant to stay full-bleed.
            */}
            <div className="entry-log-grid w-full items-baseline px-4">
              {selection === undefined ? null : (
                <SelectionCheckbox
                  className="entry-log-select"
                  label={`Select all records for ${group.label}`}
                  state={selectionState(
                    group.entries.map((entry) => entry._id),
                    selection.selectedIds
                  )}
                  onToggle={(origin) =>
                    selection.onToggle(
                      group.entries.map((entry) => entry._id),
                      origin
                    )
                  }
                />
              )}
              <div className="entry-log-content flex min-w-0 items-baseline gap-2">
                <h2 className="text-sm font-medium">{group.label}</h2>
                {/*
                  The note count, not a badge or a score. It states a fact and
                  creates just enough pressure to fill the gaps in the day --
                  without ever gating the timer.

                  Omitted entirely when the day has no completed entries yet.
                  Since a running entry is not a row, the count would otherwise
                  read "0 of 0 noted" for the whole of the first timer of the day
                  — a sentence that states nothing, in the position where the
                  nudge is supposed to be.
                */}
                {group.entries.length === 0 ? null : (
                  <span className="text-xs text-muted-foreground">
                    {group.notedCount} of {group.entries.length} noted
                  </span>
                )}
              </div>
              <span aria-hidden="true" className="entry-log-time" />
              <span
                // Includes a running entry's live elapsed time, so the server's
                // value and the client's first render legitimately differ. See
                // the same attribute in `totals-row.tsx`.
                suppressHydrationWarning
                className="entry-log-duration tabular text-base font-semibold text-muted-foreground"
              >
                {formatTotal(group.totalMs, display)}
              </span>
              <span aria-hidden="true" className="entry-log-actions" />
            </div>
          </header>

          {/*
            NO GAP BEFORE THE NEXT DAY. This used to carry a 12px
            `--day-group-gap`, on the argument that a day break has to be
            visible before the heading is read rather than after it. The
            `border-t-2 border-edge` on the section itself (above) already does
            that job, and does it with a rule the eye reads as a boundary
            rather than as absence — so the space underneath was paying twice
            for one separation and left the log looking airy where it wants to
            look like a table. The token is gone with it; `LogSkeleton` below
            reserves nothing for it either, which is what keeps the first paint
            from shifting when the real rows land.
          */}
          <div className="flex flex-col">
            {(grouped
              ? toLogItems(group.entries)
              : group.entries.map((entry) => ({ kind: "row" as const, entry }))
            ).map((item, index) => {
              if (item.kind === "row") return row(item.entry)

              const stateKey = `${group.day}\u0000${item.key}`
              // The DOM id cannot carry the NUL the state key does, and it does
              // not need to be stable across reorderings — only unique on the
              // page while it is rendered.
              const panelId = `sitting-${group.day}-${index}`
              const isOpen = open.has(stateKey)

              return (
                <div key={`sitting-${item.key}`} className="flex flex-col">
                  <SittingRow
                    sitting={item}
                    timeZone={timeZone}
                    use12Hour={use12Hour}
                    projects={projects}
                    tags={tags}
                    display={display}
                    expanded={isOpen}
                    notesExpanded={notesExpanded}
                    selection={targetFor(
                      item.entries,
                      `Select all ${item.entries.length} records for ${
                        item.entries[0].title.trim() || "untitled work"
                      }`
                    )}
                    onToggle={() => toggle(stateKey)}
                    // The NEWEST member. `useEntryActions`'s resume copies
                    // title, project, tags and billable off whatever it is
                    // given, so this already IS "start this again".
                    onResume={() => actions.onResume(item.entries[0])}
                    onClassify={(change) => actions.onSittingClassify(item.entries, change)}
                    onNoteOpen={() => actions.onSittingNoteOpen(item.entries)}
                    onCreateProject={actions.onCreateProject}
                    onCreateTag={actions.onCreateTag}
                    controls={panelId}
                  />
                  {isOpen ? (
                    // Indented, and NOT RENDERED while collapsed rather than
                    // merely hidden: a long log of collapsed groups would
                    // otherwise mount every member's pickers for nobody.
                    //
                    // `showNote={false}`: the note belongs to the sitting, not
                    // to each interval of it — see `SittingRow`'s own doc
                    // comment and `entry-row.tsx`'s `showNote` prop.
                    <div
                      id={panelId}
                      className="flex flex-col border-l-2 border-edge-soft pl-4"
                    >
                      {item.entries.map((entry) => row(entry, false))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

/**
 * The empty state answers the two questions a new freelancer actually has:
 * how do the hours come back out, and what happens when I forget to start.
 * Toggl's is silent, which is territory to beat them on rather than match.
 */
function EmptyLog() {
  return (
    <div className="flex max-w-prose flex-col gap-4 px-4 py-10 text-sm">
      <p className="font-medium">Nothing tracked yet.</p>

      <dl className="flex flex-col gap-3 text-muted-foreground">
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium text-foreground">
            How do the hours come back out?
          </dt>
          <dd>
            Write a note when you stop a timer — a sentence about what you
            actually did. <strong className="font-medium text-foreground">Reports</strong>{" "}
            totals any date range, marks what's billable, and searches note
            text — so a well-noted entry is one you can find again by what
            happened, not just when.
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium text-foreground">
            What if I forget to start the timer?
          </dt>
          <dd>
            Use <strong className="font-medium text-foreground">Add entry</strong>{" "}
            and type the hours you worked. Every time on every entry can be
            corrected afterwards by clicking it — nothing here is written in
            stone, and nothing is lost by getting it wrong the first time.
          </dd>
        </div>
      </dl>

      <p className="text-muted-foreground">
        Type what you&apos;re working on and press start. A title is optional and
        so is everything else — the note can wait until you stop, and it is the
        part this is really for.
      </p>
    </div>
  )
}

/**
 * What the log looks like before the first page has arrived.
 *
 * Both `/timer` and `/reports` used to render nothing for `groups` while
 * `status === "LoadingFirstPage"`, which fell into the same zero-groups
 * branch as a genuinely empty log — so a page holding six tracked hours
 * said "Nothing tracked yet" for one render before correcting itself. An
 * empty state has to mean "empty"; while the answer isn't known yet, this is
 * what renders instead. Two day-shaped blocks, not one: a single skeleton
 * row reads as "there is one entry", which is its own false claim.
 *
 * The bars are `aria-hidden`: they are shapes standing in for content that
 * does not exist yet, and reading them out is worse than silence. But this is
 * the ONLY thing on screen for the whole first page load, so hiding all of it
 * left a screen-reader user with nothing at all where a sighted user gets a
 * shimmer. The live status beside them is the actual announcement.
 */
export function LogSkeleton() {
  return (
    <>
      <span role="status" className="sr-only">
        Loading entries…
      </span>
      <div aria-hidden="true" className="flex flex-col">
        {[0, 1].map((group) => (
          <div key={group} className="flex flex-col">
            <div className="border-b border-edge-soft py-2">
              {/* Same `w-full px-4` as the header it stands in for, so the
                  page does not shift sideways when the real rows arrive. */}
              <div className="entry-log-grid w-full items-baseline px-4">
                <span className="entry-log-select" />
                <Skeleton className="entry-log-content h-4 w-32" />
                <span className="entry-log-time" />
                <Skeleton className="entry-log-duration h-4" />
                <span className="entry-log-actions" />
              </div>
            </div>
            {/* `--entry-row-height`, tracking the real row — a placeholder
                that reserves the wrong height moves the page under the reader
                the moment the answer arrives, which is why it is shared rather
                than copied (see `entry-row.tsx`). There is no group gap to
                mirror any more; see the real group above. */}
            <div className="flex flex-col">
              {[0, 1, 2].map((row) => (
                <div key={row} className="border-b border-edge-soft">
                  <div className="entry-log-grid h-(--entry-row-height) w-full items-center px-4">
                    <span className="entry-log-select" />
                    <Skeleton className="entry-log-content h-4 max-w-64" />
                    <span className="entry-log-time" />
                    <Skeleton className="entry-log-duration h-4" />
                    <span className="entry-log-actions" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
