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
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toast } from "@/components/ui/toast"
import { useClassifiers } from "@/hooks/use-classifiers"
import { useSecond } from "@/hooks/use-clock"
import { rangeTotal } from "@/lib/calendar-events"
import { groupByDay } from "@/lib/group-entries"
import { hasClientSideFilter, matches } from "@/lib/history-filters"
import { periodTotals } from "@/lib/period-totals"
import { cn } from "@/lib/utils"
import { addDays, dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import type { CalendarRange } from "@/lib/calendar-events"
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

  // Reached for rather than passed in, exactly as `EntryLog` does: this page
  // raises one toast of its own, for a calendar block whose row is not there
  // to focus. See `onEntryClick` below.
  const toasts = Toast.useToastManager()

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
  const [calendarRange, setCalendarRange] = useState<CalendarRange | null>(null)

  /*
   * The two instants ALONE, because they are the query's whole argument list.
   * `calendarRange` also carries the drawn days, and `listRange`'s validator
   * takes `fromMs`/`toMs` and nothing else — spreading the range straight in
   * would send a third field the backend rejects. `calendarRange` is only ever
   * replaced by `onRangeChange`, so this memo is referentially stable between
   * renders and the subscription is not rebuilt on every tick.
   */
  const calendarArgs = useMemo(
    () =>
      calendarRange === null
        ? { fromMs: 0, toMs: 0 }
        : { fromMs: calendarRange.fromMs, toMs: calendarRange.toMs },
    [calendarRange]
  )

  const calendarQuery = useQuery({
    ...convexQuery(api.entries.listRange, calendarArgs),
    enabled: view === "calendar" && calendarRange !== null,
    /*
     * The convention `reports.tsx` sets, for the same reason it sets it: the
     * range is part of the query key, so every arrow click mints a key with
     * nothing cached for it. Without this the grid blanks and "Range total"
     * drops to 0:00:00 for the length of the round trip — a zero that reads as
     * "nothing tracked that week".
     *
     * What that buys has to be paid for honestly, and `isPlaceholderData` is
     * the payment: while it is true the total belongs to the PREVIOUS range
     * and the label above it already names the new one, which is precisely the
     * defect `visibleDaysOf` below exists to prevent. It is handed to
     * `CalendarHeader` as `isStale`, which dims it and says "Updating…".
     */
    placeholderData: (previous) => previous,
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
    if (!filtering) return rows
    return rows.filter((entry) => matches(entry, filters, nameOf))
  }, [calendarQuery.data, filtering, filters, nameOf])

  /*
   * The days the header labels, taken from the range the GRID reported.
   *
   * `null` until the first `datesSet` — see the branch that renders
   * `CalendarHeader` for what is drawn in that gap and why it is not a
   * computed fallback.
   */
  const calendarDays = useMemo(
    () =>
      calendarRange === null
        ? null
        : visibleDaysOf(calendarRange, settings.timezone),
    [calendarRange, settings.timezone]
  )

  /*
   * The RANGE's total, for the calendar's own header — never for `TotalsRow`,
   * which stays on today and this week.
   *
   * SUMMED OVER THE DRAWN COLUMNS, not over every key `dayTotals` produced.
   * `CalendarPanel` looks that same map up once per column, so summing its
   * values instead counted days that have no column — the two sets coincide
   * only while the query range and the columns are the same days, which is
   * precisely the assumption the 5-day view broke. Measured before the fix, with
   * `weekStartDay: 2` and a two-hour entry on Saturday: `Range total 2:00:00`
   * above five columns showing nothing, on a tool people invoice from. It is the
   * same defect class as a header total belonging to a range other than the one
   * drawn, which this branch has already shipped once.
   *
   * So the number under the arrows is the sum of the numbers in the column
   * headers BY CONSTRUCTION rather than by coincidence: same map, same keys.
   */
  const calendarTotalMs = useMemo(
    () =>
      calendarRange === null
        ? 0
        : rangeTotal(
            calendarEntries,
            settings.timezone,
            nowMs,
            calendarRange.days
          ),
    [calendarEntries, calendarRange, settings.timezone, nowMs]
  )

  /*
   * WHY THE GRID IS BLANK, for the two cases that are not an error.
   *
   * `calendarQuery.isError` already argues this at length: an empty grid and a
   * `0:00:00` range total are "indistinguishable from a week nobody tracked
   * anything in, on a product whose stated principle is never to lose time".
   * That argument was applied to one branch of three. Two others reach exactly
   * the same blank grid and said nothing at all:
   *
   *   - an EMPTY RANGE, which the plan promises "one quiet line of copy" for;
   *   - a FILTER THAT MATCHED NOTHING, which in List is the whole subject of
   *     `FilteredLogStatus` — it goes as far as distinguishing "no matches" from
   *     "no matches yet" — and which the calendar branch does not render at all,
   *     because that component describes the LIST's pagination. So a project
   *     filter matching nothing gave a blank grid and `Range total 0:00:00` with
   *     nothing on screen saying a filter was responsible. That is the
   *     cross-view asymmetry the "one filter, both views" decision exists to
   *     close.
   *
   * TWO SENTENCES, NOT ONE. "Nothing was tracked" and "nothing matched" are
   * different claims and only one of them is true at a time — the same
   * distinction `FilteredLogStatus` draws, for the same reason.
   *
   * `null` while the answer is not known: `data` is `undefined` before the first
   * range has resolved, and while a step is in flight `placeholderData` holds
   * the previous range's rows, so neither state can flash a claim about a range
   * nobody has answered for yet. The error branch owns its own case.
   */
  const calendarNotice =
    calendarQuery.isError || calendarQuery.data === undefined
      ? null
      : calendarEntries.length > 0
        ? null
        : filtering
          ? "No entries in this range match these filters."
          : "Nothing was tracked in this range."

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

  /**
   * A block on the grid, clicked.
   *
   * The calendar navigates; it does not edit. A block is a picture of an entry,
   * and the editing controls for that entry already exist on its row — inline
   * title, the time popover, the note sheet. Growing a second editor inside a
   * popover on the grid would mean two places to fix the same mistyped field,
   * which is how they come to disagree. So: switch to List, then focus the row.
   * The switch has to happen first and the focus after paint, because the row
   * is not mounted until List renders.
   *
   * IT SWITCHES ONLY WHEN THERE IS A ROW TO SWITCH TO. Two kinds of block on
   * this grid have no row behind them, and both are one click away:
   *
   *   - the RUNNING entry, which the grid draws deliberately and `groupByDay`
   *     deliberately keeps out of its rows (it is already on screen, live and
   *     larger, in the timer bar);
   *   - anything OUTSIDE the loaded pages — the list paginates 50 at a time,
   *     newest first, while the grid steps to any week in history;
   *   - anything dated AFTER TODAY. `logRange.toMs` is pinned to the end of
   *     today so a clock-skewed entry cannot sit permanently on top of the log,
   *     while the calendar's range routinely includes the rest of the current
   *     week — so a Friday entry is drawn on Wednesday's grid and is outside
   *     the list's range by construction, not merely unpaginated.
   *
   * Switching anyway flipped the view to a log of recent rows and focused
   * nothing, which is worse than a no-op: the week the user was reading is gone
   * and nothing says why. So the miss is REPORTED instead, in the same toast
   * vocabulary the rest of the page answers with, and the grid stays put.
   *
   * THE THREE MESSAGES SAY THREE DIFFERENT TRUE THINGS. Telling someone to press
   * "Load earlier entries" to reach a future entry is advice that cannot work —
   * loading earlier only ever walks backwards. The reachable way to get a future
   * date is the `+` dialog's Day field, an unbounded `<input type="date">` where
   * a mistyped month lands an entry months out, and noticing that is exactly
   * what a calendar is good for.
   *
   * `groups` decides, not `results`: `groups` is what the list actually draws,
   * and the running entry is in one and not the other.
   */
  const onEntryClick = useCallback(
    (entryId: string) => {
      const row = groups
        .flatMap((group) => group.entries)
        .find((entry) => entry._id === entryId)

      if (row === undefined) {
        const clicked = calendarEntries.find((e) => e._id === entryId)
        const title = (clicked?.title ?? "").trim()
        const label = title === "" ? "That entry" : `“${title}”`
        // `toMs` is exclusive — the midnight that ends today — so anything at or
        // past it starts on a later day than the log will ever reach.
        const future =
          clicked !== undefined && clicked.startedAt >= logRange.toMs
        toasts.add({
          title:
            clicked?.endedAt === null
              ? `${label} is still running, so the log has no row for it — it is in the timer bar above.`
              : future
                ? `${label} starts after today, and the log ends with today — so there is no row for it. A day typed wrong in the add-entry dialog is what that usually is.`
                : `${label} has not been loaded into the list yet. Use “Load earlier entries” at the foot of the list to reach it.`,
        })
        return
      }

      setView("list")
      requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(
          `[data-entry-id="${entryId}"]`
        )
        element?.scrollIntoView({ block: "center" })
        element?.focus()
      })
    },
    [groups, calendarEntries, logRange.toMs, toasts]
  )

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

            NOTHING AT ALL BEFORE THE GRID HAS REPORTED, which is the whole of
            the answer to "what about the first render". Until `datesSet` fires
            there is no range, and therefore no honest label and no honest
            total — and the only other way to produce them is to compute the
            span here, which is exactly the bug this replaced: a second
            derivation that disagreed with the grid for 31 of the 49
            (weekStartDay × anchor) combinations. A bar that appears a commit
            late is a smaller cost than a bar that is confidently wrong.
            FullCalendar fires `datesSet` from its own mount effect, so in
            practice the gap is not painted.
          */}
          {view === "calendar" && calendarDays !== null ? (
            <div className="w-full px-4 pb-3">
              <CalendarHeader
                firstDay={calendarDays.firstDay}
                lastDay={calendarDays.lastDay}
                size={size}
                today={today}
                rangeMs={calendarTotalMs}
                display={settings.durationDisplay}
                isStale={calendarQuery.isPlaceholderData}
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
          /*
            MARGINS, NOT `gap`. The quiet region below is always mounted and is
            usually empty; an empty block element generates no line box, but a
            `gap` between flex items does not care whether either of them drew
            anything, so a `gap-3` here left 12px of dead space under the grid's
            ordinary state. `FilteredLogStatus` makes its padding conditional
            for exactly this reason.
          */
          <div className="flex w-full flex-col px-4 pb-4">
            {/*
              A FAILED RANGE QUERY IS NOT AN EMPTY WEEK.

              Without this the grid simply draws seven empty columns and a
              0:00:00 range total — indistinguishable from a week nobody
              tracked anything in, on a product whose stated principle is never
              to lose time. `role="alert"` because it appears in place of an
              answer the user just asked for, and the retry is here rather than
              in a step-away-and-back gesture because that gesture also changes
              the range, which is not what they wanted.
            */}
            {calendarQuery.isError ? (
              <p
                role="alert"
                className={cn(
                  "mb-3 flex flex-wrap items-center gap-3 rounded-md",
                  "border border-alarm px-3 py-2 text-sm text-alarm"
                )}
              >
                This range could not be loaded, so the grid below is empty for
                that reason and not because nothing was tracked.
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void calendarQuery.refetch()}
                >
                  Try again
                </Button>
              </p>
            ) : null}

            {/*
              ALWAYS MOUNTED, and only its text changes — the discipline
              `filtered-log-status.tsx` spells out. A live region inserted into
              the DOM already holding its text is not reliably announced;
              NVDA, JAWS and VoiceOver all watch a region they already know
              about for CHANGES. Typing a filter that empties the grid has to
              say so, and this is the element that can.
            */}
            <p
              aria-live="polite"
              className={cn(
                "text-sm text-muted-foreground",
                calendarNotice !== null && "mb-3"
              )}
            >
              {calendarNotice}
            </p>

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
              onEntryClick={onEntryClick}
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
 * The days the grid is showing, read off the range the grid itself reported.
 *
 * THE ONE SOURCE IS `datesSet`. This used to be computed from the anchor, the
 * size and `weekStartDay`, on the claim that `hiddenDays={[0, 6]}` "trims by
 * day-of-week index independently of where the week is set to start". That
 * claim is false: FullCalendar builds the week from `firstDay` and then
 * `trimHiddenDays` removes hidden days only from the ENDS of it. Measured over
 * all seven anchors × all seven `weekStartDay` values, 31 of the 49
 * combinations disagreed with the columns on screen — including every Sunday
 * anchor under a Sunday week start, where the label named the week before the
 * one being drawn. Worse than a wrong label: "Range total" beside it is summed
 * from the grid's real range, so the header could read `10–14 Aug` above a
 * total belonging to `17–21 Aug`, on a billing tool.
 *
 * There is deliberately no fallback for "the grid has not reported yet". A
 * fallback here is the second derivation, and the second derivation is the bug.
 *
 * `toMs` is EXCLUSIVE — the midnight that opens the day after the last visible
 * one — so the last day is the one holding the millisecond before it. Both ends
 * go through `dayOf`, the same function the grid's own column headers use.
 */
export function visibleDaysOf(
  range: { fromMs: number; toMs: number },
  timeZone: string
): { firstDay: DayString; lastDay: DayString } {
  return {
    firstDay: dayOf(range.fromMs, timeZone),
    lastDay: dayOf(range.toMs - 1, timeZone),
  }
}
