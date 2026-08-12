import { describe, expect, it } from "vitest"
import { calendarEvents, dayTotals, drawnDays, rangeOf } from "./calendar-events"
import type { Doc } from "../../convex/_generated/dataModel"

/*
 * The mapping into FullCalendar, and the day totals beside it.
 *
 * Tested here rather than through the grid because a pure function is the
 * cheaper place to pin a mapping down, NOT because the grid is untestable:
 * `calendar-panel.test.tsx` renders it in jsdom and asserts what it draws. Only
 * element geometry is genuinely out of reach there.
 */

const UTC = "UTC"

/** A completed entry. Only the fields this module reads are populated. */
function entry(over: Partial<Doc<"timeEntries">>): Doc<"timeEntries"> {
  return {
    _id: "e1",
    _creationTime: 0,
    userId: "u1",
    title: "Fixing the logbook",
    startedAt: Date.UTC(2026, 7, 10, 9, 0),
    endedAt: Date.UTC(2026, 7, 10, 10, 0),
    projectId: undefined,
    tagIds: [],
    billable: false,
    note: undefined,
    clientKey: "k1",
    deletedAt: null,
    ...over,
  } as unknown as Doc<"timeEntries">
}

const NOW = Date.UTC(2026, 7, 10, 12, 0)

describe("calendarEvents", () => {
  it("carries absolute instants, not wall-clock strings", () => {
    // An ISO string without an offset is interpreted in the calendar's own
    // timeZone. That is right by accident until something reads the field a
    // different way, so the contract is a Date built from the stored instant.
    const [event] = calendarEvents([entry({})], NOW)
    expect(event.start).toBeInstanceOf(Date)
    expect((event.start as Date).getTime()).toBe(Date.UTC(2026, 7, 10, 9, 0))
    expect((event.end as Date).getTime()).toBe(Date.UTC(2026, 7, 10, 10, 0))
  })

  it("ends a running entry at now", () => {
    const [event] = calendarEvents([entry({ endedAt: null })], NOW)
    expect((event.end as Date).getTime()).toBe(NOW)
    // The drawn `end` moves with the clock; the CARRIED one stays null, which
    // is what tells the panel the entry is running and what makes its block
    // print an elapsed clock rather than a closing time it does not have.
    expect(event.extendedProps.endedAt).toBeNull()
  })

  it("floors a zero-length entry to one minute", () => {
    // FullCalendar drops an event whose end equals its start. A row that
    // exists must be visible, or it cannot be edited from this view at all.
    const at = Date.UTC(2026, 7, 10, 9, 0)
    const [event] = calendarEvents([entry({ startedAt: at, endedAt: at })], NOW)
    expect((event.end as Date).getTime()).toBe(at + 60_000)
  })

  it("carries the project, the stored instants and the id, and nothing else", () => {
    /*
     * `billable` used to ride along here "for styling" and nothing ever read
     * it. Blocks take no hue at all — the Two Temperatures Rule spends warm on
     * the money figures, not on a grid — so there was nothing for it to feed.
     * The key list is asserted, not just the values: a field written and never
     * read is how the next one gets added.
     */
    const [event] = calendarEvents(
      [entry({ projectId: "p1" as never, billable: true })],
      NOW
    )
    expect(Object.keys(event.extendedProps).sort()).toEqual([
      "endedAt",
      "entryId",
      "projectId",
      "startedAt",
    ])
    expect(event.extendedProps.projectId).toBe("p1")
    expect(event.extendedProps.startedAt).toBe(Date.UTC(2026, 7, 10, 9, 0))
    expect(event.extendedProps.endedAt).toBe(Date.UTC(2026, 7, 10, 10, 0))
    expect(event.id).toBe("e1")
  })
})

