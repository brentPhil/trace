import type { FunctionReference } from "convex/server"
import type { OptimisticLocalStore } from "convex/browser"

/** Extra data an op carries for its optimistic update only — never sent. */
export type OpLocal = Record<string, unknown>

/** One journaled write intent. Persisted as-is, so keep it JSON-plain. */
export type Op = {
  /** UUIDv7, so ops sort in the order they were made. */
  id: string
  /** A key of `OP_KINDS`. */
  kind: string
  /** The mutation's args, possibly holding placeholder ids. */
  args: Record<string, unknown>
  local?: OpLocal
  enqueuedAt: number
  /** Handed to Convex and not yet acknowledged. Reset on load: a reload
   *  loses Convex's in-memory queue, so an in-flight op must be re-sent. */
  inFlight: boolean
}

export type OutboxSnapshot = {
  ops: Op[]
  /** placeholder id → real id, kept while any pending op still mentions it. */
  resolved: Record<string, string>
}

export const EMPTY_SNAPSHOT: OutboxSnapshot = { ops: [], resolved: {} }

/** The journal. `update` must apply `fn` atomically against the stored value. */
export interface OutboxStore {
  read: () => Promise<OutboxSnapshot>
  update: (fn: (current: OutboxSnapshot) => OutboxSnapshot) => Promise<OutboxSnapshot>
}

/**
 * What the outbox knows about one mutation.
 *
 * `optimistic` is THE optimistic function for the mutation: it runs against
 * the TanStack adapter at enqueue and again as Convex's `optimisticUpdate`
 * when the op is sent. It must be idempotent — it is re-applied on every
 * boot and on every Convex transition.
 */
export type OpKind<TArgs extends Record<string, unknown>, TResult> = {
  ref: FunctionReference<"mutation", "public", TArgs, TResult>
  /** Sentence fragment for a toast: "Retitling an entry". */
  label: string
  optimistic?: (store: OptimisticLocalStore, args: TArgs, local: OpLocal | undefined) => void
  /**
   * Undo what `optimistic` put on screen, for an op that will now never be
   * sent.
   *
   * Only the minting kinds need one: `optimistic` paints a placeholder
   * nothing else will ever resolve, so a drop that leaves it in place is a
   * phantom row that survives the drop — and, since the snapshot layer
   * persists whatever `optimistic` painted, survives a reload too. A
   * non-minting op needs no `unmint`: its patch is a value the server's next
   * transition overwrites, and offline there is nothing to un-patch back to.
   */
  unmint?: (store: OptimisticLocalStore, args: TArgs) => void
  /** The placeholder id this op puts on screen before the server answers. */
  mints?: (args: TArgs) => string
  /** Where the real id for that placeholder lands in the result. */
  minted?: (result: TResult) => string
  /**
   * What the caller is handed straight away.
   *
   * Optional: `entries.editTime` returns the RECONCILED times, which need the
   * entry's current times to compute and so cannot be derived from `args`
   * alone — `immediate` is not given them. A kind that omits this hands the
   * caller `undefined` rather than a fabricated, possibly wrong, result.
   */
  immediate?: (args: TArgs, now: number) => TResult
  /** Two consecutive unsent ops with equal keys collapse into one. */
  coalesceKey?: (args: TArgs) => string
  /**
   * How a collapse combines the two ops' args.
   *
   * Default (false/absent) is REPLACE, which is right when the args are the
   * whole value — a retitle carries the complete title, so the later one is
   * the answer. MERGE is for a patch of independent fields: two settings
   * saves, one setting the currency and one the timezone, must not lose the
   * currency because the timezone was typed second.
   */
  coalesceMerge?: boolean
  /** Older than this, and not followed by one of `closedBy`, the op is dropped. */
  staleAfterMs?: number
  closedBy?: ReadonlyArray<string>
}
