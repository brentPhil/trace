import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { DEFAULT_PRESET_ID, THEME_PRESET_IDS } from "@/lib/theme-preset-ids"
import type { ThemePresetId } from "@/lib/theme-preset-ids"

/**
 * THE CONTRAST FLOOR, measured from `styles.css` itself.
 *
 * This file was deleted with the Darkroom palette, on the argument that once a
 * user picks the theme no fixed assertion can hold. That argument was half
 * right: it is true of a theme the USER authors, and false of the palette this
 * repo ships. shadcn's defaults are not accessible out of the box — light
 * `--ring` was 2.58:1, dark `--input` 1.48:1, light `--muted-foreground` 4.35:1
 * on `--muted` — and a picker built on top of an unmeasured base inherits every
 * one of those failures into every preset.
 *
 * So it is back, smaller in ambition and larger in coverage, and it ranges over
 * EVERY SHIPPED PRESET in both ramps — which is the practical argument for a
 * closed preset set over a free-form editor. A palette the user authors cannot
 * be asserted about; a palette the product ships can be, and adding a preset
 * adds its two scopes here automatically.
 *
 * TWO THINGS ARE LOAD-BEARING AND EASY TO GET WRONG.
 *
 * 1. COMPOSITING HAPPENS IN GAMMA-ENCODED sRGB, because that is what a
 *    compositor does. Dark `--border` is `oklch(1 0 0 / 10%)`; composited in
 *    gamma it measures 1.26:1 against the page and composited in linear light
 *    it measures 2.87:1 — a 2.3x error, in the PASSING direction, on the exact
 *    token the palette is weakest at. `pins the compositing space` below fails
 *    if anyone rewrites `over()` to composite in linear light.
 *
 * 2. LUMINANCE IS DEFINED ON 8-BIT CHANNELS. The round trip through bytes is
 *    not pedantry — it is what makes these figures agree with a browser's own
 *    contrast readout to the second decimal.
 *
 * The pair list is CALL-SITE SHAPED, not a token cross-product. A cross-product
 * cannot see `src/lib/hatch.ts`, where the Hatch Rule's stripe is 55% of a
 * token that is itself translucent — two alphas compounding, which is where the
 * real failures live.
 */
