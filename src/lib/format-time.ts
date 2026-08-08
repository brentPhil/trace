import { addDays, dayOf, instantOfLocal, localPartsOf, parseDayString } from "@shared/day"
import type { DayString } from "@shared/day"
import type { TimeOfDay } from "@shared/timeOfDay"

const cache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string, use12Hour: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${use12Hour}`
  let f = cache.get(key)
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: use12Hour ? "numeric" : "2-digit",
      minute: "2-digit",
      hour12: use12Hour,
    })
    cache.set(key, f)
  }
  return f
}

/** `09:12` / `9:12 AM`, in the user's stored zone — never the browser's. */
export function formatTimeOfInstant(
  instantMs: number,
  timeZone: string,
  use12Hour: boolean
): string {
  return formatter(timeZone, use12Hour).format(new Date(instantMs)).toUpperCase()
}

/**
 * `09:12 – 10:58`, or `09:12 – …` while running.
 *
 * An en dash rather than a hyphen, and a real ellipsis for the open end: the
 * running entry has no end time yet, and printing "now" would be a value that
 * looks recorded when it is not.
 */
export function formatTimeRange(
  startedAt: number,
  endedAt: number | null,
  timeZone: string,
  use12Hour: boolean
): string {
  const start = formatTimeOfInstant(startedAt, timeZone, use12Hour)
  if (endedAt === null) return `${start} – …`
  return `${start} – ${formatTimeOfInstant(endedAt, timeZone, use12Hour)}`
}

/**
 * Turns "the wall-clock time the user typed" into an instant.
 *
 * `anchorMs` names the local day the typed time belongs to — for a start that
 * is the entry's own start, and for an end it is ALSO the start, because
 * `resolveEndAfterStart` expresses "past midnight" as `dayOffset: 1` relative
 * to the start rather than as a date of its own.
 *
 * Everything goes through `instantOfLocal`, which is the module that knows what
 * to do when the typed time is ambiguous (the hour that repeats when clocks go
 * back) or does not exist at all (the hour that is skipped when they go
 * forward). Doing the arithmetic here with a raw offset would be wrong twice a
 * year, in a way nobody would notice until an invoice was already sent.
 */
export function instantOfTypedTime(
  anchorMs: number,
  time: TimeOfDay,
  timeZone: string
): number {
  return instantOfDayTime(dayOf(anchorMs, timeZone), time, timeZone)
}

/** The same, anchored to a day string rather than to an existing entry. */
export function instantOfDayTime(
  day: DayString,
  time: TimeOfDay,
  timeZone: string
): number {
  const parts = parseDayString(addDays(day, time.dayOffset))
  return instantOfLocal(
    parts.year,
    parts.month,
    parts.day,
    Math.floor(time.minutes / 60),
    time.minutes % 60,
    0,
    timeZone
  )
}

/**
 * The same local time of day, on a different date.
 *
 * What a calendar pick means: "this happened at the same hour, but on the 5th".
 * Deliberately NOT `instantMs + n * 86_400_000` — a whole-day shift carries the
 * OLD offset across, so moving 09:00 BST into January lands on 08:00 GMT, and
 * moving anything onto a spring-forward morning lands in an hour the clock
 * skipped. Routing through `instantOfDayTime` re-resolves the offset at the
 * destination and applies the module's DST policy.
 */
export function instantMovedToDay(
  instantMs: number,
  day: DayString,
  timeZone: string
): number {
  return instantOfDayTime(
    day,
    { minutes: localMinutesOf(instantMs, timeZone), dayOffset: 0 },
    timeZone
  )
}

/** Minutes past local midnight for an instant — the parsers' reference point. */
export function localMinutesOf(instantMs: number, timeZone: string): number {
  const parts = localPartsOf(instantMs, timeZone)
  return parts.hour * 60 + parts.minute
}
