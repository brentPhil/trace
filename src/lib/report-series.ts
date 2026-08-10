import { addDays, parseDayString } from "@shared/day"
import { daysBetween } from "@/lib/history-filters"
import type { DayString } from "@shared/day"

/**
 * Turning a sparse list of day totals into the bars a chart draws.
 *
 * Pure, and deliberately outside the chart components. The awkward parts — that
 * the server sends only days that HAVE entries, that a year of daily bars is
 * unreadable, that "no time tracked" and "no data for this day" are the same
 * shape in JSON and must not be the same shape on screen — are all decisions,
 * and a decision inside a render function is a decision nothing can test.
 */

/** One day's totals, as `entries.rangeBreakdown` returns them. */
export type DayTotal = {
  day: DayString
  totalMs: number
  billableMs: number
  billableCents: number
  count: number
}

/** One project's totals. `projectId: null` is the unassigned bucket. */
export type ProjectTotal = {
  projectId: string | null
  name: string
  color: string
  totalMs: number
  billableMs: number
  billableCents: number
  unratedBillableMs: number
  count: number
}

/**
 * Everything the Summary tab draws, as `entries.rangeBreakdown` returns it.
 *
 * Declared structurally rather than imported from the generated Convex API, so
 * every component below `src/components/reports` can be rendered against a
 * fixture with no backend at all — the same boundary `eslint.config.js`
 * enforces for writes, applied to reads because a chart is exactly the kind of
 * thing worth looking at under a dozen shapes of made-up data.
 */
export type Breakdown = {
  totalMs: number
  billableMs: number
  count: number
  runningCount: number
  truncated: boolean
  billableCents: number
  unratedBillableMs: number
  days: Array<DayTotal>
  projects: Array<ProjectTotal>
  hours: Array<number>
}

export type Granularity = "day" | "week" | "month"

export type Bucket = {
  /** The first day the bucket covers. Its identity and its sort key. */
  key: DayString
  /** The axis tick. Short, because there may be fifty of them. */
  label: string
  /** The tooltip heading: the span in full, with no abbreviation to decode. */
  title: string
  totalMs: number
  billableMs: number
  /** Kept as its own field rather than subtracted at render time, so the two
   *  stacked segments always sum to `totalMs` by construction. */
  nonBillableMs: number
  /** This bucket's own earnings. */
  billableCents: number
  /** Earnings from the start of the range through the END of this bucket. */
  earnedCents: number
  count: number
  /**
   * Nothing was tracked. NOT the same as `totalMs === 0` on a day that holds a
   * zero-length entry, and drawn differently: an empty span gets a hatch (see
   * the Hatch Rule in DESIGN.md), because absence is a texture, not a bar of
   * height zero that reads as "no data arrived".
   */
  empty: boolean
}

/*
 * Where daily bars stop being readable and become a comb.
 *
 * 45 covers every range with a day-shaped answer — a week, a fortnight, a
 * month, a month either side of a boundary — and stops short of a quarter,
 * where the question has already become "which weeks were heavy".
 */
const MAX_DAILY_BARS = 45
/* Two years of weekly bars is ~104, which is dense but still legible at full
 * width. Past it the honest unit is a month. */
const MAX_WEEKLY_DAYS = 730

export function granularityFor(from: DayString, to: DayString): Granularity {
  const span = daysBetween(from, to) + 1
  if (span <= MAX_DAILY_BARS) return "day"
  if (span <= MAX_WEEKLY_DAYS) return "week"
  return "month"
}

/**
 * Every bucket in `[from, to]`, including the ones with nothing in them.
 *
 * DENSIFIED HERE, not on the server. A fortnight where the user took Thursday
 * off has thirteen day rows, and drawing thirteen bars would quietly close the
 * gap — Thursday would vanish and the chart would read as an unbroken run of
 * work. The gap is the information.
 *
 * Weeks are counted from `from` rather than snapped to a calendar week start.
 * The user picked this range; re-cutting it against a week boundary they did
 * not choose puts a half-height bar at each end of every chart, which reads as
 * a drop in workload rather than an artefact of the bucketing.
 */
export function bucketDays(
  days: ReadonlyArray<DayTotal>,
  from: DayString,
  to: DayString
): { granularity: Granularity; buckets: Array<Bucket> } {
  const granularity = granularityFor(from, to)

  const byKey = new Map<DayString, { totalMs: number; billableMs: number; billableCents: number; count: number }>()
  for (const key of keysBetween(from, to, granularity)) {
    byKey.set(key, { totalMs: 0, billableMs: 0, billableCents: 0, count: 0 })
  }

  for (const day of days) {
    const slot = byKey.get(bucketKeyOf(day.day, granularity, from))
    // A day outside the requested range cannot happen — the query is bounded by
    // it — but silently dropping one is better than creating a bucket that no
    // axis tick covers, which would render as a bar floating past the end.
    if (slot === undefined) continue
    slot.totalMs += day.totalMs
    slot.billableMs += day.billableMs
    slot.billableCents += day.billableCents
    slot.count += day.count
  }

  let earnedCents = 0
  const buckets: Array<Bucket> = []
  for (const [key, slot] of byKey) {
    earnedCents += slot.billableCents
    buckets.push({
      key,
      label: labelOf(key, granularity),
      title: titleOf(key, granularity, to),
      totalMs: slot.totalMs,
      billableMs: slot.billableMs,
      nonBillableMs: slot.totalMs - slot.billableMs,
      billableCents: slot.billableCents,
      earnedCents,
      count: slot.count,
      empty: slot.count === 0,
    })
  }
  return { granularity, buckets }
}

