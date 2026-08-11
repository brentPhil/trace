import { Link, createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { Pencil } from "lucide-react"
import { ExportPdfButton } from "@/components/invoices/export-pdf-button"
import { InvoiceRecord } from "@/components/invoices/invoice-record"
import { buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { cn } from "@/lib/utils"
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
 * The editor beside it (`invoices_.$invoiceId_.edit.tsx`) needs the escape a
 * SECOND time, on the `$invoiceId` segment, for the same reason one level down.
 * Check `src/routeTree.gen.ts` after touching either: both must parent to
 * `AuthedRoute`, and a route that has quietly become a child of the other
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
 * Exported and shared with the editor route beside it, which has exactly the
 * same two failures at exactly the same id — a second copy would be a second
 * sentence for one fact.
 *
 * `UNAUTHENTICATED` is rethrown deliberately: an expired session is the layout
 * boundary's job and it answers with a sign-in link, which "no such invoice"
 * would replace with a dead end.
 */
export function InvoiceUnreachable({ error }: { error: Error }) {
  if (traceErrorCode(error) === "UNAUTHENTICATED") throw error

  return (
    <div className="flex flex-col gap-6 px-4 py-6">
      <h1 className="text-sm font-semibold">Invoice</h1>
      <Empty>
        There is no invoice at this address. It may have been deleted, or the link
        may be mistyped — invoice pages are not shared between accounts.{" "}
        <Link to="/invoices" className="underline underline-offset-2">
          Back to invoices
        </Link>
        .
      </Empty>
    </div>
  )
}

function InvoiceRoute() {
  const { invoiceId } = Route.useParams()
  return <InvoicePage invoiceId={invoiceId as Id<"invoices">} />
}

/**
 * The invoice, as the client received it.
 *
 * THE RECORD, NOT THE EDITOR — and that swap is the reason this page exists in
 * this shape. `/invoices/$invoiceId` is what the list links to and what gets
 * pasted into a message, and the question asked at it is "what did I send
 * them?". A form with the values already in its boxes cannot answer that: an
 * input looks identical whether its contents were sent last month or typed
 * thirty seconds ago and abandoned, and the two mean opposite things when a
 * client is disputing a figure. Editing moved one segment down, to
 * `/invoices/$invoiceId/edit`, where a control means what a control means.
 *
 * It is the same document the PDF prints, drawn from the same derivations —
 * see `InvoiceRecord` and `src/lib/invoice-document.ts`.
 *
 * STILL NO STATUS. There is no draft/issued/paid, nothing freezes, and there is
 * nothing to unlock: read-only here is a rendering, not a state the invoice is
 * in. `Edit` is always available, and `invoices.update` still refuses nothing on
 * state.
 *
 * Exported and taking its id as a prop — the same split every route test in
 * this directory relies on, so the page can be rendered against a seeded query
 * client with no router context.
 */
export function InvoicePage({ invoiceId }: { invoiceId: Id<"invoices"> }) {
  const { data: invoice } = useSuspenseQuery(convexQuery(api.invoices.get, { invoiceId }))
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))

  return (
    <div className="flex flex-col">
      {/* Full width and `px-4` on the content element itself, like every other
          page — see The One Measure Rule. */}
      <div className="flex flex-1 flex-col gap-6 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
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

          {/*
            Top-right, opposite the breadcrumb: the two things you do to a
            finished document. Export is the one this feature exists for, so it
            keeps the outline; Edit is the quieter of the two because arriving
            here to change something is the rarer errand.
          */}
          <div className="flex items-center gap-2">
            {/* A `<Link>` wearing the button's own classes, the idiom
                `routes/index.tsx` already uses: navigation is an anchor, and an
                anchor is what gives it a middle-click, a right-click menu and a
                real href in the status bar. A `<button>` that navigates has
                none of those. */}
            <Link
              to="/invoices/$invoiceId/edit"
              params={{ invoiceId }}
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            >
              <Pencil className="size-4" />
              Edit
            </Link>
            <ExportPdfButton invoice={invoice} timeZone={settings.timezone} />
          </div>
        </div>

        <h1 className="text-sm font-semibold">Invoice</h1>

        <InvoiceRecord invoice={invoice} timeZone={settings.timezone} />
      </div>
    </div>
  )
}
