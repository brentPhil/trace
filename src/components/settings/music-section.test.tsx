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
    const checkbox = screen.getByRole("checkbox", {
      name: /play music when tracking starts/i,
    }) as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    const select = screen.getByRole("combobox", {
      name: /when tracking stops/i,
    }) as HTMLSelectElement
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
