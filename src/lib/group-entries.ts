import { addDays, dayOf } from "@shared/day"
import type { Doc } from "../../convex/_generated/dataModel"

export type Entry = Doc<"timeEntries">

export type DayGroup = {
  /** "YYYY-MM-DD" in the user's timezone. */
  day: string
  /** "Today" / "Yesterday" / "Thu, 6 Aug". */
  label: string
  entries: Array<Entry>
  totalMs: number
  billableMs: number
  /** How many carry a note — the day header's quiet nudge. */
  notedCount: number
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
 * the header ticks with the timer instead of jumping when it stops.
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

      let totalMs = 0
      let billableMs = 0
      let notedCount = 0
      for (const entry of dayEntries) {
        const ms =
          entry.durationMs ?? Math.max(0, now - entry.startedAt) // running
        totalMs += ms
        if (entry.billable) billableMs += ms
        if ((entry.note ?? "").trim() !== "") notedCount++
      }

      return {
        day,
        label: dayLabel(day, today, yesterday),
        entries: dayEntries,
        totalMs,
        billableMs,
        notedCount,
      }
    })
}

/**
 * "Today" / "Yesterday" / "Thu, 6 Aug".
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
