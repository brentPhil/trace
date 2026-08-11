import { Link, createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { InvoiceMeta } from "@/components/invoices/invoice-meta"
import { PartyBlock } from "@/components/invoices/party-block"
import { Empty } from "@/components/ui/empty"
import { Toast } from "@/components/ui/toast"
import { useInvoiceMutations } from "@/hooks/use-invoice-mutations"
import { errorMessage } from "@/lib/error-message"
import { formatRate } from "@/lib/format-money"
import { cn } from "@/lib/utils"
import { traceErrorCode } from "@shared/codes"
import { formatMoney, supportedCurrencies } from "@shared/money"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"

/*
 * `invoices_.$invoiceId`, with the underscore — and the URL is still
 * `/invoices/$invoiceId`.
 *
 * The plan names this file `invoices.$invoiceId.tsx`. Written that way,
 * TanStack's flat routing makes it a CHILD of `/_authed/invoices`, so
 * `/invoices/072726-0013` renders the LIST and this page appears only inside
 * an `<Outlet />` that a list of invoices has no reason to carry. The trailing
 * underscore is the router's own escape hatch for exactly this case: same
 * path, no nesting. The alternative was splitting the list into
 * `invoices.index.tsx` beneath an `invoices.tsx` layout — three files and a
 * moved component to say "these are two pages, not one inside another".
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
  return <InvoiceEditor invoiceId={invoiceId as Id<"invoices">} />
}

/**
 * The invoice document's head, editable in place.
 *
 * Exported and taking its id as a prop — the same split every route test in
 * this directory relies on, so the page can be rendered against a seeded query
 * client with no router context.
 *
 * NO SAVE BUTTON. Every field autosaves on blur, as every other editable
 * surface in this app does.
 *
 * AND NO STATUS, which is the shape of this page rather than a missing part of
 * it. There is no draft/issued/paid, nothing freezes, and there is nothing to
 * unlock: an invoice is a document you edit and export, editable for as long as
 * it exists, and `invoices.update` enforces exactly that by refusing nothing on
 * state. What belongs top-right is Export PDF, which is the next task.
 *
 * The lines, taxes and totals are Task 6; they render here read-only so the
 * page is a document rather than a form with the money missing.
 */
export function InvoiceEditor({ invoiceId }: { invoiceId: Id<"invoices"> }) {
  const { data: invoice } = useSuspenseQuery(convexQuery(api.invoices.get, { invoiceId }))
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const { updateInvoice } = useInvoiceMutations()
  const toasts = Toast.useToastManager()

  /** Rethrows on purpose: each field shows its own refusal, beside itself. */
  const save = async (patch: Omit<Parameters<typeof updateInvoice>[0], "invoiceId">) => {
    await updateInvoice({ ...patch, invoiceId })
  }

  return (
    <div className="flex flex-col">
      {/* Full width and `px-4` on the content element itself, like every other
          page — see The One Measure Rule. */}
      <div className="flex flex-1 flex-col gap-6 px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          {/* Alone on its row for now: Export PDF lands beside it, which is
              what the space on the right is being held for. */}
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
        </div>

        <h1 className="text-sm font-semibold">Invoice</h1>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <InvoiceMeta
            number={invoice.number}
            issuedAt={invoice.issuedAt}
            dueAt={invoice.dueAt}
            purchaseOrder={invoice.purchaseOrder}
            paymentTerms={invoice.paymentTerms}
            timeZone={settings.timezone}
            onChange={save}
          />
          <LogoSlot />
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <PartyBlock
            label="Billed to"
            value={invoice.billedTo}
            placeholder={"Client name\nStreet\nCity, country"}
            onCommit={async (billedTo) => await save({ billedTo })}
          />
          <PartyBlock
            label="Pay to"
            value={invoice.payTo}
            placeholder={"Your name\nStreet\nCity, country"}
            onCommit={async (payTo) => await save({ payTo })}
          />
          <CurrencyBlock
            currency={invoice.currency}
            onChange={(currency) => {
              void save({ currency }).catch((thrown: unknown) => {
                toasts.add({ title: errorMessage(thrown), priority: "high", timeout: 8_000 })
              })
            }}
          />
        </div>

        <Lines lines={invoice.lines} currency={invoice.currency} />

        {/*
          THE FOOT OF THE DOCUMENT, and that is why it is here rather than in
          the meta grid at the top. This is a message to the client — where to
          send the money, a thank-you, the terms the one-line `Payment terms`
          field is too short to hold — and it is read after the total, not
          beside the invoice date.

          `PartyBlock` itself rather than a second multiline editor: it already
          keeps its newlines, saves on blur, reverts on Escape, and keeps the
          typed text on screen when the server refuses it with the reason
          beside it. A user should not have to learn two editing behaviours in
          one product, and this is prose printed verbatim exactly as an address
          block is.

          `?? ""` because the column is ABSENT when unset — `invoices.update`
          clears it rather than storing "", so there is one spelling of "no
          notes" — while a textarea's value is always a string.
        */}
        <div className="max-w-prose">
          <PartyBlock
            label="Notes"
            value={invoice.notes ?? ""}
            placeholder={"Bank transfer to …\nAccount 1234-5678\n\nThank you!"}
            onCommit={async (notes) => await save({ notes })}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * The logo, as a reserved space and nothing more.
 *
 * Uploading one needs Convex file storage and is deliberately deferred — the
 * plan names it as the natural first follow-up. It renders as a dashed
 * placeholder rather than a `+ Logo` button because a control that cannot do
 * anything is worse than an obvious gap: the gap is honest, the button is a
 * promise. `aria-hidden` for the same reason — there is nothing here to
 * announce and nothing to do.
 */
function LogoSlot() {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "hidden h-20 w-32 shrink-0 items-center justify-center rounded-md",
        "border border-dashed border-edge-soft text-xs text-muted-foreground sm:flex"
      )}
    >
      Logo
    </div>
  )
}

