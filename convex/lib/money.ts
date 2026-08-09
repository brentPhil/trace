/**
 * One money parser and one formatter, the same way convex/lib/duration.ts is
 * the one duration parser everywhere.
 *
 * The risk that earns this its own pure module is asymmetric in the same way
 * a duration is: a rate silently misread puts a wrong number on an invoice,
 * and nobody notices a number that is merely wrong rather than absent. Unlike
 * a duration, there is no unit ambiguity to resolve here — a bare "10" is
 * never accidentally the wrong unit, it is always ten of whatever currency the
 * user has set. The risk is fractional-cent GUESSING, so anything with more
 * precision than a cent, or a shape this cannot confidently read, is refused
 * rather than rounded into an answer nobody asked for.
 *
 * Pure. No Convex imports, no DOM — `Intl` is a JS global available in both
 * the browser and the Convex runtime.
 */

export type ParseMoneyFailure = "unparseable"

export type ParseMoneyResult =
  // `cents: null` is what an EMPTY field parses to — "clear the rate", not
  // "the rate is zero". Zero is a distinct, valid, explicit rate ($0/hr, for
  // pro bono work) and parses to `{ ok: true, cents: 0 }`; the two cannot
  // share a sentinel without losing that distinction.
  | { ok: true; cents: number | null }
  | { ok: false; reason: ParseMoneyFailure }

// One optional leading currency symbol from the common set (typed noise the
// parser strips rather than requires), then 1-9 digits, then an OPTIONAL
// decimal point followed by EXACTLY one or two digits. A third decimal digit
// ("10.999") has no whole-cent reading, so the whole input is refused rather
// than rounded — the same "reject, don't guess" choice duration.ts documents
// for its own ambiguous shapes.
const MONEY = /^[$€£¥]?(\d{1,9})(?:\.(\d{1,2}))?$/

/**
 * Parses a rate or amount a human typed.
 *
 *   10        -> 1000 cents
 *   10.50     -> 1050 cents
 *   $10       -> 1000 cents   (symbol is stripped, not required)
 *   10.5      -> 1050 cents
 *   0         -> 0 cents      (an explicit zero rate, not "no rate")
 *   ""        -> null         (clears whatever rate is stored)
 *   anything else -> refused
 */
export function parseMoney(input: string): ParseMoneyResult {
  const raw = input.trim()
  if (raw === "") return { ok: true, cents: null }

  const match = MONEY.exec(raw)
  if (match === null) return { ok: false, reason: "unparseable" }

  // `.at()` rather than `[n]`: TypeScript types a regex capture group as
  // `string`, but an unmatched OPTIONAL group is `undefined` at runtime —
  // same rule convex/lib/duration.ts's `group()` helper documents.
  const whole = Number(match.at(1))
  // `.padEnd(2, "0")`: a single decimal digit is TENTHS of a unit ("10.5" is
  // ten dollars fifty, not ten dollars five), so it is scaled up rather than
  // read literally.
  const fraction = (match.at(2) ?? "").padEnd(2, "0")
  return { ok: true, cents: whole * 100 + Number(fraction) }
}

/**
 * Renders a whole number of cents as a currency string — `$10.50`, `SGD
 * 10.50`, … — using `Intl.NumberFormat` so the symbol, its placement and the
 * decimal count are right for the currency rather than a hardcoded `$`.
 *
 * Assumes the currency's minor unit is hundredths, which covers the vast
 * majority of ISO 4217 codes including USD and SGD. A zero-decimal currency
 * (JPY) is out of scope: this product stores rates in cents, and nothing here
 * re-derives a currency's actual minor-unit exponent.
 *
 * `locale` defaults to the runtime's own — pass it explicitly in tests that
 * need a deterministic string.
 */
export function formatMoney(cents: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100)
}

/** Whether an ISO 4217 code is one this runtime's formatter can actually use. */
export function isValidCurrency(currency: string): boolean {
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency })
    return true
  } catch {
    return false
  }
}
