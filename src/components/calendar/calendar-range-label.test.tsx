import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { CalendarHeader } from "@/components/calendar/calendar-header"
import { CalendarPanel } from "@/components/calendar/calendar-panel"
import { calendarLabel } from "@/lib/calendar-label"
import { visibleDaysOf } from "@/routes/_authed/timer"
import type { CalendarSize } from "@/lib/calendar-label"

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
}: {
  anchor: string
  size: CalendarSize
  weekStartDay: number
}) {
  const [range, setRange] = useState<{ fromMs: number; toMs: number } | null>(
    null
  )
  const days = range === null ? null : visibleDaysOf(range, MANILA)

  return (
    <>
      <CalendarPanel
        entries={[]}
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
      {days === null ? null : (
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
            rangeMs={0}
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

    it("names the first and last column the 5-day view actually drew", () => {
      /*
       * The case the old derivation got wrong 31 times. `hiddenDays={[0, 6]}`
       * is trimmed off the ENDS of the week `firstDay` built, so this range is
       * only Mon–Fri when the week starts on a Sunday or a Monday; from Tuesday
       * onward the weekend falls inside the week and the columns run
       * Tue–Fri + Mon. Whatever they are, the label has to say so.
       */
      for (const anchor of ANCHORS) {
        const { columns, derived, label } = measure(
          anchor,
          "5day",
          weekStartDay
        )

        expect(columns).toHaveLength(5)
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
