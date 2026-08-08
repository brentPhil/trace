import { periodFilters } from "@/lib/history-filters"
import { parseDayString } from "@shared/day"
import type { Period } from "@/lib/history-filters"
import type { DayString } from "@shared/day"

/**
 * The pure arithmetic behind the range picker: the two-click selection state
 * machine, the hover preview it drives, and the trigger's label.
 *
 * Kept out of the component for the same reason `month-grid.ts` is — a range
 * picker is wrong in ways nobody notices until a specific pair of dates is
 * tried, and this is small enough to test exhaustively without a DOM.
 *
 * `DayString`s compare correctly with plain `<`/`>` because they are
 * zero-padded "YYYY-MM-DD" — lexicographic order is calendar order — so none
 * of this needs to parse a date to compare two of them.
 */

/** Armed after the first click: a start with no end yet. */
export type RangeSelection = { anchor: DayString } | null

/**
 * Advances the two-click state machine.
 *
 * An inverted range must be impossible to EXPRESS, not merely rejected:
 * clicking a day before the armed anchor does not swap the two dates or
 * refuse the click, it restarts the selection from the day just clicked.
 */
export function selectDay(
  state: RangeSelection,
  day: DayString
): {
  state: RangeSelection
  committed: { from: DayString; to: DayString } | null
} {
  if (state === null || day < state.anchor) {
    return { state: { anchor: day }, committed: null }
  }
  return { state: null, committed: { from: state.anchor, to: day } }
}

/**
 * The range to highlight while the second click is pending.
 *
 * Hovering earlier than the anchor previews only the hovered day, not an
 * inverted band — exactly what `selectDay` would do if clicked there, so the
 * preview never promises a range the click would refuse to produce.
 */
export function previewRange(
  state: RangeSelection,
  hoveredDay: DayString
): { from: DayString; to: DayString } | null {
  if (state === null) return null
  return hoveredDay < state.anchor
    ? { from: hoveredDay, to: hoveredDay }
    : { from: state.anchor, to: hoveredDay }
}

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

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
    const current = periodFilters(period, today, weekStartDay, {
      period,
      from,
      to,
      projectId: null,
      billableOnly: false,
      text: "",
      presets: [],
    })
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
