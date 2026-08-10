import { Suspense } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getFunctionName } from "convex/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Reports } from "@/routes/_authed/reports"
import { defaultFilters, rangeOf, stepPeriod } from "@/lib/history-filters"
import {
  convexKey,
  paginatedKey,
  resetPaginatedStore,
  resolvePage,
} from "@/test-utils/convex-query"
import { NOW, SETTINGS, makeEntry } from "@/test-utils/fixtures"
import { dayOf } from "@shared/day"
import { api } from "../../../convex/_generated/api"
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
 * component (FilterBar, the log, everything) up to the nearest Suspense
 * boundary. `usePaginatedQuery`'s own args-changed reset had the same
 * consequence for the log itself, one level down (see reports.tsx's
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
 * not the router. `createFileRoute` and everything else stay real:
 * reports.tsx calls `createFileRoute` at module scope, and stubbing the whole
 * module would hide a genuine route-definition error behind a test double.
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

vi.mock("@/components/entries/entry-log", () => ({
  EntryLog: ({
    groups,
    empty,
  }: {
    groups: Array<{ day: string; label: string; entries: Array<{ _id: string; title: string }> }>
    empty?: React.ReactNode
  }) => {
    if (groups.length === 0) return <>{empty ?? null}</>
    return (
      <div data-testid="entry-log">
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
 * the fix in reports.tsx depends on: the REAL hook resets `results` to `[]`
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

function seedStable(queryClient: QueryClient) {
  queryClient.setQueryData(convexKey(api.settings.get, {}), SETTINGS)
  queryClient.setQueryData(convexKey(api.projects.list, {}), [])
  queryClient.setQueryData(convexKey(api.tags.list, {}), [])
}

/**
 * `seedInitialSummary` runs BEFORE `render` — matching how the real loader's
 * `ensureQueryData` populates the cache before the route component ever
 * mounts (see reports.tsx's `loader`). Seeding it after render instead would
 * hide a real `useSuspenseQuery` regression behind a DIFFERENT one (an
 * unseeded query suspending on the very first paint) rather than isolating
 * the one this file is actually about: a RANGE CHANGE suspending.
 */
function renderReports(seedInitialSummary: (queryClient: QueryClient) => void) {
  const { queryClient, resolveSummary } = createQueryClient()
  seedStable(queryClient)
  seedInitialSummary(queryClient)
  render(
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  )
  return { queryClient, resolveSummary }
}

describe("Reports — changing the range", () => {
  it("keeps the previous rows on screen while the new range's query is in flight", async () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const initialFilters = defaultFilters(today, SETTINGS.weekStartDay)
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
    const initialFilters = defaultFilters(today, SETTINGS.weekStartDay)
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
    const initialFilters = defaultFilters(today, SETTINGS.weekStartDay)
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
    const initialFilters = defaultFilters(today, SETTINGS.weekStartDay)
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

describe("Reports — the billable amount", () => {
  it("shows an amount for billable time, formatted in the user's currency", async () => {
    const today = dayOf(NOW, SETTINGS.timezone)
    const range = rangeOf(defaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

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
    const range = rangeOf(defaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

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
    const range = rangeOf(defaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

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
    const range = rangeOf(defaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

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
    const range = rangeOf(defaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

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
    const range = rangeOf(defaultFilters(today, SETTINGS.weekStartDay), SETTINGS.timezone)

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
