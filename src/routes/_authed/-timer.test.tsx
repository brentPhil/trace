import { useEffect } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { getFunctionName } from "convex/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Timer } from "@/routes/_authed/timer"
import { dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type * as ConvexReactModuleType from "convex/react"
import type * as UseClockModuleType from "@/hooks/use-clock"

type ConvexReactModule = typeof ConvexReactModuleType
type UseClockModule = typeof UseClockModuleType

/*
 * Timer's own composition, at the route level.
 *
 * The riskiest thing on this page is not any one leaf component — it is the
 * three-way branch between "still loading", "a filter matched nothing" and
 * "the log". Every part of it was previously tested only one component down,
 * where the branch itself does not exist.
 *
 * THE REGRESSION THIS FILE EXISTS FOR: the middle branch used to render
 * `null` in place of `EntryLog`. `EntryLog` owns `NoteSheet`, and `NoteSheet`
 * owns `draftsRef` — the in-memory copy of a note whose save is still in
 * flight or has failed. So any keystroke in the search box that dropped the
 * match count to zero unmounted the log and destroyed every held draft,
 * flatly contradicting what note-sheet.tsx promises for exactly that case.
 *
 * The leading `-` in the filename keeps TanStack Router's file-based route
 * generation from treating this as a route (see `-reports.test.tsx`).
 */

const { logLifecycle, NOW } = vi.hoisted(() => ({
  logLifecycle: { mounts: 0, unmounts: 0 },
  // A Wednesday, mid-week.
  NOW: Date.parse("2026-08-05T12:00:00.000Z"),
}))

/*
 * `useSecond` reads a module-level clock store that starts ticking at import,
 * so it is already holding a real second by the time any `Date.now` spy is
 * installed — and Timer derives `today`, and therefore its whole query key,
 * from it. Pinning the hook is the only way to make that key predictable.
 */
vi.mock("@/hooks/use-clock", async (importOriginal) => ({
  ...(await importOriginal<UseClockModule>()),
  useSecond: () => Math.floor(NOW / 1000),
}))

/*
 * `EntryLog` stands in as a mount-counting stub. What matters here is not what
 * it draws but WHETHER IT STAYS MOUNTED, because that is what decides whether
 * the state it owns survives a filter keystroke. The real component drags in
 * four mutation hooks, a toast manager and a dialog, none of which this branch
 * depends on.
 */
vi.mock("@/components/entries/entry-log", () => ({
  EntryLog: ({ groups }: { groups: Array<{ day: string }> }) => {
    useEffect(() => {
      logLifecycle.mounts += 1
      return () => {
        logLifecycle.unmounts += 1
      }
    }, [])
    return <div data-testid="entry-log">{groups.length} day groups</div>
  },
}))

/* Reaches for `useConvexMutation`, which needs a real Convex client. Timer
 * only threads these through as props; nothing here presses any of them. */
vi.mock("@/hooks/use-entry-edit-mutations", () => ({
  useEntryEditMutations: () => ({ create: vi.fn(async () => {}) }),
}))

vi.mock("@/components/entries/manual-entry-dialog", () => ({
  ManualEntryDialog: () => <button type="button">Add entry</button>,
}))

/* The same hand-driven `usePaginatedQuery` double `-reports.test.tsx` uses:
 * the real hook wants a subscription this test does not have, and the branch
 * under test keys off its `status`. */
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

const SETTINGS = {
  timezone: "UTC",
  weekStartDay: 1,
  durationDisplay: "hms" as const,
  timeFormat: "24" as const,
  runawayThresholdMs: 8 * 60 * 60 * 1000,
  tabTitleClock: false,
  currency: "USD",
}

let dateSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  paginatedStore.clear()
  paginatedListeners.clear()
  logLifecycle.mounts = 0
  logLifecycle.unmounts = 0
  dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
})

afterEach(() => {
  cleanup()
  dateSpy?.mockRestore()
})

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

const today = dayOf(NOW, SETTINGS.timezone)
const week = weekWindow(today, SETTINGS.timezone, SETTINGS.weekStartDay)
const logRange = { fromMs: 0, toMs: dayWindow(today, SETTINGS.timezone).toMs }

/** Everything Timer reads with `useSuspenseQuery`, so it never suspends. */
function renderTimer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(convexKey(api.settings.get, {}), SETTINGS)
  queryClient.setQueryData(convexKey(api.projects.list, {}), [])
  queryClient.setQueryData(convexKey(api.tags.list, {}), [])
  queryClient.setQueryData(
    convexKey(api.entries.listRange, { fromMs: week.fromMs, toMs: week.toMs }),
    []
  )
  render(
    <QueryClientProvider client={queryClient}>
      <Timer />
    </QueryClientProvider>
  )
}

const search = () =>
  screen.getByPlaceholderText<HTMLInputElement>("Search titles, notes and projects")

describe("Timer — filtering to nothing", () => {
  it("keeps EntryLog mounted, so the drafts it holds survive the keystroke", () => {
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call" })],
      isDone: true,
    })
    renderTimer()

    expect(screen.getByTestId("entry-log")).toBeTruthy()
    expect(logLifecycle.mounts).toBe(1)

    // A search that matches nothing already loaded.
    fireEvent.change(search(), { target: { value: "zzzz" } })

    expect(screen.getByText("No entries match these filters.")).toBeTruthy()
    // THE ASSERTION. Before the fix this was 1: the log was replaced with
    // `null`, taking NoteSheet's `draftsRef` with it.
    expect(logLifecycle.unmounts).toBe(0)
    expect(logLifecycle.mounts).toBe(1)
  })

  it("does not fall back to the log's onboarding copy while a filter is active", () => {
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call" })],
      isDone: true,
    })
    renderTimer()

    fireEvent.change(search(), { target: { value: "zzzz" } })

    // `empty={null}` is what buys this: the log renders, and draws nothing,
    // rather than inheriting DayList's "an empty log means a new account".
    expect(screen.queryByText("Nothing tracked yet.")).toBeNull()
  })

  it("shows the skeleton, not an empty state, while the first page is in flight", () => {
    renderTimer() // no page resolved: status stays LoadingFirstPage

    expect(screen.queryByTestId("entry-log")).toBeNull()
    expect(screen.queryByText("Nothing tracked yet.")).toBeNull()
    // …and it is not silent: the skeleton is the only thing on screen here.
    expect(screen.getByRole("status").textContent).toBe("Loading entries…")
  })

  it("distinguishes 'no matches yet' from 'no matches' by whether pages remain", () => {
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call" })],
      isDone: false, // more history behind this page
    })
    renderTimer()

    fireEvent.change(search(), { target: { value: "zzzz" } })

    expect(screen.getByText("No matches in the entries loaded so far.")).toBeTruthy()
    expect(screen.queryByText("No entries match these filters.")).toBeNull()
  })
})
