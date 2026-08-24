import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { NewInvoicePage, Route } from "@/routes/_authed/invoices_.new"
import { BillPreview } from "@/components/invoices/bill-preview"
import { convexKey } from "@/test-utils/convex-query"
import { NOW, SETTINGS } from "@/test-utils/fixtures"
import { expectPageHeading } from "@/test-utils/page-heading"
import { defaultFilters, rangeOf } from "@/lib/history-filters"
import { SET_A_RATE_NOTE, UNPRICED_NOTE } from "@/lib/export/report-rows"
import { EMPTY_BREAKDOWN } from "@/lib/report-series"
import { dayOf } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import type { InvoiceSearch } from "@/lib/invoice-search"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type * as RouterModuleType from "@tanstack/react-router"

type RouterModule = typeof RouterModuleType

/*
 * `/invoices/new` — the page that ASKS.
 *
 * `createFromRange` takes every field a document needs and nothing asked for
 * any of them, so every invoice this product raised had a blank Billed to and a
 * blank Pay to — permanently, because an invoice is write-once. This page is
 * where those are typed, and the two things on it that can be wrong without
 * looking wrong are:
 *
 *   - THE PREVIEW DISAGREEING WITH THE MUTATION. The lines drawn here are
 *     `invoiceLineDrafts(billableBucketsOf(...))` over the same breakdown the
 *     mutation prices, and the figures below are written out BY HAND — the same
 *     literals convex/invoices.test.ts pins from the stored rows and
 *     convex/lib/invoiceLines.test.ts pins from the derivation itself. A test
 *     that recomputed them would pass against a preview that rounded where the
 *     mutation floors, which is the exact failure this page cannot have: a
 *     promise broken in a client's inbox with no editor to correct it.
 *   - WHAT THE BUTTON SENDS. It mints a numbered document that cannot be
 *     edited, so a field dropped on the way out is permanent.
 */

const { createInvoice, onCreated } = vi.hoisted(() => ({
  createInvoice: vi.fn(async () => ({
    invoiceId: "inv-1",
    unratedMs: 0,
    replayed: false,
  })),
  onCreated: vi.fn(),
}))

vi.mock("@/hooks/use-invoice-mutations", () => ({
  useCreateInvoice: () => ({ createInvoice }),
}))

/* `Link` reads router context and this file renders the page's COMPONENT on its
 * own. `createFileRoute` stays real, so a broken route definition — including
 * the `validateSearch` this route is the first in the app to carry — still fails
 * here rather than hiding behind a module mock. */
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

beforeEach(() => {
  createInvoice.mockReset()
  createInvoice.mockResolvedValue({
    invoiceId: "inv-1",
    unratedMs: 0,
    replayed: false,
  })
  onCreated.mockReset()
})

afterEach(cleanup)

const HOUR = 3_600_000
const TODAY = dayOf(NOW, SETTINGS.timezone)
const WEEK = rangeOf(
  defaultFilters(TODAY, SETTINGS.weekStartDay),
  SETTINGS.timezone
)

const WEBSITE = "p-web" as unknown as Id<"projects">
const DISCOVERY = "p-disc" as unknown as Id<"projects">
const FREE = "p-free" as unknown as Id<"projects">
const ACME = "c-acme" as unknown as Id<"clients">

function projectRow(
  over: Partial<Doc<"projects">> & { _id: Id<"projects">; name: string }
): Doc<"projects"> {
  return {
    _creationTime: NOW,
    userId: "user-1",
    color: "slate",
    billableByDefault: true,
    archived: false,
    clientId: undefined,
    updatedAt: NOW,
    deletedAt: null,
    ...over,
  }
}

function clientRow(
  over: Partial<Doc<"clients">> & { _id: Id<"clients">; name: string }
): Doc<"clients"> {
  return {
    _creationTime: NOW,
    userId: "user-1",
    address: "",
    archived: false,
    updatedAt: NOW,
    deletedAt: null,
    ...over,
  }
}

type BreakdownProjectRow = (typeof EMPTY_BREAKDOWN)["projects"][number]

function projectTotal(
  over: Partial<BreakdownProjectRow> & {
    projectId: Id<"projects"> | null
    name: string
  }
): BreakdownProjectRow {
  return {
    color: "slate",
    totalMs: HOUR,
    billableMs: HOUR,
    billableCents: 0,
    unratedBillableMs: 0,
    count: 1,
    ...over,
  }
}

/*
 * THE REFERENCE RANGE, and the fixture the whole file is pinned to.
 *
 * Deliberately the same one convex/invoices.test.ts mints from, so the numbers
 * on this screen and the numbers in that table are the same literals:
 *
 *   Website   5h 0m 20s at $61.00/hr -> 500.55… centihours, FLOORED to 500,
 *             so 5.00 x $61.00 = $305.00. A preview that ROUNDED would print
 *             5.01 and $305.61.
 *   Discovery 2h with no rate anywhere -> NO LINE. Skipped rather than guessed
 *             at or billed at zero, and reported as unpriced time instead.
 *   Pro bono  1h at $0.00/hr -> a real line at $0.00, because a chosen zero is
 *             a price and an absent rate is not.
 */
