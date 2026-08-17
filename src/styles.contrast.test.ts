import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/*
 * The colour tokens, measured rather than asserted in a commit message.
 *
 * A previous fix in this area shipped because a number in a commit message was
 * trusted over a measurement, and DESIGN.md has carried at least two figures
 * that described a different thing from the one they were attached to. So the
 * ratios live here, computed from `src/styles.css` itself: darken a token and
 * the test that names the rule it breaks goes red.
 *
 * WCAG 2.2 AA, the two floors this file enforces:
 *   1.4.3 Contrast (Minimum) — 4.5:1 for body text.
 *   1.4.11 Non-text Contrast — 3:1 for the visual boundary of a control,
 *     against EACH adjacent colour. A 1px border between a fill and a page has
 *     two adjacent colours and they are frequently different tokens.
 */

const CSS = readFileSync(
  fileURLToPath(new URL("./styles.css", import.meta.url)),
  "utf8"
)

type Oklch = readonly [L: number, C: number, h: number]

/** Reads `--name: oklch(L C H);` straight out of the stylesheet. */
function token(name: string): Oklch {
  const match = CSS.match(
    new RegExp(`--${name}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\)`)
  )
  if (match === null) throw new Error(`--${name} is not an oklch literal in styles.css`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
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

/** Linear-light -> gamma-encoded sRGB, the values a browser paints. */
function encode(linear: [number, number, number]): [number, number, number] {
  return linear.map((v) => {
    const x = clamp01(v)
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
  }) as [number, number, number]
}

/**
 * WCAG relative luminance, defined on 8-bit sRGB channels. The round trip
 * through bytes is not pedantry: it is what makes these numbers agree with a
 * browser's own contrast readout to the second decimal.
 */
function luminance(srgb: [number, number, number]): number {
  const [r, g, b] = srgb
    .map((v) => Math.round(clamp01(v) * 255) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** A named token, as the browser paints it. */
function paint(name: string): [number, number, number] {
  return encode(oklchToLinearSrgb(token(name)))
}

/**
 * A token at `alpha` over a backdrop — `border-brass/60` and friends.
 *
 * Compositing happens in the GAMMA-ENCODED sRGB space, which is what the
 * compositor actually does, NOT in linear light. The difference is not
 * academic: `border-brass/60` over `--ground` measures 3.84:1 composited the
 * way a browser does it and 5.63:1 composited in linear light. Both clear the
 * 3:1 floor here, so nothing shipped wrong — but a review of this area quoted
 * the linear figures, and a token trimmed on the strength of a 5.63 that is
 * really a 3.84 would land under the floor with the maths still "checking out".
 */
function over(name: string, backdrop: string, alpha: number): [number, number, number] {
  const fg = paint(name)
  const bg = paint(backdrop)
  return fg.map((v, i) => clamp01(v) * alpha + clamp01(bg[i]) * (1 - alpha)) as [
    number,
    number,
    number,
  ]
}

const ratio = (a: string, b: string) => contrast(paint(a), paint(b))
const round = (n: number) => Math.round(n * 100) / 100

describe("the measurement pipeline itself", () => {
  // Two figures the repo already documents. If these two move, the maths
  // below is wrong and every other number in this file is worthless.
  it("reproduces the two ratios DESIGN.md and styles.css already state", () => {
    expect(round(ratio("ring", "ground"))).toBeCloseTo(7.59, 1)
    expect(round(ratio("edge", "ground"))).toBeCloseTo(3.15, 1)
  })
})

describe("--edge, and why it is not enough on its own", () => {
  it("clears 3:1 against the ground, and ONLY against the ground", () => {
    expect(ratio("edge", "ground")).toBeGreaterThanOrEqual(3)
    // The finding this file was written for. Every claim about `--edge` in
    // DESIGN.md was a ground measurement, and plenty of bordered controls do
    // not sit on the ground.
    expect(ratio("edge", "surface")).toBeLessThan(3)
    expect(ratio("edge", "surface-raised")).toBeLessThan(3)
  })

  it("--edge-raised clears 3:1 on all three layers", () => {
    // The sibling token for a fill-less control that sits on a panel, a band
    // or a popover: chips in /timer's filter strip, the month steppers in both
    // calendars. It has to work wherever it lands, which means all three.
    expect(ratio("edge-raised", "ground")).toBeGreaterThanOrEqual(3)
    expect(ratio("edge-raised", "surface")).toBeGreaterThanOrEqual(3)
    expect(ratio("edge-raised", "surface-raised")).toBeGreaterThanOrEqual(3)
  })
})

describe("the two alpha borders that already passed", () => {
  it("keeps the active billable chip and the running timer bar above 3:1", () => {
    expect(contrast(over("brass", "ground", 0.6), paint("ground"))).toBeGreaterThanOrEqual(3)
    expect(contrast(over("brass", "surface", 0.6), paint("surface"))).toBeGreaterThanOrEqual(3)
    expect(
      contrast(over("enlarger", "surface", 0.5), paint("surface"))
    ).toBeGreaterThanOrEqual(3)
  })
})

describe("the focus indicator, split into the two things it is", () => {
  it("carries its contrast in the border shift, not in the halo", () => {
    // DESIGN.md used to attach 7.6:1 to "a 3px ring at 30%", which is the
    // halo. The 7.6 is the BORDER. The halo is decoration and is nowhere near
    // a 3:1 indicator on its own — which is exactly why the border shift has
    // to stay.
    expect(ratio("ring", "ground")).toBeGreaterThanOrEqual(3)
    expect(contrast(over("ring", "ground", 0.3), paint("ground"))).toBeLessThan(2)
    // The timer bar's outline pattern, for a control whose border already
    // carries state. `outline-offset-2` puts ground on both sides of it, so
    // the figure is the ground one regardless of the bar's own fill — but the
    // surface figure is checked too, for anything that adopts the pattern
    // without the offset.
    expect(ratio("ring", "surface")).toBeGreaterThanOrEqual(3)
    /*
     * A CALENDAR BLOCK'S FOCUS RING, which is the same pattern with the offset
     * turned INWARD (`-outline-offset-2`).
     *
     * A block's border is already spent — `enlarger` while running,
     * `edge-raised` when complete, the hatch's dashed rule on a midnight
     * continuation — so focus cannot be a border shift there. And it cannot be
     * an OUTWARD outline either: a block is inset from its harness by 2px and an
     * overlapping block is packed against it, so the ring would be drawn across
     * the neighbour. Inset, both of its adjacent colours are the block's own
     * fill rather than ground, so this is the figure that has to hold — and it
     * is the layer the timer bar's `outline-offset-2` was specifically avoiding
     * having to measure against.
     */
    expect(ratio("ring", "surface-raised")).toBeGreaterThanOrEqual(3)
  })
})

describe("the loading skeleton", () => {
  it("is visible against the log's own ground", () => {
    // `bg-muted` is `--surface`, and `--surface` on `--ground` is 1.09:1 — a
    // skeleton nobody can see, halved again at the trough of `animate-pulse`.
    // There is no WCAG floor for a decorative placeholder, so this is a
    // legibility floor rather than a compliance one; 1.5 is roughly where a
    // bar stops reading as a rendering artifact.
    expect(ratio("skeleton", "ground")).toBeGreaterThanOrEqual(1.5)
    expect(ratio("surface", "ground")).toBeLessThan(1.2) // what it replaced
  })
})

describe("text", () => {
  it("keeps every text token above 4.5:1 on the surfaces it is used on", () => {
    expect(ratio("ink", "ground")).toBeGreaterThanOrEqual(4.5)
    expect(ratio("ink-muted", "ground")).toBeGreaterThanOrEqual(4.5)
    expect(ratio("ink-muted", "surface")).toBeGreaterThanOrEqual(4.5)
    expect(ratio("ink-muted", "surface-raised")).toBeGreaterThanOrEqual(4.5)
    expect(ratio("brass", "ground")).toBeGreaterThanOrEqual(4.5)
    expect(ratio("alarm", "ground")).toBeGreaterThanOrEqual(4.5)
  })
})
