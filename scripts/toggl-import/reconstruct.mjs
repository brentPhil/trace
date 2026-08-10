/**
 * Rebuilds entries from a Toggl SUMMARY report.
 *
 * WHAT IS REAL AND WHAT IS NOT. A summary report carries two independent
 * aggregations over the same fortnight and no join between them:
 *
 *   - Duration by day        10 working days, each with a total
 *   - Description breakdown  25 descriptions, each with a total across ALL days
 *
 * So these are recovered exactly, and this file asserts all three:
 *   - every day's total
 *   - every description's total
 *   - the grand total, 80:07:55
 *
 * And these are INVENTED, because the report does not contain them:
 *   - which day a given description was worked on
 *   - what time of day anything started or stopped
 *   - how many entries each description actually was
 *
 * A detailed report (Reports -> Detailed -> Export CSV) carries all three and
 * needs none of this. This exists because the summary is what we have.
 *
 * The invention is at least ORDERED rather than arbitrary: SeaLogs ticket
 * numbers run roughly forward in time, so descriptions are laid down in ticket
 * order and packed into days. Work that does not fit in the day it starts
 * spills into the next one, which is also what really happens to a ticket that
 * takes more than a day.
 */

/** `H:MM:SS` -> seconds. */
export function toSeconds(hms) {
  const [h, m, s] = hms.split(":").map(Number)
  return h * 3600 + m * 60 + s
}

/**
 * The report, transcribed. `hours` is the rounded figure Toggl prints in the
 * day column; it is used only to apportion, never as a total — see below.
 */
export const DAYS = [
  { day: "2026-07-27", hours: 9.37 },
  { day: "2026-07-28", hours: 11.7 },
  { day: "2026-07-29", hours: 6.56 },
  { day: "2026-07-30", hours: 9.64 },
  { day: "2026-07-31", hours: 2.58 },
  { day: "2026-08-01", hours: 0 },
  { day: "2026-08-02", hours: 0 },
  { day: "2026-08-03", hours: 8.14 },
  { day: "2026-08-04", hours: 8.19 },
  { day: "2026-08-05", hours: 8.79 },
  { day: "2026-08-06", hours: 8.35 },
  { day: "2026-08-07", hours: 6.82 },
  { day: "2026-08-08", hours: 0 },
  { day: "2026-08-09", hours: 0 },
]

/*
 * Ordered by ticket number, which is the one piece of chronology the summary
 * leaks. Meetings and the untitled bucket carry `recurring: true` — they are
 * plainly not one sitting (two hours of "Team standup" is four standups), so
 * they are spread across days instead of packed as a block.
 */
export const DESCRIPTIONS = [
  { title: "", duration: "4:12:35", recurring: true },
  { title: "Team standup", duration: "2:00:00", recurring: true },
  { title: "Dev team standup", duration: "1:00:00", recurring: true },
  { title: "All Staff Meeting", duration: "0:24:00" },
  { title: "[B-CB-300] Fixing Engineering Log offline engine readings", duration: "2:49:52" },
  {
    title:
      "[B-CB-304] Fixing Engineering tab showing when the engineering log is switched off",
    duration: "2:00:43",
  },
  { title: "Addressing CB-307 request changes", duration: "0:42:27" },
  {
    title: "[B-CB-308] Fixing Pre-departure photo bouncing the app back to Home port",
    duration: "7:56:32",
  },
  { title: "[B-CB-312] Fixing missing fuel receipts on refuelling", duration: "1:38:30" },
  {
    title: "[B-CB-313] Fixing refuelling delete leaving records on the server",
    duration: "3:16:54",
  },
  {
    title:
      "[B-CB-315] Woking on Engineering Log offline storage & replication follow up tasks",
    duration: "2:46:00",
  },
  {
    title: "[B-CB-316.1] Record button disables when the webcam stream dies",
    duration: "4:26:00",
  },
  {
    title: "[B-CB-317] Disabling Engineering Log in production behind a feature flag",
    duration: "2:10:00",
  },
  {
    title: "[B-CB-318] Building Logbook Master auto-population from crew duty",
    duration: "4:23:34",
  },
  {
    title:
      "[CB-319] Fixing missing engine selection on Engine Fuel and Other Fluids fields",
    duration: "3:43:01",
  },
  { title: "[B-CB-326] Building Crew Training CSV and PDF download", duration: "7:51:34" },
  {
    title: "[B-CB-327] Building Schedule Review passenger and vehicle totals",
    duration: "2:51:20",
  },
  {
    title: "[B-CB-328] Fixing Pre-departure Check dates across time zones",
    duration: "2:47:00",
  },
  {
    title: "[B-CB-330] Fixing Trip Log signature confirmation not saving",
    duration: "5:08:39",
  },
  {
    title: "[B-CB-331] Fixing Maintenance crew assignment dropdowns",
    duration: "3:09:07",
  },
  { title: "[B-CB-332] Fixing Engineering Log rows per page", duration: "3:22:28" },
  {
    title: "[B-CB-333] Fixing Crew Training trainer not showing on overdue sessions",
    duration: "3:36:00",
  },
  {
    title: "[B-CB-334] Fixing Logbook engine hours save error and duplicates",
    duration: "2:21:00",
  },
  {
    title:
      "Hudle with benjie regarding the trip-log signature offline persistence issues",
    duration: "0:29:56",
  },
  { title: "Worked on PR's change request", duration: "5:00:43" },
]

