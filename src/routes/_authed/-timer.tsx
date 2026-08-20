/*
 * /timer — THE PAGE, NOT THE ROUTE. The route definition and its loader stay
 * in timer.tsx; the `-` prefix keeps this file out of the route tree, the same
 * convention the tests beside it already use.
 *
 * The component lives here because it has to be EXPORTED — -timer.test.tsx
 * renders it against a seeded query client — and an export of a route file is
 * something the router's code-splitter refuses to split: every page shipped in
 * the eager bundle, with a [tanstack-router] warning per route saying so.
 * Imported from a non-route file, `component:` splits as normal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery, useConvexMutation } from "@convex-dev/react-query"
import { usePaginatedQuery } from "convex/react"
import { WrapText } from "lucide-react"
import { CalendarPanel, NO_MEETINGS } from "@/components/calendar/calendar-panel"
import { EntryLog } from "@/components/entries/entry-log"
import { LogSkeleton } from "@/components/entries/day-list"
import { FilteredLogStatus } from "@/components/entries/filtered-log-status"
import { TotalsRow } from "@/components/entries/totals-row"
import { FilterBand } from "@/components/history/filter-band"
import { RangeBar } from "@/components/timer/range-bar"
import { Page } from "@/components/shell/page"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toast } from "@/components/ui/toast"
import { useClassifiers } from "@/hooks/use-classifiers"
import { useSecond } from "@/hooks/use-clock"
import { useEntryActions } from "@/hooks/use-entry-actions"
import { useLatest } from "@/hooks/use-latest"
import { boundsOf, dayTotals, rangeOf, totalOverDays } from "@/lib/calendar-events"
import { errorMessage } from "@/lib/error-message"
import { groupByDay } from "@/lib/group-entries"
import { periodTotals } from "@/lib/period-totals"
import {
  calendarSnap,
  instantsOf,
  presetRange,
  presetSize,
  stepRange,
} from "@/lib/timer-range"
import {
  readStoredNotes,
  readStoredView,
  writeStoredNotes,
  writeStoredView,
} from "@/lib/timer-view"
import { cn } from "@/lib/utils"
import { dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"

import type { CalendarSize } from "@/lib/calendar-label"
import type { DayRange, TimerPreset, TimerRange } from "@/lib/timer-range"
import type { TimerView } from "@/lib/timer-view"

const PAGE_SIZE = 50

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
   * WHAT AN ENTRY MAY HAVE DONE TO IT ON THIS PAGE — reached for once, here,
   * and handed to both surfaces that write.
   *
   * ONE INSTANCE, which is the point. `EntryLog` used to call the hook itself,
   * so in List view — the default — two full sets of
   * `useConvexMutation(...).withOptimisticUpdate(...)` closures existed and one
   * of them was never read, rebuilt on every tick of the clock above. The
   * hook's stated goal is one place where an entry changes; this is what makes
   * that literally true for this page.
   *
   * Both take it as a prop for the reason `EntryRow` does: they stay renderable
   * against fixtures with no backend anywhere near them.
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
   * A FOURTH, AND IT IS ABOUT READING RATHER THAN SELECTING.
   *
   * The three above answer "which entries"; this one answers "how much of an
   * entry do I get to see". `false` is the log this page has always drawn — a
   * note clipped to one line, so a day is scannable — and `true` writes every
   * note out in full at body size.
   *
   * It exists because the log is doing two jobs. Most of the day it is a table
   * you glance at. At a standup, or writing up an invoice, it is the record of
   * what happened, and a note ellipsed at the width of a column is the one
   * thing on this page you cannot read. That used to mean opening each note's
   * sheet in turn, or leaving for /reports — a whole page away from the timer
   * that is still running.
   */
  const [notesExpanded, setNotesExpanded] = useState(false)

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
    // Both preferences in the one pass, because both are read from the same
    // unavailable-on-the-server object and a second effect would be a second
    // place for that argument to be got wrong.
    const storedNotes = readStoredNotes()
    if (storedNotes !== null) setNotesExpanded(storedNotes)
  }, [])

  const changeView = useCallback((next: TimerView) => {
    setView(next)
    // Written here rather than in an effect on `view`: an effect would also
    // fire for the adoption above and write back the value it had just read.
    writeStoredView(next)
  }, [])

  /* Remembered for the same reason the view is, and a stronger one: this is a
   * mode the reader stays in for the length of a standup, and a preference that
   * resets on reload is one they have to set again every morning. */
  const changeNotes = useCallback((next: boolean) => {
    setNotesExpanded(next)
    writeStoredNotes(next)
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
     * The convention `-reports.tsx` sets, for the same reason it sets it: the
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
   * Google meetings for the drawn range, read-only ghost blocks on the grid.
   *
   * `rangeArgs` — NOT `plan.range` or a second `rangeOf` call — because that is
   * the exact pair of instants `rangeQuery` above is keyed on. Two computations
   * of "the same" range is precisely the defect `rangeArgs`'s own comment warns
   * about (`calendar-range-label.test.tsx`); sharing the variable is what keeps
   * the grid from ever drawing meetings for one week and entries for another.
   *
   * NOT keyed on `nowMs`: a meeting's window is stored, so nothing here moves
   * with the clock, and including it would refetch once a second for the life
   * of the tab on a page this product calls an always-open companion.
   *
   * Not gated by `rangeEnabled` and not a suspense query: the grid is useful
   * the instant the entries arrive, so this stays a plain fallback rather than
   * a second thing the page waits on. An unconnected account's `listMeetings`
   * always answers `[]`, so nothing here changes what that account sees.
   */
  const meetingsQuery = useQuery(convexQuery(api.google.listMeetings, rangeArgs))

  /*
   * THE TWO WRITES A MEETING BLOCK CAN MAKE, held here rather than in the panel
   * — `eslint.config.js` forbids `useConvexMutation` under `src/components` and
   * says why: a component that reaches for its own writes cannot be rendered
   * against fixtures, and the design harnesses depend on being able to.
   *
   * `useLatest`-wrapped for a stable identity, the same wrapping every mutation
   * on /settings carries: the handlers below are inline props on a component
   * that re-renders once a second, and a fresh closure per tick is a fresh
   * `eventContent` per tick for every block on the grid.
   */
  const setTrack = useLatest(useConvexMutation(api.googleTrack.setTrackOnStart))
  const trackNow = useLatest(useConvexMutation(api.googleTrack.trackNow))

  /*
   * A FAILED TICK HAS TO SAY SO. There is no optimistic update behind these:
   * the checkbox is drawn from `trackOnStart` on the mirrored row, so a write
   * that throws leaves the box exactly where it was and the only evidence the
   * user gets is this line. /settings raises its Google failures the same way,
   * through the same two functions.
   */
  const toasts = Toast.useToastManager()
  const reportWrite = useLatest((thrown: unknown) => {
    toasts.add({ title: errorMessage(thrown), priority: "high" })
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
   * THE CLOCK, ADMITTED ONLY WHEN SOMETHING IS ACTUALLY RUNNING.
   *
   * `nowMs` advances once a second for the life of the tab, and the map below
   * takes it — so without this it rebuilt every second, forever, on a page this
   * product describes as an always-open desktop companion. `dayTotals` calls
   * `dayOf` once per entry, and `dayOf` is an
   * `Intl.DateTimeFormat.formatToParts()` plus a handful of array scans
   * (`convex/lib/day.ts`), so the cost is `n` zone lookups a second whether or
   * not a timer is running.
   *
   * But `nowMs` only ever REACHES the output through a running entry: it is
   * what `dayTotals` counts an unfinished entry's elapsed time to. With nothing
   * running — every past week, and the current one whenever the timer is
   * stopped, which is the ordinary case — each tick rebuilt a map
   * byte-identical to the one before it.
   *
   * So the clock is pinned to `0` unless an entry in view has no end. Pinning
   * rather than dropping it from the dependency list: a deliberately incomplete
   * dependency array is a stale closure waiting for the next reader to trip
   * over, whereas passing a value that provably cannot be read keeps the memo
   * honest and the lint rule satisfied. `0` is never observable — the only code
   * that would read it is the `entry.endedAt ?? nowMs` branch that this flag
   * says nothing takes.
   *
   * The `some` scan is O(n) over one boolean per render and touches no `Intl`,
   * which is the whole cost this replaces `n` day-lookups per second with.
   *
   * THIS GUARD USED TO LIVE IN `CalendarPanel` AND WAS DEFEATED FROM HERE. The
   * panel guarded its own copy of the map correctly; this page then built the
   * SAME map from the SAME array against the raw `nowMs`, once a second, for
   * the range total. Two passes per tick, one of them unguarded. The map is
   * built once here now and handed down, so there is one computation and one
   * guard over it.
   */
  const calendarClockMs = calendarEntries.some((entry) => entry.endedAt === null)
    ? nowMs
    : 0

  const calendarTotals = useMemo(
    () => dayTotals(calendarEntries, settings.timezone, calendarClockMs),
    [calendarEntries, settings.timezone, calendarClockMs]
  )

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
    () => totalOverDays(calendarTotals, plan.range.days),
    [calendarTotals, plan.range.days]
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
            THE CONTROLS COME FIRST, directly under the timer bar.

            This row and the totals below it were the other way round until
            2026-08-12, and the swap is worth the note. A page's header should
            open with what the reader ACTS on, not with what it reports: the
            range and the view switcher decide what the rest of the page is
            showing, while the totals are a readout OF it. Under the old order
            the first thing beneath the timer bar was three numbers, and the
            controls that governed everything below sat in the gap between them
            and the grid, belonging to neither.

            It also puts the two clocks as far apart as the header allows. The
            timer bar's running duration and `TotalsRow`'s "Today" are different
            questions — this session versus the whole day — and stacked
            immediately against each other they read as one number restated.

            The range bar sticks with the rest of the header, because it is a
            control over what scrolls beneath it, which is Page's stated test
            for this slot. It is inside the measured element, so `Page` accounts
            for its height without this file measuring anything.

            ON SCREEN IN BOTH VIEWS, which is the change this bar was reshaped
            for. It used to appear only with the grid, because only the grid
            had a range; the range bounds the LIST now too, so a control that
            came and went with the tab would be a filter silently dropped.
          */}
          <div className="flex w-full flex-wrap items-center gap-3 px-4 pt-3 pb-3">
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
              FULL NOTES — the log's second job, given a switch.

              IN LIST ONLY, and it is not a control that could sensibly be
              greyed out instead: the grid draws blocks, not rows, and has no
              note line to unclip. A toggle that stayed on screen governing
              nothing visible would be the range bar's opposite — that one
              stays in both views precisely BECAUSE it still bounds what is
              drawn.

              A TOGGLE, spelt `aria-pressed`, and not a third tab. Calendar and
              List are alternative views of the same entries; this changes
              nothing about WHICH entries are on screen, only how much of each
              one is legible, so it must not join the group that decides the
              former. `aria-pressed` is also what makes the state audible: the
              label is deliberately the same in both directions, because a
              button whose name changes when you press it announces the state
              you just left.

              Beside the tabs rather than out at the left margin: it belongs to
              the list, and the list is what the control next to it selects.
            */}
            {view === "list" ? (
              <Button
                variant="outline"
                aria-pressed={notesExpanded}
                onClick={() => changeNotes(!notesExpanded)}
                className={cn(
                  // The fill the segmented tab beside it uses for "on", so two
                  // adjacent controls do not spell the same state two ways.
                  "shrink-0 aria-pressed:border-edge-raised",
                  "aria-pressed:bg-surface-raised aria-pressed:text-foreground"
                )}
              >
                <WrapText className="size-4" />
                Full notes
              </Button>
            ) : null}

            {/*
              TABS, NOT TWO ROUTES — -reports.tsx settled this argument for
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

          {/*
            THE TOTALS, in the band the filter bar used to have.

            `FilterBand` is the shape, not a coincidence: a full-bleed strip of
            Surface between two hairlines is how this product marks the boundary
            between the page's chrome and the rows it is about — a day header
            does the same. The filter bar was removed from this page, and the
            band it left is exactly what the totals wanted, because they are the
            LAST thing before the log and they summarise it.

            "+ Add entry" used to sit beside these numbers, and the comment this
            replaces argued for it: the totals are what prompt "I forgot to
            start the timer", so the control belonged next to them. That was
            right while the button lived on this page — and the button living on
            this page was the problem. Noticing a forgotten block happens on
            /reports at least as often, and the control was not there. It is a
            `+` beside Play in the timer bar now, which sits in the shell above
            the outlet and is therefore on every page: the same argument about
            adjacency, applied to the control it is actually adjacent to.

            `className` carries no `py-3` here — `FilterBand` supplies the
            band's own vertical rhythm, and adding a second one would make this
            strip taller than the identical band on /reports.
          */}
          <FilterBand>
            <TotalsRow
              todayMs={totals.todayMs}
              weekMs={totals.weekMs}
              billableMs={totals.billableMs}
              display={settings.durationDisplay}
            />
          </FilterBand>
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
              meetings={meetingsQuery.data ?? NO_MEETINGS}
              range={plan.range}
              timeZone={settings.timezone}
              weekStartDay={settings.weekStartDay}
              use12Hour={settings.timeFormat === "12"}
              display={settings.durationDisplay}
              nowMs={nowMs}
              // Built above, behind the running-entry guard, and summed there
              // for "Range total" as well — so the columns and the figure over
              // them are one pass over one array rather than two that agree by
              // coincidence.
              dayTotals={calendarTotals}
              projects={projects}
              projectsById={projectsById}
              tags={tags}
              actions={entryActions}
              onSetTrack={(calendarId, eventId, track) => {
                void setTrack({ calendarId, eventId, track }).catch(reportWrite)
              }}
              onTrackNow={(calendarId, eventId) => {
                void trackNow({ calendarId, eventId }).catch(reportWrite)
              }}
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
              // The same instance the grid's popover is handed above — one set
              // of mutation closures for this page, not one per surface.
              actions={entryActions}
              timeZone={settings.timezone}
              use12Hour={settings.timeFormat === "12"}
              weekStartDay={settings.weekStartDay}
              display={settings.durationDisplay}
              // Set in the header above, remembered between visits, and handed
              // straight through to every row — see `entry-row.tsx` for what a
              // row does with it.
              notesExpanded={notesExpanded}
              grouped={settings.groupEntries}
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
