import { addDays, dayOf, dayWindow, weekWindow } from "@shared/day"
import type { DayString } from "@shared/day"
import type { Doc } from "../../convex/_generated/dataModel"

/**
 * The history view's filter model, as a pure function.
 *
 * Kept out of the component so the awkward parts — which filters the server can
 * apply, what "under a minute" means, how a period steps — are testable and
 * stated once.
 */

export type Period = "day" | "week" | "month" | "custom"

export type Preset = "no-project" | "no-note" | "under-a-minute"

export type Filters = {
  period: Period
  /** Inclusive day bounds, always both set. */
  from: DayString
  to: DayString
  projectId: string | null
  billableOnly: boolean
  text: string
  presets: Array<Preset>
}

export function defaultFilters(today: DayString, weekStartDay: number): Filters {
  const week = weekWindow(today, "UTC", weekStartDay)
  return {
    period: "week",
    from: week.firstDay,
    to: week.lastDay,
    projectId: null,
    billableOnly: false,
    text: "",
    presets: [],
  }
}

/** The instants the server range query needs. Half-open, like every window. */
export function rangeOf(filters: Filters, timeZone: string) {
  return {
    fromMs: dayWindow(filters.from, timeZone).fromMs,
    toMs: dayWindow(filters.to, timeZone).toMs,
  }
}

/**
 * Steps the range one period back or forward, preserving its length.
 *
 * A custom range steps by its own span, so `←` on "3 Aug – 9 Aug" gives
 * "27 Jul – 2 Aug" rather than snapping to a calendar week the user did not
 * ask for. Every other filter is untouched, which is the whole point: stepping
 * is for comparing the same view across time.
 */
export function stepPeriod(filters: Filters, direction: -1 | 1): Filters {
  if (filters.period === "month") {
    const from = shiftMonth(filters.from, direction)
    return { ...filters, from: monthStart(from), to: monthEnd(from) }
  }

  const span = daysBetween(filters.from, filters.to) + 1
  return {
    ...filters,
    from: addDays(filters.from, direction * span),
    to: addDays(filters.to, direction * span),
  }
}

export function periodFilters(
  period: Exclude<Period, "custom">,
  today: DayString,
  weekStartDay: number,
  current: Filters
): Filters {
  if (period === "day") return { ...current, period, from: today, to: today }
  if (period === "week") {
    const week = weekWindow(today, "UTC", weekStartDay)
    return { ...current, period, from: week.firstDay, to: week.lastDay }
  }
  return { ...current, period, from: monthStart(today), to: monthEnd(today) }
}

/**
 * Whether an entry survives the filters the SERVER could not apply.
 *
 * The date range is an index prefix and is already applied. Everything here is
 * a scan over what is loaded, which is exactly the trade the plan makes for
 * MVP text search: correct and cheap inside a bounded range, and — unlike a
 * search index — it composes with the date filter instead of fighting it.
 */
export function matches(
  entry: Doc<"timeEntries">,
  filters: Filters,
  projectName: (id: string | undefined) => string
): boolean {
  if (filters.projectId !== null) {
    // "" is the sentinel for "no project", so the filter can express it.
    const want = filters.projectId === "" ? undefined : filters.projectId
    if (entry.projectId !== want) return false
  }

  if (filters.billableOnly && !entry.billable) return false

  for (const preset of filters.presets) {
    if (preset === "no-project" && entry.projectId !== undefined) return false
    if (preset === "no-note" && (entry.note ?? "").trim() !== "") return false
    // Strictly under a minute. The chip exists to find mis-starts — a timer
    // begun and stopped by accident — so an exact 60s entry is not one.
    if (preset === "under-a-minute" && (entry.durationMs ?? 0) >= 60_000) return false
  }

  const needle = filters.text.trim().toLowerCase()
  if (needle !== "") {
    // Title, note AND project name. Searching only the title would miss the
    // field this product exists to collect.
    const haystack = [
      entry.title,
      entry.note ?? "",
      projectName(entry.projectId),
    ]
      .join(" ")
      .toLowerCase()
    if (!haystack.includes(needle)) return false
  }

  return true
}

/** True when a filter is active that the server range query cannot express. */
export function hasClientSideFilter(filters: Filters): boolean {
  return (
    filters.projectId !== null ||
    filters.billableOnly ||
    filters.presets.length > 0 ||
    filters.text.trim() !== ""
  )
}

// ---------------------------------------------------------------------------

function daysBetween(from: DayString, to: DayString): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function monthStart(day: DayString): DayString {
  return `${day.slice(0, 7)}-01`
}

function monthEnd(day: DayString): DayString {
  const [year, month] = day.split("-").map(Number)
  // Day 0 of the NEXT month is the last day of this one, and it is correct for
  // February in a leap year without a table.
  const last = new Date(Date.UTC(2000, 0, 1))
  last.setUTCFullYear(year, month, 0)
  return dayOf(last.getTime(), "UTC")
}

function shiftMonth(day: DayString, direction: -1 | 1): DayString {
  const [year, month] = day.split("-").map(Number)
  const shifted = new Date(Date.UTC(2000, 0, 1))
  // Day 1 of the shifted month, so a 31st never overflows into the month after.
  shifted.setUTCFullYear(year, month - 1 + direction, 1)
  return dayOf(shifted.getTime(), "UTC")
}
