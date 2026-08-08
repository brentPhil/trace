import { describe, expect, it } from "vitest"
import { rangeAfterMove } from "./optimistic-range"
import type { Entry } from "@/lib/group-entries"

/*
 * What a loaded day range should look like after an entry is re-dated.
 *
 * Extracted from the optimistic update so it can be tested at all — the hook
 * itself needs a live Convex store. The behaviour it exists for: `patchEverywhere`
 * re-sorts rows but never EVICTS one, so an entry moved to another day would sit
 * in the range it left until the server replied and the refetch corrected it.
 */

const HOUR = 3_600_000
const day = (n: number) => Date.parse(`2026-08-0${n}T00:00:00Z`)

const entry = (id: string, startedAt: number): Entry =>
  ({
    _id: id,
    _creationTime: startedAt,
    userId: "u",
    clientKey: id,
    title: id,
    startedAt,
    endedAt: startedAt + HOUR,
    durationMs: HOUR,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: startedAt,
    deletedAt: null,
  }) as unknown as Entry

// A range covering 6 August.
const sixth = { fromMs: day(6), toMs: day(7) }

describe("rangeAfterMove", () => {
  it("drops an entry that has moved out of the range", () => {
    const rows = [entry("a", day(6) + 9 * HOUR), entry("b", day(6) + 11 * HOUR)]
    const moved = { ...rows[0], startedAt: day(5) + 9 * HOUR }

    const next = rangeAfterMove(rows, sixth, moved)

    expect(next?.map((r) => r._id)).toEqual(["b"])
  })

  it("adds an entry that has moved INTO the range", () => {
    // The row is not in this range's list yet, because it belonged to another
    // day. Without this the entry vanishes from both days until the refetch.
    const rows = [entry("b", day(6) + 11 * HOUR)]
    const moved = {
      ...entry("a", day(5) + 9 * HOUR),
      startedAt: day(6) + 9 * HOUR,
    }

    const next = rangeAfterMove(rows, sixth, moved)

    expect(next?.map((r) => r._id)).toEqual(["b", "a"])
  })

  it("keeps the list newest-first", () => {
    const rows = [
      entry("late", day(6) + 15 * HOUR),
      entry("early", day(6) + 8 * HOUR),
    ]
    const moved = { ...rows[1], startedAt: day(6) + 20 * HOUR }

    const next = rangeAfterMove(rows, sixth, moved)

    expect(next?.map((r) => r._id)).toEqual(["early", "late"])
    expect(next?.[0].startedAt).toBeGreaterThan(next![1].startedAt)
  })

  it("returns null when the range is unaffected either way", () => {
    // Nothing to write. Setting an identical value would still invalidate every
    // subscriber of a range that has nothing to do with this entry.
    const rows = [entry("b", day(6) + 11 * HOUR)]
    const moved = {
      ...entry("a", day(4) + 9 * HOUR),
      startedAt: day(3) + 9 * HOUR,
    }

    expect(rangeAfterMove(rows, sixth, moved)).toBeNull()
  })

  it("treats the range as half-open at both ends", () => {
    // Midnight exactly belongs to the day that is beginning — the same rule
    // dayWindow uses, or an entry at 00:00 would appear on two days at once.
    const rows: Array<Entry> = []

    expect(rangeAfterMove(rows, sixth, entry("a", day(6)))?.length).toBe(1)
    expect(rangeAfterMove(rows, sixth, entry("a", day(7)))).toBeNull()
  })

  it("replaces rather than duplicates when the entry stays in range", () => {
    const rows = [entry("a", day(6) + 9 * HOUR)]
    const moved = { ...rows[0], startedAt: day(6) + 10 * HOUR }

    const next = rangeAfterMove(rows, sixth, moved)

    expect(next).toHaveLength(1)
    expect(next?.[0].startedAt).toBe(day(6) + 10 * HOUR)
  })
})
