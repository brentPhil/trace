import { formatShortDate, formatTimeOfInstant } from "@/lib/format-time"
import { daysBetween } from "@/lib/history-filters"
import { dayOf } from "@shared/day"
import { MAX_DURATION_MS } from "@shared/duration"

/**
 * The staged start: "when Play is pressed, begin the entry HERE rather than
 * now."
 *
 * Extracted from `timer-bar.tsx`, where both halves reached for `Date.now()`
 * internally and were module-private — so the only way to reach them was
 * through the DOM, and the only way to re-evaluate the staleness rule in a
 * test was to type a character into an unrelated field. `nowMs` is a
 * parameter here for the same reason it is in `date-range-picker.ts`,
 * `month-grid.ts` and `entryTimes.ts`: date arithmetic that reads the clock
 * itself cannot be pinned.
 */

/**
 * How far into the past a staged start may reach.
 *
 * Tied to the backend's own ceiling rather than picked here. Past it, Play
 * would create a running entry that trips the runaway banner immediately and,
 * once stopped, exceeds `MAX_DURATION_MS` — at which point `capEditedDuration`
 * refuses every start/end edit that does not first bring it back under 24
 * hours, so the entry is only recoverable by someone who knows that rule.
 */
export const MAX_STAGED_AGE_MS = MAX_DURATION_MS

/**
 * Whether a staged start is still current enough to honour.
 *
 * Two independent rules, because they catch two different mistakes:
 *
 *   WHEN IT WAS STAGED. Anchored to the local day the value was set on, so a
 *   deliberately-picked past or future time survives normally through the rest
 *   of the session it was set in. Only a tab genuinely left open past local
 *   midnight loses it — the same "a tab left open since yesterday must not
 *   offer yesterday's moment today" reasoning `IdleDurationPopover` applies to
 *   its own reseed-on-open, applied to the stage itself.
 *
 *   WHAT IT TARGETS. The calendar in that popover can page to any month, and
 *   the rule above cannot see that at all: an instant staged five minutes ago
 *   for a date in June is perfectly fresh by it. So the age of the TARGET is
 *   bounded too.
 */
export function resolveStagedStart(
  stagedStartAt: number | null,
  stagedStartSetAt: number | null,
  timeZone: string,
  nowMs: number
): number | null {
  if (stagedStartAt === null || stagedStartSetAt === null) return null
  if (dayOf(stagedStartSetAt, timeZone) !== dayOf(nowMs, timeZone)) return null
  if (nowMs - stagedStartAt > MAX_STAGED_AGE_MS) return null
  return stagedStartAt
}

/**
 * What the bar's armed row says: `4:06 AM`, or
 * `9:00 AM on 6 Aug (yesterday)` when the staged day is not today.
 *
 * The distance is spelled out as well as the date. "9:00 AM on 6 Aug" reads
 * as a time someone might well have meant; "(3 days ago)" is what makes an
 * accidental backdate legible without doing calendar arithmetic in your head.
 */
export function describeStagedStart(
  instantMs: number,
  timeZone: string,
  use12Hour: boolean,
  nowMs: number
): string {
  const time = formatTimeOfInstant(instantMs, timeZone, use12Hour)
  const today = dayOf(nowMs, timeZone)
  const stagedDay = dayOf(instantMs, timeZone)
  if (stagedDay === today) return time
  const date = formatShortDate(instantMs, timeZone)
  return `${time} on ${date} (${relativeDay(daysBetween(today, stagedDay))})`
}

/** "yesterday", "in 5 days" — never a bare number of days in either direction. */
function relativeDay(delta: number): string {
  if (delta === -1) return "yesterday"
  if (delta === 1) return "tomorrow"
  if (delta < 0) return `${-delta} days ago`
  return `in ${delta} days`
}
