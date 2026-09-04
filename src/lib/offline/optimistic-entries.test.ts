import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import { TanStackLocalStore } from "./tanstack-local-store"
import {
  optimisticCreate,
  optimisticDiscard,
  optimisticRestore,
  optimisticSetTitle,
  optimisticStart,
  optimisticStop,
} from "./optimistic-entries"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

const RUNNING = ["convexQuery", "entries:getRunning", {}]
const PROJECTS = ["convexQuery", "projects:list", {}]
const range = { fromMs: 0, toMs: 4_000_000_000_000 }
const RANGE = ["convexQuery", "entries:listRange", range]

function project(overrides: Partial<Doc<"projects">> = {}): Doc<"projects"> {
  return {
    _id: "p1" as Id<"projects">,
    _creationTime: 1,
    userId: "u",
    name: "Website",
    color: "slate",
    archived: false,
    billableByDefault: true,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  }
}

function setup() {
  const client = new QueryClient()
  client.setQueryData(RUNNING, null)
  client.setQueryData(PROJECTS, [project()])
  client.setQueryData(RANGE, [])
  return { client, store: new TanStackLocalStore(client) }
}

describe("optimisticStart", () => {
  it("puts a placeholder-keyed row in the running slot", () => {
    const { client, store } = setup()
    optimisticStart(store, { clientKey: "k1", title: "Writing", startedAt: 1_000 })
    const running = client.getQueryData<Doc<"timeEntries">>(RUNNING)!
    expect(running._id).toBe("optimistic:k1")
    expect(running.title).toBe("Writing")
    expect(running.endedAt).toBeNull()
    expect(running.durationMs).toBeNull()
  })

  it("also inserts the placeholder into listRange, not just the running slot", () => {
    // Offline, nothing else supplies the row — the server transition that
    // does it online never arrives. Without this the day/week totals
    // (listRange-backed) never see time being tracked at all.
    const { client, store } = setup()
    optimisticStart(store, { clientKey: "k1", title: "Writing", startedAt: 1_000 })
    const rows = client.getQueryData<Array<Doc<"timeEntries">>>(RANGE)!
    expect(rows).toHaveLength(1)
    expect(rows[0]._id).toBe("optimistic:k1")
    expect(rows[0].endedAt).toBeNull()
  })

  it("inherits the project's billable default, as the server does", () => {
    const { client, store } = setup()
    optimisticStart(store, { clientKey: "k1", projectId: "p1" as Id<"projects"> })
    expect(client.getQueryData<Doc<"timeEntries">>(RUNNING)!.billable).toBe(true)
  })

  it("lets an explicit billable win over the project's default", () => {
    const { client, store } = setup()
    optimisticStart(store, {
      clientKey: "k1",
      projectId: "p1" as Id<"projects">,
      billable: false,
    })
    expect(client.getQueryData<Doc<"timeEntries">>(RUNNING)!.billable).toBe(false)
  })
})

describe("optimisticStop", () => {
  it("empties the running slot with null, never undefined", () => {
    const { client, store } = setup()
    optimisticStart(store, { clientKey: "k1" })
    optimisticStop(store, { entryId: "optimistic:k1" as Id<"timeEntries"> })
    expect(client.getQueryData(RUNNING)).toBeNull()
  })

  it("keeps the entry in the list, with its duration set, instead of dropping it", () => {
    // Before this, a stop cleared `getRunning` and touched no list at all —
    // the entry vanished from the screen entirely until reconnect.
    const { client, store } = setup()
    optimisticStart(store, { clientKey: "k1", startedAt: 1_000 })
    optimisticStop(store, {
      entryId: "optimistic:k1" as Id<"timeEntries">,
      endedAt: 5_000,
    })
    const rows = client.getQueryData<Array<Doc<"timeEntries">>>(RANGE)!
    expect(rows).toHaveLength(1)
    expect(rows[0].endedAt).toBe(5_000)
    expect(rows[0].durationMs).toBe(4_000)
  })

  it("falls back to the running entry's id when the args name none", () => {
    const { client, store } = setup()
    optimisticStart(store, { clientKey: "k1", startedAt: 1_000 })
    optimisticStop(store, { endedAt: 5_000 })
    const rows = client.getQueryData<Array<Doc<"timeEntries">>>(RANGE)!
    expect(rows[0].endedAt).toBe(5_000)
  })
})

describe("optimisticDiscard", () => {
  it("drops the row from the list rather than patching it — a discard deletes", () => {
    const { client, store } = setup()
    optimisticStart(store, { clientKey: "k1", startedAt: 1_000 })
    optimisticDiscard(store, { entryId: "optimistic:k1" as Id<"timeEntries"> })
    expect(client.getQueryData(RUNNING)).toBeNull()
    expect(client.getQueryData<Array<Doc<"timeEntries">>>(RANGE)).toEqual([])
  })
})

describe("optimisticSetTitle", () => {
  it("retitles the running entry", () => {
    const { client, store } = setup()
    optimisticStart(store, { clientKey: "k1", title: "First" })
    optimisticSetTitle(store, {
      entryId: "optimistic:k1" as Id<"timeEntries">,
      title: "Second",
    })
    expect(client.getQueryData<Doc<"timeEntries">>(RUNNING)!.title).toBe("Second")
  })

  it("leaves a different running entry alone", () => {
    const { client, store } = setup()
    optimisticStart(store, { clientKey: "k1", title: "First" })
    optimisticSetTitle(store, { entryId: "other" as Id<"timeEntries">, title: "Second" })
    expect(client.getQueryData<Doc<"timeEntries">>(RUNNING)!.title).toBe("First")
  })
})

describe("optimisticCreate", () => {
  it("paints a completed row the server will agree with", () => {
    const { client, store } = setup()
    optimisticCreate(store, {
      clientKey: "k1",
      title: "Migration",
      note: "  ",
      startedAt: 1_000,
      endedAt: 4_600_000,
      projectId: "p1" as Id<"projects">,
    })
    const [row] = client.getQueryData<Array<Doc<"timeEntries">>>(RANGE)!
    expect(row._id).toBe("optimistic:k1")
    expect(row.durationMs).toBe(4_599_000)
    // Blank normalises away, exactly as convex/entries.ts's normaliseNote does.
    expect(row.note).toBeUndefined()
    // Inherited, not defaulted to false — offline nothing corrects this.
    expect(row.billable).toBe(true)
    // `entries.create` writes "manual"; only `start` writes "web".
    expect(row.source).toBe("manual")
  })
})

describe("optimisticRestore", () => {
  it("puts back the snapshot the op carried", () => {
    const { client, store } = setup()
    const entry = {
      _id: "e1" as Id<"timeEntries">,
      _creationTime: 1_000,
      userId: "u",
      clientKey: "c1",
      title: "Deleted",
      startedAt: 1_000,
      endedAt: 2_000,
      durationMs: 1_000,
      tagIds: [],
      billable: false,
      source: "web",
      updatedAt: 2_000,
      deletedAt: null,
    } as Doc<"timeEntries">
    optimisticRestore(store, { entryId: entry._id }, { entry })
    expect(client.getQueryData<Array<Doc<"timeEntries">>>(RANGE)).toEqual([entry])
  })

  it("does nothing when the op carries no snapshot", () => {
    const { client, store } = setup()
    optimisticRestore(store, { entryId: "e1" as Id<"timeEntries"> }, undefined)
    expect(client.getQueryData<Array<Doc<"timeEntries">>>(RANGE)).toEqual([])
  })
})