const PROJECTS = [
  projectTotal({
    projectId: WEBSITE,
    name: "Website",
    hourlyRateCents: 6100,
    totalMs: 5 * HOUR + 20_000,
    billableMs: 5 * HOUR + 20_000,
    count: 2,
  }),
  projectTotal({
    projectId: DISCOVERY,
    name: "Discovery",
    totalMs: 2 * HOUR,
    billableMs: 2 * HOUR,
    unratedBillableMs: 2 * HOUR,
  }),
  projectTotal({ projectId: FREE, name: "Pro bono", hourlyRateCents: 0 }),
]

const BREAKDOWN = {
  ...EMPTY_BREAKDOWN,
  totalMs: 8 * HOUR + 20_000,
  billableMs: 8 * HOUR + 20_000,
  count: 4,
  unratedBillableMs: 2 * HOUR,
  projects: PROJECTS,
}

const SAME_RATE_BREAKDOWN = {
  ...EMPTY_BREAKDOWN,
  totalMs: 3 * HOUR,
  billableMs: 3 * HOUR,
  count: 2,
  projects: [
    projectTotal({
      projectId: WEBSITE,
      name: "Website",
      hourlyRateCents: 6100,
      totalMs: 2 * HOUR,
      billableMs: 2 * HOUR,
    }),
    projectTotal({
      projectId: DISCOVERY,
      name: "Discovery",
      hourlyRateCents: 6100,
    }),
  ],
}

/** The args the page builds for its own breakdown — including
 *  `billableOnly: true`, which the mutation hard-codes and which decides the
 *  bucket ORDER as well as which rows are counted. */
function breakdownKey(search: InvoiceSearch, range = WEEK) {
  return convexKey(api.entries.rangeBreakdown, {
    fromMs: search.from ?? range.fromMs,
    toMs: search.to ?? range.toMs,
    timeZone: SETTINGS.timezone,
    weekStartDay: SETTINGS.weekStartDay,
    billableOnly: true,
    projectId: search.projectId ?? null,
    text: search.text ?? "",
    presets: [...(search.presets ?? [])],
  })
}

function renderNew(
  opts: {
    search?: InvoiceSearch
    breakdown?: typeof EMPTY_BREAKDOWN | null
    settings?: Omit<typeof SETTINGS, "logoUrl"> & {
      logoUrl: string | null
      defaultHourlyRateCents?: number
    }
    projects?: Array<Doc<"projects">>
    clients?: Array<Doc<"clients">>
    /** What `invoices.lastDetails` answers — the standing fields of the last
     *  invoice this account raised. Defaults to null, which is the account
     *  raising its first one. */
    previous?: {
      billedTo: string
      payTo: string
      paymentTerms?: string
      notes?: string
    } | null
  } = {}
) {
  const search = opts.search ?? { from: WEEK.fromMs, to: WEEK.toMs }
  const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // The breakdown is a plain `useQuery`, so an unseeded key must stay
        // PENDING rather than reject — that pending state is the page's
        // "Still totalling this period." refusal, and it is under test.
        queryFn: () => new Promise(() => {}),
      },
    },
  })
  queryClient.setQueryData(
    convexKey(api.settings.get, {}),
    opts.settings ?? SETTINGS
  )
  queryClient.setQueryData(
    convexKey(api.projects.list, {}),
    opts.projects ?? [
      projectRow({ _id: WEBSITE, name: "Website", clientId: ACME }),
      projectRow({ _id: DISCOVERY, name: "Discovery", clientId: ACME }),
      projectRow({ _id: FREE, name: "Pro bono" }),
    ]
  )
  queryClient.setQueryData(
    convexKey(api.clients.list, {}),
    opts.clients ?? [
      clientRow({
        _id: ACME,
        name: "Acme Corp",
        address: "1 Way\nSpringfield",
      }),
    ]
  )
  queryClient.setQueryData(
    convexKey(api.invoices.lastDetails, {}),
    opts.previous ?? null
  )
  if (opts.breakdown !== null) {
    queryClient.setQueryData(breakdownKey(search), opts.breakdown ?? BREAKDOWN)
  }

  const result = render(
    <QueryClientProvider client={queryClient}>
      <NewInvoicePage search={search} onCreated={onCreated} />
    </QueryClientProvider>
  )
  return { ...result, dateSpy }
}

/** The preview table's body rows, cell by cell — what a person reads across. */
function lineRows(): Array<Array<string>> {
  const tbody = document.querySelector("tbody")
  if (tbody === null) throw new Error("no line table rendered")
  return [...tbody.querySelectorAll("tr")].map((row) =>
    [...row.querySelectorAll("th,td")].map((cell) => cell.textContent)
  )
}

