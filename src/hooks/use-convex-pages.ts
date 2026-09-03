import { useCallback, useEffect, useMemo, useState } from "react"
import { useQueries, useQueryClient } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import type { FunctionArgs, FunctionReference, FunctionReturnType, PaginationResult } from "convex/server"

type LogStatus = "LoadingFirstPage" | "LoadingMore" | "CanLoadMore" | "Exhausted"

/**
 * Pagination that lives in the TanStack cache.
 *
 * `usePaginatedQuery` from convex/react keeps its pages in Convex's client
 * only, which the snapshot layer never sees — so the log was the one surface
 * with nothing to show offline. This holds a page count and subscribes to one
 * `convexQuery(listPage, …)` per page, chaining each page's cursor from the
 * previous page's `continueCursor`. Each page is its own cache entry, so it is
 * snapshotted, restored, and patched by the optimistic functions that already
 * walk `listPage` by name.
 *
 * `id: 1` in `paginationOpts` mirrors what `usePaginatedQuery` sends, which
 * is what `insertAtPosition` groups pages by.
 *
 * Starts at ONE page on every mount, deliberately: a restored second page's
 * cursor was minted against an older first page, and after new entries land
 * the two no longer meet. Older pages load again when asked for.
 *
 * The page options below carry ONLY the query key, never `convexQuery`'s
 * `queryFn` — that omission is what leaves the router's default
 * `snapshotQueryFn` in place for these pages, which is the entire reason this
 * hook exists: it is what lets the log render from IndexedDB while the socket
 * is down. Spreading `convexQuery(...)` wholesale to "simplify" this would
 * quietly undo that.
 *
 * Two limits worth knowing before reusing this elsewhere. `baseKey` is
 * `JSON.stringify(baseArgs)`, so args differing only in key order reset the
 * count spuriously. And the cursor chain above is a memo over the cache
 * rather than over the subscription results, so calling `loadMore()` while a
 * page is still in flight leaves `pages` short of `pageCount` until something
 * else invalidates the memo — reachable only from a caller that offers "load
 * more" outside the `CanLoadMore` state, which this one does not.
 */
export function useConvexPages<
  TQuery extends FunctionReference<"query", "public", any, PaginationResult<any>>,
>(
  query: TQuery,
  baseArgs: Omit<FunctionArgs<TQuery>, "paginationOpts"> | "skip",
  numItems: number
): {
  results: Array<FunctionReturnType<TQuery>["page"][number]>
  status: LogStatus
  loadMore: () => void
} {
  const queryClient = useQueryClient()
  const [pageCount, setPageCount] = useState(1)
  const baseKey = JSON.stringify(baseArgs)
  useEffect(() => setPageCount(1), [baseKey])

  // Chain as far as loaded pages allow: a page's args need the previous
  // page's cursor, which is only known once that page is in the cache.
  const pages = useMemo(() => {
    if (baseArgs === "skip") return []
    const list: Array<Record<string, unknown>> = []
    let cursor: string | null = null
    for (let i = 0; i < pageCount; i++) {
      const args: Record<string, unknown> = {
        ...(baseArgs as Record<string, unknown>),
        paginationOpts: { numItems, cursor, id: 1 },
      }
      list.push(args)
      const key = convexQuery(query, args as FunctionArgs<TQuery>).queryKey
      const data: PaginationResult<unknown> | undefined = queryClient.getQueryData(key)
      if (data === undefined) break
      cursor = data.continueCursor
    }
    return list
    // baseKey stands in for baseArgs; pageCount and the cache drive the rest.
  }, [baseKey, pageCount, numItems, query, queryClient])

  // `convexQuery`'s return type is a conditional keyed off whether the args
  // are literally `"skip"`, which `useQueries` cannot distribute over an
  // array built by `.map()` — narrowed to the one shape it actually needs
  // (`pages` never contains `"skip"`) so the array element type stays concrete.
  const queries = useQueries({
    queries: pages.map((args): { queryKey: readonly unknown[]; staleTime: number } => ({
      // `convexQuery` always sets `staleTime: Infinity` — a Convex
      // subscription pushes every update itself, so TanStack never needs to
      // refetch on its own. Read the key from it rather than hand-rolling one.
      queryKey: convexQuery(query, args as FunctionArgs<TQuery>).queryKey,
      staleTime: Infinity,
    })),
  })

  const loaded = queries.map((q) => q.data as PaginationResult<unknown> | undefined)
  const results = loaded.flatMap((p) => p?.page ?? []) as Array<FunctionReturnType<TQuery>["page"][number]>
  const last = loaded[loaded.length - 1]

  let status: LogStatus
  if (baseArgs === "skip") status = "Exhausted"
  else if (loaded[0] === undefined) status = "LoadingFirstPage"
  else if (loaded.length < pageCount || last === undefined) status = "LoadingMore"
  else if (last.isDone) status = "Exhausted"
  else status = "CanLoadMore"

  const loadMore = useCallback(() => {
    setPageCount((count) => count + 1)
  }, [])

  return { results, status, loadMore }
}
