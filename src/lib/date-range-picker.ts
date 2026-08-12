import { MONTH_ABBR } from "@/lib/date-names"
import {
  defaultFilters,
  monthEnd,
  monthStart,
  periodWindow,
  shiftMonth,
} from "@/lib/history-filters"
import { addDays, parseDayString, weekStartOf } from "@shared/day"
import type { Filters, Period } from "@/lib/history-filters"
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

// ---------------------------------------------------------------------------
// /reports' preset rail
// ---------------------------------------------------------------------------

/**
 * THE RAIL IS THE CALLER'S, NOT THE PICKER'S — see `date-range-picker.tsx`.
 * /timer's list lives in `timer-range.ts` and is about a time grid; this is
 * /reports', and it is about the spans a freelancer reports and invoices on.
 * Neither page can express the other's, which is exactly why `presets` is a
 * prop and there is still only one picker component.
 *
 * Every boundary below goes through `@shared/day`, or through the calendar-month
 * helpers in `history-filters.ts` — which are UTC-seeded and read back with
 * `dayOf(…, "UTC")`, so no local `Date` field is ever consulted. That
 * distinction is the whole rule: a quarter that starts a day early once a year
 * is the defect `convex/lib/day.ts` exists to prevent, and it is invisible until
 * an invoice is raised across the seam. What the rule forbids is `getMonth`/
 * `getFullYear` on a LOCAL `Date`, not `new Date` as such — which is why this
 * file's own second copy of that arithmetic was deleted rather than kept.
 */
export type ReportsPreset =
  | "today"
  | "this-week"
  | "this-month"
  | "this-quarter"
  | "this-year"
  | "last-week"
  | "last-month"

/** Sentence case, per The Sentence Case Rule. */
export const REPORTS_PRESET_LABELS: Record<ReportsPreset, string> = {
  today: "Today",
  "this-week": "This week",
  "this-month": "This month",
  "this-quarter": "This quarter",
  "this-year": "This year",
  "last-week": "Last week",
  "last-month": "Last month",
}

/** The rail's order: the current spans widening downward, then the two
 *  finished ones. The reference design's order, and it reads as a scale. */
export const REPORTS_PRESETS: ReadonlyArray<ReportsPreset> = [
  "today",
  "this-week",
  "this-month",
  "this-quarter",
  "this-year",
  "last-week",
  "last-month",
]

/**
 * The range /reports OPENS ON, named once so the rail's "Default" badge and
 * the page's initial state cannot drift apart.
 *
 * A quarter, not a week. A week is the span you check a timer against; a
 * quarter is the one a freelancer reports and invoices on, and it is what the
 * page's charts and its Create invoice button are for.
 */
export const REPORTS_DEFAULT_PRESET: ReportsPreset = "this-quarter"

/**
 * The days a preset means.
 *
 * `weekStartDay` is threaded through because two of these are weeks and this
 * product does not assume Monday — the same reason `periodWindow` takes it.
 */
export function reportsPresetWindow(
  preset: ReportsPreset,
  today: DayString,
  weekStartDay: number
): { from: DayString; to: DayString } {
  switch (preset) {
    case "today":
      return periodWindow("day", today, weekStartDay)
    case "this-week":
      return periodWindow("week", today, weekStartDay)
    case "last-week": {
      // Seven days back and then to that week's start, rather than the current
      // week's start minus seven: identical here, and the former stays right
      // if `weekStartOf` ever has to handle a locale that moves.
      const first = weekStartOf(addDays(today, -7), weekStartDay)
      return { from: first, to: addDays(first, 6) }
    }
    case "this-month":
      return periodWindow("month", today, weekStartDay)
    case "last-month": {
      // `shiftMonth` already lands on day 1 of the previous month and already
      // rolls January back into December, so there is no year branch to get
      // wrong here — see `history-filters.ts`, which owns this arithmetic.
      const month = shiftMonth(today, -1)
      return { from: monthStart(month), to: monthEnd(month) }
    }
    case "this-quarter":
      return quarterWindow(today)
    case "this-year":
      return yearWindow(today)
  }
}

/**
 * The calendar quarter a day falls in — Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec.
 *
 * Fiscal quarters are deliberately not offered: they are a per-user setting
 * this product does not have, and guessing one would silently mis-scope every
 * figure on the page.
 */
