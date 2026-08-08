import { useSyncExternalStore } from "react"
import {
  getClockServerSnapshot,
  getClockSnapshot,
  getSkewMs,
  subscribeToClock,
} from "@/lib/clock"

/**
 * The current second, or `null` during server rendering and the very first
 * client render.
 *
 * Subscribing to seconds rather than to milliseconds is what keeps the cost
 * down: one re-render per second per subscribing component, and nothing else on
 * the page re-renders at all.
 */
export function useSecond(): number | null {
  return useSyncExternalStore(
    subscribeToClock,
    getClockSnapshot,
    getClockServerSnapshot
  )
}

/**
 * Minute granularity, for anything a screen reader might announce.
 *
 * A per-second `aria-label` or document title is announced by screen readers
 * once a second, which is unusable. Toggl provides an opt-out for the tab-title
 * clock for the same reason; this makes the default itself tolerable.
 */
export function useMinute(): number | null {
  const second = useSecond()
  return second === null ? null : Math.floor(second / 60)
}

/** A subscribe function that never fires, for a value that cannot change. */
function subscribeToNothing(): () => void {
  return () => {}
}

/**
 * Elapsed milliseconds for an entry.
 *
 * A completed entry needs no clock, and creates no subscription — so a page of
 * finished rows costs nothing per second.
 *
 * That has to be arranged by swapping the SUBSCRIBE function rather than by
 * returning early, which is the obvious version and does not work: a hook call
 * cannot sit behind a condition, so `useSecond()` followed by an early return
 * still registers every completed row as a listener. A month of history then
 * wakes two hundred components a second to recompute a number none of them will
 * repaint. The store is the same one either way; only the subscription differs.
 */
export function useElapsedMs(startedAt: number, endedAt: number | null): number {
  const running = endedAt === null
  const second = useSyncExternalStore(
    running ? subscribeToClock : subscribeToNothing,
    running ? getClockSnapshot : getClockServerSnapshot,
    getClockServerSnapshot
  )
  if (endedAt !== null) return endedAt - startedAt

  // On the server and during hydration the store has no value, so read the
  // clock directly. That is exactly as accurate as the subscribed path and
  // keeps the store's server snapshot a stable constant.
  const nowMs = second === null ? Date.now() : second * 1000
  return Math.max(0, nowMs + getSkewMs() - startedAt)
}
