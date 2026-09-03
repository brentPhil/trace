import { clear, createStore, del, entries, get, set } from "idb-keyval"
import type { QueryCache, QueryFunction, QueryKey } from "@tanstack/react-query"

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
  async read(hash: string) {
    return this.map.get(hash)
  }
  async write(hash: string, snapshot: Snapshot) {
    this.map.set(hash, snapshot)
  }
  async prune(olderThanMs: number) {
    for (const [hash, snap] of this.map) if (snap.updatedAt < olderThanMs) this.map.delete(hash)
  }
  async clear() {
    this.map.clear()
  }
}

export class IdbSnapshotStore implements SnapshotStore {
  private readonly store
  constructor(dbName = "chroneli-offline") {
    this.store = createStore(dbName, "query-snapshots")
  }
  async read(hash: string) {
    return await get<Snapshot>(hash, this.store)
  }
  async write(hash: string, snapshot: Snapshot) {
    await set(hash, snapshot, this.store)
  }
  async prune(olderThanMs: number) {
    for (const [hash, snap] of await entries<string, Snapshot>(this.store)) {
      if (snap.updatedAt < olderThanMs) await del(hash, this.store)
    }
  }
  async clear() {
    await clear(this.store)
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

/** Write-through of every successful Convex result, debounced per key. */
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
