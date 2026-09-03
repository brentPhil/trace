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

  constructor(dbName = "chroneli-offline") {
    this.store = createStore(dbName, "outbox")
  }

  async read(): Promise<OutboxSnapshot> {
    return (await get<OutboxSnapshot>(KEY, this.store)) ?? EMPTY_SNAPSHOT
  }

  async update(fn: (current: OutboxSnapshot) => OutboxSnapshot): Promise<OutboxSnapshot> {
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
  }
}

/** IndexedDB when the runtime has one, else memory — never a thrown boot. */
export function createOutboxStore(): OutboxStore {
  try {
    if (typeof indexedDB === "undefined") return new MemoryOutboxStore()
    return new IdbOutboxStore()
  } catch {
    return new MemoryOutboxStore()
  }
}
