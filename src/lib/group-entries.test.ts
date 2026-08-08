import { describe, expect, it } from "vitest"
import { groupByDay, sumRange } from "./group-entries"
import type { Entry } from "./group-entries"

/*
 * Grouping had no tests, and it decides two things that are easy to get subtly
 * wrong: which day an entry lands in, and — since a running entry stopped being
 * a row — the deliberate disagreement between `entries` and `totalMs`.
 *
 * A running entry is already on screen in the timer bar, larger and live. A
 * second copy of it in the log is the same fact twice, and the copy is the worse
 * one. Its TIME still counts toward the day, because "today so far" is the
 * number people actually watch and a day total reading 0:00:00 while the bar
 * above it counts is how someone stops trusting both numbers.
 */

const HOUR = 3_600_000
const NOON_UTC = Date.UTC(2026, 7, 8, 12, 0, 0) // Sat 8 Aug 2026, 12:00 UTC

function entry(over: Partial<Entry> & { startedAt: number }): Entry {
  const durationMs = over.durationMs === undefined ? HOUR : over.durationMs
  return {
    _id: `id-${over.startedAt}-${Math.random()}` as Entry["_id"],
    _creationTime: 0,
    userId: "u",
    clientKey: `k-${over.startedAt}`,
    title: "Work",
    endedAt: durationMs === null ? null : over.startedAt + durationMs,
    durationMs,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: 0,
    deletedAt: null,
    ...over,
  }
}

/** A running entry: no duration, no end. */
const running = (over: Partial<Entry> & { startedAt: number }) =>
  entry({ ...over, durationMs: null })

describe("a running entry is not a row", () => {
  it("keeps a running entry out of the rendered entries", () => {
    const groups = groupByDay(
      [running({ startedAt: NOON_UTC - 60_000 })],
      "UTC",
      NOON_UTC
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].entries).toEqual([])
    expect(groups[0].runningCount).toBe(1)
  })

  it("still counts its elapsed time toward the day total", () => {
    const groups = groupByDay(
      [running({ startedAt: NOON_UTC - 90_000 })],
      "UTC",
      NOON_UTC
    )

    // No row, but the day is not empty — the total ticks with the timer bar.
    expect(groups[0].entries).toEqual([])
    expect(groups[0].totalMs).toBe(90_000)
  })

  it("counts a billable running entry toward the billable total", () => {
    const groups = groupByDay(
      [running({ startedAt: NOON_UTC - 30_000, billable: true })],
      "UTC",
      NOON_UTC
    )

    expect(groups[0].billableMs).toBe(30_000)
  })

  it("shows completed entries beside a running one, without the running one", () => {
    const groups = groupByDay(
      [
        entry({ startedAt: NOON_UTC - 5 * HOUR, title: "Finished" }),
        running({ startedAt: NOON_UTC - 60_000 }),
      ],
      "UTC",
      NOON_UTC
    )

    expect(groups[0].entries.map((e) => e.title)).toEqual(["Finished"])
    expect(groups[0].totalMs).toBe(HOUR + 60_000)
    expect(groups[0].runningCount).toBe(1)
  })

  it("appears as a row the moment it is stopped", () => {
    const started = NOON_UTC - 60_000

    const whileRunning = groupByDay([running({ startedAt: started })], "UTC", NOON_UTC)
    expect(whileRunning[0].entries).toHaveLength(0)

    const afterStopping = groupByDay(
      [entry({ startedAt: started, durationMs: 60_000 })],
      "UTC",
      NOON_UTC
    )
    expect(afterStopping[0].entries).toHaveLength(1)
    // And the total does not jump when it does — it was already counted.
    expect(afterStopping[0].totalMs).toBe(whileRunning[0].totalMs)
  })

  /**
   * The note count describes the ROWS. A running entry has nothing to say about
   * itself yet — the note is asked for when it stops — so counting it would make
   * the nudge permanently unsatisfiable while a timer is going.
   */
  it("excludes a running entry from the noted count denominator", () => {
    const groups = groupByDay(
      [
        entry({ startedAt: NOON_UTC - 5 * HOUR, note: "wrote the parser" }),
        running({ startedAt: NOON_UTC - 60_000 }),
      ],
      "UTC",
      NOON_UTC
    )

    expect(groups[0].notedCount).toBe(1)
    expect(groups[0].entries.length).toBe(1)
  })

  it("clamps a running entry started in the future to zero rather than going negative", () => {
    const groups = groupByDay(
      [running({ startedAt: NOON_UTC + 10_000 })],
      "UTC",
      NOON_UTC
    )

    expect(groups[0].totalMs).toBe(0)
  })
})

describe("grouping and labelling", () => {
  it("puts entries in local days, newest day first", () => {
    const groups = groupByDay(
      [
        entry({ startedAt: NOON_UTC - 48 * HOUR }),
        entry({ startedAt: NOON_UTC - 24 * HOUR }),
        entry({ startedAt: NOON_UTC }),
      ],
      "UTC",
      NOON_UTC
    )

    expect(groups.map((g) => g.day)).toEqual(["2026-08-08", "2026-08-07", "2026-08-06"])
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Thu 6 Aug"])
  })

  it("orders entries within a day newest first", () => {
    const groups = groupByDay(
      [
        entry({ startedAt: NOON_UTC - 5 * HOUR, title: "Morning" }),
        entry({ startedAt: NOON_UTC - HOUR, title: "Afternoon" }),
      ],
      "UTC",
      NOON_UTC
    )

    expect(groups[0].entries.map((e) => e.title)).toEqual(["Afternoon", "Morning"])
  })

  /**
   * Attribution is by START, and the day is the USER's. The same instant is a
   * different date in Auckland than in Los Angeles, and getting this wrong moves
   * work between invoices.
   */
  it("buckets by the user's timezone, not UTC", () => {
    // 23:30 UTC on 8 Aug is already 11:30 on 9 Aug in Auckland.
    const late = Date.UTC(2026, 7, 8, 23, 30)

    expect(groupByDay([entry({ startedAt: late })], "UTC", late)[0].day).toBe(
      "2026-08-08"
    )
    expect(
      groupByDay([entry({ startedAt: late })], "Pacific/Auckland", late)[0].day
    ).toBe("2026-08-09")
  })

  it("returns no groups at all for no entries", () => {
    expect(groupByDay([], "UTC", NOON_UTC)).toEqual([])
  })
})

describe("sumRange", () => {
  it("adds up totals across days, running time included", () => {
    const groups = groupByDay(
      [
        entry({ startedAt: NOON_UTC - 24 * HOUR, billable: true }),
        entry({ startedAt: NOON_UTC - 5 * HOUR }),
        running({ startedAt: NOON_UTC - 60_000 }),
      ],
      "UTC",
      NOON_UTC
    )

    expect(sumRange(groups)).toEqual({
      totalMs: 2 * HOUR + 60_000,
      billableMs: HOUR,
    })
  })

  it("is zero for no groups", () => {
    expect(sumRange([])).toEqual({ totalMs: 0, billableMs: 0 })
  })
})
