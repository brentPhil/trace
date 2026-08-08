import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { FilterBar } from "@/components/history/filter-bar"
import { defaultFilters } from "@/lib/history-filters"
import type { Filters } from "@/lib/history-filters"

/*
 * The one thing FilterBar itself has to get right about the range picker: it
 * is the caller that knows setting a custom range means `period: "custom"` —
 * the picker itself never touches `period`. Everything else about the
 * calendar is covered by date-range-picker.test.tsx against the component
 * directly.
 */

beforeEach(() => {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    NoopResizeObserver
  Element.prototype.scrollIntoView = function scrollIntoView() {}
})

afterEach(cleanup)

const TODAY = "2026-08-06"

function Harness() {
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(TODAY, 1))
  return (
    <div>
      <FilterBar
        filters={filters}
        projects={[]}
        today={TODAY}
        weekStartDay={1}
        onChange={setFilters}
      />
      <p data-testid="state">{JSON.stringify(filters)}</p>
    </div>
  )
}

describe("FilterBar's date range picker", () => {
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
})
