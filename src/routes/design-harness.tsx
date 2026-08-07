import { useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { TimerBar } from "@/components/timer/timer-bar"
import { DayList } from "@/components/entries/day-list"
import { ManualEntryDialog } from "@/components/entries/manual-entry-dialog"
import { NoteSheet } from "@/components/entries/note-sheet"
import { TotalsRow } from "@/components/entries/totals-row"
import { FilterBar } from "@/components/history/filter-bar"
import { RecapPanel } from "@/components/recap/recap-panel"
import { Toast } from "@/components/ui/toast"
import { groupByDay } from "@/lib/group-entries"
import { dayOf } from "@shared/day"
import { formatCompactDuration } from "@shared/duration"
import { elapsedMs } from "@shared/entryTimes"
import { assembleRecap } from "@shared/recap"
import { defaultFilters } from "@/lib/history-filters"
import type { EntryRowActions } from "@/components/entries/entry-row"
import type { TimerBarActions } from "@/components/timer/timer-bar"
import type { Entry } from "@/lib/group-entries"
import type { Doc, Id } from "../../convex/_generated/dataModel"

// DEV-ONLY design harness. Renders the tracking surfaces against fixtures so
// the layout can be reviewed without a session â€” the only way to see the log,
// the day headers and the running/idle timer states side by side.
//
// It is a PUBLIC route with no auth guard. It reads nothing and writes nothing,
// so it leaks no data, but it must be deleted before this ships. Phases 4-8
// (edit sheet, projects, tags, recap, filters) still lean on it.
export const Route = createFileRoute("/design-harness")({
  component: DesignHarness,
})

const TZ = "Europe/London"
// Anchored to the real clock, not a fixed instant: EntryDuration reads the wall
// clock itself, so a pinned fixture time would put the running entry's start in
// the future and it would correctly clamp to 0:00:00.
const NOW = Date.now()
const H = 3_600_000
const M = 60_000

let seq = 0
function entry(part: Partial<Entry> & { startedAt: number; endedAt: number | null }): Entry {
  seq++
  return {
    _id: `fixture-${seq}` as unknown as Id<"timeEntries">,
    _creationTime: part.startedAt,
    userId: "u",
    clientKey: `k${seq}`,
    title: "",
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: part.startedAt,
    deletedAt: null,
    durationMs: part.endedAt === null ? null : part.endedAt - part.startedAt,
    ...part,
  }
}

function fixtureProject(
  name: string,
  color: string,
  billableByDefault: boolean
): Doc<"projects"> {
  return {
    _id: `proj-${name}` as unknown as Id<"projects">,
    _creationTime: NOW,
    userId: "u",
    name,
    color,
    archived: false,
    billableByDefault,
    updatedAt: NOW,
    deletedAt: null,
  }
}

function fixtureTag(name: string): Doc<"tags"> {
  return {
    _id: `tag-${name}` as unknown as Id<"tags">,
    _creationTime: NOW,
    userId: "u",
    name,
    updatedAt: NOW,
    deletedAt: null,
  }
}

const ACME = "proj-Acme redesign" as unknown as Id<"projects">
const BELL = "proj-Bellweather API" as unknown as Id<"projects">
const DEEP = "tag-deep-work" as unknown as Id<"tags">

const entries: Array<Entry> = [
  entry({
    title: "Checkout form validation",
    projectId: ACME,
    tagIds: [DEEP],
    note: "Rebuilt the validation so card errors surface inline instead of in the toast",
    startedAt: NOW - 1 * H - 46 * M,
    endedAt: null,
    billable: true,
  }),
  entry({
    title: "PR review",
    projectId: ACME,
    note: "Reviewed Priya's PR #218; left notes on the state-machine transitions",
    startedAt: NOW - 4 * H,
    endedAt: NOW - 3 * H - 13 * M,
    billable: true,
  }),
  entry({
    title: "Standup",
    startedAt: NOW - 5 * H,
    endedAt: NOW - 4 * H - 48 * M,
  }),
  entry({
    title: "",
    startedAt: NOW - 6 * H,
    endedAt: NOW - 5 * H - 37 * M,
  }),
  entry({
    title: "Pool leak in the webhook worker",
    projectId: BELL,
    note: "Traced the intermittent 502s to a connection-pool leak; patched the checkout path and added a regression test",
    startedAt: NOW - 26 * H,
    endedAt: NOW - 24 * H - 5 * M,
    billable: true,
  }),
  entry({
    title: "Logo lockups for Meridian",
    note: "Exported at every size the printer asked for, zipped and sent",
    startedAt: NOW - 30 * H,
    endedAt: NOW - 28 * H - 30 * M,
    billable: true,
  }),
  entry({
    title: "Invoicing",
    startedAt: NOW - 32 * H,
    endedAt: NOW - 31 * H - 34 * M,
  }),
]

/** Today's entries, run through the real assembler rather than hand-written. */
const recapDoc = assembleRecap({
  day: dayOf(NOW, TZ),
  dayLabel: "Thu 6 Aug",
  entries: entries
    .filter((e) => e.endedAt !== null && dayOf(e.startedAt, TZ) === dayOf(NOW, TZ))
    .map((e) => ({
      id: e._id,
      title: e.title,
      note: e.note,
      projectId: e.projectId,
      startedAt: e.startedAt,
      durationMs: e.durationMs ?? 0,
      billable: e.billable,
    })),
  projects: [
    { id: String(ACME), name: "Acme redesign", color: "coral" },
    { id: String(BELL), name: "Bellweather API", color: "teal" },
  ],
  next: "ship the pool fix behind a flag once staging is up",
  blocked: "waiting on Dana for the legal wording",
})

function DesignHarness() {
  const groups = groupByDay(entries, TZ, NOW)
  const [noteEntry, setNoteEntry] = useState<Entry | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [filters, setFilters] = useState(() => defaultFilters(dayOf(NOW, TZ), 1))
  const toasts = Toast.useToastManager()

  /*
   * INERT. Nothing on this page may reach the backend.
   *
   * These fixtures carry ids like "fixture-1", which is not a Convex id, so
   * every write from here failed argument validation and logged an error
   * against the real deployment. That was the harmless version. The dangerous
   * one is a signed-in developer opening this page: the bar's start button
   * would have started a real timer and stopped whatever was actually running.
   *
   * The fix is structural rather than a flag â€” TimerBar and EntryRow both take
   * their writes as arguments now, so "cannot write" is a thing the harness can
   * express, and forgetting to express it is a type error rather than traffic.
   */
  const timerActions: TimerBarActions = {
    start: async () => {},
    stop: async () => ({ stoppedEntryIds: [], serverNow: NOW }),
    discard: async () => {},
    setTitle: async () => {},
    classify: async () => {},
    createProject: async () => ({ projectId: "p" as unknown as Id<"projects"> }),
    createTag: async () => ({ tagId: "t" as unknown as Id<"tags"> }),
  }

  // Fixture classifiers, so the pickers have something to show.
  const fixtureProjects = [
    fixtureProject("Acme redesign", "coral", true),
    fixtureProject("Bellweather API", "teal", true),
    fixtureProject("Internal", "slate", false),
  ]
  const fixtureTags = [fixtureTag("deep-work"), fixtureTag("meeting")]

  // The note sheet and the inline editors are still wired up, because the point
  // of the harness is to see how they behave â€” an editor that opens and refuses
  // to close would not be visible from a static render.
  const actions: EntryRowActions = {
    onTitleChange: async () => {},
    onTimeChange: async () => {},
    onDurationChange: async () => {},
    onClassify: () => {},
    onCreateProject: async () => ({ projectId: "p" as unknown as Id<"projects"> }),
    onCreateTag: async () => ({ tagId: "t" as unknown as Id<"tags"> }),
    onNoteOpen: (row) => {
      setNoteEntry(row)
      setNoteOpen(true)
    },
    onRemove: (row) => {
      const label = row.title.trim() === "" ? "entry" : `â€œ${row.title.trim()}â€`
      toasts.add({
        title: `Deleted ${label}`,
        description: formatCompactDuration(elapsedMs(row, NOW)),
        timeout: 6_000,
        actionProps: { children: "Undo", onClick: () => {} },
      })
    },
    onResume: () => {},
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col">
      <header className="flex items-baseline justify-between px-4 py-4">
        <span className="text-base font-medium tracking-tight">Trace</span>
        <span className="text-xs text-muted-foreground">design harness</span>
      </header>

      <div className="px-4">
        <TimerBar running={entries[0]} actions={timerActions} projects={fixtureProjects} tags={fixtureTags} />
      </div>

      <div className="flex items-center justify-between gap-3 pr-2">
        <TotalsRow
          className="py-3"
          todayMs={6 * H + 15 * M}
          weekMs={31 * H + 40 * M}
          billableMs={24 * H}
        />
        <ManualEntryDialog
          today={dayOf(NOW, TZ)}
          timeZone={TZ}
          onCreate={async () => {}}
        />
      </div>

      <RecapPanel
        doc={recapDoc}
        onSaveFields={async () => {}}
        onFocusEntry={setHighlighted}
      />

      <main className="flex-1 border-t border-edge-soft">
        <DayList
          groups={groups}
          timeZone={TZ}
          use12Hour={false}
          projects={fixtureProjects}
          tags={fixtureTags}
          actions={actions}
          highlightedEntryId={highlighted}
        />
      </main>

      <div className="border-t border-edge-soft px-4 py-6">
        <p className="mb-3 text-xs text-muted-foreground">History filters</p>
        <FilterBar
          filters={filters}
          projects={fixtureProjects}
          today={dayOf(NOW, TZ)}
          weekStartDay={1}
          onChange={(next) =>
            setFilters((current) => (typeof next === "function" ? next(current) : next))
          }
        />
      </div>

      <div className="px-4 py-8">
        <p className="mb-3 text-xs text-muted-foreground">Idle state</p>
        <TimerBar running={null} actions={timerActions} projects={fixtureProjects} tags={fixtureTags} />
      </div>

      <NoteSheet
        entry={noteEntry}
        open={noteOpen}
        onOpenChange={setNoteOpen}
        onSave={async () => {}}
      />
    </div>
  )
}




