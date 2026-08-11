import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { CalendarHeader } from "@/components/calendar/calendar-header"
import { CalendarPanel } from "@/components/calendar/calendar-panel"
import { rangeTotal } from "@/lib/calendar-events"
import { calendarLabel } from "@/lib/calendar-label"
import { visibleDaysOf } from "@/routes/_authed/timer"
import type { CalendarRange } from "@/lib/calendar-events"
import type { CalendarSize } from "@/lib/calendar-label"
import type { Doc } from "../../../convex/_generated/dataModel"

/*
 * THE LABEL AND THE COLUMNS, over every combination that can produce them.
 *
 * The bug this file exists for: the header's days were computed from the
 * anchor, the size and `weekStartDay`, on the stated claim that
 * `hiddenDays={[0, 6]}` "trims by day-of-week index independently of where the
 * week is set to start". FullCalendar does not work that way — it builds the
 * week from `firstDay` and then trims hidden days only from the ENDS of it.
 * Measured here, 31 of the 49 (weekStartDay × anchor) combinations disagreed
 * with the columns actually on screen:
 *
 *   - `weekStartDay: 0` with a Sunday anchor: the grid drew 17–21 Aug and the
 *     label said 10–14 Aug. `anchor` starts at today and steps by ±7 days, so
 *     anyone who opened /timer on a Sunday stayed a week out.
 *   - `weekStartDay: 2…5`: the columns are not Mon–Fri at all — with
 *     `firstDay: Tue` they run Tue, Wed, Thu, Fri, MON, because Sat and Sun
 *     fall in the interior rather than at the ends — while the label claimed
 *     Mon–Fri regardless.
 *
 * It was worse than a wrong label. "Range total" beside it is summed from the
 * grid's real range, so the header could read `10–14 Aug` above a total
 * belonging to `17–21 Aug`, on a tool people invoice from.
 *
 * A SINGLE ANCHOR IS WHAT MISSED IT — `calendar-panel.test.tsx` uses a Tuesday,
 * one of the 18 combinations that happened to agree. So this asserts the whole
 * matrix, and it asserts it against the grid's OWN `data-date` columnheaders
 * rather than against a second computation of what they ought to be.
 *
 * NO FAKE TIMERS and no `findBy*`: `nowMs` is a prop and the DOM is complete
 * synchronously after `render`, which is what this repo requires (`waitFor`
 * hangs here — see calendar-panel.test.tsx).
 */

const MANILA = "Asia/Manila"

/** 2026-08-12 12:00 Manila. Nothing here reads it except the now-indicator. */
const NOW = Date.parse("2026-08-12T04:00:00Z")

/** Only used to decide the "This week · " prefix, and it is applied to the
 *  expectation and the render alike, so it cannot hide a disagreement. */
const TODAY = "2026-08-12"

/** Monday 10 August 2026 through Sunday the 16th: every weekday, as an anchor. */
const ANCHORS = [
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
  "2026-08-16",
]

/** Every value `/settings` offers for "week starts on". 0 = Sunday. */
const WEEK_STARTS = [0, 1, 2, 3, 4, 5, 6]

/**
 * The page's own wiring, in miniature: the grid reports a range, and the header
 * labels the days that range covers. `visibleDaysOf` is imported from
 * `timer.tsx` rather than reimplemented, so this test cannot pass while the
 * page does something else.
 */
function Harness({
  anchor,
  size,
  weekStartDay,
  entries = [],
}: {
  anchor: string
  size: CalendarSize
  weekStartDay: number
  entries?: Array<Doc<"timeEntries">>
}) {
  const [range, setRange] = useState<CalendarRange | null>(null)
  const days = range === null ? null : visibleDaysOf(range, MANILA)

  return (
    <>
      <CalendarPanel
        entries={entries}
        size={size}
        anchor={anchor}
        timeZone={MANILA}
        weekStartDay={weekStartDay}
        use12Hour={false}
        display="hms"
        nowMs={NOW}
        projectsById={new Map()}
        onEntryClick={() => {}}
        onRangeChange={setRange}
      />
      {days === null || range === null ? null : (
        <div
          data-testid="range-bar"
          data-first={days.firstDay}
          data-last={days.lastDay}
        >
          <CalendarHeader
            firstDay={days.firstDay}
            lastDay={days.lastDay}
            size={size}
            today={TODAY}
            // The page's own function, not a sum written a second time here —
            // the same reason `visibleDaysOf` is imported rather than
            // reimplemented: this test cannot pass while /timer does something
            // else with the range the grid reported.
            rangeMs={rangeTotal(entries, MANILA, NOW, range.days)}
            display="hms"
            onStep={() => {}}
            onToday={() => {}}
            onSizeChange={() => {}}
          />
        </div>
      )}
    </>
  )
}

