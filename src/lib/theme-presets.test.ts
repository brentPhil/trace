import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  DEFAULT_PRESET_ID,
  DEFAULT_RADIUS_ID,
  THEME_PRESET_IDS,
  THEME_RADII,
  THEME_RADIUS_IDS,
} from "@/lib/theme-preset-ids"
import { THEME_PRESETS, THEME_TOKENS, SWATCH_TOKENS, presetById } from "@/lib/theme-presets"

/**
 * THE DRIFT TEST, and the reason the duplication is safe.
 *
 * A preset exists twice on purpose: `styles.css` is what PAINTS the page, and
 * `theme-presets.ts` is what the picker reads to draw a swatch of a theme the
 * page is not currently wearing (a `var()` there would resolve to the active
 * theme, so every card would preview the same colours).
 *
 * The failure that buys is a swatch showing one colour and applying another —
 * silent, and the kind of thing nobody notices until a user reports that the
 * blue one "isn't blue". This file is what makes it loud.
 *
 * IT PARSES ANCHORED ON `[data-theme=`, which is what keeps it away from the
 * four unrelated blocks in that file: the base `:root` and `.dark`, and the
 * `:root` / `.dark` pair at the bottom holding the 24 `--project-*` hues. No
 * skip logic, no offsets, and an exact expected block count so a regex that
 * silently matches nothing cannot pass.
 */
const CSS = readFileSync(new URL("../styles.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
)

type Block = { selector: string; tokens: Record<string, string> }

function parsePresetBlocks(): ReadonlyArray<Block> {
  const blocks: Array<Block> = []
  const re = /(:root\[data-theme="[\w-]+"\](?:\.dark)?)\s*\{([^}]*)\}/g
  for (const match of CSS.matchAll(re)) {
    const tokens: Record<string, string> = {}
    for (const decl of match[2].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      tokens[decl[1]] = decl[2].trim()
    }
    blocks.push({ selector: match[1], tokens })
  }
  return blocks
}

const BLOCKS = parsePresetBlocks()
/** Every preset EXCEPT the default, which deliberately has no block: the base
 *  `:root` / `.dark` are its values, and an absent attribute is how it is
 *  selected. */
const SCOPED = THEME_PRESETS.filter((preset) => preset.id !== DEFAULT_PRESET_ID)

describe("the preset blocks in styles.css", () => {
  it("finds exactly one light and one dark block per scoped preset", () => {
    // Guards the parser itself: a regex that matched nothing would otherwise
    // make every comparison below vacuously true.
    expect(BLOCKS).toHaveLength(SCOPED.length * 2)
  })

  it("qualifies every selector with :root, so specificity decides and not source order", () => {
    /*
     * A bare `[data-theme="x"]` is (0,1,0) — a tie with `:root` AND with
     * `.dark`, resolved by whichever comes later in the file. That is a trap
     * rather than a bug today: it works until something appends a stylesheet,
     * at which point a preset silently stops overriding the dark ramp.
     */
    for (const block of BLOCKS) {
      expect(block.selector).toMatch(/^:root\[data-theme="[\w-]+"\](\.dark)?$/)
    }
  })

  it.each(SCOPED)("$id states every token in both ramps", (preset) => {
    for (const ramp of ["light", "dark"] as const) {
      const selector =
        ramp === "dark"
          ? `:root[data-theme="${preset.id}"].dark`
          : `:root[data-theme="${preset.id}"]`
      const block = BLOCKS.find((entry) => entry.selector === selector)
      expect(block, `no ${selector} block`).toBeDefined()
      expect(Object.keys(block!.tokens).sort()).toEqual([...THEME_TOKENS].sort())
    }
  })

  it.each(SCOPED)("$id matches src/lib/theme-presets.ts value for value", (preset) => {
    for (const ramp of ["light", "dark"] as const) {
      const selector =
        ramp === "dark"
          ? `:root[data-theme="${preset.id}"].dark`
          : `:root[data-theme="${preset.id}"]`
      const css = BLOCKS.find((entry) => entry.selector === selector)!.tokens
      for (const name of THEME_TOKENS) {
        expect(css[name], `--${name} in ${selector}`).toBe(preset[ramp][name])
      }
    }
  })
})

