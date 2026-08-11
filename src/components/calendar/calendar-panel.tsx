import { useEffect, useMemo, useRef } from "react"
import Calendar, { useCalendarController } from "@fullcalendar/react"
import timeGridPlugin from "@fullcalendar/react/timegrid"
import { ProjectDot } from "@/components/classifiers/project-dot"
import {
  calendarEvents,
  dayTotals,
  earliestHour,
} from "@/lib/calendar-events"
import { formatTimeOfInstant, formatTimeRange } from "@/lib/format-time"
import { formatTotal } from "@/lib/format-total"
import { cn } from "@/lib/utils"
import { dayOf } from "@shared/day"
import { formatClock } from "@shared/duration"
import type { CalendarEventProps } from "@/lib/calendar-events"
import type { CalendarSize } from "@/lib/calendar-label"
import type { DurationDisplay } from "@/lib/format-total"
import type { DayString } from "@shared/day"
import type { EventApi } from "@fullcalendar/react"
import type { Doc } from "../../../convex/_generated/dataModel"

// Structure only. No theme is imported: every visible surface here is set
// through v7's class-name props, so DESIGN.md's rules are our own Tailwind
// classes rather than overrides fighting a vendored stylesheet — which is the
// failure DESIGN.md §5 records from recharts.
import "@fullcalendar/react/skeleton.css"

const PLUGINS = [timeGridPlugin]

/*
 * The two hidden-day sets, hoisted to module scope.
 *
 * NOT an inline `size === "5day" ? [0, 6] : []`. `hiddenDays` is refined by
 * `identity` and is absent from FullCalendar's `COMPLEX_OPTION_COMPARATORS`, so
 * it is compared by REFERENCE: a fresh array rebuilds the dateProfileGenerator,
 * which rebuilds the dateProfile, which re-fires `datesSet` and calls
 * `resetScroll()`. `nowMs` ticks every second, so an inline array snapped the
 * grid back to `scrollTime` about once a second and made it unscrollable.
 *
 * With the controller below wired up it is worse than a nuisance: the
 * `datesSet` it provokes re-renders this component, which allocates another new
 * array, which rebuilds the dateProfile again — an unbounded loop that React
 * ends with "Maximum update depth exceeded". `calendar-panel.test.tsx`'s
 * re-render test is what holds this shut.
 */
const NO_HIDDEN_DAYS: Array<number> = []
/** `[0, 6]` hides Saturday and Sunday whatever `firstDay` is, which is exactly
 *  "Monday to Friday regardless of weekStartDay". A 5-day range therefore also
 *  steps by a whole week for free, because it IS the week. */
const WEEKEND_HIDDEN = [0, 6]

/** 48px an hour, the density every shipping calendar has converged on. */
const SLOT_MIN_HEIGHT = 48

/** Enough that a four-minute entry is still a click target. */
const EVENT_MIN_HEIGHT = 18

/** Where the grid opens when the range is empty. */
const FALLBACK_SCROLL_HOUR = 8

/*
 * Hour rules and column dividers.
 *
 * A COLOUR ALONE DRAWS NOTHING. Tailwind's preflight sets `border: 0 solid` on
 * every element, `skeleton.css` only ever REMOVES borders, and the widths a
 * calendar normally gets live in `themes/`, which this file deliberately does
 * not import — so `border-edge-soft` without a width is an invisible grid.
 *
 * A full `border` on each of these is right rather than excessive, because the
 * skeleton subtracts the edges that would double up, with `!important`: the
 * first lane and the first column get `border: 0` (`.fc-Tu`), the remaining
 * lanes lose left/right/bottom (`.fc-hU`) and the remaining columns lose
 * top/bottom/end (`.fc-PB`). What survives is exactly one rule per hour and one
 * per column boundary. It is the same mechanism every bundled theme uses.
 *
 * Edge Soft throughout: these are dividers between passive content, where no
 * contrast floor applies.
 */
const HOUR_RULE = "border border-edge-soft"
const COLUMN_RULE = "border border-edge-soft"
/** The hour rail's own boundary. No cell border can draw it — the first
 *  column's are all stripped — so this divider element is what separates the
 *  hours from the grid, in the header row and in the body alike. */
