import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { Toast, ToastViewport } from "@/components/ui/toast"
import { InvoiceEditor, InvoiceUnreachable, Route } from "@/routes/_authed/invoices_.$invoiceId"
import { convexKey } from "@/test-utils/convex-query"
import { NOW, SETTINGS } from "@/test-utils/fixtures"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type * as RouterModuleType from "@tanstack/react-router"

type RouterModule = typeof RouterModuleType

/*
 * What can go wrong on this page without anything looking wrong:
 *
 *   - Autosave. There is no Save button, so a field that stopped calling the
 *     mutation on blur would still accept typing, still look edited, and lose
 *     the edit on the next paint. That is the one failure this page's whole
 *     shape depends on not happening.
 *   - The newlines. `billedTo` is a snapshot block and its line breaks are the
 *     address's shape; a control that collapsed them would print a three-line
 *     address on one line, on a document sent to a client. `notes` is the same
 *     property one document lower down: an account number, an IBAN and a SWIFT
 *     code run together is a block a client cannot read a figure off.
 *
 * There is NO freeze and no status to test. An invoice is a document you edit
 * and export — always editable — which is why every field below is asserted
 * without a state to put the document in first.
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

const { mutations } = vi.hoisted(() => ({
  mutations: {
    updateInvoice: vi.fn(async () => null),
  },
}))

vi.mock("@/hooks/use-invoice-mutations", () => ({
  useInvoiceMutations: () => mutations,
}))

/* `invoicePdfBlob` does real work — pdf-lib, an embedded TTF fetched over the
 * network — and none of it is what these tests are about. Mocked so the
 * assertions can be about the DOCUMENT this page hands over and the name it
 * saves under, which is the part the page is responsible for. */
vi.mock("@/lib/export/to-pdf", () => ({ invoicePdfBlob: vi.fn() }))

afterEach(() => {
  cleanup()
  // Module-level mocks (`invoicePdfBlob`) keep their recorded calls across
  // tests otherwise, and a test asserting on "the first call" would then be
  // reading the PREVIOUS test's document.
  vi.clearAllMocks()
  for (const fn of Object.values(mutations)) fn.mockReset()
  mutations.updateInvoice.mockResolvedValue(null)
  // The Export PDF tests below stub `URL`, which jsdom implements neither half
  // of; left stubbed it would leak into every file that runs after this one.
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

type Invoice = {
  number: string
  billedTo: string
  payTo: string
  currency: string
  issuedAt: number
  dueAt: number
  purchaseOrder?: string
  paymentTerms?: string
  notes?: string
  lines: Array<Line>
}

function renderEditor(over: Partial<Invoice> = {}, settings = SETTINGS) {
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
  queryClient.setQueryData(
    convexKey(api.invoices.get, { invoiceId: INVOICE_ID }),
    invoice
  )
  queryClient.setQueryData(convexKey(api.settings.get, {}), settings)

  render(
    <QueryClientProvider client={queryClient}>
      <Toast.Provider>
        <InvoiceEditor invoiceId={INVOICE_ID} />
        <ToastViewport />
      </Toast.Provider>
    </QueryClientProvider>
  )
}

/** Narrows a queried element to the textarea it is, or fails loudly. */
function asTextarea(el: HTMLElement): HTMLTextAreaElement {
  if (!(el instanceof HTMLTextAreaElement)) throw new Error("expected a textarea")
  return el
}

/** The same, for the date fields. */
function asInput(el: HTMLElement): HTMLInputElement {
  if (!(el instanceof HTMLInputElement)) throw new Error("expected an input")
  return el
}

describe("the invoice editor — autosave", () => {
  /*
   * THE HEADLINE. No Save button exists, so blur is the only thing that can
   * write. If this stops calling the mutation the page still looks like it
   * works, right up until the edit vanishes.
   */
  it("saves a party block on blur, with no Save button anywhere", async () => {
    renderEditor()

    expect(screen.queryByRole("button", { name: /save/i })).toBeNull()

    const field = asTextarea(screen.getByLabelText("Billed to"))
    fireEvent.change(field, { target: { value: "Acme Corp\n1 Way" } })
    fireEvent.blur(field)

    await waitFor(() => {
      expect(mutations.updateInvoice).toHaveBeenCalledWith({
        invoiceId: INVOICE_ID,
        billedTo: "Acme Corp\n1 Way",
      })
    })
  })

  /* The newlines are the address's shape. A control that sent one line, or a
   * page that rendered three lines as one, is a wrong document. */
  it("keeps the line breaks of a block it was given and a block it sends", () => {
    renderEditor()

    const field = asTextarea(screen.getByLabelText("Billed to"))
    expect(field.value).toBe("Vessel Vanguard\nBonita Springs, FL\n34134, USA")
  })

  it("writes nothing when a field is blurred untouched", () => {
    renderEditor()

    fireEvent.blur(screen.getByLabelText("Billed to"))
    expect(mutations.updateInvoice).not.toHaveBeenCalled()
  })

  /* A refusal keeps the typed text on screen with the reason beside it. The
   * alternative — silently restoring the server's value — reads as the edit
   * being ignored, and the user retypes it. */
  it("shows a refusal beside the field that was refused", async () => {
    mutations.updateInvoice.mockRejectedValue({
      data: { code: "TOO_LONG", message: "Keep the billed-to block under 601 characters." },
    })
    renderEditor()

    const field = asTextarea(screen.getByLabelText("Billed to"))
    fireEvent.change(field, { target: { value: "far too long" } })
    fireEvent.blur(field)

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("601 characters")
    })
    expect(asTextarea(screen.getByLabelText("Billed to")).value).toBe("far too long")
  })

  it("saves a purchase order typed into the meta grid", async () => {
    renderEditor()

    fireEvent.click(screen.getByRole("button", { name: "Purchase order" }))
    const input = screen.getByLabelText("Purchase order")
    fireEvent.change(input, { target: { value: "PO-4471" } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(mutations.updateInvoice).toHaveBeenCalledWith({
        invoiceId: INVOICE_ID,
        purchaseOrder: "PO-4471",
      })
    })
  })

  /* The date is read and written in the user's STORED zone (SETTINGS is UTC
   * here), never the browser's — a travelling freelancer's invoice must not
   * change its date. */
  it("saves a picked date as an instant in the stored zone", async () => {
    renderEditor()

    // Not the date it already holds — React does not fire `change` when the
    // value it is handed is the one already in the node.
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-10-01" },
    })

    await waitFor(() => {
      expect(mutations.updateInvoice).toHaveBeenCalledWith({
        invoiceId: INVOICE_ID,
        dueAt: Date.parse("2026-10-01T00:00:00.000Z"),
      })
    })
  })
})

