/**
 * Which ramp is on screen, and how that survives a reload.
 *
 * Pure and DOM-light on purpose: everything here is either a constant or a
 * function over one argument, so the whole policy — what the choices are, what
 * "system" resolves to, what gets written to the document — is testable without
 * rendering anything. `theme-provider.tsx` is the thin React layer over it.
 */

import {
  DEFAULT_PRESET_ID,
  DEFAULT_RADIUS_ID,
  THEME_PRESET_IDS,
  THEME_RADIUS_IDS,
  isThemePresetId,
  isThemeRadiusId,
} from "@/lib/theme-preset-ids"
import type { ThemePresetId, ThemeRadiusId } from "@/lib/theme-preset-ids"

/** The three the toggle offers. `system` is a CHOICE, not the absence of one. */
const THEMES = ["light", "dark", "system"] as const
export type Theme = (typeof THEMES)[number]

/** What a `system` choice resolves to at any moment. Only these two ever reach
 *  the document, because `.dark` is a class and there is no `.system`. */
export type ResolvedTheme = "light" | "dark"

/**
 * `localStorage`, not a cookie and not the account.
 *
 * Not the account, because a theme is a property of the SCREEN you are looking
 * at rather than of the person: the same user wants dark on the laptop at night
 * and light on the desktop by a window, and syncing it would make each device
 * fight the other. Every other preference in this product is stored server-side
 * for exactly the opposite reason — a week start is a property of the person.
 */
const THEME_STORAGE_KEY = "chroneli:theme"

/**
 * The PRESET, stored beside the polarity and orthogonal to it.
 *
 * Two keys rather than one object, because they are two independent choices: a
 * preset ships both ramps and never states a polarity, and light/dark/system
 * never states a palette. Packing them into one JSON blob would make a
 * corrupted value lose both, and would make the pre-paint script parse instead
 * of compare.
 *
 * Device-local for the same reason the polarity is — see the note above — with
 * one addition that is mechanical rather than aesthetic: Convex cannot be read
 * before first paint, so an account-stored preset would reintroduce exactly the
 * flash `THEME_INIT_SCRIPT` exists to prevent, on every single load.
 */
const PRESET_STORAGE_KEY = "chroneli:theme-preset"

/** The corner radius, a THIRD independent axis. Its own key for the same reason
 *  the preset has one: three orthogonal choices, three values, none of which can
 *  corrupt the others. */
const RADIUS_STORAGE_KEY = "chroneli:theme-radius"

function isTheme(value: unknown): value is Theme {
  return (THEMES as ReadonlyArray<unknown>).includes(value)
}

/**
 * The stored choice, or `system` when there is nothing usable there.
 *
 * Wrapped, because `localStorage` does not merely return null in a browser
 * configured to block site data — the getter itself throws, and an exception
 * here would take the whole provider down on mount.
 */
export function readStoredTheme(): Theme {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isTheme(raw) ? raw : "system"
  } catch {
    return "system"
  }
}

/** The stored preset, or the default when there is nothing usable there.
 *  Wrapped for the same reason `readStoredTheme` is: in a browser configured
 *  to block site data the GETTER ITSELF throws. */
export function readStoredPreset(): ThemePresetId {
  try {
    const raw = window.localStorage.getItem(PRESET_STORAGE_KEY)
    return isThemePresetId(raw) ? raw : DEFAULT_PRESET_ID
  } catch {
    return DEFAULT_PRESET_ID
  }
}

export function writeStoredPreset(preset: ThemePresetId): void {
  try {
    window.localStorage.setItem(PRESET_STORAGE_KEY, preset)
  } catch {
    // Applies for this page; it just will not outlive it.
  }
}

export function readStoredRadius(): ThemeRadiusId {
  try {
    const raw = window.localStorage.getItem(RADIUS_STORAGE_KEY)
    return isThemeRadiusId(raw) ? raw : DEFAULT_RADIUS_ID
  } catch {
    return DEFAULT_RADIUS_ID
  }
}

