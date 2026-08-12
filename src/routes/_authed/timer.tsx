import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { usePaginatedQuery } from "convex/react"
import { CalendarPanel } from "@/components/calendar/calendar-panel"
import { EntryLog } from "@/components/entries/entry-log"
import { LogSkeleton } from "@/components/entries/day-list"
import { FilteredLogStatus } from "@/components/entries/filtered-log-status"
import { TotalsRow } from "@/components/entries/totals-row"
import { RangeBar } from "@/components/timer/range-bar"
import { Page } from "@/components/shell/page"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useClassifiers } from "@/hooks/use-classifiers"
import { useSecond } from "@/hooks/use-clock"
import { useEntryActions } from "@/hooks/use-entry-actions"
import { boundsOf, rangeOf, rangeTotal } from "@/lib/calendar-events"
import { groupByDay } from "@/lib/group-entries"
import { periodTotals } from "@/lib/period-totals"
import {
  calendarSnap,
  instantsOf,
  presetRange,
  presetSize,
  stepRange,
} from "@/lib/timer-range"
import { readStoredView, writeStoredView } from "@/lib/timer-view"
import { cn } from "@/lib/utils"
import { dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"

import type { CalendarSize } from "@/lib/calendar-label"
import type { DayRange, TimerPreset, TimerRange } from "@/lib/timer-range"
import type { TimerView } from "@/lib/timer-view"

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

  const { projects, tags, projectsById } = useClassifiers()

  /*
   * WHAT A BLOCK'S POPOVER MAY DO, reached for here and handed down.
   *
   * The same hook `EntryLog` uses, so the grid's editor and the log's rows
   * write through one implementation of every edit — one undo window, one
   * error posture, one sentence per event. The panel takes it as a prop for
   * the reason `EntryRow` does: it stays renderable against fixtures.
   */
  const entryActions = useEntryActions(settings.timezone)

  /*
   * THE THREE PIECES OF STATE, and nothing derived stored beside them.
   *
   * `range` is the SELECTION — what the user asked to see — and `null` is "All
   * dates", the default and the behaviour /timer has always had: the whole log,
   * paginated newest first. It is not a very wide range, because it selects a
   * different query (see `listRows` below), and a user who never touches the
   * control must get exactly what this page did before it existed.
   *
   * `size` is the calendar's column width, which is also the distance its
   * arrows step. `view` is which of the two is on screen.
   *
   * `useState`, not the URL — /reports does not put its period in the URL
   * either, and one page inventing a second convention for the same kind of
   * state is how the two come to disagree.
   */
  const [view, setView] = useState<TimerView>("list")
  const [size, setSize] = useState<CalendarSize>("week")
  const [range, setRange] = useState<TimerRange>(null)

  /*
   * THE STORED VIEW, ADOPTED AFTER THE FIRST PAINT.
   *
   * Not in the `useState` initializer above: this app server-renders, and
   * `localStorage` does not exist on the server — so reading it during render
   * makes the server's HTML and the browser's first render disagree, which is
   * a hydration mismatch rather than a preference. `src/lib/timer-view.ts` has
   * the long version, including why the sidebar's cookie could not be swapped
   * for this and this could not be swapped for a cookie.
   *
   * The ref, and not an empty dependency array with a lint suppression: this
   * must run once for the life of the component, and saying so with a flag is
   * honest where a lie about the dependencies is not.
   */
  const adopted = useRef(false)
  useEffect(() => {
    if (adopted.current) return
    adopted.current = true
    const stored = readStoredView()
    if (stored !== null) setView(stored)
  }, [])

  const changeView = useCallback((next: TimerView) => {
    setView(next)
    // Written here rather than in an effect on `view`: an effect would also
    // fire for the adoption above and write back the value it had just read.
    writeStoredView(next)
  }, [])

  /*
   * THE WINDOW THE GRID DRAWS, COMPUTED HERE AND HANDED DOWN.
   *
   * This used to run the other way: the grid decided its own span from
   * `firstDay` and `hiddenDays`, reported it back through `datesSet`, and the
   * page labelled and queried whatever arrived. `rangeOf` is the answer now,
   * and it is the ONLY one — the grid is told to draw it (`visibleRange`), the
   * pill names it, the query fetches it, and "Range total" sums its days. A
   * second derivation anywhere is the defect that cost this feature two review
   * cycles; see `calendar-range-label.test.tsx`.
   *
   * `calendarSnap` is what stands between a selection and a grid that cannot
   * draw it. A selection wider than a week — "Last 30 days", "All dates", any
   * custom span — resolves to the week containing its start, because a time
   * grid is a picture of a day at 48px an hour and thirty columns of that is
   * not a smaller version of the same thing.
   *
   * DERIVED, NOT COPIED INTO STATE. Switching to Calendar and back therefore
   * cannot lose the selection the List was showing: the snap is what the grid
   * is looking at, not an edit to what the user asked for. Only the controls
   * that genuinely navigate — the arrows, the presets, the size select — write
   * `range` back.
   */
  const plan = useMemo(
    () =>
      calendarSnap(
        range,
        size,
        today,
        settings.weekStartDay,
        settings.timezone
      ),
    [range, size, today, settings.weekStartDay, settings.timezone]
  )

  /** The two ends the bar shows: the grid's window in Calendar, the selection
   *  itself in List — so the pill can never name a span other than the one on
   *  screen. */
  const shownRange: TimerRange = view === "calendar" ? boundsOf(plan.range) : range

  const step = useCallback(
    (delta: -1 | 1) => {
      if (shownRange === null) return
      // In Calendar the stride belongs to the SIZE (5 columns step a whole
      // week, because the weekend between them is hidden rather than absent);
      // in List there is no grid, and a range steps by its own span.
      setRange(stepRange(shownRange, view === "calendar" ? plan.size : null, delta))
    },
    [shownRange, view, plan.size]
  )

  const applyPreset = useCallback(
    (preset: TimerPreset) => {
      // A preset sets WHERE and HOW WIDE together: "Today" on a grid means one
      // column, not this week with today somewhere inside it. The two List-only
      // presets have no width a grid could draw and leave `size` alone — the
      // snap above decides what the calendar makes of them.
      const width = presetSize(preset)
      if (width !== null) setSize(width)
      setRange(presetRange(preset, today, settings.weekStartDay))
    },
    [today, settings.weekStartDay]
  )

  const changeSize = useCallback(
    (next: CalendarSize) => {
      setSize(next)
      // Changing the columns BOUNDS the selection to what is now drawn, exactly
      // as an arrow click does. Without it a wide selection would keep
      // collapsing to a week and the select would spring back to "Week view"
      // the moment it was set to anything else.
      setRange(
        boundsOf(
          rangeOf(
            boundsOf(plan.range).from,
            next,
            settings.weekStartDay,
            settings.timezone
          )
        )
      )
    },
    [plan.range, settings.weekStartDay, settings.timezone]
  )

  /*
   * ONE QUERY, ONE RANGE, BOTH VIEWS.
   *
   * The grid and a bounded list are the same question — "every entry between
   * these two instants" — so they are the same subscription, and switching
   * between the views costs no round trip because the key does not change.
   *
   * The args are always a REAL range (the grid's, when the list is unbounded)
   * rather than a placeholder pair, so no key is minted for a query that is
   * switched off. `listRange`'s validator takes `fromMs`/`toMs` and nothing
   * else — spreading a `CalendarRange` straight in would send `days` too, which
   * the backend rejects — and the memo keeps the key referentially stable
   * between the once-a-second re-renders.
   */
  const rangeArgs = useMemo(
    () =>
      view === "list" && range !== null
        ? instantsOf(range, settings.timezone)
        : { fromMs: plan.range.fromMs, toMs: plan.range.toMs },
    [view, range, settings.timezone, plan.range]
  )

  const rangeEnabled = view === "calendar" || range !== null

  const rangeQuery = useQuery({
    ...convexQuery(api.entries.listRange, rangeArgs),
    enabled: rangeEnabled,
    /*
     * The convention `reports.tsx` sets, for the same reason it sets it: the
     * range is part of the query key, so every arrow click mints a key with
     * nothing cached for it. Without this the grid blanks and "Range total"
     * drops to 0:00:00 for the length of the round trip — a zero that reads as
     * "nothing tracked that week".
     *
     * What that buys has to be paid for honestly, and `isPlaceholderData` is
     * the payment: while it is true the total belongs to the PREVIOUS range
     * and the pill above it already names the new one. It is handed to
     * `RangeBar` as `isStale`, which dims it and says "Updating…".
     */
    placeholderData: (previous) => previous,
  })

  /*
   * The unbounded log, exactly as before: all the way back, 50 rows at a time.
   * `toMs` is the end of today rather than Infinity so a clock-skewed future
   * entry cannot sit permanently on top.
   *
   * `"skip"` once a range is selected. The bounded list reads `listRange`
   * instead — one query for one range, shared with the grid — so there is no
   * page left to fetch and no subscription worth holding open.
   */
  const logRange = useMemo(
    () => ({ fromMs: 0, toMs: dayWindow(today, settings.timezone).toMs }),
    [today, settings.timezone]
  )

  const { results, status, loadMore } = usePaginatedQuery(
    api.entries.listPage,
    range === null ? logRange : "skip",
    { initialNumItems: PAGE_SIZE }
  )

  /*
   * The rows the GRID draws.
   *
   * NOT `groupByDay`. That deliberately keeps a running entry out of its
   * `entries` (it is already on screen in the timer bar, larger and live), and
   * a view whose whole purpose is the shape of the day has to show what is
   * running — so the calendar takes the rows straight.
   *
   * Empty in List, so "Range total" cannot be computed from a list's rows over
   * a grid's columns while nobody is looking at either.
   */
  const calendarEntries = useMemo(
    () => (view === "calendar" ? (rangeQuery.data ?? []) : []),
    [view, rangeQuery.data]
  )

  /** The rows the LIST draws: the page it paginated, or the range it asked for. */
  const listRows = range === null ? results : (rangeQuery.data ?? [])

  /*
   * The RANGE's total, for the bar beside the grid — never for `TotalsRow`,
   * which stays on today and this week.
   *
   * SUMMED OVER THE DRAWN COLUMNS, not over every key `dayTotals` produced.
   * `CalendarPanel` looks that same map up once per column, so summing its
   * values instead counted days that have no column — the two sets coincide
   * only while the query range and the columns are the same days, which is
   * precisely the assumption the 5-day view broke. Measured before the fix,
   * with `weekStartDay: 2` and a two-hour entry on Saturday:
   * `Range total 2:00:00` above five columns showing nothing, on a tool people
   * invoice from.
   */
  const calendarTotalMs = useMemo(
    () =>
      rangeTotal(
        calendarEntries,
        settings.timezone,
        nowMs,
        plan.range.days
      ),
    [calendarEntries, plan.range.days, settings.timezone, nowMs]
  )

  /*
   * WHY THE GRID IS BLANK, for the case that is not an error.
   *
   * `rangeQuery.isError` already argues this at length: an empty grid and a
   * `0:00:00` range total are "indistinguishable from a week nobody tracked
   * anything in, on a product whose stated principle is never to lose time".
   * An EMPTY RANGE reaches exactly the same blank grid and used to say nothing
   * at all.
   *
   * `null` while the answer is not known: `data` is `undefined` before the
   * first range has resolved, and while a step is in flight `placeholderData`
   * holds the previous range's rows, so neither state can flash a claim about a
   * range nobody has answered for yet. The error branch owns its own case.
   */
  const calendarNotice =
    rangeQuery.isError || rangeQuery.data === undefined
      ? null
      : calendarEntries.length > 0
        ? null
        : "Nothing was tracked in this range."

  const groups = useMemo(
    () => groupByDay(listRows, settings.timezone, nowMs),
    [listRows, settings.timezone, nowMs]
  )

  /*
   * Rows, not groups. `groupByDay` keeps a running entry out of `entries` but
   * still opens a day for it (its elapsed time belongs in that day's total),
   * so a group count answers "how many days are on screen", not "how many
   * entries there are" — and those differ by exactly the entry the log
   * deliberately never draws.
   */
  const rowCount = groups.reduce((n, group) => n + group.entries.length, 0)

  const totals = periodTotals(weekEntries, settings.timezone, today, nowMs)

  /*
   * The skeleton's condition, for whichever source the list is reading.
   *
   * It is checked before the log because `groups` reads as `[]` for the whole
   * first round trip either way — and an empty array used to fall straight into
   * "nothing tracked yet", flashing the onboarding copy at a freelancer whose
   * day is fully logged, for as long as that fetch took.
   */
  const listPending =
    range === null
      ? status === "LoadingFirstPage"
      : rangeQuery.data === undefined && !rangeQuery.isError

  return (
    /*
      THE TOP OF THIS PAGE STAYS PUT — `sticky`, which `Page` defaults to false
      and which every caller has to argue. What the timer bar above it is for —
      the numbers you check and the range you set — is useless once it has
      scrolled past the log it describes, and this is the one page whose whole
      body is a scroll. Both halves of the header are readouts of, or controls
      over, exactly the rows underneath them, which is Page's stated test for
      pinning. `Page` owns how that is done and what the day headers below then
      stick to.

      `titleHidden`, and the heading is NEW. This page had no `<h1>` at all,
      which is a document-structure gap rather than a style: a screen reader's
      heading list is how a page is skimmed without sight, and this one offered
      nothing to skim. It stays out of SIGHT because the header directly beneath
      it already says what the page is, twice over — a week's totals and a range
      over a log — and a `text-sm` word "Timer" above them would push the
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

          </div>

          {/*
            The range bar sticks with the totals, because it is a control over
            what scrolls beneath it — Page's stated test for what belongs in
            this slot. It is inside the measured element, so `Page` accounts
            for its height without this file measuring anything.

            ON SCREEN IN BOTH VIEWS, which is the change this bar was reshaped
            for. It used to appear only with the grid, because only the grid
            had a range; the range bounds the LIST now too, so a control that
            came and went with the tab would be a filter silently dropped.
          */}
          <div className="flex w-full flex-wrap items-center gap-3 px-4 pb-3">
            {/* `flex-1 min-w-0` so the bar keeps its own internal `ml-auto` —
                the range total still pins to the right of the BAR — while the
                switcher sits beyond it rather than being pushed off the row. */}
            <div className="min-w-0 flex-1">
              <RangeBar
                view={view}
                range={shownRange}
                size={plan.size}
                today={today}
                weekStartDay={settings.weekStartDay}
                rangeMs={calendarTotalMs}
                display={settings.durationDisplay}
                isStale={rangeQuery.isPlaceholderData}
                onStep={step}
                onRangeChange={(picked: DayRange) => setRange(picked)}
                onPresetChange={applyPreset}
                onSizeChange={changeSize}
              />
            </div>

            {/*
              TABS, NOT TWO ROUTES — reports.tsx settled this argument for
              Summary and Detailed and it holds here for the same reason: the
              range bar beside it is ONE control governing both views. A
              freelancer narrows to a fortnight and then looks at the shape of
              it and at the rows behind the shape; a second page would mean
              setting the range twice and would let the two drift apart with
              nothing on screen to say so.

              ON THE RANGE BAR'S ROW, not up with the totals. The switcher and
              the range are the two halves of one question — WHICH entries, and
              HOW to look at them — so they read as one control strip. The
              totals above are neither: they are ambient facts about the clock
              and belong to no view, which is exactly why they must not sit in
              the same cluster as something that changes what is on screen.

              A SEGMENTED GROUP rather than the underline this used to draw.
              The two are alternative views of one thing rather than sections
              of a document, and a filled cell is what that reads as. Selection
              is not carried by colour alone — the fill is a fill, and Base UI
              puts `aria-selected` on the tab regardless. See ui/tabs.tsx for
              why `segmented` is its own variant and not the stock pill.
            */}
            <Tabs
              value={view}
              onValueChange={(next) => changeView(next as TimerView)}
            >
              <TabsList variant="segmented">
                <TabsTrigger value="calendar">Calendar</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </>
      }
    >
      <div className="flex-1">
        {/*
          The calendar is checked first and is its own whole branch: it
          paginates nothing, so neither the skeleton nor `FilteredLogStatus` —
          both of which describe the LIST's pagination — has anything to say
          while it is showing.

          Within the list, the loading state is checked before the log, because
          `groups` reads as `[]` for the entire first round trip — and an empty
          array used to fall straight into "nothing tracked yet", flashing the
          onboarding copy at a freelancer whose day is fully logged, for as long
          as that fetch took.
        */}
        {view === "calendar" ? (
          /*
            NO HEIGHT AT ALL: the grid draws the whole day and the page scrolls.

            Deliberately unconstrained, and it took three tries to get here. A
            `height={640}` inside the panel, then a
            `calc(100svh - var(--log-sticky-top))` cap here — both of them capped
            the grid to something smaller than a day and handed the remainder to
            an inner scrollbar, so most of the axis lived inside a box on a page
            that did not itself scroll. Two scroll contexts, and the wheel
            reached the wrong one first. The panel now asks FullCalendar for
            `height="auto"` and this element simply lets it be as tall as it is.

            NO GUTTER, deliberately, against DESIGN.md's usual `px-4`. That rule
            exists so entry titles, day headers, totals and the range bar all
            start on the same pixel — it is about a COLUMN OF TEXT lining up. A
            time grid is not text in a column; it is a measuring surface whose
            own first column is an hour rail that lines up with nothing above it.
            Inset by 16px it read as a card floating on the page, which is what
            DESIGN.md's flat, tonal-depth section rules out. Full-bleed it reads
            as a band of the page, and the wider columns are the point of a
            wider window.
          */
          <div className="flex w-full flex-col">
            {rangeQuery.isError ? <RangeError what="grid" onRetry={() => void rangeQuery.refetch()} /> : null}

            {/*
              ALWAYS MOUNTED, and only its text changes — the discipline
              `filtered-log-status.tsx` spells out. A live region inserted into
              the DOM already holding its text is not reliably announced;
              NVDA, JAWS and VoiceOver all watch a region they already know
              about for CHANGES. Stepping to a week with nothing in it has to
              say so, and this is the element that can.
            */}
            <p
              aria-live="polite"
              className={cn(
                // Its own `px-4`, for the same reason the alert above carries
                // `mx-4` — the grid is full-bleed and hands its children no
                // gutter, so a line of prose has to state its own.
                "px-4 text-sm text-muted-foreground",
                calendarNotice !== null && "mb-3"
              )}
            >
              {calendarNotice}
            </p>

            <CalendarPanel
              entries={calendarEntries}
              range={plan.range}
              timeZone={settings.timezone}
              weekStartDay={settings.weekStartDay}
              use12Hour={settings.timeFormat === "12"}
              display={settings.durationDisplay}
              nowMs={nowMs}
              projects={projects}
              projectsById={projectsById}
              tags={tags}
              actions={entryActions}
            />
          </div>
        ) : listPending ? (
          <LogSkeleton />
        ) : (
          /*
            ONE `EntryLog` ELEMENT FOR BOTH LIST MODES, deliberately.

            `EntryLog` owns `NoteSheet`, and `NoteSheet` owns `draftsRef` — the
            in-memory copy of a note whose save is still in flight or has
            failed. Two sibling branches each rendering their own `EntryLog`
            would put it at a different position in the tree per mode, so React
            would unmount one and mount the other, and every held draft would go
            with it. That is the regression `-timer.test.tsx` exists for, in a
            new spelling: it used to be a filter keystroke, it would now be a
            preset click. The conditional pieces are the alert above and the
            load-more below; the log itself stays put.
          */
          <>
            {rangeQuery.isError && range !== null ? (
              <RangeError what="list" onRetry={() => void rangeQuery.refetch()} />
            ) : null}

            <EntryLog
              groups={groups}
              timeZone={settings.timezone}
              use12Hour={settings.timeFormat === "12"}
              weekStartDay={settings.weekStartDay}
              display={settings.durationDisplay}
              /*
                NOT the onboarding copy, once a range is selected. "Nothing
                tracked yet" means a new account, and it is flatly false of a
                freelancer who has narrowed to a quiet fortnight — so the
                bounded list borrows the sentence the grid shows for the same
                range, and switching views does not change the claim. Unbounded,
                an empty log really does mean an empty account, which is
                `DayList`'s default and why this is `undefined` there.
              */
              empty={
                range === null ? undefined : (
                  <p className="px-4 py-4 text-sm text-muted-foreground">
                    Nothing was tracked in this range.
                  </p>
                )
              }
            />

            {/*
              A button, not scroll-triggered loading. Reports already works
              this way, the day headers are sticky and auto-loading fights
              them, and a control the user presses is one they can also choose
              not to press.

              GONE ENTIRELY once a range is selected: a bounded list reads
              `listRange`, which answers with the whole range at once, so there
              is nothing left to load and a button offering to load it would do
              nothing.

              `filtering` is permanently false now: /timer has no filter bar any
              more — the range replaced it, and a search over history belongs on
              /reports, which still has one. The prop stays because that page's
              log status is the same component with the same signature.
            */}
            {range === null ? (
              <FilteredLogStatus
                filtering={false}
                matchCount={rowCount}
                status={status}
                onLoadMore={() => loadMore(PAGE_SIZE)}
              />
            ) : null}
          </>
        )}
      </div>
    </Page>
  )
}

/**
 * A FAILED RANGE QUERY IS NOT AN EMPTY WEEK.
 *
 * Without this the grid simply draws seven empty columns and a 0:00:00 range
 * total — indistinguishable from a week nobody tracked anything in, on a
 * product whose stated principle is never to lose time. The bounded list has
 * exactly the same problem and reads the same query, so it says the same thing.
 *
 * `role="alert"` because it appears in place of an answer the user just asked
 * for, and the retry is here rather than in a step-away-and-back gesture
 * because that gesture also changes the range, which is not what they wanted.
 */
function RangeError({
  what,
  onRetry,
}: {
  what: "grid" | "list"
  onRetry: () => void
}) {
  return (
    <p
      role="alert"
      className={cn(
        // `mx-4`, not a parent gutter: the grid below is full-bleed, so this
        // element carries its own alignment with the bar above rather than
        // inheriting one.
        "mx-4 mb-3 flex flex-wrap items-center gap-3 rounded-md",
        "border border-alarm px-3 py-2 text-sm text-alarm"
      )}
    >
      This range could not be loaded, so the {what} below is empty for that
      reason and not because nothing was tracked.
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </p>
  )
}
