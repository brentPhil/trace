import { addDays, dayOf, localPartsOf, weekdayOf } from "@shared/day"
import type { DayString } from "@shared/day"
import type { EventInput } from "@fullcalendar/react"
import type { Doc } from "../../convex/_generated/dataModel"

/**
 * Time entries, in the shape FullCalendar takes.
 *
 * Pure and separately tested, because a mapping is cheaper to pin down as a
 * function than through a grid. What CANNOT be asserted in jsdom is element
 * GEOMETRY — FullCalendar measures column widths and row heights and jsdom
 * reports every element as zero-sized. Everything else about the rendered
 * calendar can be and is: see `calendar-panel.test.tsx`, which asserts the hour
 * rail, the block times, the midnight segmentation and the day totals.
 */

/**
 * What the grid reports about the window it is drawing.
 *
 * `days` IS NOT DERIVABLE FROM THE OTHER TWO by anything outside the panel: the
 * 5-day view hides two weekdays inside its own range, so the range's width and
 * the number of columns are different questions. Both answers travel together
 * because the page needs both — the instants key the Convex query, and the days
 * are what "Range total" is allowed to sum.
 */
export type CalendarRange = {
  fromMs: number
  toMs: number
  days: Array<DayString>
}

/** The typed half of `extendedProps`, read by the panel's render hooks. */
export type CalendarEventProps = {
  entryId: string
  projectId: string | undefined
  /*
   * The STORED instants, carried through untouched.
   *
   * The panel prints a block's time with `formatTimeRange`, the same function
   * the entry's row in the log uses, so the two cannot disagree — and that
   * takes the raw `startedAt`/`endedAt`, not the `Date`s below (whose `end` is
   * `nowMs` while running, and which arrive back from FullCalendar as
   * nullable). `endedAt === null` is also what "running" means everywhere else
   * in the product, so there is no second boolean here saying it again.
   */
  startedAt: number
  endedAt: number | null
}

export type CalendarEvent = EventInput & { extendedProps: CalendarEventProps }

/** The smallest span FullCalendar will still draw. See `calendarEvents`. */
const MIN_SPAN_MS = 60_000

export function calendarEvents(
  entries: Array<Doc<"timeEntries">>,
  nowMs: number
): Array<CalendarEvent> {
  return entries.map((entry) => {
    const ended = entry.endedAt ?? nowMs

    return {
      id: entry._id,
      title: entry.title,
      /*
       * `Date`s built from the stored instants, never ISO strings.
       *
       * FullCalendar reads a string with no UTC offset as a wall-clock time in
       * the calendar's own `timeZone`. That happens to agree with the stored
       * instant today and stops agreeing the moment anything formats the field
       * differently — and a time entry drawn an hour off its real start is the
       * defect this product can least afford. A `Date` is an absolute moment
       * and cannot be reinterpreted.
       */
      start: new Date(entry.startedAt),
      /*
       * Floored to one minute. FullCalendar drops an event whose end equals its
       * start, and a row that exists must be visible or it cannot be edited
       * from this view. `eventMinHeight` keeps it clickable once it is drawn.
       */
      end: new Date(Math.max(ended, entry.startedAt + MIN_SPAN_MS)),
      /*
       * `billable` is deliberately absent. It was carried here "for styling"
       * and nothing ever read it: blocks take no hue at all under the Two
       * Temperatures Rule — warm means money and it is spent on the money
       * figures, not on a grid — so there is nothing for it to feed. A field
       * that is written and never read is a claim the code does not keep.
       */
      extendedProps: {
        entryId: entry._id,
        projectId: entry.projectId,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
      },
    }
  })
}

/**
 * Milliseconds tracked per local day, keyed by `DayString`.
 *
 * ATTRIBUTION BY START, matching convex/entries.ts: an entry running 23:00 to
 * 01:30 belongs wholly to the day it began. The grid draws that entry in both
 * columns — FullCalendar segments it and the tail is hatched — so this function
 * is what keeps the column header from claiming time the day did not earn, and
 * what keeps it agreeing with the same day's header in the list.
 */
export function dayTotals(
  entries: Array<Doc<"timeEntries">>,
  timeZone: string,
  nowMs: number
): Map<DayString, number> {
  const totals = new Map<DayString, number>()
  for (const entry of entries) {
    const day = dayOf(entry.startedAt, timeZone)
    const ended = entry.endedAt ?? nowMs
    const elapsed = Math.max(0, ended - entry.startedAt)
    totals.set(day, (totals.get(day) ?? 0) + elapsed)
  }
  return totals
}

/**
 * The figure under the stepper's arrows: the sum of the DRAWN columns' totals.
 *
 * A function rather than three lines in the page, because the assertion that
 * holds it is "this equals the sum of the numbers in the column headers" and
 * that assertion has to be made against the same code the page runs — see
 * `calendar-range-label.test.tsx`, which renders the real grid, reads the
 * figures off it, and calls this.
 *
 * `days` is the list the GRID reported. Summing `dayTotals`'s values instead
 * sums every day the QUERY covers, and the two differ whenever a view hides a
 * weekday inside its own range: a header total describing days that have no
 * column, on a tool people invoice from.
 */
export function rangeTotal(
  entries: Array<Doc<"timeEntries">>,
  timeZone: string,
  nowMs: number,
  days: Array<DayString>
): number {
  const totals = dayTotals(entries, timeZone, nowMs)
  let sum = 0
  for (const day of days) {
    sum += totals.get(day) ?? 0
  }
  return sum
}

/**
 * The days a range actually draws a column for.
 *
 * Every local day the half-open range `[fromMs, toMs)` touches, less the
 * weekdays the view hides. The 5-day view is the whole reason this exists: its
 * range is five days wide and its hidden set is `[0, 6]`, and only the caller
 * that owns both can say which of those two facts applies — so this takes the
 * hidden set rather than a size.
 *
 * Both ends go through `dayOf`, the same function the grid's column headers and
 * `dayTotals` use, so a day in this list is a key that can be looked up in that
 * map. `toMs` is EXCLUSIVE, so the last day is the one holding the millisecond
 * before it. Day strings sort lexicographically, which is what the loop's bound
 * relies on, and `addDays` is calendar arithmetic — no `+ 86_400_000`, so a DST
 * day does not skip or repeat one.
 */
export function drawnDays(
  fromMs: number,
  toMs: number,
  timeZone: string,
  hiddenDays: Array<number>
): Array<DayString> {
  if (toMs <= fromMs) return []
  const last = dayOf(toMs - 1, timeZone)
  const days: Array<DayString> = []
  for (
    let day = dayOf(fromMs, timeZone);
    day <= last;
    day = addDays(day, 1)
  ) {
    if (!hiddenDays.includes(weekdayOf(day))) days.push(day)
  }
  return days
}

/**
 * The hour the grid should open scrolled to.
 *
 * The earliest start in the range, in the USER's stored zone — read through
 * `localPartsOf` rather than `getHours()`, which would answer for the browser.
 * A grid scrolled to 23:00 because the entry is 23:30 UTC, when the user is in
 * Manila and started at 07:30, is scrolled past every block on it.
 */
export function earliestHour(
  entries: Array<Doc<"timeEntries">>,
  timeZone: string,
  fallbackHour: number
): number {
  if (entries.length === 0) return fallbackHour
  let earliest = Infinity
  for (const entry of entries) {
    if (entry.startedAt < earliest) earliest = entry.startedAt
  }
  return localPartsOf(earliest, timeZone).hour
}
