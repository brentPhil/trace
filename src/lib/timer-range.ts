import { rangeOf } from "@/lib/calendar-events"
import { calendarLabel } from "@/lib/calendar-label"
import { formatDayRange } from "@/lib/date-range-picker"
import { daysBetween } from "@/lib/history-filters"
import { usDate } from "@/lib/us-date"
import { addDays, dayWindow, weekStartOf } from "@shared/day"
import type { CalendarSize } from "@/lib/calendar-label"
import type { DayString } from "@shared/day"

/**
 * /timer's range model: what the pill says, what the arrows do, and which
 * presets each view is allowed to offer.
 *
 * Pure, and out of the route for the usual reason — every awkward case here
 * (the working week's stride, a thirty-day span meeting a time grid, the
 * unbounded default) is decided in a test rather than in a template.
 *
 * Every boundary goes through `@shared/day`. There is no `new Date` arithmetic
 * and no `getDay`/`getDate` in this file: a week that starts on the wrong day
 * once a year is exactly the defect `convex/lib/day.ts` exists to prevent.
 */

/** Inclusive day bounds, both always set. */
export type DayRange = { from: DayString; to: DayString }

/**
 * The selected range, where `null` is "All dates" — genuinely unbounded, not a
 * very wide range.
 *
 * It has to be its own case rather than `{ from: "1970-01-01", to: today }`
 * because it selects a different QUERY: `entries.listPage`, paginated newest
 * first with a "Load earlier entries" button, which is what /timer has always
 * done and what a user who never touches this control must keep getting.
 */
export type TimerRange = DayRange | null

export type TimerPreset =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | "last-30-days"
  | "all-dates"

/** Sentence case, per The Sentence Case Rule. */
export const TIMER_PRESET_LABELS: Record<TimerPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  "last-week": "Last week",
  "last-30-days": "Last 30 days",
  "all-dates": "All dates",
}

/**
 * THE CALENDAR'S LIST IS SHORTER, AND NOT BY OVERSIGHT.
 *
 * A time grid is a picture of a day at a fixed pixels-per-hour — 48px an hour,
 * a full 24-hour axis, one column per day. Thirty columns of that is neither
 * readable nor what the view is for: you go to the grid to see the SHAPE of a
 * day, and you go to the list to scan a month. So "Last 30 days" is absent
 * here, and `calendarSnap` below is what stops a wide selection made in List
 * from arriving as thirty unusable columns when the view is switched.
 *
 * "All dates" is absent for the stronger reason that it is not a range at all
 * — see `TimerRange`.
 */
export const CALENDAR_PRESETS: ReadonlyArray<TimerPreset> = [
  "today",
  "yesterday",
  "this-week",
  "last-week",
]

export const LIST_PRESETS: ReadonlyArray<TimerPreset> = [
  ...CALENDAR_PRESETS,
  "last-30-days",
  "all-dates",
]

export function presetsFor(view: "calendar" | "list"): ReadonlyArray<TimerPreset> {
  return view === "calendar" ? CALENDAR_PRESETS : LIST_PRESETS
}

/** How many columns a size draws. See `rangeOf` for where the days come from. */
export function sizeWidth(size: CalendarSize): number {
  return size === "day" ? 1 : size === "5day" ? 5 : 7
}

/** The days a preset means, or `null` for the unbounded one. */
export function presetRange(
  preset: TimerPreset,
  today: DayString,
  weekStartDay: number
): TimerRange {
  switch (preset) {
    case "today":
      return { from: today, to: today }
    case "yesterday": {
      const day = addDays(today, -1)
      return { from: day, to: day }
    }
    case "this-week": {
      const first = weekStartOf(today, weekStartDay)
      return { from: first, to: addDays(first, 6) }
    }
    case "last-week": {
      const first = weekStartOf(addDays(today, -7), weekStartDay)
      return { from: first, to: addDays(first, 6) }
    }
    case "last-30-days":
      // Thirty days INCLUDING today, so the label and the span agree.
      return { from: addDays(today, -29), to: today }
    case "all-dates":
      return null
  }
}

/**
 * The width a preset also sets, for the four the calendar offers.
 *
 * A preset sets WHERE and HOW WIDE together: picking "Today" on the grid means
 * one column, not this week with today somewhere in it. `null` for the two
 * List-only presets, which have no width a grid could draw — `calendarSnap`
 * decides what happens to those if the view is switched under them.
 */
export function presetSize(preset: TimerPreset): CalendarSize | null {
  if (preset === "today" || preset === "yesterday") return "day"
  if (preset === "this-week" || preset === "last-week") return "week"
  return null
}

/**
 * Which preset the current selection IS, so the rail can show it pressed.
 *
 * Computed rather than stored beside the range. A stored "active preset" is a
 * second source of truth for the same fact, and it goes stale the moment an
 * arrow steps the range out from under it — which is precisely when the rail
 * must stop claiming "This week".
 */
