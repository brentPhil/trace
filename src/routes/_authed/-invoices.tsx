/*
 * /invoices — THE PAGE, NOT THE ROUTE. The route definition stays in
 * invoices.tsx; the `-` prefix keeps this file out of the route tree, the same
 * convention the tests beside it already use.
 *
 * The component lives here because it has to be EXPORTED — -invoices.test.tsx
 * renders it against a seeded query client — and an export of a route file is
 * something the router's code-splitter refuses to split: every page shipped in
 * the eager bundle, with a [tanstack-router] warning per route saying so.
 * Imported from a non-route file, `component:` splits as normal.
 */
import { Empty } from "@/components/ui/empty"
import { Link } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { Page } from "@/components/shell/page"
import { format } from "@/lib/report-series"
import { cn } from "@/lib/utils"
import { dayOf } from "@shared/day"
import { sumByCurrency } from "@shared/invoiceMath"
import { formatMoney } from "@shared/money"
import { INVOICE_LIST_LIMIT } from "@shared/scan"
import { api } from "../../../convex/_generated/api"
import type { FunctionReturnType } from "convex/server"

type InvoiceRow = FunctionReturnType<typeof api.invoices.list>["invoices"][number]

export function Invoices() {
  const { data } = useSuspenseQuery(convexQuery(api.invoices.list, {}))
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))

  /*
   * One row per currency, never one number. See `sumByCurrency` — an invoice
   * carries the currency it was raised in, so a list can hold two and there is
   * no honest way to add them.
   */
  const totals = sumByCurrency(data.invoices)

  return (
    /*
      NOT PINNED — see `Page`'s rule. This header is a title and nothing else,
      and a title does not stop being true when it scrolls away. The thing on
      this page that WOULD be worth pinning is the table's own header row, not
      the word above it, and that is a `<thead>` decision rather than a page
      one — so pinning here would put the wrong element on screen and still
      leave the columns unlabelled halfway down a fifty-row list.
    */
    <Page title="Invoices">
      {/* Full width and `px-4` on the content element itself, like every other
          page — see The One Measure Rule. `pb-6` only: the top padding belongs
          to the title row above, which is the one place that draws it. */}
      <div className="flex flex-1 flex-col gap-3 px-4 pb-6">
        {data.invoices.length === 0 ? (
          <Empty>
            {/*
              Not "No invoices yet" and nothing else. `createFromRange` is the
              ONLY way an invoice comes into existence, so the empty state's
              job is to say where that happens — otherwise this screen is a
              dead end with a heading on it.

              THE STATE FIRST, THEN THE ROUTE OUT. It used to run the two
              together in one paragraph, so the sentence a reader needed —
              where invoices come from — had to be found inside a sentence
              telling them something they could already see. The first line is
              Ink and the instruction is muted beneath it, which is the same
              two-tone hierarchy every other block on these pages uses.

              "BILL EXACTLY WHAT YOU ARE LOOKING AT" was a promise the product
              did not keep for as long as `createFromRange` took a range and
              ignored the filter beside it; it now does, literally, and
              /invoices/new draws those very lines before anything is minted.
              "One project", not "one client", for the reason `MIXED_CLIENTS`
              gives in convex/invoices.ts: the picker on that page is by
              project, and an empty state that sends someone looking for a
              control that does not exist is worse than one that says less.
            */}
            <span className="mb-1 block font-medium text-foreground">
              No invoices yet.
            </span>
            An invoice is raised from a filtered range on{" "}
            <Link to="/reports" className="underline underline-offset-2">
              Reports
            </Link>
            : narrow to one project and one period there, press Create invoice,
            and you will be shown the exact lines before anything is minted.
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
            <div className="overflow-x-auto rounded-md border border-border">
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
                  <tr className="border-b border-border text-[0.8125rem] font-medium text-muted-foreground">
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
                    {/* "Date issued", not "Issued": the bare participle reads
                        as a state an invoice is IN, and this product tracks no
                        such state. It is the date on the document. */}
                    <th scope="col" className={cn(DATE_COL, "px-3 py-2 text-left")}>
                      Date issued
                    </th>
                    <th scope="col" className={cn(TOTAL_COL, "px-3 py-2 text-right")}>
                      Total
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

                {/*
                  The footer is a `<tfoot>`, which is what makes it a total
                  rather than a row that happens to be last: assistive tech
                  announces it as the table's summary, and a browser printing a
                  long table repeats it. It is also why the label is a
                  `<th scope="row">` — the number the eye lands on needs
                  something naming it.
                */}
                <tfoot>
                  {totals.map(({ currency, totalCents }) => (
                    <tr
                      key={currency}
                      /* Edge, not Edge Soft. Every other rule in this table
                         separates one row from the next; this one separates the
                         rows from what they add up to, and reads as the heavier
                         boundary it is. */
                      className="border-t border-border"
                    >
                      <th
                        scope="row"
                        colSpan={2}
                        className="px-3 py-2 text-left text-[0.8125rem] font-medium text-muted-foreground"
                      >
                        {totalLabel(currency, totals.length > 1, data.truncated)}
                      </th>
                      {/* Carries DATE_COL's own responsive class so this cell
                          disappears with the column it sits under, rather than
                          shunting the total one place left on a phone. */}
                      <td className={DATE_COL} />
                      <td className="px-3 py-2 text-right font-medium font-mono tabular-nums tracking-[-0.02em] text-foreground">
                        {formatMoney(totalCents, currency)}
                      </td>
                    </tr>
                  ))}
                </tfoot>
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
    </Page>
  )
}

// ---------------------------------------------------------------------------

/**
 * What the footer's figure is a total OF.
 *
 * Plain "Total" is only true when the table holds the whole history in one
 * currency. Capped, it is a total of the newest page and not of the account —
 * the same lie the cap note below the table exists to prevent, and it would be
 * a worse one here because this one wears a currency symbol. "Those listed"
 * rather than a count: trashed rows can leave the page shorter than the cap, so
 * a number here could disagree with the rows above it.
 */
function totalLabel(currency: string, manyCurrencies: boolean, truncated: boolean): string {
  const what = truncated ? "Total of those listed" : "Total"
  return manyCurrencies ? `${what} (${currency})` : what
}

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

/*
 * Wide enough for the number, and `whitespace-nowrap` so it cannot wrap even
 * if it is not.
 *
 * `MMDDYY-NNNN` at the body size is ~92pt of monospaced digits, and `w-28` (112px)
 * minus `px-3` on both sides leaves 88 — four short. The hyphen is a break
 * opportunity, so the cell took it and rendered `081126-` above `0002`: an
 * identifier split across two lines, which reads as two things and is the one
 * value on this row a person copies by eye.
 *
 * BOTH halves, deliberately. The width is what makes it fit today; the
 * nowrap is what keeps it one token when the sequence passes 9,999 and the
 * number grows a digit, or when a future zone stamps a longer date. A column
 * sized exactly to its content is a column that wraps the first time the
 * content changes.
 */
const NUMBER_COL = "w-36 whitespace-nowrap"
/** Deliberately widthless: under `table-fixed` the unsized column takes what
 *  the others leave, which is what makes the client name the thing that gives
 *  way when the viewport narrows. */
const CLIENT_COL = ""
const DATE_COL = "hidden w-32 sm:table-cell"
const TOTAL_COL = "w-28"

/*
 * THERE IS NO STATUS COLUMN, and its absence is deliberate rather than pending.
 * An invoice here is a document you edit and export, not a row in a receivables
 * ledger — nothing in this product observes whether one has been sent or paid,
 * so a column claiming to would be a field the app has no way of keeping true.
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
    /*
     * THE WHOLE ROW IS THE TARGET, and it took `relative` plus a stretched
     * pseudo-element to get there honestly.
     *
     * A `<tr>` wrapped in an `<a>` is not valid HTML and no browser keeps the
     * table layout through it; a row made clickable with an `onClick` alone is
     * unreachable from a keyboard and invisible to a screen reader's link list.
     * So the LINK stays on the number — one anchor, correctly named — and its
     * `::after` is stretched over the row that contains it. What a pointer can
     * hit becomes the whole row; what the accessibility tree sees is unchanged.
     *
     * If a browser ever refuses `position: relative` on a `<tr>` the stretch
     * collapses to the cell, which is exactly the behaviour this row had
     * before — a degradation, not a break.
     *
     * The hover fill is one tonal step (The Tonal Depth Rule) and is now honest:
     * it lights the whole row because the whole row is what responds. `has-[a:
     * focus-visible]` gives the keyboard the same fill the mouse gets, so the
     * row a tab has reached is as obvious as the row a pointer is over.
     */
    <tr
      className={cn(
        "relative border-b border-border last:border-b-0",
        "transition-colors hover:bg-card has-[a:focus-visible]:bg-card",
        "motion-reduce:transition-none"
      )}
    >
      {/*
        Ink, NOT brass. An invoice number is an identifier, not a currency
        amount — the Two Temperatures Rule spends warm on money and nothing
        else. Tabular because it is digits somebody reads down a column.

        `scope="row"` because the number is what names this invoice: a screen
        reader reading the total then announces which invoice it belongs to,
        and it is what the link list should say — "072726-0013", not "row".
      */}
      {/* `whitespace-nowrap` again rather than inherited from NUMBER_COL:
          `white-space` is an inherited property, but a header cell is this
          cell's SIBLING, not its ancestor — `table-fixed` carries the column's
          width down and nothing else. Declaring it only on the header is
          exactly how the number came to wrap while the header did not. */}
      <th
        scope="row"
        className="px-3 py-2 text-left font-normal whitespace-nowrap font-mono tabular-nums tracking-[-0.02em]"
      >
        <Link
          to="/invoices/$invoiceId"
          params={{ invoiceId: invoice._id }}
          className={cn(
            // Underlined AT REST, not only on hover. The row leads somewhere
            // now, and a plain-looking string in a table of plain-looking
            // strings is a target nobody knows is there — DESIGN.md asks the
            // interface to be learnable, and a link that only admits to being
            // one under the pointer is not. Edge at rest, Ink on hover: the
            // affordance is always present and still has somewhere to go.
            "rounded-sm underline decoration-border underline-offset-4",
            "hover:decoration-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            "after:absolute after:inset-0 after:content-['']"
          )}
        >
          {invoice.number}
        </Link>
      </th>

      {/* The client is what a person actually scans this list for — "the
          Vessel Vanguard one" — so it carries the row's weight, while the
          number beside it is an identifier you look up rather than read. */}
      <td className="truncate px-3 py-2 font-medium">
        {billedToName === "" ? (
          // Italic muted and NOT medium: the same treatment `formatRate` gives
          // "No rate set". An absence stated as an absence, never as a blank
          // cell, and never dressed as a name.
          <span className="font-normal italic text-muted-foreground">No client</span>
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
      <td className="px-3 py-2 text-right font-medium font-mono tabular-nums tracking-[-0.02em] text-foreground">
        {formatMoney(invoice.totalCents, invoice.currency)}
      </td>
    </tr>
  )
}
