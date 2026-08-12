import { describe, expect, it } from "vitest"
import {
  CALENDAR_PRESETS,
  LIST_PRESETS,
  RANGE_PLACEHOLDER,
  activePreset,
  calendarSnap,
  instantsOf,
  presetRange,
  presetSize,
  rangePillLabel,
  rangeSpokenLabel,
  stepRange,
} from "@/lib/timer-range"
import { rangeOf } from "@/lib/calendar-events"
import { dayWindow } from "@shared/day"

/*
 * /timer's range model.
 *
 * The two things worth pinning down here are the ones a component test could
 * not state clearly: the WORKING WEEK'S STRIDE — five columns that step seven
 * days, because the two days between them are hidden rather than absent — and
 * the SNAP, which is the constraint standing between a thirty-day selection and
 * a time grid that would try to draw thirty columns of it.
 */

/** A Wednesday. */
const TODAY = "2026-08-12"
const MONDAY = 1
const SUNDAY = 0
const UTC = "UTC"

describe("the presets each view offers", () => {
  it("gives the calendar four and the list six", () => {
    expect(CALENDAR_PRESETS).toEqual([
      "today",
      "yesterday",
      "this-week",
      "last-week",
    ])
    expect(LIST_PRESETS).toEqual([
      "today",
      "yesterday",
      "this-week",
      "last-week",
      "last-30-days",
      "all-dates",
    ])
  })

  it("keeps the calendar's list a prefix of the list's, not a different set", () => {
    // The two rails are the same control in two views. A preset that means one
    // thing on one side and another thing on the other is how a user comes to
    // distrust the switch.
    expect(LIST_PRESETS.slice(0, CALENDAR_PRESETS.length)).toEqual([
      ...CALENDAR_PRESETS,
    ])
  })

  it("withholds the two the grid cannot draw", () => {
    expect(CALENDAR_PRESETS).not.toContain("last-30-days")
    expect(CALENDAR_PRESETS).not.toContain("all-dates")
  })
})

describe("what a preset selects", () => {
  it("resolves each bounded preset to its days", () => {
    expect(presetRange("today", TODAY, MONDAY)).toEqual({
      from: "2026-08-12",
      to: "2026-08-12",
    })
    expect(presetRange("yesterday", TODAY, MONDAY)).toEqual({
      from: "2026-08-11",
      to: "2026-08-11",
    })
    expect(presetRange("this-week", TODAY, MONDAY)).toEqual({
      from: "2026-08-10",
      to: "2026-08-16",
    })
    expect(presetRange("last-week", TODAY, MONDAY)).toEqual({
      from: "2026-08-03",
      to: "2026-08-09",
    })
    // Thirty days INCLUDING today, so the label and the span agree.
    expect(presetRange("last-30-days", TODAY, MONDAY)).toEqual({
      from: "2026-07-14",
      to: "2026-08-12",
    })
  })

  it("follows the stored week start", () => {
    expect(presetRange("this-week", TODAY, SUNDAY)).toEqual({
      from: "2026-08-09",
      to: "2026-08-15",
    })
    expect(presetRange("last-week", TODAY, SUNDAY)).toEqual({
      from: "2026-08-02",
      to: "2026-08-08",
    })
  })

  it("makes All dates unbounded rather than very wide", () => {
    // THE DISTINCTION THE WHOLE DEFAULT RESTS ON: `null` selects a different
    // query (`listPage`, paginated) rather than a range with a far-off start.
    expect(presetRange("all-dates", TODAY, MONDAY)).toBeNull()
  })

  it("sets the width as well as the place, for the four the grid offers", () => {
    expect(presetSize("today")).toBe("day")
    expect(presetSize("yesterday")).toBe("day")
    expect(presetSize("this-week")).toBe("week")
    expect(presetSize("last-week")).toBe("week")
    expect(presetSize("last-30-days")).toBeNull()
    expect(presetSize("all-dates")).toBeNull()
  })
})

