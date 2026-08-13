import { ChevronDown, ChevronRight, Play } from "lucide-react"
import { ProjectDot } from "@/components/classifiers/project-dot"
import { formatTimeRange } from "@/lib/format-time"
import { formatTotal } from "@/lib/format-total"
import { cn } from "@/lib/utils"
import type { DurationDisplay } from "@/lib/format-total"
import type { LogItem } from "@/lib/group-sittings"
import type { Doc } from "../../../convex/_generated/dataModel"

type Sitting = Extract<LogItem, { kind: "sitting" }>

/**
 * Several sittings at one piece of work, behind a count.
 *
 * DELIBERATELY NOT EDITABLE, unlike every other row in this product. Duration
 * and start/end have no meaning for a group — editing the total would have to
 * pick a member to absorb the change — and a note written here would have to be
 * copied onto every member or stored nowhere. So the parent discloses and
 * resumes, the members carry every edit, and this feature adds no mutations at
 * all.
 *
 * Tags and the billable mark are absent for a related reason: both can differ
 * between members, this row cannot edit either, and a mark meaning "some of
 * these" is a mark that means nothing. The project is shown because it is part
 * of the grouping key, so every member provably shares it.
 */
export function SittingRow({
  sitting,
  timeZone,
  use12Hour,
  projects,
  display,
  expanded,
  onToggle,
  onResume,
  controls,
}: {
  sitting: Sitting
  timeZone: string
  use12Hour: boolean
  projects: Array<Doc<"projects">>
  display: DurationDisplay
  expanded: boolean
  onToggle: () => void
  /** Resumes the NEWEST member — see `DayList`, which supplies it. */
  onResume: () => void
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
  const project = projects.find((candidate) => candidate._id === newest.projectId) ?? null

  return (
    <div
      className={cn(
        "group border-b border-edge-soft/60",
        "transition-colors hover:bg-surface/60"
      )}
    >
      {/* `px-4` and the row height token, exactly as `EntryRow` and the day
          header use them, so three files that cannot see each other put the
          left edge and the baseline in the same place. */}
      <div className="flex min-h-(--entry-row-height) w-full items-center gap-2 px-4">
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

        {/* Static text, not an `EditableTitle`. Retitling a group would be a
            write to every member — see this component's own note above. */}
        <span className="min-w-0 flex-1 truncate text-sm">{title}</span>

        <div className="flex shrink-0 items-center gap-2">
          <ProjectDot
            project={project}
            className="max-w-[8rem]"
            nameClassName="hidden md:inline"
          />

          {/*
            THE DAY HEADER'S OWN SENTENCE, in the day header's own words.
            Collapsing rows must not turn a missing note from visible into
            absent — that is the one thing this product cannot trade for a
            tidier list.
          */}
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {sitting.notedCount} of {sitting.entries.length} noted
          </span>

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