/*
 * THE NOTES BLOCK — the message to the client at the foot of the document.
 *
 * It is `PartyBlock`, deliberately, so it inherits one editing behaviour rather
 * than inventing a second: blur saves, the newlines survive, and a refusal keeps
 * the typed text with the reason beside it. What is asserted here is that it is
 * WIRED — a block that rendered but never called the mutation would look
 * identical until a reload.
 */
describe("the invoice editor — notes", () => {
  it("saves the notes on blur", async () => {
    renderEditor()

    const field = asTextarea(screen.getByLabelText("Notes"))
    fireEvent.change(field, { target: { value: "Bank transfer to Acme" } })
    fireEvent.blur(field)

    await waitFor(() => {
      expect(mutations.updateInvoice).toHaveBeenCalledWith({
        invoiceId: INVOICE_ID,
        notes: "Bank transfer to Acme",
      })
    })
  })

  /* The bank block's line breaks are its shape — an account number, an IBAN and
   * a SWIFT code run together is a block a client cannot read a figure off. */
  it("keeps the line breaks of a stored notes block", () => {
    const block = "Bank transfer to:\nAccount 1234-5678\n\nThank you!"
    renderEditor({ notes: block })

    expect(asTextarea(screen.getByLabelText("Notes")).value).toBe(block)
  })

  /* The column is ABSENT when unset — `invoices.update` clears it rather than
   * storing "" — and a textarea's value is always a string. */
  it("renders an unset notes field as empty rather than as undefined", () => {
    renderEditor()
    expect(asTextarea(screen.getByLabelText("Notes")).value).toBe("")
  })

  it("shows a refusal beside the notes field rather than as a toast", async () => {
    mutations.updateInvoice.mockRejectedValue({
      data: { code: "TOO_LONG", message: "Keep the notes under 600 characters." },
    })
    renderEditor()

    const field = asTextarea(screen.getByLabelText("Notes"))
    fireEvent.change(field, { target: { value: "far too long" } })
    fireEvent.blur(field)

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("600 characters")
    })
    expect(asTextarea(screen.getByLabelText("Notes")).value).toBe("far too long")
  })
})

/*
 * NOTHING FREEZES. There is no draft/issued/paid, so there is no locked state,
 * no unlock button and no status control — an invoice is a document you edit
 * and export, and it stays editable for as long as it exists.
 *
 * Asserted rather than merely deleted, because the failure this guards against
 * is a workflow creeping back in one control at a time.
 */
