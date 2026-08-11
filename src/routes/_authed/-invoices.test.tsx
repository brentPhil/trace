import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
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
    Link: ({
      to,
      children,
      ...rest
    }: {
      to: string
      children: React.ReactNode
      className?: string
    }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  }
})

afterEach(cleanup)

type Row = {
  _id: Id<"invoices">
  number: string
  status: "draft" | "issued" | "paid"
  billedTo: string
  currency: string
  issuedAt: number
  totalCents: number
}

function makeRow(over: Partial<Row> & { number: string }): Row {
  return {
    _id: over.number as unknown as Id<"invoices">,
    status: "draft",
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

  render(
    <QueryClientProvider client={queryClient}>
      <Invoices />
    </QueryClientProvider>
  )
}

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
    renderInvoices([
      makeRow({ number: "072726-0013", billedTo: "Vessel Vanguard\nBonita Springs, FL" }),
    ])

    expect(screen.getByText("072726-0013")).toBeTruthy()
    // The first line of the `billedTo` SNAPSHOT — the party's name, not the
    // whole address block.
    expect(screen.getByText("Vessel Vanguard")).toBeTruthy()
    expect(screen.getByText("$988.00")).toBeTruthy()
  })

  it("renders each invoice's own currency, not the account's", () => {
    renderInvoices([
      makeRow({ number: "072726-0013", currency: "EUR", totalCents: 100_000 }),
    ])
    // SETTINGS.currency is USD; the invoice snapshotted EUR at creation and
    // that is what the document is denominated in.
    expect(screen.getByText("€1,000.00")).toBeTruthy()
  })

  /*
   * The status is a WORD, never a colour alone (DESIGN.md). This asserts the
   * word is on screen at all — a treatment that lost it would still look like
   * a designed row.
   */
  it("states the status in words", () => {
    renderInvoices([
      makeRow({ number: "072726-0011", status: "draft" }),
      makeRow({ number: "072726-0012", status: "issued" }),
      makeRow({ number: "072726-0013", status: "paid" }),
    ])

    expect(screen.getByText("Draft")).toBeTruthy()
    expect(screen.getByText("Issued")).toBeTruthy()
    expect(screen.getByText("Paid")).toBeTruthy()
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
   * Five aligned columns under a header row is a table, and it has to BE one.
   * Rendered as a <ul> the header is announced as the first of N list items
   * and no cell is ever tied to the column it sits under. These roles come
   * from the markup — there is no ARIA on this page — so the assertion fails
   * the moment the table is rewritten as divs.
   */
  it("exposes the columns as a table, not a list", () => {
    renderInvoices([makeRow({ number: "072726-0013" })])

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent)
    ).toEqual(["Number", "Billed to", "Date issued", "Total", "Status"])
    // The number names its row, so a total read aloud says which invoice it
    // belongs to.
    expect(screen.getByRole("rowheader").textContent).toBe("072726-0013")
    // Header row + one invoice.
    expect(screen.getAllByRole("row")).toHaveLength(2)
  })
})
