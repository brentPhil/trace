import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { Toast, ToastViewport } from "@/components/ui/toast"
import { InvoiceEditor, Route } from "@/routes/_authed/invoices_.$invoiceId_.edit"
import { convexKey } from "@/test-utils/convex-query"
import { NOW, SETTINGS } from "@/test-utils/fixtures"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
import type * as RouterModuleType from "@tanstack/react-router"

type RouterModule = typeof RouterModuleType

/*
 * THE BUFFERED EDITOR — the one surface in this product that does not save on
 * blur.
 *
 * What can go wrong here without anything looking wrong:
 *
 *   - A field that writes as soon as it is blurred. The page looks identical;
 *     the user simply no longer decides when their document changes, which is
 *     the entire thing they asked for. Every autosave test this file used to
 *     hold is now inverted into an assertion that nothing is written until Save.
 *   - A Save button enabled on a clean form. It teaches people to press it out
 *     of superstition, and a button pressed out of superstition is one nobody
 *     reads the state of — which is the signal the unsaved-changes guard is
 *     built on.
 *   - A refusal that loses the text it refused. The whole point of buffering is
 *     that the typed values are the only copy; a save that clears them on the
 *     way to reporting a problem destroys the thing it is complaining about.
 *   - An Export that runs before the save it depends on, or after one that
 *     failed. Either way a client ends up holding a PDF the freelancer's own
 *     record contradicts.
 *   - The newlines. `billedTo` is a snapshot block and its line breaks are the
 *     address's shape; `notes` is the same property one document lower down.
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
    /* The guard needs a router; these tests deliberately have none. Idle is the
     * honest stand-in for "no navigation has been attempted" — the guard's own
     * behaviour, including what it renders once it HAS blocked, is asserted in
     * `src/components/invoices/unsaved-changes-guard.test.tsx`. */
    useBlocker: () => ({ status: "idle" as const }),
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

function saveButton(): HTMLButtonElement {
  const el = screen.getByRole("button", { name: /^save/i })
  if (!(el instanceof HTMLButtonElement)) throw new Error("expected a button")
  return el
}

describe("the invoice editor — nothing is written until Save", () => {
  /*
   * THE HEADLINE, and the inverse of the one this file used to open with. A
   * field that commits on blur looks identical on screen; what it takes away is
   * the user's decision about when their document changes.
   */
  it("writes nothing when a field is typed into and blurred", () => {
    renderEditor()

    const field = asTextarea(screen.getByLabelText("Billed to"))
    fireEvent.change(field, { target: { value: "Acme Corp\n1 Way" } })
    fireEvent.blur(field)

    expect(mutations.updateInvoice).not.toHaveBeenCalled()
    // Still on screen — the draft is the only copy of it now.
    expect(asTextarea(screen.getByLabelText("Billed to")).value).toBe("Acme Corp\n1 Way")
  })

  it("writes the whole head, once, when Save is pressed", async () => {
    renderEditor()

    fireEvent.change(screen.getByLabelText("Billed to"), {
      target: { value: "Acme Corp\n1 Way" },
    })
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Bank transfer to Acme" },
    })
    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(mutations.updateInvoice).toHaveBeenCalledWith({
        invoiceId: INVOICE_ID,
        billedTo: "Acme Corp\n1 Way",
        notes: "Bank transfer to Acme",
      })
    })
    expect(mutations.updateInvoice).toHaveBeenCalledTimes(1)
  })

  /* ONLY the changed fields. An invoice raised before a bound tightened would
   * otherwise have every Save refused over an address nobody was editing. */
  it("sends only what changed", async () => {
    renderEditor()

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Thanks!" } })
    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(mutations.updateInvoice).toHaveBeenCalledWith({
        invoiceId: INVOICE_ID,
        notes: "Thanks!",
      })
    })
  })

  it("saves a purchase order typed into the meta grid", async () => {
    renderEditor()

    fireEvent.click(screen.getByRole("button", { name: "Purchase order" }))
    const input = screen.getByLabelText("Purchase order")
    fireEvent.change(input, { target: { value: "PO-4471" } })
    fireEvent.blur(input)

    // The inline field committed to the DRAFT, not to the server.
    expect(mutations.updateInvoice).not.toHaveBeenCalled()

    fireEvent.click(saveButton())
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
    expect(mutations.updateInvoice).not.toHaveBeenCalled()

    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(mutations.updateInvoice).toHaveBeenCalledWith({
        invoiceId: INVOICE_ID,
        dueAt: Date.parse("2026-10-01T00:00:00.000Z"),
      })
    })
  })

  /* The newlines are the address's shape. A control that sent one line, or a
   * page that rendered three lines as one, is a wrong document. */
  it("keeps the line breaks of a block it was given", () => {
    renderEditor()
    expect(asTextarea(screen.getByLabelText("Billed to")).value).toBe(
      "Vessel Vanguard\nBonita Springs, FL\n34134, USA"
    )
  })

  /* The column is ABSENT when unset — `invoices.update` clears it rather than
   * storing "" — and a textarea's value is always a string. */
  it("renders an unset notes field as empty rather than as undefined", () => {
    renderEditor()
    expect(asTextarea(screen.getByLabelText("Notes")).value).toBe("")
  })
})

