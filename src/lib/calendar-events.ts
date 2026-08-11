import { dayOf, localPartsOf } from "@shared/day"
import type { DayString } from "@shared/day"
import type { EventInput } from "@fullcalendar/react"
import type { Doc } from "../../convex/_generated/dataModel"

/**
 * Time entries, in the shape FullCalendar takes.
 *
 * Pure and separately tested, for a reason worth stating: FullCalendar measures
 * element geometry to lay a grid out and jsdom reports every element as
 * zero-sized, so nothing about the rendered calendar can be asserted in a unit
 * test. Everything that CAN be asserted therefore lives here, on this side of
 * the boundary.
 */

/** The typed half of `extendedProps`, read by the panel's class-name props. */
export type CalendarEventProps = {
  entryId: string
  projectId: string | undefined
  billable: boolean
  running: boolean
}

export type CalendarEvent = EventInput & { extendedProps: CalendarEventProps }

/** The smallest span FullCalendar will still draw. See `calendarEvents`. */
const MIN_SPAN_MS = 60_000

export function calendarEvents(
  entries: Array<Doc<"timeEntries">>,
  nowMs: number
): Array<CalendarEvent> {
  return entries.map((entry) => {
    const running = entry.endedAt === null
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
      extendedProps: {
        entryId: entry._id,
        projectId: entry.projectId,
        billable: entry.billable,
        running,
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
