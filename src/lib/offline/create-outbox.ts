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
      // Cast to the honest type: `kinds` is narrowed to `Record<string,
      // OpKind<any, any>>` above for `send`'s sake (every op passed to
      // `send` was validated by `enqueue`), but a replayed op can name a
      // kind this build has since removed, and indexing then genuinely
      // returns `undefined` at runtime regardless of what the narrowed type
      // claims.
      const def = kinds[op.kind] as OpKind<any, any> | undefined
      try {
        def?.optimistic?.(adapter, op.args, op.local)
      } catch {
        // The LIVE path, not the boot: `Outbox.load` already guards its own
        // replay loop, so what this catches is a patch made at enqueue time
        // against a cache shape that has since changed. The cost is that the
        // edit does not appear until the server answers, which is bad but
        // survivable; letting it throw would reject the caller's write for a
        // rendering problem.
      }
    },
    retryable: isRetryableRejection,
    lock: webLock("chroneli-outbox"),
  })
}
