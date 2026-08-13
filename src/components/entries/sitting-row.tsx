import { ChevronDown, ChevronRight, Play } from "lucide-react"
import {
  BillableToggle,
  ProjectPicker,
  TagPicker,
} from "@/components/classifiers/classifier-pickers"
import { NoteLine } from "@/components/entries/note-line"
import { formatTimeRange } from "@/lib/format-time"
import { formatTotal } from "@/lib/format-total"
import { joinNotes } from "@/lib/group-sittings"
import { cn } from "@/lib/utils"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { Classification } from "@/components/timer/timer-bar"
import type { DurationDisplay } from "@/lib/format-total"
import type { LogItem } from "@/lib/group-sittings"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

type Sitting = Extract<LogItem, { kind: "sitting" }>

/**
 * The default for `onCreateProject`/`onCreateTag` while `DayList` has not
 * wired them up yet. Rejects rather than resolving silently, matching this
 * codebase's `noEntryActions` convention (`test-utils/fixtures.ts`): a
 * control that reaches a creator nobody supplied should fail loudly — a
 * `.catch()` printing an error — rather than pretend the create succeeded.
 */
function throwingCreator(propName: string): (name: string) => Promise<never> {
  return () => Promise.reject(new Error(`SittingRow: ${propName} was not supplied`))
}

/**
 * The default for `onClassify`/`onNoteOpen`, for the same caller-not-wired-up
 * reason as `throwingCreator` above, but a silent no-op is the wrong shape
 * here in a way it is not for `tags = []` below. `tags = []` just leaves the
 * tag picker with nothing to choose. A no-op `onClassify` leaves the project
 * picker, tag picker and billable toggle fully live and clickable anyway —
 * this row does not know its caller forgot to wire it — so a user picks a
 * project, the picker closes as if it worked, and the write silently never
 * happens: no error, no failing test, no console line. Same for `onNoteOpen`:
 * an `+ add note` hatch that opens nothing. Throwing turns that into a stack
 * trace pointing at this file the moment the control is used, which is what
 * `throwingCreator` already buys the two creator props above.
 */