describe("the invoice editor — no status workflow", () => {
  it("offers no status control and nothing to unlock", () => {
    renderEditor()

    expect(screen.queryByLabelText("Status")).toBeNull()
    expect(screen.queryByRole("button", { name: /unlock/i })).toBeNull()
    expect(screen.queryByText(/Draft|Issued|Paid/)).toBeNull()
  })

  it("leaves every field editable, with no state that takes them away", () => {
    renderEditor()

    expect(screen.getByLabelText("Billed to")).toBeTruthy()
    expect(screen.getByLabelText("Pay to")).toBeTruthy()
    expect(screen.getByLabelText("Notes")).toBeTruthy()
    expect(screen.getByLabelText("Due date")).toBeTruthy()
    expect(screen.getByLabelText("Currency")).toBeTruthy()
  })
})

describe("the invoice editor — the document", () => {
  it("names the invoice and links back to the list", () => {
    renderEditor()

    expect(screen.getByText("#072726-0013")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Invoices" }).getAttribute("href")).toBe(
      "/invoices"
    )
  })

  /* Read-only, and the numbers are the STORED ones: nothing here recomputes an
   * amount from a quantity and a rate. Editing them is Task 6. */
  it("prints the lines it has, and offers no way to edit them", () => {
    renderEditor({
      lines: [makeLine({ description: "Website", quantityCentis: 9880 })],
    })

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent)
    ).toEqual(["Description", "Quantity", "Rate", "Amount"])
    expect(screen.getByText("98.80")).toBeTruthy()
    expect(screen.getByText("$10.00/hr")).toBeTruthy()
    expect(screen.getByText("$988.00")).toBeTruthy()
    expect(screen.queryByLabelText("Description")).toBeNull()
  })

  it("renders the invoice's own currency, not the account's", () => {
    renderEditor({
      currency: "EUR",
      lines: [makeLine({ description: "Website", amountCents: 100_000 })],
    })
    // SETTINGS.currency is USD; this document was snapshotted in EUR.
    expect(screen.getByText("€1,000.00")).toBeTruthy()
  })

  /* An empty state teaches the interface rather than stating a void. */
  it("says where lines come from when there are none", () => {
    renderEditor({ lines: [] })
    expect(screen.getByText(/Lines come from the range/)).toBeTruthy()
  })

  /* Both optional fields, because an absence stated as an absence is the rule
   * here — the same treatment `formatRate` gives a project with no rate, and
   * never a blank box beside a label on a document. */
  it("states an absent purchase order and terms rather than leaving them blank", () => {
    renderEditor()
    expect(screen.getAllByText("Not set")).toHaveLength(2)
  })
})

/*
 * A date pick is the ONE autosave path that used to discard the user's input
 * on a refusal: the input was controlled straight off `instant`, so a rejected
 * save re-rendered the previous value and the picked date vanished at the same
 * moment the message beside it said the date on screen was the thing to fix.
 * `PartyBlock` and `InlineEdit` both keep the typed value; this now does too.
 */
describe("the invoice editor — a refused date", () => {
  it("keeps the picked date on screen beside the refusal", async () => {
    mutations.updateInvoice.mockRejectedValue({
      data: { code: "INVALID_DATE", message: "That due date is not a date I can read." },
    })
    renderEditor()

    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-10-01" },
    })

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("not a date I can read")
    })
    expect(asInput(screen.getByLabelText("Due date")).value).toBe("2026-10-01")
  })
})

/*
 * `invoices.update` deliberately does NOT refuse a due date before its issue
 * date — autosave commits one field per blur, so an ordering rule would accept
 * or refuse the same edit depending on which date was blurred first. The other
 * half of that decision is that something has to draw the relationship, or the
 * mistake is only "visible on the document" to a reader who knew to look.
 */
