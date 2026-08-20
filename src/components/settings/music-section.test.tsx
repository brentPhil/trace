import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MusicSection } from "@/components/settings/music-section"

afterEach(cleanup)

describe("MusicSection", () => {
  it("renders both controls with their current values", () => {
    render(
      <MusicSection
        musicAutoplay={true}
        musicOnStop="stop"
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
    expect(select.value).toBe("stop")
  })

  it("toggling the checkbox calls back with false", () => {
    const onChange = vi.fn()
    render(
      <MusicSection
        musicAutoplay={true}
        musicOnStop="stop"
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
        musicOnStop="stop"
        onChange={onChange}
      />
    )
    fireEvent.change(
      screen.getByRole("combobox", { name: /when tracking stops/i }),
      { target: { value: "continue" } }
    )
    expect(onChange).toHaveBeenCalledWith({ musicOnStop: "continue" })
  })

  /*
   * TWO OPTIONS, AND THE ABSENT ONE IS ASSERTED.
   *
   * "Pause the music" was the third, and it and "Stop the music" differed by a
   * single `currentTime = 0` — the same silence when the timer stopped, and a
   * difference only in whether the next press of Play rewound the track, which
   * a reload erased anyway. Asserting the label is GONE, not merely that the
   * other two are present, is what stops it being helpfully added back by
   * someone who reads a two-item dropdown as an oversight.
   */
  it("offers exactly two, and no longer distinguishes pause from stop", () => {
    render(
      <MusicSection
        musicAutoplay={true}
        musicOnStop="stop"
        onChange={vi.fn()}
      />
    )
    expect(screen.getByText("Stop the music")).toBeTruthy()
    expect(screen.getByText("Keep playing")).toBeTruthy()
    expect(screen.queryByText("Pause the music")).toBe(null)
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", {
        name: /when tracking stops/i,
      }).options
    ).toHaveLength(2)
  })
})
