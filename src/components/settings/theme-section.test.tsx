import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"

import { ThemeSection } from "@/components/settings/theme-section"
import { chooseOption, optionLabels, selectedLabel } from "@/test-utils/select"
import { THEME_PRESETS } from "@/lib/theme-presets"
import { THEME_RADII } from "@/lib/theme-preset-ids"
import type { ThemePresetId, ThemeRadiusId } from "@/lib/theme-preset-ids"
import type { Theme } from "@/lib/theme"

afterEach(cleanup)

function renderSection(
  over: Partial<{
    theme: Theme
    resolved: "light" | "dark"
    hydrated: boolean
    preset: ThemePresetId
    radius: ThemeRadiusId
  }> = {}
) {
  const actions = {
    setTheme: vi.fn(),
    setPreset: vi.fn(),
    setRadius: vi.fn(),
  }
  const view = render(
    <ThemeSection
      theme={over.theme ?? "system"}
      resolved={over.resolved ?? "dark"}
      hydrated={over.hydrated ?? true}
      preset={over.preset ?? "neutral"}
      radius={over.radius ?? "default"}
      actions={actions}
    />
  )
  return { ...actions, ...view }
}

describe("ThemeSection", () => {
  it("offers three orthogonal controls, not one combined list", () => {
    // A preset ships both ramps and states no polarity; a radius states
    // neither. Multiplying them into one list would be 6 x 3 x 4 options.
    renderSection()
    // A TABLIST, deliberately: the polarity control IS `ui/tabs.tsx` now,
    // the same component Calendar/List uses — see theme-toggle.tsx for the
    // role trade-off that buys.
    expect(screen.getByRole("tablist", { name: "Theme" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Colour theme" })).toBeTruthy()
    expect(screen.getByRole("combobox", { name: "Corner radius" })).toBeTruthy()
  })

  it("lists every shipped preset, default first", () => {
    renderSection()
    expect(optionLabels("Colour theme")).toEqual(
      THEME_PRESETS.map((preset) => preset.label)
    )
  })

  it("lists every radius step", () => {
    renderSection()
    expect(optionLabels("Corner radius")).toEqual(
      THEME_RADII.map((entry) => entry.label)
    )
  })

  it("shows the current preset by NAME, not by id", () => {
    // The one trap `ui/select.tsx` documents: the trigger renders the VALUE,
    // which here is `"emerald"`, unless a formatter turns it into a label.
    renderSection({ preset: "emerald" })
    expect(selectedLabel("Colour theme")).toBe("Emerald")
  })

  it("shows the current radius by name", () => {
    renderSection({ radius: "none" })
    expect(selectedLabel("Corner radius")).toBe("Square")
  })

  it("reports a chosen preset by id", () => {
    const { setPreset } = renderSection()
    chooseOption("Colour theme", "Indigo")
    expect(setPreset).toHaveBeenCalledWith("indigo")
  })

  it("reports a chosen radius by id", () => {
    const { setRadius } = renderSection()
    chooseOption("Corner radius", "Round")
    expect(setRadius).toHaveBeenCalledWith("large")
  })

  it("lets the default be chosen back, which is the whole reset affordance", () => {
    // No Reset button, and none needed: picking the first option clears the
    // attribute. A direct benefit of a closed set over free-form editing.
    const { setPreset } = renderSection({ preset: "rose" })
    chooseOption("Colour theme", "Neutral")
    expect(setPreset).toHaveBeenCalledWith("neutral")
  })

  it("commits nothing at all until the provider has hydrated", () => {
    /*
     * The provider starts at its defaults and adopts the stored values in a
     * mount effect, and /settings renders on the server — so before hydration
     * its idea of the choice is a guess. The triggers show their placeholder
     * rather than a palette name that may be wrong, and no polarity cell is
     * filled. One tick of nothing is honest; one tick of the wrong answer is a
     * control that lies, on the controls whose whole job is to report state.
     */
    renderSection({
      hydrated: false,
      preset: "indigo",
      radius: "large",
      theme: "light",
    })
    expect(selectedLabel("Colour theme")).toBe("Colour theme")
    expect(selectedLabel("Corner radius")).toBe("Corners")
    const polarity = within(
      screen.getByRole("tablist", { name: "Theme" })
    ).getAllByRole("tab")
    for (const cell of polarity) {
      expect(cell).toHaveAttribute("aria-selected", "false")
    }
  })

  it("previews each preset with literal colours, never with var()", () => {
    /*
     * A `var(--primary)` inside this page resolves against the ACTIVE theme, so
     * every option would preview whatever is already applied and the list would
     * be six identical strips. The swatch has to carry the values it describes.
     */
    const { container } = renderSection()
    const chips = [...container.querySelectorAll<HTMLElement>("[style*='background']")]
    expect(chips.length).toBeGreaterThan(0)
    for (const chip of chips) {
      const style = chip.getAttribute("style") ?? ""
      expect(style).toContain("oklch")
      expect(style).not.toContain("var(")
    }
  })

  it("draws BOTH ramps on the trigger and lets the cascade choose", () => {
    /*
     * Not `preset[resolved][token]`: `resolved` is `"dark"` on the server and on
     * the first client render, so a specimen keyed off it would paint the dark
     * ramp and then snap. Both strips render; `dark:hidden` / `hidden dark:flex`
     * picks, which is already right at first paint.
     */
    const { container } = renderSection()
    const strips = [...container.querySelectorAll("span")].filter((node) =>
      /dark:(hidden|flex)/.test(node.className)
    )
    expect(strips.filter((s) => s.className.includes("dark:hidden"))).toHaveLength(1)
    expect(strips.filter((s) => s.className.includes("dark:flex"))).toHaveLength(1)
  })

  it("draws the radius mark at the radius it names", () => {
    // Same reason as the colour swatches: a `rounded-md` utility resolves to the
    // ACTIVE radius, so every option would look identical.
    const { container } = renderSection({ radius: "large" })
    const marks = [
      ...container.querySelectorAll<HTMLElement>("[style*='border-top-left-radius']"),
    ]
    expect(marks.length).toBeGreaterThan(0)
    expect(marks[0].getAttribute("style")).toContain("1rem")
  })

  it("says so in forced-colors, where every specimen collapses to one fill", () => {
    /*
     * The UA overrides author `background-color` there — inline styles
     * included — so the swatches become indistinguishable and the picker looks
     * broken rather than overridden. Same discipline as `hatch.ts` and
     * `project-dot.tsx`.
     */
    renderSection()
    const note = screen.getByText(/operating system.+colours override the theme/i)
    expect(note.className).toContain("forced-colors:block")
    expect(note.className).toContain("hidden")
  })
})
