import { useCallback } from "react"
import { useConvexMutation } from "@convex-dev/react-query"
import { useLatest } from "@/hooks/use-latest"
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
