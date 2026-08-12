import { MONTH_ABBR } from "@/lib/date-names"
import { periodWindow } from "@/lib/history-filters"
import { parseDayString } from "@shared/day"
import type { Period } from "@/lib/history-filters"
import type { DayString } from "@shared/day"

/**
 * The pure arithmetic behind the range picker: the label the trigger shows,
 * and the one conversion between this app's `DayString` model and the
 * `Date`-based model react-day-picker (and date-fns) speak.
 *
 * Kept out of the component for the same reason `month-grid.ts` is — this is
 * small enough to test exhaustively without a DOM, and a label or a date
 * conversion is wrong in ways nobody notices until a specific pair of dates
 * is tried.
 *
 * The two-click range-selection state machine that used to live here
 * (`selectDay` / `previewRange`) is DELETED — react-day-picker's own
 * `mode="range"` owns that now (see `date-range-picker.tsx`), and duplicating
 * it here would just be a second implementation to keep in sync.
 *
 * `DayString`s compare correctly with plain `<`/`>` because they are
 * zero-padded "YYYY-MM-DD" — lexicographic order is calendar order.
 */

/**
 * The ONE place a `DayString` becomes a `Date`, and back.
 *
 * react-day-picker and date-fns work in `Date` objects in the BROWSER's local
 * zone; every `DayString` in this app is a calendar date already resolved in
 * the user's STORED zone (see `convex/lib/day.ts`). Those two models agree on
 * the calendar digits only — never on an instant — so the conversion here
 * never parses or formats through an instant: `dayToDate` writes the y/m/d
 * straight into a `Date`'s LOCAL fields (never `new Date("2026-08-03")`,
 * which parses as UTC midnight and would print as 2 August for anyone west of
 * Greenwich), and `dateToDay` reads them back the same way. Round-tripping
 * through local fields on both ends is what makes the two inverses of each
 * other regardless of which zone the browser happens to be in.
 *
 * This is the only file allowed to touch `Date` for this picker — see
 * `date-range-picker.tsx`, which holds react-day-picker's grid state in
 * `Date` internally but converts at the prop boundary through these two
 * functions and nowhere else.
 */
export function dayToDate(day: DayString): Date {
  const { year, month, day: dayOfMonth } = parseDayString(day)
  return new Date(year, month - 1, dayOfMonth)
}

/** The inverse of {@link dayToDate}. See its comment for why this matters. */
export function dateToDay(date: Date): DayString {
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * "3 – 9 Aug 2026" — collapses the month and year when both endpoints share
 * them, rather than repeating "3 Aug 2026 – 9 Aug 2026".
 */
export function formatDayRange(from: DayString, to: DayString): string {
  const f = parseDayString(from)
  const t = parseDayString(to)
  const fMonth = MONTH_ABBR[f.month - 1]
  const tMonth = MONTH_ABBR[t.month - 1]

  if (from === to) return `${f.day} ${fMonth} ${f.year}`
  if (f.year === t.year && f.month === t.month) {
    return `${f.day} – ${t.day} ${tMonth} ${t.year}`
  }
  if (f.year === t.year) {
    return `${f.day} ${fMonth} – ${t.day} ${tMonth} ${t.year}`
  }
  return `${f.day} ${fMonth} ${f.year} – ${t.day} ${tMonth} ${t.year}`
}

/**
 * What the trigger says.
 *
 * Names the active Day/Week/Month period ("This week") only when the range
 * exactly matches what that period computes for TODAY — a stepped-away week
 * ("last week") is not "this" anything, so it falls through to the formatted
 * range like a genuinely custom one does.
 */
export function rangeTriggerLabel(
  period: Period,
  from: DayString,
  to: DayString,
  today: DayString,
  weekStartDay: number
): string {
  if (period !== "custom") {
    const current = periodWindow(period, today, weekStartDay)
    if (current.from === from && current.to === to) {
      return period === "day"
        ? "Today"
        : period === "week"
          ? "This week"
          : "This month"
    }
  }
  return formatDayRange(from, to)
}
