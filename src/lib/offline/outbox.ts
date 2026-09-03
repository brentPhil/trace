import { newClientKey } from "@/lib/client-key"
import { rewritePlaceholders, unresolvedPlaceholders } from "./placeholders"
import type { Op, OpKind, OpLocal, OutboxSnapshot, OutboxStore } from "./op-types"
import type { Lock } from "./web-lock"

export type OutboxEvent =
  | { type: "changed"; pending: number }
  | { type: "dropped"; op: Op; reason: "rejected" | "stale" | "orphaned"; error?: unknown }

export type Sender = (op: Op, args: Record<string, unknown>) => Promise<unknown>

export type OutboxOptions = {
  store: OutboxStore
  kinds: Record<string, OpKind<any, any>>
  /** Hands one op to Convex. Resolves on ack; rejects on refusal; WAITS on no network. */
  send: Sender
  /** Runs the op's optimistic function against the TanStack adapter. */
  applyLocal: (op: Op) => void
  retryable: (error: unknown) => boolean
  lock?: Lock
  now?: () => number
  newId?: () => string
}

type Deferred = { resolve: (value: unknown) => void; reject: (error: unknown) => void }

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
    for (const op of snap.ops) this.applyLocal(op)
    this.setPending(snap.ops.length)
    this.kick()
  }

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
    return { op: stored, result: def.immediate(args, this.now()), settled }
  }

  pending(): number {
    return this.pendingCount
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
    void this.lock(() => this.drain()).finally(() => {
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
      const op = snap.ops.at(0)
      if (op === undefined) return
      const def = this.kinds[op.kind]

      if (def === undefined) {
        await this.drop(op, "rejected", new Error(`Unknown op kind: ${op.kind}`))
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
            ops: s.ops.map((o) => (o.id === op.id ? { ...o, inFlight: false } : o)),
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
        return { ops, resolved: pruneResolved(resolved, ops) }
      })
      this.settlers.get(op.id)?.resolve(result)
      this.settlers.delete(op.id)
      this.setPending(next.ops.length)
    }
  }

  private isStale(op: Op, def: OpKind<any, any>, snap: OutboxSnapshot): boolean {
    if (def.staleAfterMs === undefined) return false
    if (this.now() - op.enqueuedAt <= def.staleAfterMs) return false
    const closers = def.closedBy ?? []
    const index = snap.ops.findIndex((o) => o.id === op.id)
    return !snap.ops.slice(index + 1).some((o) => closers.includes(o.kind))
  }

  private async drop(op: Op, reason: "rejected" | "stale" | "orphaned", error?: unknown): Promise<void> {
    const next = await this.store.update((s) => {
      const ops = s.ops.filter((o) => o.id !== op.id)
      return { ops, resolved: pruneResolved(s.resolved, ops) }
    })
    this.settlers.get(op.id)?.reject(error ?? new Error(reason))
    this.settlers.delete(op.id)
    this.emit({ type: "dropped", op, reason, ...(error !== undefined ? { error } : {}) })
    this.setPending(next.ops.length)
  }

  private setPending(count: number): void {
    if (count === this.pendingCount) return
    this.pendingCount = count
    this.emit({ type: "changed", pending: count })
  }

  private emit(event: OutboxEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

/**
 * Forget a placeholder once no pending op mentions it.
 *
 * A crude `JSON.stringify` + substring test rather than a real walk of every
 * op's args: it can only OVER-retain (a placeholder id that happens to be a
 * substring of some unrelated string survives a little longer than it has
 * to), never under-retain, and over-retention costs a few bytes and nothing
 * else. Do not "fix" this into something exact — an exact version that gets
 * the walk wrong can prune a mapping a still-pending op depends on, which
 * turns into a silently orphaned op instead of a few stale bytes.
 */
function pruneResolved(resolved: Record<string, string>, ops: Op[]): Record<string, string> {
  const text = JSON.stringify(ops.map((o) => o.args))
  const kept: Record<string, string> = {}
  for (const [placeholder, real] of Object.entries(resolved)) {
    if (text.includes(placeholder)) kept[placeholder] = real
  }
  return kept
}