describe("the invoice editor — the date advisory", () => {
  it("says when the due date precedes the invoice date, and blocks nothing", () => {
    renderEditor({ issuedAt: NOW, dueAt: NOW - 24 * 3_600_000 })

    expect(screen.getByRole("status").textContent).toContain("before the invoice date")
    // Advisory, not refusal: the field is still there to fix, and there is no
    // error state on it.
    expect(screen.getByLabelText("Due date")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  /*
   * The case that makes this a DAY comparison rather than an instant one. An
   * invoice raised at midday stamps `issuedAt` at midday, while a due date
   * picked as the same day is midnight — so `dueAt < issuedAt` is true of a
   * perfectly ordinary due-on-receipt invoice, and warning about it would be
   * crying wolf on the reference document's own shape.
   */
  it("stays quiet for a due date on the same day as the invoice date", () => {
    renderEditor({ issuedAt: NOW, dueAt: NOW - 12 * 3_600_000 })
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("stays quiet for the ordinary net-30 invoice", () => {
    renderEditor()
    expect(screen.queryByRole("status")).toBeNull()
  })
})

/*
 * The route's own two decisions, tested through the route rather than the
 * editor component: which title the tab gets, and what `/invoices/anything`
 * renders. Before this, a stale bookmark or another account's id put the user
 * on TanStack's built-in error screen with a raw serialised ConvexError and no
 * link back — on what, with `Create invoice` on /reports, is now the app's
 * most-shared URL shape.
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

/*
 * EXPORT PDF — the whole reason the feature exists. "I wanted to be able to
 * export or download the invoice in PDF".
 *
 * What is asserted here is the page's own half of that: the button exists, the
 * document handed to the renderer is THIS invoice, its dates are resolved to
 * days in the user's STORED zone, and the file is saved under a name a client
 * can be told over the phone. The layout of the pages themselves is pure and is
 * asserted directly in `src/lib/export/pdf/invoice-doc.test.ts`.
 */
describe("the invoice editor — Export PDF", () => {
  /** jsdom implements neither half of the object-URL dance `downloadBlob`
   *  performs, and an anchor click would try to navigate. */
  function stubDownload() {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => {},
    })
    return vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
  }

  it("renders the document it is looking at and saves it under the invoice number", async () => {
    const click = stubDownload()
    const { invoicePdfBlob } = await import("@/lib/export/to-pdf")
    vi.mocked(invoicePdfBlob).mockResolvedValue(new Blob(["%PDF-"]))

    renderEditor({ notes: "Bank transfer to Acme\nAccount 1234-5678" })
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }))

    await waitFor(() => expect(click).toHaveBeenCalled())

    // The document, not a re-fetch: every field the paper prints comes off the
    // invoice already on screen, including the notes at its foot.
    expect(vi.mocked(invoicePdfBlob).mock.calls[0][0]).toMatchObject({
      number: "072726-0013",
      billedTo: "Vessel Vanguard\nBonita Springs, FL\n34134, USA",
      currency: "USD",
      notes: "Bank transfer to Acme\nAccount 1234-5678",
    })

    // `invoice-072726-0013-2026-08-05.pdf` — the NUMBER, because that is what
    // the document is called when a client asks about it.
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe("invoice-072726-0013-2026-08-05.pdf")

    click.mockRestore()
  })

  /*
   * The document prints DAYS, and a day only exists once a zone has been
   * chosen. It is the user's STORED zone — never the browser's, never UTC by
   * accident — the same rule every date on this page already follows. `NOW` is
   * noon UTC, which in Auckland is already the next calendar day, so a
   * regression to the wrong zone moves both dates AND the filename.
   */
  it("resolves both dates in the user's stored zone, not the browser's", async () => {
    const click = stubDownload()
    const { invoicePdfBlob } = await import("@/lib/export/to-pdf")
    vi.mocked(invoicePdfBlob).mockResolvedValue(new Blob(["%PDF-"]))

    renderEditor({}, { ...SETTINGS, timezone: "Pacific/Auckland" })
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }))

    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(vi.mocked(invoicePdfBlob).mock.calls[0][0]).toMatchObject({
      issuedOn: "2026-08-06",
      dueOn: "2026-09-05",
    })
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
      "invoice-072726-0013-2026-08-06.pdf"
    )

    click.mockRestore()
  })

  /* A failed export must never be silent: before the report's export menu grew
   * its own catch, a rejection was unhandled and the button simply went back to
   * looking ready, having done nothing. */
  it("says so when the export fails, and un-sticks the button", async () => {
    const { invoicePdfBlob } = await import("@/lib/export/to-pdf")
    vi.mocked(invoicePdfBlob).mockRejectedValueOnce(new Error("boom"))

    renderEditor()
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }))

    const alert = await screen.findByRole("alert")
    expect(within(alert).getByText("PDF export failed.")).toBeTruthy()
    // Never the thrown Error's own text — that is written for a developer.
    expect(screen.queryByText(/boom/i)).toBeNull()

    const trigger = screen.getByRole("button", { name: /export pdf/i })
    expect((trigger as HTMLButtonElement).disabled).toBe(false)
  })
})
