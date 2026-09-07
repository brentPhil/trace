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

function Harness({ filters: seed }: { filters?: Partial<Filters> } = {}) {
  const [filters, setFilters] = useState<Filters>(() => ({
    ...defaultFilters(TODAY, 1),
    ...seed,
  }))
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
  it("names the period on the trigger", () => {
    /*
     * The picker no longer computes this: /timer shows the same control with
     * US dates on it, so the trigger's WORDS moved out to the caller. This is
     * the assertion that /reports still passes the ones it always did —
     * `rangeTriggerLabel`'s own cases live in date-range-picker.test.ts.
     */
    render(<Harness />)

    // `defaultFilters` opens on the week containing TODAY.
    expect(screen.getByText("This week")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /previous period/i }))
    expect(screen.queryByText("This week")).toBeNull()
    expect(screen.getByText("27 Jul – 2 Aug 2026")).toBeTruthy()
  })

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

describe("PeriodControls' preset rail", () => {
  /*
   * /reports' OWN list, which is not /timer's. The two share one picker and
   * one `presets` prop, and what each page offers is the page's business —
   * quarters and years are the spans this one reports and invoices on, and it
   * has no "All dates" because there is no unbounded scan behind it.
   *
   * The ranges themselves are proved in date-range-picker.test.ts. What is
   * only provable here is the WIRING: that a chip reaches `Filters`, and that
   * the badge names the range the page actually opened on.
   */
  function openRail() {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: /date range/i }))
  }

  it("offers /reports' eight spans and none of /timer's", () => {
    openRail()

    for (const label of [
      "Today",
      "This week",
      "This month",
      "This year",
      "Last week",
      "Last 2 weeks",
      "Last month",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy()
    }
    expect(screen.getByRole("button", { name: /^This quarter/ })).toBeTruthy()
    // /timer's two, which this page cannot express.
    expect(screen.queryByRole("button", { name: "All dates" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Last 30 days" })).toBeNull()
  })

  it("badges the default in the chip's own accessible name", () => {
    // Not an `aria-hidden` decoration: which preset the page opens on is the
    // point of the badge, and a reader that skipped it would learn which chip
    // is pressed but never which one is home.
    openRail()
    expect(
      screen.getByRole("button", { name: "This quarter, Default" })
    ).toBeTruthy()
  })

  it("applies a preset's range and its period to the filters", () => {
    openRail()
    fireEvent.click(screen.getByRole("button", { name: "Last month" }))

    const state = JSON.parse(screen.getByTestId("state").textContent)
    // TODAY is 2026-08-06.
    expect({ from: state.from, to: state.to, period: state.period }).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
      period: "month",
    })
  })

  it("marks a quarter custom, because Period has no case for one", () => {
    openRail()
    fireEvent.click(screen.getByRole("button", { name: /^This quarter/ }))

    const state = JSON.parse(screen.getByTestId("state").textContent)
    expect(state.period).toBe("custom")
    expect({ from: state.from, to: state.to }).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    })
  })

  it("keeps every filter a preset is not about", () => {
    // A date control that quietly cleared the search box would be a filter bar
    // that forgets what it was asked, one click at a time.
    render(<Harness filters={{ text: "invoice", billableOnly: true }} />)
    fireEvent.click(screen.getByRole("button", { name: /date range/i }))
    fireEvent.click(screen.getByRole("button", { name: "This year" }))

    const state = JSON.parse(screen.getByTestId("state").textContent)
    expect(state.text).toBe("invoice")
    expect(state.billableOnly).toBe(true)
    expect({ from: state.from, to: state.to }).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    })
  })

  it("stops naming a preset once the arrows step the range off it", () => {
    // Computed, never stored — see `activeReportsPreset`. The rail has to stop
    // claiming "This quarter" the instant the range is no longer one.
    openRail()
    fireEvent.click(screen.getByRole("button", { name: /^This quarter/ }))

    fireEvent.click(screen.getByRole("button", { name: /date range/i }))
    expect(
      screen.getByRole("button", { name: /^This quarter/ }).getAttribute("aria-pressed")
    ).toBe("true")

    fireEvent.click(screen.getByRole("button", { name: /previous period/i }))
    fireEvent.click(screen.getByRole("button", { name: /date range/i }))
    expect(
      screen.getByRole("button", { name: /^This quarter/ }).getAttribute("aria-pressed")
    ).toBe("false")
  })
})
