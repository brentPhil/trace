import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import { TanStackLocalStore } from "./tanstack-local-store"
import {
  tagPlaceholder,
  optimisticProjectCreate,
  optimisticProjectRemove,
  optimisticProjectSetArchived,
  optimisticProjectUpdate,
  optimisticTagEnsure,
  optimisticTagRemove,
  optimisticTagRename,
} from "./optimistic-classifiers"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

const PROJECTS = ["convexQuery", "projects:list", {}]
const TAGS = ["convexQuery", "tags:list", {}]

function project(overrides: Partial<Doc<"projects">> = {}): Doc<"projects"> {
  return {
    _id: "p1" as Id<"projects">,
    _creationTime: 1,
    userId: "u",
    name: "Website",
    color: "slate",
    archived: false,
    billableByDefault: false,
    updatedAt: 1,
    deletedAt: null,
    ...overrides,
  }
}

function tag(overrides: Partial<Doc<"tags">> = {}): Doc<"tags"> {
  return { _id: "t1" as Id<"tags">, _creationTime: 1, userId: "u", name: "ops", updatedAt: 1, deletedAt: null, ...overrides }
}

function setup() {
  const client = new QueryClient()
  client.setQueryData(PROJECTS, [project()])
  client.setQueryData(TAGS, [tag()])
  return { client, store: new TanStackLocalStore(client) }
}

describe("projects", () => {
  it("create inserts a placeholder row sorted by name", () => {
    const { client, store } = setup()
    optimisticProjectCreate(store, { clientKey: "k", name: "Alpha" })
    const rows = client.getQueryData<Doc<"projects">[]>(PROJECTS)!
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Website"])
    expect(rows[0]._id).toBe("optimistic:k")
  })

  it("create is idempotent", () => {
    const { client, store } = setup()
    optimisticProjectCreate(store, { clientKey: "k", name: "Alpha" })
    optimisticProjectCreate(store, { clientKey: "k", name: "Alpha" })
    expect(client.getQueryData<Doc<"projects">[]>(PROJECTS)).toHaveLength(2)
  })

  it("update patches, null clears the rate", () => {
    const { client, store } = setup()
    optimisticProjectUpdate(store, { projectId: "p1" as Id<"projects">, name: "Site", hourlyRateCents: null })
    const [row] = client.getQueryData<Doc<"projects">[]>(PROJECTS)!
    expect(row.name).toBe("Site")
    expect(row.hourlyRateCents).toBeUndefined()
  })

  it("setArchived flips the flag; remove drops the row", () => {
    const { client, store } = setup()
    optimisticProjectSetArchived(store, { projectId: "p1" as Id<"projects">, archived: true })
    expect(client.getQueryData<Doc<"projects">[]>(PROJECTS)![0].archived).toBe(true)
    optimisticProjectRemove(store, { projectId: "p1" as Id<"projects"> })
    expect(client.getQueryData<Doc<"projects">[]>(PROJECTS)).toEqual([])
  })
})

describe("tags", () => {
  it("ensure adds a placeholder only when the name is new, case-insensitively", () => {
    const { client, store } = setup()
    optimisticTagEnsure(store, { name: "OPS" })
    expect(client.getQueryData<Doc<"tags">[]>(TAGS)).toHaveLength(1)
    optimisticTagEnsure(store, { name: "  design " })
    const rows = client.getQueryData<Doc<"tags">[]>(TAGS)!
    expect(rows.map((r) => r.name)).toEqual(["design", "ops"])
    expect(rows[0]._id).toBe("optimistic:tag:design")
  })

  it("rename and remove", () => {
    const { client, store } = setup()
    optimisticTagRename(store, { tagId: "t1" as Id<"tags">, name: "operations" })
    expect(client.getQueryData<Doc<"tags">[]>(TAGS)![0].name).toBe("operations")
    optimisticTagRemove(store, { tagId: "t1" as Id<"tags"> })
    expect(client.getQueryData<Doc<"tags">[]>(TAGS)).toEqual([])
  })

  it("re-sorts on a rename that moves the row", () => {
    // A one-row list cannot exercise the sort, so the rename path shipped
    // untested. The server re-sorts by name; so must this.
    const { client, store } = setup()
    client.setQueryData(TAGS, [tag({ _id: "t1" as Id<"tags">, name: "alpha" }), tag({ _id: "t2" as Id<"tags">, name: "beta" })])
    optimisticTagRename(store, { tagId: "t1" as Id<"tags">, name: "zulu" })
    expect(client.getQueryData<Doc<"tags">[]>(TAGS)!.map((t) => t.name)).toEqual([
      "beta",
      "zulu",
    ])
  })

  it("mints one placeholder however the name is spelled", () => {
    expect(tagPlaceholder("  OPS ")).toBe(tagPlaceholder("ops"))
  })
})