/**
 * The invoice's own currency, which is a SNAPSHOT rather than the account's.
 *
 * `userSettings.currency` may change; this document may not follow it. The
 * list on /settings is narrowed to currencies whose minor unit really is a
 * hundredth (see `supportedCurrencies`), and `invoices.update` checks the same
 * list server-side, so the picker and the validator cannot disagree.
 */
function CurrencyBlock({
  currency,
  onChange,
}: {
  currency: string
  onChange: (currency: string) => void
}) {
  const supported = supportedCurrencies()
  const codes = supported.length > 0 ? supported : [currency, "USD"]
  // A stored code outside the list is still shown, so a value already saved is
  // never silently swapped for something else under the user — the same
  // fallback /settings' own field makes.
  const options = codes.includes(currency) ? codes : [currency, ...codes]

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <span className="text-[0.8125rem] font-medium text-muted-foreground">Currency</span>
      <select
        aria-label="Currency"
        value={currency}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "rounded-md border border-edge bg-ground px-2 py-1.5 text-sm",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        )}
      >
        {options.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </div>
  )
}

type Line = {
  _id: Id<"invoiceLines">
  kind: "time" | "custom"
  description: string
  quantityCentis: number
  unitCents: number
  amountCents: number
}

/**
 * The lines, READ-ONLY.
 *
 * Editing them — a RATE column that can be typed into, custom charges, taxes,
 * the totals and the `AMOUNT` info affordance that states the derivation — is
 * Task 6, and none of it is here. What is here is the document's own figures,
 * because an invoice page showing an address and no money is not a document
 * anybody would recognise.
 *
 * Every number is the STORED one. Nothing on this page recomputes an amount
 * from a quantity and a rate: the printed figure is a fact about the day the
 * invoice was raised, not a function of today's rounding.
 */
function Lines({ lines, currency }: { lines: Array<Line>; currency: string }) {
  if (lines.length === 0) {
    return (
      <Empty>
        No lines on this invoice. Lines come from the range it was raised from on
        Reports — billable time on a project with a rate. Time nobody has priced
        is left off rather than billed at nothing.
      </Empty>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border border-edge-soft">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Invoice lines, in the order they print</caption>
        <thead>
          <tr className="border-b border-edge-soft text-[0.8125rem] font-medium text-muted-foreground">
            <th scope="col" className="px-3 py-2 text-left">
              Description
            </th>
            <th scope="col" className="w-24 px-3 py-2 text-right">
              Quantity
            </th>
            <th scope="col" className="w-32 px-3 py-2 text-right">
              Rate
            </th>
            <th scope="col" className="w-32 px-3 py-2 text-right">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line._id} className="border-b border-edge-soft last:border-b-0">
              <th scope="row" className="truncate px-3 py-2 text-left font-normal">
                {line.description}
              </th>
              {/* Decimal hours, 2 dp, floored — a QUANTITY, not money, so Ink.
                  A billable duration is time that will become money and renders
                  like every other duration (The Two Temperatures Rule). */}
              <td className="px-3 py-2 text-right tabular">
                {(line.quantityCentis / 100).toFixed(2)}
              </td>
              {/* Muted, the same treatment /projects gives a project's rate:
                  it is the multiplier beside the figure, not the figure. */}
              <td className="px-3 py-2 text-right tabular text-muted-foreground">
                {line.kind === "time"
                  ? formatRate(line.unitCents, currency)
                  : formatMoney(line.unitCents, currency)}
              </td>
              {/* The one brass column: a currency amount, in this invoice's own
                  snapshotted currency. */}
              <td className="px-3 py-2 text-right font-medium tabular text-brass">
                {formatMoney(line.amountCents, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