function totalsRows(): Array<Array<string>> {
  const tfoot = document.querySelector("tfoot")
  if (tfoot === null) throw new Error("no totals block rendered")
  return [...tfoot.querySelectorAll("tr")].map((row) =>
    [...row.querySelectorAll("th,td")].map((cell) => cell.textContent)
  )
}

// ---------------------------------------------------------------------------

/*
 * The page frame, which this route also used to build by hand — a breadcrumb and
 * a bare `<h1 className="text-sm font-semibold">` inside its own layout, one of
 * the five spellings of the same treatment.
 */
describe("/invoices/new — the page heading", () => {
  it("has exactly one h1, and the preview's own heading stays subordinate to it", () => {
    renderNew()

    expectPageHeading("New invoice")
    // `BillPreview` names itself with an `<h2>`. The page heading is what makes
    // that an h2 OF something rather than the first heading on the page.
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(
      0
    )
  })
})

describe("/invoices/new — the preview is what will be billed", () => {
  /*
   * THE TEST THIS PAGE EXISTS FOR. Every figure is a hand-computed literal, so
   * a preview that priced its own rows — rounding instead of flooring, or
   * keeping the unrated bucket — fails here even though the mutation is
   * untouched.
   */
  it("draws exactly the lines the mutation will mint", () => {
    const { dateSpy } = renderNew()

    expect(lineRows()).toEqual([
      ["Website", "5.00", "$61.00/hr", "$305.00"],
      ["Pro bono", "1.00", "$0.00/hr", "$0.00"],
    ])

    dateSpy.mockRestore()
  })

  it("merges same-rate projects by default and redraws when split is chosen", () => {
    const { dateSpy } = renderNew({ breakdown: SAME_RATE_BREAKDOWN })

    expect(lineRows()).toEqual([
      ["Professional services", "3.00", "$61.00/hr", "$183.00"],
    ])

    fireEvent.click(
      screen.getByLabelText("Merge same-rate projects into one line")
    )
    expect(lineRows()).toEqual([
      ["Website", "2.00", "$61.00/hr", "$122.00"],
      ["Discovery", "1.00", "$61.00/hr", "$61.00"],
    ])

    dateSpy.mockRestore()
  })

  it("redraws the merged preview from the typed summary", () => {
    const { dateSpy } = renderNew({ breakdown: SAME_RATE_BREAKDOWN })

    fireEvent.change(screen.getByLabelText("Summary description"), {
      target: { value: "  Design and development  " },
    })
    expect(lineRows()[0]?.[0]).toBe("Design and development")

    fireEvent.change(screen.getByLabelText("Summary description"), {
      target: { value: "   " },
    })
    expect(lineRows()[0]?.[0]).toBe("Professional services")

    dateSpy.mockRestore()
  })

  it("explains when different rates prevent a requested merge", () => {
    const { dateSpy } = renderNew()

    const status = screen.getByText(
      "These projects bill at different rates, so this invoice lists them separately."
    )
    expect(status.getAttribute("role")).toBe("status")

    dateSpy.mockRestore()
  })

  it("does not announce a stale mixed-rate result while totalling", () => {
    cleanup()
    render(
      <BillPreview
        pending
        lines={[
          {
            projectId: null,
            description: "Old result",
            quantityCentis: 100,
            unitCents: 1000,
            amountCents: 1000,
          },
        ]}
        currency="USD"
        unratedMs={0}
        durationDisplay="hms"
        mergeDeclined
      />
    )

    expect(screen.getByText("Still totalling this period.")).toBeTruthy()
    expect(screen.queryByText(/different rates/)).toBeNull()
  })

  /* Time nobody has priced is on NO line, so the total is not short by
   * accident — it is short by rule, and the rule is stated below the table. */
  it("leaves an unrated bucket off the table entirely", () => {
    const { dateSpy } = renderNew()
    expect(screen.queryByText("Discovery")).toBeNull()
    dateSpy.mockRestore()
  })

  it("totals the lines it drew", () => {
    const { dateSpy } = renderNew()
    expect(totalsRows()).toEqual([
      ["Subtotal", "$305.00"],
      ["Total", "$305.00"],
    ])
    dateSpy.mockRestore()
  })

  /*
   * THE ABSENCE, STATED. `invoiceLineDrafts` skips an unpriced bucket, so that
   * work is billed to nobody — and there is no editor afterwards in which to
   * add it. The sentence is `UNPRICED_NOTE` verbatim, the one /reports' own
   * exports carry: three near-identical sentences drift until they claim three
   * different things, and this is the copy that has to survive being read
   * beside a PDF of the same range.
   */
  it("says how much billable time no rate covers, in the shared words", () => {
    const { dateSpy } = renderNew()

    const note = screen.getByText(new RegExp(UNPRICED_NOTE.slice(0, 40)))
    expect(note.textContent).toContain(UNPRICED_NOTE)
    // 2h, in the user's own duration display.
    expect(note.textContent).toContain("2:00:00")
    expect(note.getAttribute("role")).toBe("status")

    dateSpy.mockRestore()
  })

  it("says nothing about unpriced time when every bucket has a rate", () => {
    const { dateSpy } = renderNew({
      breakdown: {
        ...BREAKDOWN,
        unratedBillableMs: 0,
        projects: [PROJECTS[0], PROJECTS[2]],
      },
    })
    expect(
      screen.queryByText(new RegExp(UNPRICED_NOTE.slice(0, 40)))
    ).toBeNull()
    dateSpy.mockRestore()
  })

  /*
   * A range that prices nothing still draws its empty table, and the reason is
   * that the table is the EVIDENCE for the refusal beside the button.
   *
   * `createFromRange` will not mint this document — `NO_PRICED_TIME` refuses a
   * range with no priced lines, because an invoice is write-once and a numbered
   * $0.00 shell could never be deleted. So the preview's job here is not to
   * promise a document; it is to show the user the thing the refusal is talking
   * about. Hiding the table would leave "this would have no lines" as an
   * assertion with nothing on screen to check it against.
   */
  it("draws a zero-line document rather than nothing", () => {
    const { dateSpy } = renderNew({
      breakdown: {
        ...BREAKDOWN,
        projects: [PROJECTS[1]],
        unratedBillableMs: 2 * HOUR,
      },
    })
    expect(screen.getByText(/Lines come from the range/)).toBeTruthy()
    expect(totalsRows()).toEqual([
      ["Subtotal", "$0.00"],
      ["Total", "$0.00"],
    ])
    dateSpy.mockRestore()
  })

  /* The invoice is denominated in whatever the picker says, and the preview has
   * to follow it — otherwise the figures a user approves are in one currency
   * and the document is in another. */
  it("re-denominates the preview when the currency picker changes", async () => {
    const { dateSpy } = renderNew()

    fireEvent.change(screen.getByLabelText("Currency"), {
      target: { value: "EUR" },
    })

    await waitFor(() => expect(lineRows()[0]?.[3]).toBe("€305.00"))

    dateSpy.mockRestore()
  })
})

