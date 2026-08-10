import { localPartsOf } from "./day"

/**
 * The next invoice number for an account.
 *
 * Pure. No Convex imports, no DOM — this runs identically on both sides of
 * the wire, and the caller (convex/invoices.ts, Task 3) supplies every
 * existing `number` it can see so the sequence is computed here rather than
 * re-derived ad hoc at each call site.
 */

/** `072726-0013` — MMDDYY, then a four-digit sequence. The reference format. */
const NUMBER = /^(\d{6})-(\d{4,})$/

/**
 * Reads the sequence out of a `number`, or null if it does not match the
 * reference format.
 *
 * `number` is USER-EDITABLE, so `used` may contain strings a person typed by
 * hand under their own scheme. Returning null rather than throwing is what
 * lets `nextInvoiceNumber` skip those instead of breaking on them.
 */
export function parseInvoiceSequence(number: string): number | null {
  const match = NUMBER.exec(number.trim())
  if (match === null) return null
  const sequence = Number(match[2])
  return Number.isSafeInteger(sequence) ? sequence : null
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/**
 * The next invoice number: the given date, stamped MMDDYY in the user's local
 * zone, and one past the highest sequence ever used across ALL of `used`.
 *
 * ONE PAST THE HIGHEST EVER USED, not a count of `used`. A count reuses a
 * number after a deletion, and two documents both claiming to be
 * `#072726-0013` is exactly what a client's bookkeeper notices and the
 * freelancer cannot explain. The sequence is also per-user, not per-day: an
 * invoice from six months ago still raises the floor for today's number.
 */
export function nextInvoiceNumber(
  issuedAt: number,
  timeZone: string,
  used: ReadonlyArray<string>
): string {
  let highest = 0
  for (const number of used) {
    const sequence = parseInvoiceSequence(number)
    // Unparseable numbers are SKIPPED, not rejected: `number` is user-editable,
    // so somebody's own scheme must not break the generator for the next one.
    if (sequence !== null && sequence > highest) highest = sequence
  }
  const { year, month, day } = localPartsOf(issuedAt, timeZone)
  const stamp = `${pad2(month)}${pad2(day)}${pad2(year % 100)}`
  return `${stamp}-${String(highest + 1).padStart(4, "0")}`
}
