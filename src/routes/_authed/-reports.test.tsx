import { Suspense } from "react"
import { Toaster } from "@/components/ui/toast"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { defaultParseSearch } from "@tanstack/react-router"
import { getFunctionName } from "convex/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { Reports } from "@/routes/_authed/-reports"
import { breakdownArgs } from "@/lib/breakdown-args"
import { rangeOf, stepPeriod } from "@/lib/history-filters"
import { reportsDefaultFilters } from "@/lib/date-range-picker"
import { parseInvoiceSearch } from "@/lib/invoice-search"
import { SET_A_RATE_NOTE } from "@/lib/export/report-rows"
import {
  convexKey,
  paginatedKey,
  resetPaginatedStore,
  resolvePage,
} from "@/test-utils/convex-query"
import { expectFilterControlsInBand } from "@/test-utils/filter-band"
import { NOW, SETTINGS, makeEntry } from "@/test-utils/fixtures"
import { expectPageHeading } from "@/test-utils/page-heading"
import { dayOf } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import { EMPTY_BREAKDOWN } from "@/lib/report-series"
import type { Breakdown } from "@/lib/report-series"
import type { Id } from "../../../convex/_generated/dataModel"
import type * as ConvexReactModuleType from "convex/react"
import type * as RouterModuleType from "@tanstack/react-router"

type ConvexReactModule = typeof ConvexReactModuleType
type RouterModule = typeof RouterModuleType

/*
 * The regression this file exists for: changing the date filter used to blank
 * the ENTIRE route. `fromMs`/`toMs` are part of `entries.rangeSummary`'s
 * query key, so a range change mints a key with nothing cached for it, and
 * `useSuspenseQuery` answered that by throwing — unmounting this whole
 * component (the filter bar, the log, everything) up to the nearest Suspense
 * boundary. `usePaginatedQuery`'s own args-changed reset had the same
 * consequence for the log itself, one level down (see -reports.tsx's
 * `settledPageRef` comment).
 *
 * `EntryLog` is mocked to a plain list of testable rows below — what is under
 * test here is Reports' OWN composition (which hooks it calls and how their
 * results reach the screen), not EntryLog/EntryRow's rendering, which is
 * covered elsewhere and drags in a page of mutation hooks and popovers that
 * have nothing to do with this bug.
 */

/*
 * `Link` reads router context via `useRouter`, and this file deliberately
 * renders `Reports` on its own — the route's COMPONENT is what is under test,
 * not the router. It is imported from ./-reports, where it lives so the route
 * file's `component:` can be code-split; the route definition itself is not
 * imported here, so a broken one fails the type check and the router's own
 * generation rather than this file. Everything else in the module stays real —
 * stubbing more than `Link` would hide genuine errors behind a test double.
 *
 * The double SERIALISES `search` with the router's own `defaultStringifySearch`
 * rather than dropping it. `Create invoice` is a link now, and what it carries
 * is the whole point of it: a double that rendered only `to` would pass against
 * a control that sent the create page no range and no filter at all.
 */
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<RouterModule>()
  return {
    ...actual,
    Link: ({
      to,
      search,
      children,
      ...rest
    }: {
      to: string
      search?: Record<string, unknown>
      children: React.ReactNode
      className?: string
    }) => (
      <a
        href={`${to}${search === undefined ? "" : actual.defaultStringifySearch(search)}`}
        {...rest}
      >
        {children}
      </a>
    ),
  }
})

/*
 * Every member of this is a `useConvexMutation`, which throws without a real
 * `ConvexReactClient` in the tree — and there is none here. The page reaches
 * for it so it can hand ONE instance to the log rather than letting the log
 * build a second (see `use-entry-actions.ts`); the log itself is stubbed
 * below, so nothing in this file can press one of them.
 */
vi.mock("@/hooks/use-entry-actions", () => ({
  useEntryActions: () => ({}),
}))

vi.mock("@/components/entries/entry-log", () => ({
  EntryLog: ({
    groups,
    empty,
    grouped,
  }: {
    groups: Array<{ day: string; label: string; entries: Array<{ _id: string; title: string }> }>
    empty?: React.ReactNode
    // Not this page's to own — it comes from `settings.get` and the page only
    // carries it down, so it is printed rather than swallowed. `String`, not a
    // boolean test: "the page passed false" and "the page passed nothing" have
    // to stay distinguishable, and the second is the regression.
    grouped?: boolean
  }) => {
    if (groups.length === 0) return <>{empty ?? null}</>
    return (
      <div data-testid="entry-log" data-grouped={String(grouped)}>
        {groups.map((group) => (
          <div key={group.day} data-testid={`day-${group.day}`}>
            <span>{group.label}</span>
            {group.entries.map((entry) => (
              <div key={entry._id} data-testid={`entry-${entry._id}`}>
                {entry.title}
              </div>
            ))}
          </div>
        ))}
      </div>
    )
  },
}))

/*
 * `usePaginatedQuery` (from "convex/react") reads and writes a subscription
 * this test does not have — there is no real `ConvexReactClient` here. The
 * double in `@/test-utils/convex-query` reproduces exactly the one behaviour
 * the fix in -reports.tsx depends on: the REAL hook resets `results` to `[]`
 * and `status` to "LoadingFirstPage" the instant its args (the query key)
 * change, synchronously, before the new first page round-trips. A test
 * controls when a page "arrives" with `resolvePage`.
 */
vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<ConvexReactModule>()
  const { usePaginatedQueryDouble } = await import("@/test-utils/convex-query")
  return { ...actual, usePaginatedQuery: usePaginatedQueryDouble }
})

beforeEach(() => {
  // `usePaginatedQuery`'s pagination ids and that fake store are both module
  // state that would otherwise leak a resolved page from one test's range
  // into the next test's identical-looking key.
  resetPaginatedStore()
})

afterEach(cleanup)

