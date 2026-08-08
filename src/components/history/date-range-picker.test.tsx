import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DateRangePicker } from "@/components/history/date-range-picker"
import { monthLabel } from "@/lib/month-grid"

/*
 * The range picker replacing the hand-built calendar, now `Popover` +
 * shadcn's `Calendar mode="range"` (react-day-picker).
 *
 * Pure props in, `{ from, to }` out — no router, no Convex — so what these
 * tests prove is exactly what `FilterBar` gets: a single control that makes
 * an inverted range impossible to express and a matching period nameable at
 * a glance.
 */

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  })
}

beforeEach(() => {
  setViewportWidth(1280)
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

function open(
  props: Partial<React.ComponentProps<typeof DateRangePicker>> = {}
) {
  const onChange = vi.fn()
  render(
    <DateRangePicker
      from="2026-08-01"
      to="2026-08-01"
      period="custom"
      today="2026-08-06"
      weekStartDay={1}
      onChange={onChange}
      {...props}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: /date range/i }))
  return { onChange }
}

// The accessible name is "Monday, 3 August 2026[, start of range]" — the
// weekday prefix means a plain "starts with the day number" match is wrong,
// and a numeral without a boundary would also catch "13 August 2026". The
// lookbehind pins it to a real day-number token.
const dayButton = (day: number, month = "August", year = 2026) =>
  screen.getByRole("button", {
    name: new RegExp(`(?<!\\d)${day} ${month} ${year}`),
  })

describe("DateRangePicker trigger", () => {
  it("collapses a shared month and year", () => {
    render(
      <DateRangePicker
        from="2026-08-03"
        to="2026-08-09"
        period="custom"
        today="2026-08-06"
        weekStartDay={1}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText("3 – 9 Aug 2026")).toBeTruthy()
  })

  it("names a matching period instead of the raw dates", () => {
    render(
      <DateRangePicker
        from="2026-08-03"
        to="2026-08-09"
        period="week"
        today="2026-08-06"
        weekStartDay={1}
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText("This week")).toBeTruthy()
    expect(screen.queryByText("3 – 9 Aug 2026")).toBeNull()
  })
})

describe("DateRangePicker calendar", () => {
  it("shows two months side by side above a 768px-ish viewport", () => {
    open({ from: "2026-08-01", to: "2026-08-01" })
    expect(screen.getByText(monthLabel("2026-08-01"))).toBeTruthy()
    expect(screen.getByText(monthLabel("2026-09-01"))).toBeTruthy()
  })

  it("shows a single month on a narrow viewport", () => {
    setViewportWidth(375)
    open({ from: "2026-08-01", to: "2026-08-01" })
    expect(screen.getByText(monthLabel("2026-08-01"))).toBeTruthy()
    expect(screen.queryByText(monthLabel("2026-09-01"))).toBeNull()
  })

  it("orders the weekday headings from the configured week start", () => {
    // react-day-picker marks its weekday header row `aria-hidden`, so these
    // are only reachable with the RTL `hidden` escape hatch.
    open({ weekStartDay: 0 })
    expect(screen.getAllByRole("columnheader", { hidden: true })[0].textContent).toBe(
      "Sun"
    )

    cleanup()
    open({ weekStartDay: 1 })
    expect(screen.getAllByRole("columnheader", { hidden: true })[0].textContent).toBe(
      "Mon"
    )
  })

  it("selects a start then an end, producing the picked range", () => {
    const { onChange } = open({ from: "2026-08-01", to: "2026-08-01" })

    fireEvent.click(dayButton(3))
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(dayButton(9))
    expect(onChange).toHaveBeenCalledWith({ from: "2026-08-03", to: "2026-08-09" })
  })

  it("orders an out-of-order click pair instead of ever producing an inverted range", () => {
    const { onChange } = open({ from: "2026-08-01", to: "2026-08-01" })

    // Arm the LATER date first, click the EARLIER date second — the trap
    // this guards against is `{ from: "2026-08-09", to: "2026-08-03" }`.
    fireEvent.click(dayButton(9))
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(dayButton(3))
    expect(onChange).toHaveBeenCalledWith({ from: "2026-08-03", to: "2026-08-09" })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalledWith({ from: "2026-08-09", to: "2026-08-03" })
  })
})

describe("DateRangePicker keyboard", () => {
  it("keeps exactly one tabbable day cell and moves it with the arrow keys", () => {
    open({ from: "2026-08-05", to: "2026-08-05" })

    const start = dayButton(5)
    expect(start).toHaveAttribute("tabindex", "0")

    fireEvent.keyDown(start, { key: "ArrowRight" })

    const next = dayButton(6)
    expect(next).toHaveAttribute("tabindex", "0")
    expect(start).toHaveAttribute("tabindex", "-1")

    // Exactly one tabbable DAY cell across the whole (possibly two-month)
    // grid. Scoped to `[data-range]` — the day cells' own marker this
    // component adds — so the trigger's and the month-nav buttons' own,
    // legitimate tabindexes aren't mistaken for a second roving-tabindex stop.
    const tabbable = document.querySelectorAll('[data-range][tabindex="0"]')
    expect(tabbable).toHaveLength(1)
  })

  it("selects the focused day on Enter", () => {
    const { onChange } = open({ from: "2026-08-01", to: "2026-08-01" })

    fireEvent.click(dayButton(3))
    const end = dayButton(9)
    end.focus()
    fireEvent.keyDown(end, { key: "Enter" })

    expect(onChange).toHaveBeenCalledWith({ from: "2026-08-03", to: "2026-08-09" })
  })
})
