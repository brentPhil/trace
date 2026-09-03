import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const publicDir = join(__dirname, "../../public")
const manifest = JSON.parse(
  readFileSync(join(publicDir, "manifest.json"), "utf8")
) as {
  name: string
  short_name: string
  start_url: string
  display: string
  theme_color: string
  background_color: string
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>
}

describe("PWA manifest", () => {
  it("declares a standalone app with the product colors", () => {
    expect(manifest.short_name).toBe("Chroneli")
    expect(manifest.display).toBe("standalone")
    expect(manifest.start_url).toBe("/")
    // `--background` in the dark ramp, matching the dark `theme-color` meta in
    // routes/__root.tsx. It was #14110e — the Darkroom's `--ground`, a token
    // that no longer exists — so an installed PWA painted its splash a colour
    // found nowhere else in the product.
    //
    // The icons themselves are the mark on its white tile (see
    // scripts/make-icons.mjs), so this is the splash and title bar only.
    expect(manifest.theme_color).toBe("#0a0a0a")
    expect(manifest.background_color).toBe("#0a0a0a")
  })

  it("lists a 192, a 512 and a maskable icon", () => {
    const sizes = manifest.icons.map((icon) => icon.sizes)
    expect(sizes).toContain("192x192")
    expect(sizes).toContain("512x512")
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(
      true
    )
  })

  it("every declared icon file exists in public/", () => {
    for (const icon of manifest.icons) {
      expect(existsSync(join(publicDir, icon.src)), icon.src).toBe(true)
    }
  })
})
