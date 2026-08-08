import { Suspense } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getFunctionName } from "convex/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Reports } from "@/routes/_authed/reports"
import { defaultFilters, rangeOf, stepPeriod } from "@/lib/history-filters"
import { dayOf } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type * as ConvexReactModuleType from "convex/react"

type ConvexReactModule = typeof ConvexReactModuleType

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
 * this test does not have — there is no real `ConvexReactClient` here. This
 * fake reproduces exactly the one behaviour the fix in reports.tsx depends
 * on: the REAL hook resets `results` to `[]` and `status` to
 * "LoadingFirstPage" the instant its args (the query key) change,
 * synchronously, before the new first page round-trips — see
 * `node_modules/convex/dist/esm/react/use_paginated_query.js`. Keyed by
 * (function name, args) via a tiny external store, so the test controls
 * exactly when a page "arrives" with `resolvePage`.
 */
const { paginatedStore, paginatedListeners, resolvePage } = vi.hoisted(() => {
  const store = new Map<string, { page: unknown[]; isDone: boolean }>()
  const listeners = new Map<string, Set<() => void>>()
  return {
    paginatedStore: store,
    paginatedListeners: listeners,
    resolvePage: (key: string, value: { page: unknown[]; isDone: boolean }) => {
      store.set(key, value)
      listeners.get(key)?.forEach((notify) => notify())
    },
  }
})

vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<ConvexReactModule>()
  const { getFunctionName: fnName } = await import("convex/server")
  const { useSyncExternalStore } = await import("react")

  return {
    ...actual,
    usePaginatedQuery: (query: unknown, args: unknown) => {
      const key = `${fnName(query as Parameters<typeof fnName>[0])}:${JSON.stringify(args)}`
      const snapshot = useSyncExternalStore(
        (onStoreChange) => {
          let set = paginatedListeners.get(key)
          if (!set) {
            set = new Set()
            paginatedListeners.set(key, set)
          }
          set.add(onStoreChange)
          return () => set.delete(onStoreChange)
        },
        () => paginatedStore.get(key)
      )
      if (snapshot === undefined) {
        return { results: [], status: "LoadingFirstPage" as const, loadMore: () => {} }
      }
      const status: "Exhausted" | "CanLoadMore" = snapshot.isDone
        ? "Exhausted"
        : "CanLoadMore"
      return { results: snapshot.page, status, loadMore: () => {} }
    },
  }
})

beforeEach(() => {
  // `usePaginatedQuery`'s pagination ids and this fake store are both module
  // state that would otherwise leak a resolved page from one test's range
  // into the next test's identical-looking key.
  paginatedStore.clear()
  paginatedListeners.clear()
})

afterEach(cleanup)

const NOW = Date.parse("2026-08-05T12:00:00.000Z") // a Wednesday, mid-week
const SETTINGS = {
  timezone: "UTC",
  weekStartDay: 1,
  durationDisplay: "hms" as const,
  timeFormat: "24" as const,
  runawayThresholdMs: 8 * 60 * 60 * 1000,
  tabTitleClock: false,
}

function makeEntry(overrides: Partial<Doc<"timeEntries">>): Doc<"timeEntries"> {
  return {
    _id: "entry" as unknown as Id<"timeEntries">,
    _creationTime: NOW,
    userId: "user-1",
    clientKey: "client-1",
    title: "Untitled entry",
    note: undefined,
    startedAt: NOW,
    endedAt: NOW + 3_600_000,
    durationMs: 3_600_000,
    projectId: undefined,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  }
}

function convexKey(fn: Parameters<typeof getFunctionName>[0], args: unknown) {
  return ["convexQuery", getFunctionName(fn), args] as const
}

function paginatedKey(fn: Parameters<typeof getFunctionName>[0], args: unknown) {
  return `${getFunctionName(fn)}:${JSON.stringify(args)}`
}

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

type Summary = {
  totalMs: number
  billableMs: number
  count: number
  runningCount: number
  truncated: boolean
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
    })

    await waitFor(() => expect(screen.getByText(/across 5 entries/)).toBeTruthy())
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    expect(screen.queryByText(/Updating…/)).toBeNull()

    dateSpy.mockRestore()
  })
})
