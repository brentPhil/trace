import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import { getFunctionName } from "convex/server"
import { api } from "../../../convex/_generated/api"
import { Outbox } from "./outbox"
import { MemoryOutboxStore } from "./outbox-store-memory"
import { TanStackLocalStore } from "./tanstack-local-store"
import { OP_KINDS, STALE_START_MS } from "./op-kinds"
import type { OptimisticLocalStore } from "convex/browser"
import type { Doc } from "../../../convex/_generated/dataModel"
import type { Op, OpKind } from "./op-types"
import type { OpKindName } from "./op-kinds"

describe("OP_KINDS", () => {
  it("names every kind after the Convex function it sends", () => {
    for (const [name, def] of Object.entries(OP_KINDS)) {
      expect(getFunctionName(def.ref)).toBe(name.replace(".", ":"))
      expect(def.label.length).toBeGreaterThan(0)
    }
  })

  it("mints and resolves come in pairs", () => {
    for (const def of Object.values(OP_KINDS)) {
      expect(def.mints === undefined).toBe(def.minted === undefined)
    }
  })

  it("start goes stale after a day unless closed", () => {
    expect(OP_KINDS["entries.start"].staleAfterMs).toBe(STALE_START_MS)
    expect(OP_KINDS["entries.start"].closedBy).toEqual([
      "entries.stop",
      "entries.discardRunning",
      "entries.start",
    ])
  })

  it("only names closers that are real kinds", () => {
    // `closedBy` is `ReadonlyArray<string>` — it cannot reference OpKindName
    // without a type cycle — so a typo would leave `entries.start`
    // permanently un-closeable and drop every replayed start after a day.
    for (const [name, def] of Object.entries(OP_KINDS)) {
      for (const closer of def.closedBy ?? []) {
        expect(Object.keys(OP_KINDS), `${name} closedBy`).toContain(closer)
      }
    }
  })

  it("mints the id its optimistic function actually writes", () => {
    // A drift here is catastrophic and silent: the outbox records a
    // resolution for an id nothing is showing, and every dependent op is
    // dropped as "orphaned". Each of the four minting kinds is driven
    // through its own optimistic function against a stub store, and the id
    // that lands is compared with what `mints` claims.
    const cases: Array<{ kind: OpKindName; args: any; seed: unknown }> = [
      { kind: "entries.start", args: { clientKey: "k1" }, seed: null },
      {
        kind: "entries.create",
        args: { clientKey: "k2", startedAt: 1_000, endedAt: 2_000 },
        seed: [],
      },
      { kind: "projects.create", args: { clientKey: "k3", name: "P" }, seed: [] },
      { kind: "tags.ensure", args: { name: "  Ops " }, seed: [] },
    ]

    for (const { kind, args, seed } of cases) {
      const def = OP_KINDS[kind]
      let written: unknown
      const store = {
        getQuery: () => seed,
        // The stub given in the plan returns no live subscription for ANY
        // ref, which is fine for projects.create/tags.ensure (they only use
        // getQuery) but silently no-ops entries.create's optimistic function
        // — it inserts through insertEverywhere, which walks
        // getAllQueries(api.entries.listRange) and finds nothing to write
        // into. Answering with one fake all-time range for listRange (and
        // nothing for listPage, so insertEverywhere's second, paginated
        // branch — which wants a real usePaginatedQuery shape — stays
        // unexercised) is the minimum that lets the real insert happen.
        // api.x.y is not referentially stable — anyApi's Proxy hands
        // back a fresh object on every property access — so this compares
        // structurally with getFunctionName, the same way the first test
        // above does.
        getAllQueries: (query: unknown) =>
          getFunctionName(query as Parameters<typeof getFunctionName>[0]) ===
          getFunctionName(api.entries.listRange)
            ? [{ args: { fromMs: 0, toMs: Number.MAX_SAFE_INTEGER }, value: [] }]
            : [],
        setQuery: (_q: unknown, _a: unknown, value: unknown) => {
          written = value
        },
      } as unknown as OptimisticLocalStore

      def.optimistic(store, args, undefined)
      const rows = Array.isArray(written) ? written : written === null ? [] : [written]
      const ids = (rows as Array<{ _id?: string }>).map((row) => row._id)
      expect(ids, kind).toContain(def.mints?.(args))
    }
  })

  it("start's immediate result carries the placeholder the optimistic row uses", () => {
    const r = OP_KINDS["entries.start"].immediate({ clientKey: "k", title: "" }, 5)
    expect(r.entryId).toBe("optimistic:k")
    expect(r.stoppedEntryIds).toEqual([])
    expect(r.replayed).toBe(false)
  })

  it("stop's immediate result names the timer it stopped, when the caller named one", () => {
    const named = OP_KINDS["entries.stop"].immediate({ entryId: "e1" }, 0)
    expect(named.stoppedEntryIds).toEqual(["e1"])

    const unnamed = OP_KINDS["entries.stop"].immediate({}, 0)
    expect(unnamed.stoppedEntryIds).toEqual([])
  })
})

