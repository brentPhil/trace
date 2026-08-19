import type { Classification } from "@/components/timer/timer-bar"
import type { Doc } from "../../convex/_generated/dataModel"

/**
 * The billable tick, following the project picker.
 *
 * Picking a billable client's project and then ALSO ticking `$` is the same
 * decision stated twice, and the second statement was forgotten often enough
 * to reach invoices. So a classifier change that assigns a project also
 * carries `billable: true` when the project defaults that way — the `$` ticks
 * itself, visibly, in the same write.
 *
 * PROMOTION ONLY, and that boundary is the whole design:
 *
 *  - An explicit `billable` in the change always wins. The user just said the
 *    word; nothing may talk over them.
 *  - `billable: true` is never taken AWAY. Switching a billable entry to a
 *    non-billable project leaves the tick standing, because the server's rule
 *    (convex/entries.ts: "nothing here derives billable") exists precisely so
 *    a project change cannot silently reverse a billing decision — and a
 *    false→true promotion the user watches happen is not a silent reversal,
 *    while a true→false demotion is exactly one.
 *  - Clearing the project (null) changes nothing: absence has no default to
 *    inherit.
 *
 * The derivation is on the CLIENT for the same reason the timer bar's staging
 * already does it there (timer-bar.tsx): what the `$` shows must provably be
 * what gets written.
 */
export function withInheritedBillable(
  change: Partial<Classification>,
  currentlyBillable: boolean,
  project: Pick<Doc<"projects">, "billableByDefault"> | null | undefined
): Partial<Classification> {
  if (change.billable !== undefined) return change
  if (change.projectId === undefined || change.projectId === null) return change
  if (currentlyBillable) return change
  if (project?.billableByDefault !== true) return change
  return { ...change, billable: true }
}
