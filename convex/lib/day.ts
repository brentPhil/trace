/**
 * Day boundaries in the user's IANA timezone.
 *
 * Entries are stored as UTC instants and grouped by the user's local day.
 * Nothing in this product stores a local date — see the plan, §2.1. That means
 * every "which day is this" question routes through this file, and every
 * grouping the user sees (the log, the day totals, Reports) resolves through
 * the same two functions, so they cannot disagree with each other.
 *
 * Pure. No Convex imports, no DOM. Runs identically on both sides of the wire.
 */

const DAY_MS = 86_400_000

/**
 * `Date.UTC` for calendar fields, without the two-digit-year trap.
 *
 * The `Date.UTC` constructor maps years 0-99 to 1900+, so year 50 silently
 * becomes 1950. Unreachable with a real tracked timestamp, but this file had
 * three separate call sites and leaving two of them coerce while one does not
 * is how a module stops being trustworthy at its edges.
 */
function utcInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): number {
  const d = new Date(0)
  d.setUTCFullYear(year, month - 1, day)
  d.setUTCHours(hour, minute, second, 0)
  return d.getTime()
}

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

/**
 * The zone's UTC offset, in ms, at a given instant.
 *
 * Not always a whole number of minutes: pre-standardisation local mean time
 * carries seconds (America/New_York was -4:56:02 in 1880). The second-flooring
 * below is what makes those come out right, so do not "simplify" it away.
 */
function offsetMsAt(instantMs: number, timeZone: string): number {
  const p = localPartsOf(instantMs, timeZone)
  const asIfUtc = utcInstant(p.year, p.month, p.day, p.hour, p.minute, p.second)
  // The parts carry no milliseconds, so compare against a second-floored
  // instant or every offset comes out wrong by the sub-second remainder.
  return asIfUtc - Math.floor(instantMs / 1000) * 1000
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function pad4(n: number): string {
  return String(n).padStart(4, "0")
}

/** The local calendar date an instant falls on, as "YYYY-MM-DD". */
export function dayOf(instantMs: number, timeZone: string): DayString {
  const p = localPartsOf(instantMs, timeZone)
  // The year is padded so the output is always a DayString parseDayString
  // accepts — the two functions are each other's inverse and must agree on the
  // shape, not only on the value.
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`
}

/**
 * Parses "YYYY-MM-DD". Throws rather than coercing.
 *
 * The round-trip check is the point. A month-independent 1-31 range would let
 * "2026-02-31" through, and `Date.UTC` would roll it forward to 3 March — so
 * `dayWindow("2026-02-31")` and `dayWindow("2026-03-03")` returned byte-
 * identical ranges. Two distinct day keys mapping to one window means an
 * aggregate over a caller-supplied list of days can bill the same entries
 * twice, under a heading for a date that does not exist.
 */
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

  // setUTCFullYear rather than the Date.UTC constructor: the constructor maps
  // years 0-99 to 1900+, so "0050-06-15" would validate as 1950.
  const probe = new Date(utcInstant(year, month, dayOfMonth))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== dayOfMonth
  ) {
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
  const naive = utcInstant(year, month, day, hour, minute, second)

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

/**
 * Local midnight that starts a given day, as a UTC instant.
 *
 * Caveat, for completeness: five historical dates were erased entirely by
 * date-line changes (Pacific/Apia skipped 30 Dec 2011; Pacific/Kiritimati
 * skipped 31 Dec 1994). For those, this returns the instant the day *would*
 * have started, and dayWindow's range comes back zero-length. Consecutive days
 * still abut exactly, so nothing is double-counted or lost — but a caller
 * dividing by `toMs - fromMs` must not assume it is positive.
 */
export function startOfDay(day: DayString, timeZone: string): number {
  const d = parseDayString(day)
  return instantOfLocal(d.year, d.month, d.day, 0, 0, 0, timeZone)
}

/** Adds days to a "YYYY-MM-DD" string. Calendar arithmetic, zone-independent. */
export function addDays(day: DayString, delta: number): DayString {
  const d = parseDayString(day)
  const shifted = new Date(utcInstant(d.year, d.month, d.day) + delta * DAY_MS)
  // The year is padded so DayString stays closed under this operation: an
  // unpadded "999-12-31" is a string parseDayString would then reject.
  return `${pad4(shifted.getUTCFullYear())}-${pad2(
    shifted.getUTCMonth() + 1
  )}-${pad2(shifted.getUTCDate())}`
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
  return new Date(utcInstant(d.year, d.month, d.day)).getUTCDay()
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
  // Validated rather than taken modulo 7. An ISO weekday (1-7, Monday-first)
  // has a 7 in it, and silently aliasing that to Sunday would shift every week
  // total by a day with nothing to notice. A non-integer used to be truncated;
  // a NaN used to throw an error blaming the (perfectly valid) day string.
  if (!Number.isInteger(weekStartDay) || weekStartDay < 0 || weekStartDay > 6) {
    throw new Error(`weekStartDay must be an integer 0-6, got ${weekStartDay}`)
  }
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