describe("/invoices/new — the form", () => {
  /* The block the mutation would snapshot, put in the box where it can be read
   * and changed. `partyBlockOf` on both sides, so it is identical to the
   * newline. */
  it("prefills the billed-to block from the range's one client", () => {
    const { dateSpy } = renderNew()
    expect(screen.getByLabelText<HTMLTextAreaElement>("Billed to").value).toBe(
      "Acme Corp\n1 Way\nSpringfield"
    )
    dateSpy.mockRestore()
  })

  /* Two clients is the one prefill that could put a document in the wrong
   * company's inbox. The server refuses `MIXED_CLIENTS` over the rows it will
   * bill; the form declines to guess in the meantime — and with no invoice
   * behind it there is nothing to carry either. */
  it("prefills nothing when the range touches two clients", () => {
    const other = "c-globex" as unknown as Id<"clients">
    const { dateSpy } = renderNew({
      projects: [
        projectRow({ _id: WEBSITE, name: "Website", clientId: ACME }),
        projectRow({ _id: DISCOVERY, name: "Discovery", clientId: other }),
        projectRow({ _id: FREE, name: "Pro bono" }),
      ],
      clients: [
        clientRow({ _id: ACME, name: "Acme Corp" }),
        clientRow({ _id: other, name: "Globex Inc" }),
      ],
    })
    expect(screen.getByLabelText<HTMLTextAreaElement>("Billed to").value).toBe(
      ""
    )
    dateSpy.mockRestore()
  })

  /*
   * THE ARRANGEMENT CARRIES, and this is the page test for it — the rules are
   * asserted on `newInvoiceDraft` and `invoices.lastDetails`, so what this
   * proves is the wiring: the query is read, and its answer reaches the boxes
   * on the FIRST paint rather than after one.
   */
  it("opens the standing fields with the last invoice's values", () => {
    const { dateSpy } = renderNew({
      previous: {
        billedTo: "Old Client\nElsewhere",
        payTo: "Jo Freelance\nIBAN GB33BUKB20201555555555",
        paymentTerms: "Net 14",
        notes: "Thanks. Transfer only, please.",
      },
    })
    expect(screen.getByLabelText<HTMLTextAreaElement>("Pay to").value).toBe(
      "Jo Freelance\nIBAN GB33BUKB20201555555555"
    )
    expect(screen.getByLabelText<HTMLInputElement>("Payment terms").value).toBe(
      "Net 14"
    )
    expect(screen.getByLabelText<HTMLTextAreaElement>("Notes").value).toBe(
      "Thanks. Transfer only, please."
    )
    // The RANGE's client wins the billed-to box: it is evidence about the work
    // in front of the user, where the last invoice is evidence about the last
    // job. The carried block only fills a box the range says nothing about.
    expect(screen.getByLabelText<HTMLTextAreaElement>("Billed to").value).toBe(
      "Acme Corp\n1 Way\nSpringfield"
    )
    // Never the purchase order — a reference to one particular order, and the
    // one carried value that would look right and be wrong.
    expect(
      screen.getByLabelText<HTMLInputElement>("Purchase order").value
    ).toBe("")
    dateSpy.mockRestore()
  })

  it("falls back to the last invoice's client when the range names none", () => {
    const { dateSpy } = renderNew({
      projects: [projectRow({ _id: WEBSITE, name: "Website" })],
      clients: [],
      previous: { billedTo: "Old Client\nElsewhere", payTo: "Jo Freelance" },
    })
    expect(screen.getByLabelText<HTMLTextAreaElement>("Billed to").value).toBe(
      "Old Client\nElsewhere"
    )
    dateSpy.mockRestore()
  })

  it("opens on today and thirty days, in the stored zone", () => {
    const { dateSpy } = renderNew()
    expect(screen.getByLabelText<HTMLInputElement>("Invoice date").value).toBe(
      "2026-08-05"
    )
    expect(screen.getByLabelText<HTMLInputElement>("Due date").value).toBe(
      "2026-09-04"
    )
    dateSpy.mockRestore()
  })

  /* An advisory, not a refusal — `createFromRange` deliberately does not compare
   * the dates, so this sentence is the only thing standing between a mistyped
   * year and a permanent record. */
  it("warns when the due date precedes the invoice date, without blocking", () => {
    const { dateSpy } = renderNew()

    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-08-01" },
    })

    expect(screen.getByText(/paid before it was raised/)).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "Create invoice" })
        .hasAttribute("disabled")
    ).toBe(false)

    dateSpy.mockRestore()
  })

  it("prefills the summary description only while merging is enabled", () => {
    const { dateSpy } = renderNew({ breakdown: SAME_RATE_BREAKDOWN })

    expect(
      screen.getByLabelText<HTMLInputElement>("Summary description").value
    ).toBe("Professional services")
    fireEvent.click(
      screen.getByLabelText("Merge same-rate projects into one line")
    )
    expect(screen.queryByLabelText("Summary description")).toBeNull()

    dateSpy.mockRestore()
  })

  it("shows the current logo or a settings link in the form column", () => {
    const withLogo = renderNew({
      settings: { ...SETTINGS, logoUrl: "/logo.png" },
    })
    expect(
      document.querySelector<HTMLImageElement>('img[src="/logo.png"]')?.alt
    ).toBe("")
    withLogo.unmount()
    withLogo.dateSpy.mockRestore()

    const withoutLogo = renderNew({ settings: { ...SETTINGS, logoUrl: null } })
    const link = screen.getByRole("link", {
      name: "No logo — add one in Settings",
    })
    expect(link.getAttribute("href")).toBe("/settings")
    withoutLogo.dateSpy.mockRestore()
  })

  /* An emptied date input is the browser mid-typing, not an invoice with no
   * date. Recording it would leave the picker blank and send `NaN`. */
  it("ignores an emptied date rather than recording one", () => {
    const { dateSpy } = renderNew()
    fireEvent.change(screen.getByLabelText("Invoice date"), {
      target: { value: "" },
    })
    expect(screen.getByLabelText<HTMLInputElement>("Invoice date").value).toBe(
      "2026-08-05"
    )
    dateSpy.mockRestore()
  })
})

