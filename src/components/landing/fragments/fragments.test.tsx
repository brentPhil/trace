import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { DayLogFragment } from "./day-log"
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
    expect(container.textContent).toContain("25h 48m")
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