export function quarterWindow(day: DayString): { from: DayString; to: DayString } {
  const { year, month } = parseDayString(day)
  // 1-3 -> 1, 4-6 -> 4, 7-9 -> 7, 10-12 -> 10.
  const firstMonth = month - ((month - 1) % 3)
  return {
    from: firstOfMonth(year, firstMonth),
    // `firstMonth + 2` is 12 at the most, so it cannot roll the year, and
    // `monthEnd` supplies the month's length — February's leap years included.
    to: monthEnd(firstOfMonth(year, firstMonth + 2)),
  }
}

/** The calendar year a day falls in. Both ends are fixed dates, so there is
 *  no month-length or leap-year question to get wrong. */
export function yearWindow(day: DayString): { from: DayString; to: DayString } {
  const { year } = parseDayString(day)
  return { from: `${pad4(year)}-01-01`, to: `${pad4(year)}-12-31` }
}

/**
 * Which period a preset ALSO sets, because the arrows have to keep working.
 *
 * Five of the seven are exactly a Day/Week/Month window, so they say so and
 * `stepPeriod` walks them a calendar week or a calendar month at a time —
 * "Last week" included, since a stepped-away week is still a week even though
 * `rangeTriggerLabel` correctly refuses to call it "This week".
 *
 * Quarter and year are `custom`, which is the honest answer: `Period` has no
 * case for them, and a custom range steps by its own span — the behaviour
 * `stepPeriod` already documents and the one the trigger already labels with
 * plain dates rather than a period name.
 *
 * Module-private: `reportsPresetFilters` below is the only caller, and it is
 * the one this page reaches for. Tested through it rather than directly.
 */
function reportsPresetPeriod(preset: ReportsPreset): Period {
  switch (preset) {
    case "today":
      return "day"
    case "this-week":
    case "last-week":
      return "week"
    case "this-month":
    case "last-month":
      return "month"
    case "this-quarter":
    case "this-year":
      return "custom"
  }
}

/** A preset applied to the filters, leaving every non-date field alone. */
export function reportsPresetFilters(
  preset: ReportsPreset,
  today: DayString,
  weekStartDay: number,
  current: Filters
): Filters {
  return {
    ...current,
    period: reportsPresetPeriod(preset),
    ...reportsPresetWindow(preset, today, weekStartDay),
  }
}

/**
 * Which preset the current range IS, so the rail can show it pressed.
 *
 * Computed, never stored beside the range — the same argument `timer-range.ts`
 * makes for its own `activePreset`. A stored "active preset" is a second
 * source of truth that goes stale the instant an arrow steps the range out
 * from under it, which is precisely when the rail has to stop claiming
 * "This quarter".
 */
export function activeReportsPreset(
  from: DayString,
  to: DayString,
  today: DayString,
  weekStartDay: number
): ReportsPreset | null {
  for (const preset of REPORTS_PRESETS) {
    const window = reportsPresetWindow(preset, today, weekStartDay)
    if (window.from === from && window.to === to) return preset
  }
  return null
}

/** What /reports opens on. Read by the route's loader as well as its
 *  component, so the prefetched query key is the one the page then asks for. */
export function reportsDefaultFilters(
  today: DayString,
  weekStartDay: number
): Filters {
  return reportsPresetFilters(
    REPORTS_DEFAULT_PRESET,
    today,
    weekStartDay,
    defaultFilters(today, weekStartDay)
  )
}

// ---------------------------------------------------------------------------

function pad4(year: number): string {
  return String(year).padStart(4, "0")
}

/**
 * A (year, month) pair spelled as the first of that month.
 *
 * FORMATTING, not arithmetic — which is why this survived and its former
 * partner `lastOfMonth` did not. That one WAS arithmetic ("the day before the
 * first of the next month, and December rolls the year"), and it was a second
 * implementation of `monthEnd` in a file that already imports from
 * `history-filters.ts`; the same is true of the `last-month` case's hand-rolled
 * January branch. Both go through the exported `monthStart`/`monthEnd`/
 * `shiftMonth` now.
 *
 * `monthStart` cannot stand in here: it takes a `DayString` and this takes the
 * two numbers `parseDayString` hands back, which is what `quarterWindow` is
 * working in.
 */
function firstOfMonth(year: number, month: number): DayString {
  return `${pad4(year)}-${String(month).padStart(2, "0")}-01`
}