describe("OP_KINDS unmint", () => {
  // A start dropped as "stale" (unclosed for over `STALE_START_MS`, offline)
  // leaves its optimistic effect behind unless something rolls it back: the
  // timer bar keeps showing a running timer from the phantom `getRunning`,
  // and `RunawayBanner` keeps alarming about it, across reloads, until the
  // socket returns. `unmint` is that rollback.
  it("a stale-dropped start clears the running slot and the list row", async () => {
    const queryClient = new QueryClient()
    const RUNNING = ["convexQuery", "entries:getRunning", {}]
    const range = { fromMs: 0, toMs: 4_000_000_000_000 }
    const RANGE = ["convexQuery", "entries:listRange", range]
    queryClient.setQueryData(RUNNING, null)
    queryClient.setQueryData(RANGE, [])
    const adapter = new TanStackLocalStore(queryClient)

    let releaseFirst: (() => void) | undefined
    const firstSend = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const now = { value: 1_000 }

    const outbox = new Outbox({
      store: new MemoryOutboxStore(),
      kinds: OP_KINDS,
      send: async (op) => {
        // Occupies the sender so the enqueued start sits at the head,
        // un-sent, until it goes stale.
        if (op.kind === "entries.setTitle") await firstSend
        return null
      },
      applyLocal: (op: Op) => {
        const def = OP_KINDS[op.kind as OpKindName] as OpKind<any, any> | undefined
        def?.optimistic?.(adapter, op.args, op.local)
      },
      applyUnmint: (op: Op) => {
        const def = OP_KINDS[op.kind as OpKindName] as OpKind<any, any> | undefined
        def?.unmint?.(adapter, op.args)
      },
      retryable: () => false,
      now: () => now.value,
    })

    // Occupies the sender, so the start below cannot be sent yet.
    await outbox.enqueue("entries.setTitle", {
      entryId: "unrelated",
      title: "x",
    })
    await new Promise((r) => setTimeout(r, 0))

    await outbox.enqueue("entries.start", { clientKey: "k1", startedAt: 1_000 })
    expect(queryClient.getQueryData<Doc<"timeEntries">>(RUNNING)?._id).toBe(
      "optimistic:k1"
    )
    expect(
      queryClient.getQueryData<Array<Doc<"timeEntries">>>(RANGE)
    ).toHaveLength(1)

    now.value += STALE_START_MS + 1
    releaseFirst?.()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(queryClient.getQueryData(RUNNING)).toBeNull()
    expect(queryClient.getQueryData<Array<Doc<"timeEntries">>>(RANGE)).toEqual(
      []
    )
  })
})