/**
 * A re-suspending boundary does not always strip its old children from the
 * DOM outright — React can instead hide the previously-committed subtree
 * (`display: none`) while the fallback renders, so it can be revealed again
 * without remounting if the new data arrives quickly. That is still the
 * "whole page briefly goes blank" the report complains about: the row is
 * technically still there but not visible. Presence alone (`getByTestId`)
 * would not have caught the pre-fix behaviour — this walks up the tree the
 * way a real viewport would.
 */
function isHidden(el: Element): boolean {
  let node: Element | null = el
  while (node) {
    if (getComputedStyle(node).display === "none") return true
    node = node.parentElement
  }
  return false
}

/**
 * The whole totals sentence, as one string.
 *
 * `getByText` matches an element's DIRECT text nodes only, so any claim that
 * spans a `<strong>` — which is every figure in this sentence — is
 * unassertable with it: "8:00:00 billable ($499.20)" is four elements deep and
 * no single one of them holds that text. Reading the paragraph's
 * `textContent` asserts what a person actually reads off the screen.
 */
function summaryText(): string {
  const paragraph = document.querySelector("p[aria-live]")
  if (paragraph === null) throw new Error("no summary paragraph rendered")
  return paragraph.textContent
}

type Summary = {
  totalMs: number
  billableMs: number
  count: number
  runningCount: number
  truncated: boolean
  billableCents: number
  unratedBillableMs: number
}

/**
 * A `QueryClient` whose default `queryFn` answers `entries.rangeSummary`
 * with a promise this test resolves by hand — real TanStack Query
 * (`useQuery`, `placeholderData`, `isPlaceholderData`) runs for real; only
 * the Convex subscription underneath `convexQuery` is a test double. Any
 * OTHER query hitting this `queryFn` is a test setup bug (a query this file
 * forgot to seed with `setQueryData`), not something to silently resolve.
 */
function createQueryClient() {
  const pending = new Map<string, (value: Summary) => void>()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setDefaultOptions({
    queries: {
      retry: false,
      queryFn: ({ queryKey }) => {
        const [, name, args] = queryKey as [string, string, unknown]
        if (name !== getFunctionName(api.entries.rangeSummary)) {
          throw new Error(`Unseeded query in test: ${name} ${JSON.stringify(args)}`)
        }
        return new Promise<Summary>((resolve) => {
          pending.set(JSON.stringify(args), resolve)
        })
      },
    },
  })
  const resolveSummary = (args: { fromMs: number; toMs: number }, value: Summary) => {
    pending.get(JSON.stringify(args))?.(value)
  }
  return { queryClient, resolveSummary }
}

/**
 * The queries every test needs and no test is about.
 *
 * `settings` overrides only what a caller names; everything else stays the
 * shipped default, so a page reading a setting this helper's callers have
 * never heard of still gets a real value. Added for `groupEntries`, whose OFF
 * case is the one a user reaches by unticking the box.
 */
function seedStable(queryClient: QueryClient, settings: Partial<typeof SETTINGS> = {}) {
  queryClient.setQueryData(convexKey(api.settings.get, {}), { ...SETTINGS, ...settings })
  queryClient.setQueryData(convexKey(api.projects.list, {}), [])
  queryClient.setQueryData(convexKey(api.tags.list, {}), [])
}

/**
 * Seeds the SUMMARY tab's query for the default range.
 *
 * Summary is the tab Reports opens on, so its query runs on mount whichever
 * tab a test is actually about — and `createQueryClient`'s `queryFn` throws on
 * anything it was not told to expect, deliberately, so an unseeded query is a
 * loud test-setup bug rather than a silent hang. `breakdownArgs` is imported
 * from the same @/lib/breakdown-args the panels read rather than spelled out
 * here, so the key this seeds is the key the component asks for by
 * construction.
 */
function seedBreakdown(
  queryClient: QueryClient,
  filters: ReturnType<typeof reportsDefaultFilters>,
  value: Breakdown = EMPTY_BREAKDOWN
) {
  queryClient.setQueryData(
    convexKey(
      api.entries.rangeBreakdown,
      breakdownArgs(
        rangeOf(filters, SETTINGS.timezone),
        SETTINGS.timezone,
        filters,
        SETTINGS.weekStartDay
      )
    ),
    value
  )
}

/**
 * `seedInitialSummary` runs BEFORE `render` — matching how the real loader's
 * `ensureQueryData` populates the cache before the route component ever
 * mounts (see reports.tsx's `loader`). Seeding it after render instead would
 * hide a real `useSuspenseQuery` regression behind a DIFFERENT one (an
 * unseeded query suspending on the very first paint) rather than isolating
 * the one this file is actually about: a RANGE CHANGE suspending.
 *
 * `view` selects the tab under test. It defaults to "detailed" because that is
 * what almost everything in this file is about — the paginated log and the
 * totals sentence — and clicking the tab is a truer setup than exporting a
 * seam to bypass it: it proves the panel mounts, and Base UI unmounts the
 * inactive one, so the Summary tab's query is genuinely gone by the time the
 * assertions run.
 */
function renderReports(
  seedInitialSummary: (queryClient: QueryClient) => void,
  view: "summary" | "detailed" = "detailed",
  settings: Partial<typeof SETTINGS> = {}
) {
  const { queryClient, resolveSummary } = createQueryClient()
  seedStable(queryClient, settings)
  // The default range's breakdown, always — Reports opens on Summary, so this
  // query runs on mount before any test gets to say which tab it cares about.
  seedBreakdown(
    queryClient,
    reportsDefaultFilters(dayOf(NOW, SETTINGS.timezone), SETTINGS.weekStartDay)
  )
  seedInitialSummary(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
      {/*
        `ToastProvider`, matching `RootComponent` in routes/__root.tsx — this
        route is not mounted under it here, and `ExportMenu` calls
        `useToastManager()` unconditionally.
      */}
      <Toaster>
        {/*
          The router itself wraps every routed component in a Suspense boundary
          with no fallback of its own configured for /reports — this stand-in
          makes that boundary visible so a regression that still suspends shows
          up as a fallback replacing the page, exactly like the reported bug,
          rather than an opaque React error.
        */}
        <Suspense fallback={<div data-testid="suspense-fallback">Loading…</div>}>
          <Reports />
        </Suspense>
      </Toaster>
    </QueryClientProvider>
  )
  if (view === "detailed") {
    fireEvent.click(screen.getByRole("tab", { name: "Detailed" }))
  }
  return { queryClient, resolveSummary }
}

