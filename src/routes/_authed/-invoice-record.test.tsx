import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Toast, ToastViewport } from "@/components/ui/toast"
import {
  InvoicePage,
  InvoiceUnreachable,
  Route,
} from "@/routes/_authed/invoices_.$invoiceId"
import { convexKey } from "@/test-utils/convex-query"
import { NOW, SETTINGS } from "@/test-utils/fixtures"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type * as RouterModuleType from "@tanstack/react-router"

type RouterModule = typeof RouterModuleType

/*
 * `/invoices/$invoiceId` — THE RECORD, not the editor.
 *
 * The question asked at this URL is "what did I actually send them?", and a form
 * with the values already in its boxes cannot answer it: an input looks the same
 * whether its contents were sent last month or typed thirty seconds ago and
 * abandoned. So the assertion this file exists for is a negative one — there are
 * no inputs here — and it is a negative that will be under constant pressure,
 * because every future field is one `<textarea>` away from turning this page
 * back into the editor it used to be.
 *
 * The second thing asserted is that it does not DRIFT from the PDF. They are two
 * renderings of one document; a subtotal computed twice, or an optional row one
 * of them omits, is only ever visible with a client holding the paper.
 */

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<RouterModule>()
  return {
    ...actual,
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
    }) => {
      let href = to
      for (const [key, value] of Object.entries(params ?? {})) {
        href = href.replace(`$${key}`, value)
      }
      return (
        <a href={href} {...rest}>
          {children}
        </a>
      )
    },
  }
})

