import { addDays, dayOf } from "@shared/day"
import type { Doc } from "../../convex/_generated/dataModel"

export type Entry = Doc<"timeEntries">

export type DayGroup = {
  /** "YYYY-MM-DD" in the user's timezone. */
  day: string
  /** "Today" / "Yesterday" / "Thu 6 Aug". */
  label: string
  /**
   * COMPLETED entries only — the rows the log renders.
   *
   * A running entry is deliberately absent. It is already on screen, larger and
   * live, in the timer bar; a second copy of it as a log row is the same fact
   * twice, and the copy is the worse one — it cannot be edited meaningfully, its
   * end time renders as an em dash, and it pushes the day's real work down. It
   * appears here the moment it is stopped, which is also the moment it becomes
   * a thing you can say something about.
   */
  entries: Array<Entry>
  /**
   * INCLUDES a running entry's elapsed time, unlike `entries`.
   *
   * The two disagree on purpose. The row is a duplicate of the timer bar; the
   * total is not — "today so far" is the number people check, and a day total
   * that ignored the timer currently running would read 0:00:00 while the bar
   * above it counted, which is the kind of disagreement that makes someone stop
   * trusting both numbers.
   */
  totalMs: number
  billableMs: number
  /** How many of `entries` carry a note — the day header's quiet nudge. */
  notedCount: number
  /** Running entries on this day. They are counted, never rendered as rows. */
  runningCount: number
}

/**
 * Groups entries into local days, newest first.
 *
 * Grouping happens on the client, from `startedAt` and the stored timezone,
 * because there is no stored day key. That also means a page boundary can never
 * split a day header from its rows: headers are derived from the rows present,
 * not fetched alongside them.
 *
 * A running entry contributes its elapsed time to the day total via `now`, so
 * the header ticks with the timer instead of jumping when it stops — but it is
 * kept OUT of `entries`, so it is never drawn as a row. See `DayGroup`.
 */
export function groupByDay(
  entries: Array<Entry>,
  timeZone: string,
  now: number
): Array<DayGroup> {
  const byDay = new Map<string, Array<Entry>>()

  for (const entry of entries) {
    const day = dayOf(entry.startedAt, timeZone)
    const bucket = byDay.get(day)
    if (bucket === undefined) byDay.set(day, [entry])
    else bucket.push(entry)
  }

  const today = dayOf(now, timeZone)
  const yesterday = addDays(today, -1)

  return [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, dayEntries]) => {
      dayEntries.sort((a, b) => b.startedAt - a.startedAt)

      const completed: Array<Entry> = []
      let totalMs = 0
      let billableMs = 0
      let notedCount = 0
      let runningCount = 0

      for (const entry of dayEntries) {
        const running = entry.durationMs === null
        const ms = entry.durationMs ?? Math.max(0, now - entry.startedAt)

        // Time is counted for BOTH; only completed entries become rows.
        totalMs += ms
        if (entry.billable) billableMs += ms

        if (running) {
          runningCount += 1
          continue
        }
        completed.push(entry)
        if ((entry.note ?? "").trim() !== "") notedCount++
      }

      return {
        day,
        label: dayLabel(day, today, yesterday),
        entries: completed,
        totalMs,
        billableMs,
        notedCount,
        runningCount,
      }
    })
}

/**
 * "Today" / "Yesterday" / "Thu 6 Aug".
 *
 * Relative labels only for the two days a person actually thinks of that way.
 * "3 days ago" is arithmetic the reader has to undo to find a date, which is
 * the opposite of what a log is for.
 */
function dayLabel(day: string, today: string, yesterday: string): string {
  if (day === today) return "Today"
  if (day === yesterday) return "Yesterday"

  const [year, month, date] = day.split("-").map(Number)
  // Formatted as a UTC instant at noon, not in the user's zone: the calendar
  // date is already decided, and noon is far enough from either boundary that
  // no DST shift can move the rendered weekday off it.
  const at = Date.UTC(year, month - 1, date, 12)
  const includeYear = day.slice(0, 4) !== today.slice(0, 4)

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(new Date(at))
}

/** Sum across every group — the "today" and "this week" numbers. */
export function sumRange(groups: Array<DayGroup>): {
  totalMs: number
  billableMs: number
} {
  let totalMs = 0
  let billableMs = 0
  for (const group of groups) {
    totalMs += group.totalMs
    billableMs += group.billableMs
  }
  return { totalMs, billableMs }
}