describe("which preset a selection reads as", () => {
  it("names the selection when it is exactly a preset", () => {
    expect(activePreset({ from: TODAY, to: TODAY }, TODAY, MONDAY)).toBe("today")
    expect(
      activePreset({ from: "2026-08-10", to: "2026-08-16" }, TODAY, MONDAY)
    ).toBe("this-week")
    expect(activePreset(null, TODAY, MONDAY)).toBe("all-dates")
  })

  it("follows the arrows rather than going stale beside them", () => {
    /*
     * Computed, not stored. One step back from this week IS last week and the
     * rail says so; two steps back is not any preset and the rail says nothing
     * — where a stored "active preset" would still be claiming "This week" over
     * a range that had left it a fortnight ago.
     */
    const thisWeek = { from: "2026-08-10", to: "2026-08-16" }
    const back = stepRange(thisWeek, "week", -1)
    expect(activePreset(back, TODAY, MONDAY)).toBe("last-week")
    expect(activePreset(stepRange(back, "week", -1), TODAY, MONDAY)).toBeNull()
  })
})

describe("stepping by the range's own width", () => {
  it("moves a week by seven days", () => {
    expect(stepRange({ from: "2026-08-10", to: "2026-08-16" }, "week", -1)).toEqual(
      { from: "2026-08-03", to: "2026-08-09" }
    )
    expect(stepRange({ from: "2026-08-10", to: "2026-08-16" }, "week", 1)).toEqual(
      { from: "2026-08-17", to: "2026-08-23" }
    )
  })

  it("moves a day by one", () => {
    expect(stepRange({ from: TODAY, to: TODAY }, "day", 1)).toEqual({
      from: "2026-08-13",
      to: "2026-08-13",
    })
  })

  it("moves the working week by a WHOLE week, not by its five columns", () => {
    /*
     * THE ASSERTION THIS FUNCTION EXISTS FOR. Mon–Fri stepped by its own five
     * lands the anchor on Saturday, and `rangeOf` resolves a Saturday anchor
     * back to the Monday it came from — so the arrow would redraw the same five
     * columns forever. Seven is the distance to the next working week.
     */
    const next = stepRange({ from: "2026-08-10", to: "2026-08-14" }, "5day", 1)
    expect(next).toEqual({ from: "2026-08-17", to: "2026-08-21" })
    // …and the grid agrees: the stepped range is what `rangeOf` draws from it.
    const days = rangeOf(next.from, "5day", MONDAY, UTC).days
    expect([days[0], days[days.length - 1]]).toEqual([next.from, next.to])
  })

  it("moves an arbitrary list range by its own span", () => {
    // No grid, no hidden weekend: a 30-day range steps 30 days.
    expect(stepRange({ from: "2026-07-14", to: "2026-08-12" }, null, -1)).toEqual({
      from: "2026-06-14",
      to: "2026-07-13",
    })
  })

  it("steps across a month and a year without arithmetic of its own", () => {
    expect(stepRange({ from: "2026-12-28", to: "2027-01-03" }, "week", 1)).toEqual({
      from: "2027-01-04",
      to: "2027-01-10",
    })
  })
})

