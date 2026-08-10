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
 * MINOR UNITS ARE HUNDREDTHS, EVERYWHERE, BY CONSTRUCTION. `cents` means
 * exactly that, and `supportedCurrencies()` below is the enforcement: the only
 * currencies this product offers are the ones whose minor unit really is a
 * hundredth. See that function for why the alternative was rejected.
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

/**
 * The one locale every money string in the product is rendered in.
 *
 * PINNED, not `undefined`. This app server-renders, so an unpinned locale
 * formats the same figure as `$61.00` on a server resolving to en-US and
 * `61,00 $` on a browser resolving to de-DE — a React hydration mismatch on a
 * money figure, which is the single worst place in the product to have one.
 * It also breaks the round trip: the /projects editor seeds `10.50` and
 * `parseMoney` has no reading for `10,50`.
 *
 * `en-US` rather than the `en-GB` that src/lib/format-time.ts pins, because
 * this is the one that renders the DEFAULT currency without a country
 * qualifier — en-GB formats USD as `US$10.50`. Every other formatter in the
 * codebase pins one deliberately too (convex/lib/day.ts uses en-US).
 */
const MONEY_LOCALE = "en-US"

/**
 * Cached `Intl.NumberFormat`s, keyed by locale and currency.
 *
 * Constructing one is expensive relative to formatting with it, and
 * `formatRate` is called once per project row. src/lib/format-time.ts and
 * convex/lib/day.ts hoist theirs for the same reason; this one cannot be a
 * single module-level constant because the currency is a runtime value, so it
 * is a map instead.
 */
const formatters = new Map<string, Intl.NumberFormat>()

