import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react"
import { useConvex, useConvexAuth } from "convex/react"
import { useQueryClient } from "@tanstack/react-query"
import { createOutbox } from "./create-outbox"
import type { ReactNode } from "react"
import type { Outbox, OutboxEvent } from "./outbox"
import type { ArgsOf, OP_KINDS, OpKindName, ResultOf } from "./op-kinds"
import type { OpLocal } from "./op-types"

const OutboxContext = createContext<Outbox | null>(null)

/**
 * Mounted once, under the authed layout: ops belong to a signed-in user, and
 * the drain needs a session. Loads the journal on mount and kicks the drain
 * whenever the socket connects, the browser comes online, or auth arrives.
 */
export function OutboxProvider({ children }: { children: ReactNode }) {
  const convex = useConvex()
  const queryClient = useQueryClient()
  const { isAuthenticated } = useConvexAuth()
  const outbox = useMemo(() => createOutbox(convex, queryClient), [convex, queryClient])

  useEffect(() => {
    void outbox.load()
    const kick = () => outbox.kick()
    const unsubscribe = convex.subscribeToConnectionState((state) => {
      if (state.isWebSocketConnected) kick()
    })
    window.addEventListener("online", kick)
    return () => {
      unsubscribe()
      window.removeEventListener("online", kick)
    }
  }, [outbox, convex])

  useEffect(() => {
    if (isAuthenticated) outbox.kick()
  }, [isAuthenticated, outbox])

  /*
   * `applyLocal` otherwise runs only at enqueue and once at boot — see
   * `Outbox.reapply`'s own docblock — so a query that MOUNTS later (a second
   * log page, a new date range, /reports) would resolve from its snapshot
   * with none of the pending ops applied. Watching the cache for newly-added
   * queries is how a later mount gets the same treatment as a query that was
   * already there at boot.
   *
   * Coalesced onto one microtask per burst — a render can add several
   * queries at once (a paginated subscription's several pages, a route with
   * more than one query) — rather than calling `reapply` once per event.
   */
  useEffect(() => {
    const cache = queryClient.getQueryCache()
    let scheduled = false
    const schedule = () => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        if (outbox.pending() > 0) void outbox.reapply()
      })
    }
    const unsubscribe = cache.subscribe((event) => {
      // `added` alone is not enough, and on its own it is very nearly a no-op:
      // at the moment a query is ADDED its `state.data` is still `undefined`,
      // and every writer in the optimistic layer skips undefined
      // (`patchEverywhere`, `dropEverywhere`, `insertEverywhere` all `continue`
      // on it). The snapshot then arrives asynchronously from IndexedDB and is
      // written UNPATCHED, with nothing left to re-run the ops over it. It is
      // kept only for the case it does cover: a query added with data already
      // in hand.
      if (event.type === "added") return schedule()
      //
      // `!manual` is a precise test for "a queryFn just resolved" — NOT a
      // re-entrancy hack, so please do not delete it as one. In
      // @tanstack/query-core, `queryClient.setQueryData` always calls
      // `query.setData(data, { ...options, manual: true })`, and `setData` is
      // the single site that dispatches `{ type: "success", manual }`. The
      // fetch-resolution path calls `setData(data)` with no options, so a real
      // queryFn resolution — and only that — carries `manual: undefined`.
      //
      // That is exactly the event this needs: the snapshot arriving
      // (`snapshotQueryFn` returns the snapshot AS the queryFn's value) and the
      // first online resolution. It excludes reapply's OWN writes, which go
      // through `setQueryData` and so are `manual: true`, and it excludes
      // @convex-dev/react-query's socket pushes, which also go through
      // `setQueryData`. So reapply cannot retrigger itself: the loop is not
      // guarded against, it is unreachable.
      if (event.type === "updated" && event.action.type === "success" && !event.action.manual) {
        schedule()
      }
    })
    return unsubscribe
  }, [queryClient, outbox])

  return <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>
}

export function useOutbox(): Outbox {
  const outbox = useContext(OutboxContext)
  if (outbox === null) throw new Error("useOutbox must be used under <OutboxProvider>")
  return outbox
}

/**
 * The replacement for `useConvexMutation(ref).withOptimisticUpdate(fn)`.
 *
 * Stable across renders (so no `useLatest`), resolves as soon as the op is
 * journaled, and never rejects — refusals arrive through `useOutboxEvents`.
 * `settled` is the server's eventual answer for the callers that need it
 * (`start` records `serverNow` from it).
 */
/**
 * What `result` is for a given kind — the kind's own result, or `undefined`
 * when it declares no `immediate`.
 *
 * Conditional rather than a blanket `| undefined`, and that is the whole
 * point: `kind()` deliberately keeps `immediate` out of its widening `Pick`,
 * so a kind that omits it genuinely lacks the key on its literal type and
 * this discriminates. A blanket union would push every caller to a `!`, and
 * a `!` is a lie waiting to happen — removing an `immediate` (which is
 * exactly what `entries.editTime` did) would leave four call sites compiling
 * and one of them throwing inside a click handler. This way that same
 * removal is four compile errors.
 */
type ImmediateOf<TKind extends OpKindName> = "immediate" extends keyof (typeof OP_KINDS)[TKind]
  ? ResultOf<TKind>
  : undefined

export function useOutboxMutation<TKind extends OpKindName>(kind: TKind) {
  const outbox = useOutbox()
  return useCallback(
    async (args: ArgsOf<TKind>, local?: OpLocal) => {
      const { result, settled } = await outbox.enqueue(kind, args, local)
      return {
        result: result as ImmediateOf<TKind>,
        settled: settled as Promise<ResultOf<TKind>>,
      }
    },
    [outbox, kind]
  )
}

export function usePendingCount(): number {
  const outbox = useOutbox()
  return useSyncExternalStore(
    (onChange) => outbox.subscribe((e) => e.type === "changed" && onChange()),
    () => outbox.pending(),
    () => 0
  )
}

export function useOutboxEvents(listener: (event: OutboxEvent) => void): void {
  const outbox = useOutbox()
  useEffect(() => outbox.subscribe(listener), [outbox, listener])
}