function throwingHandler(propName: string): () => never {
  return () => {
    throw new Error(`SittingRow: ${propName} was not supplied`)
  }
}

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
  tags = [],
  display,
  expanded,
  notesExpanded = false,
  onToggle,
  onResume,
  onClassify = throwingHandler("onClassify"),
  onNoteOpen = throwingHandler("onNoteOpen"),
  onCreateProject = throwingCreator("onCreateProject"),
  onCreateTag = throwingCreator("onCreateTag"),
  controls,
}: {
  sitting: Sitting
  timeZone: string
  use12Hour: boolean
  projects: Array<Doc<"projects">>
  /**
   * `tags` through `onCreateTag` below are all optional for the same reason:
   * `DayList` does not wire them up yet (wiring it in is the next task), and a
   * required prop it does not supply would crash every pre-existing grouped-
   * entries render rather than merely fail to typecheck. Real Task 6 usage
   * supplies all of them; these defaults exist only so today's incomplete
   * caller stays inert instead of throwing.
   */
  tags?: Array<Doc<"tags">>
  display: DurationDisplay
  expanded: boolean
  /** Forwarded from the page, exactly as `EntryRow` takes it. */
  notesExpanded?: boolean
  onToggle: () => void
  /** Resumes the NEWEST member — see `DayList`, which supplies it. */
  onResume: () => void
  /** Applies a classifier change to EVERY member. See `DayList`. */
  onClassify?: (change: Partial<Classification>) => void
  onNoteOpen?: () => void
  onCreateProject?: EntryRowActions["onCreateProject"]
  onCreateTag?: EntryRowActions["onCreateTag"]
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

          `items-start`, not `items-center` — this row now carries a note
          beneath its title exactly as `EntryRow` does, and the same reasoning
          applies: the trailing controls carry the row's own height (below)
          while the title/note column is left to grow downward without
          dragging the badge or the trailing cluster into its vertical middle. */}
      <div className="flex min-h-(--entry-row-height) w-full items-start gap-2 px-4">
        {/*
          THE BADGE IS THE CONTROL, which is what the reference screenshot
          shows: its tooltip is the disclosure's label, not a separate chevron's.
          One target rather than two means the count and the gesture cannot
          drift apart, and the number is the thing the eye is already on.
        */}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={controls}
          aria-label={expanded ? "Hide grouped entries" : "Show grouped entries"}
          onClick={onToggle}
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-sm border border-edge-soft",
            "px-1.5 py-0.5 text-xs tabular text-muted-foreground",
            "transition-colors hover:text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          {expanded ? (
            <ChevronDown className="size-3" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3" aria-hidden="true" />
          )}
          {sitting.entries.length}
        </button>

        {/* The title/note column, mirroring `EntryRow`'s own — see that
            component for the row-height arithmetic this shares. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* Static text, not an `EditableTitle`. Retitling a group would be a
                write to every member — see this component's own note above. */}
            <span className="min-w-0 flex-1 truncate text-sm">{title}</span>

            {sitting.allBillable ? (
              // Brass means money — The Two Temperatures Rule. Paired with a
              // glyph so it survives without colour.
              // `sm:hidden` because the BillableToggle below carries this at
              // wider widths, where it is also editable. Below `sm` the toggle is
              // dropped for room, so this static mark is what keeps billable
              // visible on a phone rather than merely absent.
              //
              // `leading-5` matters as much as the colour here: an unsized span
              // establishes a 24px line box from the inherited 16px base, so
              // without it every billable row is four pixels taller than every
              // non-billable one and the whole log develops a stutter.
              <span
                className="flex shrink-0 items-center text-xs leading-5 text-brass sm:hidden"
                title="Billable"
              >
                <span aria-hidden="true" className="font-semibold">
                  $
                </span>
                <span className="sr-only">Billable</span>
              </span>
            ) : null}
          </div>

          <NoteLine note={note} notesExpanded={notesExpanded} onOpen={onNoteOpen} />
        </div>

        {/* EVERYTHING AFTER THE TEXT, IN ONE BOX — same grouping `EntryRow`
            uses and for the same reason: the group can hold
            `min-h-(--entry-row-height) items-center` while the parent
            top-aligns, which keeps these on the row's first line rather than
            drifting down beside an expanded note. */}
        <div className="flex min-h-(--entry-row-height) shrink-0 items-center gap-2">
          {/*
            The classifiers, editable in place like `EntryRow`'s. Always
            present rather than hover-revealed: these are facts ABOUT the
            sitting, not per-row affordances, and they write through to every
            member the moment they change.
          */}
          <div className="flex shrink-0 items-center gap-0.5">
            <ProjectPicker
              projects={projects}
              value={newest.projectId ?? null}
              onCreate={onCreateProject}
              onChange={chooseProject}
              className="max-w-[8rem]"
              nameClassName="hidden md:inline"
            />
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
              className="hidden sm:inline-flex"
            />
          </div>

          <span className="hidden text-xs tabular text-muted-foreground sm:inline">
            {formatTimeRange(sitting.fromMs, sitting.toMs, timeZone, use12Hour)}
          </span>

          {/*
            `formatTotal`, whose contract says decimal applies to TOTALS and
            never to a single entry's own row. A sitting's figure is a sum of
            parts, so it is a total, and it is floored like every other one.
          */}
          <span className="text-base font-semibold tabular text-muted-foreground">
            {formatTotal(sitting.totalMs, display)}
          </span>

          <button
            type="button"
            aria-label={`Resume ${title}`}
            onClick={onResume}
            className={cn(
              "rounded-md p-1.5 text-muted-foreground",
              "opacity-100 sm:opacity-0",
              "transition-[opacity,color] sm:group-hover:opacity-100",
              "hover:text-foreground",
              "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
              "focus-visible:outline-none motion-reduce:transition-none"
            )}
          >
            <Play className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
