/**
 * One duration parser, one set of formatters, used by every duration input and
 * every duration display in the product.
 *
 * There is exactly one of each because Toggl has more than one: a bare `5` is
 * five *hours* in its Timesheet view and five *minutes* in its timer bar, on
 * two live pages of the same product. That is the bug class that produces a
 * wrong invoice, and the only structural defence is a single implementation
 * that both the client and the Convex mutation import.
 *
 * Pure. No Convex imports, no DOM.
 */

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

/** Durations longer than this are refused; the user is offered a split instead. */
export const MAX_DURATION_MS = 24 * HOUR

export type ParseFailure = "empty" | "unparseable" | "too-long"

export type ParseResult =
  | { ok: true; ms: number }
  | { ok: false; reason: ParseFailure }

const CLOCK = /^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/
const BARE_INT = /^\d{1,6}$/
const BARE_DECIMAL = /^\d{1,4}\.\d{1,6}$/
// "1h30" — hours followed by a bare number, which every tracker reads as minutes.
const HOURS_THEN_MINUTES = /^(\d{1,4}(?:\.\d{1,6})?)\s*h\s*(\d{1,2})$/
// "1h", "30m", "45s", "1.5h", "1h 30m", "1h30m15s" — any subset, in order.
const UNITS =
  /^(?:(\d{1,4}(?:\.\d{1,6})?)\s*h)?\s*(?:(\d{1,6}(?:\.\d{1,6})?)\s*m(?:in)?)?\s*(?:(\d{1,6}(?:\.\d{1,6})?)\s*s(?:ec)?)?$/

/**
 * Parses a duration a human typed.
 *
 *   90        -> 1:30:00   bare integer is MINUTES
 *   5         -> 0:05:00
 *   1.5, 1,5  -> 1:30:00   a decimal is HOURS
 *   1:30      -> 1:30:00   h:mm
 *   1:30:45   -> 1:30:45   h:mm:ss
 *   90m 1h 1h30 1h30m 1.5h 45s 0.25h -> as written; explicit units always win
 *
 * Bare-integer-as-minutes is chosen on asymmetric risk, not on convention.
 * Reading `8` as eight hours over-bills a client and can go unnoticed until
 * they query it; reading it as eight minutes under-records and is caught
 * within seconds by the user looking at the row. Hours cost one keystroke
 * (`8h`), and the caller echoes the parse before committing so the choice is
 * never hidden.
 */
export function parseDuration(input: string): ParseResult {
  const raw = input.trim().toLowerCase()
  if (raw === "") return { ok: false, reason: "empty" }

  // A comma is a decimal separator in most of the world. It is never a
  // thousands separator in a duration a human types.
  const text = raw.replace(",", ".")

  const ms = parseToMs(text)
  if (ms === null) return { ok: false, reason: "unparseable" }
  if (ms > MAX_DURATION_MS) return { ok: false, reason: "too-long" }
  return { ok: true, ms }
}

/**
 * `.at()` rather than `[n]` throughout: TypeScript types a regex capture group
 * as `string`, but an unmatched optional group is `undefined` at runtime. `.at()`
 * returns `string | undefined`, which is what is actually there.
 */
const group = (m: RegExpExecArray, n: number): number | undefined => {
  const value = m.at(n)
  return value === undefined ? undefined : Number(value)
}

function parseToMs(text: string): number | null {
  const clock = CLOCK.exec(text)
  if (clock !== null) {
    const h = group(clock, 1) ?? 0
    const m = group(clock, 2) ?? 0
    const s = group(clock, 3) ?? 0
    return h * HOUR + m * MINUTE + s * SECOND
  }

  const hm = HOURS_THEN_MINUTES.exec(text)
  if (hm !== null) {
    return (group(hm, 1) ?? 0) * HOUR + (group(hm, 2) ?? 0) * MINUTE
  }

  if (BARE_INT.test(text)) {
    return Number(text) * MINUTE
  }

  if (BARE_DECIMAL.test(text)) {
    return Math.round(Number(text) * HOUR)
  }

  const units = UNITS.exec(text)
  if (units !== null) {
    const h = group(units, 1)
    const m = group(units, 2)
    const s = group(units, 3)
    // Every group is optional, so the regex also matches "". Require at least
    // one to have captured something before treating this as a duration.
    if (h !== undefined || m !== undefined || s !== undefined) {
      return Math.round((h ?? 0) * HOUR + (m ?? 0) * MINUTE + (s ?? 0) * SECOND)
    }
  }

  return null
}

function parts(ms: number) {
  const total = Math.max(0, Math.floor(ms / SECOND))
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n))

/**
 * `h:mm:ss` — the running timer and the per-entry duration in the log.
 *
 * Hours are never padded (a leading zero on the hour reads as a clock time,
 * not an elapsed time); minutes and seconds always are, so the string only
 * changes width when the hours roll over. Render in `.tabular`.
 */
export function formatClock(ms: number): string {
  const p = parts(ms)
  return `${p.hours}:${pad2(p.minutes)}:${pad2(p.seconds)}`
}

/**
 * `5h 44m` / `2h 05m` / `4h` / `47m` / `<1m` — day headers, totals, the recap.
 *
 * Truncates rather than rounds, deliberately. Flooring guarantees a property
 * worth having on a document that sits next to an invoice: no line ever
 * displays more time than was recorded, and the parts of a total never sum
 * above the total itself. Rounding breaks both directions.
 *
 * `<1m` rather than `0m`, because `0m` reads as a defect.
 */
export function formatCompactDuration(ms: number): string {
  const p = parts(ms)
  if (p.hours === 0 && p.minutes === 0) return "<1m"
  if (p.hours === 0) return `${p.minutes}m`
  if (p.minutes === 0) return `${p.hours}h`
  return `${p.hours}h ${pad2(p.minutes)}m`
}

/**
 * `1.25` — decimal hours, for export and for users who bill in tenths.
 *
 * Two decimal places, floored, for the same reason formatCompactDuration
 * floors: this number goes onto an invoice. The contract is stated here
 * because an unspecified decimal conversion is exactly the ambiguity the
 * parser above exists to remove.
 */
export function formatDecimalHours(ms: number): string {
  const hours = Math.max(0, ms) / HOUR
  return (Math.floor(hours * 100) / 100).toFixed(2)
}

/** "1 hour 30 minutes" — for aria-labels, where `1:30:00` is read as a time. */
export function spokenDuration(ms: number): string {
  const p = parts(ms)
  const chunks: Array<string> = []
  if (p.hours > 0) chunks.push(`${p.hours} hour${p.hours === 1 ? "" : "s"}`)
  if (p.minutes > 0) chunks.push(`${p.minutes} minute${p.minutes === 1 ? "" : "s"}`)
  // Seconds are announced only when they are the whole story; a screen reader
  // reading "44 seconds" every second is noise, and the caller updates this at
  // minute granularity for exactly that reason.
  if (chunks.length === 0) chunks.push(`${p.seconds} second${p.seconds === 1 ? "" : "s"}`)
  return chunks.join(" ")
}

/** ISO 8601 duration, for the `datetime` attribute on `<time>`. */
export function msToIsoDuration(ms: number): string {
  const p = parts(ms)
  return `PT${p.hours}H${p.minutes}M${p.seconds}S`
}
