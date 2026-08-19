import { useCallback, useEffect, useRef } from "react"

/**
 * A permanently stable function that always calls the newest `fn`.
 *
 * Convex's `useMutation` is memoised, but `.withOptimisticUpdate(fn)` calls
 * `createMutation` again and hands back a BRAND NEW function on every render.
 * Anything that puts such a mutation in a `useCallback` dependency array
 * therefore produces a new callback every render too, and any effect depending
 * on that callback re-runs every render.
 *
 * For a debounced effect that is not a performance question, it is a
 * correctness one: the effect's cleanup cancels the pending timer, so the
 * debounce is re-armed on every render and only fires if the component happens
 * to sit still for longer than the delay. That works until something makes the
 * parent re-render faster, at which point the write silently stops happening
 * and nothing in the types or the tests notices.
 *
 * The ref is updated in an effect rather than during render, so a concurrent
 * render that is thrown away cannot publish its mutation. Before the first
 * effect flushes, `ref.current` is the first render's mutation — a perfectly
 * valid one — so there is no window where this returns something unusable.
 */
export function useLatest<TArgs extends Array<unknown>, TResult>(
  fn: (...args: TArgs) => TResult
): (...args: TArgs) => TResult {
  const ref = useRef(fn)

  useEffect(() => {
    ref.current = fn
  })

  return useCallback((...args: TArgs) => ref.current(...args), [])
}
