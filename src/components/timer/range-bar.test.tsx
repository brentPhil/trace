import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { RangeBar } from "@/components/timer/range-bar"
import { chooseOption } from "@/test-utils/select"

/*
 * /timer's range bar.
 *
 * This is `calendar-header.test.tsx` grown up: the bar used to exist only
 * alongside the grid, so every assertion about it was an assertion about the
 * calendar. It is on screen in both views now, and what changes between them —
 * which presets are offered, whether there is a size select, what the arrows
 * are called — is the substance of this file.
 *
 * No `findBy*` and no `waitFor`: they hang in this repo (see
 * calendar-panel.test.tsx's header note). Everything here is synchronous after
 * `render`.
 */

afterEach(cleanup)

const base = {
  view: "calendar" as const,
  range: { from: "2026-08-10", to: "2026-08-16" },
  size: "week" as const,
  today: "2026-08-11",
  weekStartDay: 1,
  rangeMs: 53_848_000,
  display: "hms" as const,
  onStep: vi.fn(),
  onRangeChange: vi.fn(),
  onPresetChange: vi.fn(),
  onSizeChange: vi.fn(),
}

const pill = () => screen.getByRole("button", { name: /date range/i })

describe("RangeBar — the pill", () => {
  it("names the range the way /reports names the same one", () => {
    // The base range IS this week, so the pill says so. It used to print
    // "08/10/2026 - 08/16/2026" here while /reports printed prose for the
    // identical span — two spellings of one fact, on a control that is now
    // literally the same component.
    render(<RangeBar {...base} />)
    expect(screen.getByText("This week")).toBeTruthy()
  })

  it("falls back to the dates when no preset claims the range", () => {
    render(
      <RangeBar {...base} range={{ from: "2026-07-01", to: "2026-09-30" }} />
    )
    expect(screen.getByText("1 Jul – 30 Sep 2026")).toBeTruthy()
  })

  it("still says more to a screen reader than to the eye", () => {
    render(<RangeBar {...base} />)
    // The pill reads "This week"; the grid can say WHICH week it drew, so on
    // the calendar the spoken name still carries the dates the eye can now
    // read off the columns.
    expect(pill().getAttribute("aria-label")).toBe(
      "Date range — This week · 10–16 Aug"
    )
  })

  it("says the range is unbounded, and disables the arrows, for All dates", () => {
    render(<RangeBar {...base} range={null} view="list" />)

    // Was "MM/DD/YYYY - MM/DD/YYYY", the shape of an empty field. The range is
    // not missing, it is unbounded — a different thing to be told.
    expect(screen.getByText("All dates")).toBeTruthy()
    // "All dates" already reaches every entry in both directions. An arrow
    // there would either do nothing or bound a selection nobody made.
    expect(
      screen.getByRole("button", { name: "Previous range" }).hasAttribute("disabled")
    ).toBe(true)
    expect(
      screen.getByRole("button", { name: "Next range" }).hasAttribute("disabled")
    ).toBe(true)
  })
})

describe("RangeBar — the arrows", () => {
  it("steps back and forward", () => {
    const onStep = vi.fn()
    render(<RangeBar {...base} onStep={onStep} />)
    fireEvent.click(screen.getByLabelText("Previous week"))
    expect(onStep).toHaveBeenCalledWith(-1)
    fireEvent.click(screen.getByLabelText("Next week"))
    expect(onStep).toHaveBeenCalledWith(1)
  })

  it("names the step buttons for the size on screen", () => {
    // "Previous week" is a lie on a day view, and it is the accessible name —
    // the only name a screen-reader user gets.
    render(<RangeBar {...base} size="day" range={{ from: base.today, to: base.today }} />)
    expect(screen.getByLabelText("Previous day")).toBeTruthy()
    expect(screen.getByLabelText("Next day")).toBeTruthy()
  })

  it("calls a 5-day step a week, because that is how far it goes", () => {
    render(
      <RangeBar {...base} size="5day" range={{ from: "2026-08-10", to: "2026-08-14" }} />
    )
    expect(screen.getByLabelText("Previous week")).toBeTruthy()
  })

  it("names them for the range itself in List, where there is no size", () => {
    render(<RangeBar {...base} view="list" />)
    expect(screen.getByLabelText("Previous range")).toBeTruthy()
  })
})

describe("RangeBar — the preset rail", () => {
  const railPresets = () =>
    ["Today", "Yesterday", "This week", "Last week", "Last 30 days", "All dates"].filter(
      (label) => screen.queryByRole("button", { name: label }) !== null
    )

  it("offers the calendar four", () => {
    render(<RangeBar {...base} />)
    fireEvent.click(pill())

    // THE CONSTRAINT, VISIBLE. A time grid is a picture of a day at a fixed
    // pixels-per-hour; thirty columns of it is not a smaller version of the
    // same thing. See `CALENDAR_PRESETS`.
    expect(railPresets()).toEqual(["Today", "Yesterday", "This week", "Last week"])
  })

  it("offers the list six", () => {
    render(<RangeBar {...base} view="list" />)
    fireEvent.click(pill())

    expect(railPresets()).toEqual([
      "Today",
      "Yesterday",
      "This week",
      "Last week",
      "Last 30 days",
      "All dates",
    ])
  })

  it("reports the preset that was pressed", () => {
    const onPresetChange = vi.fn()
    render(<RangeBar {...base} view="list" onPresetChange={onPresetChange} />)
    fireEvent.click(pill())
    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }))

    expect(onPresetChange).toHaveBeenCalledWith("last-30-days")
  })

  it("shows the selection's own preset as pressed", () => {
    render(<RangeBar {...base} />)
    fireEvent.click(pill())

    // `base.range` IS the Monday-start week containing `today`.
    expect(
      screen.getByRole("button", { name: "This week" }).getAttribute("aria-pressed")
    ).toBe("true")
  })
})

describe("RangeBar — what only the calendar gets", () => {
  it("shows the size select and the range total on the grid", () => {
    render(<RangeBar {...base} />)
    expect(screen.getByLabelText("Calendar range")).toBeTruthy()
    expect(screen.getByText("14:57:28")).toBeTruthy()
  })

  it("hides both in List, where there are no columns to size", () => {
    render(<RangeBar {...base} view="list" />)
    expect(screen.queryByLabelText("Calendar range")).toBeNull()
    expect(screen.queryByText("Range total")).toBeNull()
  })

  it("changes size", () => {
    const onSizeChange = vi.fn()
    render(<RangeBar {...base} onSizeChange={onSizeChange} />)
    chooseOption("Calendar range", "Day view")
    expect(onSizeChange).toHaveBeenCalledWith("day")
  })

  it("says so when the total belongs to the range it has just left", () => {
    /*
     * `placeholderData` on the page's range query keeps the previous range's
     * rows on screen across an arrow click, so for one round trip this figure
     * describes a DIFFERENT span from the label beside it. Dimming alone would
     * not do — DESIGN.md: meaning is never carried by colour — so it is said,
     * and `aria-busy` carries it to anyone reading neither.
     */
    const { rerender } = render(<RangeBar {...base} isStale />)
    expect(screen.getByText("Updating…")).toBeTruthy()
    expect(screen.getByText("Range total").getAttribute("aria-busy")).toBe("true")

    rerender(<RangeBar {...base} />)
    expect(screen.queryByText("Updating…")).toBeNull()
    expect(screen.getByText("Range total").getAttribute("aria-busy")).toBe("false")
  })
})
