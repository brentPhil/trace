import { groupByDay, sumRange } from "@/lib/group-entries"
import type { Entry } from "@/lib/group-entries"
import type { DayString } from "@shared/day"

/**
 * The "Today" and "This week" figures.
 *
 * Takes the rows of a WEEK-BOUNDED query, deliberately. The Timer page's list is
 * paginated, and totalling the loaded pages would produce a number that silently
 * means "of what has been fetched so far" — which is the figure that reaches an
 * invoice understated with nothing on screen to reveal it. Because the paginated
 * list is not an argument here, that mistake is not expressible.
 *
 * Running entries contribute their elapsed time, so these tick with the bar.
 */
export function periodTotals(
  weekEntries: Array<Entry>,
  timeZone: string,
  today: DayString,
  now: number
): { todayMs: number; weekMs: number; billableMs: number } {
  const groups = groupByDay(weekEntries, timeZone, now)
  const week = sumRange(groups)
  return {
    todayMs: groups.find((group) => group.day === today)?.totalMs ?? 0,
    weekMs: week.totalMs,
    billableMs: week.billableMs,
  }
}
