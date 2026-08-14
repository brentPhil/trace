import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SelectionCheckbox } from "./selection-checkbox"

afterEach(cleanup)

describe("SelectionCheckbox", () => {
  it("synchronizes native and accessible mixed state", () => {
    render(<SelectionCheckbox label="Select Tuesday" state="indeterminate" onToggle={() => {}} />)
    const checkbox = screen.getByRole("checkbox", { name: "Select Tuesday" }) as HTMLInputElement
    expect(checkbox.checked).toBe(false)
    expect(checkbox.indeterminate).toBe(true)
    expect(checkbox.getAttribute("aria-checked")).toBe("mixed")
  })

  it("calls back with the originating input", () => {
    const onToggle = vi.fn()
    render(<SelectionCheckbox label="Select entry" state="unchecked" onToggle={onToggle} />)
    const checkbox = screen.getByRole("checkbox", { name: "Select entry" })
    fireEvent.click(checkbox)
    expect(onToggle).toHaveBeenCalledWith(checkbox)
  })

  it("marks only an unchecked contextual control for hover reveal", () => {
    const { rerender } = render(
      <SelectionCheckbox contextual label="Select entry" state="unchecked" onToggle={() => {}} />
    )
    expect(screen.getByRole("checkbox").className).toContain("entry-selection-contextual")
    rerender(
      <SelectionCheckbox contextual label="Select entry" state="checked" onToggle={() => {}} />
    )
    expect(screen.getByRole("checkbox").className).not.toContain("entry-selection-contextual")
  })
})