function formatterFor(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`
  const cached = formatters.get(key)
  if (cached !== undefined) return cached
  const made = new Intl.NumberFormat(locale, { style: "currency", currency })
  formatters.set(key, made)
  return made
}

/**
 * Every ISO 4217 code this product offers, which is the runtime's own list
 * narrowed to the currencies whose minor unit is a HUNDREDTH.
 *
 * The narrowing is the honest half of a choice. Rates are stored as an integer
 * count of hundredths (`hourlyRateCents`), and offering all 162 codes while
 * storing hundredths produced three separate lies: `formatMoney(1050, "JPY")`
 * rendered `¥11`, silently rounding the stored hundredths away; `formatMoney(
 * 1050, "KWD")` rendered `KWD 10.500` while `parseMoney` refused to read a
 * third decimal back, so a Kuwaiti user could never type their own precision;
 * and the /projects editor seeded `1000.00` for what a JPY user had entered as
 * `1000`.
 *
 * The alternative — deriving each currency's exponent from
 * `resolvedOptions().maximumFractionDigits` and storing true minor units — is
 * more correct in the abstract and worse here, because currency is a per-USER
 * setting while rates are per-PROJECT: switching from USD to JPY would silently
 * re-scale every stored rate by 100x, turning a $10.00/hr rate into ¥1,000/hr.
 * Today that switch is only a re-labelling (see /settings), which is bad enough.
 * 39 currencies are worth less than that hazard.
 *
 * Empty when the runtime cannot enumerate currencies at all — `isValidCurrency`
 * falls back to a shape check in that case rather than locking everyone to USD.
 *
 * BUILT ON FIRST USE, NOT AT MODULE LOAD. Narrowing the list means constructing
 * one throwaway `Intl.NumberFormat` per code to read its minor-unit exponent —
 * 162 of them, measured at ~16ms on a desktop against 0.08ms for a single-code
 * check, and several times worse on a mid-range phone. That is exactly the
 * expense the `formatterFor` cache above exists to avoid paying even once, and
 * as an eager module-level constant it was paid 162 times before anything had
 * been formatted.
 *
 * It was also paid in the wrong places. This module lands in the ROOT entry
 * chunk, so the constant blocked hydration on /login and /signup — routes with
 * no money on them — ran again on every SSR render, and ran in the Convex
 * isolate on every cold start, because convex/settings.ts imports
 * `isValidCurrency` and `settings.get` is what every page load calls. Exactly
 * one caller needs the whole list: the currency `<select>` on /settings.
 */
let currencyList: ReadonlyArray<string> | null = null

export function supportedCurrencies(): ReadonlyArray<string> {
  if (currencyList !== null) return currencyList

  // Reached through a structural type rather than `Intl.supportedValuesOf`
  // directly: convex/tsconfig.json targets `lib: ES2021`, which predates the
  // declaration, and the optional call is the runtime guard this needs
  // anyway. Verified present in both the edge runtime the Convex tests use
  // and in Node.
  const enumerate = (Intl as IntlMaybeEnumerable).supportedValuesOf
  currencyList = Object.freeze(enumerateHundredths(enumerate))
  return currencyList
}

function enumerateHundredths(
  enumerate: IntlMaybeEnumerable["supportedValuesOf"]
): Array<string> {
  if (typeof enumerate !== "function") return []
  let all: Array<string>
  try {
    all = enumerate.call(Intl, "currency")
  } catch {
    return []
  }
  return all.filter((code) => minorUnitDigits(code) === 2)
}

type IntlMaybeEnumerable = {
  supportedValuesOf?: (key: "currency" | "timeZone") => Array<string>
}

/** The same list as a set, for `isValidCurrency`. Lazy for the same reason. */
let currencySet: ReadonlySet<string> | null = null

function supportedSet(): ReadonlySet<string> {
  if (currencySet !== null) return currencySet
  currencySet = new Set(supportedCurrencies())
  return currencySet
}

/** Every code in the list has this shape, so anything that fails it is a no. */
const CURRENCY_CODE = /^[A-Z]{3}$/

/**
 * How many digits of minor unit a currency has, or null if the runtime cannot
 * say. Two for USD and EUR, zero for JPY, three for KWD.
 */
function minorUnitDigits(currency: string): number | null {
  try {
    return (
      new Intl.NumberFormat(MONEY_LOCALE, { style: "currency", currency })
        .resolvedOptions().maximumFractionDigits ?? null
    )
  } catch {
    return null
  }
}

/**
 * Whether a code is one this product will store, format and offer.
 *
 * Membership in a real list, NOT `new Intl.NumberFormat(...)` inside a
 * try/catch. That older guard tested whether a code was WELL-FORMED — three
 * ASCII letters — not whether it exists, so `isValidCurrency("ABC")` was true
 * and `formatMoney(1050, "ABC")` rendered `ABC 10.50` forever, while the error
 * message next to the guard claimed to know currencies. The /settings dropdown
 * reads the same list, so the picker and the validator can no longer disagree.
 *
 * Case-sensitive on purpose: `"usd"` is not the string this product stores, and
 * quietly upcasing an argument inside a validator hides a caller bug.
 *
 * Shape is checked BEFORE membership. Every code in the list matches
 * `CURRENCY_CODE`, so the answer for anything that does not is already `false`
 * — and answering it that way keeps the list's construction cost off every path
 * that never sees a well-formed code at all.
 */
export function isValidCurrency(currency: string): boolean {
  if (!CURRENCY_CODE.test(currency)) return false
  const supported = supportedSet()
  if (supported.size > 0) return supported.has(currency)
  // A runtime with no `Intl.supportedValuesOf`. Degrade to the shape check
  // above plus the hundredths rule rather than refusing everything.
  return minorUnitDigits(currency) === 2
}

// 1-9 digits, then an OPTIONAL decimal point followed by EXACTLY one or two
// digits. A third decimal digit ("10.999") has no whole-cent reading, so the
// whole input is refused rather than rounded — the same "reject, don't guess"
// choice duration.ts documents for its own ambiguous shapes. Currency symbols
// are stripped BEFORE this runs, by `stripCurrencyMarks`.
const MONEY = /^(\d{1,9})(?:\.(\d{1,2}))?$/

/**
 * A compound symbol: up to three letters qualifying a currency sign — `S$`,
 * `US$`, `HK$`, `R$`, `NZ$` — or a bare sign on its own.
 *
 * `\p{Sc}` is the Unicode currency-symbol category, so this covers every sign
 * in the offered set rather than the four that happened to get hardcoded
 * (`[$€£¥]`), which is what refused an SGD user's `S$10` behind a message
 * showing a dollar sign.
 */
const SIGN_PREFIX = /^[A-Za-z]{0,3}\p{Sc}\s*/u

/** The strings a user might reasonably type in place of a currency's sign. */
const marksByCurrency = new Map<string, Array<string>>()

function currencyMarks(currency: string): Array<string> {
  const cached = marksByCurrency.get(currency)
  if (cached !== undefined) return cached

  const marks: Array<string> = []
  for (const display of ["narrowSymbol", "symbol"] as const) {
    try {
      const sign = new Intl.NumberFormat(MONEY_LOCALE, {
        style: "currency",
        currency,
        currencyDisplay: display,
      })
        .formatToParts(0)
        .find((part) => part.type === "currency")?.value
      if (sign !== undefined && sign !== "" && !marks.includes(sign)) marks.push(sign)
    } catch {
      // An unknown code, or a runtime without `narrowSymbol`. The ISO code
      // below and the generic sign prefix still apply.
    }
  }
  if (!marks.includes(currency)) marks.push(currency)
  // Longest first, so "R$" is tried before "R" for a currency offering both.
  marks.sort((a, b) => b.length - a.length)
  marksByCurrency.set(currency, marks)
  return marks
}

function stripMark(raw: string, mark: string): string {
  if (mark === "" || mark.length >= raw.length) return raw
  const lower = raw.toLowerCase()
  const needle = mark.toLowerCase()
  if (lower.startsWith(needle)) return raw.slice(mark.length).trim()
  if (lower.endsWith(needle)) return raw.slice(0, raw.length - mark.length).trim()
  return raw
}

function stripCurrencyMarks(raw: string, currency: string | undefined): string {
  let out = raw
  if (currency !== undefined) {
    for (const mark of currencyMarks(currency)) out = stripMark(out, mark)
  }
  return out.replace(SIGN_PREFIX, "").trim()
}

/**
 * Parses a rate or amount a human typed.
 *
 *   10          -> 1000 cents
 *   10.50       -> 1050 cents
 *   $10         -> 1000 cents   (a sign is stripped, not required)
 *   S$10, "SGD" -> 1000 cents   (so is this currency's own sign, and its code)
 *   10.5        -> 1050 cents
 *   0           -> 0 cents      (an explicit zero rate, not "no rate")
 *   ""          -> null         (clears whatever rate is stored)
 *   anything else -> refused
 *
 * `currency` is optional and only widens what counts as strippable noise: with
 * it, this currency's own sign and ISO code are removed from either end, so a
 * figure copied straight back out of `formatMoney` round-trips. Without it,
 * only the generic sign prefix applies. Letters that are NOT this currency's
 * mark are still refused — `parseMoney("kr 10", "USD")` is unparseable.
 */
export function parseMoney(input: string, currency?: string): ParseMoneyResult {
  const raw = input.trim()
  if (raw === "") return { ok: true, cents: null }

  const match = MONEY.exec(stripCurrencyMarks(raw, currency))
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
 * The minor unit is a hundredth for every currency this product offers, which
 * `supportedCurrencies()` guarantees rather than assumes.
 *
 * `locale` exists for tests that need to assert a specific rendering.
 * Production always omits it and gets `MONEY_LOCALE`, deterministically, on
 * both sides of the SSR boundary.
 */
export function formatMoney(cents: number, currency: string, locale?: string): string {
  return formatterFor(locale ?? MONEY_LOCALE, currency).format(cents / 100)
}