describe("OP_KINDS coalescing", () => {
  // Exercises the real `Outbox` engine (Task 6) against the real `OP_KINDS`
  // registry (this task), rather than re-testing the engine's generic
  // collapse mechanics — Task 6 already covers those against a stub kind
  // table. This proves the ACTUAL `projects.update` entry is wired the way
  // /projects actually calls it: a colour swatch sends {projectId, color},
  // the name field sends {projectId, name} — genuine partials, not whole
  // values.
  it("a project patch merges instead of replacing, so a colour survives a later name edit", async () => {
    const sent: Array<{ kind: string; args: Record<string, unknown> }> = []
    let releaseFirst: (() => void) | undefined
    const firstSend = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const outbox = new Outbox({
      store: new MemoryOutboxStore(),
      kinds: OP_KINDS,
      send: async (op, args) => {
        sent.push({ kind: op.kind, args })
        // The FIRST send hangs until released, so it still occupies the
        // sender when the two `projects.update` ops below are enqueued —
        // exactly what makes them land back-to-back and coalesce, per the
        // same pattern `outbox.test.ts` uses for this engine mechanic.
        if (op.kind === "entries.stop") await firstSend
        return null
      },
      applyLocal: () => undefined,
      retryable: () => false,
      now: () => 1_000,
    })

    // Occupies the sender so the drain cannot touch anything enqueued next.
    await outbox.enqueue("entries.stop", {})
    await new Promise((r) => setTimeout(r, 0))

    await outbox.enqueue("projects.update", { projectId: "p1", color: "blue" })
    await outbox.enqueue("projects.update", { projectId: "p1", name: "Website" })
    expect(outbox.pending()).toBe(2)

    releaseFirst?.()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(sent[1]).toEqual({
      kind: "projects.update",
      args: { projectId: "p1", color: "blue", name: "Website" },
    })
  })
})

describe("Outbox.drain re-applies what is still queued", () => {
  // Each `send` resolves only once Convex has pushed the resulting server
  // truth into the client's queries — a whole-array replacement that carries
  // the sent op's effect and none of the ones still queued behind it. The
  // provider's cache subscription cannot answer that push (it is a `manual`
  // write, deliberately excluded), so without a re-apply inside `drain` the
  // user watches their queued edits vanish one by one while `SyncStatus`
  // still says they are pending.
  it("an edit still in the queue survives the server truth pushed by the send before it", async () => {
    const queryClient = new QueryClient()
    const range = { fromMs: 0, toMs: 4_000_000_000_000 }
    const RANGE = ["convexQuery", "entries:listRange", range]
    const row = (id: string, startedAt: number, title: string) =>
      ({ _id: id, _creationTime: startedAt, startedAt, title }) as unknown as Doc<"timeEntries">
    // Newest-first, the order `listRange` returns and `patchEverywhere` keeps.
    queryClient.setQueryData(RANGE, [row("e2", 2_000, "two"), row("e1", 1_000, "one")])
    const adapter = new TanStackLocalStore(queryClient)

    let openGate: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      openGate = resolve
    })
    let reachedSecond: (() => void) | undefined
    const secondSendStarted = new Promise<void>((resolve) => {
      reachedSecond = resolve
    })
    let releaseSecond: (() => void) | undefined
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })

    const outbox = new Outbox({
      store: new MemoryOutboxStore(),
      kinds: OP_KINDS,
      send: async (op) => {
        // Held until BOTH ops are journaled, so the drain cannot empty the
        // queue before there is anything queued behind the head.
        await gate
        if (op.args.entryId === "e1") {
          // What @convex-dev/react-query does on the socket push for this
          // mutation's write: `setQueryData` with the server's whole array.
          // It carries op 1's title and nothing of op 2's.
          queryClient.setQueryData(RANGE, [
            row("e2", 2_000, "two"),
            row("e1", 1_000, "ONE EDITED"),
          ])
          return null
        }
        reachedSecond?.()
        // Parks the drain at the second send so the assertion below runs at
        // the one moment that matters: after the first send's push landed,
        // before the second op's own send could paint its effect back.
        await secondGate
        return null
      },
      applyLocal: (op: Op) => {
        const def = OP_KINDS[op.kind as OpKindName] as OpKind<any, any> | undefined
        def?.optimistic?.(adapter, op.args, op.local)
      },
      retryable: () => false,
      now: () => 1_000,
    })

    await outbox.enqueue("entries.setTitle", { entryId: "e1", title: "ONE EDITED" })
    await outbox.enqueue("entries.setTitle", { entryId: "e2", title: "TWO EDITED" })
    expect(outbox.pending()).toBe(2)

    openGate?.()
    await secondSendStarted

    const titles = Object.fromEntries(
      (queryClient.getQueryData<Array<Doc<"timeEntries">>>(RANGE) ?? []).map((e) => [
        e._id,
        e.title,
      ])
    )
    expect(titles).toEqual({ e1: "ONE EDITED", e2: "TWO EDITED" })

    releaseSecond?.()
  })
})
