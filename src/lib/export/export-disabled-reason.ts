import type { Breakdown } from "@/lib/report-series"

/**
 * The one rule the export control enforces, and the priority order it
 * enforces it in.
 *
 * Extracted out of `reports.tsx` so this priority order — the single most
 * consequential rule on this page — has a unit test at all. `truncated`
 * outranks "empty" because a truncated scan's `count` is itself unproven: the
 * server stopped before reaching the end of the range, so a count of zero
 * describes only what it managed to look at, not the whole range. Reporting
 * "nothing tracked" there would assert something the scan was never in a
 * position to prove. Both outrank "loading", since a `breakdown` that has not
 * arrived yet, or is a stale placeholder from a previous range, cannot be
 * trusted to say anything about truncation or emptiness in the first place.
 */
export function exportDisabledReason(
  breakdown: Breakdown | undefined,
  isPlaceholderData: boolean
): string | null {
  if (breakdown === undefined || isPlaceholderData) {
    return "Still totalling this period."
  }
  if (breakdown.truncated) {
    return "This period is too large to total exactly — the figures are a floor, not the real total. Narrow the dates."
  }
  if (breakdown.count === 0) {
    return "Nothing tracked in this period."
  }
  return null
}
