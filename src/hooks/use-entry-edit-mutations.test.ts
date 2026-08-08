import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { getFunctionName } from "convex/server"
import { describe, expect, it, vi } from "vitest"
import { api } from "../../convex/_generated/api"
import { useEntryEditMutations } from "./use-entry-edit-mutations"
import type { OptimisticLocalStore } from "convex/browser"
import type { Doc, Id } from "../../convex/_generated/dataModel"

/**
 * `convex/_generated/api.ts` exports `anyApi` here (this project's generated
 * file has not been pointed at a real deployment), which mints a BRAND NEW
 * Proxy on every property access — so `api.entries.listPage === api.entries.listPage`
 * is false even for what is logically the same function reference. Convex's
 * own `OptimisticLocalStore` implementation therefore compares queries by
 * their canonical dot-path name (`getFunctionName`), never by object
 * identity, and this fake must do the same or every branch below would look
 * "unmatched".
 */
function sameQuery(a: unknown, b: unknown): boolean {
  // `unknown` cannot satisfy getFunctionName's `FunctionReference` parameter
  // type without a cast; `any` is the narrowest one available here.
  return getFunctionName(a as any) === getFunctionName(b as any)
}

type OptimisticUpdateFn = (store: OptimisticLocalStore, args: unknown) => void

/**
 * `useConvexMutation(ref).withOptimisticUpdate(fn)` is the only seam
 * `insertEverywhere` and friends live behind — the hook module does not
 * export them. Mocking `useConvexMutation` captures the REAL `fn` the
 * module registers for each mutation, keyed by its function reference, so
 * the test drives the exact path a live undo does: `restore()` populates
 * `pendingRestore`, calls the (mocked) mutation, and the mock invokes the
 * captured optimistic-update callback against a fake `OptimisticLocalStore`
 * — the same shape Convex itself would call it with.
 *
 * `vi.hoisted` because `vi.mock`'s factory below is hoisted above this
 * file's imports, so it can only close over state created the same way.
 */
const { registerOptimisticUpdate, invokeOptimisticUpdate, setActiveStore } = vi.hoisted(() => {
  const registry = new Map<unknown, OptimisticUpdateFn>()
  let activeStore: OptimisticLocalStore | undefined
  return {
    registerOptimisticUpdate: (ref: unknown, fn: OptimisticUpdateFn) => {
      registry.set(ref, fn)
    },
    invokeOptimisticUpdate: (ref: unknown, args: unknown) => {
      if (activeStore !== undefined) registry.get(ref)?.(activeStore, args)
    },
    setActiveStore: (store: OptimisticLocalStore) => {
      activeStore = store
    },
  }
})

vi.mock("@convex-dev/react-query", () => ({
  useConvexMutation: (ref: unknown) => {
    const mutate = vi.fn(async (args: unknown) => {
      invokeOptimisticUpdate(ref, args)
      return null
    })
    // Mirrors the real return shape: a callable function carrying a
    // `withOptimisticUpdate` method, not a plain object.
    return Object.assign(mutate, {
      withOptimisticUpdate: (fn: OptimisticUpdateFn) => {
        registerOptimisticUpdate(ref, fn)
        return mutate
      },
    })
  },
}))

type Entry = Doc<"timeEntries">
type ListPageArgs = {
  fromMs: number
  toMs: number
  paginationOpts: { numItems: number; cursor: string | null; id?: number }
}
type ListPageValue = { page: Entry[]; isDone: boolean; continueCursor: string }
type ListPageRecord = { args: ListPageArgs; value: ListPageValue | undefined }

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    _id: "restored-entry" as unknown as Id<"timeEntries">,
    _creationTime: 1_700_000_000_000,
    userId: "user-1",
    clientKey: "client-1",
    title: "Restored entry",
    note: undefined,
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_003_600_000,
    durationMs: 3_600_000,
    projectId: undefined,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: 1_700_003_600_000,
    deletedAt: null,
    ...overrides,
  }
}

/**
 * Two `listPage` pages from ONE `usePaginatedQuery` subscription: same
 * fromMs/toMs, different `paginationOpts.cursor` (and the same client-managed
 * `id`) — exactly what clicking "Load earlier entries" once produces on
 * Timer. Each page is seeded with one existing row: `insertAtPosition` needs
 * an existing item in a loaded page to establish a sort-key reference — an
 * entirely empty page gives it nothing to insert relative to, so it is a
 * no-op.
 */
