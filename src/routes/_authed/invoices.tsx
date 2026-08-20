import { createFileRoute } from "@tanstack/react-router"
import { pageTitle } from "@shared/brand"
import { Invoices } from "./-invoices"

/*
 * The page itself is in ./-invoices — see that file's header. The route file
 * holds nothing but the definition, so `component:` is an import from a
 * non-route file and the code-splitter can do its job.
 */
export const Route = createFileRoute("/_authed/invoices")({
  head: () => ({ meta: [{ title: pageTitle("Invoices") }] }),
  component: Invoices,
})
