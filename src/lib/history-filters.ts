import { addDays, dayOf, dayWindow, weekWindow } from "@shared/day"
import {
  NO_PROJECT_FILTER,
  isFilterActive,
  matchesFilter,
} from "@shared/entryFilter"
import { NO_PROJECT_LABEL } from "@shared/labels"
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
 * billable. Reports layers a date range and preset chips around these.
 *
 * `Filters` satisfies this shape structurally, so `matches` and
 * `hasClientSideFilter` below accept either — and `FilterControls` is generic
 * over it, so a caller with only these three fields can render the bar without
 * fabricating a period it has no UI for. /timer was that caller until its
 * filter bar was replaced by a date range; the type stays because it is the
 * honest statement of what those functions actually read.
 */
export type QuickFilters = {
  projectId: string | null
  billableOnly: boolean
  text: string
}

export function defaultFilters(
  today: DayString,
  weekStartDay: number
): Filters {
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

/**
 * The active filters, in words — "project Acme", "billable only", "search …".
 *
 * FOR TEXT THAT LEAVES THE SCREEN. The filter bar is self-describing while you
 * are looking at it, so nothing on /reports needs this; the clipboard writer
 * does, because a week's rows pasted into a standup note look like the whole
 * week, and the three hours a project filter removed are invisible in the
 * paste. Naming the narrowing is what stops the copy from being a quiet
 * overclaim.
 *
 * The RANGE is deliberately absent — it is not a narrowing of the log so much
 * as the log's subject, and `entriesText` prints it as the heading rather than
 * as one item in a list.
 *
 * `projectName` answers `null` for an id it does not recognise, which is a
 * real case: a project archived and then deleted in another tab leaves its id
 * in `filters`. Named as unknown rather than printed as an opaque id, for the
 * same reason /invoices/new does it — the reader can then explain the short
 * list instead of wondering about it.
 */
export function narrowingLabels(
  filters: FilterInput,
  projectName: (id: string) => string | null
): Array<string> {
  const filter = entryFilterOf(filters)
  const labels: Array<string> = []

  if (filter.projectId !== null) {
    labels.push(
      // NO `project ` PREFIX on the sentinel. It names a bucket rather than a
      // client, and its label is already a whole phrase — prefixing it read
      // "project no project" in a document written to be pasted into a message.
      filter.projectId === NO_PROJECT_FILTER
        ? NO_PROJECT_LABEL.toLowerCase()
        : `project ${projectName(filter.projectId) ?? "unknown"}`
    )
  }
  if (filter.billableOnly) labels.push("billable only")
  if (filter.text.trim() !== "") labels.push(`search “${filter.text.trim()}”`)
  for (const preset of filter.presets) {
    labels.push(PRESET_LABELS[preset].toLowerCase())
  }

  return labels
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
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000
  )
}

/*
 * CALENDAR-MONTH ARITHMETIC, and the one copy of it.
 *
 * Exported because `date-range-picker.ts` had its own `firstOfMonth`/
 * `lastOfMonth` pair doing exactly this — in a file that already imports from
 * here — on the stated ground that a local `Date` cannot be trusted with
 * `getMonth`/`getFullYear`. That ground does not apply: nothing below reads a
 * local field. The `Date` is seeded in UTC and every write and read goes
 * through `setUTCFullYear` and `dayOf(…, "UTC")`, so the browser's zone never
 * enters the calculation and the DST/offset hazard the picker was avoiding is
 * not present to avoid.
 *
 * The same class the branch already deduplicated for month NAMES
 * (`date-names.ts`); this is the arithmetic it missed.
 */

/** The first day of the month `day` falls in. */
export function monthStart(day: DayString): DayString {
  return `${day.slice(0, 7)}-01`
}

/** The last day of the month `day` falls in. */
export function monthEnd(day: DayString): DayString {
  const [year, month] = day.split("-").map(Number)
  // Day 0 of the NEXT month is the last day of this one, and it is correct for
  // February in a leap year without a table.
  const last = new Date(Date.UTC(2000, 0, 1))
  last.setUTCFullYear(year, month, 0)
  return dayOf(last.getTime(), "UTC")
}

/** The same day-of-month one calendar month either side, clamped to the 1st. */
export function shiftMonth(day: DayString, direction: -1 | 1): DayString {
  const [year, month] = day.split("-").map(Number)
  const shifted = new Date(Date.UTC(2000, 0, 1))
  // Day 1 of the shifted month, so a 31st never overflows into the month after.
  shifted.setUTCFullYear(year, month - 1 + direction, 1)
  return dayOf(shifted.getTime(), "UTC")
}