describe("the invoice editor — the Save button", () => {
  it("is disabled on a form nobody has touched", () => {
    renderEditor()
    expect(saveButton().disabled).toBe(true)
  })

  it("wakes up on the first real change", () => {
    renderEditor()
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Thanks!" } })
    expect(saveButton().disabled).toBe(false)
  })

  /*
   * DIRTINESS IS A COMPARISON, not a touched flag. Typing over a value and
   * typing it back has changed nothing — and a form that called that dirty would
   * light this button and then warn, on the way out, about losing an edit that
   * does not exist. That warning is the one people learn to click through.
   */
  it("goes back to sleep when a value is typed back to its original", () => {
    renderEditor()

    const field = asTextarea(screen.getByLabelText("Billed to"))
    fireEvent.change(field, { target: { value: "Acme" } })
    expect(saveButton().disabled).toBe(false)

    fireEvent.change(field, {
      target: { value: "Vessel Vanguard\nBonita Springs, FL\n34134, USA" },
    })
    expect(saveButton().disabled).toBe(true)
  })

  it("goes quiet again once the save lands", async () => {
    renderEditor()

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Thanks!" } })
    fireEvent.click(saveButton())

    // The Convex subscription has not redelivered the row — the seeded query
    // still holds the old document — and the form must still know it is saved.
    await waitFor(() => expect(saveButton().disabled).toBe(true))
  })
})

/*
 * A REFUSED SAVE KEEPS EVERY TYPED VALUE, and says which field it was about.
 *
 * One Save carries eight fields, so "that didn't save" as a toast would leave
 * somebody rereading the whole document for the sentence that is too long.
 * `invoices.update` names the field in `meta.field` for exactly this.
 */
describe("the invoice editor — a refused save", () => {
  function refuse(code: string, message: string, field: string) {
    mutations.updateInvoice.mockRejectedValue({ data: { code, message, meta: { field } } })
  }

  it("shows the refusal beside the field it names, with the text still in it", async () => {
    refuse("TOO_LONG", "Keep the billed-to block under 601 characters.", "billedTo")
    renderEditor()

    fireEvent.change(screen.getByLabelText("Billed to"), {
      target: { value: "far too long" },
    })
    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("601 characters")
    })
    expect(asTextarea(screen.getByLabelText("Billed to")).value).toBe("far too long")
    // The billed-to textarea itself, not some banner elsewhere on the page.
    expect(screen.getByLabelText("Billed to").getAttribute("aria-invalid")).toBe("true")
    // And still dirty, so pressing Save again after the fix sends the same set.
    expect(saveButton().disabled).toBe(false)
  })

  it("keeps the notes text and points at the notes field", async () => {
    refuse("TOO_LONG", "Keep the notes under 600 characters.", "notes")
    renderEditor()

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "far too long" } })
    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("600 characters")
    })
    expect(asTextarea(screen.getByLabelText("Notes")).value).toBe("far too long")
    expect(screen.getByLabelText("Notes").getAttribute("aria-invalid")).toBe("true")
  })

  /*
   * A date pick used to be the ONE path that discarded the user's input on a
   * refusal: the input was controlled straight off the stored instant, so a
   * rejected save re-rendered the previous value and the picked date vanished at
   * the same moment the message beside it said the date on screen was the thing
   * to fix. Buffering removed the machinery that fixed it rather than
   * reintroducing the bug — the draft IS the picked date.
   */
  it("keeps a refused date on screen beside its refusal", async () => {
    refuse("INVALID_DATE", "That due date is not a date I can read.", "dueAt")
    renderEditor()

    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-10-01" } })
    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("not a date I can read")
    })
    expect(asInput(screen.getByLabelText("Due date")).value).toBe("2026-10-01")
  })

  /* Editing the field is the answer to its refusal — the same rule `InlineEdit`
   * and `PartyBlock` follow, so a message never points at text already fixed. */
  it("clears the refusal as soon as the field is edited again", async () => {
    refuse("TOO_LONG", "Keep the notes under 600 characters.", "notes")
    renderEditor()

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "far too long" } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "short" } })
    expect(screen.queryByRole("alert")).toBeNull()
  })

  /* A refusal naming no field — a network failure, or a code this build does
   * not know — has nowhere to sit but above the document. It must still be
   * announced rather than swallowed. */
  it("reports a refusal that names no field, without losing the draft", async () => {
    mutations.updateInvoice.mockRejectedValue(new Error("offline"))
    renderEditor()

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Thanks!" } })
    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("didn't save")
    })
    expect(asTextarea(screen.getByLabelText("Notes")).value).toBe("Thanks!")
  })
})

