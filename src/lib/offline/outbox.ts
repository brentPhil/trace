import { newClientKey } from "@/lib/client-key"
import { rewritePlaceholders, unresolvedPlaceholders } from "./placeholders"
import { EMPTY_SNAPSHOT } from "./op-types"
import type {
  Op,
  OpKind,
  OpLocal,
  OutboxSnapshot,
  OutboxStore,
} from "./op-types"
import type { Lock } from "./web-lock"

export type OutboxEvent =
  | { type: "changed"; pending: number }
  | {
      type: "dropped"
      op: Op
      reason: "rejected" | "stale" | "orphaned"
      error?: unknown
    }
  /** The drain itself threw. The queue has stopped for a reason that is NOT
   *  being offline, and saying so is the whole point: a frozen pending count
   *  reads as "waiting for the network", which is exactly wrong here.
   *
   *  A listener must NOT answer this by calling `kick()`. The catch runs
   *  before the `finally` that clears `draining`, so a kick from here is
   *  recorded and replayed immediately into the same persistent failure —
   *  a tight loop. Report it and wait for a real signal. */
  | { type: "failed"; error: unknown }

/** Rejection given to a `settled` promise whose op was drained by another tab.
 *  See `reconcileSettlers`. */
export const SENT_BY_ANOTHER_TAB = "This change was sent by another tab."

/** Rejection given to a `settled` promise whose op was discarded by `clear`.
 *  Distinct from the one above: nothing sent it, it is gone. */
export const DISCARDED = "This change was discarded."

export type Sender = (op: Op, args: Record<string, unknown>) => Promise<unknown>

export type OutboxOptions = {
  store: OutboxStore
  kinds: Record<string, OpKind<any, any>>
  /** Hands one op to Convex. Resolves on ack; rejects on refusal; WAITS on no network. */
  send: Sender
  /** Runs the op's optimistic function against the TanStack adapter. */
  applyLocal: (op: Op) => void
  /** Runs the op kind's `unmint` (if it has one) against the TanStack
   *  adapter, undoing what `applyLocal` painted for an op that will now
   *  never be sent. Optional: most kinds mint nothing and need no undo. */
  applyUnmint?: (op: Op) => void
  retryable: (error: unknown) => boolean
  lock?: Lock
  now?: () => number
  newId?: () => string
}

