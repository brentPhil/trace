import { EMPTY_SNAPSHOT, type OutboxSnapshot, type OutboxStore } from "./op-types"

/** Tests, SSR, and a browser whose IndexedDB throws (private mode). */
export class MemoryOutboxStore implements OutboxStore {
  private snapshot: OutboxSnapshot = EMPTY_SNAPSHOT
  private chain: Promise<unknown> = Promise.resolve()

  async read(): Promise<OutboxSnapshot> {
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
