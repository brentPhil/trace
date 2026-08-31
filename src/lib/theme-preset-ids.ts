/**
 * The preset ids, and NOTHING ELSE — which is the entire reason this file
 * exists separately from `theme-presets.ts`.
 *
 * `src/lib/theme.ts` builds `THEME_INIT_SCRIPT`, which needs to know which ids
 * are valid so it can reject a tampered `localStorage` value before first
 * paint. `theme.ts` is imported by `src/routes/__root.tsx`, so anything it
 * pulls in lands in the chunk every route loads. Importing the RAMPS there
 * would put ~250 colour literals in front of every page for the sake of a
 * two-element allowlist.
 *
 * So the ids live here, the values live next door, and only `/settings` and the
 * tests ever load the values.
 */
export const THEME_PRESET_IDS = [
  "neutral",
  "blue",
  "indigo",
  "violet",
  "fuchsia",
  "rose",
  "amber",
  "lime",
  "emerald",
  "teal",
  "ink",
  "midnight",
  "plum",
  "espresso",
  "forest",
] as const

export type ThemePresetId = (typeof THEME_PRESET_IDS)[number]

/**
 * The presets whose sidebar family is a dark solid in both ramps. Only the
 * PICKER reads this — it labels them as their own group in the dropdown so the
 * inversion reads as a family rather than as five oddly-dark swatches. Nothing
 * mechanical branches on it: the CSS blocks carry the whole difference.
 */
export const SOLID_SIDEBAR_PRESET_IDS: ReadonlyArray<ThemePresetId> = [
  "ink",
  "midnight",
  "plum",
  "espresso",
  "forest",
]

/**
 * THE RADIUS STEPS. Four, not a slider: nothing to debounce, nothing that can
 * produce a value nobody chose, and a closed set the drift test can check.
 *
 * `default` has no CSS block for the same reason `neutral` does not — it is the
 * `--radius` already declared in the base `:root`.
 */
export const THEME_RADIUS_IDS = [
  "default",
  "none",
  "sharp",
  "small",
  "large",
] as const

export type ThemeRadiusId = (typeof THEME_RADIUS_IDS)[number]

export const DEFAULT_RADIUS_ID: ThemeRadiusId = "default"

export function isThemeRadiusId(value: unknown): value is ThemeRadiusId {
  return (THEME_RADIUS_IDS as ReadonlyArray<unknown>).includes(value)
}

/** Label and the value each step sets, for the picker and the drift test. */
export const THEME_RADII: ReadonlyArray<{
  id: ThemeRadiusId
  label: string
  value: string
}> = [
  { id: "none", label: "Square", value: "0rem" },
  // 2px at the base step — a hint of rounding rather than a shape. Small (6px)
  // was the smallest non-zero step, and the jump from there to Square skipped
  // the crisp near-square a dense UI wants. It is also the first step at which
  // pill-clamped controls visibly let go: radius clamps at half an element's
  // height, so on a 32px button nothing above 16px looks different.
  { id: "sharp", label: "Sharp", value: "0.125rem" },
  { id: "small", label: "Small", value: "0.375rem" },
  { id: "default", label: "Default", value: "0.625rem" },
  { id: "large", label: "Round", value: "1rem" },
]

/**
 * `neutral` is the default AND the absence of a preset: it has no CSS block of
 * its own, so an unset attribute falls through to the base `:root` / `.dark` in
 * styles.css. That is deliberate — a fresh install writes no attribute at all,
 * and a `:root[data-theme="neutral"]` block would never apply to exactly the
 * people who have never opened the picker.
 */
export const DEFAULT_PRESET_ID: ThemePresetId = "neutral"

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return (THEME_PRESET_IDS as ReadonlyArray<unknown>).includes(value)
}