export function activePreset(
  range: TimerRange,
  today: DayString,
  weekStartDay: number
): TimerPreset | null {
  if (range === null) return "all-dates"
  for (const preset of LIST_PRESETS) {
    const candidate = presetRange(preset, today, weekStartDay)
    if (
      candidate !== null &&
      candidate.from === range.from &&
      candidate.to === range.to
    ) {
      return preset
    }
  }
  return null
}

/**
 * The arrows: the range moved by its own width, keeping its length.
 *
 * THE 5-DAY VIEW IS THE EXCEPTION, and it is not arbitrary. Mon–Fri is the
 * working week with the weekend HIDDEN, so the thing on either side of it is
 * the next working week, seven days away — stepping by its own five would put
 * the anchor on Saturday, which `rangeOf` resolves straight back to the Monday
 * it started from. An arrow that does nothing.
 *
 * `size` is `null` in List view, where there is no grid and no hidden weekend:
 * a range there steps by exactly as many days as it covers.
 */
export function stepRange(
  range: DayRange,
  size: CalendarSize | null,
  delta: -1 | 1
): DayRange {
  const span = daysBetween(range.from, range.to) + 1
  const stride = size === "5day" ? 7 : span
  return {
    from: addDays(range.from, delta * stride),
    to: addDays(range.to, delta * stride),
  }
}

/**
 * The selection, made drawable.
 *
 * THE CONSTRAINT, NOT A SUGGESTION. The Calendar view can only ever show what
 * `rangeOf` produces for some (anchor, size) — that is the whole point of the
 * inversion this feature was rebuilt around, where the page computes the window
 * and the grid is told to draw it. So a selection arriving from List that no
 * size can express is snapped here, in one place, rather than handed to a grid
 * that would silently draw something else.
 *
 * The rule: keep the current size when the selection FITS inside it, and fall
 * back to the week containing the selection's start when it does not. "Last 30
 * days" and "All dates" both land on that fallback, which is the readable thing
 * a time grid can actually say about a wide span — thirty columns at 48px an
 * hour is not.
 *
 * Returns the size as well as the range because the two must change together:
 * the size is what the arrows step by, and a size left over from a selection it
 * cannot draw would step the wrong distance on the very next click.
 */
export function calendarSnap(
  range: TimerRange,
  size: CalendarSize,
  today: DayString,
  weekStartDay: number,
  timeZone: string
): { size: CalendarSize; range: DayRange } {
  const anchor = range?.from ?? today
  const span =
    range === null ? Number.POSITIVE_INFINITY : daysBetween(range.from, range.to) + 1
  const drawn = span > sizeWidth(size) ? "week" : size
  const days = rangeOf(anchor, drawn, weekStartDay, timeZone).days
  return {
    size: drawn,
    range: { from: days[0], to: days[days.length - 1] },
  }
}

/** The instants a bounded range means, for `entries.listRange`. Half-open. */
export function instantsOf(
  range: DayRange,
  timeZone: string
): { fromMs: number; toMs: number } {
  return {
    fromMs: dayWindow(range.from, timeZone).fromMs,
    toMs: dayWindow(range.to, timeZone).toMs,
  }
}

/**
 * What the pill shows when nothing is bounded.
 *
 * The FORMAT rather than a word, because the control is a date-range field and
 * an empty one says what it wants by showing its own shape. It is also what the
 * reference screenshot carries.
 */
export const RANGE_PLACEHOLDER = "MM/DD/YYYY - MM/DD/YYYY"

/**
 * The pill's own text: "08/10/2026 - 08/16/2026".
 *
 * `usDate`, the one date format this product PRINTS — the same one on the
 * invoices and the PDF reports, so a range typed into an invoice's period field
 * reads identically to the range it was taken from. A plain hyphen with spaces,
 * matching the placeholder above: this is the machine-shaped rendering of a
 * date, and the en dash belongs with the prose one (`formatDayRange`), which is
 * what a screen reader gets — see `rangeSpokenLabel`.
 */
export function rangePillLabel(range: TimerRange): string {
  if (range === null) return RANGE_PLACEHOLDER
  return `${usDate(range.from)} - ${usDate(range.to)}`
}

/**
 * The pill's ACCESSIBLE NAME, which is a different sentence from its text.
 *
 * "zero eight slash one zero slash two zero two six" is what a screen reader
 * makes of the pill above, twice over, and it answers none of the questions the
 * control is there to answer. The prose labels do: `calendarLabel` is the
 * calendar's own vocabulary and says "This week · 10–16 Aug", and it is the
 * ONLY consumer of that function now the bare stepper is gone — worth keeping
 * precisely because it is the honest name for the window the grid drew.
 *
 * `size` is `null` in List view, where the range is any span at all rather than
 * a grid's window, so it is named the way /reports names its own custom ranges.
 */
export function rangeSpokenLabel(
  range: TimerRange,
  size: CalendarSize | null,
  today: DayString
): string {
  if (range === null) return TIMER_PRESET_LABELS["all-dates"]
  if (size === null) return formatDayRange(range.from, range.to)
  return calendarLabel(range.from, range.to, size, today)
}
