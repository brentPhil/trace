import { act, renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { anyApi } from "convex/server"
import { describe, expect, it } from "vitest"
import { useConvexPages } from "./use-convex-pages"
import type { ReactNode } from "react"

const listPage = anyApi.entries.listPage
const pageFor = (toMs: number, cursor: string | null) => [
  "convexQuery",
  "entries:listPage",
  { fromMs: 0, toMs, paginationOpts: { numItems: 2, cursor, id: 1 } },
]
const page = (cursor: string | null) => pageFor(10, cursor)

/** One macrotask. TanStack's notifyManager schedules observer updates through
 *  a real `setTimeout(0)`, so a bare `act()` leaves `result.current` stale.
 *  The same idiom as `src/components/music/music-provider.test.tsx` and
 *  `src/routes/_authed/-timer.test.tsx`. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { queryFn: () => new Promise(() => {}), staleTime: Infinity } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe("useConvexPages", () => {
  it("loads the first page, then chains cursors as pages arrive", async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useConvexPages(listPage, { fromMs: 0, toMs: 10 }, 2), { wrapper })
    expect(result.current.status).toBe("LoadingFirstPage")

    act(() => {
      client.setQueryData(page(null), { page: [1, 2], isDone: false, continueCursor: "c1" })
    })
    await flush()
    expect(result.current.results).toEqual([1, 2])
    expect(result.current.status).toBe("CanLoadMore")

    act(() => result.current.loadMore())
    expect(result.current.status).toBe("LoadingMore")

    act(() => {
      client.setQueryData(page("c1"), { page: [3], isDone: true, continueCursor: "end" })
    })
    await flush()
    expect(result.current.results).toEqual([1, 2, 3])
    expect(result.current.status).toBe("Exhausted")
  })

  it("is exhausted and empty when skipped", () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useConvexPages(listPage, "skip", 2), { wrapper })
    expect(result.current.results).toEqual([])
    expect(result.current.status).toBe("Exhausted")
  })

  it("starts over at one page when the range changes", async () => {
    // Asserting `LoadingFirstPage` after the rerender proves nothing: the new
    // range's first page is uncached either way, and that branch is checked
    // before the page count is consulted. So the new range's first page is
    // seeded, and the assertion is that ONE page is enough — with the reset
    // deleted the chain still wants three, `loaded.length < pageCount` holds,
    // and the log wedges in LoadingMore with no button and no recovery.
    const { client, wrapper } = setup()
    const { result, rerender } = renderHook(
      ({ toMs }) => useConvexPages(listPage, { fromMs: 0, toMs }, 2),
      { wrapper, initialProps: { toMs: 10 } }
    )
    act(() => {
      client.setQueryData(page(null), { page: [1, 2], isDone: false, continueCursor: "c1" })
    })
    act(() => result.current.loadMore())
    act(() => {
      client.setQueryData(page("c1"), { page: [3], isDone: false, continueCursor: "c2" })
    })
    act(() => result.current.loadMore())
    expect(result.current.status).toBe("LoadingMore")

    client.setQueryData(pageFor(20, null), { page: [9], isDone: false, continueCursor: "d1" })
    rerender({ toMs: 20 })
    await flush()

    expect(result.current.results).toEqual([9])
    expect(result.current.status).toBe("CanLoadMore")
  })
})
