import { addDays, dayOf, dayWindow, weekStartOf, weekdayOf } from "@shared/day"
import type { CalendarSize } from "@/lib/calendar-label"
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
 * The window the page has decided to show, and told the grid to draw.
 *
 * IT USED TO BE THE OTHER WAY ROUND — the grid computed the span from
 * `firstDay`/`hiddenDays` and reported it up through `datesSet`, and the page
 * took what it was given. That could only ever work while the range existed in
 * Calendar view: the range bar is on screen in List too now, and it bounds the
 * list, and in List there is no grid mounted to report anything. So the page
 * computes the range with `rangeOf` and the grid is told to draw exactly that.
 *
 * All three fields travel together because the page needs all three: the
 * instants key the Convex query, and `days` is what "Range total" is allowed to
 * sum and what the label's two ends are read off.
 */
export type CalendarRange = {
  fromMs: number
  toMs: number
  days: Array<DayString>
}

/**
 * Monday. The 5-day view's own week start, whatever the user's is.
 *
 * 5 days is the WORKING WEEK and the working week is Monday to Friday by
 * definition. The view exists to hide the weekend; rotating it by
 * `weekStartDay` would make it mean something else on a Sunday-start calendar.
 * `week` and `day` still take the stored `weekStartDay`, which is where it
 * belongs.
 */
const WORKING_WEEK_FIRST_DAY = 1

/**
 * The days a size draws, given where it is anchored.
 *
 * THIS IS WHERE THIS CODEBASE'S WORST BUG LIVED, in a different spelling. The
 * 5-day range used to be produced by `firstDay={weekStartDay}` plus
 * `hiddenDays={[0, 6]}`, and FullCalendar trims hidden days only off the ENDS
 * of the week `firstDay` built — so with a Wednesday start the weekend fell in
 * the INTERIOR and was not removed at all, and the grid drew Wed, Thu, Fri,
 * MON, TUE: five columns spanning seven days of two different weeks. 31 of the
 * 49 (weekStartDay × anchor) combinations disagreed with the label above them.
 * See `calendar-range-label.test.tsx`, which walks the whole matrix.
 *
 * Stated as five days from Monday there is no trimming model left to get
 * wrong: the answer is the same for all seven starts because `weekStartDay`
 * does not enter this branch at all.
 */
function daysOf(
  anchor: DayString,
  size: CalendarSize,
  weekStartDay: number
): Array<DayString> {
  if (size === "day") return [anchor]

  const width = size === "5day" ? 5 : 7
  const first = weekStartOf(
    anchor,
    size === "5day" ? WORKING_WEEK_FIRST_DAY : weekStartDay
  )

  const days: Array<DayString> = []
  for (let i = 0; i < width; i += 1) days.push(addDays(first, i))
  return days
}

/**
 * The range a size and an anchor mean, as instants and as columns.
 *
 * PURE, and the single source of truth for both. The page keys its Convex
 * query on `fromMs`/`toMs`, labels the bar from the ends of `days`, sums
 * "Range total" over `days`, and hands the whole thing to `CalendarPanel` as
 * `visibleRange` — so the query, the label, the total and the columns are one
 * computation rather than four that agree by coincidence.
 *
 * Every boundary goes through `@shared/day`: `weekStartOf` and `addDays` are
 * calendar arithmetic on a `DayString`, and `dayWindow` resolves the two ends
 * to instants in the user's stored zone, so a DST day is 23 or 25 hours long
 * and no hour is lost or counted twice. `toMs` is EXCLUSIVE — the midnight
 * that ends the last day.
 */
export function rangeOf(
  anchor: DayString,
  size: CalendarSize,
  weekStartDay: number,
  timeZone: string
): CalendarRange {
  const days = daysOf(anchor, size, weekStartDay)
  return {
    fromMs: dayWindow(days[0], timeZone).fromMs,
    toMs: dayWindow(days[days.length - 1], timeZone).toMs,
    days,
  }
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

/**
 * The smallest span FullCalendar will still draw. See `calendarEvents`.
 *
 * Exported because `calendar-panel.tsx` computes how tall a block will be in
 * order to decide what text fits inside it, and a floor applied in one file and
 * not the other would have it reasoning about a height the grid never draws.
 */
export const MIN_SPAN_MS = 60_000

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
 * The first and last day of a window — what the range bar SELECTS, and what the
 * label between its arrows is read off.
 *
 * READS `days`, and deliberately does not recompute the ends from `fromMs` and
 * `toMs`. Those two happen to give the same answer today, because for every
 * size this app ships the hidden weekdays land at the range's ends where
 * FullCalendar's own trimming already removed them — but that is a property of
 * the current trimming model, not of the code, and the whole reason `days`
 * travels alongside the instants is that nothing outside the panel may assume
 * it. A view with an interior gap would make a `dayOf(toMs - 1)` derivation
 * disagree with the columns silently, which is exactly the defect this file's
 * `rangeTotal` comment describes shipping once already.
 *
 * NO `null` CASE. It had one, for a `days` that could be empty — and `rangeOf`
 * is the only thing that builds a `CalendarRange`, and it never produces fewer
 * than one day. The branch was unreachable and every caller paid for it with an
 * unwrap.
 */
export function boundsOf(range: CalendarRange): {
  from: DayString
  to: DayString
} {
  return {
    from: range.days[0],
    to: range.days[range.days.length - 1],
  }
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

