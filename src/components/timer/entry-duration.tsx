import { useElapsedMs, useMinute } from "@/hooks/use-clock"
import { formatClock, msToIsoDuration, spokenDuration } from "@shared/duration"
import { cn } from "@/lib/utils"

/**
 * A duration, live if the entry is still running.
 *
 * This is the ONLY component that subscribes to the clock, which is what keeps
 * a ticking timer from re-rendering the entry list around it. A completed entry
 * creates no subscription at all, so a page of finished rows costs nothing per
 * second.
 */
export function EntryDuration({
  startedAt,
  endedAt,
  className,
}: {
  startedAt: number
  endedAt: number | null
  className?: string
}) {
  const ms = useElapsedMs(startedAt, endedAt)
  const minute = useMinute()
  const running = endedAt === null

  // Derived from the minute, not the second: an aria-label that changes every
  // second is announced every second, which is unusable. The visible digits
  // still tick.
  void minute
  const label = spokenDuration(ms)

  return (
    <time
      // role="timer" carries an implicit aria-live of "off", but state it
      // anyway — a live region here would narrate the whole working day.
      role={running ? "timer" : undefined}
      aria-live="off"
      aria-label={running ? `Running, ${label}` : label}
      dateTime={msToIsoDuration(ms)}
      // A clock is time-dependent text by definition; the server's value and
      // the client's are allowed to differ by a second.
      suppressHydrationWarning
      className={cn("tabular tracking-tight", className)}
    >
      {formatClock(ms)}
    </time>
  )
}