function makeTwoPageSubscription(fromMs: number, toMs: number): ListPageRecord[] {
  return [
    {
      args: { fromMs, toMs, paginationOpts: { numItems: 25, cursor: null, id: 1 } },
      value: {
        page: [makeEntry({ _id: `seed-newest-${fromMs}` as unknown as Id<"timeEntries">, startedAt: toMs - 1_000 })],
        isDone: false,
        continueCursor: "cursor-2",
      },
    },
    {
      args: { fromMs, toMs, paginationOpts: { numItems: 25, cursor: "cursor-2", id: 1 } },
      value: {
        page: [makeEntry({ _id: `seed-oldest-${fromMs}` as unknown as Id<"timeEntries">, startedAt: fromMs + 1_000 })],
        isDone: true,
        continueCursor: "cursor-2",
      },
    },
  ]
}

function makeFakeLocalStore(listPagePages: ListPageRecord[]): OptimisticLocalStore {
  return {
    getQuery: (query: unknown) => {
      if (sameQuery(query, api.entries.getRunning)) return null
      throw new Error("unexpected getQuery call in test fake")
    },
    getAllQueries: (query: unknown) => {
      if (sameQuery(query, api.entries.listPage)) return listPagePages
      if (sameQuery(query, api.entries.listRange)) return []
      if (sameQuery(query, api.entries.getRunning)) return []
      throw new Error("unexpected getAllQueries call in test fake")
    },
    setQuery: (query: unknown, args: unknown, value: unknown) => {
      if (sameQuery(query, api.entries.listPage)) {
        const record = listPagePages.find((r) => r.args === args)
        if (record !== undefined) record.value = value as ListPageValue
        return
      }
      throw new Error("unexpected setQuery call in test fake")
    },
    // `OptimisticLocalStore`'s methods are generic over the exact query
    // reference; this fake only ever needs the three api.entries.* queries
    // above, so it is structurally narrower than the real interface.
  } as unknown as OptimisticLocalStore
}

/**
 * Renders the hook without jsdom. `useEntryEditMutations` never depends on
 * an effect having run by the time this test reads its return value — see
 * `useLatest` in src/hooks/use-latest.ts, whose ref is already correct from
 * `useRef`'s initial value on a first render — so a pure server render is
 * enough to capture the callbacks. This file's `.test.ts` extension puts it
 * in vitest's "unit" project (node, no DOM), which is also why this avoids
 * `@testing-library/react`'s `renderHook` (it needs a real DOM container).
 */
function renderMutationsHook(): ReturnType<typeof useEntryEditMutations> {
  let captured: ReturnType<typeof useEntryEditMutations> | undefined
  function Harness() {
    captured = useEntryEditMutations()
    return null
  }
  renderToStaticMarkup(createElement(Harness))
  if (captured === undefined) throw new Error("hook did not run")
  return captured
}

function countCopies(records: ListPageRecord[], entryId: Id<"timeEntries">): number {
  return records.reduce(
    (sum, record) => sum + (record.value?.page.filter((row) => row._id === entryId).length ?? 0),
    0
  )
}

describe("useEntryEditMutations restore — paginated listPage", () => {
  it("inserts the restored entry into exactly one page, not every loaded page", async () => {
    const fromMs = 1_699_999_000_000
    const toMs = 1_700_100_000_000
    const listPagePages = makeTwoPageSubscription(fromMs, toMs)
    setActiveStore(makeFakeLocalStore(listPagePages))

    const { restore } = renderMutationsHook()
    // Older than every seeded row, so it belongs after the last (oldest) page.
    const entry = makeEntry({ startedAt: fromMs })

    await restore(entry)

    const pagesContainingEntry = listPagePages.filter((record) =>
      record.value?.page.some((row) => row._id === entry._id)
    )
    expect(pagesContainingEntry).toHaveLength(1)
    expect(countCopies(listPagePages, entry._id)).toBe(1)
  })

  it("does not insert into a listPage subscription whose range excludes the entry", async () => {
    const inRangeFrom = 1_700_000_000_000
    const inRangeTo = 1_700_100_000_000
    const otherRangeFrom = 1_600_000_000_000
    const otherRangeTo = 1_600_100_000_000

    const inRangePages = makeTwoPageSubscription(inRangeFrom, inRangeTo)
    const otherRangePages = makeTwoPageSubscription(otherRangeFrom, otherRangeTo)
    setActiveStore(makeFakeLocalStore([...inRangePages, ...otherRangePages]))

    const { restore } = renderMutationsHook()
    // Belongs to the first range only, and older than its seeded rows.
    const entry = makeEntry({ startedAt: inRangeFrom })

    await restore(entry)

    expect(countCopies(inRangePages, entry._id)).toBe(1)
    expect(countCopies(otherRangePages, entry._id)).toBe(0)
  })
})
