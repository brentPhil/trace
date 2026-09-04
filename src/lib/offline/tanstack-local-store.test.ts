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
    // A DEFINED value, so the entry actually exists for the filter to drop.
    // `setQueryData(key, undefined)` builds no cache entry at all in TanStack
    // (queryClient.js short-circuits before the entry is created), so seeding
    // this with `undefined` would leave the filter untested — it would pass
    // with the filter deleted.
    client.setQueryData(key("entries:listRange", "skip"), [99])
    client.setQueryData(key("entries:getRunning", {}), null)
    const all = store.getAllQueries(listRange)
    expect(all).toEqual([
      { args: { fromMs: 0, toMs: 10 }, value: [1] },
      { args: { fromMs: 10, toMs: 20 }, value: [2] },
    ])
  })

  it("leaves the cached value alone on a write of undefined", () => {
    // Characterisation, and honest about it: TanStack's own setQueryData is
    // already a no-op for `undefined`, so this passes with the guard in the
    // adapter deleted. It is kept because the composed behaviour is what
    // callers depend on — if a future TanStack made `undefined` clear the
    // entry, this is what would catch it.
    const client = new QueryClient()
    const store = new TanStackLocalStore(client)
    client.setQueryData(key("entries:getRunning", {}), null)
    store.setQuery(getRunning, {}, undefined)
    expect(client.getQueryData(key("entries:getRunning", {}))).toBeNull()
  })
})
