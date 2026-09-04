import "fake-indexeddb/auto"
import { describe, expect, it } from "vitest"
import { MemoryOutboxStore } from "./outbox-store-memory"
import { IdbOutboxStore } from "./outbox-store-idb"
import { EMPTY_SNAPSHOT } from "./op-types"
import type { Op, OutboxStore } from "./op-types"

function op(id: string): Op {
  return { id, kind: "entries.setTitle", args: { title: id }, enqueuedAt: 1, inFlight: false }
}

const stores: Array<[string, () => OutboxStore]> = [
  ["memory", () => new MemoryOutboxStore()],
  ["indexeddb", () => new IdbOutboxStore(`test-${Math.random()}`)],
]

describe.each(stores)("%s outbox store", (_name, make) => {
  it("starts empty", async () => {
    expect(await make().read()).toEqual(EMPTY_SNAPSHOT)
  })

  it("applies updates atomically and in order", async () => {
    const store = make()
    await Promise.all([
      store.update((s) => ({ ...s, ops: [...s.ops, op("a")] })),
      store.update((s) => ({ ...s, ops: [...s.ops, op("b")] })),
    ])
    const snap = await store.read()
    expect(snap.ops.map((o) => o.id)).toEqual(["a", "b"])
  })

  it("keeps the resolved map", async () => {
    const store = make()
    await store.update((s) => ({ ...s, resolved: { "optimistic:x": "real" } }))
    expect((await store.read()).resolved).toEqual({ "optimistic:x": "real" })
  })
})

it("indexeddb persists across store instances of the same name", async () => {
  const name = `persist-${Math.random()}`
  await new IdbOutboxStore(name).update((s) => ({ ...s, ops: [op("a")] }))
  expect((await new IdbOutboxStore(name).read()).ops).toHaveLength(1)
})

it("a memory read sees an update that was never awaited", async () => {
  const store = new MemoryOutboxStore()
  void store.update((s) => ({ ...s, ops: [op("a")] }))
  expect((await store.read()).ops).toHaveLength(1)
})

it("degrades to memory when IndexedDB is present but refuses", async () => {
  // Safari's private mode: the API is there, opening a database is refused.
  // The refusal cannot surface in the constructor — `createStore` is lazy —
  // so the store has to absorb it on first use.
  const realOpen = indexedDB.open
  indexedDB.open = () => {
    throw new Error("refused")
  }
  try {
    const store = new IdbOutboxStore(`refused-${Math.random()}`)
    // Resolves rather than rejecting: this is the "never a thrown boot" claim.
    expect(await store.read()).toEqual(EMPTY_SNAPSHOT)
    await store.update((s) => ({ ...s, ops: [op("a")] }))
    expect((await store.read()).ops).toHaveLength(1)
  } finally {
    indexedDB.open = realOpen
  }
})

it("keeps what was already journaled when a transaction fails after reading it", async () => {
  // The dangerous half of degrading. idb-keyval runs the updater after a
  // SUCCESSFUL read, so a transaction that aborts on the WRITE has already
  // shown us the queue — and a fallback that started empty would drop it.
  //
  // Stubbing `indexedDB.open` a second time does not reach this path:
  // `createStore` caches the DB-open promise per store instance, so once the
  // first `update` above has opened the connection, a later `update` never
  // calls `open` again — the stub never fires and nothing fails. What idb-
  // keyval's `update` (idb-keyval/dist/index.js) actually does after a
  // successful read is call `store.put(...)` on the same transaction, so
  // stubbing `put` to throw is what lands the failure on the write side,
  // after our updater has already run against the real `{ops:[a]}`.
  const name = `late-failure-${Math.random()}`
  const store = new IdbOutboxStore(name)
  await store.update((s) => ({ ...s, ops: [op("a")] }))

  const realPut = IDBObjectStore.prototype.put
  IDBObjectStore.prototype.put = function put() {
    throw new Error("put failed")
  }
  try {
    const after = await store.update((s) => ({ ...s, ops: [...s.ops, op("b")] }))
    expect(after.ops.map((o) => o.id)).toEqual(["a", "b"])
  } finally {
    IDBObjectStore.prototype.put = realPut
  }
})

it("a throwing updater reaches the caller and does not degrade the store", async () => {
  // A bug in `fn` is not a storage failure. Treating it as one would trade a
  // transient bug for a session with no durability at all.
  const store = new IdbOutboxStore(`throwing-${Math.random()}`)
  await store.update((s) => ({ ...s, ops: [op("a")] }))

  await expect(
    store.update(() => {
      throw new Error("caller bug")
    })
  ).rejects.toThrow("caller bug")

  // Still on IndexedDB, still holding the op — not silently in memory.
  expect((await store.read()).ops.map((o) => o.id)).toEqual(["a"])
})
