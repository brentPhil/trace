import type { Entry } from "@/lib/group-entries"

/**
 * What a loaded `listRange` page should hold after an entry is re-dated.
 *
 * Every other edit leaves a row where it was, so the optimistic layer can patch
 * in place and re-sort. Re-dating is the one that moves a row BETWEEN ranges: it
 * has to leave the day it was on and appear on the day it went to, and a patch
 * that only rewrites the row it finds does neither.
 *
 * Returns `null` when this range is unaffected, so the caller can skip the
 * write. Setting an identical value would still invalidate every subscriber of
 * a range that has nothing to do with the entry.
 *
 * Pure, and separate from the hook, because the hook needs a live Convex store
 * and this is the part with the edge cases in it.
 */
export function rangeAfterMove(
  rows: Array<Entry>,
  range: { fromMs: number; toMs: number },
  moved: Entry
): Array<Entry> | null {
  const without = rows.filter((row) => row._id !== moved._id)
  const wasHere = without.length !== rows.length
  // Half-open, matching dayWindow. An entry starting exactly at midnight
  // belongs to the day beginning, and to exactly one day.
  const belongsHere =
    moved.startedAt >= range.fromMs && moved.startedAt < range.toMs

  if (!wasHere && !belongsHere) return null

  if (!belongsHere) return without
  return [...without, moved].sort((a, b) => b.startedAt - a.startedAt)
}
