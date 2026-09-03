import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react"
import { useConvex, useConvexAuth } from "convex/react"
import { useQueryClient } from "@tanstack/react-query"
import { createOutbox } from "./create-outbox"
import type { ReactNode } from "react"
import type { Outbox, OutboxEvent } from "./outbox"
import type { ArgsOf, OpKindName, ResultOf } from "./op-kinds"
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
export function useOutboxMutation<TKind extends OpKindName>(kind: TKind) {
  const outbox = useOutbox()
  return useCallback(
    async (
      args: ArgsOf<TKind>,
      local?: OpLocal
    ): Promise<{ result: ResultOf<TKind> | undefined; settled: Promise<ResultOf<TKind>> }> => {
      const { result, settled } = await outbox.enqueue(kind, args, local)
      // `result` is `undefined` for a kind with no honest synchronous answer
      // — `entries.editTime` is the only one. `settled` always carries the
      // server's real result.
      return {
        result: result as ResultOf<TKind> | undefined,
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
