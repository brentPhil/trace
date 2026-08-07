const cache = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string, use12Hour: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${use12Hour}`
  let f = cache.get(key)
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: use12Hour ? "numeric" : "2-digit",
      minute: "2-digit",
      hour12: use12Hour,
    })
    cache.set(key, f)
  }
  return f
}

/** `09:12` / `9:12 AM`, in the user's stored zone — never the browser's. */
export function formatTimeOfInstant(
  instantMs: number,
  timeZone: string,
  use12Hour: boolean
): string {
  return formatter(timeZone, use12Hour).format(new Date(instantMs)).toUpperCase()
}

/**
 * `09:12 – 10:58`, or `09:12 – …` while running.
 *
 * An en dash rather than a hyphen, and a real ellipsis for the open end: the
 * running entry has no end time yet, and printing "now" would be a value that
 * looks recorded when it is not.
 */
export function formatTimeRange(
  startedAt: number,
  endedAt: number | null,
  timeZone: string,
  use12Hour: boolean
): string {
  const start = formatTimeOfInstant(startedAt, timeZone, use12Hour)
  if (endedAt === null) return `${start} – …`
  return `${start} – ${formatTimeOfInstant(endedAt, timeZone, use12Hour)}`
}