const CSS = readFileSync(new URL("./styles.css", import.meta.url), "utf8")
  // Comments first, always. A docblock that quotes a token declaration —
  // and several do — is otherwise matched by the resolver as if it were one.
  .replace(/\/\*[\s\S]*?\*\//g, "")

/**
 * One CSS block, by its exact selector, brace-matched.
 *
 * Anchored on the selector rather than sliced by offsets, because styles.css
 * holds FOUR `:root`-ish blocks now — the base palette, the two preset blocks,
 * and the `--project-*` data at the bottom — and an offset slice that was
 * correct when there were two silently reads the wrong one when a preset is
 * added between them.
 */
function block(selector: string): string {
  const open = CSS.indexOf(`${selector} {`)
  if (open < 0) throw new Error(`styles.css has no \`${selector}\` block`)
  const start = CSS.indexOf("{", open)
  let depth = 0
  for (let i = start; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++
    else if (CSS[i] === "}") {
      depth--
      if (depth === 0) return CSS.slice(start, i)
    }
  }
  throw new Error(`unterminated block for \`${selector}\``)
}

const BASE_LIGHT = block(":root")
const BASE_DARK = block(".dark")

type RampName = "light" | "dark"
/** A preset and a polarity: the two axes that are orthogonal at runtime and
 *  have to be measured as a product, because a preset ships both ramps. */
type Ramp = { preset: ThemePresetId; ramp: RampName }

/**
 * The cascade, modelled rather than guessed.
 *
 * `:root[data-theme="x"].dark` is (0,3,0), `:root[data-theme="x"]` is (0,2,0),
 * and the base `:root` / `.dark` are both (0,1,0) with `.dark` later in the
 * file. So a token in the dark ramp of a preset resolves through four blocks in
 * that order, and this array IS that order.
 *
 * Our presets are complete, so in practice the first entry always answers —
 * which is exactly what makes an incomplete one visible instead of silent.
 */
function chain({ preset, ramp }: Ramp): ReadonlyArray<string> {
  const base = ramp === "dark" ? [BASE_DARK, BASE_LIGHT] : [BASE_LIGHT]
  if (preset === DEFAULT_PRESET_ID) return base
  const scoped =
    ramp === "dark"
      ? [block(`:root[data-theme="${preset}"].dark`), block(`:root[data-theme="${preset}"]`)]
      : [block(`:root[data-theme="${preset}"]`)]
  return [...scoped, ...base]
}
/** L, C, h, alpha. The fourth slot is the whole reason this file can measure
 *  `--border` at all: the old parser had no alternative for `/ <alpha>` and
 *  threw on it, so the weakest token in the palette was the one it skipped. */
type Oklch = [number, number, number, number]

function token(name: string, ramp: Ramp): Oklch {
  const literal = new RegExp(
    `--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*(?:/\\s*([\\d.]+)(%?))?\\)`
  )
  const alias = new RegExp(`--${name}:\\s*var\\(--([\\w-]+)\\)`)
  for (const source of chain(ramp)) {
    const own = source.match(literal)
    if (own !== null) {
      /*
       * `.at()`, NOT `own[4]`. TypeScript types every group of a
       * `RegExpMatchArray` as `string`, while an UNMATCHED optional group is
       * `undefined` at runtime — so `own[4] === undefined` is a comparison the
       * compiler believes can never be true, and `no-unnecessary-condition`
       * rejects it. A widening annotation does not help: a `const` narrows to
       * its initialiser regardless. `.at()` is typed `string | undefined`, which
       * is the truth.
       *
       * Deleting the check to satisfy the rule instead would make
       * `Number(undefined)` produce `NaN` for every opaque token in the file,
       * and every ratio with it.
       */
      const raw = own.at(4)
      const unit = own.at(5)
      const alpha = raw === undefined ? 1 : Number(raw) / (unit === "%" ? 100 : 1)
      return [Number(own[1]), Number(own[2]), Number(own[3]), alpha]
    }
    const via = source.match(alias)
    if (via !== null) return token(via[1], ramp)
  }
  throw new Error(
    `--${name} resolves to no oklch value in ${ramp.preset}/${ramp.ramp}`
  )
}

function oklchToLinearSrgb([L, C, hDeg]: Oklch): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
type Rgb = [number, number, number]

/** Linear-light -> gamma-encoded sRGB: the values a browser actually paints. */
function encode(linear: [number, number, number]): Rgb {
  return linear.map((v) => {
    const x = clamp01(v)
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
  }) as Rgb
}

function luminance(gamma: Rgb): number {
  const [r, g, b] = gamma.map((v) => {
    const c = Math.round(v * 255) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const paint = (name: string, ramp: Ramp): Rgb => encode(oklchToLinearSrgb(token(name, ramp)))

/**
 * Source-over, in gamma-encoded sRGB. `alpha` defaults to the token's OWN
 * alpha, so `over("border", "background", "dark")` composites the 10% white
 * `--border` without the caller having to know it is translucent — and a call
 * site that layers further transparency on top passes its own factor.
 */
function over(name: string, backdrop: string, ramp: Ramp, extraAlpha = 1): Rgb {
  const alpha = token(name, ramp)[3] * extraAlpha
  const fg = paint(name, ramp)
  const bg = paint(backdrop, ramp)
  return fg.map((v, i) => clamp01(v) * alpha + clamp01(bg[i]) * (1 - alpha)) as Rgb
}

const ratio = (a: string, b: string, ramp: Ramp) => contrast(paint(a, ramp), paint(b, ramp))
const overRatio = (a: string, b: string, ramp: Ramp, extra = 1) =>
  contrast(over(a, b, ramp, extra), paint(b, ramp))
const round = (n: number) => Math.round(n * 100) / 100

/**
 * EVERY PRESET IN BOTH RAMPS. This is what makes a closed preset set worth
 * having: a theme the user AUTHORS cannot be asserted about, and a theme the
 * product SHIPS can be. Adding a preset adds two scopes here automatically, so
 * a new palette cannot land under the floor without this file going red.
 */
const RAMPS: ReadonlyArray<Ramp> = THEME_PRESET_IDS.flatMap((preset) => [
  { preset, ramp: "light" as const },
  { preset, ramp: "dark" as const },
])
const label = ({ preset, ramp }: Ramp) => `${preset}/${ramp}`

/** `[name, scope]` pairs. `it.each` formats its argument into the title, and an
 *  object dumps as `{ preset: ... }`; naming the scope makes a failure say
 *  "indigo/dark" in one glance. */
const SCOPES: ReadonlyArray<readonly [string, Ramp]> = RAMPS.map((r) => [label(r), r] as const)

/**
 * Every surface a control or a piece of text can land on — split by POLARITY
 * CONTRACT, because the two halves make different promises.
 *
 * The CONTENT surfaces all share the ramp's polarity, so the ramp's inks and
 * control boundaries (`--muted-foreground`, `--input`, `--ring`) must clear
 * their floors on every one of them.
 *
 * The RAIL is a closed world: every piece of text, every border and every
 * focus ring on it draws from the parallel `--sidebar-*` family
 * (ui/sidebar.tsx), and the account popup that opens FROM it is `--popover`
 * — which is why app-sidebar.tsx's `text-muted-foreground` icons are legal:
 * they sit inside that popup, not on the rail. The solid-sidebar presets
 * (Ink, Midnight, …) lean on exactly this: their rail is DARK inside a light
 * ramp, so sweeping the content inks over it would fail on tokens that never
 * meet. The rail's own floors are asserted separately below, including the
 * 70% dim step the rail actually dims with.
 */
const MAIN_SURFACES = [
  "background",
  "card",
  "popover",
  "muted",
  "secondary",
  "accent",
] as const
const SIDEBAR_SURFACES = ["sidebar", "sidebar-accent"] as const

describe("the measurement pipeline itself", () => {
  it("pins the compositing space, so a linear-light rewrite fails here first", () => {
    // Gamma: 1.26. Linear light: 2.87. Two decimals on purpose.
    expect(
      round(overRatio("border", "background", { preset: "neutral", ramp: "dark" }))
    ).toBeCloseTo(1.26, 2)
  })

  it("parses an alpha token rather than throwing on it", () => {
    const dark = { preset: "neutral" as const, ramp: "dark" as const }
    expect(token("border", dark)[3]).toBeCloseTo(0.1, 3)
    expect(token("input", dark)[3]).toBeCloseTo(0.35, 3)
    // An opaque token still reports alpha 1, so `over()` is safe on anything.
    expect(token("background", { preset: "neutral", ramp: "light" })[3]).toBe(1)
  })

  it("reads the palette ramp, not the project-colour block below it", () => {
    // styles.css holds four `:root`-ish blocks; brace-matching on the exact
    // selector is what keeps the `--project-*` data out of the palette.
    expect(BASE_LIGHT).toContain("--background")
    expect(BASE_LIGHT).not.toContain("--project-teal")
    expect(BASE_DARK).not.toContain("--project-teal")
  })

  it("resolves a preset through its own block, not the base one", () => {
    // The proof that `chain()` is wired up: indigo's primary is a hue, the
    // base one is a neutral. If the preset blocks were being missed, every
    // preset scope below would silently measure the base palette and pass.
    const indigo = token("primary", { preset: "indigo", ramp: "light" })
    const neutral = token("primary", { preset: "neutral", ramp: "light" })
    expect(indigo[1]).toBeGreaterThan(0.1)
    expect(neutral[1]).toBe(0)
  })
})

describe("text, at SC 1.4.3's 4.5:1", () => {
  it.each(SCOPES)("puts %s foreground over its own surfaces", (_name, ramp) => {
    for (const [ink, surface] of [
      ["foreground", "background"],
      ["card-foreground", "card"],
      ["popover-foreground", "popover"],
      ["primary-foreground", "primary"],
      ["secondary-foreground", "secondary"],
      ["accent-foreground", "accent"],
      ["sidebar-foreground", "sidebar"],
      ["sidebar-accent-foreground", "sidebar-accent"],
      ["sidebar-primary-foreground", "sidebar-primary"],
    ] as const) {
      expect(
        round(ratio(ink, surface, ramp)),
        `--${ink} on --${surface} (${ramp})`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  /**
   * `--muted-foreground` is the dimmest text the system permits, and it is not
   * only used on `--background`: `ui/avatar.tsx` pairs it with `bg-muted`, and
   * the muted band is the tightest of its surfaces. shadcn ships 0.556, which
   * measures 4.35:1 there — the failure this token was repaired for.
   */
  it.each(SCOPES)("holds the dimmest text on every surface it lands on (%s)", (_name, ramp) => {
    for (const surface of MAIN_SURFACES) {
      expect(
        round(ratio("muted-foreground", surface, ramp)),
        `--muted-foreground on --${surface} (${ramp})`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  /**
   * The rail's OWN dim step. app-sidebar.tsx dims its group labels with
   * `text-sidebar-foreground/70` rather than `--muted-foreground`, which is
   * what lets a solid-sidebar preset flip the rail's polarity — but a dim step
   * is only legal if the dimmed result still clears the text floor, so it is
   * measured composited at that exact opacity.
   */
  it.each(SCOPES)("keeps the rail's 70% dim text above the floor (%s)", (_name, ramp) => {
    for (const surface of SIDEBAR_SURFACES) {
      expect(
        round(overRatio("sidebar-foreground", surface, ramp, 0.7)),
        `--sidebar-foreground/70 on --${surface} (${ramp})`
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(SCOPES)("keeps destructive text readable on the page (%s)", (_name, ramp) => {
    expect(round(ratio("destructive", "background", ramp))).toBeGreaterThanOrEqual(4.5)
    expect(round(ratio("destructive", "card", ramp))).toBeGreaterThanOrEqual(4.5)
  })
})

describe("control boundaries, at SC 1.4.11's 3:1", () => {
  /**
   * THE BOUNDARY SPLIT, asserted. `--input` is the edge of something you can
   * type into, press or toggle — `ui/input.tsx`, `ui/select.tsx`, the outline
   * button, every filter chip, the timer bar's own section — so it has to clear
   * 3:1 wherever a control lands. `--border` is a divider and deliberately does
   * NOT, which is the other half of the same decision.
   */
  it.each(SCOPES)("clears --input against every surface a control sits on (%s)", (_name, ramp) => {
    for (const surface of MAIN_SURFACES) {
      expect(
        round(overRatio("input", surface, ramp)),
        `--input on --${surface} (${ramp})`
      ).toBeGreaterThanOrEqual(3)
    }
  })

  /**
   * The FOCUS INDICATOR, and the distinction that matters: the border SHIFT to
   * full `--ring` is what satisfies SC 2.4.11, and the 30% halo beside it is
   * decoration. A single figure attached to the halo is how a focus style ships
   * with the border shift dropped and the number still "checking out" — which
   * this codebase has done once already (see timer-bar.tsx).
   */
  it.each(SCOPES)("clears the focus ring at full strength (%s)", (_name, ramp) => {
    for (const surface of MAIN_SURFACES) {
      expect(
        round(ratio("ring", surface, ramp)),
        `--ring on --${surface} (${ramp})`
      ).toBeGreaterThanOrEqual(3)
    }
  })

  /**
   * The rail's own focus indicator. `ui/sidebar.tsx` focuses everything on the
   * rail with `ring-sidebar-ring`, never `--ring` — the parallel family again —
   * so the 3:1 indicator floor is held by this token on the rail's surfaces.
   * Composited, because nothing stops a preset shipping it translucent.
   */
  it.each(SCOPES)("clears the rail's focus ring on the rail's surfaces (%s)", (_name, ramp) => {
    for (const surface of SIDEBAR_SURFACES) {
      expect(
        round(overRatio("sidebar-ring", surface, ramp)),
        `--sidebar-ring on --${surface} (${ramp})`
      ).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(SCOPES)("keeps the 30% halo well under indicator strength (%s)", (_name, ramp) => {
    // Not a floor — a CEILING. If this ever climbs past 2:1 someone will start
    // treating the halo as the indicator, which is exactly the mistake above.
    expect(round(overRatio("ring", "background", ramp, 0.3))).toBeLessThan(2)
  })

  /**
   * The Hatch Rule's dashed edge. DESIGN.md names it the load-bearing carrier
   * for absence — the thing that survives colour blindness and forced-colors
   * once the UA drops the gradient — so it is a control boundary, not a
   * divider, and `src/lib/hatch.ts` draws it in `--input` for that reason. At
   * shadcn's stock `--border` it measured 1.26:1 in the dark ramp.
   */
  it.each(SCOPES)("keeps the hatch's dashed carrier visible (%s)", (_name, ramp) => {
    for (const surface of ["background", "card"] as const) {
      expect(round(overRatio("input", surface, ramp))).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(SCOPES)("keeps the hatch's 55% stripe above a legibility floor (%s)", (_name, ramp) => {
    // Not a WCAG floor: the dashed border above is the compliant carrier and
    // the stripe is texture. But a texture nobody can see is a blank box, so it
    // takes the same kind of floor the loading skeleton used to hold.
    expect(round(overRatio("input", "background", ramp, 0.55))).toBeGreaterThanOrEqual(1.5)
  })
})

describe("the divider, which is deliberately NOT a control boundary", () => {
  /**
   * This is an assertion that a token STAYS QUIET, and it is here so the split
   * cannot be collapsed by someone "fixing" the border's contrast. 108 call
   * sites carry `--border`; raising it to the control floor turns the log from
   * one table into a grid. If a boundary needs 3:1, it needs `--input`.
   */
  it.each(SCOPES)("keeps --border below the control floor (%s)", (_name, ramp) => {
    expect(round(overRatio("border", "background", ramp))).toBeLessThan(3)
  })

  it("keeps the two tokens genuinely distinct", () => {
    for (const ramp of RAMPS) {
      expect(
        round(overRatio("input", "background", ramp)),
        `the split collapsed in ${label(ramp)}`
      ).toBeGreaterThan(round(overRatio("border", "background", ramp)) + 1)
    }
  })
})

describe("charts", () => {
  /**
   * A chart series is a "graphical object required to understand content" under
   * SC 1.4.11, so 3:1 against its frame — which is `bg-card` (chart-frame.tsx).
   *
   * SHADCN'S CHART PALETTE DOES NOT MEET THAT, AND THESE TWO TESTS RECORD IT
   * RATHER THAN ASSERT IT. Measured against the frame:
   *
   *   light  chart-1 3.60  chart-2 3.67  chart-3 9.15  chart-4 1.72  chart-5 2.13
   *   dark   chart-1 2.62  chart-2 7.25  chart-3 8.40  chart-4 4.35  chart-5 4.77
   *
   * Light `--chart-4` at 1.72:1 is a pale amber on white — a series you cannot
   * see. `--chart-5` is barely better at 2.13:1, and the two are 14.35 degrees
   * apart in hue, so they are also the same colour as each other.
   *
   * WHY THIS IS RECORDED AND NOT REPAIRED HERE: fixing it is a palette
   * decision, not a defect repair. Dark `--chart-1` shares its value with
   * `--sidebar-primary`, so moving one moves the other. And only `--chart-1` is
   * spent today (the earnings line in reports/earnings-chart.tsx); the rest are
   * unused, so a wrong fix now would be guessing at a design that has not been
   * asked for. Both tests are RATCHETS: they may be tightened, never loosened.
   */
  it("records the chart palette's known gaps, and forbids them widening", () => {
    const worst = Math.min(
      ...RAMPS.flatMap((ramp) =>
        ([1, 2, 3, 4, 5] as const).flatMap((n) =>
          (["card", "background"] as const).map((s) => round(ratio(`chart-${n}`, s, ramp)))
        )
      )
    )
    expect(worst, "the chart palette got worse").toBeGreaterThanOrEqual(1.7)
  })

  it("records the tightest hue gap between series, and forbids it narrowing", () => {
    for (const ramp of RAMPS) {
      const hues = ([1, 2, 3, 4, 5] as const).map((n) => token(`chart-${n}`, ramp)[2])
      let tightest = 360
      for (let i = 0; i < hues.length; i++) {
        for (let j = i + 1; j < hues.length; j++) {
          const raw = Math.abs(hues[i] - hues[j])
          tightest = Math.min(tightest, raw, 360 - raw)
        }
      }
      // Light: 14.35 (chart-4 vs chart-5). Dark: 39.52 (chart-1 vs chart-4).
      expect(round(tightest), `${ramp} series collapsed toward one hue`).toBeGreaterThanOrEqual(14)
    }
  })
})
