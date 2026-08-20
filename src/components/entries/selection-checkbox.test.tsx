import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SelectionCheckbox } from "./selection-checkbox"

afterEach(cleanup)

describe("SelectionCheckbox", () => {
  it("synchronizes native and accessible mixed state", () => {
    render(<SelectionCheckbox label="Select Tuesday" state="indeterminate" onToggle={() => {}} />)
    const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: "Select Tuesday" })
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
    // The reveal is four `[@media(hover:hover)_and_(pointer:fine)]:` utilities
    // now rather than one `.entry-selection-contextual` class. Asserted on the
    // hidden-at-rest one: it is the half that makes the control contextual at
    // all, and the three reveals are meaningless without it.
    const HIDDEN_AT_REST = "[@media(hover:hover)_and_(pointer:fine)]:opacity-0"

    const { rerender } = render(
      <SelectionCheckbox contextual label="Select entry" state="unchecked" onToggle={() => {}} />
    )
    expect(screen.getByRole("checkbox").className).toContain(HIDDEN_AT_REST)
    rerender(
      <SelectionCheckbox contextual label="Select entry" state="checked" onToggle={() => {}} />
    )
    expect(screen.getByRole("checkbox").className).not.toContain(HIDDEN_AT_REST)
  })
})
