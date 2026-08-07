import { useEffect, useRef } from "react"
import { useMinute } from "@/hooks/use-clock"
import { useEntryMutations } from "@/hooks/use-entry-mutations"
import { getSkewMs } from "@/lib/clock"
import { readPendingStart, shouldReplay } from "@/lib/pending-start"
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

/**
 * Re-sends a start that was recorded locally but never confirmed by the server.
 *
 * Runs once the server's answer is known. The guard is the important part: a
 * replay only happens when the server says nothing is running, because if
 * something IS running then either the original start landed after all or the
 * user has since started something else, and inserting here would put a
 * duplicate on their invoice.
 */
export function useReplayPendingStart(running: Doc<"timeEntries"> | null): void {
  const { replayStart } = useEntryMutations()
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return

    const pending = readPendingStart()
    if (!shouldReplay(pending, running !== null, Date.now())) {
      // Nothing to do, and nothing to retry later either — the answer will not
      // change without a new start, which records its own intent.
      attempted.current = true
      return
    }

    attempted.current = true
    void replayStart(pending).catch(() => {
      // Left in storage on failure, so the next load tries again. This is the
      // one path where giving up would lose recorded time silently.
      attempted.current = false
    })
  }, [running, replayStart])
}
