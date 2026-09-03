import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import { anyApi } from "convex/server"
import { TanStackLocalStore } from "./tanstack-local-store"

// `anyApi` mints references by path — the same thing `api` does in this
// project's generated file. The adapter must key by NAME, not identity.
const listRange = anyApi.entries.listRange
const getRunning = anyApi.entries.getRunning

function key(name: string, args: unknown) {
  return ["convexQuery", name, args]
}

describe("TanStackLocalStore", () => {
  it("reads and writes a query by function name and args", () => {
    const client = new QueryClient()
    const store = new TanStackLocalStore(client)
    client.setQueryData(key("entries:getRunning", {}), null)
    expect(store.getQuery(getRunning, {})).toBeNull()
    store.setQuery(getRunning, {}, { _id: "x" })
    expect(client.getQueryData(key("entries:getRunning", {}))).toEqual({ _id: "x" })
  })

  it("lists every cached instance of a function with its args, skipping 'skip'", () => {
    const client = new QueryClient()
    const store = new TanStackLocalStore(client)
    client.setQueryData(key("entries:listRange", { fromMs: 0, toMs: 10 }), [1])
    client.setQueryData(key("entries:listRange", { fromMs: 10, toMs: 20 }), [2])
    client.setQueryData(key("entries:listRange", "skip"), undefined)
    client.setQueryData(key("entries:getRunning", {}), null)
    const all = store.getAllQueries(listRange)
    expect(all).toEqual([
      { args: { fromMs: 0, toMs: 10 }, value: [1] },
      { args: { fromMs: 10, toMs: 20 }, value: [2] },
    ])
  })

  it("ignores a write of undefined, which TanStack would drop anyway", () => {
    const client = new QueryClient()
    const store = new TanStackLocalStore(client)
    client.setQueryData(key("entries:getRunning", {}), null)
    store.setQuery(getRunning, {}, undefined)
    expect(client.getQueryData(key("entries:getRunning", {}))).toBeNull()
  })
})
