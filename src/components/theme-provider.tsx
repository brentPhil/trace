import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import {
  applyPreset,
  applyRadius,
  applyTheme,
  readStoredPreset,
  readStoredRadius,
  readStoredTheme,
  resolveTheme,
  writeStoredPreset,
  writeStoredRadius,
  writeStoredTheme,
} from "@/lib/theme"
import { DEFAULT_PRESET_ID, DEFAULT_RADIUS_ID } from "@/lib/theme-preset-ids"
import type { ThemePresetId, ThemeRadiusId } from "@/lib/theme-preset-ids"
import type { ResolvedTheme, Theme } from "@/lib/theme"

type ThemeContextValue = {
  /** What the user CHOSE — including `system`, which is a choice. */
  theme: Theme
  /** What that currently resolves to, which is all the document ever sees. */
  resolved: ResolvedTheme
  setTheme: (theme: Theme) => void
  /** Which palette. ORTHOGONAL to `theme`: a preset ships both ramps and never
   *  states a polarity, so the two controls never contradict each other. */
  preset: ThemePresetId
  setPreset: (preset: ThemePresetId) => void
  /** Corner radius. A third independent axis: it states no colour and no
   *  polarity, so all three controls compose without contradicting. */
  radius: ThemeRadiusId
  setRadius: (radius: ThemeRadiusId) => void
  /**
   * False on the server and on React's first client render; true from the mount
   * effect below.
   *
   * NOT DECORATION. This provider deliberately starts at `system`/`dark` and
   * adopts the stored values one tick later (see the note on the component), so
   * for one render its idea of the choice is a guess. That has been invisible
   * because `ThemeChoice`'s only mount was inside a popover that opens on a
   * click, long after the effect. On /settings it renders server-side, where a
   * Light user would see "System" filled and hear "System — currently dark" for
   * a tick, on the one control whose entire job is to report the theme.
   *
   * A control that reads this renders NOTHING selected until it is true: one
   * tick of indeterminate instead of one tick of wrong.
   */
  hydrated: boolean
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Holds the theme choice and keeps `<html>` in step with it.
 *
 * STATE STARTS AT `system`, NOT AT THE STORED VALUE, and that is a hydration
 * decision rather than a lazy one. The server cannot read `localStorage`, so
 * any initial state derived from it differs between the server render and the
 * client's first render — React's definition of a hydration mismatch. The
 * stored value is adopted in an effect instead, one tick later, by which point
 * the inline `THEME_INIT_SCRIPT` has ALREADY put the right class on the
 * document. So the pixels are correct from the first paint and only this
 * component's idea of the choice lags, invisibly, for a tick.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system")
  const [resolved, setResolved] = useState<ResolvedTheme>("dark")
  const [preset, setPresetState] = useState<ThemePresetId>(DEFAULT_PRESET_ID)
  const [radius, setRadiusState] = useState<ThemeRadiusId>(DEFAULT_RADIUS_ID)
  const [hydrated, setHydrated] = useState(false)

  // Adopt what is actually stored, once mounted.
  useEffect(() => {
    const stored = readStoredTheme()
    setThemeState(stored)
    const next = resolveTheme(stored)
    setResolved(next)
    applyTheme(next)

    // The preset is NOT re-applied here. `THEME_INIT_SCRIPT` already wrote the
    // attribute before first paint, and writing it again would be a no-op at
    // best. This only adopts the value into React's idea of the world, which is
    // the same trick the polarity above uses.
    setPresetState(readStoredPreset())
    setRadiusState(readStoredRadius())
    setHydrated(true)
  }, [])

  /*
   * FOLLOW THE OS WHILE — AND ONLY WHILE — THE CHOICE IS `system`.
   *
   * A user on `system` who changes their OS to dark at sunset expects the app
   * to come with them without a reload. A user who has explicitly picked light
   * expects it to stay light no matter what the OS does, which is why the
   * listener is torn down for the other two choices rather than left attached
   * and ignored.
   */
  useEffect(() => {
    if (theme !== "system") return
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      const next: ResolvedTheme = query.matches ? "dark" : "light"
      setResolved(next)
      applyTheme(next)
    }
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    writeStoredTheme(next)
    const applied = resolveTheme(next)
    setResolved(applied)
    applyTheme(applied)
  }, [])

  const setPreset = useCallback((next: ThemePresetId) => {
    setPresetState(next)
    writeStoredPreset(next)
    applyPreset(next)
  }, [])

  const setRadius = useCallback((next: ThemeRadiusId) => {
    setRadiusState(next)
    writeStoredRadius(next)
    applyRadius(next)
  }, [])

  return (
    <ThemeContext.Provider
      value={{
        theme,
        resolved,
        setTheme,
        preset,
        setPreset,
        radius,
        setRadius,
        hydrated,
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

/**
 * Throws outside a provider rather than falling back to a default.
 *
 * A silent default here would mean the toggle renders, responds to clicks and
 * changes nothing — a control that lies. The same call `useSidebar` makes, for
 * the same reason.
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === null) {
    throw new Error("useTheme must be used within a ThemeProvider.")
  }
  return context
}
