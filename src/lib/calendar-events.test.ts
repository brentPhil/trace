import { describe, expect, it } from "vitest"
import {
  calendarEvents,
  dayTotals,
  drawnDays,
  earliestHour,
} from "./calendar-events"
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

describe("earliestHour", () => {
  it("returns the hour of the earliest start in the user's zone", () => {
    const hour = earliestHour(
      [
        entry({ startedAt: Date.UTC(2026, 7, 10, 14, 12) }),
        entry({ _id: "e2", startedAt: Date.UTC(2026, 7, 10, 9, 45) } as Partial<
          Doc<"timeEntries">
        >),
      ],
      UTC,
      8
    )
    expect(hour).toBe(9)
  })

  it("falls back when nothing is tracked", () => {
    expect(earliestHour([], UTC, 8)).toBe(8)
  })

  it("reads the hour in the stored zone, not the browser's", () => {
    // 23:30 UTC is 07:30 the next morning in Manila. A grid scrolled to 23:00
    // for a 07:30 start is a grid scrolled past every block on it.
    const hour = earliestHour(
      [entry({ startedAt: Date.UTC(2026, 7, 9, 23, 30) })],
      "Asia/Manila",
      8
    )
    expect(hour).toBe(7)
  })
})
