import { useElapsedMs } from "@/hooks/use-clock"
import { formatClock, msToIsoDuration, spokenDuration } from "@shared/duration"
import { cn } from "@/lib/utils"
import type { ComponentProps } from "react"

/**
 * A duration, live if the entry is still running.
 *
 * Only a RUNNING entry subscribes to the clock, which is what keeps a ticking
 * timer from re-rendering the entry list around it. A completed entry creates no
 * subscription at all, so a page of finished rows costs nothing per second — see
 * `useElapsedMs`, where that is arranged.
 */
export function EntryDuration({
  startedAt,
  endedAt,
  className,
  ...rest
}: {
  startedAt: number
  endedAt: number | null
  className?: string
  /* The rest spread exists for `data-*` marks — `EditableDuration` stamps
     `data-log-cell="duration"` so the log's duration column stays queryable,
     while the timer bar's use of this same component stays unmarked. */
} & Omit<ComponentProps<"time">, "children">) {
  const ms = useElapsedMs(startedAt, endedAt)
  const running = endedAt === null

  // `spokenDuration` is minute-granular above a minute, so the label is already
  // stable second to second without being derived from a separate minute clock.
  // An earlier version subscribed to `useMinute()` to arrange that and then
  // discarded the value — a second subscription, and a wasted re-render per row
  // per second, buying a property the formatter already had.
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
      className={cn("font-mono tabular-nums tracking-[-0.02em] tracking-tight", className)}
      {...rest}
    >
      {formatClock(ms)}
    </time>
  )
}