describe("rangeOf", () => {
  /*
   * The page's whole answer to "which window am I looking at" — the Convex
   * query's two instants, the label's two ends, and the days "Range total" is
   * allowed to sum, from one computation.
   *
   * The matrix that matters (all seven `weekStartDay`s against all seven
   * anchors, asserted against the columns the real grid draws) lives in
   * `calendar-range-label.test.tsx`. What is here is the arithmetic itself:
   * the working week's Monday, the stored week start, and the two instants.
   */
  it("gives a day view exactly its anchor", () => {
    expect(rangeOf("2026-08-12", "day", 1, UTC)).toEqual({
      fromMs: Date.UTC(2026, 7, 12),
      toMs: Date.UTC(2026, 7, 13),
      days: ["2026-08-12"],
    })
  })

  it("opens a week on the stored week start", () => {
    // Wednesday the 12th, with the week starting on Sunday: Sun 9 – Sat 15.
    expect(rangeOf("2026-08-12", "week", 0, UTC)).toEqual({
      fromMs: Date.UTC(2026, 7, 9),
      toMs: Date.UTC(2026, 7, 16),
      days: [
        "2026-08-09",
        "2026-08-10",
        "2026-08-11",
        "2026-08-12",
        "2026-08-13",
        "2026-08-14",
        "2026-08-15",
      ],
    })
  })

  it("is Monday to Friday for 5 days, whatever the week starts on", () => {
    /*
     * THE ASSERTION THIS FUNCTION EXISTS FOR. 5 days is the working week and
     * the working week is Mon–Fri by definition; the view exists to hide the
     * weekend, and rotating it by `weekStartDay` would make it mean something
     * else on a Sunday-start calendar. `/settings` offers all seven starts, so
     * every row here is reachable.
     */
    const WORKING_WEEK = [
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
    ]
    for (const weekStartDay of [0, 1, 2, 3, 4, 5, 6]) {
      const range = rangeOf("2026-08-12", "5day", weekStartDay, UTC)
      expect({ weekStartDay, days: range.days }).toEqual({
        weekStartDay,
        days: WORKING_WEEK,
      })
      expect(range.fromMs).toBe(Date.UTC(2026, 7, 10))
      // Exclusive: the midnight that ENDS Friday, not the one that opens it.
      expect(range.toMs).toBe(Date.UTC(2026, 7, 15))
    }
  })

  it("resolves both ends in the stored zone", () => {
    // Manila is UTC+8, so a local Monday midnight is 16:00 UTC the day before.
    const range = rangeOf("2026-08-12", "week", 1, "Asia/Manila")
    expect(range.fromMs).toBe(Date.parse("2026-08-09T16:00:00Z"))
    expect(range.toMs).toBe(Date.parse("2026-08-16T16:00:00Z"))
  })

  it("spans a DST boundary without losing or repeating an hour", () => {
    // 8 March 2026, America/New_York: 02:00 does not exist, so this week is
    // 167 hours long. `+ 7 * 86_400_000` would put `toMs` an hour late and
    // drag the following Sunday's first hour into the range.
    const range = rangeOf("2026-03-09", "week", 0, "America/New_York")
    expect(range.days[0]).toBe("2026-03-08")
    expect(range.toMs - range.fromMs).toBe(167 * 3_600_000)
  })
})

describe("drawnDays", () => {
  /*
   * What "Range total" is allowed to sum. The 5-day view hides two weekdays
   * INSIDE its own range, so the range's width and the number of columns are
   * different questions — and summing the first while the header draws the
   * second is how a total comes to describe days that have no column.
   */
  const week = { fromMs: Date.UTC(2026, 7, 10), toMs: Date.UTC(2026, 7, 17) }

  it("lists every day a full week draws", () => {
    expect(drawnDays(week.fromMs, week.toMs, UTC, [])).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
    ])
  })

  it("drops the hidden weekdays wherever in the range they fall", () => {
    // Interior, not merely at the ends — which is the case FullCalendar's own
    // `hiddenDays` trimming does NOT handle, and why `calendar-panel.tsx`
    // pins `firstDay` to Monday for that size.
    expect(drawnDays(week.fromMs, week.toMs, UTC, [0, 6])).toEqual([
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
    ])
  })

  it("treats toMs as exclusive", () => {
    // The last day is the one holding the millisecond before `toMs`, never the
    // midnight that opens the day after it.
    const day = { fromMs: Date.UTC(2026, 7, 10), toMs: Date.UTC(2026, 7, 11) }
    expect(drawnDays(day.fromMs, day.toMs, UTC, [])).toEqual(["2026-08-10"])
  })

  it("reads the days in the stored zone, not the browser's", () => {
    // Manila is UTC+8: this window is 08:00 on the 10th to 08:00 on the 11th
    // there, so it touches two local days rather than one.
    expect(
      drawnDays(Date.UTC(2026, 7, 10), Date.UTC(2026, 7, 11), "Asia/Manila", [])
    ).toEqual(["2026-08-10", "2026-08-11"])
  })

  it("answers with nothing for an empty window", () => {
    expect(drawnDays(week.toMs, week.fromMs, UTC, [])).toEqual([])
  })
})

describe("dayTotals", () => {
  it("attributes a midnight-crossing entry wholly to the day it began", () => {
    // convex/entries.ts:207. The grid draws this entry in both columns, so
    // this is the assertion that keeps a column total from disagreeing with
    // the same day's header in List.
    const totals = dayTotals(
      [
        entry({
          startedAt: Date.UTC(2026, 7, 10, 23, 0),
          endedAt: Date.UTC(2026, 7, 11, 1, 30),
        }),
      ],
      UTC,
      NOW
    )
    expect(totals.get("2026-08-10")).toBe(2.5 * 3_600_000)
    expect(totals.get("2026-08-11")).toBeUndefined()
  })

  it("sums several entries on one day", () => {
    const totals = dayTotals(
      [
        entry({
          startedAt: Date.UTC(2026, 7, 10, 9, 0),
          endedAt: Date.UTC(2026, 7, 10, 10, 0),
        }),
        entry({
          _id: "e2",
          startedAt: Date.UTC(2026, 7, 10, 14, 0),
          endedAt: Date.UTC(2026, 7, 10, 14, 30),
        } as Partial<Doc<"timeEntries">>),
      ],
      UTC,
      NOW
    )
    expect(totals.get("2026-08-10")).toBe(1.5 * 3_600_000)
  })

  it("counts a running entry's elapsed time so far", () => {
    const totals = dayTotals(
      [
        entry({
          startedAt: Date.UTC(2026, 7, 10, 11, 0),
          endedAt: null,
        }),
      ],
      UTC,
      NOW
    )
    expect(totals.get("2026-08-10")).toBe(3_600_000)
  })
})