describe("/invoices/new — minting", () => {
  it("sends the range, the filter and every field on the form, then goes to the document", async () => {
    const { dateSpy } = renderNew({
      search: {
        from: WEEK.fromMs,
        to: WEEK.toMs,
        projectId: WEBSITE,
        text: "audit",
        presets: ["no-note"],
      },
    })

    fireEvent.change(screen.getByLabelText("Pay to"), {
      target: { value: "Jane Freelancer\n2 Lane" },
    })
    fireEvent.change(screen.getByLabelText("Purchase order"), {
      target: { value: "PO-4471" },
    })
    fireEvent.change(screen.getByLabelText("Payment terms"), {
      target: { value: "Net 14" },
    })
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Bank transfer\nAccount 1234" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("inv-1"))
    // Every field, including the ones left as prefilled — an emptied block is
    // "" rather than absent, because absent means "nobody said" and the server
    // then falls back to a client address the user may have just cleared.
    expect(createInvoice).toHaveBeenCalledWith({
      fromMs: WEEK.fromMs,
      toMs: WEEK.toMs,
      timeZone: SETTINGS.timezone,
      weekStartDay: SETTINGS.weekStartDay,
      projectId: WEBSITE,
      text: "audit",
      presets: ["no-note"],
      billedTo: "Acme Corp\n1 Way\nSpringfield",
      payTo: "Jane Freelancer\n2 Lane",
      purchaseOrder: "PO-4471",
      paymentTerms: "Net 14",
      mergeLines: true,
      summaryDescription: "Professional services",
      notes: "Bank transfer\nAccount 1234",
      currency: "USD",
      issuedAt: Date.parse("2026-08-05T00:00:00.000Z"),
      dueAt: Date.parse("2026-09-04T00:00:00.000Z"),
    })

    dateSpy.mockRestore()
  })

  it("sends the per-invoice merge choice and edited summary description", async () => {
    const { dateSpy } = renderNew({ breakdown: SAME_RATE_BREAKDOWN })

    fireEvent.change(screen.getByLabelText("Summary description"), {
      target: { value: "Design and development" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }))

    await waitFor(() =>
      expect(createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          mergeLines: true,
          summaryDescription: "Design and development",
        })
      )
    )

    dateSpy.mockRestore()
  })

  it("sends an explicit split choice instead of consulting settings again", async () => {
    const { dateSpy } = renderNew({ breakdown: SAME_RATE_BREAKDOWN })

    fireEvent.click(
      screen.getByLabelText("Merge same-rate projects into one line")
    )
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }))

    await waitFor(() =>
      expect(createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ mergeLines: false })
      )
    )

    dateSpy.mockRestore()
  })

  /* A cleared block must stay cleared. The mutation falls back to the range's
   * own client for an ABSENT `billedTo`, so sending nothing would put the
   * address back on a document that cannot be edited afterwards. */
  it("sends an emptied billed-to block as empty, not as absent", async () => {
    const { dateSpy } = renderNew()

    fireEvent.change(screen.getByLabelText("Billed to"), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }))

    await waitFor(() =>
      expect(createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ billedTo: "" })
      )
    )

    dateSpy.mockRestore()
  })

  /* A second document is a second NUMBER, which is the failure the whole
   * numbering scheme exists to prevent. `clientKey` covers a retried request;
   * this covers a second click landing before React paints the disabled state. */
  it("mints nothing on a second click while the first is in flight", async () => {
    let release: (value: {
      invoiceId: string
      unratedMs: number
      replayed: boolean
    }) => void = () => undefined
    createInvoice.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const { dateSpy } = renderNew()

    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }))
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Creating…" })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole("button", { name: "Creating…" }))

    expect(createInvoice).toHaveBeenCalledTimes(1)

    release({ invoiceId: "inv-1", unratedMs: 0, replayed: false })
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))

    dateSpy.mockRestore()
  })

  /* THE PERMANENCE, said before the press rather than in a dialog after it.
   * There is no editor, so this is the last moment the user can act on it. */
  it("states that an invoice cannot be edited afterwards, beside the button", () => {
    const { dateSpy } = renderNew()
    const button = screen.getByRole("button", { name: "Create invoice" })
    const described = document.getElementById(
      button.getAttribute("aria-describedby") ?? ""
    )
    expect(described?.textContent).toContain("cannot be edited")
    dateSpy.mockRestore()
  })
})

