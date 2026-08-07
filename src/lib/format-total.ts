import { formatClock, formatDecimalHours } from "@shared/duration"

export type DurationDisplay = "hms" | "decimal"

/**
 * A total, in whichever form the user bills in.
 *
 * THE CONTRACT, stated once and enforced by where this function is called:
 *
 *   Decimal is TWO decimal places, FLOORED, and applies to totals and export
 *   ONLY — never to the recap, and never to a single entry's own row.
 *
 * The flooring is not an implementation detail. It guarantees that no figure
 * ever displays more time than was recorded, and that a set of parts never sums
 * above the whole they came from. Rounding breaks both, in opposite directions,
 * on the same screen.
 *
 * The recap is excluded deliberately: it is prose about a day's work, and
 * "1.75" reads as a quantity where "1h 45m" reads as a span someone spent. An
 * unspecified decimal conversion on a number beside an invoice is exactly the
 * ambiguity the duration parser exists to remove, so it is specified here.
 */
export function formatTotal(ms: number, display: DurationDisplay): string {
  return display === "decimal" ? `${formatDecimalHours(ms)} h` : formatClock(ms)
}
