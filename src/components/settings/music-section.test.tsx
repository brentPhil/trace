import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MusicSection } from "@/components/settings/music-section"

afterEach(cleanup)

describe("MusicSection", () => {
  it("renders both controls with their current values", () => {
    render(
      <MusicSection
        musicAutoplay={true}
        musicOnStop="pause"
        onChange={vi.fn()}
      />
    )
    // The element type goes in the TYPE PARAMETER, not in a trailing `as`.
    // `getByRole<T extends HTMLElement = HTMLElement>` can only infer `T` from
    // the call's contextual type, and a type assertion supplies exactly that —
    // so `getByRole(...) as HTMLInputElement` was inferring `T =
    // HTMLInputElement` and then asserting the result to the type it had just
    // caused. The assertion narrowed nothing and checked nothing; the linter
    // is right that it is dead. Naming `T` outright is the same guarantee said
    // once instead of in a circle.
    const checkbox = screen.getByRole<HTMLInputElement>("checkbox", {
      name: /play music when tracking starts/i,
    })
    expect(checkbox.checked).toBe(true)

    const select = screen.getByRole<HTMLSelectElement>("combobox", {
      name: /when tracking stops/i,
    })
    expect(select.value).toBe("pause")
  })

  it("toggling the checkbox calls back with false", () => {
    const onChange = vi.fn()
    render(
      <MusicSection
        musicAutoplay={true}
        musicOnStop="pause"
        onChange={onChange}
      />
    )
    fireEvent.click(
      screen.getByRole("checkbox", { name: /play music when tracking starts/i })
    )
    expect(onChange).toHaveBeenCalledWith({ musicAutoplay: false })
  })

  it('choosing "continue" calls back with "continue"', () => {
    const onChange = vi.fn()
    render(
      <MusicSection
        musicAutoplay={true}
        musicOnStop="pause"
        onChange={onChange}
      />
    )
    fireEvent.change(
      screen.getByRole("combobox", { name: /when tracking stops/i }),
      { target: { value: "continue" } }
    )
    expect(onChange).toHaveBeenCalledWith({ musicOnStop: "continue" })
  })

  it("shows all three stop-option labels", () => {
    render(
      <MusicSection
        musicAutoplay={true}
        musicOnStop="pause"
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText("Stop the music")).toBeTruthy()
    expect(screen.getByText("Pause the music")).toBeTruthy()
    expect(screen.getByText("Keep playing")).toBeTruthy()
  })
})
