import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { DayLogFragment } from "./day-log"
import { DayRulerFragment, rulerSegments } from "./day-ruler"
import { InvoiceFragment } from "./invoice"
import { ReportReadoutFragment } from "./report-readout"

afterEach(cleanup)

describe("DayLogFragment", () => {
  it("draws five rows, with the one noteless row hatched", () => {
    const { container } = render(<DayLogFragment />)
    expect(container.querySelectorAll("li")).toHaveLength(5)
    expect(container.querySelectorAll("[data-hatched]")).toHaveLength(1)
    expect(container.textContent).toContain("Import now skips duplicate ISBNs")
  })

  it("totals the day from its rows", () => {
    const { container } = render(<DayLogFragment />)
    // 106 + 30 + 100 + 95 + 72 = 403 minutes
    expect(container.textContent).toContain("6h 43m")
  })

  it("is inert", () => {
    const { container } = render(<DayLogFragment />)
    expect(
      container
        .querySelector('[data-landing-fragment="day-log"]')
        ?.hasAttribute("inert")
    ).toBe(true)
  })
})

describe("ReportReadoutFragment", () => {
  it("shows the four figures the real readout shows, computed from the week", () => {
    const { container } = render(<ReportReadoutFragment />)
    const labels = [...container.querySelectorAll("dt")].map(
      (d) => d.textContent
    )
    expect(labels).toEqual(["Tracked", "Billable", "Earned", "Entries"])
    expect(container.textContent).toContain("25h 19m")
    expect(container.textContent).toContain("21h 30m")
    expect(container.textContent).toContain("$1,935.00")
  })

  it("hatches the empty day instead of leaving a gap", () => {
    const { container } = render(<ReportReadoutFragment />)
    expect(container.querySelectorAll("[data-hatched]")).toHaveLength(1)
  })
})

describe("InvoiceFragment", () => {
  it("prints hours × rate and the total through the real InvoiceLines", () => {
    const { container } = render(<InvoiceFragment />)
    expect(container.textContent).toContain("Catalogue import script")
    expect(container.textContent).toContain("12.50")
    // 1125.00 + 607.50 + 360.00
    expect(container.textContent).toContain("$2,092.50")
  })
})

describe("rulerSegments", () => {
  const project = { name: "P", color: "teal" as const, archived: false }
  const axis = { startMinute: 8 * 60, endMinute: 19 * 60 }
  const entries = [
    { startMinute: 9 * 60, endMinute: 10 * 60, project },
    // a 5-minute gap: plain ground, not hatch
    { startMinute: 10 * 60 + 5, endMinute: 12 * 60, project },
    // a 60-minute gap: hatched
    { startMinute: 13 * 60, endMinute: 14 * 60, project },
  ]
  const running = { startMinute: 14 * 60, project, elapsedSeconds: 3600 }

  it("places entries as percentages of the axis", () => {
    const first = rulerSegments(entries, running, axis).at(0)
    expect(first).toMatchObject({ kind: "entry" })
    expect(first?.left).toBeCloseTo((60 / 660) * 100)
    expect(first?.width).toBeCloseTo((60 / 660) * 100)
  })

  it("hatches only gaps of at least fifteen minutes", () => {
    const gaps = rulerSegments(entries, running, axis).filter(
      (s) => s.kind === "gap"
    )
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.left).toBeCloseTo(((12 * 60 - 480) / 660) * 100)
  })

  it("runs the running entry from its start to now", () => {
    const last = rulerSegments(entries, running, axis).at(-1)
    expect(last).toMatchObject({ kind: "running" })
    expect(last?.width).toBeCloseTo((60 / 660) * 100)
  })

  it("clamps the running entry at the end of the axis", () => {
    const last = rulerSegments(
      entries,
      { ...running, elapsedSeconds: 24 * 3600 },
      axis
    ).at(-1)
    expect((last?.left ?? 0) + (last?.width ?? 0)).toBeCloseTo(100)
  })
})

describe("DayRulerFragment", () => {
  it("draws the sample day: five entries, lunch hatched, one running block", () => {
    const { container } = render(<DayRulerFragment />)
    expect(container.querySelectorAll("[data-entry]")).toHaveLength(5)
    expect(container.querySelectorAll("[data-hatched]")).toHaveLength(1)
    expect(container.querySelectorAll("[data-running]")).toHaveLength(1)
  })

  it("is inert", () => {
    const { container } = render(<DayRulerFragment />)
    expect(
      container
        .querySelector('[data-landing-fragment="day-ruler"]')
        ?.hasAttribute("inert")
    ).toBe(true)
  })
})
