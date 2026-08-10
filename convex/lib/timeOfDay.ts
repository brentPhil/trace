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

export const MINUTES_PER_DAY = 1440

/**
 * The forms this module accepts, for a field that has just refused one.
 *
 * Here because it is a description OF the parser below: teaching that parser a
 * new spelling has to be one edit, not a hunt through every field that reports
 * a rejection. It was declared byte-identically in `entry-time-popover.tsx`
 * and `timer-duration-popover.tsx`, and a third copy had already drifted
 * inside `manual-entry-dialog.tsx` — lower-case "try", a different example.
 */
export const TIME_HELP = "Try 9:15, 0915, or 2pm."

/**
 * `"End time — Try 9:15, 0915, or 2pm."` — the whole message for a field whose
 * contents could not be read.
 *
 * THE END FIELD IS CALLED "End time", NOT "Stop time". Three call sites
 * disagreed and this is the deliberate resolution rather than whichever
 * spelling a dedup happened to keep. `TimePopoverFields` gives the input
 * `aria-label="End time"`, so that is the name a screen reader announces for
 * the very field the error is about, and an error naming a "Stop time" field
 * would name one that, to that user, does not exist. The visible column
 * heading stays the terser "Stop": that is a heading, this is a sentence.
 */
export function timeFieldHelp(field: "start" | "end"): string {
  return `${field === "start" ? "Start time" : "End time"} — ${TIME_HELP}`
}

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
  const text = normalise(input)
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

/**
 * EVERY reading a bare run of digits could mean, or `null` if it has none.
 *
 * ONE list, read by two selection policies — `parseTimeOfDay` below picks the
 * reading nearest to now, `parseEndTime` picks the first one after the start.
 * This function is the single statement of WHICH inputs are ambiguous at all,
 * and it exists because that rule used to be written twice: once here and once
 * in a mirror beside `parseEndTime` whose own docstring conceded it "must keep
 * mirroring them". It did not. That is the exact shape that left `"09"` fixed
 * and `"9"` broken for months.
 *
 * The four rules that make a bare reading SINGLE:
 *
 *   - Three and four digits are a compact h:mm — "930", "1430".
 *   - A leading zero is an explicit 24-hour hour. Without this, "09" typed at
 *     16:00 resolved to 21:00 — so backfilling a 9-to-5 day committed a
 *     20-hour entry instead of eight, a twelve-hour over-bill from two
 *     keystrokes, while "0900" at the same moment gave 09:00. Two spellings of
 *     one intention must not disagree.
 *   - `0` is midnight.
 *   - 13-23 are already 24-hour.
 *
 * Everything left — 1 through 12 — has exactly two readings, always exactly 12
 * hours apart. `% 12` so that 12 yields [00:00, 12:00] alongside 9's
 * [09:00, 21:00]: the same shape, which is what lets one selection policy
 * handle both. AM is always first.
 */
function bareReadings(digits: string): Array<number> | null {
  if (digits.length === 3 || digits.length === 4) {
    const hour = Number(digits.slice(0, digits.length - 2))
    const minute = Number(digits.slice(-2))
    if (hour > 23 || minute > 59) return null
    return [hour * 60 + minute]
  }

  const value = Number(digits)
  if (value > 23) return null

  if (digits.length === 2 && digits.startsWith("0")) return [value * 60]
  if (value === 0 || value >= 13) return [value * 60]

  const am = (value % 12) * 60
  return [am, am + 12 * 60]
}