describe("the preset objects", () => {
  it("keeps THEME_PRESETS and THEME_PRESET_IDS in the same order", () => {
    expect(THEME_PRESETS.map((preset) => preset.id)).toEqual([...THEME_PRESET_IDS])
  })

  it("opens on the default", () => {
    // The picker renders these in order and the first card is the default, so
    // the two facts have to agree.
    expect(THEME_PRESETS[0].id).toBe(DEFAULT_PRESET_ID)
  })

  it("states every token in both ramps of every preset, default included", () => {
    // The default has no CSS block to compare against, so this is the only
    // thing standing between a missing key and a swatch rendering `undefined`
    // as a background — which paints nothing and looks like a deliberate blank.
    for (const preset of THEME_PRESETS) {
      for (const ramp of ["light", "dark"] as const) {
        expect(Object.keys(preset[ramp]).sort()).toEqual([...THEME_TOKENS].sort())
        for (const name of THEME_TOKENS) {
          expect(preset[ramp][name], `${preset.id}/${ramp} --${name}`).toMatch(/^oklch\(/)
        }
      }
    }
  })

  it("draws its swatch from tokens the presets actually define", () => {
    for (const token of SWATCH_TOKENS) {
      expect(THEME_TOKENS).toContain(token)
    }
  })

  it("falls back to the default rather than throwing on an unknown id", () => {
    // Reachable in the wild: a stored id survives a preset being removed.
    // @ts-expect-error — deliberately outside the union, which is the case.
    expect(presetById("nope").id).toBe(DEFAULT_PRESET_ID)
  })
})

describe("the default preset", () => {
  it("has no block of its own, so an unset attribute lands on the base ramps", () => {
    /*
     * This is the load-bearing half of the no-flash story. A fresh install has
     * written no `data-theme` at all, so if `neutral` had its own scoped block
     * it would never apply to exactly the people who have never opened the
     * picker — and the repairs in the base ramps would be the ones that never
     * reached them.
     */
    expect(CSS).not.toContain(`[data-theme="${DEFAULT_PRESET_ID}"]`)
  })

  it("matches the base :root and .dark blocks value for value", () => {
    // The default's ramps are restated in TS only so the picker can draw its
    // swatch. If they drift from the base palette, the first card previews a
    // theme the app does not have.
    const base = (selector: string) => {
      const open = CSS.indexOf(`${selector} {`)
      const start = CSS.indexOf("{", open)
      let depth = 0
      for (let i = start; i < CSS.length; i++) {
        if (CSS[i] === "{") depth++
        else if (CSS[i] === "}" && --depth === 0) return CSS.slice(start, i)
      }
      throw new Error(`unterminated ${selector}`)
    }
    const read = (text: string, name: string) =>
      text.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim()

    const light = base(":root")
    const dark = base(".dark")
    const preset = presetById(DEFAULT_PRESET_ID)
    for (const name of THEME_TOKENS) {
      expect(read(light, name), `:root --${name}`).toBe(preset.light[name])
      // A token the dark block does not restate is inherited from `:root`,
      // which is how the cascade reads it and how the TS ramp states it.
      expect(read(dark, name) ?? read(light, name), `.dark --${name}`).toBe(
        preset.dark[name]
      )
    }
  })
})

describe("the radius steps", () => {
  /** Every `:root[data-radius="…"]` block, with the `--radius` it declares. */
  const blocks = new Map(
    [...CSS.matchAll(/:root\[data-radius="([\w-]+)"\]\s*\{([^}]*)\}/g)].map((m) => [
      m[1],
      m[2].match(/--radius:\s*([^;]+);/)?.[1].trim(),
    ])
  )

  it("declares a block for every step except the default", () => {
    // Same rule as `neutral`: the default IS the base `:root`, and an absent
    // attribute is how it is chosen. An exact count keeps a regex that matched
    // nothing from passing this vacuously.
    const scoped = THEME_RADIUS_IDS.filter((id) => id !== DEFAULT_RADIUS_ID)
    expect([...blocks.keys()].sort()).toEqual([...scoped].sort())
  })

  it("matches the value THEME_RADII advertises", () => {
    // The picker draws each option at the radius it names, from THEME_RADII —
    // so a step that says one thing and applies another is the same class of
    // bug as a swatch previewing the wrong colour.
    for (const entry of THEME_RADII) {
      if (entry.id === DEFAULT_RADIUS_ID) continue
      expect(blocks.get(entry.id), `--radius for ${entry.id}`).toBe(entry.value)
    }
  })

  it("advertises the base --radius as the default step", () => {
    const base = CSS.slice(CSS.indexOf(":root {"))
    const declared = base.match(/--radius:\s*([^;]+);/)?.[1].trim()
    const advertised = THEME_RADII.find((entry) => entry.id === DEFAULT_RADIUS_ID)?.value
    expect(declared).toBe(advertised)
  })

  it("derives every step of the scale from --radius, so all of them move", () => {
    /*
     * The gap that made a radius control nearly pointless: Tailwind ships
     * `rounded-2xl` / `3xl` / `4xl` as STATIC lengths, and the vendored shadcn
     * components reach for them far more often than the four below. If any of
     * these stops referencing `var(--radius)`, the control silently starts
     * moving only part of the app.
     */
    const theme = CSS.slice(CSS.indexOf("@theme inline {"))
    for (const step of ["sm", "md", "lg", "xl", "2xl", "3xl", "4xl"]) {
      const value = theme.match(new RegExp(`--radius-${step}:\\s*([^;]+);`))?.[1]
      expect(value, `--radius-${step}`).toBeDefined()
      expect(value, `--radius-${step} must derive from --radius`).toContain("var(--radius)")
    }
  })

  it("uses multiplication, not offsets, so a 0rem radius stays valid", () => {
    // `calc(0rem - 4px)` is a negative border-radius: invalid, so the browser
    // drops the declaration and the element keeps whatever it had. Multiples
    // collapse to zero cleanly.
    const theme = CSS.slice(CSS.indexOf("@theme inline {"))
    for (const step of ["sm", "md", "xl", "2xl", "3xl", "4xl"]) {
      const value = theme.match(new RegExp(`--radius-${step}:\\s*([^;]+);`))?.[1] ?? ""
      // `- 4px` or `+ 4px` INSIDE the calc. Anchored on the operator followed by
      // a length, so `var(--radius)` and a bare multiplier are both fine.
      expect(value, `--radius-${step}`).not.toMatch(/[-+]\s*\d*\.?\d+\s*(px|rem|em)/)
    }
  })
})
