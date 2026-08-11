import { useCallback, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { usePaginatedQuery } from "convex/react"
import { CalendarHeader } from "@/components/calendar/calendar-header"
import { CalendarPanel } from "@/components/calendar/calendar-panel"
import { EntryLog } from "@/components/entries/entry-log"
import { LogSkeleton } from "@/components/entries/day-list"
import { FilteredLogStatus } from "@/components/entries/filtered-log-status"
import { TotalsRow } from "@/components/entries/totals-row"
import { FilterBand } from "@/components/history/filter-band"
import { FilterControls } from "@/components/history/filter-controls"
import { Page } from "@/components/shell/page"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useClassifiers } from "@/hooks/use-classifiers"
import { useSecond } from "@/hooks/use-clock"
import { dayTotals } from "@/lib/calendar-events"
import { groupByDay } from "@/lib/group-entries"
import { hasClientSideFilter, matches } from "@/lib/history-filters"
import { periodTotals } from "@/lib/period-totals"
import { addDays, dayOf, dayWindow, weekStartOf, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import type { CalendarSize } from "@/lib/calendar-label"
import type { QuickFilters } from "@/lib/history-filters"
import type { DayString } from "@shared/day"

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

  /*
   * The calendar's view and its anchor.
   *
   * `useState` beside `filters`, not in the URL — Reports does not put its
   * period in the URL either, and one page inventing a second convention for
   * the same kind of state is how the two come to disagree.
   *
   * This gives /timer a bounded PERIOD, which the comment on `filters` above
   * says it does not have. That comment is still true of the LIST, whose range
   * is `fromMs: 0` and always will be. The period belongs to the calendar
   * view, and presets and a date-range picker stay exclusive to Reports: a
   * stepper over a fixed-width window is a different control answering a
   * different question.
   */
  const [view, setView] = useState<"calendar" | "list">("list")
  const [size, setSize] = useState<CalendarSize>("week")
  const [anchor, setAnchor] = useState<DayString>(today)

  /*
   * The window FullCalendar is actually showing, reported back by `datesSet`.
   *
   * Taken from the grid rather than computed here on purpose: computing it
   * twice is how the query and the columns come to describe different weeks.
   * `null` until the first `datesSet` fires, which is why the query below is
   * `useQuery` with an enabled guard rather than `useSuspenseQuery` — there is
   * nothing to suspend on until the grid has said what it is drawing.
   *
   * The object is only ever replaced by `onRangeChange`, so the query key it
   * feeds is referentially stable between renders. `CalendarPanel` holds the
   * other half of that: it drops a `datesSet` whose range it has already
   * reported, so setState here cannot feed a render loop back into it.
   */
  const [calendarRange, setCalendarRange] = useState<{
    fromMs: number
    toMs: number
  } | null>(null)

  const calendarQuery = useQuery({
    ...convexQuery(api.entries.listRange, calendarRange ?? { fromMs: 0, toMs: 0 }),
    enabled: view === "calendar" && calendarRange !== null,
  })

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

  /*
   * ONE filter, both views.
   *
   * The same `filters` state and the same `matches` the list uses, one memo
   * above. Hiding the band with the list was the alternative and it silently
   * drops a filter the user set — a control disappearing is indistinguishable
   * from the data changing, which is the one impression a billing tool cannot
   * afford.
   *
   * NOT `groupByDay`. That deliberately keeps a running entry out of its
   * `entries` (it is already on screen in the timer bar, larger and live), and
   * a view whose whole purpose is the shape of the day has to show what is
   * running — so the calendar takes the rows straight.
   */
  const calendarEntries = useMemo(() => {
    const rows = calendarQuery.data ?? []
    return filtering ? rows.filter((entry) => matches(entry, filters, nameOf)) : rows
  }, [calendarQuery.data, filtering, filters, nameOf])

  /*
   * The RANGE's total, for the calendar's own header — never for `TotalsRow`,
   * which stays on today and this week. Summed from `dayTotals` rather than
   * from the rows directly so the number under the arrows is the sum of the
   * numbers in the column headers, by construction.
   */
  const calendarTotalMs = useMemo(() => {
    let sum = 0
    for (const ms of dayTotals(calendarEntries, settings.timezone, nowMs).values()) {
      sum += ms
    }
    return sum
  }, [calendarEntries, settings.timezone, nowMs])

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
      THE TOP OF THIS PAGE STAYS PUT — `sticky`, which `Page` defaults to false
      and which every caller has to argue. What the timer bar above it is for —
      the numbers you check and the filter you type into — is useless once it
      has scrolled past the log it describes, and this is the one page whose
      whole body is a scroll. Both halves of the header are readouts of, or
      controls over, exactly the rows underneath them, which is Page's stated
      test for pinning. `Page` owns how that is done and what the day headers
      below then stick to.

      `titleHidden`, and the heading is NEW. This page had no `<h1>` at all,
      which is a document-structure gap rather than a style: a screen reader's
      heading list is how a page is skimmed without sight, and this one offered
      nothing to skim. It stays out of SIGHT because the header directly beneath
      it already says what the page is, twice over — a week's totals and a
      filter over a log — and a `text-sm` word "Timer" above them would push the
      running timer down the screen to label something already labelled.
    */
    <Page
      title="Timer"
      titleHidden
      sticky
      header={
        <>
          {/*
            The totals, and the switcher between the two views of them.

            "+ Add entry" used to sit here, and the comment this replaces
            argued for it: the numbers to its left are what prompt "I forgot to
            start the timer", so the control belonged next to them. That was
            right while the button lived on this page — and the button living
            on this page was the problem. Noticing a forgotten block happens on
            /reports at least as often, and the control was not there.

            It is a `+` beside Play in the timer bar now, which sits in the
            shell above the outlet and is therefore on every page. Same
            argument about adjacency, applied to the control it is actually
            adjacent to: the one that starts and stops the timer you forgot to
            start.
          */}
          <div className="flex w-full flex-wrap items-center gap-4 px-4">
            <TotalsRow
              className="py-3"
              todayMs={totals.todayMs}
              weekMs={totals.weekMs}
              billableMs={totals.billableMs}
              display={settings.durationDisplay}
            />

            {/*
              TABS, NOT TWO ROUTES — reports.tsx settled this argument for
              Summary and Detailed and it holds here for the same reason: the
              filter band below is ONE control governing both views. A
              freelancer narrows to a client and then looks at the shape of the
              week and at the rows behind the shape; a second page would mean
              setting the filter twice and would let the two drift apart with
              nothing on screen to say so.

              The totals to the left do NOT belong to either view. They are
              ambient facts about the clock — see CalendarHeader for the range
              total, which is the number that follows the arrows.
            */}
            <Tabs
              value={view}
              onValueChange={(next) => setView(next as "calendar" | "list")}
              className="ml-auto"
            >
              <TabsList variant="line">
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/*
            The stepper sticks with the totals, because it is a control over
            what scrolls beneath it — Page's stated test for what belongs in
            this slot. It is inside the measured element, so `Page` accounts
            for its height without this file measuring anything.
          */}
          {view === "calendar" ? (
            <div className="w-full px-4 pb-3">
              <CalendarHeader
                {...visibleDays(anchor, size, settings.weekStartDay)}
                size={size}
                today={today}
                rangeMs={calendarTotalMs}
                display={settings.durationDisplay}
                onStep={(delta) =>
                  setAnchor((current) =>
                    addDays(current, size === "day" ? delta : delta * 7)
                  )
                }
                onToday={() => setAnchor(today)}
                onSizeChange={setSize}
              />
            </div>
          ) : null}

          {/*
            The band's chrome — the full bleed, the Surface fill, the two
            hairlines and the `px-4` the controls take so the search box starts
            on the same pixel as the entry titles below it and the totals above
            it — was spelt out here, and only here. /reports drew this same
            `FilterControls` on bare ground because that spelling was not
            something a second page could render. It is `FilterBand` now, which
            is where that argument lives.
          */}
          <FilterBand>
            <FilterControls filters={filters} projects={projects} onChange={setFilters} />
          </FilterBand>
        </>
      }
    >
      <div className="flex-1">
        {/*
          The calendar is checked first and is its own whole branch: it reads
          a different query (bounded to the visible window) and paginates
          nothing, so neither the skeleton nor `FilteredLogStatus` — both of
          which describe the LIST's pagination — has anything to say while it
          is showing.

          Within the list, `status === "LoadingFirstPage"` is checked before
          the log, because `groups` reads as `[]` for the entire first round
          trip regardless of whether a filter is active — and an empty array
          used to fall straight into "nothing tracked yet", flashing the
          onboarding copy at a freelancer whose day is fully logged, for as
          long as that fetch took.

          Everything after that is ONE branch, not two: `EntryLog` is always
          rendered and only its `empty` slot changes. A filter that matches
          nothing here does not mean nothing is tracked, so the onboarding
          copy would be flatly false under an active search — but the answer
          is to draw nothing inside the log, not to take the log away. See the
          `empty` prop below for what removing it used to cost.
        */}
        {view === "calendar" ? (
          <div className="w-full px-4 pb-4">
            <CalendarPanel
              entries={calendarEntries}
              size={size}
              anchor={anchor}
              timeZone={settings.timezone}
              weekStartDay={settings.weekStartDay}
              use12Hour={settings.timeFormat === "12"}
              display={settings.durationDisplay}
              nowMs={nowMs}
              projectsById={projectsById}
              onEntryClick={(entryId) => {
                /*
                 * The calendar navigates; it does not edit.
                 *
                 * A block is a picture of an entry, and the editing controls
                 * for that entry already exist on its row — inline title, the
                 * time popover, the note sheet. Growing a second editor inside
                 * a popover on the grid would mean two places to fix the same
                 * mistyped field, which is how they come to disagree.
                 *
                 * So: switch to List, then focus the row. The switch has to
                 * happen first and the focus after paint, because the row is
                 * not mounted until List renders.
                 */
                setView("list")
                requestAnimationFrame(() => {
                  const row = document.querySelector<HTMLElement>(
                    `[data-entry-id="${entryId}"]`
                  )
                  row?.scrollIntoView({ block: "center" })
                  row?.focus()
                })
              }}
              onRangeChange={setCalendarRange}
            />
          </div>
        ) : status === "LoadingFirstPage" ? (
          <LogSkeleton />
        ) : (
          <>
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

            {/*
              A button, not scroll-triggered loading. Reports already works
              this way, the day headers are sticky and auto-loading fights
              them, and a control the user presses is one they can also choose
              not to press.
            */}
            <FilteredLogStatus
              filtering={filtering}
              matchCount={rowCount}
              status={status}
              onLoadMore={() => loadMore(PAGE_SIZE)}
            />
          </>
        )}
      </div>
    </Page>
  )
}

/**
 * The days the grid is actually showing, as the label needs them.
 *
 * BOTH ENDS, from one function, because they have to agree — computing the
 * first here and the last somewhere else is how a label comes to describe a
 * different span from the grid under it.
 *
 * The 5-day case is the one with a trap in it. That range is Monday to Friday
 * REGARDLESS of `weekStartDay`: it exists to hide the weekend, and the grid
 * achieves it with `hiddenDays={[0, 6]}`, which trims by day-of-week index
 * independently of where the week is set to start. So deriving its first day
 * from the user's own week start would, under `weekStartDay: 0`, label the
 * range from a Sunday while the grid opened on the Monday after it — the label
 * and the columns describing two different weeks, on a billing tool.
 */
function visibleDays(
  anchor: DayString,
  size: CalendarSize,
  weekStartDay: number
): { firstDay: DayString; lastDay: DayString } {
  if (size === "day") return { firstDay: anchor, lastDay: anchor }
  if (size === "5day") {
    const monday = weekStartOf(anchor, 1)
    return { firstDay: monday, lastDay: addDays(monday, 4) }
  }
  const first = weekStartOf(anchor, weekStartDay)
  return { firstDay: first, lastDay: addDays(first, 6) }
}