type Deferred = {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

/**
 * The persistent outbox.
 *
 * Every offline-capable mutation goes through `enqueue`, online or not: the
 * op is journaled FIRST, its optimistic update applied, then the drain hands
 * ops to Convex one at a time in order. Sequential sending is what makes
 * placeholder rewriting sound — a producer always precedes its dependents —
 * and it costs nothing a solo tracker can feel.
 *
 * `send` never rejects for a lost network (Convex waits), so a drain that is
 * "stuck" is exactly a drain that is offline. It resumes when the socket does.
 */
export class Outbox {
  private readonly store: OutboxStore
  // `| undefined`: an op's `kind` is a plain string read back from the
  // journal, so a lookup by an unknown one is a real runtime case (see
  // `drain`'s "Unknown op kind" drop) — not something the type can rule out.
  private readonly kinds: Record<string, OpKind<any, any> | undefined>
  private readonly send: Sender
  private readonly applyLocal: (op: Op) => void
  private readonly applyUnmint?: (op: Op) => void
  private readonly retryable: (error: unknown) => boolean
  private readonly lock: Lock
  private readonly now: () => number
  private readonly newId: () => string

  private listeners = new Set<(event: OutboxEvent) => void>()
  private settlers = new Map<string, Deferred>()
  private pendingCount = 0
  private draining = false
  private kicked = false

  constructor(options: OutboxOptions) {
    this.store = options.store
    this.kinds = options.kinds
    this.send = options.send
    this.applyLocal = options.applyLocal
    this.applyUnmint = options.applyUnmint
    this.retryable = options.retryable
    this.lock = options.lock ?? (async (fn) => await fn())
    this.now = options.now ?? (() => Date.now())
    this.newId = options.newId ?? (() => newClientKey())
  }

  /** Read the journal, put every op back on screen, and start sending. */
  async load(): Promise<void> {
    const snap = await this.store.update((s) => ({
      ...s,
      ops: s.ops.map((op) => ({ ...op, inFlight: false })),
    }))
    for (const op of snap.ops) {
      try {
        this.applyLocal(op)
      } catch {
        // One unreplayable op must not stop the boot. `load` does not consult
        // the kind registry at all, so an op naming a kind a later version of
        // the app removed reaches here BEFORE `drain` can drop it — and an
        // unguarded throw would leave the rest of the journal unapplied and
        // never call `kick`, silently stranding every other op in it.
      }
    }
    this.setPending(snap.ops.length)
    this.kick()
  }

  /**
   * Re-applies the queue to whatever is in the cache now.
   *
   * `applyLocal` otherwise runs only at enqueue and once at boot, so a query
   * that MOUNTS later — a second log page, a new date range, /reports —
   * resolves from its snapshot with none of the pending ops applied, and the
   * status line then promises changes the page in front of the user
   * contradicts. Safe to call as often as you like: every optimistic function
   * is idempotent, which is what makes boot replay a no-op too.
   */
  async reapply(): Promise<void> {
    const snap = await this.store.read()
    for (const op of snap.ops) {
      try {
        this.applyLocal(op)
      } catch {
        // Same reasoning as `load`'s loop, immediately below: one
        // unreplayable op must not stop the rest from painting.
      }
    }
  }

  /**
   * `settled` resolves with the server's answer once this op is sent — but
   * only when THIS instance is the one that sends it. Another tab may drain
   * it first (see `reconcileSettlers`), in which case it rejects instead of
   * hanging forever. Treat it as best-effort across tabs, never load-bearing.
   */
  async enqueue(
    kind: string,
    args: Record<string, unknown>,
    local?: OpLocal
  ): Promise<{ op: Op; result: unknown; settled: Promise<unknown> }> {
    const def = this.kinds[kind]
    if (def === undefined) throw new Error(`Unknown op kind: ${kind}`)

    const op: Op = {
      id: this.newId(),
      kind,
      args,
      ...(local !== undefined ? { local } : {}),
      enqueuedAt: this.now(),
      inFlight: false,
    }

    let replaced: Op | undefined
    // Also carries the op as actually stored (its id/enqueuedAt/args when a
    // coalesce rewrote them) out of the updater closure, so the settled-promise
    // wiring below need not re-derive it by indexing the new snapshot.
    let stored: Op = op
    const snap = await this.store.update((s) => {
      const last = s.ops.at(-1)
      const key = def.coalesceKey?.(args)
      if (
        last !== undefined &&
        !last.inFlight &&
        last.kind === kind &&
        key !== undefined &&
        this.kinds[last.kind]?.coalesceKey?.(last.args) === key
      ) {
        replaced = last
        stored = {
          ...op,
          id: last.id,
          enqueuedAt: last.enqueuedAt,
          // REPLACE by default; MERGE for a patch of independent fields.
          // See `coalesceMerge` on OpKind for why both are needed.
          args: def.coalesceMerge === true ? { ...last.args, ...args } : args,
        }
        return { ...s, ops: [...s.ops.slice(0, -1), stored] }
      }
      return { ...s, ops: [...s.ops, op] }
    })

    // A coalesced op inherits the earlier op's `settled` — the caller that
    // awaited the first keystroke still gets the answer for the last one.
    const settled = new Promise<unknown>((resolve, reject) => {
      if (replaced !== undefined && this.settlers.has(replaced.id)) {
        const prior = this.settlers.get(replaced.id)!
        this.settlers.set(stored.id, {
          resolve: (v) => {
            prior.resolve(v)
            resolve(v)
          },
          reject: (e) => {
            prior.reject(e)
            reject(e)
          },
        })
      } else {
        this.settlers.set(stored.id, { resolve, reject })
      }
    })
    settled.catch(() => undefined)

    this.applyLocal(stored)
    this.setPending(snap.ops.length)
    this.kick()
    return { op: stored, result: def.immediate?.(args, this.now()), settled }
  }

  pending(): number {
    return this.pendingCount
  }

  /**
   * Empties the journal outright — for sign-out, and nothing else.
   *
   * Sign-out is now refused ONLY while offline (see `pendingSignOutWarning`
   * in offline-copy.ts for why refusing on a non-empty queue was a trap), so
   * this can run mid-drain, with an op in flight or settlers still waiting on
   * ops this clear is about to erase. Going THROUGH the engine rather than
   * around it (a caller poking `store.update` directly) is what keeps that
   * safe: `reconcileSettlers` rejects every settler whose op no longer
   * exists — the same reconciliation a drain already runs after another tab
   * empties the journal out from under it — and `setPending` emits the
   * `changed` event a live `SyncStatus` or a sign-out warning depends on to
   * notice the queue is gone. Skip either step and a failed sign-out (the
   * network drops between the clear and `authClient.signOut`) leaves the
   * user on a live authed page with a sidebar still warning about a queue
   * that no longer exists, and deferreds that will now hang forever.
   *
   * An op whose `send` resolves AFTER this runs can still write back a
   * placeholder→id mapping into the now-empty journal — `ops` stays empty
   * either way, so the hazard `capResolved`'s own docblock warns about does
   * not reoccur here; not worth chasing further.
   */
  async clear(): Promise<void> {
    const next = await this.store.update(() => EMPTY_SNAPSHOT)
    // DISCARDED, not the default: nothing sent these, they were thrown away.
    this.reconcileSettlers(next, DISCARDED)
    this.setPending(next.ops.length)
  }

  subscribe(listener: (event: OutboxEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Start a drain, or ask a running one to go round again. */
  kick(): void {
    if (this.draining) {
      this.kicked = true
      return
    }
    this.draining = true
    void this.lock(() => this.drain())
      .catch((error: unknown) => {
        // A drain that throws must not die quietly. Everything it owns — the
        // pending count, the settlers, the journal — freezes in place, and a
        // frozen pending count is indistinguishable from being offline, which
        // is precisely what this class tells its reader to assume. Say so
        // instead, and let the next kick try again.
        this.emit({ type: "failed", error })
      })
      .finally(() => {
        this.draining = false
        if (this.kicked) {
          this.kicked = false
          this.kick()
        }
      })
  }

  private async drain(): Promise<void> {
    for (;;) {
      const snap = await this.store.read()
      this.setPending(snap.ops.length)
      this.reconcileSettlers(snap)
      const op = snap.ops.at(0)
      if (op === undefined) return
      const def = this.kinds[op.kind]

      if (def === undefined) {
        await this.drop(
          op,
          "rejected",
          new Error(`Unknown op kind: ${op.kind}`)
        )
        continue
      }

      if (this.isStale(op, def, snap)) {
        await this.drop(op, "stale")
        continue
      }

      if (unresolvedPlaceholders(op.args, snap.resolved).length > 0) {
        // Its producer came earlier in the queue and is gone without
        // resolving, so this op names a thing that never came to exist.
        await this.drop(op, "orphaned")
        continue
      }

      const args = rewritePlaceholders(op.args, snap.resolved)
      await this.store.update((s) => ({
        ...s,
        ops: s.ops.map((o) => (o.id === op.id ? { ...o, inFlight: true } : o)),
      }))

      let result: unknown
      try {
        result = await this.send(op, args)
      } catch (error) {
        if (this.retryable(error)) {
          await this.store.update((s) => ({
            ...s,
            ops: s.ops.map((o) =>
              o.id === op.id ? { ...o, inFlight: false } : o
            ),
          }))
          return
        }
        await this.drop(op, "rejected", error)
        continue
      }

      const next = await this.store.update((s) => {
        const ops = s.ops.filter((o) => o.id !== op.id)
        const resolved = { ...s.resolved }
        if (def.mints !== undefined && def.minted !== undefined) {
          resolved[def.mints(op.args)] = def.minted(result)
        }
        return { ops, resolved: capResolved(resolved, ops) }
      })
      this.settlers.get(op.id)?.resolve(result)
      this.settlers.delete(op.id)
      this.setPending(next.ops.length)

      // Repaint what is still queued over the server truth this send just
      // brought in. Convex answers a mutation by pushing the resulting
      // queries through `queryClient.setQueryData`, which replaces whole
      // query values — carrying THIS op's effect and none of the ops still
      // in the journal. Those pushes are `manual` writes, and the provider's
      // cache subscription excludes `manual` deliberately (see
      // `outbox-provider.tsx`), so nothing else re-applies them: without
      // this, a user reconnecting with a queue watches their pending edits
      // disappear one by one, each returning only as its own op is sent.
      //
      // The ordering here is right for two reasons. The push has already
      // landed — Convex resolves a mutation only once the client's queries
      // reflect the write, which is what `await this.send` waited for. And
      // the sent op is already out of the journal above, so re-applying
      // cannot re-mint its placeholder row over the real one the server just
      // delivered.
      //
      // Awaited rather than fired off: `drain` is sequential and awaited
      // throughout, and the screen should be consistent before the next send
      // goes out.
      if (next.ops.length > 0) await this.reapply()
    }
  }

  /** Only ever asked about the head of the queue, so "later ops" is the tail. */
  private isStale(
    op: Op,
    def: OpKind<any, any>,
    snap: OutboxSnapshot
  ): boolean {
    if (def.staleAfterMs === undefined) return false
    if (this.now() - op.enqueuedAt <= def.staleAfterMs) return false
    const closers = def.closedBy ?? []
    return !snap.ops.slice(1).some((o) => closers.includes(o.kind))
  }

  private async drop(
    op: Op,
    reason: "rejected" | "stale" | "orphaned",
    error?: unknown
  ): Promise<void> {
    const next = await this.store.update((s) => {
      const ops = s.ops.filter((o) => o.id !== op.id)
      return { ops, resolved: s.resolved }
    })
    // Rolls back whatever `applyLocal` painted for this op, so the screen
    // stops showing an effect the outbox has just given up on sending. Run
    // for every reason, not only "stale"/"orphaned": a "rejected" drop
    // self-heals on the next server transition when online, so unminting it
    // too is harmless — never wrong, just occasionally redundant.
    this.applyUnmint?.(op)
    this.settlers.get(op.id)?.reject(error ?? new Error(reason))
    this.settlers.delete(op.id)
    this.emit({
      type: "dropped",
      op,
      reason,
      ...(error !== undefined ? { error } : {}),
    })
    this.setPending(next.ops.length)
  }

  private setPending(count: number): void {
    if (count === this.pendingCount) return
    this.pendingCount = count
    this.emit({ type: "changed", pending: count })
  }

  /**
   * Settles anything that left the journal without THIS instance sending it.
   *
   * With the Web Lock in place another tab may hold the sender and drain an
   * op this tab enqueued. Its result never comes back here, so the promise
   * cannot be resolved with one — but leaving it pending forever would hang
   * every caller awaiting it and grow `settlers` without bound. Rejecting is
   * the honest answer, and it is why `settled` is documented as best-effort
   * across tabs: never depend on it for correctness, only for extras like
   * recording the server's clock.
   *
   * RESTS ON AN ORDERING INVARIANT: `enqueue` registers its settler
   * synchronously after `store.update` resolves, with no `await` between. So
   * a settler's op is always already in the journal, and this can never
   * reject one for an op that is merely about to be written. An added `await`
   * in that window would break it silently.
   */
  private reconcileSettlers(
    snap: OutboxSnapshot,
    reason = SENT_BY_ANOTHER_TAB
  ): void {
    if (this.settlers.size === 0) return
    const live = new Set(snap.ops.map((o) => o.id))
    for (const [id, deferred] of this.settlers) {
      if (live.has(id)) continue
      deferred.reject(new Error(reason))
      this.settlers.delete(id)
    }
  }

  private emit(event: OutboxEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // One subscriber's bug must not take the drain down with it — and
        // `setPending` emits on every drain iteration, so it would.
      }
    }
  }
}

/**
 * How many resolved placeholder mappings to keep.
 *
 * They are kept by AGE — objects preserve string-key insertion order, so the
 * oldest are simply the first — and never by whether a queued op still names
 * one ALONE, though `capResolved` does consult the queue as well; see there.
 * Reference-counting the live queue on its own looks tighter and is wrong: the
 * mapping is minted in the very transaction that removes its producer from
 * the queue, so a mapping with no dependent YET would be discarded
 * microseconds after being learned. The screen still shows the placeholder
 * until the reactive query swaps it, so an edit made in that window would
 * arrive naming an id nothing could resolve and be dropped as "orphaned" —
 * blamed on a producer that in fact succeeded. That is exactly the loss
 * src/lib/optimistic-id.ts was written to warn about.
 *
 * A hundred is far more than a session offline can produce, and each entry is
 * two short strings.
 */
const RESOLVED_LIMIT = 100

/**
 * The newest mappings, PLUS anything a queued op still names.
 *
 * The second half is not belt-and-braces, it is the whole safety property:
 * this cap must only ever be able to over-retain. `resolved` is a lifetime
 * accumulator, so an established account sits at the limit permanently and
 * every mint evicts the oldest — and a journal like
 * `[create P, …100 creates…, retitle P]` would push P's mapping out before
 * the retitle reached the head. That op would then be dropped as "orphaned",
 * blaming a producer that in fact succeeded: exactly the loss this mechanism
 * was written to prevent, reintroduced at a different threshold.
 *
 * `unresolvedPlaceholders(args, {})` with an empty map enumerates every
 * placeholder the queue names, which is precisely the set that must survive.
 */
function capResolved(
  resolved: Record<string, string>,
  ops: Op[]
): Record<string, string> {
  const keys = Object.keys(resolved)
  if (keys.length <= RESOLVED_LIMIT) return resolved

  const needed = new Set(
    unresolvedPlaceholders(
      ops.map((o) => o.args),
      {}
    )
  )
  const newest = new Set(keys.slice(keys.length - RESOLVED_LIMIT))
  const kept: Record<string, string> = {}
  // One pass over `keys`, so insertion order — which is the age order the
  // eviction above depends on — survives the rebuild.
  for (const key of keys) {
    if (needed.has(key) || newest.has(key)) kept[key] = resolved[key]
  }
  return kept
}
