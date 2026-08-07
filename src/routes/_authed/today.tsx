import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery, useConvexMutation } from "@convex-dev/react-query"
import { AppHeader } from "@/components/app-header"
import { TimerBar } from "@/components/timer/timer-bar"
import { EntryLog } from "@/components/entries/entry-log"
import { ManualEntryDialog } from "@/components/entries/manual-entry-dialog"
import { NoteSheet } from "@/components/entries/note-sheet"
import { TotalsRow } from "@/components/entries/totals-row"
import { RecapPanel } from "@/components/recap/recap-panel"
import { useSecond } from "@/hooks/use-clock"
import { useClassifierMutations, useClassifiers } from "@/hooks/use-classifiers"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { useEntryMutations } from "@/hooks/use-entry-mutations"
import { useReplayPendingStart, useTabTitleClock } from "@/hooks/use-timer-effects"
import { groupByDay, sumRange } from "@/lib/group-entries"
import { addDays, dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import type { TimerBarActions } from "@/components/timer/timer-bar"
import type { Doc } from "../../../convex/_generated/dataModel"

/** How far back the log reaches before pagination lands. */
const LOG_DAYS = 30

export const Route = createFileRoute("/_authed/today")({
  head: () => ({ meta: [{ title: "Today â€” Trace" }] }),
  component: Today,
  loader: async ({ context }) => {
    // Settings first and awaited: every day boundary below depends on the
    // stored timezone. It is loaded here rather than in a parent loader
    // because TanStack Router runs loaders in PARALLEL across matched routes,
    // so a child cannot assume a parent's loader has resolved.
    const settings = await context.queryClient.ensureQueryData(
      convexQuery(api.settings.get, {})
    )

    const now = Date.now()
    const from = dayWindow(addDays(dayOf(now, settings.timezone), -LOG_DAYS), settings.timezone)
    const to = dayWindow(dayOf(now, settings.timezone), settings.timezone)

    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.auth.getAuthenticatedUser, {})),
      context.queryClient.ensureQueryData(convexQuery(api.entries.getRunning, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.entries.listRange, { fromMs: from.fromMs, toMs: to.toMs })
      ),
      context.queryClient.ensureQueryData(
        convexQuery(api.recap.get, { day: dayOf(now, settings.timezone) })
      ),
    ])
  },
})

function Today() {
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getAuthenticatedUser, {})
  )
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const { data: running } = useSuspenseQuery(convexQuery(api.entries.getRunning, {}))

  // The range is pinned to the current second, not to Date.now() at render, so
  // the query key is stable across re-renders and the subscription is not torn
  // down and rebuilt on every tick.
  const second = useSecond()
  const nowMs = (second ?? Math.floor(Date.now() / 1000)) * 1000

  // A day string, so it changes once a day rather than once a second â€” which
  // is what keeps the query key below stable and stops the subscription being
  // torn down and rebuilt on every tick.
  const today = dayOf(nowMs, settings.timezone)

  const range = useMemo(
    () => ({
      fromMs: dayWindow(addDays(today, -LOG_DAYS), settings.timezone).fromMs,
      toMs: dayWindow(today, settings.timezone).toMs,
    }),
    [today, settings.timezone]
  )

  const { data: entries } = useSuspenseQuery(
    convexQuery(api.entries.listRange, { fromMs: range.fromMs, toMs: range.toMs })
  )

  useTabTitleClock(running, settings.tabTitleClock)
  useReplayPendingStart(running)

  const [stopped, setStopped] = useState<Doc<"timeEntries"> | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)

  // The live writes. This is the only place in the tracking surface that has
  // them; the bar and the rows receive what they are allowed to do.
  const entryMutations = useEntryMutations()
  const editMutations = useEntryEditMutations()
  const { projects, tags } = useClassifiers()
  const { createProject, ensureTag } = useClassifierMutations()

  const { data: suggestions } = useSuspenseQuery(
    convexQuery(api.entries.titleSuggestions, { limit: 40 })
  )
  const { data: recap } = useSuspenseQuery(convexQuery(api.recap.get, { day: today }))
  const setRecapFields = useConvexMutation(api.recap.setFields)

  // Which entry a recap bullet was drilled into. Cleared when the day changes,
  // since the id would then point at a row no longer on screen.
  const [highlighted, setHighlighted] = useState<string | null>(null)
  useEffect(() => setHighlighted(null), [today])

  // Assembled once here rather than inline in JSX, so the bar's props are a
  // stable object and the identity of every callback is the hook's, not a new
  // arrow per render.
  const timerActions: TimerBarActions = useMemo(
    () => ({
      start: entryMutations.start,
      stop: entryMutations.stop,
      discard: entryMutations.discard,
      setTitle: entryMutations.setTitle,
      classify: async (entryId, change) => {
        await editMutations.update({
          entryId,
          ...(change.projectId !== undefined ? { projectId: change.projectId } : {}),
          ...(change.tagIds !== undefined ? { tagIds: change.tagIds } : {}),
          ...(change.billable !== undefined ? { billable: change.billable } : {}),
        })
      },
      createProject: async (name) => await createProject({ name }),
      createTag: async (name) => await ensureTag(name),
    }),
    [entryMutations, editMutations, createProject, ensureTag]
  )

  const groups = useMemo(
    () => groupByDay(entries, settings.timezone, nowMs),
    [entries, settings.timezone, nowMs]
  )

  const todayGroup = groups.find((group) => group.day === today)
  const week = weekWindow(today, settings.timezone, settings.weekStartDay)
  const weekTotals = sumRange(
    groups.filter((group) => group.day >= week.firstDay && group.day <= week.lastDay)
  )

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col">
      <AppHeader email={user.email} />

      <div className="px-4">
        <TimerBar
          running={running}
          actions={timerActions}
          projects={projects}
          tags={tags}
          suggestions={suggestions}
          onStopped={(entry) => {
            setStopped(entry)
            setNoteOpen(true)
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 pr-2">
        <TotalsRow
          className="py-3"
          todayMs={todayGroup?.totalMs ?? 0}
          weekMs={weekTotals.totalMs}
          billableMs={weekTotals.billableMs}
        />
        <ManualEntryDialog
          today={today}
          timeZone={settings.timezone}
          onCreate={editMutations.create}
        />
      </div>

      <RecapPanel
        doc={recap}
        onSaveFields={async (fields) => {
          await setRecapFields({ day: today, ...fields })
        }}
        onFocusEntry={setHighlighted}
      />

      <main className="flex-1">
        <EntryLog
          groups={groups}
          timeZone={settings.timezone}
          use12Hour={settings.timeFormat === "12"}
          highlightedEntryId={highlighted}
        />
      </main>

      {/*
        The stop-time note sheet is owned here rather than inside the log,
        because the entry it asks about has just left the timer bar and may not
        be in the log's data yet. It reads the frozen snapshot the stop returned.
      */}
      <NoteSheet
        entry={stopped}
        open={noteOpen}
        onOpenChange={setNoteOpen}
        onSave={editMutations.setNote}
      />
    </div>
  )
}


