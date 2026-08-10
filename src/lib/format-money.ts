import { formatMoney } from "@shared/money"

/**
 * How much of a billable total nobody has put a price on.
 *
 * THE RULE, in one place: `billableCents: 0` has two opposite meanings and only
 * `unratedBillableMs` separates them — work done for free (a rate of zero
 * somebody chose) and work nobody has priced yet. `all` is the gate on printing
 * an amount at all, because "$0.00" against eight billable hours reads as "these
 * earned nothing", which is a confident wrong figure in the one place a
 * freelancer copies numbers onto an invoice. `some` only qualifies an amount
 * that is still right for the part it covers.
 *
 * It lived at three call sites — the totals sentence, the Summary readout and
 * the project tooltip — and the third had already been written as a DIFFERENT
 * predicate, agreeing with the other two only because `unratedBillableMs` is a
 * subset of `billableMs`. One copy, because the failure direction is unbilled
 * work rendered as free.
 */
export function unpriced(totals: {
  billableMs: number
  unratedBillableMs: number
}): { some: boolean; all: boolean } {
  const some = totals.unratedBillableMs > 0
  return { some, all: some && totals.unratedBillableMs >= totals.billableMs }
}

/**
 * A project's hourly rate, or the explicit statement that none is set.
 *
 * "No rate set" rather than "$0.00/hr" — those are different facts. A project
 * with no rate contributes nothing to the billable amount on /reports; a
 * project billing $0/hr is a real, explicit choice (pro bono work) that DOES
 * show up as zero. Collapsing the two into one string would make it
 * impossible to tell "nobody has priced this yet" from "priced at nothing".
 */
export function formatRate(cents: number | undefined, currency: string): string {
  if (cents === undefined) return "No rate set"
  return `${formatMoney(cents, currency)}/hr`
}

/**
 * What to say when a typed rate is refused.
 *
 * Currency-aware, because the previous fixed string — "Try 10, 10.50, or $10"
 * — showed a dollar sign to every user on earth. An SGD user who pasted "S$10"
 * was refused by a message demonstrating the wrong symbol, which reads as "we
 * only take dollars" rather than "we could not read that".
 *
 * The bare forms come FIRST because they are what the field actually wants;
 * the formatted example is there to show that the user's own symbol is
 * tolerated too, not to suggest it is required. `parseMoney` strips this
 * currency's sign and its ISO code from either end (see convex/lib/money.ts),
 * so everything named here really does parse.
 */
export function rateHelp(currency: string): string {
  return `Try 10, 10.50, or ${formatMoney(1050, currency)} — or leave it blank to clear the rate.`
}
