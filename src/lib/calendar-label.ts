import { MONTH_ABBR, WEEKDAY_ABBR } from "@/lib/date-names"
import { addDays, parseDayString, weekdayOf } from "@shared/day"
import type { DayString } from "@shared/day"

/**
 * The text between the stepper's arrows.
 *
 * Owned here rather than assembled in the header, so the calendar has one
 * answer to "which range am I looking at" — and so the awkward cases (a range
 * crossing a month, a range crossing a year, the weekend a 5-day view hides)
 * are decided in a test rather than in a template.
 *
 * NO ISO WEEK NUMBER. The reference screenshot carries "W33" and it is
 * deliberately absent: ISO weeks are Monday-based by definition, this app's
 * `weekStartDay` is configurable, and under a Sunday start the number would
 * name a week other than the one drawn on screen.
 */

export type CalendarSize = "day" | "5day" | "week"

/** "Tue 11 Aug" — a single day, without its year. */
function dayText(day: DayString): string {
  const d = parseDayString(day)
  return `${WEEKDAY_ABBR[weekdayOf(day)]} ${d.day} ${MONTH_ABBR[d.month - 1]}`
}

/**
 * "10–16 Aug", "27 Jul – 2 Aug", "28 Dec 2026 – 3 Jan 2027".
 *
 * The month is stated once when the range does not leave it, and the year only
 * when the range crosses one — a year on every label is noise on the 51 weeks
 * it cannot disambiguate. An en dash, matching `formatTimeRange`; spaced when
 * either side carries more than a bare number, so "27 Jul – 2 Aug" does not
 * read as one token.
 */
function rangeText(firstDay: DayString, lastDay: DayString): string {
  const a = parseDayString(firstDay)
  const b = parseDayString(lastDay)

  if (a.year !== b.year) {
    return `${a.day} ${MONTH_ABBR[a.month - 1]} ${a.year} – ${b.day} ${MONTH_ABBR[b.month - 1]} ${b.year}`
  }
  if (a.month !== b.month) {
    return `${a.day} ${MONTH_ABBR[a.month - 1]} – ${b.day} ${MONTH_ABBR[b.month - 1]}`
  }
  return `${a.day}–${b.day} ${MONTH_ABBR[a.month - 1]}`
}

export function calendarLabel(
  firstDay: DayString,
  lastDay: DayString,
  size: CalendarSize,
  today: DayString
): string {
  if (size === "day") {
    if (firstDay === today) return `Today · ${dayText(firstDay)}`
    if (firstDay === addDays(today, -1)) return `Yesterday · ${dayText(firstDay)}`
    return dayText(firstDay)
  }

  /*
   * "This week" is decided against the whole seven days, not against the
   * columns on screen.
   *
   * A 5-day range is Mon-Fri, so on a Saturday `today` is outside it — and
   * dropping the prefix there would tell the user they were looking at some
   * other week, which is the one thing the label exists to prevent. String
   * comparison is safe: a `DayString` is zero-padded ISO, so it sorts
   * chronologically.
   */
  const weekEnd = addDays(firstDay, 6)
  const thisWeek = today >= firstDay && today <= weekEnd

  const range = rangeText(firstDay, lastDay)
  return thisWeek ? `This week · ${range}` : range
}
