import { useEffect, useRef } from "react"
import { useMinute } from "@/hooks/use-clock"
import { getSkewMs } from "@/lib/clock"
import { formatCompactDuration } from "@shared/duration"
import type { Doc } from "../../convex/_generated/dataModel"

/**
 * Puts the running duration in the browser tab title.
 *
 * The one ambient "a timer is running" signal a web app has, and the thing that
 * prevents the overnight-timer failure — you see it on a tab you are not
 * looking at.
 *
 * Updated at MINUTE granularity, not per second. A document title that changes
 * every second is announced by screen readers every second, which makes the
 * whole page unusable; Toggl ships an opt-out of its tab clock for exactly this
 * reason, and minute granularity makes the default itself tolerable.
 */
export function useTabTitleClock(
  running: Doc<"timeEntries"> | null,
  enabled = true
): void {
  const minute = useMinute()
  const originalTitle = useRef<string | null>(null)

  useEffect(() => {
    if (originalTitle.current === null) {
      originalTitle.current = document.title
    }
    const original = originalTitle.current

    if (!enabled || running === null) {
      document.title = original
      return
    }

    const elapsed = Math.max(0, Date.now() + getSkewMs() - running.startedAt)
    const label = running.title.trim() === "" ? "Untitled" : running.title.trim()
    document.title = `${formatCompactDuration(elapsed)} · ${label}`

    return () => {
      document.title = original
    }
  }, [minute, running, enabled])
}
