import { useMemo } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { usePaginatedQuery } from "convex/react"
import { EntryLog } from "@/components/entries/entry-log"
import { ManualEntryDialog } from "@/components/entries/manual-entry-dialog"
import { TotalsRow } from "@/components/entries/totals-row"
import { Button } from "@/components/ui/button"
import { useSecond } from "@/hooks/use-clock"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { groupByDay } from "@/lib/group-entries"
import { periodTotals } from "@/lib/period-totals"
import { dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"

const PAGE_SIZE = 50

export const Route = createFileRoute("/_authed/timer")({
  head: () => ({ meta: [{ title: "Timer — Trace" }] }),
  component: Timer,
  loader: async ({ context }) => {
    // Settings first and awaited: every day boundary below depends on the
    // stored timezone. It is loaded here rather than in a parent loader
    // because TanStack Router runs loaders in PARALLEL across matched routes,
    // so a child cannot assume a parent's loader has resolved.
    const settings = await context.queryClient.ensureQueryData(
      convexQuery(api.settings.get, {})
    )

    // The component below reads this exact range with `useSuspenseQuery` for
    // the week totals. Without prefetching it here, the page suspends on a
    // round trip AFTER this loader has already resolved — the deleted
    // today.tsx prefetched its own range for the same reason.
    const today = dayOf(Date.now(), settings.timezone)
    const week = weekWindow(today, settings.timezone, settings.weekStartDay)
    await context.queryClient.ensureQueryData(
      convexQuery(api.entries.listRange, { fromMs: week.fromMs, toMs: week.toMs })
    )
  },
})

function Timer() {
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

  const week = weekWindow(today, settings.timezone, settings.weekStartDay)

  // `weekWindow` already returns the boundary as fromMs/toMs (see
  // convex/lib/day.ts) — recomputing it a second way from firstDay/lastDay
  // here would be two sources of truth for one boundary, which is exactly
  // what that module exists to prevent.
  const weekRange = useMemo(
    () => ({ fromMs: week.fromMs, toMs: week.toMs }),
    [week.fromMs, week.toMs]
  )

  // Bounded to the current week and used ONLY for the totals. See
  // src/lib/period-totals.ts for why they are not derived from the list below.
  const { data: weekEntries } = useSuspenseQuery(
    convexQuery(api.entries.listRange, weekRange)
  )

  // The log itself, all the way back. `toMs` is the end of today rather than
  // Infinity so a clock-skewed future entry cannot sit permanently on top.
  // Named distinctly from the real `api.entries.listRange` call just above —
  // these are the args to `listPage`, not to `listRange`.
  const logRange = useMemo(
    () => ({ fromMs: 0, toMs: dayWindow(today, settings.timezone).toMs }),
    [today, settings.timezone]
  )

  const { results, status, loadMore } = usePaginatedQuery(
    api.entries.listPage,
    logRange,
    { initialNumItems: PAGE_SIZE }
  )

  // The live writes for an entry that already exists. Starting, stopping and
  // discarding the running timer live in the layout route now, above the
  // outlet — this page only edits rows that are already recorded.
  const editMutations = useEntryEditMutations()

  const groups = useMemo(
    () => groupByDay(results, settings.timezone, nowMs),
    [results, settings.timezone, nowMs]
  )

  const totals = periodTotals(weekEntries, settings.timezone, today, nowMs)

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-3 pr-2">
        <TotalsRow
          className="py-3"
          todayMs={totals.todayMs}
          weekMs={totals.weekMs}
          billableMs={totals.billableMs}
          display={settings.durationDisplay}
        />
        <ManualEntryDialog
          today={today}
          timeZone={settings.timezone}
          onCreate={editMutations.create}
        />
      </div>

      <div className="flex-1">
        <EntryLog
          groups={groups}
          timeZone={settings.timezone}
          use12Hour={settings.timeFormat === "12"}
          weekStartDay={settings.weekStartDay}
          display={settings.durationDisplay}
        />

        {/*
          A button, not scroll-triggered loading. Reports already works this
          way, the day headers are sticky and auto-loading fights them, and a
          control the user presses is one they can also choose not to press.
        */}
        {status === "CanLoadMore" ? (
          <div className="flex justify-center py-4">
            <Button variant="outline" onClick={() => loadMore(PAGE_SIZE)}>
              Load earlier entries
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
