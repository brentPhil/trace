import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { Invoices } from "@/routes/_authed/invoices"
import { convexKey } from "@/test-utils/convex-query"
import { NOW, SETTINGS } from "@/test-utils/fixtures"
import { INVOICE_LIST_LIMIT } from "@shared/scan"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type * as RouterModuleType from "@tanstack/react-router"

type RouterModule = typeof RouterModuleType

/*
 * Two things about this page can be wrong in a way nobody notices:
 *
 *   - The empty state. `createFromRange` is the only way an invoice comes into
 *     existence, so a bare "no invoices yet" leaves a user on a screen with no
 *     route out of it. The link to /reports IS the feature here.
 *   - The columns. A total is the one figure on this page a freelancer acts
 *     on, and it is derived server-side from lines this component never sees —
 *     so if the row stopped rendering it, nothing else would go wrong.
 *
 * `Link` is stubbed for the same reason -reports.test.tsx stubs it: it reads
 * router context and this file deliberately renders the route's COMPONENT on
 * its own. `createFileRoute` stays real, so a broken route definition still
 * fails here rather than hiding behind a module mock.
 */
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<RouterModule>()
  return {
    ...actual,
    /*
     * Params are substituted the way the real `Link` builds an href, so a row
     * that linked to the literal "/invoices/$invoiceId" — a route with the
     * params forgotten — cannot pass the assertion below.
     */
    Link: ({
      to,
      params,
      children,
      ...rest
    }: {
      to: string
      params?: Record<string, string>
      children: React.ReactNode
      className?: string
    }) => (
      <a
        href={Object.entries(params ?? {}).reduce(
          (path, [key, value]) => path.replace(`$${key}`, value),
          to
        )}
        {...rest}
      >
        {children}
      </a>
    ),
  }
})

afterEach(cleanup)

type Row = {
  _id: Id<"invoices">
  number: string
  billedTo: string
  currency: string
  issuedAt: number
  totalCents: number
}

function makeRow(over: Partial<Row> & { number: string }): Row {
  return {
    _id: over.number as unknown as Id<"invoices">,
    billedTo: "Acme Corp\n1 Way, Springfield",
    currency: "USD",
    issuedAt: NOW,
    totalCents: 98_800,
    ...over,
  }
}

function renderInvoices(invoices: Array<Row>, truncated = false) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: ({ queryKey }) => {
          const [, name] = queryKey as [string, string]
          throw new Error(`Unseeded query in test: ${name}`)
        },
      },
    },
  })
  queryClient.setQueryData(convexKey(api.invoices.list, {}), { invoices, truncated })
  queryClient.setQueryData(convexKey(api.settings.get, {}), SETTINGS)

  return render(
    <QueryClientProvider client={queryClient}>
      <Invoices />
    </QueryClientProvider>
  )
}

/**
 * The footer, as its own scope.
 *
 * The column header and the footer label are BOTH the word "Total" — correctly,
 * they mean "this invoice's total" and "the total of all of them" — so a
 * document-wide `getByText("Total")` matches the header and proves nothing
 * about the footer. Every assertion about the summary has to be made inside it.
 */
function footerOf(container: HTMLElement) {
  const tfoot = container.querySelector("tfoot")
  if (tfoot === null) throw new Error("no <tfoot> rendered")
  return within(tfoot)
}

/**
 * The rows, as their own scope.
 *
 * Same reason as `footerOf`, and it bites hardest on a ONE-invoice fixture:
 * that invoice's total and the footer's total are then the same string, so an
 * unscoped `getByText("$988.00")` finds two nodes and throws. Asserting a row
 * renders a figure has to mean the row.
 */
function bodyOf(container: HTMLElement) {
  const tbody = container.querySelector("tbody")
  if (tbody === null) throw new Error("no <tbody> rendered")
  return within(tbody)
}

/*
 * The page's structure, which used to be written here rather than shared: a
 * bare `<h1 className="text-sm font-semibold">` inside the page's own layout,
 * one of five spellings of the same treatment. It comes from `Page` now, and
 * this is what stops the sixth spelling appearing.
 */