describe("snapping a selection onto the grid", () => {
  it("leaves a selection the size already draws alone", () => {
    expect(
      calendarSnap({ from: "2026-08-10", to: "2026-08-16" }, "week", TODAY, MONDAY, UTC)
    ).toEqual({
      size: "week",
      range: { from: "2026-08-10", to: "2026-08-16" },
    })
    expect(
      calendarSnap({ from: TODAY, to: TODAY }, "day", TODAY, MONDAY, UTC)
    ).toEqual({ size: "day", range: { from: TODAY, to: TODAY } })
    expect(
      calendarSnap({ from: "2026-08-10", to: "2026-08-14" }, "5day", TODAY, MONDAY, UTC)
    ).toEqual({
      size: "5day",
      range: { from: "2026-08-10", to: "2026-08-14" },
    })
  })

  it("falls back to the week containing the start when the span is wider", () => {
    /*
     * A time grid is a picture of a day at 48px an hour. Thirty columns of that
     * is not a smaller version of the same thing, it is unreadable — so the
     * constraint is expressed here, where it can be asserted, rather than by
     * leaving "Last 30 days" out of an array and hoping the state never arrives.
     */
    expect(
      calendarSnap({ from: "2026-07-14", to: "2026-08-12" }, "week", TODAY, MONDAY, UTC)
    ).toEqual({
      size: "week",
      range: { from: "2026-07-13", to: "2026-07-19" },
    })
  })

  it("widens the SIZE too, so the next arrow click steps the right distance", () => {
    // A day view holding a 30-day selection would otherwise step one day at a
    // time through a month the user asked to see at once.
    expect(
      calendarSnap({ from: "2026-07-14", to: "2026-08-12" }, "day", TODAY, MONDAY, UTC)
    ).toEqual({
      size: "week",
      range: { from: "2026-07-13", to: "2026-07-19" },
    })
  })

  it("puts All dates on the week containing today", () => {
    expect(calendarSnap(null, "day", TODAY, MONDAY, UTC)).toEqual({
      size: "week",
      range: { from: "2026-08-10", to: "2026-08-16" },
    })
  })

  it("always returns something the grid can actually draw", () => {
    // The invariant, stated directly: whatever comes back is the endpoints of
    // `rangeOf` for the same size — the one function the panel is handed.
    for (const selection of [
      null,
      { from: "2026-08-12", to: "2026-08-12" },
      { from: "2026-08-11", to: "2026-08-13" },
      { from: "2026-07-14", to: "2026-08-12" },
    ]) {
      for (const size of ["day", "5day", "week"] as const) {
        for (const weekStartDay of [0, 1, 2, 3, 4, 5, 6]) {
          const snapped = calendarSnap(selection, size, TODAY, weekStartDay, UTC)
          const days = rangeOf(snapped.range.from, snapped.size, weekStartDay, UTC).days
          expect({ selection, size, weekStartDay, ends: [days[0], days.at(-1)] }).toEqual({
            selection,
            size,
            weekStartDay,
            ends: [snapped.range.from, snapped.range.to],
          })
        }
      }
    }
  })
})

describe("the instants a bounded range means", () => {
  it("is half-open, through dayWindow", () => {
    const range = { from: "2026-08-10", to: "2026-08-16" }
    expect(instantsOf(range, "Asia/Manila")).toEqual({
      fromMs: dayWindow("2026-08-10", "Asia/Manila").fromMs,
      toMs: dayWindow("2026-08-16", "Asia/Manila").toMs,
    })
  })
})

describe("what the pill says", () => {
  it("prints the range in the one format this product prints", () => {
    expect(rangePillLabel({ from: "2026-08-10", to: "2026-08-16" })).toBe(
      "08/10/2026 - 08/16/2026"
    )
  })

  it("shows the field's own shape when nothing is bounded", () => {
    expect(rangePillLabel(null)).toBe(RANGE_PLACEHOLDER)
    expect(RANGE_PLACEHOLDER).toBe("MM/DD/YYYY - MM/DD/YYYY")
  })

  it("says something a screen reader can use instead of the digits", () => {
    // The pill's TEXT is "08/10/2026 - 08/16/2026". Spoken, that is twenty-odd
    // digits answering none of the questions the control exists to answer.
    expect(
      rangeSpokenLabel({ from: "2026-08-10", to: "2026-08-16" }, "week", TODAY)
    ).toBe("This week · 10–16 Aug")
    expect(
      rangeSpokenLabel({ from: "2026-07-14", to: "2026-08-12" }, null, TODAY)
    ).toBe("14 Jul – 12 Aug 2026")
    expect(rangeSpokenLabel(null, null, TODAY)).toBe("All dates")
  })
})