/** The dates of the rendered day-header cells, in order — the grid's own
 *  statement of what it is showing. */
function columnDates(container: HTMLElement): Array<string> {
  return [
    ...container.querySelectorAll('[role="columnheader"][data-date]'),
  ].map((cell) => cell.getAttribute("data-date") ?? "")
}

afterEach(cleanup)

/**
 * Renders one combination and returns what the grid drew, what the page derived
 * from the grid's report, and what the header printed.
 */
function measure(anchor: string, size: CalendarSize, weekStartDay: number) {
  const { container } = render(
    <Harness anchor={anchor} size={size} weekStartDay={weekStartDay} />
  )
  const columns = columnDates(container)
  const bar = screen.getByTestId("range-bar")
  // [ ← , the label, → ] — the label is a button because pressing the thing
  // that says "This week" is how people go back to this week.
  const label = within(bar).getAllByRole("button")[1]?.textContent ?? ""
  return {
    columns,
    derived: [bar.dataset.first, bar.dataset.last],
    label,
  }
}

/** Only the fields the grid and `dayTotals` read. */
function entry(
  id: string,
  startedAt: number,
  hours: number
): Doc<"timeEntries"> {
  return {
    _id: id,
    _creationTime: 0,
    userId: "u1",
    title: `Entry ${id}`,
    startedAt,
    endedAt: startedAt + hours * 3_600_000,
    durationMs: hours * 3_600_000,
    projectId: undefined,
    tagIds: [],
    billable: false,
    note: undefined,
    source: "web",
    clientKey: id,
    updatedAt: 0,
    deletedAt: null,
  } as unknown as Doc<"timeEntries">
}

/** 09:00 Manila on the given day. */
const at = (day: string, hour: number) =>
  Date.parse(`${day}T00:00:00+08:00`) + hour * 3_600_000

/**
 * One entry on each of Tue, Thu, Sat and Sun of the working week under test,
 * so a total that leaked a day without a column cannot pass by being zero.
 */
const SPREAD = [
  entry("tue", at("2026-08-11", 9), 1),
  entry("thu", at("2026-08-13", 9), 2),
  entry("sat", at("2026-08-15", 9), 4),
  entry("sun", at("2026-08-16", 9), 8),
]

/**
 * Renders one combination with entries on it and reads the FIGURES back off the
 * screen — the column headers' own totals and the header's range total.
 */
function measureTotals(
  anchor: string,
  size: CalendarSize,
  weekStartDay: number
) {
  const { container } = render(
    <Harness
      anchor={anchor}
      size={size}
      weekStartDay={weekStartDay}
      entries={SPREAD}
    />
  )
  // `.tabular.text-xs` inside a column header is the day total and only the
  // day total: the weekday text is not `tabular` and the date is `text-base`.
  const columnTotals = [
    ...container.querySelectorAll('[role="columnheader"] .tabular.text-xs'),
  ].map((span) => span.textContent)
  return {
    columns: columnDates(container),
    columnTotals,
    rangeMs: screen.getByText("Range total").textContent,
  }
}

