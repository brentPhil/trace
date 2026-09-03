import { Outbox } from "./outbox"
import { OP_KINDS } from "./op-kinds"
import { createOutboxStore } from "./outbox-store-idb"
import { isRetryableRejection } from "./rejections"
import { TanStackLocalStore } from "./tanstack-local-store"
import { webLock } from "./web-lock"
import type { ConvexReactClient } from "convex/react"
import type { QueryClient } from "@tanstack/react-query"
import type { OpKind } from "./op-types"

/**
 * The one place the outbox meets Convex and TanStack.
 *
 * `send` is `convexClient.mutation` with the kind's optimistic function as
 * Convex's own `optimisticUpdate`; `applyLocal` is the same function against
 * the TanStack adapter. Same function, two stores — see the adapter's note.
 */
export function createOutbox(convexClient: ConvexReactClient, queryClient: QueryClient): Outbox {
  const adapter = new TanStackLocalStore(queryClient)
  const kinds = OP_KINDS as unknown as Record<string, OpKind<any, any>>
  return new Outbox({
    store: createOutboxStore(),
    kinds,
    send: (op, args) => {
      const def = kinds[op.kind]
      const optimistic = def.optimistic
      return convexClient.mutation(
        def.ref,
        args,
        optimistic === undefined
          ? {}
          : { optimisticUpdate: (store) => optimistic(store, args, op.local) }
      )
    },
    applyLocal: (op) => {
      const def = kinds[op.kind]
      try {
        def.optimistic?.(adapter, op.args, op.local)
      } catch {
        // A patch against a cache shape that has since changed must never
        // stop the boot. The server's answer is on its way regardless.
      }
    },
    retryable: isRetryableRejection,
    lock: webLock("chroneli-outbox"),
  })
}
