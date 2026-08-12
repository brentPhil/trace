import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DateRangePicker } from "@/components/history/date-range-picker"
import { monthLabel } from "@/lib/month-grid"
import type * as ForceCloseModuleType from "@/lib/popover-force-close"
import type { PopoverActionsRef } from "@/lib/popover-force-close"

type ForceCloseModule = typeof ForceCloseModuleType

/*
 * `useForceCloseWhenClosed` wrapped so the assertion below can be about WHAT
 * IT IS PASSED, while the real hook still runs.
 *
 * Its own behaviour is fully covered in popover-force-close.test.tsx and
 * cannot be re-proved from here: jsdom has no `Element.prototype.getAnimations`,
 * so Base UI's animated close takes its synchronous fallback and every popover
 * unmounts immediately in tests, fixed or not. What IS observable at this
 * level is whether this component drives the force-close off its `open` state
 * — which is the whole difference between the hook and the fire-and-forget
 * helper it replaced.
 */
const { forceCloseCalls } = vi.hoisted(() => ({ forceCloseCalls: vi.fn() }))

vi.mock("@/lib/popover-force-close", async (importOriginal) => {
  const actual = await importOriginal<ForceCloseModule>()
  return {
    ...actual,
    // `isOpen`, not `open`: this file already has an `open()` render helper.
    useForceCloseWhenClosed: (isOpen: boolean, actionsRef: PopoverActionsRef) => {
      forceCloseCalls(isOpen)
      return actual.useForceCloseWhenClosed(isOpen, actionsRef)
    },
  }
})

/*
 * The range picker replacing the hand-built calendar, now `Popover` +
 * shadcn's `Calendar mode="range"` (react-day-picker).
 *
 * Pure props in, `{ from, to }` out — no router, no Convex — so what these
 * tests prove is exactly what `PeriodControls` gets: a single control that makes
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
      today="2026-08-06"
      weekStartDay={1}
      label="1 Aug 2026"
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
  /*
   * The trigger says what the CALLER gives it.
   *
   * It used to compute its own text from a `period`, which only ever made
   * sense for /reports — /timer has no period and prints `08/10/2026 -
   * 08/16/2026`, the format this product puts on invoices. What each page's
   * label says is asserted where the label is made: `date-range-picker.test.ts`
   * for `rangeTriggerLabel`, `period-controls.test.tsx` for /reports' wiring of
   * it, and `timer-range.test.ts` for /timer's.
   */
  it("shows the label it is given", () => {
    render(
      <DateRangePicker
        from="2026-08-03"
        to="2026-08-09"
        today="2026-08-06"
        weekStartDay={1}
        label="3 – 9 Aug 2026"
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText("3 – 9 Aug 2026")).toBeTruthy()
  })

  it("can be named differently for a screen reader than for the eye", () => {
    // "zero eight slash one zero slash two zero two six", twice, is what the
    // visible label spells out loud — so /timer hands over prose as well.
    render(
      <DateRangePicker
        from="2026-08-03"
        to="2026-08-09"
        today="2026-08-06"
        weekStartDay={1}
        label="08/03/2026 - 08/09/2026"
        spokenLabel="This week · 3–9 Aug"
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText("08/03/2026 - 08/09/2026")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Date range — This week · 3–9 Aug" })
    ).toBeTruthy()
  })

  it("offers a grid with nothing selected when nothing is bounded", () => {
    // /timer's "All dates" default. The grid still opens on today's month, and
    // no day is painted as picked — a highlighted "today" would claim a
    // selection nobody made.
    open({ from: null, to: null, label: "MM/DD/YYYY - MM/DD/YYYY" })

    expect(screen.getByText(monthLabel("2026-08-01"))).toBeTruthy()
    expect(document.querySelectorAll('[data-range="start"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-range="in-range"]')).toHaveLength(0)
  })
})