describe("Invoices — the page heading", () => {
  it("has exactly one h1, and it names the page", () => {
    renderInvoices([])

    const headings = screen.getAllByRole("heading", { level: 1 })
    expect(headings.length).toBe(1)
    expect(headings[0].textContent).toBe("Invoices")
  })

  /*
   * The table keeps its own accessible name. The `<h1>` is not attached to the
   * table — a heading before an element names nothing in the accessibility tree
   * — so removing the caption because "the page already says Invoices" would
   * leave a screen reader announcing "table with 4 columns".
   */
  it("does not let the page heading stand in for the table's caption", () => {
    renderInvoices([makeRow({ number: "081126-0001" })])

    expect(screen.getByText("Invoices, most recently issued first")).toBeTruthy()
  })
})

describe("Invoices — the empty state", () => {
  it("names the route an invoice comes from, and links to it", () => {
    renderInvoices([])

    const link = screen.getByRole("link", { name: "Reports" })
    expect(link.getAttribute("href")).toBe("/reports")
    // The sentence, not just the link: "Reports" on its own says where to go
    // and not what to do when you get there.
    expect(screen.getByText(/filtered range/)).toBeTruthy()
  })
})

describe("Invoices — the rows", () => {
  it("renders the number, the client and the total", () => {
    const { container } = renderInvoices([
      makeRow({ number: "072726-0013", billedTo: "Vessel Vanguard\nBonita Springs, FL" }),
    ])

    const body = bodyOf(container)
    expect(body.getByText("072726-0013")).toBeTruthy()
    // The first line of the `billedTo` SNAPSHOT — the party's name, not the
    // whole address block.
    expect(body.getByText("Vessel Vanguard")).toBeTruthy()
    expect(body.getByText("$988.00")).toBeTruthy()
  })

  /*
   * The rows were deliberately not links until /invoices/$invoiceId existed,
   * so this is the assertion that the list stopped being a dead end. The link
   * is on the NUMBER rather than the row: a `<tr>` inside an `<a>` is invalid
   * HTML, and an onClick on the row is unreachable from a keyboard.
   */
  it("links each number to that invoice's own page", () => {
    renderInvoices([makeRow({ number: "072726-0013" })])

    const link = screen.getByRole("link", { name: "072726-0013" })
    expect(link.getAttribute("href")).toBe("/invoices/072726-0013")
  })

  it("renders each invoice's own currency, not the account's", () => {
    const { container } = renderInvoices([
      makeRow({ number: "072726-0013", currency: "EUR", totalCents: 100_000 }),
    ])
    // SETTINGS.currency is USD; the invoice snapshotted EUR at creation and
    // that is what the document is denominated in.
    expect(bodyOf(container).getByText("€1,000.00")).toBeTruthy()
  })

  /*
   * NO STATUS ANYWHERE, and it is worth an assertion rather than an absence in
   * the fixture. This product does not track whether an invoice has been sent
   * or paid — an invoice is a document you edit and export — so a column, a
   * badge or a word reappearing here would be the app claiming to know
   * something it cannot observe. The three words are asserted individually
   * because a re-added column would print one of them per row, not all three.
   */
  it("says nothing about draft, issued or paid", () => {
    renderInvoices([
      makeRow({ number: "072726-0011" }),
      makeRow({ number: "072726-0012" }),
    ])

    expect(screen.queryByText("Draft")).toBeNull()
    expect(screen.queryByText("Issued")).toBeNull()
    expect(screen.queryByText("Paid")).toBeNull()
  })

  it("says an invoice with no client has none, rather than leaving the cell blank", () => {
    renderInvoices([makeRow({ number: "072726-0013", billedTo: "" })])
    expect(screen.getByText("No client")).toBeTruthy()
  })

  /*
   * The cap is only honest if it is stated. The number comes from the constant
   * that enforces it, so this test cannot pass against a hand-typed literal
   * that has drifted from `INVOICE_LIST_LIMIT`.
   */
  it("names the cap when the list stops short of the whole history", () => {
    renderInvoices([makeRow({ number: "072726-0013" })], true)
    expect(
      screen.getByText(new RegExp(`Only the ${INVOICE_LIST_LIMIT} most recently issued`))
    ).toBeTruthy()
  })

  it("says nothing about a cap when the whole history fits", () => {
    renderInvoices([makeRow({ number: "072726-0013" })])
    expect(screen.queryByText(/Only the/)).toBeNull()
  })

  /*
   * Four aligned columns under a header row is a table, and it has to BE one.
   * Rendered as a <ul> the header is announced as the first of N list items
   * and no cell is ever tied to the column it sits under. These roles come
   * from the markup — there is no ARIA on this page — so the assertion fails
   * the moment the table is rewritten as divs.
   */
  it("exposes the columns as a table, not a list", () => {
    const { container } = renderInvoices([makeRow({ number: "072726-0013" })])

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent)
    ).toEqual(["Number", "Billed to", "Date issued", "Total"])
    // Scoped to the body: the footer carries a rowheader of its own, naming the
    // total. Both are correct — this asserts the one that names an invoice.
    const body = container.querySelector("tbody")
    expect(body).toBeTruthy()
    expect(within(body as HTMLElement).getByRole("rowheader").textContent).toBe(
      "072726-0013"
    )
    // Header, one invoice, and the total. Three rowgroups, three rows.
    expect(screen.getAllByRole("row")).toHaveLength(3)
  })
})

