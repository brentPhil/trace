import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { CalendarPanel } from "@/components/calendar/calendar-panel"
import { RangeBar } from "@/components/timer/range-bar"
import { boundsOf, rangeOf, rangeTotal } from "@/lib/calendar-events"
import { calendarLabel } from "@/lib/calendar-label"
import { rangePillLabel } from "@/lib/timer-range"
import { noEntryActions } from "@/test-utils/fixtures"
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
 * It was worse than a wrong label. "Range total" beside it was summed from the
 * grid's real range, so the header could read `10–14 Aug` above a total
 * belonging to `17–21 Aug`, on a tool people invoice from.
 *
 * WHAT THE MATRIX ASSERTS NOW. The direction of the wiring has been inverted:
 * `rangeOf` computes the range and the grid is TOLD to draw it, rather than the
 * grid computing a span and the page labelling whatever came back. So the
 * question is no longer "does the label agree with the grid" but "does the grid
 * draw what it was given" — and it is still asserted against the grid's OWN
 * `data-date` columnheaders rather than against a second computation of what
 * they ought to be. The 5-day rows still assert Mon–Fri outright, because
 * "whatever the grid drew" is exactly the assertion that let the old defect
 * through two reviews.
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
 * The page's own wiring, in miniature: ONE `rangeOf` feeds the grid, the label
 * and the total alike. Every function here is imported rather than
 * reimplemented, so this test cannot pass while the page does something else.
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
  const range = rangeOf(anchor, size, weekStartDay, MANILA)
  const bounds = boundsOf(range)

  return (
    <>
      <CalendarPanel
        entries={entries}
        range={range}
        timeZone={MANILA}
        weekStartDay={weekStartDay}
        use12Hour={false}
        display="hms"
        nowMs={NOW}
        projects={[]}
        projectsById={new Map()}
        tags={[]}
        actions={noEntryActions}
      />
      <div
        data-testid="range-bar"
        data-first={bounds.from}
        data-last={bounds.to}
      >
        <RangeBar
          view="calendar"
          range={bounds}
          size={size}
          today={TODAY}
          weekStartDay={weekStartDay}
          rangeMs={rangeTotal(entries, MANILA, NOW, range.days)}
          display="hms"
          onStep={() => {}}
          onRangeChange={() => {}}
          onPresetChange={() => {}}
          onSizeChange={() => {}}
        />
      </div>
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

/*
 * THE PANEL'S OWN CHECK, held to zero across the whole matrix.
 *
 * `CalendarPanel`'s `datesSet` compares the range FullCalendar actually drew
 * against the one it was handed, and says so on the console when they differ.
 * Nothing else here would notice: the columns, the label and the total are all
 * derived from one `rangeOf` now, so they would agree with each other while all
 * three disagreed with the grid — which is the only shape the original defect
 * has left to take.
 *
 * Only this component's own message is counted. A React warning is a different
 * complaint and failing on it here would make this file the place unrelated
 * noise comes to fail.
 */
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  const disagreements = consoleError.mock.calls.filter(
    (args: Array<unknown>) =>
      typeof args[0] === "string" && args[0].startsWith("CalendarPanel drew")
  )
  consoleError.mockRestore()
  expect(disagreements).toEqual([])
})

/**
 * Renders one combination and returns what the grid drew, what the page derived
 * from the range it computed, and what the header printed.
 */
function measure(anchor: string, size: CalendarSize, weekStartDay: number) {
  const { container } = render(
    <Harness anchor={anchor} size={size} weekStartDay={weekStartDay} />
  )
  const columns = columnDates(container)
  const bar = screen.getByTestId("range-bar")
  /*
   * [ ‹ , the pill, › ]. The pill is the range picker's trigger, and it carries
   * TWO statements about the same range: the digits it prints — the format this
   * product puts on invoices — and the prose a screen reader gets instead. Both
   * are compared against the columns below, because a bar that named one week
   * over another week's columns is the whole reason this file exists, and it
   * would be no better for happening only in the accessible name.
   */
  const trigger = within(bar).getAllByRole("button")[1]
  return {
    columns,
    derived: [bar.dataset.first, bar.dataset.last],
    /** What the page ASKED for — the whole list, not only its two ends. */
    expected: rangeOf(anchor, size, weekStartDay, MANILA).days,
    label: trigger.getAttribute("aria-label") ?? "",
    pillText: trigger.textContent,
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
        const { columns, derived, expected, label, pillText } = measure(
          anchor,
          "week",
          weekStartDay
        )

        expect(columns).toHaveLength(7)
        // THE COLUMNS ARE THE RANGE, every one of them — not merely seven of
        // something. The grid is told what to draw now, so this is the
        // assertion that it obeyed.
        expect({ anchor, columns }).toEqual({ anchor, columns: expected })
        // The anchor rides along in the compared value so a failure names the
        // day it failed on rather than only the dates it disagreed about.
        expect({ anchor, days: derived }).toEqual({
          anchor,
          days: [columns[0], columns[columns.length - 1]],
        })
        expect({ anchor, label }).toEqual({
          anchor,
          label: `Date range — ${calendarLabel(
            columns[0],
            columns[columns.length - 1],
            "week",
            TODAY
          )}`,
        })
        expect({ anchor, pillText }).toEqual({
          anchor,
          pillText: rangePillLabel({
            from: columns[0],
            to: columns[columns.length - 1],
          }),
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
       * `hiddenDays={[0, 6]}` was trimmed off the ENDS of the week `firstDay`
       * built, so with `firstDay = weekStartDay` the weekend fell in the
       * INTERIOR from Tuesday onward and was not removed at all: `weekStartDay:
       * 3` drew Wed 5, Thu 6, Fri 7, MON 10, TUE 11 — five columns spanning
       * seven days of two different weeks. There is no trim any more:
       * `rangeOf` states the five days from Monday outright, and the grid is
       * given them.
       *
       * SPELT OUT, not read back off `rangeOf`. Every other assertion in this
       * file compares the grid with the range the page asked for; this one has
       * to pin down what the page is allowed to ASK for, or a `rangeOf` that
       * rotated the working week by `weekStartDay` would pass the whole matrix.
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
        const { columns, derived, expected, label, pillText } = measure(
          anchor,
          "5day",
          weekStartDay
        )

        // Every anchor here is inside Mon 10 – Sun 16, so every one of them
        // resolves to the same working week however the user's week starts.
        expect({ anchor, columns }).toEqual({ anchor, columns: WORKING_WEEK })
        expect({ anchor, expected }).toEqual({ anchor, expected: WORKING_WEEK })
        expect({ anchor, days: derived }).toEqual({
          anchor,
          days: [columns[0], columns[columns.length - 1]],
        })
        expect({ anchor, label }).toEqual({
          anchor,
          label: `Date range — ${calendarLabel(
            columns[0],
            columns[columns.length - 1],
            "5day",
            TODAY
          )}`,
        })
        expect({ anchor, pillText }).toEqual({
          anchor,
          pillText: rangePillLabel({
            from: columns[0],
            to: columns[columns.length - 1],
          }),
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
      const { columns, derived, label, pillText } = measure(anchor, "day", 1)

      expect(columns).toEqual([anchor])
      expect({ anchor, days: derived }).toEqual({
        anchor,
        days: [anchor, anchor],
      })
      expect({ anchor, label }).toEqual({
        anchor,
        label: `Date range — ${calendarLabel(anchor, anchor, "day", TODAY)}`,
      })
      expect({ anchor, pillText }).toEqual({
        anchor,
        pillText: rangePillLabel({ from: anchor, to: anchor }),
      })

      cleanup()
    }
  })
})
