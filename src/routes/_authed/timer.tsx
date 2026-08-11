import { useCallback, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { usePaginatedQuery } from "convex/react"
import { EntryLog } from "@/components/entries/entry-log"
import { LogSkeleton } from "@/components/entries/day-list"
import { FilteredLogStatus } from "@/components/entries/filtered-log-status"
import { ManualEntryDialog } from "@/components/entries/manual-entry-dialog"
import { TotalsRow } from "@/components/entries/totals-row"
import { FilterControls } from "@/components/history/filter-controls"
import { PageStickyHeader } from "@/components/shell/page-sticky-header"
import { useClassifiers } from "@/hooks/use-classifiers"
import { useSecond } from "@/hooks/use-clock"
import { useEntryEditMutations } from "@/hooks/use-entry-edit-mutations"
import { groupByDay } from "@/lib/group-entries"
import { hasClientSideFilter, matches } from "@/lib/history-filters"
import { periodTotals } from "@/lib/period-totals"
import { dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import type { QuickFilters } from "@/lib/history-filters"

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

export function Timer() {
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

  const { projects, projectsById } = useClassifiers()

  // Text, project and billable — never a date range, preset chip, or period
  // step. Those stay exclusive to Reports: Timer's range is `fromMs: 0`, all
  // of history, so it has no bounded period for a preset or a step to act on.
  // See FilteredLogStatus below for the consequence of that: a filter here
  // can only ever search what has already been paginated in.
  const [filters, setFilters] = useState<QuickFilters>(() => ({
    projectId: null,
    billableOnly: false,
    text: "",
  }))

  const filtering = hasClientSideFilter(filters)

  const nameOf = useCallback(
    (id: string | undefined) => (id === undefined ? "" : (projectsById.get(id)?.name ?? "")),
    [projectsById]
  )

  /*
   * The pass is SKIPPED, not merely memoised, when nothing is filtering.
   *
   * With no filter set — every state until somebody types in the search box —
   * `matches` returns true for every row, so the whole scan can only ever
   * rebuild an array equal to the one it started from. This page re-renders
   * once a second (`useSecond` above), and `nameOf`'s dependency was a `Map`
   * that `useClassifiers` rebuilt every render, so the memo below missed on
   * every tick and ran that guaranteed-identity scan over the entire
   * paginated log once a second, forever.
   *
   * The memo is kept for the case that does do work: `projectsById` is stable
   * now, so a real filter is re-evaluated when the rows or the filters change
   * rather than when the clock does.
   */
  const filtered = useMemo(
    () =>
      filtering ? results.filter((entry) => matches(entry, filters, nameOf)) : results,
    [filtering, results, filters, nameOf]
  )

  const groups = useMemo(
    () => groupByDay(filtered, settings.timezone, nowMs),
    [filtered, settings.timezone, nowMs]
  )

  /*
   * Rows, not groups. `groupByDay` keeps a running entry out of `entries` but
   * still opens a day for it (its elapsed time belongs in that day's total),
   * so a group count answers "how many days are on screen", not "how many
   * entries matched" — and those differ by exactly the entry the log
   * deliberately never draws.
   */
  const rowCount = groups.reduce((n, group) => n + group.entries.length, 0)

  const totals = periodTotals(weekEntries, settings.timezone, today, nowMs)

  return (
    /*
      THE TOP OF THIS PAGE STAYS PUT. What the timer bar above it is for — the
      numbers you check and the filter you type into — is useless once it has
      scrolled past the log it describes, and this is the one page whose whole
      body is a scroll. `PageStickyHeader` owns how that is done and what the
      day headers below then stick to.
    */
    <PageStickyHeader
      header={
        <>
          {/*
            `justify-between` used to put this cluster hard left and "+ Add
            entry" at the far right — opposite corners of a 1344px+ row, for a
            button whose entire reason to exist is "I forgot to start the timer",
            prompted BY the numbers to its left. Adjacent instead, so the control
            sits next to the totals it relates to however wide the page gets.
          */}
          <div className="flex w-full items-center gap-4 px-4">
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

          {/*
            The band is full-bleed — it is a strip of the page, like a day header —
            and its CONTROLS take the same `px-4` gutter as everything else, so the
            search box starts on the same pixel as the entry titles below it and
            the totals above it. It was the one thing on this page that did neither.
          */}
          <div className="border-y border-edge-soft bg-surface py-2.5">
            <div className="w-full px-4">
              <FilterControls filters={filters} projects={projects} onChange={setFilters} />
            </div>
          </div>
        </>
      }
    >
      <div className="flex-1">
        {/*
          `status === "LoadingFirstPage"` is checked first, because `groups`
          reads as `[]` for the entire first round trip regardless of whether
          a filter is active — and an empty array used to fall straight into
          "nothing tracked yet", flashing the onboarding copy at a freelancer
          whose day is fully logged, for as long as that fetch took.

          Everything after that is ONE branch, not two: `EntryLog` is always
          rendered and only its `empty` slot changes. A filter that matches
          nothing here does not mean nothing is tracked, so the onboarding
          copy would be flatly false under an active search — but the answer
          is to draw nothing inside the log, not to take the log away. See the
          `empty` prop below for what removing it used to cost.
        */}
        {status === "LoadingFirstPage" ? (
          <LogSkeleton />
        ) : (
          <EntryLog
            groups={groups}
            timeZone={settings.timezone}
            use12Hour={settings.timeFormat === "12"}
            weekStartDay={settings.weekStartDay}
            display={settings.durationDisplay}
            // `null`, not omitted: draw nothing for zero groups rather than
            // DayList's onboarding copy. Passing nothing here is what forced
            // the previous version to swap `EntryLog` for `null` outright
            // whenever a filter matched nothing — which unmounted `NoteSheet`
            // with it, and with that every note draft it was holding for a
            // save still in flight or already failed. One keystroke in the
            // search box, and the promise note-sheet.tsx makes about exactly
            // that case was gone.
            empty={filtering ? null : undefined}
          />
        )}

        {/*
          A button, not scroll-triggered loading. Reports already works this
          way, the day headers are sticky and auto-loading fights them, and a
          control the user presses is one they can also choose not to press.
        */}
        <FilteredLogStatus
          filtering={filtering}
          matchCount={rowCount}
          status={status}
          onLoadMore={() => loadMore(PAGE_SIZE)}
        />
      </div>
    </PageStickyHeader>
  )
}
