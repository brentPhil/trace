/**
 * Day boundaries in the user's IANA timezone.
 *
 * Entries are stored as UTC instants and grouped by the user's local day.
 * Nothing in this product stores a local date — see the plan, §2.1. That means
 * every "which day is this" question routes through this file, and every
 * grouping the user sees (the log, the day totals, the recap) resolves through
 * the same two functions, so they cannot disagree with each other.
 *
 * Pure. No Convex imports, no DOM. Runs identically on both sides of the wire.
 */

const DAY_MS = 86_400_000

/** "YYYY-MM-DD". Not a Date, not an instant — a local calendar date. */
export type DayString = string

type LocalParts = {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number // 0-23
  minute: number
  second: number
}

// Intl.DateTimeFormat construction is expensive relative to formatting, and
// these get called in a loop over a day's entries.
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone)
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    formatterCache.set(timeZone, f)
  }
  return f
}

/**
 * The wall-clock fields an instant shows in a zone.
 *
 * Built from formatToParts rather than a formatted string so no locale's date
 * ordering or separator can change the result.
 */
export function localPartsOf(instantMs: number, timeZone: string): LocalParts {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instantMs))
  const get = (type: Intl.DateTimeFormatPartTypes) => {
    const p = parts.find((x) => x.type === type)
    if (p === undefined) {
      throw new Error(`Intl did not return a "${type}" part for ${timeZone}`)
    }
    return Number(p.value)
  }
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Some ICU builds emit 24 for midnight under a 24-hour cycle. Cheap guard
    // against a class of bug that would silently move an entry a day.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  }
}

/** The zone's UTC offset, in ms, at a given instant. Always whole minutes. */
function offsetMsAt(instantMs: number, timeZone: string): number {
  const p = localPartsOf(instantMs, timeZone)
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  // The parts carry no milliseconds, so compare against a second-floored
  // instant or every offset comes out wrong by the sub-second remainder.
  return asIfUtc - Math.floor(instantMs / 1000) * 1000
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** The local calendar date an instant falls on, as "YYYY-MM-DD". */
export function dayOf(instantMs: number, timeZone: string): DayString {
  const p = localPartsOf(instantMs, timeZone)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

/** Parses "YYYY-MM-DD". Throws rather than coercing — a bad day string here
 *  would silently return the wrong set of entries. */
export function parseDayString(day: DayString): {
  year: number
  month: number
  day: number
} {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (m === null) {
    throw new Error(`Expected a YYYY-MM-DD day string, got "${day}"`)
  }
  const year = Number(m[1])
  const month = Number(m[2])
  const dayOfMonth = Number(m[3])
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) {
    throw new Error(`"${day}" is not a valid calendar date`)
  }
  return { year, month, day: dayOfMonth }
}

/**
 * The UTC instant at which a given local wall-clock time occurs in a zone.
 *
 * This is THE function. Both DST edge cases are handled explicitly, because
 * both produce billing errors and the obvious implementation gets one of them
 * wrong in a way that depends on which zone you are in:
 *
 *   AMBIGUOUS (autumn fold — 01:30 happens twice) -> the FIRST occurrence.
 *   NONEXISTENT (spring gap — 02:30 never happens) -> falls FORWARD past the
 *     gap, matching both `new Date(y, m, d, h, mi)` and Temporal's
 *     "compatible" disambiguation.
 *
 * The naive two-pass version (`a = naive - off(naive); b = naive - off(a);
 * if (a === b) return a`) converges on *some* ambiguous inputs and so returns
 * the second occurrence in Europe/London and the first in America/New_York —
 * inverting its own stated policy in half the world, with nothing in the code
 * to tell you which half you are in. Hence the explicit candidate check below.
 */
export function instantOfLocal(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): number {
  // The requested wall-clock fields read as though they were UTC. The true
  // instant is this minus the zone's offset — but which offset applies is
  // exactly what is in question across a transition.
  const naive = Date.UTC(year, month - 1, day, hour, minute, second)

  // Probe a day either side. Any single transition near the target is bracketed
  // (real offsets span -12h..+14h, so the true instant is well inside), and no
  // zone has two transitions inside 48 hours.
  const offsetBefore = offsetMsAt(naive - DAY_MS, timeZone)
  const offsetAfter = offsetMsAt(naive + DAY_MS, timeZone)

  const candidateA = naive - offsetBefore
  const candidateB = naive - offsetAfter

  const matches = (instant: number) => {
    const p = localPartsOf(instant, timeZone)
    return (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute &&
      p.second === second
    )
  }

  const valid: Array<number> = []
  if (matches(candidateA)) valid.push(candidateA)
  if (candidateB !== candidateA && matches(candidateB)) valid.push(candidateB)

  if (valid.length > 0) {
    // One candidate: unambiguous. Two: the fold, and the policy is the first.
    return Math.min(...valid)
  }

  // Neither candidate round-trips: the requested local time does not exist.
  // The larger candidate is the one computed with the pre-transition offset,
  // which lands after the gap — i.e. 02:30 on a spring-forward morning
  // resolves to 03:30, never to 01:30.
  return Math.max(candidateA, candidateB)
}

/** Local midnight that starts a given day, as a UTC instant. */
export function startOfDay(day: DayString, timeZone: string): number {
  const d = parseDayString(day)
  return instantOfLocal(d.year, d.month, d.day, 0, 0, 0, timeZone)
}

/** Adds days to a "YYYY-MM-DD" string. Calendar arithmetic, zone-independent. */
export function addDays(day: DayString, delta: number): DayString {
  const d = parseDayString(day)
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day) + delta * DAY_MS)
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(
    shifted.getUTCDate()
  )}`
}

/**
 * The half-open instant range [fromMs, toMs) covering a local day.
 *
 * Half-open deliberately: an entry starting exactly at midnight belongs to the
 * day that is beginning, and belongs to exactly one day. Every entry query
 * ranges on this, so a closed range would double-count the boundary instant.
 *
 * The range is derived from the *next day's* midnight rather than
 * `fromMs + 86_400_000`, so DST days are 23 or 25 hours long and no hour is
 * lost or counted twice.
 */
export function dayWindow(
  day: DayString,
  timeZone: string
): { fromMs: number; toMs: number } {
  return {
    fromMs: startOfDay(day, timeZone),
    toMs: startOfDay(addDays(day, 1), timeZone),
  }
}

/** Day of the week for a day string. 0 = Sunday. Zone-independent. */
export function weekdayOf(day: DayString): number {
  const d = parseDayString(day)
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()
}

/**
 * The half-open range covering the local week containing `day`.
 *
 * `weekStartDay` is 0 (Sunday) through 6, matching userSettings.weekStartDay.
 * Honouring it from the first week query is cheaper than retrofitting it: the
 * "this week" total is one of the two numbers a freelancer looks at all day,
 * and it is wrong for most of the world if Sunday is assumed.
 */
export function weekWindow(
  day: DayString,
  timeZone: string,
  weekStartDay: number
): { fromMs: number; toMs: number; firstDay: DayString; lastDay: DayString } {
  const offset = (weekdayOf(day) - weekStartDay + 7) % 7
  const firstDay = addDays(day, -offset)
  const lastDay = addDays(firstDay, 6)
  return {
    fromMs: startOfDay(firstDay, timeZone),
    toMs: startOfDay(addDays(firstDay, 7), timeZone),
    firstDay,
    lastDay,
  }
}

/** Whether an IANA zone name is one this runtime can actually resolve. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}