const RAIL_RULE = "border-r border-edge-soft"

/**
 * The calendar grid.
 *
 * FullCalendar owns what a time grid is genuinely hard at: packing overlapping
 * blocks into columns, segmenting an entry that crosses midnight, the
 * now-line, and a minimum block height. What is ours is the mapping in
 * (`calendar-events.ts`) and the styling out (every `*Class` prop below).
 *
 * THE COLD LIGHT RULE IS THE THING TO WATCH IN HERE. A running entry's block
 * is the only `enlarger` on the grid. The now-indicator marks *now*, not
 * *running*, so it is Ink Muted — cold light on a grid where nothing is being
 * tracked is exactly the failure that rule exists to prevent.
 */
export function CalendarPanel({
  entries,
  size,
  anchor,
  timeZone,
  weekStartDay,
  use12Hour,
  display,
  nowMs,
  projectsById,
  onEntryClick,
  onRangeChange,
}: {
  entries: Array<Doc<"timeEntries">>
  size: CalendarSize
  anchor: DayString
  timeZone: string
  weekStartDay: number
  use12Hour: boolean
  display: DurationDisplay
  nowMs: number
  projectsById: Map<string, Doc<"projects">>
  onEntryClick: (entryId: string) => void
  onRangeChange: (range: { fromMs: number; toMs: number }) => void
}) {
  const events = useMemo(() => calendarEvents(entries, nowMs), [entries, nowMs])

  const totals = useMemo(
    () => dayTotals(entries, timeZone, nowMs),
    [entries, timeZone, nowMs]
  )

  const scrollHour = useMemo(
    () => earliestHour(entries, timeZone, FALLBACK_SCROLL_HOUR),
    [entries, timeZone]
  )

  /*
   * The last range handed upward, so `datesSet` firing on a re-render cannot
   * loop. `onRangeChange` sets state in the page, which re-renders this, which
   * re-runs `datesSet` — without this guard that is a render loop, and it is
   * the standard way to get one out of this callback.
   */
  const lastRange = useRef<string>("")

  /*
   * NAVIGATION. `initialDate` alone does not move the calendar.
   *
   * FullCalendar reads `getInitialDate` once, at init, and the React wrapper's
   * every subsequent render dispatches `IDLE` — only `CHANGE_DATE`/`PREV`/`NEXT`
   * move the date. So a changed `initialDate` prop is inert: the header's arrows
   * would move their own label and nothing else, and since `datesSet` would
   * never re-fire, the Convex query and the range total would stay on the old
   * week too.
   *
   * v7's answer is `useCalendarController` + the `controller` option, which is
   * how the calendar's api reaches this side (the manager calls the
   * controller's `_setApi` when it drains its first action queue).
   * `gotoDate(anchor)` dispatches the `CHANGE_DATE` that `initialDate` cannot.
   *
   * A DayString is a wall-clock date with no offset, and `gotoDate` resolves it
   * through the calendar's own `dateEnv` — so it lands on the same midnight
   * `convex/lib/day.ts` would compute, in the user's stored zone.
   *
   * NOT `key={anchor}`: remounting the grid on every step would throw away the
   * scroll position and refetch, which is the thing navigation must preserve.
   */
  const controller = useCalendarController()
  useEffect(() => {
    controller.gotoDate(anchor)
  }, [controller, anchor])

  return (
    <Calendar
      plugins={PLUGINS}
      controller={controller}
      // `key` on the view, not `changeView` through a ref. The size is a prop
      // here, and remounting on a change is both simpler and correct — there
      // is no imperative state in this component worth preserving across it.
      key={size}
      initialView={size === "day" ? "timeGridDay" : "timeGridWeek"}
      // Where the FIRST render opens. Every move after that is the effect
      // above; this is what keeps the first paint from being today's week
      // followed by a visible jump to the anchor's.
      initialDate={anchor}
      // The user's STORED zone, never the browser's. This is the whole reason
      // v7 is usable here: it resolves an IANA name through temporal-polyfill,
      // so the grid's midnight and `convex/lib/day.ts`'s midnight are the same
      // instant.
      timeZone={timeZone}
      firstDay={weekStartDay}
      hiddenDays={size === "5day" ? WEEKEND_HIDDEN : NO_HIDDEN_DAYS}
      headerToolbar={false}
      // Nothing here is all-day. An entry is a span of a working day, and an
      // empty all-day rail above every column is a band of nothing.
      allDaySlot={false}
      nowIndicator
      slotDuration="01:00:00"
      slotMinHeight={SLOT_MIN_HEIGHT}
      eventMinHeight={EVENT_MIN_HEIGHT}
      // A fixed height makes the body a scroll container with the day-header
      // row fixed above it — the arrangement every shipping calendar uses, and
      // what keeps the headers in place over 24 hours of grid.
      height={640}
      expandRows={false}
      // Opened where the work is, never at midnight. `scrollTimeReset` is left
      // at its default: it resets on navigation and is untouched by an event
      // change, which is exactly the rule — a live subscription pushes on
      // every keystroke into a title, and a grid that jumped back each time
      // would be unusable while anything is running.
      scrollTime={`${String(scrollHour).padStart(2, "0")}:00:00`}
      events={events}
      datesSet={(info) => {
        const fromMs = info.start.getTime()
        const toMs = info.end.getTime()
        const key = `${fromMs}-${toMs}`
        if (key === lastRange.current) return
        lastRange.current = key
        onRangeChange({ fromMs, toMs })
      }}
      eventClick={(info) => {
        info.jsEvent.preventDefault()
        onEntryClick(propsOf(info.event).entryId)
      }}
      // ---- Styling. One prop per element; no stylesheet override anywhere. --
      className="text-sm"
      viewClass="rounded-lg border border-edge-soft bg-surface overflow-hidden"
      tableClass="bg-surface"
      // The header row sits outside the scroller, so it needs its own boundary
      // against the grid scrolling beneath it.
      tableHeaderClass="border-b border-edge-soft bg-surface"
      tableBodyClass="bg-surface"
      slotLaneClass={HOUR_RULE}
      slotHeaderClass={HOUR_RULE}
      slotHeaderDividerClass={RAIL_RULE}
      dayLaneClass={COLUMN_RULE}
      slotHeaderContent={(info) => (
        /*
         * Through the app's own formatter, not FullCalendar's.
         *
         * timegrid's own label is "9am"; `formatTimeOfInstant` says "9:00 AM",
         * and it is what every other time in the product is spelled with. Two
         * casings of the same clock on one screen is the defect. It also caches
         * its `Intl.DateTimeFormat`, which matters here: this hook runs 24
         * times per render, and this component re-renders every second.
         *
         * The Tabular Rule: every digit the user reads, at any size.
         */
        <span className="tabular pr-2 text-xs text-muted-foreground">
          {formatTimeOfInstant(info.date.getTime(), timeZone, use12Hour)}
        </span>
      )}
      dayHeaderClass={cn(COLUMN_RULE, "py-2")}
      dayHeaderContent={(info) => {
        // Through `dayOf`, so the column header and the same day's header in
        // the list are computed by one function and cannot disagree.
        const day = dayOf(info.date.getTime(), timeZone)
        const total = totals.get(day) ?? 0
        return (
          <div className="flex flex-col items-center gap-0.5">
            {/* FullCalendar has already formatted both of these, in the
             * calendar's own timeZone. Building an `Intl.DateTimeFormat` per
             * cell to recompute them is the cost this render hook can least
             * afford — see `format-time.ts`'s note on why its formatters are
             * cached. */}
            <span className="text-xs text-muted-foreground">
              {info.weekdayText}
            </span>
            <span className="tabular text-base text-foreground">
              {info.dayNumberText}
            </span>
            {/* Nothing at all on an untracked day. `0:00:00` under five of
             * seven columns on a light week is noise that reads as a value,
             * and `formatCompactDuration` refuses to print `0m` for the same
             * reason: a zero total reads as a defect. */}
            {total === 0 ? null : (
              <span className="tabular text-xs text-muted-foreground">
                {formatTotal(total, display)}
              </span>
            )}
          </div>
        )
      }}
      // The now-indicator marks NOW, not RUNNING. Ink Muted, never
      // `enlarger` — see the Cold Light Rule.
      nowIndicatorLineClass="border-t border-muted-foreground"
      // A filled dot, sized. The element FullCalendar hands us is empty and has
      // no intrinsic size, so a background colour alone paints a 0×0 box. The
      // negative margin centres the 8px circle on the line's left end, which is
      // what the themes do with their own `border-width`/`margin` pair.
      nowIndicatorDotClass="-m-1 size-2 rounded-full bg-muted-foreground"
      columnEventClass={(info) => {
        const running = propsOf(info.event).endedAt === null
        return cn(
          // No transition anywhere: the running block's height changes with
          // the clock, and an eased height change is continuous motion with no
          // reduced-motion alternative.
          "overflow-hidden rounded-md px-1.5 py-1 text-left",
          running
            ? // Cold light, and only here: something IS running.
              "bg-enlarger/15 text-foreground"
            : "bg-surface-raised text-foreground",
          /*
           * The tail of an entry that crossed midnight. FullCalendar segments
           * it across both columns and `isStart` says which half this is. A
           * continuation is a TEXTURE, never a hue — the Hatch Rule.
           *
           * The border is stated per branch rather than once above, because
           * `.hatch-empty` carries its own `1px dashed` and is unlayered — it
           * outranks every Tailwind utility, so a `border-enlarger` beside it
           * would be in the class list and absent from the screen. Here the
           * class list says what renders.
           */
          info.isStart
            ? running
              ? "border border-enlarger"
              : // A block sits on a panel, not on ground, so Edge Raised is
                // the token that clears 3:1 there — the Adjacent Colour Rule.
                "border border-edge-raised"
            : "hatch-empty"
        )
      }}
      eventContent={(info) => {
        const { projectId, startedAt, endedAt } = propsOf(info.event)
        const project =
          projectId === undefined ? null : (projectsById.get(projectId) ?? null)

        // A tail carries no title. It is the same entry as the block at the
        // bottom of the previous column, and repeating the title there reads
        // as a second entry rather than as a continuation.
        if (!info.isStart) {
          return (
            <span className="sr-only">
              {titleOf(info.event)} — continued from the previous day
            </span>
          )
        }

        return (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-xs font-medium">
              {titleOf(info.event)}
            </span>
            {/*
             * `formatTimeRange`, never FullCalendar's `timeText`.
             *
             * timegrid's default event format is
             * `{hour:'numeric', minute:'2-digit', meridiem:false}`, and
             * `meridiem:false` DELETES the am/pm string rather than switching
             * to a 24-hour cycle — so a 09:30 entry and a 21:30 entry both
             * rendered "9:30 – 10:30" and `use12Hour` was ignored entirely.
             * Going through the app's own formatter is also what makes a block
             * read identically to the same entry's row in the log: one
             * spelling of a time, everywhere.
             *
             * A running entry shows its elapsed clock instead, because that is
             * the number that is still moving. Both instants come from
             * `extendedProps`, so this is the STORED start, not a `Date` that
             * has been through FullCalendar's own parsing.
             */}
            <span className="tabular truncate text-[0.6875rem] text-muted-foreground">
              {endedAt === null
                ? formatClock(nowMs - startedAt)
                : formatTimeRange(startedAt, endedAt, timeZone, use12Hour)}
            </span>
            <ProjectDot project={project} className="text-[0.6875rem]" />
          </div>
        )
      }}
    />
  )
}

/** The typed half of an event, which FullCalendar hands back as a `Dictionary`. */
function propsOf(event: EventApi): CalendarEventProps {
  return event.extendedProps as CalendarEventProps
}

/** A block's heading. An entry with no title is normal — starting the timer
 *  must never require one — so both the head and the midnight tail need the
 *  same fallback, or the tail's screen-reader text opens with a bare dash. */
function titleOf(event: EventApi): string {
  return event.title.trim() === "" ? "Untitled" : event.title
}
