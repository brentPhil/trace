import { useCallback } from "react"
import { useConvexMutation } from "@convex-dev/react-query"
import { useLatest } from "@/hooks/use-latest"
import { newClientKey } from "@/lib/client-key"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"

/**
 * The invoice editor's whole write surface, in one hook.
 *
 * The same shape as `useClassifierMutations`: the route calls this and passes
 * the results down as props, so the components under src/components/invoices
 * never learn the Convex function surface — the boundary eslint.config.js
 * enforces, and what lets those components be rendered against fixtures with
 * no backend at all.
 *
 * Neither of these swallows a refusal. `invoices.update` refuses an issued
 * invoice, an over-long block and an unreadable currency, and the field that
 * sent the value is where the user needs to read about it.
 */
export function useInvoiceMutations() {
  const updateMutation = useLatest(useConvexMutation(api.invoices.update))
  const setStatusMutation = useLatest(useConvexMutation(api.invoices.setStatus))

  const updateInvoice = useCallback(
    async (input: {
      invoiceId: Id<"invoices">
      billedTo?: string
      payTo?: string
      currency?: string
      issuedAt?: number
      dueAt?: number
      purchaseOrder?: string
      paymentTerms?: string
    }) => await updateMutation(input),
    [updateMutation]
  )

  const setInvoiceStatus = useCallback(
    async (invoiceId: Id<"invoices">, status: "draft" | "issued" | "paid") =>
      await setStatusMutation({ invoiceId, status }),
    [setStatusMutation]
  )

  return { updateInvoice, setInvoiceStatus }
}

/**
 * Raising an invoice from a range — /reports' write, not the editor's.
 *
 * Its own hook rather than a third member of the one above, because the two
 * live on different pages and the editor has no business holding a mutation
 * that mints documents.
 *
 * THE `clientKey` IS MINTED HERE, at the moment of the call, exactly as
 * `use-entry-edit-mutations.ts` mints one for a created entry. It is what makes
 * the mutation idempotent: a request whose response is lost and is retried by
 * the Convex client carries the same key, and `createFromRange` finds the row
 * through `by_user_clientKey` and returns it instead of minting a second
 * invoice — and a second invoice is a second NUMBER, which is the failure the
 * whole numbering scheme exists to prevent. Minting it inside this callback
 * rather than once per mount is deliberate and is the same trade entries make:
 * one deliberate act gets one key, so a genuine second click after a genuine
 * first invoice raises a genuine second document.
 */
export function useCreateInvoice() {
  const createMutation = useLatest(useConvexMutation(api.invoices.createFromRange))

  const createInvoice = useCallback(
    /*
     * A RANGE AND THE FILTER OVER IT, because those together are what /reports
     * is showing. `createFromRange` applies the three filter fields to the same
     * scan the page's own `rangeBreakdown` ran, so the invoice bills the rows
     * on screen rather than every row in the dates.
     *
     * `billableOnly` is deliberately not among them: the mutation hard-codes it
     * true for every invoice, and a caller able to send `false` could raise one
     * for time nobody means to charge for.
     */
    async (view: {
      fromMs: number
      toMs: number
      timeZone: string
      weekStartDay: number
      projectId: string | null
      text: string
      presets: Array<"no-project" | "no-note" | "under-a-minute">
    }) => await createMutation({ clientKey: newClientKey(), ...view }),
    [createMutation]
  )

  return { createInvoice }
}
