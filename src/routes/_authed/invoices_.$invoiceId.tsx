import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { pageTitle } from "@shared/brand"
import { api } from "../../../convex/_generated/api"
import { InvoicePage, InvoiceUnreachable } from "./-invoice-record"
import type { Id } from "../../../convex/_generated/dataModel"

/*
 * `invoices_.$invoiceId`, with the underscore — and the URL is still
 * `/invoices/$invoiceId`.
 *
 * Written as `invoices.$invoiceId.tsx`, TanStack's flat routing makes this a
 * CHILD of `/_authed/invoices`, so `/invoices/072726-0013` renders the LIST and
 * this page appears only inside an `<Outlet />` that a list of invoices has no
 * reason to carry. The trailing underscore is the router's own escape hatch for
 * exactly this case: same path, no nesting. The alternative was splitting the
 * list into `invoices.index.tsx` beneath an `invoices.tsx` layout — three files
 * and a moved component to say "these are two pages, not one inside another".
 *
 * Check `src/routeTree.gen.ts` after touching this: it must parent to
 * `AuthedRoute`, and a route that has quietly become a child of the list
 * renders the wrong component at a URL that still looks right.
 *
 * The page and its error boundary are in ./-invoice-record — see that file's
 * header. The route file holds the definition and the loader, so `component:`
 * and `errorComponent:` are imports from a non-route file and the
 * code-splitter can do its job.
 */
export const Route = createFileRoute("/_authed/invoices_/$invoiceId")({
  /*
   * The NUMBER, not the word "Invoice".
   *
   * Two invoices open in two tabs are the ordinary way this page is used —
   * copying a figure from one onto another, or checking last month's against
   * this month's — and "Invoice — Chroneli" twice makes the tab strip useless
   * for exactly that. `loaderData` is undefined while the loader is still in
   * flight, which is the only case the plain title is still right for.
   */
  /* The parameter is annotated because it cannot be inferred: `head` and
   * `loader` are properties of the same object literal, so inferring one from
   * the other is circular and TypeScript resolves `loaderData` to `never`.
   * The annotation is checked against the real context — `never` is assignable
   * to it — so this widens nothing that could hide a mismatch. */
  head: ({ loaderData }: { loaderData?: { number: string } }) => ({
    meta: [
      {
        title:
          loaderData === undefined
            ? pageTitle("Invoice")
            : pageTitle(`Invoice #${loaderData.number}`),
      },
    ],
  }),
  component: InvoiceRoute,
  errorComponent: InvoiceUnreachable,
  loader: async ({ context, params }): Promise<{ number: string }> => {
    const invoiceId = params.invoiceId as Id<"invoices">
    // Both, in parallel: the document cannot be drawn without its currency's
    // owner (settings) any more than without itself, and chaining them would
    // spend two round trips on one paint.
    const [, invoice] = await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.settings.get, {})),
      context.queryClient.ensureQueryData(convexQuery(api.invoices.get, { invoiceId })),
    ])
    // Only what `head` needs. The component reads the same query out of the
    // cache rather than this, so there is one subscription and no second copy
    // of the document to drift.
    return { number: invoice.number }
  },
})

function InvoiceRoute() {
  const { invoiceId } = Route.useParams()
  return <InvoicePage invoiceId={invoiceId as Id<"invoices">} />
}
