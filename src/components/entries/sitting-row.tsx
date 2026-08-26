import { Play, Trash2 } from "lucide-react"
import {
  BillableToggle,
  ProjectPicker,
  TagPicker,
} from "@/components/classifiers/classifier-pickers"
import { NoteLine } from "@/components/entries/note-line"
import { SelectionCheckbox } from "@/components/entries/selection-checkbox"
import { Button } from "@/components/ui/button"
import { formatTimeRange } from "@/lib/format-time"
import { formatTotal } from "@/lib/format-total"
import { joinNotes } from "@/lib/group-sittings"
import { cn } from "@/lib/utils"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { SelectionTarget } from "@/components/entries/selection-checkbox"
import type { Classification } from "@/components/timer/timer-bar"
import type { DurationDisplay } from "@/lib/format-total"
import type { LogItem } from "@/lib/group-sittings"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

type Sitting = Extract<LogItem, { kind: "sitting" }>

/**
 * Several sittings at one piece of work, and the place that work is edited.
 *
 * THE SITTING IS THE UNIT OF WORK; THE ENTRIES UNDER IT ARE THE UNIT OF TIME.
 * The note, the project, the tags and the billable flag are facts about the
 * work, so they live here and write through to every member at once. Times are
 * per-entry facts, so they stay on the member rows — and duration is absent
 * from this row for the reason it always was: editing a total would have to
 * pick a member to absorb the change.
 *
 * THIS ROW USED TO BE READ-ONLY. It changed because shipping grouping showed
 * the assumption underneath it was wrong: two entries sharing a title usually
 * carry the SAME note, typed twice by hand, because nothing in this product
 * copies a note forward. See
 * docs/superpowers/specs/2026-08-13-sitting-as-the-unit-design.md.
 *
 * Still a disclosure and not a merge. Grouping stores nothing of its own —
 * there is no sitting document, no row this component owns. The one write
 * that follows from a choice made here (a billable-by-default project marking
 * every member billable, below) is not an exception to that: it is a
 * consequence of something the user just clicked, and it lands the instant
 * they click it, in front of them — not a rewrite happening behind their
 * back. Every member remains individually present with its own times one
 * click away.
 */
