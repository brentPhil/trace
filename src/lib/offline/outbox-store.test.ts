import "fake-indexeddb/auto"
import { describe, expect, it } from "vitest"
import { MemoryOutboxStore } from "./outbox-store-memory"
import { IdbOutboxStore } from "./outbox-store-idb"
import { EMPTY_SNAPSHOT, type Op, type OutboxStore } from "./op-types"

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