export function writeStoredRadius(radius: ThemeRadiusId): void {
  try {
    window.localStorage.setItem(RADIUS_STORAGE_KEY, radius)
  } catch {
    // Applies for this page; it just will not outlive it.
  }
}

export function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // The choice still applies for this page; it just will not outlive it.
  }
}

/** What the OS is asking for right now. */
function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? systemTheme() : theme
}

/**
 * Writes the resolved theme onto `<html>`.
 *
 * The CLASS is what the palette keys off (`.dark` in styles.css, and the
 * `@custom-variant dark` every shadcn `dark:` utility compiles against).
 * `color-scheme` rides along because it is what makes the engine paint native
 * form controls, scrollbars and the canvas for the right ramp — without it a
 * light page keeps a dark scrollbar, which is the tell that a theme was applied
 * to the CSS and not to the document.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved
}

/**
 * Writes the preset onto `<html>` as one attribute.
 *
 * NEVER `documentElement.style.setProperty`, and this is the single most
 * important invariant in the feature. An inline declaration outranks BOTH
 * `:root` and `.dark`, so a token written that way stops responding to the
 * light/dark toggle forever — the app renders half-themed and nothing throws.
 * The preset blocks live in styles.css and the cascade picks the ramp; see the
 * long note above them there.
 *
 * The default REMOVES the attribute rather than setting it, because `neutral`
 * is the base `:root` / `.dark` and has no block of its own.
 */
export function applyPreset(preset: ThemePresetId): void {
  const root = document.documentElement
  if (preset === DEFAULT_PRESET_ID) delete root.dataset.theme
  else root.dataset.theme = preset
}

/** The radius, as one more attribute. Same rule as `applyPreset`: a stylesheet
 *  and the cascade, never an inline custom property. */
export function applyRadius(radius: ThemeRadiusId): void {
  const root = document.documentElement
  if (radius === DEFAULT_RADIUS_ID) delete root.dataset.radius
  else root.dataset.radius = radius
}

/**
 * The script that runs BEFORE first paint, inlined into <head>.
 *
 * Without it the server renders one ramp, the client corrects it on mount, and
 * every load of a dark-mode account flashes a full white page — the one bug
 * every theme implementation ships first. It is a string rather than a module
 * because it has to execute synchronously ahead of the bundle.
 *
 * Kept deliberately tiny and total: any throw inside it would block the parser
 * before React ever loads, so the whole body is wrapped and failure simply
 * leaves the server's default in place.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var t=(s==="light"||s==="dark")?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");var e=document.documentElement;e.classList.toggle("dark",t==="dark");e.style.colorScheme=t;var p=localStorage.getItem(${JSON.stringify(
  PRESET_STORAGE_KEY
)});if(${JSON.stringify(
  THEME_PRESET_IDS.filter((id) => id !== DEFAULT_PRESET_ID)
)}.indexOf(p)>-1){e.setAttribute("data-theme",p);}var r=localStorage.getItem(${JSON.stringify(
  RADIUS_STORAGE_KEY
)});if(${JSON.stringify(
  THEME_RADIUS_IDS.filter((id) => id !== DEFAULT_RADIUS_ID)
)}.indexOf(r)>-1){e.setAttribute("data-radius",r);}}catch(_){}})();`

/*
 * A NOTE ON WHAT THE SCRIPT ABOVE ALLOWS, because the list is not the obvious
 * one: it is every preset EXCEPT the default. `neutral` has no CSS block, so
 * writing `data-theme="neutral"` would set an attribute that selects nothing —
 * harmless, but it would make the DOM claim a preset is active when what is
 * actually painting is the base ramp. An unknown, absent or throwing value
 * lands in the same place: no attribute, base ramp, which is the correct
 * fallback rather than a failure mode.
 *
 * The ids come from `theme-preset-ids.ts` rather than from `theme-presets.ts`,
 * so the ~250 colour literals never enter the chunk this file lives in.
 */
