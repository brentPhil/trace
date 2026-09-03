import { getFunctionName } from "convex/server"
import type { QueryClient } from "@tanstack/react-query"
import type { OptimisticLocalStore } from "convex/browser"
import type { FunctionArgs, FunctionReference, FunctionReturnType, OptionalRestArgs } from "convex/server"

/**
 * Convex's `OptimisticLocalStore` interface, over the TanStack cache.
 *
 * Convex's own store only patches queries it has loaded from the server, so
 * on an offline boot it has nothing to patch. This lets the SAME optimistic
 * function each mutation already has run against what is actually on screen
 * — the TanStack cache, restored from snapshots — which is also what gets
 * persisted. One function, two stores; never two functions.
 *
 * Keys follow `convexQuery()` from @convex-dev/react-query exactly:
 * `["convexQuery", <canonical function name>, <args>]`. `findAll` matches the
 * two-element prefix, which is how every page of `listPage` is found by name.
 */
export class TanStackLocalStore implements OptimisticLocalStore {
  constructor(private readonly queryClient: QueryClient) {}

  getQuery<TQuery extends FunctionReference<"query">>(
    query: TQuery,
    ...args: OptionalRestArgs<TQuery>
  ): undefined | FunctionReturnType<TQuery> {
    const queryArgs = args[0] ?? {}
    return this.queryClient.getQueryData(["convexQuery", getFunctionName(query), queryArgs])
  }

  getAllQueries<TQuery extends FunctionReference<"query">>(
    query: TQuery
  ): Array<{ args: FunctionArgs<TQuery>; value: undefined | FunctionReturnType<TQuery> }> {
    const name = getFunctionName(query)
    return this.queryClient
      .getQueryCache()
      .findAll({ queryKey: ["convexQuery", name] })
      .filter((q) => q.queryKey[2] !== "skip")
      .map((q) => ({
        args: q.queryKey[2],
        value: q.state.data,
      }))
  }

  setQuery<TQuery extends FunctionReference<"query">>(
    query: TQuery,
    args: FunctionArgs<TQuery>,
    value: undefined | FunctionReturnType<TQuery>
  ): void {
    // `setQueryData(key, undefined)` is a no-op in TanStack; say so here
    // rather than letting a caller believe it unset something.
    if (value === undefined) return
    this.queryClient.setQueryData(["convexQuery", getFunctionName(query), args], value)
  }
}
