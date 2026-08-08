import { useMemo } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { EntryLog } from "@/components/entries/entry-log"
import { ManualEntryDialog } from "@/components/entries/manual-entry-dialog"
import { TotalsRow } from "@/components/entries/totals-row"
import { useSecond } from "@/hooks/use-clock"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { groupByDay, sumRange } from "@/lib/group-entries"
import { addDays, dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"

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

    await context.queryClient.ensureQueryData(
      convexQuery(api.entries.listRange, { fromMs: from.fromMs, toMs: to.toMs })
    )
  },
})

function Today() {
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))

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

  // The live writes for an entry that already exists. Starting, stopping and
  // discarding the running timer live in the layout route now, above the
  // outlet — this page only edits rows that are already recorded.
  const editMutations = useEntryEditMutations()

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
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 pr-2">
        <TotalsRow
          className="py-3"
          todayMs={todayGroup?.totalMs ?? 0}
          weekMs={weekTotals.totalMs}
          billableMs={weekTotals.billableMs}
          display={settings.durationDisplay}
        />
        <ManualEntryDialog
          today={today}
          timeZone={settings.timezone}
          onCreate={editMutations.create}
        />
      </div>

      <main className="flex-1">
        <EntryLog
          groups={groups}
          timeZone={settings.timezone}
          use12Hour={settings.timeFormat === "12"}
          display={settings.durationDisplay}
        />
      </main>
    </div>
  )
}