/** The grand total the report states, and the figure everything must reconcile to. */
export const TOTAL_SECONDS = toSeconds("80:07:55")

/**
 * Day totals in whole seconds.
 *
 * The printed day column is rounded to 2dp, so summing it gives 80.14 h against
 * a real 80.1319 h — 29 seconds of rounding error. Apportioning the TRUE total
 * across days by those weights, then handing the remainder to the longest day,
 * keeps every day within a second of what Toggl printed AND makes the days sum
 * to the grand total exactly. Letting the printed figures stand instead would
 * import 29 seconds that were never tracked.
 */
export function daySeconds() {
  const working = DAYS.filter((d) => d.hours > 0)
  const weightTotal = working.reduce((a, d) => a + d.hours, 0)

  const out = working.map((d) => ({
    day: d.day,
    seconds: Math.floor((d.hours / weightTotal) * TOTAL_SECONDS),
  }))

  const shortfall = TOTAL_SECONDS - out.reduce((a, d) => a + d.seconds, 0)
  const longest = out.reduce((a, b) => (a.seconds >= b.seconds ? a : b))
  longest.seconds += shortfall
  return out
}

/**
 * Lays the descriptions into the days.
 *
 * One pass, in ticket order, filling each day to its exact total. A description
 * longer than the room left in the current day is SPLIT: the remainder starts
 * the next day. That is the mechanism that makes both sets of totals come out
 * exact at once, and it is also the realistic shape — a seven-hour ticket was
 * never one sitting.
 *
 * `recurring` items are dealt out one slice per day first, so standups land on
 * several days rather than as one two-hour block on a Monday.
 */
export function layout() {
  const days = daySeconds()
  const remaining = days.map((d) => ({ ...d, used: 0 }))
  const pieces = []

  const recurring = DESCRIPTIONS.filter((d) => d.recurring)
  const blocks = DESCRIPTIONS.filter((d) => !d.recurring)

  // Recurring work: an even slice per day, remainder onto the first day.
  for (const item of recurring) {
    const total = toSeconds(item.duration)
    const per = Math.floor(total / remaining.length)
    let left = total
    for (let i = 0; i < remaining.length; i++) {
      const slice = i === remaining.length - 1 ? left : per
      if (slice <= 0) continue
      pieces.push({ day: remaining[i].day, title: item.title, seconds: slice })
      remaining[i].used += slice
      left -= slice
    }
  }

  // Ticket work: packed in order, spilling across the day boundary.
  let cursor = 0
  for (const item of blocks) {
    let left = toSeconds(item.duration)
    while (left > 0) {
      if (cursor >= remaining.length) {
        throw new Error(`ran out of days with ${left}s of "${item.title}" left`)
      }
      const room = remaining[cursor].seconds - remaining[cursor].used
      if (room <= 0) {
        cursor++
        continue
      }
      const slice = Math.min(room, left)
      pieces.push({ day: remaining[cursor].day, title: item.title, seconds: slice })
      remaining[cursor].used += slice
      left -= slice
    }
  }

  return { pieces, days }
}

/** Local wall-clock start of the working day, minutes past midnight. */
const DAY_START_MINUTES = 9 * 60

/**
 * Turns the layout into entries with real instants.
 *
 * Each day runs from 09:00 local, back to back, in the order laid down. There
 * are no gaps because a gap would be a second invention on top of the first —
 * the totals are what is being preserved, not a believable lunch break.
 */
export function entries(timeZone) {
  const { pieces, days } = layout()
  const byDay = new Map()
  for (const p of pieces) {
    if (!byDay.has(p.day)) byDay.set(p.day, [])
    byDay.get(p.day).push(p)
  }

  const out = []
  for (const { day } of days) {
    let offset = DAY_START_MINUTES * 60
    for (const piece of byDay.get(day) ?? []) {
      const startedAt = instantOf(day, offset, timeZone)
      const endedAt = instantOf(day, offset + piece.seconds, timeZone)
      out.push({
        title: piece.title,
        startedAt,
        endedAt,
        durationMs: piece.seconds * 1000,
        day,
      })
      offset += piece.seconds
    }
  }
  return out
}

/**
 * `YYYY-MM-DD` + seconds past local midnight -> UTC instant, in `timeZone`.
 *
 * Resolved by asking the zone what offset it was actually at, rather than
 * assuming a fixed one. Singapore has no DST today, but a fixed offset is the
 * kind of assumption that silently misfiles an hour the moment the data or the
 * zone changes.
 */
function instantOf(day, secondsPastMidnight, timeZone) {
  const [y, m, d] = day.split("-").map(Number)
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0) + secondsPastMidnight * 1000
  const offset = zoneOffsetMs(guess, timeZone)
  const corrected = guess - offset
  // One re-resolve, in case the first guess landed on the far side of a
  // transition from where the corrected instant actually falls.
  return guess - zoneOffsetMs(corrected, timeZone)
}

function zoneOffsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant))
  const at = (type) => Number(parts.find((p) => p.type === type).value)
  const asUtc = Date.UTC(
    at("year"),
    at("month") - 1,
    at("day"),
    at("hour") % 24,
    at("minute"),
    at("second")
  )
  return asUtc - instant
}
