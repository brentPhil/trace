import { anyApi } from "convex/server"
import { describe, expect, it } from "vitest"
import { Outbox } from "./outbox"
import { MemoryOutboxStore } from "./outbox-store-memory"
import { optimisticIdFor } from "@/lib/optimistic-id"
import type { OutboxEvent, Sender } from "./outbox"
import type { Op, OpKind } from "./op-types"

/*
 * A tiny kind registry standing in for op-kinds.ts. `create` mints a
 * placeholder and resolves it; `retitle` depends on it; `title` coalesces;
 * `start` goes stale unless a `stop` follows.
 */
type CreateArgs = { clientKey: string; name: string }
type RetitleArgs = { id: string; title: string }

const kinds: Record<string, OpKind<any, any>> = {
  create: {
    ref: anyApi.things.create,
    label: "Creating a thing",
    immediate: (args: CreateArgs) => ({ id: optimisticIdFor(args.clientKey) }),
    mints: (args: CreateArgs) => optimisticIdFor(args.clientKey),
    minted: (result: { id: string }) => result.id,
  },
  retitle: {
    ref: anyApi.things.retitle,
    label: "Retitling a thing",
    immediate: () => null,
    coalesceKey: (args: RetitleArgs) => args.id,
  },
  start: {
    ref: anyApi.things.start,
    label: "Starting",
    immediate: () => null,
    staleAfterMs: 1_000,
    closedBy: ["stop"],
  },
  stop: { ref: anyApi.things.stop, label: "Stopping", immediate: () => null },
  settings: {
    ref: anyApi.things.settings,
    label: "Saving settings",
    immediate: () => null,
    coalesceKey: () => "settings",
    coalesceMerge: true,
  },
}

type Harness = {
  outbox: Outbox
  sent: Array<{ kind: string; args: Record<string, unknown> }>
  events: OutboxEvent[]
  applied: Op[]
  resolveSend: (value: unknown) => void
  rejectSend: (error: unknown) => void
  now: { value: number }
}

