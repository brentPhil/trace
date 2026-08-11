/**
 * A client, as the block an invoice is billed to.
 *
 * ONE spelling of that snapshot, because it is written in two places that must
 * agree character for character: `invoices.createFromRange` stores it when the
 * form sent no `billedTo` of its own, and `/invoices/new` PREFILLS the same
 * block into the box so the user can see and edit what would otherwise be
 * written behind them. Two spellings would put an address on the document that
 * differs from the one the form showed — by a newline, which is exactly the
 * kind of difference nobody notices until it is printed.
 *
 * Pure, and in convex/lib so `src/` reaches it through `@shared`.
 */

/**
 * `"Vessel Vanguard LLC\nBonita Springs, FL"`, or just the name.
 *
 * A client with no address is its name alone rather than a name with a trailing
 * blank line: `clients.address` is stored verbatim and rendered verbatim (see
 * `blockLines` in the PDF and `whitespace-pre-line` on the record), so a
 * separator with nothing after it prints as a gap under the party's name.
 *
 * The address's INTERNAL newlines survive untouched — they are the address's
 * shape, the same property `clients.checkAddress` keeps them for.
 */
export function partyBlockOf(client: { name: string; address: string }): string {
  return client.address.trim() === ""
    ? client.name
    : `${client.name}\n${client.address}`
}