/*
 * The footer is the one figure on this page nobody can check by eye — every
 * other cell is copied from a document, and this one is arithmetic over all of
 * them. So the two ways it can be wrong are both pinned: adding up incorrectly,
 * and adding up things that must not be added.
 */
describe("Invoices — the total footer", () => {
  it("totals the invoices listed", () => {
    const { container } = renderInvoices([
      makeRow({ number: "072726-0013", totalCents: 98_800 }),
      makeRow({ number: "072726-0012", totalCents: 1_200 }),
    ])

    const footer = footerOf(container)
    expect(footer.getByText("Total")).toBeTruthy()
    // 98_800 + 1_200. A footer that rendered one row's total, or that summed
    // the wrong field, lands on a different number.
    expect(footer.getByText("$1,000.00")).toBeTruthy()
  })

  /*
   * An invoice snapshots the currency it was raised in, so a list can hold two.
   * $2,000 + €1,500 has no honest single value — adding the integers gives
   * 3,500 of nothing, and a freelancer reading it would be reading a number
   * wrong in both currencies. Two labelled rows, and no bare "Total", which
   * would be claiming to cover both.
   */
  it("keeps two currencies apart rather than adding them", () => {
    const { container } = renderInvoices([
      makeRow({ number: "072726-0013", currency: "USD", totalCents: 200_000 }),
      makeRow({ number: "072726-0012", currency: "EUR", totalCents: 150_000 }),
    ])

    const footer = footerOf(container)
    expect(footer.getByText("Total (USD)")).toBeTruthy()
    expect(footer.getByText("Total (EUR)")).toBeTruthy()
    expect(footer.getByText("$2,000.00")).toBeTruthy()
    expect(footer.getByText("€1,500.00")).toBeTruthy()
    expect(footer.queryByText("Total", { exact: true })).toBeNull()
    // The merged number, in either denomination.
    expect(footer.queryByText("$3,500.00")).toBeNull()
    expect(footer.queryByText("€3,500.00")).toBeNull()
  })

  /*
   * Capped, the figure totals the newest page and not the account. Labelling it
   * "Total" there is the same lie the cap note below the table exists to
   * prevent, and a worse one for wearing a currency symbol.
   */
  it("says the total covers only the listed invoices when the list is capped", () => {
    const { container } = renderInvoices(
      [makeRow({ number: "072726-0013", totalCents: 98_800 })],
      true
    )

    const footer = footerOf(container)
    expect(footer.getByText("Total of those listed")).toBeTruthy()
    expect(footer.queryByText("Total", { exact: true })).toBeNull()
  })

  it("shows no footer at all when there are no invoices", () => {
    const { container } = renderInvoices([])
    expect(container.querySelector("tfoot")).toBeNull()
  })
})
