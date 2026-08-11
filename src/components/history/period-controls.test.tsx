import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { PeriodControls } from "@/components/history/period-controls"
import { defaultFilters } from "@/lib/history-filters"
import type { Filters } from "@/lib/history-filters"

/*
 * The one thing PeriodControls itself has to get right about the range picker:
 * it is the caller that knows setting a custom range means `period: "custom"` —
 * the picker itself never touches `period`. Everything else about the
 * calendar is covered by date-range-picker.test.tsx against the component
 * directly.
 *
 * Both of these came across whole when `FilterBar` was split: the picker and
 * the arrow keys are the period's, and the period is what this component now
 * is. Nothing about either assertion depends on the filters that stayed
 * behind.
 */

afterEach(cleanup)

const TODAY = "2026-08-06"

function Harness() {
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(TODAY, 1))
  return (
    <div>
      <PeriodControls
        filters={filters}
        today={TODAY}
        weekStartDay={1}
        onChange={setFilters}
      />
      <p data-testid="state">{JSON.stringify(filters)}</p>
    </div>
  )
}

describe("PeriodControls' date range picker", () => {
  it("sets period to custom when a range is picked", () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole("button", { name: /date range/i }))
    fireEvent.click(
      screen.getByRole("button", { name: /(?<!\d)3 August 2026/ })
    )
    fireEvent.click(
      screen.getByRole("button", { name: /(?<!\d)9 August 2026/ })
    )

    const state = JSON.parse(screen.getByTestId("state").textContent)
    expect(state.period).toBe("custom")
    expect(state.from).toBe("2026-08-03")
    expect(state.to).toBe("2026-08-09")
  })

  // Regression test for `2b25007`: PeriodControls binds ArrowLeft/ArrowRight at
  // the document level to step Day/Week/Month. Before that fix, the same
  // keys bubbled up from an OPEN calendar and shifted the whole period out
  // from under the picker mid-navigation.
  //
  // react-day-picker stops propagation on arrow keys itself for a focused
  // DAY cell, so that half is covered for free now. It does NOT do this for
  // its own month-nav buttons, which are plain buttons with no arrow-key
  // handling of their own — so THAT is where DateRangePicker's own
  // catch-all (`stopGridNavigationKeys` in date-range-picker.tsx) is the
  // only thing standing between an arrow key and the document listener.
  it("does not let arrow keys inside the open calendar step the period", () => {
    render(<Harness />)

    const before = JSON.parse(screen.getByTestId("state").textContent)

    fireEvent.click(screen.getByRole("button", { name: /date range/i }))
    const previousMonth = screen.getByRole("button", {
      name: /previous month/i,
    })
    previousMonth.focus()
    fireEvent.keyDown(previousMonth, { key: "ArrowRight" })
    fireEvent.keyDown(previousMonth, { key: "ArrowLeft" })

    const after = JSON.parse(screen.getByTestId("state").textContent)
    expect(after).toEqual(before)
  })
})
