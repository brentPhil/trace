import { useState } from "react"
import { useSecond } from "@/hooks/use-clock"
import { RUNNING_ENTRY } from "./sample-data"

/**
 * The sample running entry's elapsed seconds, ticking with the app's clock.
 *
 * ONE HOOK, so the timer bar and the day ruler can never disagree about how
 * long the sample entry has been running.
 *
 * THE TICK READS THE APP'S CLOCK, never a counter (src/lib/clock.ts: "never
 * accumulate"). `useSecond()` is null during server rendering and hydration,
 * so both paint the fixed sample value and agree; from the first real second
 * on, the figure is the sample value plus the seconds since then. It keeps
 * ticking under reduced motion, as the app's does — a running duration is
 * state, not decoration.
 *
 * `firstSecond` anchors to `Date.now()`, not to the store's snapshot: the
 * store only refreshes while something is subscribed, and nothing else on the
 * signed-out page subscribes, so on a remount its snapshot can be stale by
 * however long the visitor was away. Anchoring to the wall clock makes the
 * first frame correct instead of jumping once the store catches up.
 */
export function useRunningSeconds(): number {
  const second = useSecond()
  const [firstSecond, setFirstSecond] = useState<number | null>(null)
  // Adjusting state during render, React's documented pattern for "remember
  // the first value seen" — no effect, so no frame where it is missing.
  if (second !== null && firstSecond === null) {
    setFirstSecond(Math.floor(Date.now() / 1000))
  }

  return (
    RUNNING_ENTRY.elapsedSeconds +
    (second !== null && firstSecond !== null
      ? Math.max(0, second - firstSecond)
      : 0)
  )
}
