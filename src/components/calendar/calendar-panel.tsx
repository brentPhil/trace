import { useMemo, useRef } from "react"
import Calendar from "@fullcalendar/react"
import timeGridPlugin from "@fullcalendar/react/timegrid"
import { ProjectDot } from "@/components/classifiers/project-dot"
import {
  calendarEvents,
  dayTotals,
  earliestHour,
} from "@/lib/calendar-events"
import { formatTotal } from "@/lib/format-total"
import { cn } from "@/lib/utils"
import { dayOf } from "@shared/day"
import { formatClock } from "@shared/duration"
import type { CalendarSize } from "@/lib/calendar-label"
import type { DurationDisplay } from "@/lib/format-total"
import type { DayString } from "@shared/day"
import type { Doc } from "../../../convex/_generated/dataModel"

// Structure only. No theme is imported: every visible surface here is set
// through v7's class-name props, so DESIGN.md's rules are our own Tailwind
// classes rather than overrides fighting a vendored stylesheet — which is the
// failure DESIGN.md §5 records from recharts.
import "@fullcalendar/react/skeleton.css"

const PLUGINS = [timeGridPlugin]

/** 48px an hour, the density every shipping calendar has converged on. */
const SLOT_MIN_HEIGHT = 48

/** Enough that a four-minute entry is still a click target. */
const EVENT_MIN_HEIGHT = 18

/** Where the grid opens when the range is empty. */
const FALLBACK_SCROLL_HOUR = 8

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

  return (
    <Calendar
      plugins={PLUGINS}
      // `key` on the view, not `changeView` through a ref. The size is a prop
      // here, and remounting on a change is both simpler and correct — there
      // is no imperative state in this component worth preserving across it.
      key={size}
      initialView={size === "day" ? "timeGridDay" : "timeGridWeek"}
      initialDate={anchor}
      // The user's STORED zone, never the browser's. This is the whole reason
      // v7 is usable here: it resolves an IANA name through temporal-polyfill,
      // so the grid's midnight and `convex/lib/day.ts`'s midnight are the same
      // instant.
      timeZone={timeZone}
      firstDay={weekStartDay}
      // `[0, 6]` hides Saturday and Sunday whatever `firstDay` is, which is
      // exactly "Monday to Friday regardless of weekStartDay". A 5-day range
      // therefore also steps by a whole week for free, because it IS the week.
      hiddenDays={size === "5day" ? [0, 6] : []}
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
        const { entryId } = info.event.extendedProps as { entryId: string }
        onEntryClick(entryId)
      }}
      // ---- Styling. One prop per element; no stylesheet override anywhere. --
      className="text-sm"
      viewClass="rounded-lg border border-edge-soft bg-surface overflow-hidden"
      tableClass="bg-surface"
      // The header row sits outside the scroller, so it needs its own boundary
      // against the grid scrolling beneath it.
      tableHeaderClass="border-b border-edge-soft bg-surface"
      tableBodyClass="bg-surface"
      // Dividers between passive content: Edge Soft, no contrast floor.
      slotLaneClass="border-edge-soft"
      slotHeaderClass="border-edge-soft"
      slotHeaderContent={(info) => (
        // The Tabular Rule: every digit the user reads, at any size.
        <span className="tabular pr-2 text-xs text-muted-foreground">
          {formatHour(info.date, timeZone, use12Hour)}
        </span>
      )}
      dayHeaderClass="border-edge-soft py-2"
      dayHeaderContent={(info) => {
        // Through `dayOf`, so the column header and the same day's header in
        // the list are computed by one function and cannot disagree.
        const day = dayOf(info.date.getTime(), timeZone)
        const total = totals.get(day) ?? 0
        return (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-muted-foreground">
              {weekdayShort(info.date, timeZone)}
            </span>
            <span className="tabular text-base text-foreground">
              {dayNumber(info.date, timeZone)}
            </span>
            <span className="tabular text-xs text-muted-foreground">
              {formatTotal(total, display)}
            </span>
          </div>
        )
      }}
      // The now-indicator marks NOW, not RUNNING. Ink Muted, never
      // `enlarger` — see the Cold Light Rule.
      nowIndicatorLineClass="border-t border-muted-foreground"
      nowIndicatorDotClass="bg-muted-foreground"
      columnEventClass={(info) => {
        const running = Boolean(info.event.extendedProps.running)
        return cn(
          // No transition anywhere: the running block's height changes with
          // the clock, and an eased height change is continuous motion with no
          // reduced-motion alternative.
          "overflow-hidden rounded-md border px-1.5 py-1 text-left",
          running
            ? // Cold light, and only here: something IS running.
              "border-enlarger bg-enlarger/15 text-foreground"
            : // A block sits on a panel, not on ground, so Edge Raised is the
              // token that clears 3:1 there — the Adjacent Colour Rule.
              "border-edge-raised bg-surface-raised text-foreground",
          // The tail of an entry that crossed midnight. FullCalendar segments
          // it across both columns and `isStart` says which half this is. A
          // continuation is a TEXTURE, never a hue — the Hatch Rule.
          info.isStart ? null : "hatch-empty"
        )
      }}
      eventContent={(info) => {
        const running = Boolean(info.event.extendedProps.running)
        const projectId = info.event.extendedProps.projectId as
          | string
          | undefined
        const project =
          projectId === undefined ? null : (projectsById.get(projectId) ?? null)

        // A tail carries no title. It is the same entry as the block at the
        // bottom of the previous column, and repeating the title there reads
        // as a second entry rather than as a continuation.
        if (!info.isStart) {
          return (
            <span className="sr-only">
              {info.event.title} — continued from the previous day
            </span>
          )
        }

        return (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-xs font-medium">
              {info.event.title.trim() === "" ? "Untitled" : info.event.title}
            </span>
            <span className="tabular truncate text-[0.6875rem] text-muted-foreground">
              {running
                ? formatClock(nowMs - (info.event.start?.getTime() ?? nowMs))
                : info.timeText}
            </span>
            <ProjectDot project={project} className="text-[0.6875rem]" />
          </div>
        )
      }}
    />
  )
}

/*
 * Three small formatters, kept local.
 *
 * Each takes a `Date` that FullCalendar hands to a render hook and formats it
 * in the USER's stored zone — never through `getHours()`/`getDate()`, which
 * would answer for the browser and put the whole grid's labels an hour or a
 * day out for anyone not sitting in their own timezone.
 */

function formatHour(date: Date, timeZone: string, use12Hour: boolean): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    hour12: use12Hour,
    ...(use12Hour ? {} : { minute: "2-digit" }),
  }).format(date)
}

function weekdayShort(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(
    date
  )
}

function dayNumber(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric" }).format(
    date
  )
}