function parseBare(digits: string, nowMinutes: number): TimeParseResult {
  const readings = bareReadings(digits)
  if (readings === null) return fail()
  if (readings.length === 1) return ok(readings[0])

  if (Number(digits) === 12) {
    // Ambiguous in a way "nearest" handles badly, because both candidates are
    // exactly 12 hours from each other. Resolve by what a working day looks
    // like: noon is meant during it, midnight either side. `parseEndTime` does
    // NOT need this — a start to measure from answers it outright — which is
    // why the rule lives in this selection policy and not in the list above.
    if (nowMinutes < 8 * 60) return ok(0)
    if (nowMinutes <= 20 * 60) return ok(12 * 60)
    return { ok: true, time: { minutes: 0, dayOffset: 1 } }
  }

  // 1-11: pick whichever of the two readings is nearer on the clock face.
  // The two candidates are always exactly 12 hours apart, so a tie happens at
  // exactly one `now` per input. `<=` breaks it toward AM — deterministic, and
  // documented here because it is otherwise invisible. The caller echoes the
  // parse before committing, which is what makes the whole rule safe.
  const [am, pm] = readings
  return ok(clockDistance(am, nowMinutes) <= clockDistance(pm, nowMinutes) ? am : pm)
}

/** Trim, lower-case, and collapse runs of whitespace. */
function normalise(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ")
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
 * Parses the START of an interval. Prefer this over `parseTimeOfDay` for any
 * field that begins something filed under a day the user has chosen.
 *
 * `parseTimeOfDay` plus one clamp: the reading is pinned to `dayOffset: 0`,
 * because a start belongs to the day it is filed under and the CALENDAR is
 * what moves an entry — a typed time silently doing it is exactly the guess
 * this product does not make. Only a bare `12` late in the evening can produce
 * a non-zero offset from `parseTimeOfDay` at all, and "12" typed at 9pm over a
 * start field means midnight of the day on screen.
 *
 * The clamp was open-coded at every call site. It is the half of the
 * `parseEndTime` rule that did not make the trip when that function was
 * created, and the two belong together.
 */
export function parseStartTime(input: string, nowMinutes: number): TimeParseResult {
  const parsed = parseTimeOfDay(input, nowMinutes)
  if (!parsed.ok) return parsed
  return { ok: true, time: { minutes: parsed.time.minutes, dayOffset: 0 } }
}

/**
 * Parses the END of an interval. Prefer this over `parseTimeOfDay` for any
 * field that ends something.
 *
 * An end is not a free-floating time of day: it is bounded below by its start,
 * and that bound has to be applied while the reading is CHOSEN, not after.
 * Parsing with the nearest-reading rule and then pushing the result forward is
 * the combination this function exists to make unexpressible — it read `9`
 * then `5` as a 20-hour entry, because "nearest to 09:00" prefers 05:00 (4
 * hours away) over 17:00 (8), and 05:00 after a 09:00 start is tomorrow. Two
 * keystrokes, a twelve-hour over-bill, and the wrong answer looked exactly
 * like the right one.
 *
 * So a bare 1-12 resolves to the first of its two readings that falls after
 * the start, which also retires the working-day guess for `12`: after 09:00 it
 * is noon, after 13:00 it is midnight, and neither is a guess. Every other
 * form is unambiguous already and is simply anchored forward as written — an
 * explicit `5am` after a 09:00 start really is overnight.
 */
export function parseEndTime(input: string, start: TimeOfDay): TimeParseResult {
  // Bare digits go through `bareReadings` — the ONE statement of which inputs
  // are ambiguous — and are selected from by "first after the start" rather
  // than by "nearest to now". Everything else has a single reading already and
  // is simply anchored forward.
  const bare = BARE.exec(normalise(input))
  if (bare !== null) {
    const readings = bareReadings(bare[1])
    if (readings === null) return fail()
    return { ok: true, time: firstAfter(readings, start) }
  }

  const parsed = parseTimeOfDay(input, start.minutes)
  if (!parsed.ok) return parsed
  return { ok: true, time: resolveEndAfterStart(parsed.time, start) }
}

/** Whichever reading lands soonest after the start, by the rule below. */
function firstAfter(readings: Array<number>, start: TimeOfDay): TimeOfDay {
  const resolved = readings.map((minutes) =>
    resolveEndAfterStart({ minutes, dayOffset: 0 }, start)
  )
  return resolved.reduce((a, b) => (absoluteMinutes(a) <= absoluteMinutes(b) ? a : b))
}

/** Minutes from the start of the reference day, folding `dayOffset` back in. */
export function absoluteMinutes(time: TimeOfDay): number {
  return time.dayOffset * MINUTES_PER_DAY + time.minutes
}

/**
 * Anchors an end forward of its start.
 *
 * `22` then `2` is the ordinary overnight case, and pushing the end to the
 * next day makes a negative duration structurally impossible at the input
 * layer rather than something caught later by an error message.
 *
 * This only ever moves a reading that has already been chosen. Choosing it is
 * `parseEndTime`'s job, and callers should go through that — reaching for
 * `parseTimeOfDay` and this function separately is what produced the 20-hour
 * entry described there.
 */
export function resolveEndAfterStart(end: TimeOfDay, start: TimeOfDay): TimeOfDay {
  const startAbs = absoluteMinutes(start)
  // Anchored to the START's own day, carrying the END's minutes — not to
  // either one wholesale, and not by repeatedly adding a day to whatever the
  // end already carried. The loop form could return dayOffset 2 when the start
  // was already offset, which is outside this type's documented 0 | 1 domain
  // and produced an entry more than 24 hours long.
  const sameDay = start.dayOffset * MINUTES_PER_DAY + end.minutes
  const endAbs = sameDay > startAbs ? sameDay : sameDay + MINUTES_PER_DAY
  return {
    minutes: endAbs % MINUTES_PER_DAY,
    dayOffset: Math.floor(endAbs / MINUTES_PER_DAY),
  }
}

export type IntervalResult =
  | { ok: true; start: TimeOfDay; end: TimeOfDay }
  | { ok: false; field: "start" | "end" }

/**
 * BOTH ends of an interval, from two typed fields, as a caller will commit
 * them.
 *
 * The sequence — parse the start against the wall clock, pin it to
 * `dayOffset: 0` because the calendar is what moves an entry, then read the
 * end against THAT start — was written longhand in three components, each
 * carrying its own multi-line comment re-deriving the same reasoning.
 * `parseEndTime` exists to make the bad composition unexpressible; expressing
 * the good one once, here, next to it, is the other half of that.
 *
 * It is also what keeps a popover's confirm path and its parse echo from
 * disagreeing. Showing one interval while writing another is worse than
 * showing nothing, because it turns a visible mistake into a confident wrong
 * answer — deriving both from here makes that unexpressible rather than merely
 * unlikely.
 *
 * `field` names which of the two was refused, so the caller can put the
 * message on the right one; `timeFieldHelp` above turns it into that message.
 */
export function resolveInterval(
  start: string,
  end: string,
  nowMinutes: number
): IntervalResult {
  const startParsed = parseStartTime(start, nowMinutes)
  if (!startParsed.ok) return { ok: false, field: "start" }

  const endParsed = parseEndTime(end, startParsed.time)
  if (!endParsed.ok) return { ok: false, field: "end" }

  return { ok: true, start: startParsed.time, end: endParsed.time }
}

/**
 * `09:00` / `9:00 AM`, for echoing the parse back before commit.
 *
 * A next-day time is marked. This echo is the product's stated defence against
 * a mis-parse, and without the marker a rejected zero-length entry and an
 * accepted 24-hour one both rendered as "12:00 AM → 12:00 AM".
 */
export function formatTimeOfDay(time: TimeOfDay, use12Hour: boolean): string {
  const hour = Math.floor(time.minutes / 60)
  const minute = time.minutes % 60
  const mm = minute < 10 ? `0${minute}` : String(minute)
  const nextDay = time.dayOffset > 0 ? " +1d" : ""
  if (!use12Hour) return `${hour < 10 ? `0${hour}` : hour}:${mm}${nextDay}`
  const suffix = hour < 12 ? "AM" : "PM"
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${mm} ${suffix}${nextDay}`
}