/** The spans a range covers, in order, whether or not any work landed in them. */
function keysBetween(
  from: DayString,
  to: DayString,
  granularity: Granularity
): Array<DayString> {
  const keys: Array<DayString> = []
  const step = granularity === "day" ? 1 : granularity === "week" ? 7 : 0

  if (step > 0) {
    for (let day = from; day <= to; day = addDays(day, step)) keys.push(day)
    return keys
  }

  // Months, which are not a fixed number of days.
  let month = monthKey(from)
  const last = monthKey(to)
  while (month <= last) {
    keys.push(month)
    month = monthKey(addDays(month, 32))
  }
  return keys
}

function bucketKeyOf(
  day: DayString,
  granularity: Granularity,
  from: DayString
): DayString {
  if (granularity === "day") return day
  if (granularity === "month") return monthKey(day)
  return addDays(from, Math.floor(daysBetween(from, day) / 7) * 7)
}

function monthKey(day: DayString): DayString {
  return `${day.slice(0, 7)}-01`
}

/**
 * A day string as a formattable instant.
 *
 * Noon UTC, not local midnight, and formatted in UTC — the calendar date is
 * already decided by the time it reaches here, and noon is far enough from
 * either boundary that no zone offset can move the rendered weekday off it.
 * The same trick, for the same reason, as `dayLabel` in group-entries.ts.
 */
function atNoon(day: DayString): Date {
  const { year, month, day: date } = parseDayString(day)
  return new Date(Date.UTC(year, month - 1, date, 12))
}

function format(day: DayString, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(
    atNoon(day)
  )
}

/**
 * The axis tick.
 *
 * Weekday-and-date for a day, because "did I work on the Saturday" is a
 * question people actually ask of these bars and a bare number cannot answer
 * it. Recharts drops ticks that would collide, so this stays legible as the
 * range grows toward `MAX_DAILY_BARS` without a second, shorter format to
 * choose between.
 */
function labelOf(key: DayString, granularity: Granularity): string {
  if (granularity === "day") return format(key, { weekday: "short", day: "numeric" })
  if (granularity === "week") return format(key, { day: "numeric", month: "short" })
  return format(key, { month: "short", year: "2-digit" })
}

/** The tooltip heading. Unabbreviated, and for a span, both ends of it. */
function titleOf(key: DayString, granularity: Granularity, to: DayString): string {
  const full: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }
  if (granularity === "day") return format(key, full)

  const end = granularity === "week" ? addDays(key, 6) : addDays(monthKey(addDays(key, 32)), -1)
  // Never past the range the user asked for: a final partial week ending "9 Aug"
  // must not claim to cover the four days after it that nothing was queried for.
  const clamped = end > to ? to : end
  const short: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
  return `${format(key, short)} – ${format(clamped, { ...short, year: "numeric" })}`
}

/**
 * The heaviest span in the range, or null when nothing was tracked at all.
 *
 * Ties go to the EARLIER bucket, so the answer does not depend on iteration
 * order the reader cannot see.
 */
export function busiest(buckets: ReadonlyArray<Bucket>): Bucket | null {
  let best: Bucket | null = null
  for (const bucket of buckets) {
    if (bucket.totalMs > 0 && (best === null || bucket.totalMs > best.totalMs)) {
      best = bucket
    }
  }
  return best
}

/**
 * Milliseconds per local hour of the day, as chart rows.
 *
 * Always twenty-four rows, always in clock order — a chart of "when do I work"
 * with the empty hours omitted would compress 09:00–17:00 into the same width
 * as a whole day and hide the shape it exists to show.
 */
export function hourRows(
  hours: ReadonlyArray<number>,
  use12Hour: boolean
): Array<{ hour: number; label: string; totalMs: number }> {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: hourLabel(hour, use12Hour),
    totalMs: hours[hour] ?? 0,
  }))
}

/**
 * Y-axis ticks on round hours.
 *
 * Recharts divides the observed maximum into five and rounds each result, which
 * over a 9.9-hour day gives 0h, 3h, 5h, 8h, 10h — an axis whose gridlines are
 * unevenly spaced AND unevenly valued. A reader estimating a bar against that is
 * being misled by the scale itself, which is the one part of a chart that has to
 * be beyond question.
 *
 * Steps are chosen from hours people actually think in, and the top is rounded
 * UP to one, so the tallest bar always sits under the last gridline rather than
 * touching the ceiling.
 */
const NICE_HOURS = [1, 2, 3, 4, 6, 8, 12, 24, 48]

export function hourTicks(maxMs: number): Array<number> {
  const hours = maxMs / 3_600_000
  const step = NICE_HOURS.find((n) => hours / n <= 5) ?? Math.ceil(hours / 5)
  const top = Math.max(step, Math.ceil(hours / step) * step)
  const ticks: Array<number> = []
  for (let hour = 0; hour <= top; hour += step) ticks.push(hour * 3_600_000)
  return ticks
}

function hourLabel(hour: number, use12Hour: boolean): string {
  if (!use12Hour) return `${String(hour).padStart(2, "0")}:00`
  if (hour === 0) return "12am"
  if (hour === 12) return "12pm"
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`
}