function harness(opts: { manual?: boolean; retryable?: (e: unknown) => boolean } = {}): Harness {
  const sent: Harness["sent"] = []
  const events: OutboxEvent[] = []
  const applied: Op[] = []
  const now = { value: 1_000 }
  let pending: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null

  const send: Sender = (op, args) => {
    sent.push({ kind: op.kind, args })
    if (!opts.manual) {
      if (op.kind === "create") return Promise.resolve({ id: `real:${args.clientKey}` })
      return Promise.resolve(null)
    }
    return new Promise((resolve, reject) => {
      pending = { resolve, reject }
    })
  }

  const outbox = new Outbox({
    store: new MemoryOutboxStore(),
    kinds,
    send,
    applyLocal: (op) => applied.push(op),
    retryable: opts.retryable ?? (() => false),
    now: () => now.value,
    newId: (() => {
      let n = 0
      return () => `op-${++n}`
    })(),
  })
  outbox.subscribe((e) => events.push(e))
  return {
    outbox,
    sent,
    events,
    applied,
    now,
    resolveSend: (v) => pending?.resolve(v),
    rejectSend: (e) => pending?.reject(e),
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe("Outbox", () => {
  it("applies the optimistic update at once and hands the caller the immediate result", async () => {
    const h = harness({ manual: true })
    const { result } = await h.outbox.enqueue("create", { clientKey: "k1", name: "A" })
    expect(result).toEqual({ id: "optimistic:k1" })
    expect(h.applied.map((o) => o.kind)).toEqual(["create"])
    expect(h.outbox.pending()).toBe(1)
  })

  it("sends in order, one at a time, and removes acknowledged ops", async () => {
    const h = harness({ manual: true })
    await h.outbox.enqueue("stop", {})
    await h.outbox.enqueue("stop", {})
    await flush()
    expect(h.sent).toHaveLength(1)
    h.resolveSend(null)
    await flush()
    expect(h.sent).toHaveLength(2)
    h.resolveSend(null)
    await flush()
    expect(h.outbox.pending()).toBe(0)
  })

  it("rewrites a dependent's placeholder with the id the producer returned", async () => {
    const h = harness()
    await h.outbox.enqueue("create", { clientKey: "k1", name: "A" })
    await h.outbox.enqueue("retitle", { id: "optimistic:k1", title: "B" })
    await flush()
    expect(h.sent[1].args).toEqual({ id: "real:k1", title: "B" })
  })

  it("resolves `settled` with the server's answer", async () => {
    const h = harness()
    const { settled } = await h.outbox.enqueue("create", { clientKey: "k1", name: "A" })
    await expect(settled).resolves.toEqual({ id: "real:k1" })
  })

  it("coalesces consecutive unsent ops on the same target", async () => {
    const h = harness({ manual: true })
    await h.outbox.enqueue("stop", {}) // occupies the sender
    await flush()
    await h.outbox.enqueue("retitle", { id: "x", title: "a" })
    await h.outbox.enqueue("retitle", { id: "x", title: "ab" })
    await h.outbox.enqueue("retitle", { id: "y", title: "other" })
    expect(h.outbox.pending()).toBe(3)
    h.resolveSend(null)
    await flush()
    expect(h.sent[1].args).toEqual({ id: "x", title: "ab" })
  })

  it("merges a coalesced patch's args when the kind asks for it", async () => {
    // The default collapse REPLACES, which is right for a retitle: the later
    // op carries the whole title. A settings save carries one field of many,
    // so replacing would lose the currency because the timezone was typed
    // second.
    const h = harness({ manual: true })
    await h.outbox.enqueue("stop", {}) // occupies the sender
    await flush()
    await h.outbox.enqueue("settings", { currency: "EUR" })
    await h.outbox.enqueue("settings", { timezone: "UTC" })
    expect(h.outbox.pending()).toBe(2)
    h.resolveSend(null)
    await flush()
    expect(h.sent[1].args).toEqual({ currency: "EUR", timezone: "UTC" })
  })

  it("drops a refused op, reports it, and drops what depended on it", async () => {
    const h = harness({ manual: true })
    await h.outbox.enqueue("create", { clientKey: "k1", name: "A" })
    await h.outbox.enqueue("retitle", { id: "optimistic:k1", title: "B" })
    await h.outbox.enqueue("stop", {})
    await flush()
    h.rejectSend(new Error("TOO_LONG"))
    await flush()
    await flush()
    const dropped = h.events.filter((e) => e.type === "dropped")
    expect(dropped.map((e) => [e.op.kind, e.reason])).toEqual([
      ["create", "rejected"],
      ["retitle", "orphaned"],
    ])
    expect(h.sent.map((s) => s.kind)).toEqual(["create", "stop"])
  })

  it("keeps a retryable refusal in place and waits for a kick", async () => {
    const h = harness({ manual: true, retryable: () => true })
    await h.outbox.enqueue("stop", {})
    await flush()
    h.rejectSend(new Error("UNAUTHENTICATED"))
    await flush()
    expect(h.outbox.pending()).toBe(1)
    expect(h.sent).toHaveLength(1)
    h.outbox.kick()
    await flush()
    expect(h.sent).toHaveLength(2)
  })

  it("drops a stale start that nothing closes, and keeps one that a stop follows", async () => {
    const h = harness({ manual: true })
    await h.outbox.enqueue("stop", {}) // block the sender
    await flush()
    await h.outbox.enqueue("start", {})
    h.now.value += 5_000
    h.resolveSend(null)
    await flush()
    await flush()
    expect(h.events.some((e) => e.type === "dropped" && e.reason === "stale")).toBe(true)

    const h2 = harness({ manual: true })
    await h2.outbox.enqueue("stop", {})
    await flush()
    await h2.outbox.enqueue("start", {})
    await h2.outbox.enqueue("stop", {})
    h2.now.value += 5_000
    h2.resolveSend(null)
    await flush()
    expect(h2.sent.map((s) => s.kind)).toEqual(["stop", "start"])
  })

  it("re-applies every op and resets in-flight flags on load", async () => {
    const store = new MemoryOutboxStore()
    await store.update((s) => ({
      ...s,
      ops: [{ id: "op-9", kind: "stop", args: {}, enqueuedAt: 0, inFlight: true }],
    }))
    const applied: Op[] = []
    const outbox = new Outbox({
      store,
      kinds,
      send: () => new Promise(() => {}),
      applyLocal: (op) => applied.push(op),
      retryable: () => false,
    })
    await outbox.load()
    expect(applied.map((o) => o.id)).toEqual(["op-9"])
    expect((await store.read()).ops[0].inFlight).toBe(false)
    expect(outbox.pending()).toBe(1)
  })

  it("drops a journaled op whose kind no longer exists", async () => {
    // The guard the `kinds` typing turns on. An app version that removes a
    // mutation leaves ops naming it in journals on real devices, and they
    // must be dropped and reported rather than jamming the queue behind
    // them forever.
    const store = new MemoryOutboxStore()
    await store.update((s) => ({
      ...s,
      ops: [{ id: "op-gone", kind: "gone", args: {}, enqueuedAt: 0, inFlight: false }],
    }))
    const events: OutboxEvent[] = []
    const outbox = new Outbox({
      store,
      kinds,
      send: () => Promise.resolve(null),
      applyLocal: () => {},
      retryable: () => false,
    })
    outbox.subscribe((e) => events.push(e))
    await outbox.load()
    await flush()
    expect(
      events.some((e) => e.type === "dropped" && e.op.kind === "gone" && e.reason === "rejected")
    ).toBe(true)
    expect(outbox.pending()).toBe(0)
  })

  it("boots the rest of the journal when one op cannot be re-applied", async () => {
    // `load` does not consult the kind registry, so a bad op reaches
    // `applyLocal` before `drain` can drop it. Unguarded, its throw left every
    // other op unapplied AND skipped the kick, stranding the whole queue.
    const store = new MemoryOutboxStore()
    await store.update((s) => ({
      ...s,
      ops: [
        { id: "op-bad", kind: "stop", args: {}, enqueuedAt: 0, inFlight: false },
        { id: "op-good", kind: "stop", args: {}, enqueuedAt: 0, inFlight: false },
      ],
    }))
    const applied: string[] = []
    const sent: string[] = []
    const outbox = new Outbox({
      store,
      kinds,
      send: (op) => {
        sent.push(op.id)
        return Promise.resolve(null)
      },
      applyLocal: (op) => {
        if (op.id === "op-bad") throw new Error("cannot replay")
        applied.push(op.id)
      },
      retryable: () => false,
    })
    await outbox.load()
    await flush()
    expect(applied).toEqual(["op-good"])
    expect(sent).toEqual(["op-bad", "op-good"])
  })

  it("keeps a resolved mapping after its producer leaves the queue", async () => {
    // The dependent may be enqueued AFTER the producer is acknowledged: the
    // screen still shows the placeholder until the reactive query swaps it.
    // Pruning on producer removal dropped that edit as orphaned.
    const h = harness()
    await h.outbox.enqueue("create", { clientKey: "k1", name: "A" })
    await flush()
    expect(h.outbox.pending()).toBe(0)

    await h.outbox.enqueue("retitle", { id: "optimistic:k1", title: "B" })
    await flush()
    expect(h.sent.at(-1)).toEqual({ kind: "retitle", args: { id: "real:k1", title: "B" } })
    expect(h.events.some((e) => e.type === "dropped")).toBe(false)
  })

  it("reports a drain that throws instead of freezing quietly", async () => {
    const store = new MemoryOutboxStore()
    const events: OutboxEvent[] = []
    const outbox = new Outbox({
      store,
      kinds,
      send: () => Promise.resolve(null),
      applyLocal: () => {},
      retryable: () => false,
      // The one dependency a drain cannot proceed without.
      lock: () => Promise.reject(new Error("lock exploded")),
    })
    outbox.subscribe((e) => events.push(e))
    outbox.kick()
    await flush()
    expect(events.some((e) => e.type === "failed")).toBe(true)
  })

  it("notifies pending-count changes", async () => {
    const h = harness()
    await h.outbox.enqueue("stop", {})
    await flush()
    const counts = h.events.filter((e) => e.type === "changed").map((e) => e.pending)
    expect(counts[0]).toBe(1)
    expect(counts[counts.length - 1]).toBe(0)
  })
})
