import { addDays, parseDayString, weekdayOf } from "@shared/day"
import type { DayString } from "@shared/day"

/**
 * The calendar's arithmetic, kept out of the component.
 *
 * Pure and separately tested, because a month grid is wrong in ways nobody
 * notices until one particular month arrives: the leap day, the month that
 * needs a sixth row, the one that fits in four.
 *
 * Everything is expressed in `DayString`s and goes through `@shared/day`, so
 * the calendar and the day headers cannot disagree about which day is which.
 * There is no `Date` in local time anywhere here — that is what would make the
 * grid depend on the BROWSER's zone rather than the user's stored one.
 */

/** How many days a month has. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one, in UTC where there is
  // no DST to shorten it.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The first of the month containing `day`. */
function startOfMonth(day: DayString): DayString {
  const d = parseDayString(day)
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-01`
}

/**
 * The same day-of-month in another month, CLAMPED to that month's length.
 *
 * The clamp is the point. Naive arithmetic turns 31 January + 1 month into
 * 3 March, so a user paging forward from a 31-day month would skip February
 * entirely — and paging back would skip it again.
 */
export function addMonths(day: DayString, delta: number): DayString {
  const d = parseDayString(day)
  const zeroBased = d.month - 1 + delta
  const year = d.year + Math.floor(zeroBased / 12)
  const month = ((zeroBased % 12) + 12) % 12 // 0-11
  const dayOfMonth = Math.min(d.day, daysInMonth(year, month + 1))
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(
    dayOfMonth
  ).padStart(2, "0")}`
}

/**
 * The month containing `day`, as rows of seven.
 *
 * `null` is padding. Deliberately NOT the neighbouring months' dates: a
 * clickable 31 July sitting under an "August" heading is a date you can select
 * without noticing the calendar has jumped somewhere else. Blank cells cannot
 * be misread.
 *
 * The grid is as many rows as the month needs — four, five or six — rather than
 * a fixed five. A fixed height either clips a long month or draws an empty row
 * under a short one.
 */
export function monthGrid(
  day: DayString,
  weekStartDay: number
): Array<Array<DayString | null>> {
  const first = startOfMonth(day)
  const parts = parseDayString(first)
  const length = daysInMonth(parts.year, parts.month)

  // How many blanks before the 1st, given which weekday the row opens on.
  const lead = (weekdayOf(first) - weekStartDay + 7) % 7

  const cells: Array<DayString | null> = Array<DayString | null>(lead).fill(
    null
  )
  for (let i = 0; i < length; i += 1) cells.push(addDays(first, i))
  // Trailing padding only up to the end of the final row — never a whole row.
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: Array<Array<DayString | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

/** "August 2026" — the calendar's heading. */
export function monthLabel(day: DayString): string {
  const d = parseDayString(day)
  return `${MONTH_NAMES[d.month - 1]} ${d.year}`
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** Column headings, rotated so the first is the user's `weekStartDay`. */
export function weekdayLabels(weekStartDay: number): Array<string> {
  return Array.from(
    { length: 7 },
    (_, i) => WEEKDAY_NAMES[(weekStartDay + i) % 7]
  )
}
