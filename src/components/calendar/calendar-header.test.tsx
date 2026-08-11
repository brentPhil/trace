import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { CalendarHeader } from "./calendar-header"

afterEach(cleanup)

const base = {
  firstDay: "2026-08-10",
  lastDay: "2026-08-16",
  size: "week" as const,
  today: "2026-08-11",
  rangeMs: 53_848_000,
  display: "hms" as const,
  onStep: vi.fn(),
  onToday: vi.fn(),
  onSizeChange: vi.fn(),
}

describe("CalendarHeader", () => {
  it("shows the label and the range total", () => {
    render(<CalendarHeader {...base} />)
    expect(screen.getByText("This week · 10–16 Aug")).toBeTruthy()
    expect(screen.getByText("14:57:28")).toBeTruthy()
  })

  it("steps back and forward", () => {
    const onStep = vi.fn()
    render(<CalendarHeader {...base} onStep={onStep} />)
    fireEvent.click(screen.getByLabelText("Previous week"))
    expect(onStep).toHaveBeenCalledWith(-1)
    fireEvent.click(screen.getByLabelText("Next week"))
    expect(onStep).toHaveBeenCalledWith(1)
  })

  it("names the step buttons for the size on screen", () => {
    // "Previous week" is a lie on a day view, and it is the accessible name —
    // the only name a screen-reader user gets.
    render(<CalendarHeader {...base} size="day" />)
    expect(screen.getByLabelText("Previous day")).toBeTruthy()
    expect(screen.getByLabelText("Next day")).toBeTruthy()
  })

  it("changes size", () => {
    const onSizeChange = vi.fn()
    render(<CalendarHeader {...base} onSizeChange={onSizeChange} />)
    fireEvent.change(screen.getByLabelText("Calendar range"), {
      target: { value: "day" },
    })
    expect(onSizeChange).toHaveBeenCalledWith("day")
  })
})
