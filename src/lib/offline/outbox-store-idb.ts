import { createStore, get, update } from "idb-keyval"
import { EMPTY_SNAPSHOT, type OutboxSnapshot, type OutboxStore } from "./op-types"
import { MemoryOutboxStore } from "./outbox-store-memory"

const KEY = "outbox.v1"

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
      return await this.degrade().read()
    }
  }

  async update(fn: (current: OutboxSnapshot) => OutboxSnapshot): Promise<OutboxSnapshot> {
    if (this.fallback !== null) return await this.fallback.update(fn)
    try {
      let result: OutboxSnapshot = EMPTY_SNAPSHOT
      await update<OutboxSnapshot>(
        KEY,
        (current) => {
          result = fn(current ?? EMPTY_SNAPSHOT)
          return result
        },
        this.store
      )
      return result
    } catch {
      return await this.degrade().update(fn)
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
   */
  private degrade(): MemoryOutboxStore {
    this.fallback ??= new MemoryOutboxStore()
    return this.fallback
  }
}

/** IndexedDB when the runtime has one, else memory. A runtime that HAS one
 *  and refuses it is handled by `degrade` above, not here. */
export function createOutboxStore(): OutboxStore {
  if (typeof indexedDB === "undefined") return new MemoryOutboxStore()
  return new IdbOutboxStore()
}
