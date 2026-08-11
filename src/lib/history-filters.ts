import { addDays, dayOf, dayWindow, weekWindow } from "@shared/day"
import { isFilterActive, matchesFilter } from "@shared/entryFilter"
import type { DayString } from "@shared/day"
import type { EntryFilter, Preset } from "@shared/entryFilter"
import type { Doc } from "../../convex/_generated/dataModel"

/**
 * The history view's filter model, as a pure function.
 *
 * Kept out of the component so the awkward parts — which filters the server can
 * apply, what "under a minute" means, how a period steps — are testable and
 * stated once.
 *
 * WHAT an entry has to look like to survive is NOT stated here: that is
 * `convex/lib/entryFilter.ts`, which the server's `entries.rangeBreakdown` runs
 * over the same rows. Reports' Summary tab and its Detailed tab share one
 * the filter bar, so they have to share one definition of "matches" — this file is
 * the client's half of the wiring (period stepping, the range, the
 * presets-or-not union) and delegates the predicate itself.
 */

export type Period = "day" | "week" | "month" | "custom"

export type { Preset, EntryFilter }

/**
 * What each preset chip is CALLED, in one place.
 *
 * Written down because it is now read twice: the chips on /reports' filter bar,
 * and `/invoices/new`, which has to state the filter a link carried it — there
 * is no filter bar on that page, so the only way a user can check that the
 * preview bills what they narrowed to is for the page to name the narrowing.
 * Two spellings is how a chip labelled "No note" comes to be reported as
 * "no-note" on the page that decides whether to bill a client.
 */
export const PRESET_LABELS: Record<Preset, string> = {
  "no-project": "No project",
  "no-note": "No note",
  "under-a-minute": "Under a minute",
}

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

/**
 * The three filters that do not depend on a bounded range: text, project,
 * billable. Reports layers a date range and preset chips around these;
 * Timer's range is all of history, so these are all it can honestly offer.
 * `Filters` satisfies this shape structurally, so `matches` and
 * `hasClientSideFilter` below accept either without Timer having to carry a
 * period it has no UI for and cannot express.
 */
export type QuickFilters = {
  projectId: string | null
  billableOnly: boolean
  text: string
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

/**
 * The day bounds a period computes for `today`, and nothing else.
 *
 * Separate from `periodFilters` because the range picker's trigger label needs
 * only this — it asks "is the range on screen still what 'this week' means?"
 * and has no filter state to thread through. Going through `periodFilters` for
 * that meant fabricating a whole `Filters` object to read two fields back out
 * of, so the filler values (`projectId: null`, `billableOnly: false`) sat there
 * looking like they meant something.
 */
export function periodWindow(
  period: Exclude<Period, "custom">,
  today: DayString,
  weekStartDay: number
): { from: DayString; to: DayString } {
  if (period === "day") return { from: today, to: today }
  if (period === "week") {
    const week = weekWindow(today, "UTC", weekStartDay)
    return { from: week.firstDay, to: week.lastDay }
  }
  return { from: monthStart(today), to: monthEnd(today) }
}

export function periodFilters(
  period: Exclude<Period, "custom">,
  today: DayString,
  weekStartDay: number,
  current: Filters
): Filters {
  return { ...current, period, ...periodWindow(period, today, weekStartDay) }
}

/**
 * What `matches` and `hasClientSideFilter` accept: EITHER the full Reports
 * filter set, which always carries its presets, OR Timer's three, which has no
 * preset UI and therefore no preset field at all.
 *
 * A union, not `QuickFilters & { presets?: Array<Preset> }`. The optional form
 * made "I have presets and forgot to pass them" and "I have no presets"
 * indistinguishable — both compiled, and one of them silently skipped preset
 * filtering. Here, a value typed `Filters` cannot arrive with its presets
 * missing, and a value typed `QuickFilters` cannot have any to lose.
 */
export type FilterInput = Filters | QuickFilters

const EMPTY_PRESETS: ReadonlyArray<Preset> = []

/**
 * The union above, flattened into the one shape the shared predicate takes.
 *
 * `Filters` always carries an array; `QuickFilters` has no such field, so there
 * is nothing to default and nothing to forget. Exported because
 * `entries.rangeBreakdown` takes exactly these four fields as arguments — the
 * server applies them to the whole range, so this is also what a caller sends
 * over the wire.
 */
export function entryFilterOf(filters: FilterInput): EntryFilter {
  return {
    projectId: filters.projectId,
    billableOnly: filters.billableOnly,
    text: filters.text,
    presets: "presets" in filters ? filters.presets : EMPTY_PRESETS,
  }
}

/**
 * Whether an entry survives the filters the DETAILED tab could not push down.
 *
 * The date range is an index prefix and is already applied. Everything here is
 * a scan over what is loaded, which is exactly the trade the plan makes for
 * MVP text search: correct and cheap inside a bounded range, and — unlike a
 * search index — it composes with the date filter instead of fighting it.
 *
 * The rule itself lives in `convex/lib/entryFilter.ts`, so the Summary tab's
 * server-side aggregate over the same range keeps the same rows this keeps.
 */
export function matches(
  entry: Doc<"timeEntries">,
  filters: FilterInput,
  projectName: (id: string | undefined) => string
): boolean {
  return matchesFilter(entry, entryFilterOf(filters), projectName)
}

/** True when a filter is active that the server range query cannot express. */
export function hasClientSideFilter(filters: FilterInput): boolean {
  return isFilterActive(entryFilterOf(filters))
}

// ---------------------------------------------------------------------------

/**
 * Calendar days between two day strings, signed.
 *
 * Counted from the DATES, not from the instants: two days can be 23 or 25
 * hours apart across a DST boundary, and "yesterday" must not depend on which.
 * Exported because `staged-start.ts` asks the same question of the same type —
 * a second copy is how the timer bar's "3 days ago" and Reports' period
 * stepping come to disagree about a day boundary.
 */
export function daysBetween(from: DayString, to: DayString): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  )
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