describe("the header's label and the grid's own columns", () => {
  describe.each(WEEK_STARTS)("weekStartDay %i", (weekStartDay) => {
    it("names the first and last column the week view actually drew", () => {
      for (const anchor of ANCHORS) {
        const { columns, derived, label } = measure(
          anchor,
          "week",
          weekStartDay
        )

        expect(columns).toHaveLength(7)
        // The anchor rides along in the compared value so a failure names the
        // day it failed on rather than only the dates it disagreed about.
        expect({ anchor, days: derived }).toEqual({
          anchor,
          days: [columns[0], columns[columns.length - 1]],
        })
        expect({ anchor, label }).toEqual({
          anchor,
          label: calendarLabel(
            columns[0],
            columns[columns.length - 1],
            "week",
            TODAY
          ),
        })

        cleanup()
      }
    })

    it("draws Monday to Friday, and names them", () => {
      /*
       * THE ASSERTION THAT WAS MISSING, and the reason a false claim survived
       * two reviews: this used to check only that the label matched WHATEVER
       * the grid drew. It did — and what the grid drew was not Mon–Fri.
       *
       * `hiddenDays={[0, 6]}` is trimmed off the ENDS of the week `firstDay`
       * built, so with `firstDay = weekStartDay` the weekend fell in the
       * INTERIOR from Tuesday onward and was not removed at all: `weekStartDay:
       * 3` drew Wed 5, Thu 6, Fri 7, MON 10, TUE 11 — five columns spanning
       * seven days of two different weeks. `calendar-panel.tsx` pins `firstDay`
       * to Monday for this size, which puts the weekend back at the end where
       * the trim can reach it, for all seven starts.
       *
       * `/settings` offers all seven, so this is the whole reachable matrix.
       */
      const WORKING_WEEK = [
        "2026-08-10",
        "2026-08-11",
        "2026-08-12",
        "2026-08-13",
        "2026-08-14",
      ]

      for (const anchor of ANCHORS) {
        const { columns, derived, label } = measure(
          anchor,
          "5day",
          weekStartDay
        )

        // Every anchor here is inside Mon 10 – Sun 16, so every one of them
        // resolves to the same working week however the user's week starts.
        expect({ anchor, columns }).toEqual({ anchor, columns: WORKING_WEEK })
        expect({ anchor, days: derived }).toEqual({
          anchor,
          days: [columns[0], columns[columns.length - 1]],
        })
        expect({ anchor, label }).toEqual({
          anchor,
          label: calendarLabel(
            columns[0],
            columns[columns.length - 1],
            "5day",
            TODAY
          ),
        })

        cleanup()
      }
    })

    it("keeps the range total to the days it drew a column for", () => {
      /*
       * THE HEADER'S TOTAL IS THE SUM OF THE COLUMN HEADERS' TOTALS, asserted
       * against the figures actually on screen rather than against a second
       * computation of them.
       *
       * `calendarTotalMs` used to sum every key `dayTotals` produced, which is
       * every day the QUERY covers — while the grid looks that map up once per
       * DRAWN column. Those two sets coincide only when the range and the
       * columns are the same days, and the 5-day view is exactly where they
       * were not: with `weekStartDay: 2` the range ran Tue–Mon while five
       * columns were drawn, so a Saturday entry was counted into "Range total"
       * above a grid showing nothing. The same defect class as a header total
       * belonging to another range, which this branch has shipped once already.
       *
       * Saturday and Sunday both carry an entry, so a total that leaked days
       * without a column cannot pass by being zero.
       */
      const { columns, rangeMs, columnTotals } = measureTotals(
        "2026-08-12",
        "5day",
        weekStartDay
      )

      expect(columns).toHaveLength(5)
      expect(columnTotals).toEqual(["1:00:00", "2:00:00"])
      // Tuesday's hour and Thursday's two, and neither weekend entry.
      expect(rangeMs).toBe("Range total3:00:00")
    })
  })

  it("names the single column a day view drew", () => {
    // One column, so both ends are the same day — and `toMs - 1` has to land
    // back on it rather than on the midnight that opens the next one.
    for (const anchor of ANCHORS) {
      const { columns, derived, label } = measure(anchor, "day", 1)

      expect(columns).toEqual([anchor])
      expect({ anchor, days: derived }).toEqual({
        anchor,
        days: [anchor, anchor],
      })
      expect({ anchor, label }).toEqual({
        anchor,
        label: calendarLabel(anchor, anchor, "day", TODAY),
      })

      cleanup()
    }
  })
})
