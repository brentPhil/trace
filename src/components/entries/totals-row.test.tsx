import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { TotalsRow } from "./totals-row"

afterEach(cleanup)

const HOUR = 3_600_000

/** The figure rendered next to a label, not the label itself. */
function figureFor(label: string): HTMLElement {
  const labelEl = screen.getByText(label)
  const figure = labelEl.nextElementSibling
  if (!(figure instanceof HTMLElement)) throw new Error(`no figure for ${label}`)
  return figure
}

describe("TotalsRow", () => {
  /*
   * DESIGN.md's Two Temperatures Rule: brass marks MONEY. A billable duration
   * is not money, it is time that will become money, and "8h 0m" in brass
   * reads as an amount — which is the one thing it is not.
   *
   * /reports already renders this exact figure in `text-foreground` and puts
   * brass only on the parenthesised currency amount beside it. This row showed
   * the same number in brass, so the product asserted both readings of its own
   * rule on two screens a click apart.
   */
  it("renders the billable total like any other duration, not as money", () => {
    render(<TotalsRow todayMs={4 * HOUR} weekMs={20 * HOUR} billableMs={8 * HOUR} />)

    const billable = figureFor("Billable")
    expect(billable.className).toBe(figureFor("Today").className)
    expect(billable.className).not.toContain("brass")
  })

  it("still shows the billable total only when there is billable time", () => {
    const { rerender } = render(
      <TotalsRow todayMs={4 * HOUR} weekMs={20 * HOUR} billableMs={0} />
    )
    expect(screen.queryByText("Billable")).toBeNull()

    rerender(<TotalsRow todayMs={4 * HOUR} weekMs={20 * HOUR} billableMs={HOUR} />)
    expect(screen.getByText("Billable")).toBeTruthy()
  })
})
