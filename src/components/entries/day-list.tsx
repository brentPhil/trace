import { EntryRow } from "@/components/entries/entry-row"
import { formatTotal } from "@/lib/format-total"
import { cn } from "@/lib/utils"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { DayGroup } from "@/lib/group-entries"
import type { DurationDisplay } from "@/lib/format-total"
import type { Doc } from "../../../convex/_generated/dataModel"

/**
 * The log: entries under day headers, newest first.
 *
 * This is the only list view in the product. Every "report" is this same view
 * with a filter applied, because Trace's entries are meaningful one at a time —
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
  highlightedEntryId,
  display = "hms",
}: {
  groups: Array<DayGroup>
  timeZone: string
  use12Hour: boolean
  projects: Array<Doc<"projects">>
  tags: Array<Doc<"tags">>
  actions: EntryRowActions
  highlightedEntryId?: string | null
  display?: DurationDisplay
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
            <span
              // Includes a running entry's live elapsed time, so the server's
              // value and the client's first render legitimately differ. See
              // the same attribute in `totals-row.tsx`.
              suppressHydrationWarning
              className="text-base font-semibold tabular text-muted-foreground"
            >
              {formatTotal(group.totalMs, display)}
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
                highlighted={entry._id === highlightedEntryId}
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
    <div className="flex max-w-prose flex-col gap-4 px-4 py-10 text-sm">
      <p className="font-medium">Nothing tracked yet.</p>

      <dl className="flex flex-col gap-3 text-muted-foreground">
        <div className="flex flex-col gap-0.5">
          <dt className="font-medium text-foreground">
            How do the hours come back out?
          </dt>
          <dd>
            The recap panel above turns a day into something you can paste into
            a channel or an email — grouped by client, with what you actually
            did. History totals any date range and marks what was billable.
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



