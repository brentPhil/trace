import { afterEach, describe, expect, it, vi } from "vitest"

import {
  THEME_INIT_SCRIPT,
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

/**
 * `.test.tsx`, NOT `.test.ts`, and the extension is load-bearing.
 *
 * `vitest.config.ts` defines the `unit` project as `environment: "node"`
 * including `src/**\/*.test.ts`, and the jsdom project includes only
 * `src/**\/*.test.tsx`. In Node there is no `window`, so every function here
 * would take its own `catch` branch and return the fallback — a storage test
 * that passes while proving nothing, and a round-trip test that fails for a
 * reason unrelated to what it is checking.
 */

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.className = ""
  document.documentElement.removeAttribute("style")
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.radius
  vi.restoreAllMocks()
})

describe("the stored theme", () => {
  it("round-trips each of the three choices", () => {
    for (const theme of ["light", "dark", "system"] as const) {
      writeStoredTheme(theme)
      expect(readStoredTheme()).toBe(theme)
    }
  })

  it("falls back to system for anything unusable", () => {
    expect(readStoredTheme()).toBe("system")
    window.localStorage.setItem("chroneli:theme", "aubergine")
    expect(readStoredTheme()).toBe("system")
  })

  it("survives a browser that throws on the getter itself", () => {
    // Not hypothetical: with site data blocked, `getItem` THROWS rather than
    // returning null, and an exception here would take the whole provider down
    // on mount.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(readStoredTheme()).toBe("system")
    expect(readStoredPreset()).toBe("neutral")
  })

  it("does not throw when the setter is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(() => {
      writeStoredTheme("dark")
    }).not.toThrow()
    expect(() => {
      writeStoredPreset("indigo")
    }).not.toThrow()
  })
})

describe("the stored preset", () => {
  it("round-trips a known id", () => {
    writeStoredPreset("indigo")
    expect(readStoredPreset()).toBe("indigo")
  })

  it("falls back to the default for an unknown id", () => {
    // Reachable: a stored id survives a preset being removed from the product.
    window.localStorage.setItem("chroneli:theme-preset", "aubergine")
    expect(readStoredPreset()).toBe("neutral")
  })
})

describe("applyPreset", () => {
  it("writes the attribute for a scoped preset", () => {
    applyPreset("indigo")
    expect(document.documentElement.dataset.theme).toBe("indigo")
  })

  it("REMOVES the attribute for the default rather than naming it", () => {
    /*
     * `neutral` has no CSS block — it is the base `:root` / `.dark`. Writing
     * `data-theme="neutral"` would select nothing and leave the DOM claiming a
     * preset is active when the base ramp is what paints.
     */
    applyPreset("indigo")
    applyPreset("neutral")
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false)
  })

  it("never writes an inline custom property", () => {
    /*
     * THE SINGLE MOST IMPORTANT INVARIANT IN THE FEATURE, asserted rather than
     * only commented. An inline declaration on `<html>` outranks BOTH `:root`
     * and `.dark`, so a token applied that way stops responding to the
     * light/dark toggle — permanently, silently, and only for the tokens the
     * theme happened to set. It is also the obvious implementation, and the one
     * the reference this design came from uses.
     */
    applyPreset("indigo")
    expect(document.documentElement.getAttribute("style")).toBeNull()
  })
})

describe("the stored radius", () => {
  it("round-trips a known step and rejects anything else", () => {
    writeStoredRadius("large")
    expect(readStoredRadius()).toBe("large")
    window.localStorage.setItem("chroneli:theme-radius", "3rem")
    expect(readStoredRadius()).toBe("default")
  })
})

describe("applyRadius", () => {
  it("writes the attribute for a step and removes it for the default", () => {
    applyRadius("none")
    expect(document.documentElement.dataset.radius).toBe("none")
    applyRadius("default")
    expect(document.documentElement.hasAttribute("data-radius")).toBe(false)
  })

  it("never writes an inline custom property", () => {
    // Same invariant as `applyPreset`: an inline declaration outranks every
    // block in styles.css, including the ones a preset relies on.
    applyRadius("large")
    expect(document.documentElement.getAttribute("style")).toBeNull()
  })
})

describe("applyTheme", () => {
  it("puts the class and the colour-scheme on the document together", () => {
    applyTheme("dark")
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe("dark")

    applyTheme("light")
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe("light")
  })

  it("leaves the other two axes alone", () => {
    // All three are orthogonal: flipping polarity must not clear a palette or
    // a radius, and each is a separate attribute for exactly that reason.
    applyPreset("indigo")
    applyRadius("large")
    applyTheme("light")
    applyTheme("dark")
    expect(document.documentElement.dataset.theme).toBe("indigo")
    expect(document.documentElement.dataset.radius).toBe("large")
  })
})

describe("resolveTheme", () => {
  it("passes an explicit choice through and asks the OS only for system", () => {
    expect(resolveTheme("light")).toBe("light")
    expect(resolveTheme("dark")).toBe("dark")
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList)
    expect(resolveTheme("system")).toBe("dark")
  })
})

describe("THEME_INIT_SCRIPT", () => {
  /**
   * Evaluated for real, against this document. The script is a STRING that runs
   * before the bundle, so nothing else type-checks it and nothing else executes
   * it — which makes it the one piece of this feature where a typo ships as a
   * silent no-op and the app just flashes.
   */
  const run = () => {
    new Function(THEME_INIT_SCRIPT)()
  }

  it("applies a stored light theme before anything React does", () => {
    window.localStorage.setItem("chroneli:theme", "light")
    run()
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe("light")
  })

  it("applies a stored preset as an attribute", () => {
    window.localStorage.setItem("chroneli:theme-preset", "indigo")
    run()
    expect(document.documentElement.dataset.theme).toBe("indigo")
  })

  it("writes no attribute for the default preset", () => {
    window.localStorage.setItem("chroneli:theme-preset", "neutral")
    run()
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false)
  })

  it("applies a stored radius as an attribute", () => {
    window.localStorage.setItem("chroneli:theme-radius", "none")
    run()
    expect(document.documentElement.dataset.radius).toBe("none")
  })

  it("writes no attribute for the default radius, or a tampered one", () => {
    window.localStorage.setItem("chroneli:theme-radius", "default")
    run()
    expect(document.documentElement.hasAttribute("data-radius")).toBe(false)
    window.localStorage.setItem("chroneli:theme-radius", "9rem")
    run()
    expect(document.documentElement.hasAttribute("data-radius")).toBe(false)
  })

  it("ignores a tampered preset id", () => {
    window.localStorage.setItem("chroneli:theme-preset", "'; drop--")
    run()
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false)
  })

  it("falls back to the OS when nothing is stored", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
    } as MediaQueryList)
    run()
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("is total: a throwing localStorage leaves the server's markup in place", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    document.documentElement.className = "dark"
    expect(run).not.toThrow()
    // Untouched, which is the correct outcome — the server rendered `dark`.
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("embeds its storage keys as JSON, so a key can never break the script", () => {
    expect(THEME_INIT_SCRIPT).toContain('"chroneli:theme"')
    expect(THEME_INIT_SCRIPT).toContain('"chroneli:theme-preset"')
    expect(THEME_INIT_SCRIPT).toContain('"chroneli:theme-radius"')
  })
})
