import { formatMoney } from "@shared/money"

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
