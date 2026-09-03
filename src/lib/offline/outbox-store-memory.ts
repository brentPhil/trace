import { EMPTY_SNAPSHOT } from "./op-types"
import type { OutboxSnapshot, OutboxStore } from "./op-types"

/** Tests, SSR, and a browser whose IndexedDB refuses (private mode). */
export class MemoryOutboxStore implements OutboxStore {
  private snapshot: OutboxSnapshot
  private chain: Promise<unknown> = Promise.resolve()

  /** `initial` is for the degrade path in outbox-store-idb.ts: when IndexedDB
   *  fails mid-transaction it has already read the queue, and starting the
   *  fallback empty would drop every op that was on it. */
  constructor(initial: OutboxSnapshot = EMPTY_SNAPSHOT) {
    this.snapshot = initial
  }

  /** Joins the chain, so a read issued after an un-awaited update still sees
   *  it. Returning `this.snapshot` bare would hand back the pre-update value
   *  and give the two stores different observable behaviour. */
  async read(): Promise<OutboxSnapshot> {
    await this.chain
    return this.snapshot
  }

  update(fn: (current: OutboxSnapshot) => OutboxSnapshot): Promise<OutboxSnapshot> {
    // Serialised, so two concurrent updates compose rather than clobber —
    // the same guarantee idb-keyval's `update` gives inside one transaction.
    const next = this.chain.then(() => {
      this.snapshot = fn(this.snapshot)
      return this.snapshot
    })
    this.chain = next.catch(() => undefined)
    return next
  }
}