describe("DateRangePicker preset rail", () => {
  const PRESETS = [
    { value: "today", label: "Today" },
    { value: "this-week", label: "This week" },
    { value: "all-dates", label: "All dates" },
  ]

  it("draws one chip per preset, with the active one pressed", () => {
    open({
      presets: { items: PRESETS, active: "this-week", onSelect: vi.fn() },
    })

    expect(
      screen.getByRole("button", { name: "This week" }).getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      screen.getByRole("button", { name: "Today" }).getAttribute("aria-pressed")
    ).toBe("false")
  })

  it("reports the chosen preset and closes", () => {
    const onSelect = vi.fn()
    open({ presets: { items: PRESETS, active: null, onSelect } })

    fireEvent.click(screen.getByRole("button", { name: "All dates" }))

    expect(onSelect).toHaveBeenCalledWith("all-dates")
    // The popup is gone, so the month grid it held is gone with it.
    expect(screen.queryByText(monthLabel("2026-08-01"))).toBeNull()
  })

  it("draws no rail at all when a caller offers none", () => {
    // /reports has its own Day/Week/Month row outside the popover and must not
    // grow a second one inside it.
    open({})
    expect(screen.queryByRole("button", { name: "This week" })).toBeNull()
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

  it("selects a single past day by clicking it twice", () => {
    // The Day/Week/Month control can already select TODAY as a one-day
    // range; this is the same shape of range for an arbitrary PAST day,
    // reached the same two-click way as any other custom range — "just the
    // 3rd of August" while reconstructing an invoice.
    const { onChange } = open({ from: "2026-08-01", to: "2026-08-01" })

    fireEvent.click(dayButton(3))
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(dayButton(3))
    expect(onChange).toHaveBeenCalledWith({ from: "2026-08-03", to: "2026-08-03" })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("draws a one-day range as one closed day, not as a half-open one", () => {
    /*
     * THE DEFECT THIS PINS. react-day-picker sets BOTH `range_start` and
     * `range_end` on a range whose two ends are the same day, and never a bare
     * `selected` — so reading "single" as "selected with none of the range
     * flags" made that case unreachable. The day fell into both endpoint
     * branches at once, and tailwind-merge collapsed the conflicting
     * `rounded-l-*` / `rounded-r-*` down to the last one: a flat-left,
     * round-right half pill, with ", start of range" announced and no end
     * anywhere in the grid to match it.
     *
     * It is the shape /timer's "Today" and "Yesterday" presets drew and the
     * one /reports' Day period drew, which is to say the most common selection
     * this control has.
     */
    open({ from: "2026-08-03", to: "2026-08-03" })

    const day = dayButton(3)
    expect(day).toHaveAttribute("data-range", "single")
    expect(day.getAttribute("aria-label")).toContain(", selected")
    expect(day.getAttribute("aria-label")).not.toContain("of range")
    // Nothing is left half-open: no lone start, no lone end.
    expect(document.querySelectorAll('[data-range="start"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-range="end"]')).toHaveLength(0)
  })
})

describe("DateRangePicker today", () => {
  it("marks today with aria-current as well as the dot and the name", () => {
    open({ from: "2026-08-01", to: "2026-08-01", today: "2026-08-06" })

    expect(dayButton(6)).toHaveAttribute("aria-current", "date")
    // …and nothing else claims to be today.
    expect(document.querySelectorAll('[data-range][aria-current="date"]')).toHaveLength(1)
  })
})

describe("DateRangePicker popover close", () => {
  /*
   * The helper this replaced was uncancellable: re-open inside its 200ms
   * window and it fired Base UI's `forceUnmount` against a LIVE popup, nulling
   * the trigger and focus-return refs underneath a replayed entrance
   * transition. It also only ever covered the one close path its caller
   * remembered to call it from — never Escape, an outside click, or the Close
   * button. `useForceCloseWhenClosed` is driven off `open`, so it covers all
   * of them and cancels itself on re-open.
   *
   * Asserting on the ARGUMENT is what makes this test able to fail. A version
   * that merely called the hook — with a constant, or with a value unrelated
   * to the popover's state — would still be broken, and would still render
   * identically in jsdom.
   */
  it("drives the force-close off the popover's own open state", () => {
    const { onChange } = open({ from: "2026-08-01", to: "2026-08-01" })

    fireEvent.click(dayButton(3))
    fireEvent.click(dayButton(9))
    expect(onChange).toHaveBeenCalledWith({ from: "2026-08-03", to: "2026-08-09" })

    // Closed on first render, open once the trigger is clicked. Both readings
    // must reach the hook, or a stuck popup never gets forced out.
    const seen = forceCloseCalls.mock.calls.map(([isOpen]) => isOpen)
    expect(seen).toContain(false)
    expect(seen).toContain(true)
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