describe("/invoices/new — refusals", () => {
  /*
   * A refusal that NAMES A FIELD lands beside that field's control. The whole
   * document goes in one mutation, so a general banner would leave the user
   * rereading eight boxes for the one that was too long.
   */
  it("puts a field refusal beside the box that earned it", async () => {
    createInvoice.mockRejectedValue({
      data: {
        code: "TOO_LONG",
        message: "Keep the pay-to block under 601 characters.",
        meta: { field: "payTo" },
      },
    })
    const { dateSpy } = renderNew()

    fireEvent.change(screen.getByLabelText("Pay to"), {
      target: { value: "x".repeat(700) },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }))

    const box = screen.getByLabelText("Pay to")
    await waitFor(() => expect(box.getAttribute("aria-invalid")).toBe("true"))
    const message = document.getElementById(
      box.getAttribute("aria-describedby") ?? ""
    )
    expect(message?.textContent).toBe(
      "Keep the pay-to block under 601 characters."
    )
    // The text that earned it is still in the box, so fixing it and pressing
    // again sends the whole set exactly as before.
    expect((box as HTMLTextAreaElement).value).toHaveLength(700)
    expect(onCreated).not.toHaveBeenCalled()

    dateSpy.mockRestore()
  })

  /* Editing the field is the answer to its refusal — a message pointing at text
   * that has since been fixed is worse than none. */
  it("clears a field refusal as soon as that field is edited", async () => {
    createInvoice.mockRejectedValue({
      data: {
        code: "TOO_LONG",
        message: "Keep the pay-to block under 601 characters.",
        meta: { field: "payTo" },
      },
    })
    const { dateSpy } = renderNew()

    fireEvent.click(screen.getByRole("button", { name: "Create invoice" }))
    await waitFor(() =>
      expect(screen.getByLabelText("Pay to").getAttribute("aria-invalid")).toBe(
        "true"
      )
    )

    fireEvent.change(screen.getByLabelText("Pay to"), {
      target: { value: "Jane" },
    })
    expect(screen.getByLabelText("Pay to").getAttribute("aria-invalid")).toBe(
      "false"
    )

    dateSpy.mockRestore()
  })

  /*
   * The refusals only the server can make: which client each project belongs to
   * is decided over the rows the invoice will actually be built from, and the
   * next number's uniqueness over the whole history. Printed beside the button
   * rather than toasted — each names a fix, and a sentence that has to be acted
   * on should not be on a timer.
   */
  it.each([
    [
      "MIXED_CLIENTS",
      'This range covers two clients — "Acme Corp" and "Globex Inc" — and an invoice can only be billed to one. Narrow the dates or filter to a single project.',
      /Globex Inc/,
    ],
    [
      "INVOICE_HISTORY_TOO_LARGE",
      "This account has too many invoices for the next number to be verified unique.",
      /too many invoices/,
    ],
    [
      "RANGE_TOO_LARGE",
      "This period has more time entries than an invoice can total exactly — invoicing reads a smaller window than /reports does. Narrow the dates.",
      /smaller window/,
    ],
  ])(
    "shows a %s refusal in the words the server wrote",
    async (code, message, shown) => {
      createInvoice.mockRejectedValue({ data: { code, message } })
      const { dateSpy } = renderNew()

      fireEvent.click(screen.getByRole("button", { name: "Create invoice" }))

      await waitFor(() =>
        expect(screen.getByRole("alert").textContent).toMatch(shown)
      )
      expect(onCreated).not.toHaveBeenCalled()
      // And the control comes back: every one of these has a fix the user can go
      // and apply, so it has to be pressable again.
      expect(
        screen
          .getByRole("button", { name: "Create invoice" })
          .hasAttribute("disabled")
      ).toBe(false)

      dateSpy.mockRestore()
    }
  )

  /*
   * THE SAME THREE STATES /reports refuses, checked again HERE — because this
   * URL can be typed. The button there is a link now and a link cannot be
   * pressed into a refusal, so a hand-typed range that is truncated has to meet
   * the rule somewhere, and this is the only somewhere left.
   */
  it("refuses a truncated range, visibly", async () => {
    const { dateSpy } = renderNew({
      breakdown: { ...BREAKDOWN, truncated: true },
    })

    const button = screen.getByRole("button", { name: "Create invoice" })
    expect(button.hasAttribute("disabled")).toBe(true)
    // VISIBLE, not `sr-only`. This page's single action is disabled, and a
    // disabled button with no stated reason is a dead end for everybody.
    expect(screen.getByText(/under-bill/)).toBeTruthy()
    expect(
      document.getElementById(button.getAttribute("aria-describedby") ?? "")
        ?.textContent
    ).toMatch(/under-bill/)

    fireEvent.click(button)
    expect(createInvoice).not.toHaveBeenCalled()

    dateSpy.mockRestore()
  })

  /*
   * THE RANGE THAT WOULD MINT AN EMPTY DOCUMENT — billable hours that no rate
   * covers — and the refusal a hand-typed URL has to meet.
   *
   * /reports disables its own control for this state, but that control is a
   * LINK and this route is reachable without it, so the page checks it again.
   * `createFromRange` checks it a third time (`NO_PRICED_TIME`), which is what
   * makes it a rule rather than a convenience; this is the half that says so
   * before the click, on the screen that has already priced the lines and can
   * therefore show the empty table the sentence is about.
   */
  it("refuses a range that would price no lines, and names where to set a rate", () => {
    const { dateSpy } = renderNew({
      breakdown: {
        ...EMPTY_BREAKDOWN,
        totalMs: 2 * HOUR,
        billableMs: 2 * HOUR,
        count: 1,
        unratedBillableMs: 2 * HOUR,
        projects: [PROJECTS[1]],
      },
    })

    const button = screen.getByRole("button", { name: "Create invoice" })
    expect(button.hasAttribute("disabled")).toBe(true)
    // `SET_A_RATE_NOTE`, the same sentence the note under the preview carries —
    // the button and the note are one fix, so they name one screen.
    expect(
      document.getElementById(button.getAttribute("aria-describedby") ?? "")
        ?.textContent
    ).toContain(SET_A_RATE_NOTE)

    // And pressing it anyway mints nothing: `disabled` is the appearance, the
    // guard inside `create()` is what makes it true.
    fireEvent.click(button)
    expect(createInvoice).not.toHaveBeenCalled()

    dateSpy.mockRestore()
  })

  /*
   * AND THE PREVIEW SAYS SO TOO, rather than drawing a zero-line document.
   * "No lines on this invoice" over a $0.00 total is what a range where every
   * project is unrated PREVIEWS as — no such invoice can be minted, since
   * `NO_PRICED_TIME` refuses it, but the empty table is the evidence for that
   * refusal. Drawing it while the scan is still running would put that evidence
   * on screen for a range nothing has checked: it reads as "there is nothing
   * here" when the truth is "we do not know yet", on the one screen where a user
   * decides whether to bill a client.
   */
  it("refuses a range that has not finished totalling, and draws no document for it", () => {
    const { dateSpy } = renderNew({ breakdown: null })
    expect(
      screen
        .getByRole("button", { name: "Create invoice" })
        .hasAttribute("disabled")
    ).toBe(true)
    // Twice: on the trigger, and where the lines would be.
    expect(screen.getAllByText("Still totalling this period.")).toHaveLength(2)
    expect(document.querySelector("table")).toBeNull()
    expect(screen.queryByText(/No lines on this invoice/)).toBeNull()
    dateSpy.mockRestore()
  })
})

