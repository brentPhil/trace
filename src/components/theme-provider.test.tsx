import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"

import { ThemeProvider, useTheme } from "@/components/theme-provider"

/**
 * The React layer over `src/lib/theme.ts` — the one seam the pure-function
 * tests next door cannot reach. What lives ONLY here: the mount-effect
 * adoption of stored values, and the OS listener that follows
 * `prefers-color-scheme` while — and only while — the choice is `system`.
 */

type Listener = (event: { matches: boolean }) => void

/** A controllable `matchMedia`: `flip(true)` is the OS turning dark. */
function stubMatchMedia(initiallyDark: boolean) {
  let matches = initiallyDark
  const listeners = new Set<Listener>()
  vi.spyOn(window, "matchMedia").mockImplementation(
    () =>
      ({
        get matches() {
          return matches
        },
        addEventListener: (_: string, fn: Listener) => listeners.add(fn),
        removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
      }) as unknown as MediaQueryList
  )
  return {
    flip(next: boolean) {
      matches = next
      for (const fn of listeners) fn({ matches: next })
    },
    listenerCount: () => listeners.size,
  }
}

/** Exposes the context on a mutable ref, so tests read live values without
 *  re-querying the DOM. */
function mount() {
  const seen: { current: ReturnType<typeof useTheme> | null } = { current: null }
  function Probe() {
    seen.current = useTheme()
    return null
  }
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  )
  return seen as { current: ReturnType<typeof useTheme> }
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  document.documentElement.className = ""
  document.documentElement.removeAttribute("style")
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.radius
  vi.restoreAllMocks()
})

describe("ThemeProvider", () => {
  it("adopts every stored value in its mount effect, and reports hydrated", () => {
    window.localStorage.setItem("chroneli:theme", "light")
    window.localStorage.setItem("chroneli:theme-preset", "emerald")
    window.localStorage.setItem("chroneli:theme-radius", "large")
    stubMatchMedia(true)

    const ctx = mount()
    expect(ctx.current.hydrated).toBe(true)
    expect(ctx.current.theme).toBe("light")
    expect(ctx.current.resolved).toBe("light")
    expect(ctx.current.preset).toBe("emerald")
    expect(ctx.current.radius).toBe("large")
    // The class follows the ADOPTED choice, not the guessed default.
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("follows the OS while the choice is system", () => {
    const media = stubMatchMedia(false)
    const ctx = mount()
    expect(ctx.current.resolved).toBe("light")

    // Sunset: the OS flips to dark and the app comes along without a reload.
    act(() => {
      media.flip(true)
    })
    expect(ctx.current.resolved).toBe("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("stops following the OS the moment an explicit choice is made", () => {
    const media = stubMatchMedia(false)
    const ctx = mount()

    act(() => {
      ctx.current.setTheme("light")
    })
    // The listener is torn down rather than left attached and ignored — the
    // provider's own comment argues why, and this is the assertion behind it.
    expect(media.listenerCount()).toBe(0)

    act(() => {
      media.flip(true)
    })
    expect(ctx.current.resolved).toBe("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
  })

  it("keeps the three axes independent through the setters", () => {
    stubMatchMedia(false)
    const ctx = mount()

    act(() => {
      ctx.current.setPreset("rose")
      ctx.current.setRadius("none")
      ctx.current.setTheme("dark")
    })
    // Each setter wrote only its own attribute, storage key, and state.
    expect(document.documentElement.dataset.theme).toBe("rose")
    expect(document.documentElement.dataset.radius).toBe("none")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(window.localStorage.getItem("chroneli:theme-preset")).toBe("rose")
    expect(window.localStorage.getItem("chroneli:theme-radius")).toBe("none")
    expect(window.localStorage.getItem("chroneli:theme")).toBe("dark")
  })

  it("throws from useTheme outside a provider, rather than lying quietly", () => {
    // A silent default would mean a toggle that renders, responds to clicks
    // and changes nothing — the provider's own docblock names this.
    function Bare() {
      useTheme()
      return null
    }
    expect(() => render(<Bare />)).toThrow(/within a ThemeProvider/)
  })
})
