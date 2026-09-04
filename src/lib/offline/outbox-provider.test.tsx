import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { OutboxProvider, useOutboxMutation } from "./outbox-provider"
import type * as ConvexReactModule from "convex/react"

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