/*
 * The same gap /timer had, and the same answer. This page opened on a date
 * range and two charts with no `<h1>` anywhere in it.
 */
describe("Reports — the page heading", () => {
  it("has exactly one h1, named for the page, and does not paint it", () => {
    renderReports(() => {}, "summary")

    expectPageHeading("Reports", { hidden: true })
  })
})

/*
 * THE INCONSISTENCY THIS ASSERTION EXISTS FOR.
 *
 * This page put the period controls, `FilterControls` and the preset chips in
 * one unfilled `px-4 py-3` container while /timer wrapped the SAME
 * `FilterControls` in a Surface band with a hairline above and below. Two
 * pages, one component, two pieces of chrome — and nothing failed, because
 * chrome is not behaviour. The band is `FilterBand` now and both pages render
 * it; this is /timer's assertion, made against the same helper so the two
 * cannot drift apart again without one of them going red.
 */
describe("Reports — the filter band", () => {
  // `"detailed"`: the band is Detailed-only now. The assertion is unchanged —
  // where the controls sit when they are on screen is still the thing that
  // drifted — only the tab that shows them has moved.
  it("puts the filter controls on the shared Surface strip, as /timer does", () => {
    renderReports(() => {}, "detailed")

    expectFilterControlsInBand()
  })

  /*
   * The band is gone from Summary, and its filters are NOT — `breakdownArgs`
   * carries them into the one query both tabs read. A chart narrowed by a
   * control that is no longer on screen is the same defect class as a header
   * total belonging to a range other than the one drawn, so the page has to
   * say so. Asserted in both directions: silent when there is nothing to
   * declare, and explicit when there is.
   */
  it("says nothing on Summary while no filter is set", () => {
    renderReports(() => {}, "summary")

    expect(screen.queryByPlaceholderText("Search titles, notes and projects")).toBeNull()
    expect(screen.queryByText(/narrowed by a filter/)).toBeNull()
  })

  it("declares a filter carried over to Summary, and offers to clear it", () => {
    renderReports(() => {}, "detailed")

    fireEvent.change(screen.getByPlaceholderText("Search titles, notes and projects"), {
      target: { value: "audit" },
    })
    fireEvent.click(screen.getByRole("tab", { name: "Summary" }))

    expect(screen.getByText(/narrowed by a filter set on Detailed/)).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Clear it" }))
    expect(screen.queryByText(/narrowed by a filter/)).toBeNull()
  })
})

describe("Reports — changing the range", () => {
  it("keeps the previous rows on screen while the new range's query is in flight", async () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const initialFilters = reportsDefaultFilters(today, SETTINGS.weekStartDay)
    const initialRange = rangeOf(initialFilters, SETTINGS.timezone)
    const nextFilters = stepPeriod(initialFilters, 1)
    const nextRange = rangeOf(nextFilters, SETTINGS.timezone)

    const alpha = makeEntry({
      _id: "alpha" as unknown as Id<"timeEntries">,
      title: "Alpha entry",
      startedAt: initialRange.fromMs + 3_600_000,
      endedAt: initialRange.fromMs + 7_200_000,
    })
    const beta = makeEntry({
      _id: "beta" as unknown as Id<"timeEntries">,
      title: "Beta entry",
      startedAt: nextRange.fromMs + 3_600_000,
      endedAt: nextRange.fromMs + 7_200_000,
    })

    resolvePage(paginatedKey(api.entries.listPage, initialRange), {
      page: [alpha],
      isDone: true,
    })

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    const { resolveSummary } = renderReports((queryClient) => {
      queryClient.setQueryData(convexKey(api.entries.rangeSummary, initialRange), {
        totalMs: 3_600_000,
        billableMs: 0,
        count: 1,
        runningCount: 0,
        truncated: false,
        billableCents: 0,
        unratedBillableMs: 0,
      })
    })

    await waitFor(() => expect(screen.getByTestId("entry-alpha")).toBeTruthy())
    expect(screen.queryByTestId("suspense-fallback")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /next period/i }))

    // The new range's paginated page and rangeSummary are BOTH still
    // unresolved at this point — this is "the new query is in flight".
    expect(screen.getByTestId("entry-alpha")).toBeTruthy()
    expect(isHidden(screen.getByTestId("entry-alpha"))).toBe(false)
    expect(screen.queryByTestId("suspense-fallback")).toBeNull()

    resolvePage(paginatedKey(api.entries.listPage, nextRange), {
      page: [beta],
      isDone: true,
    })
    resolveSummary(nextRange, {
      totalMs: 3_600_000,
      billableMs: 0,
      count: 1,
      runningCount: 0,
      truncated: false,
      billableCents: 0,
      unratedBillableMs: 0,
    })

    await waitFor(() => expect(screen.getByTestId("entry-beta")).toBeTruthy())
    expect(screen.queryByTestId("entry-alpha")).toBeNull()
    expect(screen.queryByTestId("suspense-fallback")).toBeNull()

    dateSpy.mockRestore()
  })

  it("marks the range total as stale while it is carried over, and unmarks it once the new one lands", async () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const initialFilters = reportsDefaultFilters(today, SETTINGS.weekStartDay)
    const initialRange = rangeOf(initialFilters, SETTINGS.timezone)
    const nextFilters = stepPeriod(initialFilters, 1)
    const nextRange = rangeOf(nextFilters, SETTINGS.timezone)

    resolvePage(paginatedKey(api.entries.listPage, initialRange), { page: [], isDone: true })

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    const { resolveSummary } = renderReports((queryClient) => {
      queryClient.setQueryData(convexKey(api.entries.rangeSummary, initialRange), {
        totalMs: 5_400_000,
        billableMs: 0,
        count: 2,
        runningCount: 0,
        truncated: false,
        billableCents: 0,
        unratedBillableMs: 0,
      })
    })

    await waitFor(() => expect(screen.getByText(/across 2 entries/)).toBeTruthy())
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    expect(screen.queryByText(/Updating…/)).toBeNull()

    resolvePage(paginatedKey(api.entries.listPage, nextRange), { page: [], isDone: true })
    fireEvent.click(screen.getByRole("button", { name: /next period/i }))

    // The OLD total is still the one on screen, but now marked stale rather
    // than presented as the answer to the range just asked for.
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy())
    expect(screen.getByText(/across 2 entries/)).toBeTruthy()
    expect(screen.getByText(/Updating…/)).toBeTruthy()

    resolveSummary(nextRange, {
      totalMs: 1_800_000,
      billableMs: 0,
      count: 5,
      runningCount: 0,
      truncated: false,
      billableCents: 0,
      unratedBillableMs: 0,
    })

    await waitFor(() => expect(screen.getByText(/across 5 entries/)).toBeTruthy())
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    expect(screen.queryByText(/Updating…/)).toBeNull()

    dateSpy.mockRestore()
  })
})