export function SittingRow({
  sitting,
  timeZone,
  use12Hour,
  projects,
  tags,
  display,
  expanded,
  notesExpanded = false,
  selection,
  onToggle,
  onResume,
  onRemove,
  onClassify,
  onNoteSave,
  onCreateProject,
  onCreateTag,
  controls,
}: {
  sitting: Sitting
  timeZone: string
  use12Hour: boolean
  projects: Array<Doc<"projects">>
  tags: Array<Doc<"tags">>
  display: DurationDisplay
  expanded: boolean
  /** Forwarded from the page, exactly as `EntryRow` takes it. */
  notesExpanded?: boolean
  selection?: SelectionTarget
  onToggle: () => void
  /** Resumes the NEWEST member — see `DayList`, which supplies it. */
  onResume: () => void
  /** Deletes EVERY member, in one mutation under one Undo. See `DayList` and
   *  `EntryLog.onSittingRemove`. Not the newest one alone — a sitting names a
   *  piece of work, and deleting it means deleting the work. */
  onRemove: () => void
  /** Applies a classifier change to EVERY member. See `DayList`. */
  onClassify: (change: Partial<Classification>) => void
  /** Writes ONE note onto every member, from the line's inline editor. The
   *  line shows their notes joined, so this saves what was on screen. */
  onNoteSave: (note: string) => Promise<void>
  onCreateProject: EntryRowActions["onCreateProject"]
  onCreateTag: EntryRowActions["onCreateTag"]
  /**
   * The `id` of the container this row reveals, for `aria-controls`.
   *
   * Points at an element that DOES NOT EXIST while collapsed — `DayList`
   * unmounts the member container at rest, for the same reason this row's own
   * doc comment gives for carrying no edits: a long log of collapsed groups
   * cannot afford to mount every member's pickers for nobody. `aria-controls`
   * referencing a dangling id is the accepted cost of that trade.
   */
  controls: string
}) {
  const newest = sitting.entries[0]
  const title = newest.title.trim()
  const note = joinNotes(sitting.entries)

  /*
   * A PROJECT'S DEFAULT, APPLIED ONLY UPWARDS.
   *
   * `startImpl` reads `args.billable ?? project?.billableByDefault` for a NEW
   * entry, and these entries already exist — so the server rule that an
   * existing entry never re-inherits still holds, and holds literally: the
   * derivation happens here and travels as an explicit `billable`, which is the
   * same shape `timer-bar.tsx` uses and for the same reason. What the `$` shows
   * is provably what was written.
   *
   * ONLY EVER ON. A billable-by-default project marks every member billable; a
   * project that does not bill by default sends no `billable` at all and leaves
   * each member's flag alone. Adding a mark destroys no decision. Removing one
   * would — see convex/projects.ts on exactly that.
   */
  const chooseProject = (projectId: Id<"projects"> | null) => {
    const picked = projects.find((project) => project._id === projectId) ?? null
    onClassify(
      picked?.billableByDefault === true
        ? { projectId, billable: true }
        : { projectId }
    )
  }

  return (
    <div
      className={cn(
        "group border-b border-edge-soft/60",
        "transition-colors hover:bg-surface/60"
      )}
    >
      {/* `px-4` and the row height token, exactly as `EntryRow` and the day
          header use them, so three files that cannot see each other put the
          left edge and the baseline in the same place.

          `items-center`, exactly as `EntryRow`'s own wrapper — the two rows
          are peers in one list and must level their columns the same way. At
          the resting row height centring and first-line alignment draw the
          identical thing; they diverge only when a note is written out in
          full, where the whole cluster centres against the grown column.
          Whatever the answer to that mode is, it has to be answered for both
          rows at once, in one place. */}
      {/* WRAPS BELOW `sm`, exactly as `EntryRow` does and for the same reason —
          see that file. The comment above is explicit that a layout answer has
          to be given for both rows at once, and this is the other half of it. */}
      <div className="flex min-h-(--entry-row-height) w-full flex-wrap items-center gap-1.5 px-4 sm:flex-nowrap">
        {selection === undefined ? null : (
          <SelectionCheckbox
            contextual
            label={selection.label}
            state={selection.state}
            onToggle={selection.onToggle}
          />
        )}
        {/* `flex-1`, not `w-full` — a wrapping flex container breaks a line on
            an item's hypothetical size before it considers shrinking, so 100%
            would put this column below the selection checkbox. See `EntryRow`. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* The number is the disclosure, with its accessible state carried by
              the button rather than a separate visible chevron. The wrapper's
              `items-center` is what places it — level with the title at the
              resting row height, like every other control on the row.

              `h-6 min-w-6` (via `size="badge"`) is the floor WCAG 2.2 AA asks
              of a target (24x24). The previous `text-xs px-1.5 py-0.5` came to
              roughly 22px tall — under it, and small enough to be a fussy hit
              for a control that is on every grouped row. `min-w`, not a fixed
              square, so a three-digit count still fits. */}
          <Button
            type="button"
            variant="quiet"
            size="badge"
            aria-expanded={expanded}
            aria-controls={controls}
            aria-label={
              expanded ? "Hide grouped entries" : "Show grouped entries"
            }
            onClick={onToggle}
            className="shrink-0 rounded-sm border-edge-soft font-mono tracking-[-0.02em] tabular-nums"
          >
            {sitting.entries.length}
          </Button>

          {/* The title/note column, mirroring `EntryRow`'s own. */}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
            {/* `min-h-6` pins the first line — see `entry-row.tsx`. */}
            <div className="flex min-h-6 min-w-0 items-center gap-1.5">
              {/* NOT `flex-1`, matching `EditableTitle` on an entry row for the
                  reason argued there: a title that fills the row pushes the
                  project to the far right, where "Sealogs" reads as a property
                  of the times rather than as part of the name of the work. It
                  sizes to its text and truncates.

                  `leading-none` with `py-0.5 -my-0.5` for the same reason
                  `EditableTitle` carries them: no half-leading, and no clipped
                  descender inside `truncate`'s `overflow: hidden`. */}
              <span className="-my-0.5 min-w-0 truncate py-0.5 text-base font-medium">
                {title}
              </span>
              <ProjectPicker
                projects={projects}
                value={newest.projectId ?? null}
                onCreate={onCreateProject}
                onChange={chooseProject}
                className="max-w-32 shrink-0"
                nameClassName="hidden md:inline"
              />
            </div>

            <NoteLine
              note={note}
              notesExpanded={notesExpanded}
              onSave={onNoteSave}
            />
          </div>

          {/*
            A SIBLING OF THE TITLE COLUMN, NOT A CHILD OF IT — this is what
            puts the marks in the same column as an entry row's.

            Both rows share one content track of identical width,
            so right-aligning inside it is what makes a column. But this row
            spends the first 32px of that track on the disclosure button and
            its gap; a pair right-aligned INSIDE the title column therefore
            landed 32px left of every entry row's pair, which is exactly the
            ragged edge this layout exists to prevent. Sitting out here, past
            the `flex-1` title column, it ends on the track's own right edge —
            the same pixel `ml-auto` reaches on an entry row.

            `py-1.5` rather than a fixed offset, mirroring the title column's
            own padding: both centres then resolve to 6px + half the control
            height, so they stay level even if the pickers change size.
          */}
        </div>

        {/* One wrapped line carrying BOTH clusters, `display: contents` from
            `sm` up so the desktop row is untouched. `EntryRow` argues this at
            length; the two must not diverge. */}
        <div className="flex w-full items-center justify-end gap-4 sm:contents">
          <div className="flex h-full shrink-0 items-center justify-end gap-4">
            <TagPicker
              tags={tags}
              value={sitting.tagIds}
              onCreate={onCreateTag}
              onChange={(tagIds) => onClassify({ tagIds })}
              className="hidden sm:inline-flex"
            />
            <BillableToggle
              value={sitting.allBillable}
              onChange={(billable) => onClassify({ billable })}
            />
            {/* `text-nowrap`: a time range is one indivisible value; broken
              across two lines it is not a smaller version of itself. */}
            <div className="px-1 font-mono text-xs tracking-[-0.02em] text-nowrap text-muted-foreground tabular-nums">
              {formatTimeRange(
                sitting.fromMs,
                sitting.toMs,
                timeZone,
                use12Hour
              )}
            </div>
            {/*
            `formatTotal`, whose contract says decimal applies to TOTALS and
            never to a single entry's own row. A sitting's figure is a sum of
            parts, so it is a total, and it is floored like every other one.

            TYPESET EXACTLY AS `EditableDuration` — `text-sm font-medium` in
            ink. A sitting row and an entry row are peers in one list, sharing
            one duration column, and this figure once read a size and a weight
            above its members' for no reason the reader can act on — a 16px
            figure and a 14px figure start at different x-positions even with
            their right edges true, so the column looked ragged. The DAY
            header total stays larger on purpose — it summarises a section
            rather than standing in the list as a row.

            `data-log-cell="duration"` is the column's name in the DOM, shared
            with the day total and `EditableDuration`; day-list.test.tsx
            queries it to hold the three shapes to one treatment. */}
            <span
              data-log-cell="duration"
              className="flex h-full items-center justify-end ps-2.5 pe-1 font-mono text-sm font-medium tracking-[-0.02em] tabular-nums"
            >
              {formatTotal(sitting.totalMs, display)}
            </span>
          </div>

          <div className="flex h-full items-center justify-end">
            <SittingAction label={`Resume ${title}`} onClick={onResume}>
              <Play className="size-4" />
            </SittingAction>
            <SittingAction
              label={`Delete ${title}`}
              onClick={onRemove}
              destructive
            >
              <Trash2 className="size-4" />
            </SittingAction>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The sitting row's peer of `EntryRow`'s `RowButton` — same size, same fade,
 * and the same `destructive` warming to `--alarm` rather than to full ink, so
 * the two rows' delete affordances cannot drift apart.
 */
function SittingAction({
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
    <Button
      type="button"
      variant="quiet"
      size="icon-row"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "opacity-100 sm:opacity-0",
        "transition-[opacity,color] sm:group-hover:opacity-100",
        "focus-visible:opacity-100 motion-reduce:transition-none",
        destructive && "hover:text-alarm"
      )}
    >
      {children}
    </Button>
  )
}
