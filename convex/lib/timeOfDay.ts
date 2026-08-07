/**
 * Time-of-day input for manual mode.
 *
 * Backfilling is the most common repair action in a time tracker — you forgot
 * to start the timer, and now you are typing when it should have started. This
 * parser is what makes that fully keyboard-driven: `9` is unambiguous enough in
 * context that the user never has to type `09:00 AM`.
 *
 * Returns minutes past local midnight plus a day offset, not an instant. Whose
 * midnight is a separate question, answered by day.ts, and keeping the two
 * apart is what stops a timezone from leaking into a text parser.
 *
 * Pure. No Convex imports, no DOM.
 */

export type TimeOfDay = {
  /** 0-1439, minutes past local midnight. */
  minutes: number
  /** 0 for the reference day, 1 for the following day. */
  dayOffset: number
}

export type TimeParseResult =
  | { ok: true; time: TimeOfDay }
  | { ok: false; reason: "empty" | "unparseable" }

const MINUTES_PER_DAY = 1440

// "9", "09", "1430", "930"
const BARE = /^(\d{1,4})$/
// "9:30", "14:45", "9.30"
const SEPARATED = /^(\d{1,2})[:.](\d{2})$/
// "9a", "9am", "4p", "4pm", "9:30pm", "12.15 a.m."
const MERIDIEM = /^(\d{1,2})(?:[:.](\d{2}))?\s*(a|p)\.?m?\.?$/

/**
 * Parses a time of day the way a person types one.
 *
 *   9, 1-11    -> whichever of AM/PM is nearest to `nowMinutes` on the clock face
 *   0          -> 00:00
 *   12         -> by context: before 08:00 -> 00:00, 08:00-20:00 -> 12:00,
 *                 after 20:00 -> 00:00 the following day
 *   13-23      -> read as 24-hour
 *   930, 1430  -> h:mm without a separator
 *   9:30       -> as written
 *   9a 4pm     -> explicit meridiem always wins
 *
 * `nowMinutes` is the user's current local time, minutes past midnight. It is
 * only ever used to disambiguate, never to fill in a value the user did not
 * type, so the same input always produces the same visible echo before commit.
 */
export function parseTimeOfDay(input: string, nowMinutes: number): TimeParseResult {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ")
  if (text === "") return { ok: false, reason: "empty" }

  const meridiem = MERIDIEM.exec(text)
  if (meridiem !== null) {
    const rawHour = Number(meridiem[1])
    // `.at()` rather than `[n]`: TypeScript types a capture group as `string`,
    // but an unmatched optional group is `undefined` at runtime.
    const rawMinute = meridiem.at(2)
    const minute = rawMinute === undefined ? 0 : Number(rawMinute)
    if (rawHour < 1 || rawHour > 12 || minute > 59) return fail()
    // 12am is 00:xx and 12pm is 12:xx — the one place the 12-hour clock is
    // genuinely counter-intuitive, and worth handling rather than rejecting.
    const hour = meridiem[3] === "a" ? rawHour % 12 : (rawHour % 12) + 12
    return ok(hour * 60 + minute)
  }

  const separated = SEPARATED.exec(text)
  if (separated !== null) {
    const hour = Number(separated[1])
    const minute = Number(separated[2])
    if (hour > 23 || minute > 59) return fail()
    return ok(hour * 60 + minute)
  }

  const bare = BARE.exec(text)
  if (bare !== null) return parseBare(bare[1], nowMinutes)

  return fail()
}

function parseBare(digits: string, nowMinutes: number): TimeParseResult {
  // Three and four digits are a compact h:mm — "930", "1430".
  if (digits.length === 3 || digits.length === 4) {
    const hour = Number(digits.slice(0, digits.length - 2))
    const minute = Number(digits.slice(-2))
    if (hour > 23 || minute > 59) return fail()
    return ok(hour * 60 + minute)
  }

  const value = Number(digits)
  if (value > 23) return fail()

  if (value === 0) return ok(0)

  if (value === 12) {
    // Ambiguous in a way "nearest" handles badly, because both candidates are
    // exactly 12 hours from each other. Resolve by what a working day looks
    // like: noon is meant during it, midnight either side.
    if (nowMinutes < 8 * 60) return ok(0)
    if (nowMinutes <= 20 * 60) return ok(12 * 60)
    return { ok: true, time: { minutes: 0, dayOffset: 1 } }
  }

  if (value >= 13) return ok(value * 60)

  // 1-11: pick whichever of the two readings is nearer on the clock face.
  const am = value * 60
  const pm = (value + 12) * 60
  return ok(clockDistance(am, nowMinutes) <= clockDistance(pm, nowMinutes) ? am : pm)
}

/** Shortest distance between two points on a 24-hour clock face, in minutes. */
function clockDistance(a: number, b: number): number {
  const raw = Math.abs(a - b)
  return Math.min(raw, MINUTES_PER_DAY - raw)
}

function ok(minutes: number): TimeParseResult {
  return { ok: true, time: { minutes, dayOffset: 0 } }
}

function fail(): TimeParseResult {
  return { ok: false, reason: "unparseable" }
}

/**
 * End times always resolve forward from start.
 *
 * Typing `9` then `5` means 09:00 to 17:00, not a negative eight hours. Pushing
 * the end to the next day makes a negative duration structurally impossible at
 * the input layer, rather than something caught later by an error message.
 */
export function resolveEndAfterStart(end: TimeOfDay, start: TimeOfDay): TimeOfDay {
  const startAbs = start.dayOffset * MINUTES_PER_DAY + start.minutes
  let endAbs = end.dayOffset * MINUTES_PER_DAY + end.minutes
  while (endAbs <= startAbs) endAbs += MINUTES_PER_DAY
  return {
    minutes: endAbs % MINUTES_PER_DAY,
    dayOffset: Math.floor(endAbs / MINUTES_PER_DAY),
  }
}

/** `09:00` / `9:00 AM`, for echoing the parse back before commit. */
export function formatTimeOfDay(time: TimeOfDay, use12Hour: boolean): string {
  const hour = Math.floor(time.minutes / 60)
  const minute = time.minutes % 60
  const mm = minute < 10 ? `0${minute}` : String(minute)
  if (!use12Hour) return `${hour < 10 ? `0${hour}` : hour}:${mm}`
  const suffix = hour < 12 ? "AM" : "PM"
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${mm} ${suffix}`
}
