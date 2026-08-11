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
 * Which leaves this differing from `exportDisabledReason` only in wording, and
 * that is not a reason to merge them: the two sentences are about different
 * acts (a wrong report, an under-billed client), and the shared thing — the
 * order — is already shared, in `rangeBlocker`.
 */
export function invoiceDisabledReason(
  breakdown: Breakdown | undefined,
  isPlaceholderData: boolean
): string | null {
  switch (rangeBlocker(breakdown, isPlaceholderData)) {
    case "loading":
      return "Still totalling this period."
    case "truncated":
      return "This period is too large to total exactly — every figure is a floor, so an invoice raised from it would under-bill by an unknown amount. Narrow the dates."
    case "empty":
      return "Nothing tracked in this period to invoice."
    default:
      return null
  }
}
