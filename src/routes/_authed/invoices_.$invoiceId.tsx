import { Link, createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { LockKeyholeOpen } from "lucide-react"
import { InvoiceMeta } from "@/components/invoices/invoice-meta"
import { PartyBlock } from "@/components/invoices/party-block"
import { STATUS_LABEL, StatusControl } from "@/components/invoices/status-control"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Toast } from "@/components/ui/toast"
import { useInvoiceMutations } from "@/hooks/use-invoice-mutations"
import { errorMessage } from "@/lib/error-message"
import { formatRate } from "@/lib/format-money"
import { cn } from "@/lib/utils"
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
  head: () => ({ meta: [{ title: "Invoice — Trace" }] }),
  component: InvoiceRoute,
  loader: async ({ context, params }) => {
    const invoiceId = params.invoiceId as Id<"invoices">
    // Both, in parallel: the document cannot be drawn without its currency's
    // owner (settings) any more than without itself, and chaining them would
    // spend two round trips on one paint.
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.settings.get, {})),
      context.queryClient.ensureQueryData(convexQuery(api.invoices.get, { invoiceId })),
    ])
  },
})

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
 * surface in this app does, and the top-right control is the invoice's STATUS
 * instead. The lines, taxes and totals are Task 6; they render here read-only
 * so the page is a document rather than a form with the money missing.
 */
export function InvoiceEditor({ invoiceId }: { invoiceId: Id<"invoices"> }) {
  const { data: invoice } = useSuspenseQuery(convexQuery(api.invoices.get, { invoiceId }))
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const { updateInvoice, setInvoiceStatus } = useInvoiceMutations()
  const toasts = Toast.useToastManager()

  /*
   * A draft is editable and everything else is not.
   *
   * This is a CONVENIENCE, not the rule — `invoices.update` refuses the same
   * edit server-side with INVOICE_LOCKED, which is what actually keeps the
   * copy in a client's inbox and the copy in this table saying the same thing.
   * Disabling the fields is how a person finds that out before typing a
   * paragraph rather than after.
   */
  const locked = invoice.status !== "draft"

  /** Rethrows on purpose: each field shows its own refusal, beside itself. */
  const save = async (patch: Omit<Parameters<typeof updateInvoice>[0], "invoiceId">) => {
    await updateInvoice({ ...patch, invoiceId })
  }

  const move = (status: "draft" | "issued" | "paid") => {
    // A status change has no field to fail into, so this one is a toast.
    void setInvoiceStatus(invoiceId, status).catch((thrown: unknown) => {
      toasts.add({ title: errorMessage(thrown), priority: "high", timeout: 8_000 })
    })
  }

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

          <StatusControl status={invoice.status} onChange={move} />
        </div>

        {locked ? (
          <div
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-md border border-edge-soft",
              "bg-surface px-3 py-2"
            )}
          >
            {/*
              The word, then the reason, then the way out — never a colour and
              an assumption. `STATUS_LABEL` rather than the raw status, so the
              sentence and the control above it use one vocabulary.
            */}
            <p className="min-w-0 flex-1 text-xs text-muted-foreground">
              {STATUS_LABEL[invoice.status]}. This document has been sent, so its
              details are locked — the copy in your client&apos;s inbox and the copy
              here have to keep saying the same thing.
            </p>
            {/*
              THE UNLOCK, and the reason it is a button rather than an entry in
              the status menu: it is the one deliberate act in this editor.
              Everything else here saves itself the moment you look away.

              A PAID invoice does not get one. The server walks the line a step
              at a time (`invoices.setStatus`), so un-paying comes first — and
              rather than a disabled button, which states a rule without
              teaching it, the sentence names the step.
            */}
            {invoice.status === "issued" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => move("draft")}
                // `border-edge-raised`, not the outline variant's own
                // `border-edge`: this button has no fill in dark mode and sits
                // on the `bg-surface` band, where Edge measures 2.90:1 and is
                // under the 3:1 floor. The Adjacent Colour Rule — a border's
                // contrast is a property of the layer it lands on, not of the
                // token.
                className="border-edge-raised"
              >
                <LockKeyholeOpen data-icon="inline-start" />
                Unlock to edit
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Set the status back to Issued first — a paid invoice is un-paid
                before it is unlocked.
              </p>
            )}
          </div>
        ) : null}

        <h1 className="text-sm font-semibold">Invoice</h1>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <InvoiceMeta
            number={invoice.number}
            issuedAt={invoice.issuedAt}
            dueAt={invoice.dueAt}
            purchaseOrder={invoice.purchaseOrder}
            paymentTerms={invoice.paymentTerms}
            timeZone={settings.timezone}
            readOnly={locked}
            onChange={save}
          />
          <LogoSlot />
        </div>

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <PartyBlock
            label="Billed to"
            value={invoice.billedTo}
            placeholder={"Client name\nStreet\nCity, country"}
            emptyText="No client on this invoice."
            readOnly={locked}
            onCommit={async (billedTo) => await save({ billedTo })}
          />
          <PartyBlock
            label="Pay to"
            value={invoice.payTo}
            placeholder={"Your name\nStreet\nCity, country"}
            emptyText="Nobody to pay yet."
            readOnly={locked}
            onCommit={async (payTo) => await save({ payTo })}
          />
          <CurrencyBlock
            currency={invoice.currency}
            readOnly={locked}
            onChange={(currency) => {
              void save({ currency }).catch((thrown: unknown) => {
                toasts.add({ title: errorMessage(thrown), priority: "high", timeout: 8_000 })
              })
            }}
          />
        </div>

        <Lines lines={invoice.lines} currency={invoice.currency} />
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
  readOnly,
  onChange,
}: {
  currency: string
  readOnly: boolean
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
      {readOnly ? (
        <p className="text-sm tabular">{currency}</p>
      ) : (
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
      )}
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