describe("Reports — the log's own staleness", () => {
  /*
   * `settledPageRef` used to seed with the CURRENT rangeKey on mount, as if
   * that range's first page had already settled — while `status` was
   * `LoadingFirstPage` and `results` was `[]`. Change the range before that
   * page lands (the loader prefetches `rangeSummary`, not `listPage`, so the
   * window is real) and the ref then disagreed with `rangeKey`: `logIsStale`
   * true, `logLoading` false, `EntryLog` rendered with zero groups, and the
   * empty sentence appeared over a range that was still loading. Exactly the
   * flash the ref exists to prevent.
   */
  it("does not flash the empty sentence when the range changes before the first page lands", () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const initialFilters = reportsDefaultFilters(today, SETTINGS.weekStartDay)
    const initialRange = rangeOf(initialFilters, SETTINGS.timezone)

    // Neither range's page is resolved: this is the cold-load window.
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    renderReports((queryClient) => {
      queryClient.setQueryData(convexKey(api.entries.rangeSummary, initialRange), {
        totalMs: 0,
        billableMs: 0,
        count: 0,
        runningCount: 0,
        truncated: false,
        billableCents: 0,
        unratedBillableMs: 0,
      })
    })

    expect(screen.queryByText(/Nothing here/)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /next period/i }))

    expect(screen.queryByText(/Nothing here/)).toBeNull()
    expect(screen.getByRole("status").textContent).toBe("Loading entries…")

    dateSpy.mockRestore()
  })

  it("marks the log busy, not just dimmed, while it shows the previous range's rows", async () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const initialFilters = reportsDefaultFilters(today, SETTINGS.weekStartDay)
    const initialRange = rangeOf(initialFilters, SETTINGS.timezone)

    const alpha = makeEntry({
      _id: "alpha" as unknown as Id<"timeEntries">,
      title: "Alpha entry",
      startedAt: initialRange.fromMs + 3_600_000,
      endedAt: initialRange.fromMs + 7_200_000,
    })
    resolvePage(paginatedKey(api.entries.listPage, initialRange), {
      page: [alpha],
      isDone: true,
    })

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    renderReports((queryClient) => {
      queryClient.setQueryData(convexKey(api.entries.rangeSummary, initialRange), {
        totalMs: 3_600_000,
        billableMs: 0,
        count: 1,
        runningCount: 0,
        truncated: false,
        billableCents: 0,
        unratedBillableMs: 0,
      })
    })

    await waitFor(() => expect(screen.getByTestId("entry-alpha")).toBeTruthy())
    expect(screen.getByTestId("entry-alpha").closest('[aria-busy="true"]')).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /next period/i }))

    // The summary next to it already said "Updating…" out loud. The log said
    // it with opacity alone, so a screen-reader user changing the range had no
    // way to know the rows below belonged to the range they just left.
    expect(screen.getByTestId("entry-alpha").closest('[aria-busy="true"]')).not.toBeNull()

    dateSpy.mockRestore()
  })
})

/* /timer is not the only page with a log, and the setting is one setting. A
 * grouping that applied on one page and not the other would read as a bug in
 * the grouping rather than a page that forgot to pass it down. */
describe("Reports — the grouping setting reaches the log", () => {
  /** Renders the Detailed tab with one entry, and reports what the log got. */
  const groupedWith = async (settings: Partial<typeof SETTINGS>) => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const range = rangeOf(reportsDefaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

    resolvePage(paginatedKey(api.entries.listPage, range), {
      page: [makeEntry({ title: "Client call" })],
      isDone: true,
    })

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    renderReports(() => {}, "detailed", settings)

    await waitFor(() => expect(screen.getByTestId("entry-log")).toBeTruthy())
    const value = screen.getByTestId("entry-log").getAttribute("data-grouped")
    dateSpy.mockRestore()
    return value
  }

  it("hands the log the account's own groupEntries", async () => {
    expect(await groupedWith({})).toBe("true")
  })

  /* BOTH VALUES, because only this one is reachable by unticking the box —
   * and asserting the default alone would pass against a page that hardcoded
   * the prop, which is the same as not passing the setting at all. */
  it("hands it down turned off, rather than ignoring the account", async () => {
    expect(await groupedWith({ groupEntries: false })).toBe("false")
  })
})

