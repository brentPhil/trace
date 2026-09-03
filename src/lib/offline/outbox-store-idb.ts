import { createStore, get, update } from "idb-keyval"
import { EMPTY_SNAPSHOT } from "./op-types"
import { MemoryOutboxStore } from "./outbox-store-memory"
import type { OutboxSnapshot, OutboxStore } from "./op-types"

const KEY = "outbox.v1"

/** Marks a rejection as "the caller's `fn` threw" rather than "IndexedDB
 *  failed" — see `IdbOutboxStore.update`. A plain boolean flag set inside the
 *  updater closure and read after the `await` does not survive TypeScript's
 *  control-flow narrowing across the call boundary, so the distinction is
 *  carried on the thrown value itself instead. */
class FnFailure {
  constructor(readonly error: unknown) {}
}

/**
 * The journal, in IndexedDB.
 *
 * One key holding the whole snapshot: the queue is short (a day offline is
 * tens of ops, not thousands) and a single value makes `update` atomic for
 * free — idb-keyval runs the updater inside one readwrite transaction, so
 * two tabs enqueuing at once cannot lose each other's op.
 */
export class IdbOutboxStore implements OutboxStore {
  private readonly store
  /** Set once IndexedDB has refused, and used for the rest of the session. */
  private fallback: MemoryOutboxStore | null = null

  constructor(dbName = "chroneli-offline") {
    this.store = createStore(dbName, "outbox")
  }

  async read(): Promise<OutboxSnapshot> {
    if (this.fallback !== null) return await this.fallback.read()
    try {
      return (await get<OutboxSnapshot>(KEY, this.store)) ?? EMPTY_SNAPSHOT
    } catch {
      // Nothing was read, so there is nothing to carry across.
      return await this.degrade(EMPTY_SNAPSHOT).read()
    }
  }

  async update(fn: (current: OutboxSnapshot) => OutboxSnapshot): Promise<OutboxSnapshot> {
    if (this.fallback !== null) return await this.fallback.update(fn)

    /*
     * Two things have to be got right here, and the obvious `try { … } catch {
     * degrade() }` gets both wrong. idb-keyval runs the updater INSIDE the
     * transaction's `onsuccess`, after a successful read, and only then puts
     * and waits on the transaction — so a failure can land either side of the
     * caller's `fn` having already run against real data.
     *
     *   `seen` is what the transaction managed to read. A transaction that
     *   aborts AFTER that point (quota, or Safari dropping the connection —
     *   idb-keyval's own source comments on it) must not take the queue with
     *   it: degrading to an EMPTY fallback would silently discard every op
     *   already journaled, which is the exact loss this whole file exists to
     *   prevent.
     *
     *   `FnFailure` separates the caller's bug from a storage failure. They
     *   arrive as the same rejection, and treating an exception thrown by
     *   `fn` as "IndexedDB is broken" would trade one transient bug for a
     *   session with no durability at all.
     */
    let seen: OutboxSnapshot = EMPTY_SNAPSHOT

    try {
      let result: OutboxSnapshot = EMPTY_SNAPSHOT
      await update<OutboxSnapshot>(
        KEY,
        (current) => {
          seen = current ?? EMPTY_SNAPSHOT
          try {
            result = fn(seen)
          } catch (error) {
            throw new FnFailure(error)
          }
          return result
        },
        this.store
      )
      return result
    } catch (error) {
      if (error instanceof FnFailure) throw error.error
      return await this.degrade(seen).update(fn)
    }
  }

  /**
   * IndexedDB is there but will not store anything — Safari's private mode
   * refuses the open — so carry on in memory for the rest of the session.
   *
   * THE FACTORY BELOW CANNOT DO THIS. `createStore` is lazy: it builds a
   * closure and does not touch `indexedDB.open()` until the first read or
   * write, so a constructor-time try/catch guards nothing and the refusal
   * arrives later as a rejected promise. Degrading here is what makes "never
   * a thrown boot" true rather than merely intended. Found in review.
   *
   * The cost is honest and unavoidable: in a browser that will not store
   * anything, nothing survives a reload. Within the session the outbox still
   * works, which is strictly better than a boot that throws.
   *
   * `seed` is whatever IndexedDB had told us before it failed — see `update`.
   */
  private degrade(seed: OutboxSnapshot): MemoryOutboxStore {
    this.fallback ??= new MemoryOutboxStore(seed)
    return this.fallback
  }
}

/** IndexedDB when the runtime has one, else memory. A runtime that HAS one
 *  and refuses it is handled by `degrade` above, not here. */
export function createOutboxStore(): OutboxStore {
  if (typeof indexedDB === "undefined") return new MemoryOutboxStore()
  return new IdbOutboxStore()
}
