import "fake-indexeddb/auto"
import { QueryClient, hashKey } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import {
  IdbSnapshotStore,
  MemorySnapshotStore,
  attachSnapshotWriter,
  isConvexQueryKey,
  snapshotQueryFn,
} from "./query-snapshots"
import type { QueryFunction, QueryFunctionContext } from "@tanstack/react-query"
import type { SnapshotStore } from "./query-snapshots"

const KEY = ["convexQuery", "settings:get", {}]
const ctx = (queryKey: readonly unknown[]) =>
  ({ queryKey, signal: new AbortController().signal, meta: undefined }) as unknown as QueryFunctionContext

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("isConvexQueryKey", () => {
  it("accepts convex query keys and rejects skipped ones", () => {
    expect(isConvexQueryKey(KEY)).toBe(true)
    expect(isConvexQueryKey(["convexQuery", "x", "skip"])).toBe(false)
    expect(isConvexQueryKey(["other"])).toBe(false)
  })
})

describe("snapshotQueryFn", () => {
  it("serves the snapshot while disconnected and the network when connected", async () => {
    const store = new MemorySnapshotStore()
    await store.write(hashKey(KEY), { data: { timezone: "UTC" }, updatedAt: 1 })
    const inner: QueryFunction = async () => ({ timezone: "fresh" })
    let connected = false
    const fn = snapshotQueryFn(inner, store, hashKey, () => connected)
    expect(await fn(ctx(KEY))).toEqual({ timezone: "UTC" })
    connected = true
    expect(await fn(ctx(KEY))).toEqual({ timezone: "fresh" })
  })

  it("falls through to the network when there is no snapshot", async () => {
    const inner: QueryFunction = async () => "net"
    const fn = snapshotQueryFn(inner, new MemorySnapshotStore(), hashKey, () => false)
    expect(await fn(ctx(KEY))).toBe("net")
  })
})

describe("attachSnapshotWriter", () => {
  it("writes successful convex results, debounced, and ignores other keys", async () => {
    const client = new QueryClient()
    const store = new MemorySnapshotStore()
    // Counting writes, not just checking the final value: two rapid changes
    // leave `{a:2}` stored whether the writer debounces or fires on every
    // event, so the value alone would pass with the debounce deleted.
    let writes = 0
    const counting: SnapshotStore = {
      ...store,
      read: (hash) => store.read(hash),
      write: (hash, snapshot) => {
        writes += 1
        return store.write(hash, snapshot)
      },
      prune: (olderThanMs) => store.prune(olderThanMs),
      clear: () => store.clear(),
    }
    const detach = attachSnapshotWriter(client.getQueryCache(), counting, 10)
    client.setQueryData(KEY, { a: 1 })
    client.setQueryData(KEY, { a: 2 })
    client.setQueryData(["other"], 1)
    // Nothing yet: the window has not elapsed.
    expect(writes).toBe(0)
    await wait(30)
    expect(writes).toBe(1)
    expect((await store.read(hashKey(KEY)))?.data).toEqual({ a: 2 })
    expect(await store.read(hashKey(["other"]))).toBeUndefined()
    detach()
  })
})

describe("IdbSnapshotStore", () => {
  it("round-trips, prunes by age, and clears", async () => {
    const store = new IdbSnapshotStore(`snap-${Math.random()}`)
    await store.write("old", { data: 1, updatedAt: 100 })
    await store.write("new", { data: 2, updatedAt: 1_000 })
    await store.prune(500)
    expect(await store.read("old")).toBeUndefined()
    expect((await store.read("new"))?.data).toBe(2)
    await store.clear()
    expect(await store.read("new")).toBeUndefined()
  })
})
