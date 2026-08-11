import type { Breakdown } from "@/lib/report-series"
import type { Filters } from "@/lib/history-filters"

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
 * Whether the rows on screen are a SUBSET of the rows an invoice would bill.
 *
 * `invoices.createFromRange` takes a date range and nothing else: it re-reads
 * the period server-side with `billableOnly`, and knows nothing about the
 * project picker, the text box or the preset chips. So with any of those active
 * the figures on this page and the lines on the invoice are answers to two
 * different questions, and the invoice is the wider one — it would bill work
 * the user is not looking at, which on a document sent to a client is the
 * over-billing mirror of the floor `truncated` refuses.
 *
 * `billableOnly` is deliberately NOT in here. `createFromRange` always bills
 * billable time only, so the chip narrows the page TOWARDS what the invoice
 * does rather than away from it, and leaving it off is the documented rule
 * ("billable time on a project with a rate") rather than a divergence.
 *
 * `hasClientSideFilter` is the wrong question and was tried first: it includes
 * `billableOnly` and excludes nothing, because it exists to ask whether the
 * DETAILED tab must pull the whole range before totalling it.
 */
export function narrowsBeyondDates(filters: Filters): boolean {
  return filters.projectId !== null || filters.text.trim() !== "" || filters.presets.length > 0
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
 * `MIXED_CLIENTS` is not here, and cannot be: it is a fact about which client
 * each project in the range belongs to, decided by the server over the rows it
 * will actually bill (see above — not the rows on screen). It is raised by
 * `createFromRange` and surfaced where the attempt was made.
 */
export function invoiceDisabledReason(
  breakdown: Breakdown | undefined,
  isPlaceholderData: boolean,
  filters: Filters
): string | null {
  const blocker = rangeBlocker(breakdown, isPlaceholderData)
  if (blocker === "loading") return "Still totalling this period."
  if (blocker === "truncated") {
    return "This period is too large to total exactly — every figure is a floor, so an invoice raised from it would under-bill by an unknown amount. Narrow the dates."
  }
  // Above "empty", because with a filter active "nothing tracked" is a claim
  // about the filtered rows and the invoice would not be raised from those.
  if (narrowsBeyondDates(filters)) {
    return "These filters narrow what is on screen, and an invoice is raised from the dates alone — it would bill work this page is not showing. Clear them, or narrow the dates instead."
  }
  if (blocker === "empty") return "Nothing tracked in this period to invoice."
  return null
}