describe("the invoice editor — the document", () => {
  it("links back to the list and to the record it is editing", () => {
    renderEditor()

    expect(screen.getByRole("link", { name: "Invoices" }).getAttribute("href")).toBe(
      "/invoices"
    )
    expect(screen.getByRole("link", { name: "#072726-0013" }).getAttribute("href")).toBe(
      "/invoices/inv-1"
    )
  })

  /* Read-only, and the numbers are the STORED ones: nothing here recomputes an
   * amount from a quantity and a rate. Editing them is Task 6. */
  it("prints the lines it has, and offers no way to edit them", () => {
    renderEditor({ lines: [makeLine({ description: "Website", quantityCentis: 9880 })] })

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent)
    ).toEqual(["Description", "Quantity", "Rate", "Amount"])
    expect(screen.getByText("98.80")).toBeTruthy()
    expect(screen.getByText("$10.00/hr")).toBeTruthy()
    // Once as the line's amount, once as the subtotal, once as the total.
    expect(screen.getAllByText("$988.00")).toHaveLength(3)
    expect(screen.queryByLabelText("Description")).toBeNull()
  })

  it("renders the invoice's own currency, not the account's", () => {
    renderEditor({
      currency: "EUR",
      lines: [makeLine({ description: "Website", amountCents: 100_000 })],
    })
    // SETTINGS.currency is USD; this document was snapshotted in EUR.
    expect(screen.getAllByText("€1,000.00").length).toBeGreaterThan(0)
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

/*
 * `invoices.update` deliberately does NOT refuse a due date before its issue
 * date — it is a patch and may be handed either date alone. The other half of
 * that decision is that something has to draw the relationship, or the mistake
 * is only "visible on the document" to a reader who knew to look. Here it is
 * drawn from the DRAFT, so it answers before a Save rather than after one.
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

  /* It answers the TYPED date, not the stored one — which is the whole benefit
   * of buffering here: the warning arrives while the picker is still under the
   * user's hand, not after a write. */
  it("appears as soon as a bad date is picked, before any save", () => {
    renderEditor()
    expect(screen.queryByRole("status")).toBeNull()

    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-08-01" } })
    expect(screen.getByRole("status").textContent).toContain("before the invoice date")
    expect(mutations.updateInvoice).not.toHaveBeenCalled()
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

describe("the invoice edit route", () => {
  it("names the invoice in the tab title, and says it is the editor", () => {
    const head = Route.options.head as (ctx: {
      loaderData?: { number: string }
    }) => { meta: Array<{ title: string }> }

    expect(head({ loaderData: { number: "072726-0013" } }).meta[0]?.title).toBe(
      "Edit invoice #072726-0013 — Trace"
    )
    // Still in flight, so there is no number to name yet.
    expect(head({}).meta[0]?.title).toBe("Edit invoice — Trace")
  })
})

/*
 * EXPORT PDF — the whole reason the feature exists. "I wanted to be able to
 * export or download the invoice in PDF".
 *
 * With a buffered editor it grew a second job: COMMIT FIRST. A PDF built from
 * what is on screen while the database still holds this morning's values is a
 * document the freelancer's own record contradicts, and neither party would
 * know until a payment dispute.
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

  /* THE ONE THAT MATTERS. The PDF and the stored record are the same document,
   * and a buffered editor is exactly the machine for making them differ. */
  it("saves the pending edits before it renders, and prints what it just saved", async () => {
    const click = stubDownload()
    const { invoicePdfBlob } = await import("@/lib/export/to-pdf")
    vi.mocked(invoicePdfBlob).mockResolvedValue(new Blob(["%PDF-"]))

    renderEditor()
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Thanks!" } })
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }))

    await waitFor(() => expect(click).toHaveBeenCalled())

    expect(mutations.updateInvoice).toHaveBeenCalledWith({
      invoiceId: INVOICE_ID,
      notes: "Thanks!",
    })
    // The edit is in the paper too — not the pre-edit value the query still
    // holds until Convex redelivers the row.
    expect(vi.mocked(invoicePdfBlob).mock.calls[0][0]).toMatchObject({ notes: "Thanks!" })
  })

  /* A PDF that does not match the record is the one outcome worse than no PDF. */
  it("does not export when the save is refused, and says why beside the field", async () => {
    const click = stubDownload()
    const { invoicePdfBlob } = await import("@/lib/export/to-pdf")
    mutations.updateInvoice.mockRejectedValue({
      data: {
        code: "TOO_LONG",
        message: "Keep the notes under 600 characters.",
        meta: { field: "notes" },
      },
    })

    renderEditor()
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "far too long" } })
    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }))

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("600 characters")
    })
    expect(vi.mocked(invoicePdfBlob)).not.toHaveBeenCalled()
    expect(click).not.toHaveBeenCalled()
    // And no second, vaguer complaint on top of the one that names the field.
    expect(screen.queryByText("PDF export failed.")).toBeNull()

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
  it("says so when the export itself fails, and un-sticks the button", async () => {
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
