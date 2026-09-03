import { act, renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { anyApi } from "convex/server"
import { describe, expect, it } from "vitest"
import { useConvexPages } from "./use-convex-pages"
import type { ReactNode } from "react"

const listPage = anyApi.entries.listPage
const page = (cursor: string | null) => [
  "convexQuery",
  "entries:listPage",
  { fromMs: 0, toMs: 10, paginationOpts: { numItems: 2, cursor, id: 1 } },
]

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { queryFn: () => new Promise(() => {}), staleTime: Infinity } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

/*
 * `client.setQueryData` writes the cache synchronously, but the `useQueries`
 * observer that reads it back is notified through TanStack's
 * `notifyManager`, which schedules via a real `setTimeout(0)` by default (the
 * app overrides this with `requestAnimationFrame` in `router.tsx`, still
 * asynchronously — see `notifyManager.setScheduler` there). A bare `act()`
 * around the cache write does not wait for that tick, so a test that reads
 * `result.current` right after needs one real macrotask first.
 *
 * `waitFor` is the more common idiom for this, but it hangs under fake timers
 * elsewhere in this repo (see `calendar-panel.test.tsx`'s header note) — this
 * matches the "one macrotask, explicitly" pattern that file already uses
 * instead, so no test in the suite depends on `waitFor` at all.
 */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
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

  it("starts over at one page when the range changes", () => {
    const { client, wrapper } = setup()
    const { result, rerender } = renderHook(
      ({ toMs }) => useConvexPages(listPage, { fromMs: 0, toMs }, 2),
      { wrapper, initialProps: { toMs: 10 } }
    )
    act(() => {
      client.setQueryData(page(null), { page: [1, 2], isDone: false, continueCursor: "c1" })
    })
    act(() => result.current.loadMore())
    rerender({ toMs: 20 })
    expect(result.current.status).toBe("LoadingFirstPage")
  })
})
