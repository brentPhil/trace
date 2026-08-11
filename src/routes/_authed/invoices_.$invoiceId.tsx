import { Link, createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { ExportPdfButton } from "@/components/invoices/export-pdf-button"
import { InvoiceRecord } from "@/components/invoices/invoice-record"
import { Page } from "@/components/shell/page"
import { Empty } from "@/components/ui/empty"
import { traceErrorCode } from "@shared/codes"
import { api } from "../../../convex/_generated/api"
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
 */
export const Route = createFileRoute("/_authed/invoices_/$invoiceId")({
  /*
   * The NUMBER, not the word "Invoice".
   *
   * Two invoices open in two tabs are the ordinary way this page is used —
   * copying a figure from one onto another, or checking last month's against
   * this month's — and "Invoice — Trace" twice makes the tab strip useless for
   * exactly that. `loaderData` is undefined while the loader is still in
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
            ? "Invoice — Trace"
            : `Invoice #${loaderData.number} — Trace`,
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

/**
 * What `/invoices/anything-else` renders.
 *
 * THE ROUTE'S OWN BOUNDARY, not a widened `AuthedErrorBoundary`, and the reason
 * is that the two failures this URL has are not both Trace errors. A stale
 * bookmark or another account's id raises `NOT_FOUND` from `getOwned`, but
 * `/invoices/whatever` fails `api.invoices.get`'s `v.id()` ARGUMENT VALIDATOR
 * before any handler runs, and that error carries no code for a layout
 * narrowing on `code === "NOT_FOUND"` to match — it would rethrow, and the user
 * would get TanStack's built-in screen with a raw serialised error and no link
 * back. A route-level boundary catches whatever this route's loader raises,
 * which is the actual set.
 *
 * The rest of the argument is that "not found" has no single sentence. This is
 * the app's first id-bearing route and, with `Create invoice` on /reports, its
 * most-shared URL shape; the next such route's missing row will want its own
 * words and its own way back, and a `NOT_FOUND` arm on the layout would give
 * every one of them the same ones.
 *
 * `UNAUTHENTICATED` is rethrown deliberately: an expired session is the layout
 * boundary's job and it answers with a sign-in link, which "no such invoice"
 * would replace with a dead end.
 */
export function InvoiceUnreachable({ error }: { error: Error }) {
  if (traceErrorCode(error) === "UNAUTHENTICATED") throw error

  return (
    /*
      A `Page` like every other screen in this product, error component or not.
      This one renders in the outlet exactly where the record would have, so a
      failure that built itself a different way would be the very inconsistency
      `Page` exists to end — and it is the one branch of this route that DOES
      need its own `<h1>`, because the document whose masthead normally supplies
      it is the thing that is missing.
    */
    <Page title="Invoice">
      <div className="px-4 pb-6">
        <Empty>
          There is no invoice at this address. It may have been deleted, or the
          link may be mistyped — invoice pages are not shared between accounts.{" "}
          <Link to="/invoices" className="underline underline-offset-2">
            Back to invoices
          </Link>
          .
        </Empty>
      </div>
    </Page>
  )
}

function InvoiceRoute() {
  const { invoiceId } = Route.useParams()
  return <InvoicePage invoiceId={invoiceId as Id<"invoices">} />
}

/**
 * The invoice, as the client received it.
 *
 * THE ONLY INVOICE PAGE, and read-only because the document is. An invoice is
 * write-once: everything on it is asked for at `/invoices/new` and frozen the
 * moment it is minted. There is no editor to reach from here and no mutation
 * that would accept the edit.
 *
 * That is what lets this page answer the question actually asked at it — "what
 * did I send them?". A form with the values already in its boxes cannot: an
 * input looks identical whether its contents were sent last month or typed
 * thirty seconds ago and abandoned, and those mean opposite things when a
 * client is disputing a figure.
 *
 * It is the same document the PDF prints, drawn from the same derivations —
 * see `InvoiceRecord` and `src/lib/invoice-document.ts`.
 *
 * STILL NO STATUS. There is no draft/issued/paid and nothing freezes, because
 * there is no state to be in: read-only here is what the document IS, not a
 * mode it has been put into.
 *
 * Exported and taking its id as a prop — the same split every route test in
 * this directory relies on, so the page can be rendered against a seeded query
 * client with no router context.
 */
export function InvoicePage({ invoiceId }: { invoiceId: Id<"invoices"> }) {
  const { data: invoice } = useSuspenseQuery(convexQuery(api.invoices.get, { invoiceId }))
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))

  return (
    /*
      THE ONE PAGE THAT PASSES NO `title`, and `Page` permits exactly this case:
      the content already supplies the `<h1>`. It is `InvoiceRecord`'s masthead
      — the word "Invoice", set the way the paper sets it, as the first line of
      the document rather than a label above it. A `title` here, even
      `titleHidden`, would put a second `<h1>` on the page saying the same word
      as the first, which is a worse outline than one heading in the right
      place. The `sr-only` answer /timer and /reports take is for a page with no
      heading at all; this page has one.

      NOT PINNED. Export is a control, but it is not a control over what scrolls
      — it acts on the whole document, which is one panel roughly a screen tall,
      and it is where the breadcrumb is because leaving is the only other thing
      you can do here.
    */
    <Page
      above={
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <li>
              <Link to="/invoices" className="underline-offset-2 hover:underline">
                Invoices
              </Link>
            </li>
            {/* Decorative: the list above and the page below are already
                ordered, and a screen reader announcing "rsaquo" between them
                is noise. */}
            <li aria-hidden="true">›</li>
            <li aria-current="page" className="tabular text-foreground">
              #{invoice.number}
            </li>
          </ol>
        </nav>
      }
      /*
        Top-right, opposite the breadcrumb: the one thing you do to a finished
        document. There is no Edit beside it — an invoice is write-once — so
        Export is not competing for the eye with a control that would be the
        more destructive of the two.
      */
      actions={<ExportPdfButton invoice={invoice} timeZone={settings.timezone} />}
    >
      {/* Full width and `px-4` on the content element itself, like every other
          page — see The One Measure Rule. `pb-6` only: the top padding is the
          header row's. */}
      <div className="flex flex-1 flex-col px-4 pb-6">
        <InvoiceRecord invoice={invoice} timeZone={settings.timezone} />
      </div>
    </Page>
  )
}
