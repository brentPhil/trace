import { centiHours } from "./duration"
import { lineAmountCents } from "./invoiceMath"
import { NO_PROJECT_LABEL } from "./labels"

/**
 * ONE derivation of "which lines does this range bill, and at what".
 *
 * `invoices.createFromRange` writes these rows into `invoiceLines`, and
 * `/invoices/new` draws them as the preview a user reads BEFORE pressing the
 * button that mints a numbered document. Those are two renderings of one
 * decision, and the failure they invite is the one that matters most on this
 * screen: a preview that says $988.00 over a mutation that stores $1,010.00 is
 * worse than no preview at all, because it is a promise the product then breaks
 * in a client's inbox.
 *
 * So the rules — which buckets are billed, which are skipped, which rate wins,
 * how a quantity is rounded, what an unassigned bucket is called — live here,
 * once, and both callers ask this module.
 *
 * Pure, and in convex/lib so `src/` can reach it through the `@shared` alias:
 * no Convex imports, no `Id`, no ctx. Project ids are plain strings here for
 * exactly that reason — this module never looks one up, it only carries it
 * through to the line as provenance.
 */

/**
 * One project's billable time in a range, plus the project row behind it.
 *
 * Shaped to be filled from `entries.rangeBreakdownImpl`'s `projects` array on
 * either side of the wire. `project` is `undefined` for the unassigned bucket —
 * and also for a project row that could not be read, which is the same thing as
 * far as a line is concerned: no name and no rate of its own.
 */
export type BillableBucket = {
  projectId: string | null
  billableMs: number
  /**
   * How much of `billableMs` no rate covers. A project's rate is resolved
   * uniformly for every row inside it (see `rateOf` in convex/entries.ts), so
   * for one bucket this is either 0 or exactly `billableMs` — never partial.
   */
  unratedBillableMs: number
  project: { name: string; hourlyRateCents?: number } | undefined
}

/**
 * One project's row of `entries.rangeBreakdown`, narrowed to what a line needs.
 *
 * Structural rather than the generated return type: this module is imported by
 * the Convex mutation AND by `/invoices/new` through `@shared`, and neither
 * side may drag `_generated` into the other's runtime. `projectId` is a plain
 * string here for the reason given at the top of this file.
 */
export type BreakdownProject = {
  projectId: string | null
  name: string
  hourlyRateCents?: number
  billableMs: number
  unratedBillableMs: number
}

/**
 * A breakdown's projects, as the buckets `invoiceLineDrafts` prices.
 *
 * THE ONE STEP BETWEEN THE SCAN AND THE LINES, and it is shared for the same
 * reason the pricing below is: `createFromRange` and the preview on
 * /invoices/new both start from the very same `rangeBreakdownImpl` answer, and
 * a bucket assembled twice is a place where one of the two can pick a different
 * rate, a different name, or a different idea of which bucket is the unassigned
 * one — none of which would show up as a disagreement until a client had the
 * document.
 *
 * `projectId === null` is the unassigned bucket AND a project row the scan
 * could not resolve; both hand `undefined` down, because a line cannot tell
 * them apart and neither has a name or a rate of its own.
 */
export function billableBucketsOf(
  projects: ReadonlyArray<BreakdownProject>
): Array<BillableBucket> {
  return projects.map((project) => ({
    projectId: project.projectId,
    billableMs: project.billableMs,
    unratedBillableMs: project.unratedBillableMs,
    project:
      project.projectId === null
        ? undefined
        : { name: project.name, hourlyRateCents: project.hourlyRateCents },
  }))
}

/** One line's worth of work, computed but not yet written or drawn. */
export type InvoiceLineDraft = {
  description: string
  /** Hundredths of an hour, the stored unit. 9880 prints as `98.80`. */
  quantityCentis: number
  unitCents: number
  /** From the ROUNDED quantity, never from the breakdown's exact
   *  `billableCents` — see `lineAmountCents` for why an invoice line has to be
   *  reproducible with a calculator from the three numbers printed on it. */
  amountCents: number
  /** Provenance only. Never read for money. */
  projectId: string | null
}

/**
 * A range's billable buckets, priced into invoice lines — in the order given.
 *
 * The caller hands buckets in the order they should print;
 * `rangeBreakdownImpl` already sorts them descending by time, which is the
 * order both the preview and the stored `sortKey` use.
 *
 * WHAT IS SKIPPED, and both are decisions rather than filters:
 *
 *   - A bucket with no billable time at all. Nothing to bill.
 *   - A bucket whose billable time has NO RATE. Time nobody has priced is left
 *     off rather than guessed at or billed at zero — the excluded total is
 *     reported separately (`unratedMs`) so the absence is stated rather than
 *     silent.
 *
 * `accountRateCents` is the fallback for a project with no rate of its own, and
 * `null` means nobody has set one. `??` rather than `||` is what keeps a
 * zero-rate project's line at $0.00 instead of falling through to that default:
 * zero is a rate somebody chose (pro bono), not the absence of one, and the
 * same rule governs `rateOf` in convex/entries.ts.
 */
export function invoiceLineDrafts(
  buckets: ReadonlyArray<BillableBucket>,
  accountRateCents: number | null
): Array<InvoiceLineDraft> {
  const lines: Array<InvoiceLineDraft> = []
  for (const bucket of buckets) {
    if (bucket.billableMs === 0) continue
    if (bucket.unratedBillableMs > 0) continue

    const unitCents = bucket.project?.hourlyRateCents ?? accountRateCents
    // Unreachable while `unratedBillableMs === 0` above proves a rate exists,
    // and kept because that proof lives in another file: a bucket assembled by
    // hand with no rate must produce no line rather than a line priced `null`.
    if (unitCents === null) continue

    const quantityCentis = centiHours(bucket.billableMs)
    lines.push({
      // A stated label, not "" — a blank cell beside a real amount on a
      // printed invoice reads as a rendering fault, not as "work with no
      // project". Shared with the client's own charts via convex/lib/labels.ts
      // so the two never print two different names for the same bucket.
      description: bucket.project?.name ?? NO_PROJECT_LABEL,
      quantityCentis,
      unitCents,
      amountCents: lineAmountCents(quantityCentis, unitCents),
      projectId: bucket.projectId,
    })
  }
  return lines
}

/**
 * Collapses priced project lines into one client-facing summary when one rate
 * can still explain every printed number.
 *
 * Mixed rates stay split: a single line cannot carry two multipliers without
 * hiding the arithmetic. A one-line input is still rewritten because removing
 * the internal project name is part of the feature, not merely an optimisation
 * for ranges with several projects.
 */
export function mergeLines(
  lines: ReadonlyArray<InvoiceLineDraft>,
  description: string
): Array<InvoiceLineDraft> {
  if (lines.length === 0) return []

  const unitCents = lines[0].unitCents
  if (lines.some((line) => line.unitCents !== unitCents)) return [...lines]

  const quantityCentis = lines.reduce(
    (sum, line) => sum + line.quantityCentis,
    0
  )
  return [
    {
      description,
      quantityCentis,
      unitCents,
      amountCents: lineAmountCents(quantityCentis, unitCents),
      projectId: null,
    },
  ]
}
