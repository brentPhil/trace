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
    expect(manifest.theme_color).toBe("#14110e")
    expect(manifest.background_color).toBe("#14110e")
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