vi.mock("@/lib/export/to-pdf", () => ({ invoicePdfBlob: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

const INVOICE_ID = "inv-1" as unknown as Id<"invoices">

type Line = {
  _id: Id<"invoiceLines">
  kind: "time" | "custom"
  description: string
  quantityCentis: number
  unitCents: number
  amountCents: number
}

function makeLine(over: Partial<Line> & { description: string }): Line {
  return {
    _id: over.description as unknown as Id<"invoiceLines">,
    kind: "time",
    quantityCentis: 9880,
    unitCents: 1000,
    amountCents: 98_800,
    ...over,
  }
}

function renderRecord(over: Record<string, unknown> = {}, settings = SETTINGS) {
  const invoice = {
    _id: INVOICE_ID,
    _creationTime: NOW,
    userId: "user-1",
    clientKey: "k1",
    number: "072726-0013",
    clientId: null,
    billedTo: "Vessel Vanguard\nBonita Springs, FL\n34134, USA",
    payTo: "",
    currency: "USD",
    issuedAt: NOW,
    dueAt: NOW + 30 * 24 * 3_600_000,
    taxes: [],
    sourceFromMs: null,
    sourceToMs: null,
    unratedMsAtCreation: 0,
    updatedAt: NOW,
    deletedAt: null,
    lines: [makeLine({ description: "Website" })],
    ...over,
  }

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
  queryClient.setQueryData(convexKey(api.invoices.get, { invoiceId: INVOICE_ID }), invoice)
  queryClient.setQueryData(convexKey(api.settings.get, {}), settings)

  render(
    <QueryClientProvider client={queryClient}>
      <Toast.Provider>
        <InvoicePage invoiceId={INVOICE_ID} />
        <ToastViewport />
      </Toast.Provider>
    </QueryClientProvider>
  )
}

describe("the invoice record — it is read-only", () => {
  /*
   * THE HEADLINE, and it is a negative. This page's whole claim is that what is
   * on it was sent; one editable control anywhere on it retracts that claim for
   * the entire page, because a reader cannot tell which parts are which.
   */
  it("renders no input, textarea or select anywhere", () => {
    renderRecord({
      purchaseOrder: "PO-4471",
      paymentTerms: "Net 30",
      notes: "Bank transfer to Acme",
    })

    for (const tag of ["input", "textarea", "select"]) {
      expect(document.querySelectorAll(tag)).toHaveLength(0)
    }
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.queryByRole("combobox")).toBeNull()
  })

  /* And nothing that WRITES, either. The only buttons this page may carry are
   * the export and — as a link — the way to the editor. */
  it("offers Edit and Export, and no Save", () => {
    renderRecord()

    expect(screen.queryByRole("button", { name: /save/i })).toBeNull()
    expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe(
      "/invoices/inv-1/edit"
    )
    expect(screen.getByRole("button", { name: /export pdf/i })).toBeTruthy()
  })

  it("links back to the list", () => {
    renderRecord()
    expect(screen.getByRole("link", { name: "Invoices" }).getAttribute("href")).toBe(
      "/invoices"
    )
  })
})

describe("the invoice record — the document", () => {
  /* The newlines are the address's shape. Rendered into HTML without
   * `whitespace-pre-line`, a three-line address collapses onto one line — on
   * the one screen whose claim is that this is what the client got. */
  it("prints a party block with its line breaks intact", () => {
    renderRecord()
    const block = screen.getByText(/Vessel Vanguard/)
    expect(block.textContent).toBe("Vessel Vanguard\nBonita Springs, FL\n34134, USA")
  })

  /*
   * The dates read as the PAPER reads them, via `invoiceMetaRows`. A screen
   * saying "5 Aug 2026" beside a PDF printing "08/05/2026" breaks this page's
   * claim on the two values a payment dispute turns on.
   */
  it("states the dates in the same format the paper prints", () => {
    renderRecord()
    expect(screen.getByText("08/05/2026")).toBeTruthy()
    expect(screen.getByText("09/04/2026")).toBeTruthy()
  })

  /* The user's STORED zone, never the browser's. `NOW` is noon UTC, which in
   * Auckland is already the next calendar day. */
  it("reads the dates in the stored zone", () => {
    renderRecord({}, { ...SETTINGS, timezone: "Pacific/Auckland" })
    expect(screen.getByText("08/06/2026")).toBeTruthy()
  })

  /*
   * An unset optional field is an ABSENT ROW, exactly as on paper — never a
   * printed "Not set". The editor says "Not set" because there it is an
   * invitation to click; here there is nothing to click, and the product would
   * be talking about its own form fields on someone else's invoice.
   */
  it("omits an unset optional row rather than stating it", () => {
    renderRecord()
    expect(screen.queryByText("Purchase order")).toBeNull()
    expect(screen.queryByText("Payment terms")).toBeNull()
    expect(screen.queryByText("Not set")).toBeNull()
  })

  it("shows an optional row that is set", () => {
    renderRecord({ purchaseOrder: "PO-4471" })
    expect(screen.getByText("Purchase order")).toBeTruthy()
    expect(screen.getByText("PO-4471")).toBeTruthy()
  })

  /* Empty notes print nothing at all rather than an empty heading: nobody was
   * ever promised a note, so there is no absence to state. */
  it("prints the notes at the foot when there are some, and nothing when there are not", () => {
    renderRecord()
    expect(screen.queryByText("Notes")).toBeNull()

    cleanup()
    renderRecord({ notes: "Bank transfer to Acme\nAccount 1234-5678" })
    expect(screen.getByText("Notes")).toBeTruthy()
    expect(screen.getByText(/Bank transfer to Acme/).textContent).toBe(
      "Bank transfer to Acme\nAccount 1234-5678"
    )
  })

  /* `payTo` is empty on every invoice `createFromRange` raises — nothing in a
   * range of time entries says who the freelancer is — and the paper prints the
   * label over the gap for the same reason a client looking for where to send
   * the money should find the question rather than silence. */
  it("keeps the Pay to heading even when it is empty", () => {
    renderRecord()
    expect(screen.getByText("Pay to")).toBeTruthy()
  })
})

/*
 * THE TOTALS, which is where drift would actually cost money.
 *
 * They come from `invoiceTotalsRows` — one `invoiceTotals` call over the STORED
 * line amounts, the very same derivation `invoice-doc.ts` prints from. What is
 * asserted here is that the page really does render that derivation, including
 * the tax arithmetic, rather than a second sum written beside it.
 */
describe("the invoice record — the totals", () => {
  it("totals the lines with no taxes", () => {
    renderRecord({
      lines: [
        makeLine({ description: "Website", amountCents: 98_800 }),
        makeLine({ description: "Hosting", amountCents: 1_200 }),
      ],
    })

    expect(screen.getByText("Subtotal")).toBeTruthy()
    expect(screen.getAllByText("$1,000.00")).toHaveLength(2) // subtotal and total
    expect(screen.getByText("Total")).toBeTruthy()
  })

  /* Each tax is applied to the SUBTOTAL and rounded once — never compounded
   * onto a running total — and the rate is appended to the label so a client
   * checking the arithmetic by hand has the multiplier on the document. */
  it("draws each tax as its own row, labelled with its rate", () => {
    renderRecord({
      lines: [makeLine({ description: "Website", amountCents: 100_000 })],
      taxes: [{ label: "VAT", basisPoints: 2000 }],
    })

    expect(screen.getByText("VAT 20%")).toBeTruthy()
    expect(screen.getByText("$200.00")).toBeTruthy()
    expect(screen.getByText("$1,200.00")).toBeTruthy()
  })

  it("prints the invoice's own currency, not the account's", () => {
    renderRecord({
      currency: "EUR",
      lines: [makeLine({ description: "Website", amountCents: 100_000 })],
    })
    // SETTINGS.currency is USD; this document was snapshotted in EUR.
    expect(screen.getAllByText("€1,000.00").length).toBeGreaterThan(0)
  })

  /*
   * A ZERO-LINE INVOICE IS REACHABLE — `createFromRange` over a range where
   * every project was unrated bills nothing — and the PDF prints the absence AND
   * the totals block (asserted in `invoice-doc.test.ts`). The screen must do the
   * same. It did not: the empty state returned before the totals were derived,
   * so the client's paper said `Total $0.00` while the freelancer's own record
   * of the same document said nothing about money at all. That is the drift
   * `invoice-document.ts` exists to prevent, on the one page whose entire claim
   * is that it shows what the client received.
   */
  it("says where lines come from when there are none, and still totals them", () => {
    renderRecord({ lines: [] })

    expect(screen.getByText(/Lines come from the range/)).toBeTruthy()
    expect(screen.getByText("Subtotal")).toBeTruthy()
    expect(screen.getByText("Total")).toBeTruthy()
    // Subtotal and Total, the same two rows the paper prints.
    expect(screen.getAllByText("$0.00")).toHaveLength(2)
  })

  /* Taxes on nothing are still stated: a document that lists a VAT line on its
   * paper and omits it on screen is two documents. */
  it("draws the tax rows of an empty invoice too", () => {
    renderRecord({ lines: [], taxes: [{ label: "VAT", basisPoints: 2000 }] })

    expect(screen.getByText("VAT 20%")).toBeTruthy()
    expect(screen.getAllByText("$0.00")).toHaveLength(3)
  })
})

describe("the invoice record — Export PDF", () => {
  it("hands the stored document straight to the renderer, with no save first", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => {},
    })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})
    const { invoicePdfBlob } = await import("@/lib/export/to-pdf")
    vi.mocked(invoicePdfBlob).mockResolvedValue(new Blob(["%PDF-"]))

    renderRecord({ notes: "Bank transfer to Acme" })
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }))

    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(vi.mocked(invoicePdfBlob).mock.calls[0][0]).toMatchObject({
      number: "072726-0013",
      issuedOn: "2026-08-05",
      notes: "Bank transfer to Acme",
    })
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
      "invoice-072726-0013-2026-08-05.pdf"
    )

    click.mockRestore()
  })
})

