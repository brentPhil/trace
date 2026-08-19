import { useCallback } from "react"
import { useConvexMutation } from "@convex-dev/react-query"
import { useLatest } from "@/hooks/use-latest"
import { newClientKey } from "@/lib/client-key"
import { api } from "../../convex/_generated/api"

/**
 * Raising an invoice — the whole write surface an invoice has.
 *
 * ONE mutation, because there is only one. An invoice is write-once: everything
 * on it is asked for at `/invoices/new` and frozen when it is minted, so there
 * is no `update` here and none on the server either. This hook used to have a
 * second half for the editor; the editor is gone, and so is it.
 *
 * The same shape as `useClassifierMutations`: the route calls this and passes
 * the result down as a prop, so components under src/components/invoices never
 * learn the Convex function surface — the boundary eslint.config.js enforces,
 * and what lets those components be rendered against fixtures with no backend.
 *
 * It does not swallow a refusal. `createFromRange` refuses a range spanning two
 * clients, a range too large to total exactly, an account with too many
 * invoices to number safely, and an over-long block on any of the document's
 * own fields — and each names the field it is about in `meta.field`, so the
 * form can put the sentence beside the box that earned it.
 */
export function useCreateInvoice() {
  const createMutation = useLatest(useConvexMutation(api.invoices.createFromRange))

  const createInvoice = useCallback(
    /*
     * A RANGE, THE FILTER OVER IT, AND THE DOCUMENT'S OWN DETAILS.
     *
     * The first two are what /reports was showing: `createFromRange` applies
     * the filter to the same scan the page's `rangeBreakdown` ran, so the
     * invoice bills the rows on screen rather than every row in the dates.
     * `billableOnly` is deliberately absent — the mutation hard-codes it true,
     * and a caller able to send `false` could raise an invoice for time nobody
     * means to charge for.
     *
     * The rest is everything a range cannot tell you: who it is billed to, who
     * is to be paid, on what terms. This is the only moment the product has to
     * ask, because there is no editor afterwards to fill a gap in.
     */
    async (input: {
      fromMs: number
      toMs: number
      timeZone: string
      weekStartDay: number
      projectId: string | null
      text: string
      presets: Array<"no-project" | "no-note" | "under-a-minute">
      billedTo?: string
      payTo?: string
      purchaseOrder?: string
      paymentTerms?: string
      notes?: string
      currency?: string
      issuedAt?: number
      dueAt?: number
    }) => await createMutation({ clientKey: newClientKey(), ...input }),
    [createMutation]
  )

  return { createInvoice }
}
