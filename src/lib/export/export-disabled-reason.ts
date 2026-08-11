import { SET_A_RATE_NOTE } from "@/lib/export/report-rows"
import type { Breakdown } from "@/lib/report-series"

/**
 * What stops a control acting on the range that is currently on screen, and
 * the priority order that question is answered in.
 *
 * Extracted out of `reports.tsx` so this priority order — the single most
 * consequential rule on this page — has a unit test at all. `truncated`
 * outranks "empty" because a truncated scan's `count` is itself unproven: the
 * server stopped before reaching the end of the range, so a count of zero
 * describes only what it managed to look at, not the whole range. Reporting
 * "nothing tracked" there would assert something the scan was never in a
 * position to prove. Both outrank "loading", since a `breakdown` that has not
 * arrived yet, or is a stale placeholder from a previous range, cannot be
 * trusted to say anything about truncation or emptiness in the first place.
 *
 * The ORDER is the shared thing; the sentences are not. `Export` and
 * `Create invoice` refuse the same three states for the same reasons and say
 * different things about them — an export of a floor is a wrong report, an
 * invoice raised from one is a client under-billed — so each control words its
 * own refusal below and neither owns a second copy of the order. Two files
 * would be exactly where the two stopped agreeing about which state wins.
 */
export type RangeBlocker = "loading" | "truncated" | "empty"

export function rangeBlocker(
  breakdown: Breakdown | undefined,
  isPlaceholderData: boolean
): RangeBlocker | null {
  if (breakdown === undefined || isPlaceholderData) return "loading"
  if (breakdown.truncated) return "truncated"
  if (breakdown.count === 0) return "empty"
  return null
}

/** Non-null disables the export control and is announced as its description. */
export function exportDisabledReason(
  breakdown: Breakdown | undefined,
  isPlaceholderData: boolean
): string | null {
  switch (rangeBlocker(breakdown, isPlaceholderData)) {
    case "loading":
      return "Still totalling this period."
    case "truncated":
      return "This period is too large to total exactly — the figures are a floor, not the real total. Narrow the dates."
    case "empty":
      return "Nothing tracked in this period."
    default:
      return null
  }
}

/**
 * Non-null disables `Create invoice` and is announced as its description.
 *
 * The truncation refusal is the one this control exists to make: every figure
 * on a truncated range is a floor, and a floor that becomes a numbered document
 * in a client's inbox under-bills them by an unknown amount with nothing on the
 * document to reveal it. Stated on the trigger rather than as a toast after a
 * click that appeared to work — a refusal arriving after the act is not a
 * refusal.
 *
 * A FOURTH REFUSAL USED TO LIVE HERE and is gone, which is worth recording
 * because its absence is the fix rather than a relaxation. `createFromRange`
 * once took a date range and nothing else, so any narrowing on this page — the
 * project picker, the text box, the preset chips — made the invoice a strict
 * SUPERSET of the rows on screen, and this function refused rather than let it
 * bill work the user was not looking at. It now takes the same filter the page
 * queries with, so "bill exactly what you are looking at" is literally what
 * happens and there is nothing left to refuse. The deadlock that removed is the
 * reason it had to go: a range covering two clients is refused server-side as
 * `MIXED_CLIENTS`, whose own message says to filter to one client — and this
 * refusal was what made taking that advice impossible.
 *
 * `MIXED_CLIENTS` itself is not here, and cannot be: it is a fact about which
 * client each project in the range belongs to, decided by the server over the
 * rows it will actually bill. It is raised by `createFromRange` and surfaced
 * where the attempt was made — still reachable, from an unfiltered range that
 * genuinely spans two clients.
 *
 * Which leaves this differing from `exportDisabledReason` in wording and in ONE
 * extra refusal, and neither is a reason to merge them: the two sentences are
 * about different acts (a wrong report, an under-billed client), and the shared
 * thing — the order — is already shared, in `rangeBlocker`.
 *
 * A FOURTH REFUSAL LIVES HERE NOW — A DOCUMENT WITH NOTHING ON IT — and it is
 * the one an export has no analogue for, because a report of nothing is merely
 * an empty report while an invoice of nothing is PERMANENT. There is no
 * `invoices.remove`, nothing sets `deletedAt`, and the sequence number is spent
 * the moment the row exists: a $0.00 document with no lines sits in the list
 * forever, un-editable and un-deletable, and the next invoice is numbered one
 * past it. Every other permanent-document risk in this feature refuses rather
 * than mints (`RANGE_TOO_LARGE`, `MIXED_CLIENTS`, `INVOICE_HISTORY_TOO_LARGE`);
 * so does this.
 *
 * `rangeBlocker`'s `count` does NOT catch it. That is the billable-ENTRY count,
 * so a range full of billable hours that no rate covers passes every check
 * above — and `invoiceLineDrafts` then skips every bucket, because time nobody
 * priced is left off rather than billed at zero. Tracked billable time, no
 * project rate, no account default: the most likely FIRST run of this feature,
 * not an edge.
 *
 * TWO SENTENCES FOR IT, because the two causes have different fixes and a
 * refusal that names the wrong one sends the user to the wrong screen. A range
 * with no billable time in it at all wants the billable chip or a different
 * period; a range that is all billable and all unrated wants a rate. Both are
 * reachable, and which one a caller can hit depends on the scan it holds — see
 * the `billableOnly` note below.
 *
 * WHY BOTH ARE CHECKED HERE RATHER THAN ONE PER PAGE: /invoices/new always
 * scans `billableOnly: true`, so `count === 0` already covers its
 * nothing-billable case and only the rate sentence can fire. /reports scans
 * with whatever the chip says, so with the chip OFF a range of purely
 * non-billable entries has `count > 0` there and would otherwise enable a link
 * to a page that refuses — the gap `create-invoice-link.tsx` claims not to
 * have. `billableMs === 0` closes it, in the words that are true on that page.
 *
 * The mutation refuses the same state itself (`NO_PRICED_TIME`), which is what
 * makes it a rule rather than a convenience — this is only the half that says
 * so before the click. `SET_A_RATE_NOTE` is verbatim the sentence `BillPreview`
 * already carries under the same range: the note below the table and the reason
 * on the button are one fix, and two phrasings of it would name two screens.
 */
export function invoiceDisabledReason(
  breakdown: Breakdown | undefined,
  isPlaceholderData: boolean,
  /** How many lines `invoiceLineDrafts` priced out of this range — NOT how many
   *  buckets it has. Zero is a document with nothing on it. */
  pricedLineCount: number
): string | null {
  const blocker = rangeBlocker(breakdown, isPlaceholderData)
  if (blocker === "loading") return "Still totalling this period."
  if (blocker === "truncated") {
    return "This period is too large to total exactly — every figure is a floor, so an invoice raised from it would under-bill by an unknown amount. Narrow the dates."
  }
  if (blocker === "empty") return "Nothing tracked in this period to invoice."
  // `blocker === null` proves the breakdown landed; the guard is for the
  // compiler, which cannot narrow through the call above.
  if (breakdown !== undefined && breakdown.billableMs === 0) {
    return "Nothing in this period is billable, and an invoice bills billable time only."
  }
  if (pricedLineCount === 0) {
    return `Nothing in this period has an hourly rate, so this invoice would have no lines and a $0.00 total. ${SET_A_RATE_NOTE}`
  }
  return null
}
