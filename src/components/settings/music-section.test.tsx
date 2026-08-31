import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MusicSection } from "@/components/settings/music-section"
import { chooseOption, optionLabels, selectedLabel } from "@/test-utils/select"

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

    // The selection is text on the trigger now, not a `value`: a Base UI
    // Select is a button, and "stop" is the stored value while "Stop the
    // music" is what a reader actually sees.
    expect(selectedLabel(/when tracking stops/i)).toBe("Stop the music")
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
    chooseOption(/when tracking stops/i, "Keep playing")
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
    // Read off the open listbox: the options only exist in the DOM while the
    // Select is open, so this both opens it and asserts what it offers.
    expect(optionLabels(/when tracking stops/i)).toEqual([
      "Stop the music",
      "Keep playing",
    ])
  })
})
