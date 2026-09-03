import { useSyncExternalStore } from "react"
import { getFunctionName } from "convex/server"

type FunctionRef = Parameters<typeof getFunctionName>[0]

/**
 * The TanStack Query key `convexQuery` mints for a Convex query — what a test
 * seeds with `queryClient.setQueryData` so a `useSuspenseQuery` never
 * suspends.
 */
export function convexKey(fn: FunctionRef, args: unknown) {
  return ["convexQuery", getFunctionName(fn), args] as const
}

/** The key `resolvePage` files a page under, and the double looks it up by. */
export function paginatedKey(fn: FunctionRef, args: unknown): string {
  return `${getFunctionName(fn)}:${JSON.stringify(args)}`
}

type Page = { page: Array<unknown>; isDone: boolean }

const store = new Map<string, Page>()
const listeners = new Map<string, Set<() => void>>()

/** Makes a page "arrive" for one (query, args) pair. */
export function resolvePage(key: string, value: Page) {
  store.set(key, value)
  listeners.get(key)?.forEach((notify) => notify())
}

/**
 * Module state, so a page resolved for one test's range would otherwise leak
 * into the next test's identical-looking key. Call from `beforeEach`.
 */
export function resetPaginatedStore() {
  store.clear()
  listeners.clear()
}

/**
 * A stand-in for `usePaginatedQuery` from "convex/react", which reads and
 * writes a subscription a component test does not have — there is no real
 * `ConvexReactClient` behind these renders.
 *
 * It reproduces exactly the one behaviour the fix in -reports.tsx depends on:
 * the REAL hook resets `results` to `[]` and `status` to "LoadingFirstPage"
 * the instant its args (the query key) change, synchronously, before the new
 * first page round-trips — see
 * `node_modules/convex/dist/esm/react/use_paginated_query.js`. Keyed by
 * (function name, args) through a tiny external store, so a test controls
 * exactly when a page arrives.
 *
 * Shared rather than copied because that reproduction is the whole point:
 * `-reports.tsx`'s `settledPageRef` exists to defeat it, and two copies of the
 * double would let a Convex upgrade that changes the reset leave one test
 * green over a broken page.
 *
 * `vi.mock` is hoisted and its factory may not close over anything in the test
 * file, so each caller keeps its own one-line `vi.mock("convex/react", …)` and
 * pulls this in with a dynamic `import` from inside the factory.
 */
export function usePaginatedQueryDouble(query: unknown, args: unknown) {
  const key = paginatedKey(query as FunctionRef, args)
  const snapshot = useSyncExternalStore(
    (onStoreChange) => {
      const set = listeners.get(key) ?? new Set<() => void>()
      listeners.set(key, set)
      set.add(onStoreChange)
      return () => set.delete(onStoreChange)
    },
    () => store.get(key)
  )
  if (snapshot === undefined) {
    return { results: [], status: "LoadingFirstPage" as const, loadMore: () => {} }
  }
  const status: "Exhausted" | "CanLoadMore" = snapshot.isDone
    ? "Exhausted"
    : "CanLoadMore"
  return { results: snapshot.page, status, loadMore: () => {} }
}

// ---------------------------------------------------------------------------

/**
 * Module state behind `useConvexConnectionStateDouble`, below. A `let` rather
 * than a `useState` inside the double itself: the double is a plain function
 * called from inside components under test, not a hook with state of its own
 * to manage, and a test flips it with `setConnectionOnline` from OUTSIDE the
 * render it is about to affect — before calling `render`, exactly like seeding
 * the query client before it.
 */
let connectionOnline = true

/** Flips the double's answer. Call before `render`, not from inside an act(). */
export function setConnectionOnline(next: boolean): void {
  connectionOnline = next
}

/** Back to "online", so one test's offline case cannot leak into the next.
 *  Call from `afterEach`. */
export function resetConnectionOnline(): void {
  connectionOnline = true
}

/**
 * A stand-in for `useConvexConnectionState` from "convex/react" — there is no
 * real `ConvexReactClient` behind these page-fragment renders (the same gap
 * `usePaginatedQueryDouble` above exists for), so the real hook throws: it
 * reads its client from context.
 *
 * The shape matches what `isOffline` (src/lib/offline/online.ts) actually
 * branches on. "Online" is a socket that is connected and has never dropped;
 * "offline" is one that dropped once and has not reconnected — the
 * `hasEverConnected: true, connectionRetries: 1` combination `isOffline`
 * treats as offline on its first failed retry, which is the case a "you're
 * offline" test wants, not the two-tries-from-cold grace `isOffline` gives a
 * socket that never connected at all.
 */
export function useConvexConnectionStateDouble() {
  return connectionOnline
    ? { isWebSocketConnected: true, hasEverConnected: true, connectionRetries: 0 }
    : { isWebSocketConnected: false, hasEverConnected: true, connectionRetries: 1 }
}
