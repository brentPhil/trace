import { clear, createStore, del, entries, get, set } from "idb-keyval"
import type { QueryCache, QueryFunction, QueryKey } from "@tanstack/react-query"

/**
 * `updatedAt` is when this snapshot was last WRITTEN, not when its data was
 * last fetched from the server. Serving a snapshot offline is recorded by
 * TanStack as an ordinary success, so the writer stores it back with a fresh
 * stamp — meaning a snapshot in active use never ages out. That is the
 * intended behaviour (what is being read is what should be kept), but it does
 * mean the prune below bounds the store by disuse rather than by age of data.
 */
export type Snapshot = { data: unknown; updatedAt: number }

export interface SnapshotStore {
  read: (hash: string) => Promise<Snapshot | undefined>
  write: (hash: string, snapshot: Snapshot) => Promise<void>
  /** Drops snapshots whose `updatedAt` is before `olderThanMs`. */
  prune: (olderThanMs: number) => Promise<void>
  clear: () => Promise<void>
}

/** Thirty days: long enough for last month's report, short enough to bound the store. */
export const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export class MemorySnapshotStore implements SnapshotStore {
  private map = new Map<string, Snapshot>()
  /**
   * Set by `clear()` and never unset — see the docblock on `IdbSnapshotStore`'s
   * field of the same name for why a write after clearing must be refused
   * rather than merely raced against.
   */
  private sealed = false
  async read(hash: string) {
    return this.map.get(hash)
  }
  async write(hash: string, snapshot: Snapshot) {
    if (this.sealed) return
    this.map.set(hash, snapshot)
  }
  async prune(olderThanMs: number) {
    for (const [hash, snap] of this.map) if (snap.updatedAt < olderThanMs) this.map.delete(hash)
  }
  async clear() {
    this.sealed = true
    this.map.clear()
  }
}

export class IdbSnapshotStore implements SnapshotStore {
  private readonly store
  /**
   * `chroneli-snapshots`, NOT `chroneli-offline` — and not the outbox
   * store's database name under any name. idb-keyval's `createStore` calls
   * `indexedDB.open(dbName)` with no version and creates its object store
   * only inside `onupgradeneeded`, so whichever store touches a shared
   * database first creates it at version 1 holding only ITS OWN object
   * store; the second store then opens the existing v1 database, gets no
   * upgrade event, and every one of its transactions throws `NotFoundError`
   * forever. Found in review: `router.tsx` prunes snapshots at router
   * construction, long before `OutboxProvider` mounts, so the outbox was
   * always the one that lost — and its own `degrade()` (see
   * `outbox-store-idb.ts`) swallowed that into a silent, permanent
   * in-memory fallback on the very first write, every session. Two
   * independent database names is the fix; do not consolidate these.
   */
  constructor(dbName = "chroneli-snapshots") {
    this.store = createStore(dbName, "query-snapshots")
  }

  /** Set once IndexedDB has refused, and used for the rest of the session. */
  private fallback: MemorySnapshotStore | null = null

  /**
   * Set by `clear()` and never unset.
   *
   * Sign-out calls `clearLocalData`, which calls `clear()`, and then awaits a
   * NETWORK round trip (`authClient.signOut`) before leaving the page. A
   * debounced write armed by `attachSnapshotWriter` before the clear can
   * still be sitting on a timer, and that timer fires DURING the round trip
   * — after the clear, before the navigation — and would otherwise write a
   * fresh snapshot of the just-signed-out user's data straight back into
   * IndexedDB. `router.tsx` never keeps `attachSnapshotWriter`'s detach
   * function, so there is no timer to cancel from outside; sealing the store
   * itself is what makes the clear win regardless. One-way on purpose: a
   * cleared store has no "resume writing" case, only "stay cleared until the
   * next sign-in constructs a fresh store instance."
   */
  private sealed = false