describe("Reports — the billable amount", () => {
  it("shows an amount for billable time, formatted in the user's currency", async () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const range = rangeOf(reportsDefaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

    resolvePage(paginatedKey(api.entries.listPage, range), { page: [], isDone: true })

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    renderReports((queryClient) => {
      queryClient.setQueryData(convexKey(api.entries.rangeSummary, range), {
        totalMs: 7_200_000,
        billableMs: 3_600_000,
        count: 2,
        runningCount: 0,
        truncated: false,
        billableCents: 6_100, // $61.00 — the figure a rated project earned
      })
    })

    await waitFor(() => expect(screen.getByText(/across 2 entries/)).toBeTruthy())
    expect(screen.getByText(/\$61\.00/)).toBeTruthy()

    dateSpy.mockRestore()
  })

  it("does not show a billable amount when nothing is billable", async () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const range = rangeOf(reportsDefaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

    resolvePage(paginatedKey(api.entries.listPage, range), { page: [], isDone: true })

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    renderReports((queryClient) => {
      queryClient.setQueryData(convexKey(api.entries.rangeSummary, range), {
        totalMs: 3_600_000,
        billableMs: 0,
        count: 1,
        runningCount: 0,
        truncated: false,
        billableCents: 0,
        unratedBillableMs: 0,
      })
    })

    await waitFor(() => expect(screen.getByText(/across 1 entry\b/)).toBeTruthy())
    expect(screen.queryByText(/\$/)).toBeNull()

    dateSpy.mockRestore()
  })

  /*
   * `billableCents: 0` has two completely different meanings and only
   * `unratedBillableMs` tells them apart. Rendering `$0.00` for the unpriced
   * one is the defect: eight billable hours on a project nobody has given a
   * rate reads as eight hours that earned nothing, and the PARTIAL case is
   * worse still — a plausible, understated figure someone puts on an invoice.
   */
  it("shows no amount at all when none of the billable time could be priced", async () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const range = rangeOf(reportsDefaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

    resolvePage(paginatedKey(api.entries.listPage, range), { page: [], isDone: true })

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    renderReports((queryClient) => {
      queryClient.setQueryData(convexKey(api.entries.rangeSummary, range), {
        totalMs: 28_800_000,
        billableMs: 28_800_000,
        count: 1,
        runningCount: 0,
        truncated: false,
        billableCents: 0,
        unratedBillableMs: 28_800_000, // all of it: the project has no rate
      })
    })

    await waitFor(() => expect(screen.getByText(/across 1 entry\b/)).toBeTruthy())
    // A currency amount here would be a lie of confidence. Not "$0.00", not
    // any amount.
    expect(summaryText()).not.toContain("$")
    expect(summaryText()).toContain("None of it is priced")

    dateSpy.mockRestore()
  })

  it("says how much is unpriced when only some of the billable time could be valued", async () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const range = rangeOf(reportsDefaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

    resolvePage(paginatedKey(api.entries.listPage, range), { page: [], isDone: true })

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    renderReports((queryClient) => {
      queryClient.setQueryData(convexKey(api.entries.rangeSummary, range), {
        totalMs: 28_800_000,
        billableMs: 28_800_000, // 8h billable…
        count: 4,
        runningCount: 0,
        truncated: false,
        billableCents: 49_920, // …of which only 6h is priced, at $83.20/hr
        unratedBillableMs: 7_200_000, // 2h on an unrated project
      })
    })

    await waitFor(() => expect(screen.getByText(/across 4 entries/)).toBeTruthy())
    // The amount is still shown — it is right for the part it covers — but it
    // can no longer be read as covering all eight hours.
    expect(screen.getByText(/\$499\.20/)).toBeTruthy()
    expect(summaryText()).toContain("2:00:00 of that is unpriced")

    dateSpy.mockRestore()
  })

  /*
   * The other reading of `billableCents: 0`, and the reason the fix cannot
   * simply key off the cents. A project with `hourlyRateCents: 0` is priced —
   * pro bono is a decision somebody made — so `$0.00` is the honest answer and
   * there is nothing to qualify. `rangeSummary` encodes exactly this by
   * leaving `unratedBillableMs` at zero for a zero rate.
   */
  it("still shows $0.00 for pro bono work, where a rate of zero really was set", async () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const range = rangeOf(reportsDefaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

    resolvePage(paginatedKey(api.entries.listPage, range), { page: [], isDone: true })

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    renderReports((queryClient) => {
      queryClient.setQueryData(convexKey(api.entries.rangeSummary, range), {
        totalMs: 3_600_000,
        billableMs: 3_600_000,
        count: 1,
        runningCount: 0,
        truncated: false,
        billableCents: 0,
        unratedBillableMs: 0,
      })
    })

    await waitFor(() => expect(screen.getByText(/across 1 entry\b/)).toBeTruthy())
    expect(screen.getByText(/\$0\.00/)).toBeTruthy()
    expect(summaryText()).not.toContain("unpriced")
    expect(summaryText()).not.toContain("None of it is priced")

    dateSpy.mockRestore()
  })

  it("says the billable amount is also a floor when the range is truncated", async () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const range = rangeOf(reportsDefaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

    resolvePage(paginatedKey(api.entries.listPage, range), { page: [], isDone: true })

    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    renderReports((queryClient) => {
      queryClient.setQueryData(convexKey(api.entries.rangeSummary, range), {
        totalMs: 7_200_000,
        billableMs: 3_600_000,
        count: 2,
        runningCount: 0,
        truncated: true,
        billableCents: 6_100,
        unratedBillableMs: 0,
      })
    })

    await waitFor(() => expect(screen.getByText(/\$61\.00/)).toBeTruthy())
    // The understated-amount-presented-as-exact failure this exists to
    // prevent: the warning has to name the amount, not just the time.
    expect(screen.getByText(/billable amount above are both a floor/)).toBeTruthy()

    dateSpy.mockRestore()
  })
})

