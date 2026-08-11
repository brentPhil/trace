import { Link, createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { STATUS_LABEL } from "@/components/invoices/status-control"
import { Empty } from "@/components/ui/empty"
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
          <Empty>
            {/*
              Not "No invoices yet" and nothing else. `createFromRange` is the
              ONLY way an invoice comes into existence, so the empty state's
              job is to say where that happens — otherwise this screen is a
              dead end with a heading on it.

              "BILL EXACTLY WHAT YOU ARE LOOKING AT" was a promise the product
              did not keep for as long as `createFromRange` took a range and
              ignored the filter beside it; it now does, literally. "One
              project", not "one client", for the reason `MIXED_CLIENTS` gives
              in convex/invoices.ts: the picker on that page is by project, and
              an empty state that sends someone looking for a control that does
              not exist is worse than one that says less.
            */}
            No invoices yet. An invoice is raised from a filtered range on{" "}
            <Link to="/reports" className="underline underline-offset-2">
              Reports
            </Link>
            : narrow to one project and one period there, then bill exactly what
            you are looking at.
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {/*
              A real <table>, not a <ul> of flex rows.
              /projects gets away with a list because it has no header row; the
              moment five aligned columns get one, the thing IS a table and a
              screen reader given a list announces "51 items" and reads the
              header as the first of them. Native <th scope="col"> is also how
              the calendars in this product already earn their `columnheader`
              roles — there is no ARIA here that markup did not give.
            */}
            <div className="overflow-x-auto rounded-md border border-edge-soft">
              {/* `table-fixed` so the widths on the header cells are what the
                  browser lays out from, rather than the widest cell in each
                  column — which is what makes a long client name truncate
                  instead of shoving the total off the row. */}
              <table className="w-full table-fixed border-collapse text-sm">
                {/* The table needs a name of its own: the <h1> above is not
                    attached to it, and "table with 5 columns" is not one. */}
                <caption className="sr-only">
                  Invoices, most recently issued first
                </caption>
                <thead>
                  <tr className="border-b border-edge-soft text-[0.8125rem] font-medium text-muted-foreground">
                    {/* Sentence case, no tracked-out eyebrow — The Sentence
                        Case Rule. Widths live on the header cells only; the
                        body inherits them from the column, so a header and its
                        column cannot drift apart. */}
                    <th scope="col" className={cn(NUMBER_COL, "px-3 py-2 text-left")}>
                      Number
                    </th>
                    <th scope="col" className={cn(CLIENT_COL, "px-3 py-2 text-left")}>
                      Billed to
                    </th>
                    {/* "Date issued", not "Issued" — the status column three
                        cells along prints the word "Issued" as a value, and a
                        header that is also a value in another column is read
                        as one. */}
                    <th scope="col" className={cn(DATE_COL, "px-3 py-2 text-left")}>
                      Date issued
                    </th>
                    <th scope="col" className={cn(TOTAL_COL, "px-3 py-2 text-right")}>
                      Total
                    </th>
                    <th scope="col" className={cn(STATUS_COL, "px-3 py-2 text-right")}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((invoice) => (
                    <InvoiceRowItem
                      key={invoice._id}
                      invoice={invoice}
                      timeZone={settings.timezone}
                    />
                  ))}
                </tbody>
              </table>
            </div>

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
 * The columns. Widths are declared once, on the header cells, and the table
 * layout carries them down the column — which is the reason to use a table
 * here beyond the semantics: the header and its cells cannot drift apart
 * because they are no longer two independent declarations that happen to
 * agree. The client column is given no width and so absorbs the page; it is
 * the only cell whose content has no natural one.
 *
 * `sm:table-cell`, not `sm:block`: a `<td>` set to `display: block` leaves the
 * table layout and stops aligning with its column.
 */
const NUMBER_COL = "w-28"
/** Deliberately widthless: under `table-fixed` the unsized column takes what
 *  the others leave, which is what makes the client name the thing that gives
 *  way when the viewport narrows. */
const CLIENT_COL = ""
const DATE_COL = "hidden w-32 sm:table-cell"
const TOTAL_COL = "w-28"
const STATUS_COL = "w-20"

/*
 * The status is a WORD (see `STATUS_LABEL`, which the editor shares so the two
 * screens cannot spell "Issued" two ways), and the only reinforcement it gets
 * here is a step of the neutral ramp: an issued or paid invoice is a fact
 * about the outside world and sits at Ink, a draft is still only yours and
 * sits at Ink Muted. No dot, no hue — meaning is never carried by colour
 * alone, and there is no colour that could carry this one: cold means running
 * and warm means money, and a draft invoice is neither.
 */

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
    <tr className="border-b border-edge-soft last:border-b-0">
      {/*
        Ink, NOT brass. An invoice number is an identifier, not a currency
        amount — the Two Temperatures Rule spends warm on money and nothing
        else. Tabular because it is digits somebody reads down a column.

        `scope="row"` because the number is what names this invoice: a screen
        reader reading the total then announces which invoice it belongs to.

        THE LINK IS ON THE NUMBER, not on the row. A `<tr>` wrapped in an `<a>`
        is not valid HTML and no browser keeps the table layout through it, and
        a row made clickable with an onClick alone is unreachable from a
        keyboard. The number is also the thing that names the invoice, so it is
        what a screen reader's link list should say — "072726-0013", not "row".
      */}
      <th scope="row" className="px-3 py-2 text-left font-normal tabular">
        <Link
          to="/invoices/$invoiceId"
          params={{ invoiceId: invoice._id }}
          className={cn(
            "rounded-sm underline-offset-2 hover:underline",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          {invoice.number}
        </Link>
      </th>

      <td className="truncate px-3 py-2">
        {billedToName === "" ? (
          // Italic muted, the same treatment `formatRate` gives "No rate set":
          // an absence stated as an absence, never as a blank cell.
          <span className="italic text-muted-foreground">No client</span>
        ) : (
          billedToName
        )}
      </td>

      {/* Ink Muted — a date is secondary to the figure beside it, and it is
          certainly not money. Rendered in the user's STORED zone, never the
          browser's: `dayOf` is the one place that decision lives, and a
          travelling freelancer's invoice must not change its date. */}
      <td className={cn(DATE_COL, "px-3 py-2 text-muted-foreground")}>
        {format(dayOf(invoice.issuedAt, timeZone), {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </td>

      {/*
        THE one brass figure on this page: a currency amount, in the currency
        this invoice snapshotted at creation rather than whatever the account
        is set to today. `formatMoney` because there is exactly one money
        formatter in the product.
      */}
      <td className="px-3 py-2 text-right font-medium tabular text-brass">
        {formatMoney(invoice.totalCents, invoice.currency)}
      </td>

      <td
        className={cn(
          "px-3 py-2 text-right text-xs",
          invoice.status === "draft" ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {STATUS_LABEL[invoice.status]}
      </td>
    </tr>
  )
}
