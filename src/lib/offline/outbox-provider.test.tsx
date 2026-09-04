import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { OutboxProvider, useOutboxMutation } from "./outbox-provider"
import { TanStackLocalStore } from "./tanstack-local-store"
import { patchEverywhere } from "./optimistic-entries"
import type * as ConvexReactModule from "convex/react"
import type { Id } from "../../../convex/_generated/dataModel"

type ConvexReact = typeof ConvexReactModule

/**
 * `useOutboxMutation`'s whole reason for existing over
 * `useConvexMutation(ref).withOptimisticUpdate(fn)` is that its returned
 * callback is STABLE across renders — no `useLatest` wrapper needed. That is
 * what lets `timer-bar.tsx`'s debounce effect list it as a dependency without
 * re-arming on every keystroke. Nothing exercised that promise before this.
 *
 * `createOutbox` is mocked to a fixed fake instance rather than driven through
 * a real Convex client: the property under test is `useCallback`'s dependency
 * behaviour inside `useOutboxMutation`, not the outbox engine itself (Task 6
 * already covers that) or the wiring in `createOutbox` (covered elsewhere).
 */

const { fakeOutbox } = vi.hoisted(() => ({
  fakeOutbox: {
    load: async () => undefined,
    kick: () => undefined,
    subscribe: () => () => undefined,
    pending: (): number => 0,
    enqueue: async () => ({ result: undefined, settled: Promise.resolve(undefined) }),
    reapply: async () => undefined,
  },
}))

vi.mock("./create-outbox", () => ({
  createOutbox: () => fakeOutbox,
}))

vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<ConvexReact>()
  return {
    ...actual,
    useConvex: () => ({ subscribeToConnectionState: () => () => undefined }),
    useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
  }
})

afterEach(() => cleanup())

describe("useOutboxMutation", () => {
  it("returns a referentially stable callback across renders", () => {
    const seen: Array<unknown> = []
    function Probe() {
      const setTitle = useOutboxMutation("entries.setTitle")
      seen.push(setTitle)
      return null
    }

    const queryClient = new QueryClient()
    const renderTree = () => (
      <QueryClientProvider client={queryClient}>
        <OutboxProvider>
          <Probe />
        </OutboxProvider>
      </QueryClientProvider>
    )

    const { rerender } = render(renderTree())
    rerender(renderTree())

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
  })
})

describe("OutboxProvider reapply on late-mounting queries", () => {
  /*
   * `applyLocal` otherwise runs only at enqueue and once at boot — so a
   * query that mounts later (a second log page, a new date range,
   * /reports) resolves from its snapshot with none of the pending ops
   * applied, and the status line then promises changes the page in front
   * of the user contradicts. This proves the provider itself notices a
   * newly-added query and calls `reapply()` while ops are pending.
   */
  it("calls reapply() when a query is added to the cache while ops are pending", async () => {
    const calls: number[] = []
    fakeOutbox.pending = () => 1
    fakeOutbox.reapply = async () => {
      calls.push(1)
    }

    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <OutboxProvider>
          <div />
        </OutboxProvider>
      </QueryClientProvider>
    )

    queryClient.getQueryCache().build(queryClient, {
      queryKey: ["convexQuery", "entries:listPage", { fromMs: 0, toMs: 1 }],
    })

    // Coalesced onto a microtask/short timeout, not called synchronously.
    await new Promise((r) => setTimeout(r, 0))

    expect(calls.length).toBeGreaterThan(0)

    // Reset shared fake state so it does not leak into later tests.
    fakeOutbox.pending = () => 0
    fakeOutbox.reapply = async () => undefined
  })

  it("does not call reapply() when no ops are pending", async () => {
    const calls: number[] = []
    fakeOutbox.pending = () => 0
    fakeOutbox.reapply = async () => {
      calls.push(1)
    }

    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <OutboxProvider>
          <div />
        </OutboxProvider>
      </QueryClientProvider>
    )

    queryClient.getQueryCache().build(queryClient, {
      queryKey: ["convexQuery", "entries:listPage", { fromMs: 0, toMs: 1 }],
    })

    await new Promise((r) => setTimeout(r, 0))

    expect(calls).toHaveLength(0)
  })
})