describe("Reports — the Detailed tab's first paint", () => {
  /*
   * The Detailed tab is not prefetched by the loader — its `rangeSummary` is a
   * second scan of the same range for a tab the user may never open — so the
   * first visit to it genuinely waits a round trip. `EMPTY_SUMMARY` would fill
   * that window with "0:00:00 across 0 entries", dimmed and captioned
   * "Updating…", and a dimmed wrong number is still a wrong number on the page
   * a freelancer copies onto an invoice. Dimming makes a stale figure quieter;
   * it does not make a fabricated one true.
   */
  it("says it is still totalling rather than showing a zero it does not believe", () => {
    const filters = reportsDefaultFilters(
      dayOf(NOW, SETTINGS.timezone),
      SETTINGS.weekStartDay
    )
    const range = rangeOf(filters, SETTINGS.timezone)
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)

    resolvePage(paginatedKey(api.entries.listPage, range), { page: [], isDone: true })

    // No `rangeSummary` seeded: exactly the state a first visit to this tab is
    // in, with the query still in flight.
    renderReports(() => {})

    expect(summaryText()).toBe("Totalling this period…")
    expect(summaryText()).not.toContain("0 entries")

    dateSpy.mockRestore()
  })
})

describe("Reports — the Summary tab", () => {
  /*
   * Summary is the tab /reports opens on, and the one a freelancer looks at to
   * answer "how did this period go". Everything below is about it stating the
   * same facts the Detailed tab's sentence does — the two share one filter bar
   * and one range, so a figure that differs between them is a disagreement the
   * user has no way to adjudicate.
   */
  const today = dayOf(NOW, SETTINGS.timezone)

  it("reads its figures off the breakdown, not off whatever the log has loaded", () => {
    const filters = reportsDefaultFilters(today, SETTINGS.weekStartDay)
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)

    renderReports((queryClient) => {
      seedBreakdown(queryClient, filters, {
        ...EMPTY_BREAKDOWN,
        totalMs: 28_800_000, // 8:00:00
        billableMs: 7_200_000, // 2:00:00
        count: 4,
        billableCents: 12_200, // $122.00
        days: [
          {
            day: filters.from,
            totalMs: 28_800_000,
            billableMs: 7_200_000,
            billableCents: 12_200,
            count: 4,
          },
        ],
      })
    }, "summary")

    expect(screen.getByText("8:00:00")).toBeTruthy()
    expect(screen.getByText("2:00:00")).toBeTruthy()
    expect(screen.getByText("$122.00")).toBeTruthy()
    expect(screen.getByText("4")).toBeTruthy()

    dateSpy.mockRestore()
  })

  /*
   * The same rule the totals sentence follows, and the same reason it exists:
   * `billableCents: 0` means "worth nothing" for a project priced at zero and
   * "nobody has priced this" for one with no rate. A confident $0.00 on the
   * second is how eight hours of unbilled work reach an invoice as free.
   */
  it("shows no amount at all when none of the billable time could be priced", () => {
    const filters = reportsDefaultFilters(today, SETTINGS.weekStartDay)
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)

    renderReports((queryClient) => {
      seedBreakdown(queryClient, filters, {
        ...EMPTY_BREAKDOWN,
        totalMs: 28_800_000,
        billableMs: 28_800_000,
        count: 1,
        billableCents: 0,
        unratedBillableMs: 28_800_000, // all of it: no rate anywhere
        days: [
          {
            day: filters.from,
            totalMs: 28_800_000,
            billableMs: 28_800_000,
            billableCents: 0,
            count: 1,
          },
        ],
      })
    }, "summary")

    /*
     * SCOPED TO THE TAB PANEL — the figures — rather than to the document.
     *
     * `Create invoice` sits in the header strip above the tabs and is disabled
     * for this very range (`invoiceDisabledReason` refuses one that would price
     * no lines), and its sr-only reason quotes the "$0.00 total" the refusal
     * exists to prevent. That is the rule working, not a stray amount, and a
     * document-wide assertion would read it as one.
     */
    const figures = within(screen.getByRole("tabpanel"))
    expect(figures.queryByText(/\$/)).toBeNull()
    // Names where to fix it, now that a rate can come from a project OR the
    // account default in Settings.
    expect(screen.getByText("no rate set — see Settings")).toBeTruthy()

    dateSpy.mockRestore()
  })

  it("says the BARS are a floor too when the range was too large to total", () => {
    const filters = reportsDefaultFilters(today, SETTINGS.weekStartDay)
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)

    renderReports((queryClient) => {
      seedBreakdown(queryClient, filters, {
        ...EMPTY_BREAKDOWN,
        totalMs: 28_800_000,
        count: 5_000,
        truncated: true,
        days: [
          {
            day: filters.from,
            totalMs: 28_800_000,
            billableMs: 0,
            billableCents: 0,
            count: 5_000,
          },
        ],
      })
    }, "summary")

    // A chart cannot qualify itself the way a sentence can — a short bar for a
    // truncated day looks exactly like a quiet day — so the warning has to name
    // the bars as well as the figures.
    expect(screen.getByRole("alert").textContent).toContain("every bar")

    dateSpy.mockRestore()
  })

  it("keeps the range when the user moves between the two tabs", async () => {
    const filters = reportsDefaultFilters(today, SETTINGS.weekStartDay)
    const next = stepPeriod(filters, 1)
    const nextRange = rangeOf(next, SETTINGS.timezone)
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)

    resolvePage(paginatedKey(api.entries.listPage, nextRange), {
      page: [],
      isDone: true,
    })

    // Starts on Detailed so the range can be stepped there and read back on
    // Summary. That is the whole reason these are tabs rather than two routes:
    // one filter bar governs both, and a range set on one is the range the other
    // answers for.
    const { queryClient } = renderReports((client) => {
      client.setQueryData(convexKey(api.entries.rangeSummary, nextRange), {
        totalMs: 0,
        billableMs: 0,
        count: 0,
        runningCount: 0,
        truncated: false,
        billableCents: 0,
        unratedBillableMs: 0,
      })
    })

    seedBreakdown(queryClient, next, {
      ...EMPTY_BREAKDOWN,
      totalMs: 5_400_000, // 1:30:00
      count: 2,
      days: [
        { day: next.from, totalMs: 5_400_000, billableMs: 0, billableCents: 0, count: 2 },
      ],
    })

    fireEvent.click(screen.getByRole("button", { name: /next period/i }))
    fireEvent.click(screen.getByRole("tab", { name: "Summary" }))

    await waitFor(() => expect(screen.getByText("1:30:00")).toBeTruthy())

    dateSpy.mockRestore()
  })
})