  async read(hash: string) {
    if (this.fallback !== null) return await this.fallback.read(hash)
    try {
      return await get<Snapshot>(hash, this.store)
    } catch {
      return await this.degrade().read(hash)
    }
  }
  async write(hash: string, snapshot: Snapshot) {
    if (this.sealed) return
    if (this.fallback !== null) return await this.fallback.write(hash, snapshot)
    try {
      await set(hash, snapshot, this.store)
    } catch {
      await this.degrade().write(hash, snapshot)
    }
  }
  async prune(olderThanMs: number) {
    if (this.fallback !== null) return await this.fallback.prune(olderThanMs)
    try {
      for (const [hash, snap] of await entries<string, Snapshot>(this.store)) {
        if (snap.updatedAt < olderThanMs) await del(hash, this.store)
      }
    } catch {
      await this.degrade().prune(olderThanMs)
    }
  }
  async clear() {
    this.sealed = true
    if (this.fallback !== null) return await this.fallback.clear()
    try {
      await clear(this.store)
    } catch {
      await this.degrade().clear()
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
   * a thrown boot" true rather than merely intended — the same argument as
   * `IdbOutboxStore.degrade` in `outbox-store-idb.ts`, which this mirrors.
   *
   * Unlike the outbox, each snapshot lives under its own key rather than one
   * atomic whole-snapshot value, so there is no partial-write "seen" state to
   * carry across — whatever IndexedDB had is simply unreachable once it has
   * refused, and the fallback starts empty.
   */
  private degrade(): MemorySnapshotStore {
    if (this.fallback === null) {
      this.fallback = new MemorySnapshotStore()
      // A clear that raced the refusal itself must still stick.
      if (this.sealed) void this.fallback.clear()
    }
    return this.fallback
  }
}

export function createSnapshotStore(): SnapshotStore {
  try {
    if (typeof indexedDB === "undefined") return new MemorySnapshotStore()
    return new IdbSnapshotStore()
  } catch {
    return new MemorySnapshotStore()
  }
}

export function isConvexQueryKey(key: readonly unknown[]): boolean {
  return key[0] === "convexQuery" && key[2] !== "skip"
}

/**
 * The read side of offline.
 *
 * NOT TanStack's persistQueryClient: that hydrates every persisted key at
 * boot, and @convex-dev/react-query opens a live subscription for every query
 * added to the cache, so hundreds of old report ranges would go live on every
 * reconnect. This answers only what is asked: while the socket is down, a
 * query with a snapshot resolves from it at once; Convex marks its queries
 * never-stale so nothing refetches; and the subscription the cache opened
 * replaces the snapshot the moment the socket delivers.
 */
export function snapshotQueryFn(
  inner: QueryFunction,
  store: SnapshotStore,
  hashFn: (key: QueryKey) => string,
  isConnected: () => boolean
): QueryFunction {
  return async (context) => {
    if (isConvexQueryKey(context.queryKey) && !isConnected()) {
      const snapshot = await store.read(hashFn(context.queryKey))
      if (snapshot !== undefined) return snapshot.data
    }
    return await inner(context)
  }
}

/**
 * Write-through of every successful Convex result, debounced per key.
 *
 * A debounced write is LOST if the page unloads inside the window — bounded
 * by `debounceMs`, and there is no `pagehide` flush — so the stored snapshot
 * can lag the last result by that interval. Recorded so it is not
 * rediscovered later as a bug.
 */
export function attachSnapshotWriter(
  cache: QueryCache,
  store: SnapshotStore,
  debounceMs = 300
): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const unsubscribe = cache.subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return
    if (!isConvexQueryKey(event.query.queryKey)) return
    const { queryHash } = event.query
    const existing = timers.get(queryHash)
    if (existing !== undefined) clearTimeout(existing)
    timers.set(
      queryHash,
      setTimeout(() => {
        timers.delete(queryHash)
        const { data, dataUpdatedAt } = event.query.state
        // Disambiguating "no data yet" from "success with a falsy value" —
        // not an assumption about shape. A Convex query answers `null`, not
        // `undefined`, when it has nothing.
        if (data === undefined) return
        void store.write(queryHash, { data, updatedAt: dataUpdatedAt }).catch(() => undefined)
      }, debounceMs)
    )
  })
  return () => {
    unsubscribe()
    for (const timer of timers.values()) clearTimeout(timer)
  }
}