/**
 * The behaviour test the wiring test above could not give.
 *
 * `reapply()` being CALLED proves nothing: the `added` event fires while the
 * new query's `state.data` is still `undefined`, and every writer in the
 * optimistic layer skips undefined (`patchEverywhere:92,106`,
 * `dropEverywhere:129,135`, `insertEverywhere:207`). So the call lands on a
 * query with nothing in it to patch, the snapshot then arrives asynchronously
 * from IndexedDB, and it is written UNPATCHED. This asserts the query's final
 * `data` instead — the only thing that distinguishes the two.
 *
 * The reapply here is the real `patchEverywhere` over a real
 * `TanStackLocalStore`, not a spy, so the undefined-skip that causes the bug
 * is genuinely in the path under test.
 */
describe("OutboxProvider reapply after a late query's data actually arrives", () => {
  it("patches a late-mounting query whose queryFn resolves asynchronously", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    const store = new TanStackLocalStore(queryClient)

    fakeOutbox.pending = () => 1
    fakeOutbox.reapply = async () => {
      patchEverywhere(store, "e1" as Id<"timeEntries">, (entry) => ({
        ...entry,
        title: "patched",
      }))
    }

    render(
      <QueryClientProvider client={queryClient}>
        <OutboxProvider>
          <div />
        </OutboxProvider>
      </QueryClientProvider>
    )

    // Mounts AFTER the provider is watching, and resolves its data on a later
    // turn of the loop — the snapshot arriving from IndexedDB, in miniature.
    const key = ["convexQuery", "entries:listRange", { fromMs: 0, toMs: 4_000_000_000_000 }]
    await queryClient.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return [
          {
            _id: "e1",
            _creationTime: 1_000,
            userId: "u",
            clientKey: "c1",
            title: "old title",
            startedAt: 1_000,
            endedAt: 2_000,
            durationMs: 1_000,
            tagIds: [],
            billable: false,
            source: "web",
            updatedAt: 2_000,
            deletedAt: null,
          },
        ]
      },
    })

    await new Promise((r) => setTimeout(r, 0))

    const rows = queryClient.getQueryData<Array<{ title: string }>>(key)!
    expect(rows[0].title).toBe("patched")

    fakeOutbox.pending = () => 0
    fakeOutbox.reapply = async () => undefined
  })
})

/**
 * The claim the `!manual` predicate rests on, pinned.
 *
 * The reviewer's objection to subscribing to `updated` was that reapply's own
 * writes would retrigger it forever. They cannot: reapply writes through
 * `setQueryData`, which query-core stamps `manual: true`, and this subscription
 * ignores those. If someone later switches reapply to a write path that does
 * NOT set `manual` — or drops the predicate — this test runs away and fails
 * instead of shipping a hot loop into a browser.
 */
describe("OutboxProvider reapply does not retrigger itself", () => {
  it("settles after a bounded number of reapply rounds", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    })
    const store = new TanStackLocalStore(queryClient)

    let calls = 0
    fakeOutbox.pending = () => 1
    fakeOutbox.reapply = async () => {
      calls += 1
      if (calls > 20) throw new Error("reapply looped")
      // Writes a key that is not yet in the cache, which is the shape most
      // likely to loop: it emits `added` as well as `success`.
      patchEverywhere(store, "e1" as Id<"timeEntries">, (entry) => ({
        ...entry,
        title: `patched-${calls}`,
      }))
      queryClient.setQueryData(["convexQuery", "entries:getRunning", {}], null)
    }

    render(
      <QueryClientProvider client={queryClient}>
        <OutboxProvider>
          <div />
        </OutboxProvider>
      </QueryClientProvider>
    )

    const key = ["convexQuery", "entries:listRange", { fromMs: 0, toMs: 10 }]
    await queryClient.fetchQuery({
      queryKey: key,
      queryFn: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return []
      },
    })
    await new Promise((r) => setTimeout(r, 20))

    expect(calls).toBeLessThanOrEqual(4)
    expect(calls).toBeGreaterThan(0)

    fakeOutbox.pending = () => 0
    fakeOutbox.reapply = async () => undefined
  })
})