/*
 * The route's own two decisions, tested through the route rather than the
 * page: which title the tab gets, and what `/invoices/anything` renders. Before
 * this, a stale bookmark or another account's id put the user on TanStack's
 * built-in error screen with a raw serialised ConvexError and no link back — on
 * what, with `Create invoice` on /reports, is the app's most-shared URL shape.
 */
describe("the invoice route", () => {
  it("names the invoice in the tab title, so two open invoices differ", () => {
    const head = Route.options.head as (ctx: {
      loaderData?: { number: string }
    }) => { meta: Array<{ title: string }> }

    expect(head({ loaderData: { number: "072726-0013" } }).meta[0]?.title).toBe(
      "Invoice #072726-0013 — Trace"
    )
    // Still in flight, so there is no number to name yet.
    expect(head({}).meta[0]?.title).toBe("Invoice — Trace")
  })

  it("answers a missing invoice with a way back rather than a raw error", () => {
    // The route's OWN boundary, so it catches both failures this URL has: a
    // `NOT_FOUND` from `getOwned`, and `/invoices/whatever` failing the
    // `v.id()` argument validator — which carries no Trace code at all, and
    // which a layout boundary narrowing on a code would rethrow.
    expect(Route.options.errorComponent).toBe(InvoiceUnreachable)

    for (const error of [
      { data: { code: "NOT_FOUND", message: "Not found." } } as unknown as Error,
      new Error("ArgumentValidationError: Value does not match validator"),
    ]) {
      render(<InvoiceUnreachable error={error} />)
      expect(screen.getByText(/no invoice at this address/)).toBeTruthy()
      expect(
        screen.getByRole("link", { name: "Back to invoices" }).getAttribute("href")
      ).toBe("/invoices")
      cleanup()
    }
  })

  /* An expired session is the LAYOUT boundary's job — it answers with a sign-in
   * link, which "no such invoice" would replace with a dead end. Rethrowing is
   * how it gets there, the same device `AuthedErrorBoundary` itself uses. */
  it("hands an expired session up to the layout boundary instead", () => {
    const expired = {
      data: { code: "UNAUTHENTICATED", message: "Not signed in." },
    } as unknown as Error

    expect(() => render(<InvoiceUnreachable error={expired} />)).toThrow()
  })
})