/*
 * THE URL, which is the other half of this route's contract.
 *
 * `parseInvoiceSearch` drops what it cannot read rather than throwing (its own
 * rules are pinned in invoice-search.test.ts); what is asserted here is what the
 * PAGE then does with the absence — because "the parser returned {}" and "the
 * user got a usable page that says which period it settled on" are two different
 * claims, and only the second one is the requirement.
 */
describe("/invoices/new — a link with no readable period", () => {
  it("bills the current week and says the link carried none", () => {
    const { dateSpy } = renderNew({ search: {} })

    // Drawn, not blank: the same figures the seeded default-week breakdown has.
    expect(lineRows()).toEqual([
      ["Website", "5.00", "$61.00/hr", "$305.00"],
      ["Pro bono", "1.00", "$0.00/hr", "$0.00"],
    ])
    const notice = screen.getByText(/carried no period/)
    expect(notice.getAttribute("role")).toBe("status")
    expect(
      screen.getByRole("link", { name: "Reports" }).getAttribute("href")
    ).toBe("/reports")

    dateSpy.mockRestore()
  })

  it("states the period it settled on, so the fallback is not silent", () => {
    const { dateSpy } = renderNew({ search: {} })
    // 3 – 9 Aug 2026, the Monday-start week containing NOW. The END is read
    // from the instant BEFORE `toMs`, which is exclusive — naming the 10th
    // would claim a day the invoice does not bill.
    expect(screen.getByText("3 – 9 Aug 2026")).toBeTruthy()
    dateSpy.mockRestore()
  })

  /* A range given in the URL is used verbatim and nothing is said, because
   * nothing was assumed. */
  it("says nothing when the link carried a period", () => {
    const { dateSpy } = renderNew()
    expect(screen.queryByText(/carried no period/)).toBeNull()
    dateSpy.mockRestore()
  })
})