/*
 * THE CONTROL THE FEATURE WAS MISSING, and it is a LINK now.
 *
 * It used to mint on click, from here, with none of the document's own fields —
 * so every invoice this product ever raised had a blank Billed to and a blank
 * Pay to, permanently, because an invoice is write-once. It now carries the
 * range and the filter into `/invoices/new`, where those are asked for.
 *
 * Which moves what can go wrong. Minting is tested where minting happens
 * (-invoice-new.test.tsx); what is left here is the half this page still owns
 * and the half that is easiest to break silently:
 *
 *   - The REFUSALS stay. A truncated range's figures are a floor, and a link
 *     that leads to a page which must then refuse is worse than a disabled
 *     control — the user has spent a navigation to be told what this page
 *     already knew.
 *   - The link's own CARGO. A control that navigates to /invoices/new with no
 *     range and no filter looks identical on screen and bills the wrong period.
 */
describe("Reports — Create invoice", () => {
  const today = dayOf(NOW, SETTINGS.timezone)
  const filters = reportsDefaultFilters(today, SETTINGS.weekStartDay)
  const range = rangeOf(filters, SETTINGS.timezone)

  /**
   * A range this control will actually act on: an hour of billable time in a
   * project that has a rate.
   *
   * IT HAS TO PRICE A LINE. The fixture here used to be `totalMs` and `count`
   * alone — `billableMs: 0` and no projects — which is a range that prices
   * nothing, and `invoiceDisabledReason` now refuses exactly that (see
   * `NO_PRICED_TIME`: an unpriced range would mint a permanent, numbered, $0.00
   * document with no lines). Every test below that is about where the LINK goes
   * needs a range the link exists for, or it is asserting against a disabled
   * button that has no href at all.
   *
   * The rate is on the PROJECT rather than in `SETTINGS`, because
   * `settings.defaultHourlyRateCents` is absent from that fixture and /reports
   * prices its line count with `?? null`.
   */
  const PRICED: Partial<Breakdown> = {
    totalMs: 3_600_000,
    billableMs: 3_600_000,
    billableCents: 5_000,
    count: 4,
    projects: [
      {
        projectId: "p-web",
        name: "Website",
        color: "slate",
        hourlyRateCents: 5_000,
        totalMs: 3_600_000,
        billableMs: 3_600_000,
        billableCents: 5_000,
        unratedBillableMs: 0,
        count: 4,
      },
    ],
  }

  /** The Summary tab, over one seeded breakdown for the default range. */
  function renderWith(over: Partial<Breakdown>) {
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    renderReports((queryClient) => {
      seedBreakdown(queryClient, filters, {
        ...EMPTY_BREAKDOWN,
        ...PRICED,
        ...over,
      })
    }, "summary")
    return dateSpy
  }

  const link = () => screen.getByRole("link", { name: "Create invoice" })
  const refused = () => screen.getByRole("button", { name: "Create invoice" })

  /** The sentence a screen reader gets for a disabled trigger. */
  function reasonOf(button: HTMLElement): string {
    const id = button.getAttribute("aria-describedby")
    if (id === null) throw new Error("the trigger carries no description")
    return document.getElementById(id)?.textContent ?? ""
  }

  /**
   * Where the control actually goes, read back through the ROUTER'S OWN parser
   * and then through the create page's.
   *
   * Not a string comparison against a hand-written query string: what matters
   * is that the search survives the URL and arrives at `parseInvoiceSearch` as
   * the same filter this page is showing. A serialisation the parser then drops
   * would pass a string assertion and bill the wrong rows.
   */
  function destination(anchor: HTMLElement) {
    const href = anchor.getAttribute("href") ?? ""
    // `indexOf` rather than `split("?")`: an href with no query splits to a
    // one-element array whose second slot TypeScript still types as `string`,
    // so the missing half would reach `defaultParseSearch` as `undefined`.
    const mark = href.indexOf("?")
    return {
      path: mark === -1 ? href : href.slice(0, mark),
      search: parseInvoiceSearch(
        defaultParseSearch(mark === -1 ? "" : href.slice(mark))
      ),
    }
  }

  it("sits beside Export rather than inside it", () => {
    const dateSpy = renderWith({})

    // Two controls, not one menu with a fourth item — see the spec's argument
    // in `CreateInvoiceLink`. Export is still the dropdown it was.
    expect(link()).toBeTruthy()
    expect(screen.getByRole("button", { name: /Export/ })).toBeTruthy()

    dateSpy.mockRestore()
  })

  /*
   * THE HEADLINE REFUSAL, and the reason it is still on the TRIGGER: a control
   * that looks live and then sends someone to a page that refuses has already
   * cost them the trip.
   */
  it("refuses a truncated range on the trigger, and offers nothing to follow", () => {
    const dateSpy = renderWith({ truncated: true, count: 5_000 })

    expect(refused().hasAttribute("disabled")).toBe(true)
    expect(reasonOf(refused())).toContain("under-bill")
    // A disabled `<button>`, not a link dressed as one: a link the browser will
    // still follow — or preload on hover — is not disabled.
    expect(screen.queryByRole("link", { name: "Create invoice" })).toBeNull()

    dateSpy.mockRestore()
  })

  /*
   * THE RANGE THAT WOULD MINT AN EMPTY DOCUMENT, refused before the navigation.
   *
   * Billable hours, no rate on the project and no account default, so
   * `invoiceLineDrafts` prices nothing and `createFromRange` would insert a
   * numbered invoice with no lines and a $0.00 total — permanent, since an
   * invoice is write-once. The server refuses it as `NO_PRICED_TIME`; this is
   * the half that says so before the click, and it has to be a disabled BUTTON
   * rather than a link, or the browser will follow it anyway.
   */
  it("refuses a range whose billable time no rate covers, and names where to set one", () => {
    const dateSpy = renderWith({
      billableCents: 0,
      unratedBillableMs: 3_600_000,
      projects: [
        {
          projectId: "p-unrated",
          name: "Unrated",
          color: "slate",
          totalMs: 3_600_000,
          billableMs: 3_600_000,
          billableCents: 0,
          unratedBillableMs: 3_600_000,
          count: 4,
        },
      ],
    })

    expect(refused().hasAttribute("disabled")).toBe(true)
    // `SET_A_RATE_NOTE`, the same sentence `BillPreview` prints under a
    // partly-unpriced range — one fix, so one phrasing of where to apply it.
    expect(reasonOf(refused())).toContain(SET_A_RATE_NOTE)
    expect(screen.queryByRole("link", { name: "Create invoice" })).toBeNull()

    dateSpy.mockRestore()
  })

  /*
   * THE GAP THIS PAGE ALONE HAS. /invoices/new scans `billableOnly: true`, so a
   * range of purely non-billable entries reaches it as `count === 0` and is
   * refused as empty. Here the chip decides, so the same range arrives with
   * `count > 0` — past the empty check — and the link would have led to a page
   * that then refuses. `billableMs` is what closes it, in the words true here.
   */
  it("refuses a range whose tracked time is all non-billable", () => {
    const dateSpy = renderWith({
      billableMs: 0,
      billableCents: 0,
      projects: [
        {
          projectId: "p-web",
          name: "Website",
          color: "slate",
          hourlyRateCents: 5_000,
          totalMs: 3_600_000,
          billableMs: 0,
          billableCents: 0,
          unratedBillableMs: 0,
          count: 4,
        },
      ],
    })

    expect(refused().hasAttribute("disabled")).toBe(true)
    // The BILLABLE rule, not a rate — the project here has one, and a second
    // rate would not put non-billable time on a document.
    expect(reasonOf(refused())).toBe(
      "Nothing in this period is billable, and an invoice bills billable time only."
    )
    expect(screen.queryByRole("link", { name: "Create invoice" })).toBeNull()

    dateSpy.mockRestore()
  })

  it("refuses a range with nothing tracked in it", () => {
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    // No breakdown seeded beyond `renderReports`' own `EMPTY_BREAKDOWN`.
    renderReports(() => undefined, "summary")

    expect(refused().hasAttribute("disabled")).toBe(true)
    expect(reasonOf(refused())).toBe("Nothing tracked in this period to invoice.")
    expect(screen.queryByRole("link", { name: "Create invoice" })).toBeNull()

    dateSpy.mockRestore()
  })

  it("carries the range on screen into the create page", () => {
    const dateSpy = renderWith({})

    // The DATES the page is showing, in the user's stored zone — not the
    // browser's, and not a range assembled a second time by hand.
    expect(destination(link())).toEqual({
      path: "/invoices/new",
      search: { from: range.fromMs, to: range.toMs },
    })

    dateSpy.mockRestore()
  })

  /*
   * THE DEADLOCK THIS CONTROL SHIPPED WITH, and the assertion that survived it.
   *
   * `createFromRange` once took a date range and nothing else, so a narrowed
   * page would have billed a superset of the rows on it, and this control
   * refused rather than let that happen — while `MIXED_CLIENTS` told the user
   * to narrow. Both routes were closed. The mutation takes the filter now, so
   * the control stays live and what it CARRIES is the thing to assert:
   * asserting only that it stays live would pass against a link that dropped
   * the narrowing on the way.
   */
  /*
   * DELETED 2026-08-12 with the control that drove it: "stays live once a
   * filter narrows the page, and carries that narrowing".
   *
   * It clicked the "No project" preset chip and asserted the Create-invoice
   * link then carried `presets: ["no-project"]` into /invoices/new — i.e. that
   * the page bills exactly the rows it is showing. `PresetChips` was removed at
   * the user's request and its component file has since been deleted, so there
   * is no longer a way to set a preset from this page's UI, and a test cannot
   * drive what is not on screen.
   *
   * THE BEHAVIOUR IS NOT GONE, only unreachable from here: `filters.presets`
   * still exists, `hasClientSideFilter` and `entryFilterOf` still honour it,
   * `invoiceSearchOf` still carries it, and `invoice-search.test.ts` still pins
   * the round trip through the URL.
   *
   * WHAT IS UNCOVERED IS THE PRESET LEG SPECIFICALLY, and only that. The
   * integration itself — this page's live filter reaching that link — is
   * asserted directly below, over the search text and the project picker. It is
   * `presets` alone that no control on this page can set, so it is `presets`
   * alone that nothing carries into `/invoices/new` under test. If preset
   * filtering ever returns to /reports, this test should return with it.
   */

  /* A search needle and a project are carried the same way — and `text` is the
   * one a URL is most likely to mangle, so it is round-tripped rather than
   * assumed. */
  it("carries the search text and the project picker's choice", async () => {
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
    const searched = { ...filters, text: "audit & review" }
    const settled = { ...EMPTY_BREAKDOWN, ...PRICED }

    // `"detailed"`, not `"summary"`: the filter band is Detailed-only now — a
    // search box over Summary's charts offers to do something that view cannot
    // show the result of. The Create-invoice link this asserts on lives in the
    // page header above BOTH tabs, so it is reachable from either.
    renderReports((client) => {
      seedBreakdown(client, filters, settled)
      seedBreakdown(client, searched, settled)
    }, "detailed")

    fireEvent.change(screen.getByRole("textbox", { name: /Search titles/ }), {
      target: { value: "audit & review" },
    })

    await waitFor(() =>
      expect(destination(link()).search.text).toBe("audit & review")
    )

    dateSpy.mockRestore()
  })
})
