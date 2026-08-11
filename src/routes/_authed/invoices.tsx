import { Link, createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { format } from "@/lib/report-series"
import { cn } from "@/lib/utils"
import { dayOf } from "@shared/day"
import { formatMoney } from "@shared/money"
import { INVOICE_LIST_LIMIT } from "@shared/scan"
import { api } from "../../../convex/_generated/api"
import type { FunctionReturnType } from "convex/server"

type InvoiceRow = FunctionReturnType<typeof api.invoices.list>["invoices"][number]

export const Route = createFileRoute("/_authed/invoices")({
  head: () => ({ meta: [{ title: "Invoices — Trace" }] }),
  component: Invoices,
})

/** Exported for -invoices.test.tsx, the same way projects.tsx exports `Projects`. */
export function Invoices() {
  const { data } = useSuspenseQuery(convexQuery(api.invoices.list, {}))
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))

  return (
    <div className="flex flex-col">
      {/* Full width and `px-4` on the content element itself, like every other
          page — see The One Measure Rule. */}
      <div className="flex flex-1 flex-col gap-3 px-4 py-6">
        <h1 className="text-sm font-semibold">Invoices</h1>

        {data.invoices.length === 0 ? (
          <p className="max-w-prose rounded-md border border-dashed border-edge-soft px-3 py-4 text-sm text-muted-foreground">
            {/*
              Not "No invoices yet" and nothing else. `createFromRange` is the
              ONLY way an invoice comes into existence, so the empty state's
              job is to say where that happens — otherwise this screen is a
              dead end with a heading on it.
            */}
            No invoices yet. An invoice is raised from a filtered range on{" "}
            <Link to="/reports" className="underline underline-offset-2">
              Reports
            </Link>
            : narrow to one client and one period there, then bill exactly what
            you are looking at.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col rounded-md border border-edge-soft">
              <li
                className={cn(
                  "flex items-center gap-3 px-3 py-2",
                  "border-b border-edge-soft text-[0.8125rem] font-medium text-muted-foreground"
                )}
              >
                {/* Sentence case, no tracked-out eyebrow — The Sentence Case
                    Rule. Widths are shared with the rows below by class, so a
                    header and its column cannot drift apart. */}
                <span className={NUMBER_COL}>Number</span>
                <span className={CLIENT_COL}>Billed to</span>
                {/* "Date issued", not "Issued" — the status column three
                    cells along prints the word "Issued" as a value, and a
                    header that is also a value in another column is read as
                    one. */}
                <span className={DATE_COL}>Date issued</span>
                <span className={TOTAL_COL}>Total</span>
                <span className={STATUS_COL}>Status</span>
              </li>
              {data.invoices.map((invoice) => (
                <InvoiceRowItem
                  key={invoice._id}
                  invoice={invoice}
                  timeZone={settings.timezone}
                />
              ))}
            </ul>

            {/*
              A list that stops at a cap and does not say so is a list that
              claims the account has no older invoices. The count is
              interpolated from the constant that enforces it, never typed
              here — the same rule `TITLE_CAP_NOTE` follows.
            */}
            {data.truncated ? (
              <p className="max-w-prose text-xs text-muted-foreground">
                Only the {INVOICE_LIST_LIMIT} most recently issued invoices are
                listed. Older ones still exist and are not shown here yet.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

/*
 * The columns, as classes rather than a grid template, so the header above and
 * every row below take the SAME width from one declaration each. The client is
 * what absorbs the page — it is the only cell whose content has no natural
 * width — and everything else is `shrink-0`, which is the shape /projects'
 * rows settled on for the same reason.
 */
const NUMBER_COL = "w-28 shrink-0 tabular"
const CLIENT_COL = "min-w-0 flex-1 truncate"
const DATE_COL = "hidden w-28 shrink-0 tabular sm:block"
const TOTAL_COL = "w-28 shrink-0 text-right tabular"
const STATUS_COL = "w-16 shrink-0 text-right"

/**
 * The status, as a word.
 *
 * A coloured dot is the obvious control here and this system forbids it:
 * meaning is never carried by colour alone. There is no colour that could
 * carry it either — cold means running and warm means money, and a draft
 * invoice is neither. So the word IS the signal, and the only reinforcement is
 * a step of the neutral ramp: an issued or paid invoice is a fact about the
 * outside world and sits at Ink, a draft is still only yours and sits at Ink
 * Muted.
 */
const STATUS_LABEL = {
  draft: "Draft",
  issued: "Issued",
  paid: "Paid",
} as const

function InvoiceRowItem({
  invoice,
  timeZone,
}: {
  invoice: InvoiceRow
  timeZone: string
}) {
  // `billedTo` is a SNAPSHOT block — "Name\nAddress line\n…" — so the first
  // line is the party's name. Read from the invoice rather than joined through
  // `clientId`, which is the whole point of storing it: renaming a client must
  // not rewrite what last year's invoice says it was billed to.
  const billedToName = invoice.billedTo.split("\n")[0]?.trim() ?? ""

  return (
    <li
      className={cn(
        "flex items-center gap-3 px-3 py-2 text-sm",
        "border-b border-edge-soft last:border-b-0"
      )}
    >
      {/*
        Ink, NOT brass. An invoice number is an identifier, not a currency
        amount — the Two Temperatures Rule spends warm on money and nothing
        else. Tabular because it is digits somebody reads down a column.
      */}
      <span className={NUMBER_COL}>{invoice.number}</span>

      <span className={CLIENT_COL}>
        {billedToName === "" ? (
          // Italic muted, the same treatment `formatRate` gives "No rate set":
          // an absence stated as an absence, never as a blank cell.
          <span className="italic text-muted-foreground">No client</span>
        ) : (
          billedToName
        )}
      </span>

      {/* Ink Muted — a date is secondary to the figure beside it, and it is
          certainly not money. Rendered in the user's STORED zone, never the
          browser's: `dayOf` is the one place that decision lives, and a
          travelling freelancer's invoice must not change its date. */}
      <span className={cn(DATE_COL, "text-muted-foreground")}>
        {format(dayOf(invoice.issuedAt, timeZone), {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </span>

      {/*
        THE one brass figure on this page: a currency amount, in the currency
        this invoice snapshotted at creation rather than whatever the account
        is set to today. `formatMoney` because there is exactly one money
        formatter in the product.
      */}
      <span className={cn(TOTAL_COL, "font-medium text-brass")}>
        {formatMoney(invoice.totalCents, invoice.currency)}
      </span>

      <span
        className={cn(
          STATUS_COL,
          "text-xs",
          invoice.status === "draft" ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {STATUS_LABEL[invoice.status]}
      </span>
    </li>
  )
}
