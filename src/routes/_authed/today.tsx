import { useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { Button } from "@/components/ui/button"
import { TimerBar } from "@/components/timer/timer-bar"
import { EntryLog } from "@/components/entries/entry-log"
import { ManualEntryDialog } from "@/components/entries/manual-entry-dialog"
import { NoteSheet } from "@/components/entries/note-sheet"
import { TotalsRow } from "@/components/entries/totals-row"
import { useSecond } from "@/hooks/use-clock"
import { useReplayPendingStart, useTabTitleClock } from "@/hooks/use-timer-effects"
import { groupByDay, sumRange } from "@/lib/group-entries"
import { signOutAndLeave } from "@/lib/auth-client"
import { addDays, dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import type { Doc } from "../../../convex/_generated/dataModel"

/** How far back the log reaches before pagination lands. */
const LOG_DAYS = 30

export const Route = createFileRoute("/_authed/today")({
  head: () => ({ meta: [{ title: "Today — Trace" }] }),
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

  // A day string, so it changes once a day rather than once a second — which
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
      <header className="flex items-baseline justify-between px-4 py-4">
        <span className="text-base font-medium tracking-tight">Trace</span>
        <span className="flex items-baseline gap-4 text-xs text-muted-foreground">
          <span className="hidden sm:inline">{user.email}</span>
          <Button variant="ghost" size="sm" onClick={() => signOutAndLeave()}>
            Sign out
          </Button>
        </span>
      </header>

      <div className="px-4">
        <TimerBar
          running={running}
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
        <ManualEntryDialog today={today} timeZone={settings.timezone} />
      </div>

      <main className="flex-1 border-t border-edge-soft">
        <EntryLog
          groups={groups}
          timeZone={settings.timezone}
          use12Hour={settings.timeFormat === "12"}
        />
      </main>

      {/*
        The stop-time note sheet is owned here rather than inside the log,
        because the entry it asks about has just left the timer bar and may not
        be in the log's data yet. It reads the frozen snapshot the stop returned.
      */}
      <NoteSheet entry={stopped} open={noteOpen} onOpenChange={setNoteOpen} />
    </div>
  )
}
