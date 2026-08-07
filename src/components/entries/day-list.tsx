import { EntryRow } from "@/components/entries/entry-row"
import { formatClock } from "@shared/duration"
import { cn } from "@/lib/utils"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { DayGroup } from "@/lib/group-entries"
import type { Doc } from "../../../convex/_generated/dataModel"

/**
 * The log: entries under day headers, newest first.
 *
 * This is the only list view in the product. Every "report" is this same view
 * with a filter applied, because Trace's entries are meaningful one at a time â€”
 * the aggregation layer a conventional tracker needs exists to compensate for
 * prose being absent, and here it is not.
 */
export function DayList({
  groups,
  timeZone,
  use12Hour,
  projects,
  tags,
  actions,
}: {
  groups: Array<DayGroup>
  timeZone: string
  use12Hour: boolean
  projects: Array<Doc<"projects">>
  tags: Array<Doc<"tags">>
  actions: EntryRowActions
}) {
  if (groups.length === 0) return <EmptyLog />

  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <section key={group.day} aria-label={group.label} className="flex flex-col">
          <header
            className={cn(
              "sticky top-0 z-10 flex items-baseline justify-between gap-3",
              "border-b border-edge-soft bg-ground/95 px-4 py-2 backdrop-blur-sm"
            )}
          >
            <div className="flex items-baseline gap-3">
              <h2 className="text-sm font-semibold">{group.label}</h2>
              {/*
                The note count, not a badge or a score. It states a fact and
                creates just enough pressure to fill the gaps before the recap
                is written -- without ever gating the timer.
              */}
              <span className="text-xs text-muted-foreground">
                {group.notedCount} of {group.entries.length} noted
              </span>
            </div>
            <span className="text-base font-semibold tabular text-muted-foreground">
              {formatClock(group.totalMs)}
            </span>
          </header>

          <div className="flex flex-col">
            {group.entries.map((entry) => (
              <EntryRow
                key={entry._id}
                entry={entry}
                timeZone={timeZone}
                use12Hour={use12Hour}
                projects={projects}
                tags={tags}
                actions={actions}
              />
            ))}
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
    <div className="flex flex-col gap-2 px-4 py-12 text-sm">
      <p className="font-medium">Nothing tracked yet.</p>
      <p className="max-w-prose text-muted-foreground">
        Type what you&apos;re working on and press start â€” a title is optional,
        and you can fill in the rest later. Forgot to start the timer? You can
        add an entry by hand and set its times afterwards.
      </p>
    </div>
  )
}