describe("/invoices/new — the filter it was handed", () => {
  it("names the project, the search and the chips the link carried", () => {
    const { dateSpy } = renderNew({
      search: {
        from: WEEK.fromMs,
        to: WEEK.toMs,
        projectId: WEBSITE,
        text: "audit",
        presets: ["no-note", "under-a-minute"],
      },
    })

    const strip = screen.getByText("Period").closest("dl")
    expect(strip).toBeTruthy()
    const rows = within(strip as HTMLElement)
    expect(rows.getByText("Website")).toBeTruthy()
    expect(rows.getByText("“audit”")).toBeTruthy()
    expect(rows.getByText("No note, Under a minute")).toBeTruthy()

    dateSpy.mockRestore()
  })

  /* `""` is the "entries with NO project" sentinel, not an absent filter, and
   * it is named with the same label every chart and every invoice line gives
   * that bucket. */
  it("names the no-project sentinel rather than printing an empty cell", () => {
    const { dateSpy } = renderNew({
      search: { from: WEEK.fromMs, to: WEEK.toMs, projectId: "" },
    })
    const strip = screen.getByText("Project").closest("div")
    expect(strip?.textContent).toContain("No project")
    dateSpy.mockRestore()
  })

  /* A project from another account's link, or one since deleted. The scan
   * matches nothing, and saying so is what makes the empty preview explicable
   * rather than mysterious. */
  it("says a project it cannot resolve is unknown", () => {
    const { dateSpy } = renderNew({
      search: { from: WEEK.fromMs, to: WEEK.toMs, projectId: "p-gone" },
      breakdown: { ...EMPTY_BREAKDOWN, count: 1, totalMs: HOUR },
    })
    expect(screen.getByText("An unknown project")).toBeTruthy()
    dateSpy.mockRestore()
  })
})

describe("the /invoices/new route", () => {
  it("names the page in the tab title", () => {
    const head = Route.options.head as () => { meta: Array<{ title: string }> }
    expect(head().meta[0]?.title).toBe("New invoice — Chroneli")
  })

  /*
   * `validateSearch` MUST NOT THROW. The router catches a throw, records a
   * `SearchParamError` against the match and renders this route's error
   * component instead of the page — which is the wrong answer for a truncated
   * paste. Asserted against the route's own option rather than against the
   * parser, because it is the wiring that would be dropped in a refactor.
   */
  it("validates its search params without ever throwing", () => {
    const validate = Route.options.validateSearch as (
      raw: Record<string, unknown>
    ) => unknown
    expect(validate({ from: "nonsense", to: [] })).toEqual({})
    expect(validate({ from: WEEK.fromMs, to: WEEK.toMs })).toEqual({
      from: WEEK.fromMs,
      to: WEEK.toMs,
    })
  })
})
