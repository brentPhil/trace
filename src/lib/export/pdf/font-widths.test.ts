import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import fontkit from "@pdf-lib/fontkit"
import { PDFDocument } from "pdf-lib"
import { describe, expect, it } from "vitest"
import { textWidth } from "./ops"

/**
 * `ops.ts`'s `DM_SANS_WIDTHS` / `DM_SANS_BOLD_WIDTHS` tables are hand-copied
 * numbers, generated once by reading them back out of the same two TTFs
 * `render.ts` embeds (see that table's own comment). Nothing enforces they
 * stay in sync with those files — if the `@expo-google-fonts/dm-sans`
 * dependency is ever bumped and its metrics move, every wrap, truncation and
 * axis-tick collision `ops.ts` computes silently starts being measured
 * against a font that is no longer the one actually drawn.
 *
 * This test embeds the REAL font files (via pdf-lib + fontkit, exactly as
 * `render.ts` does) and asserts `textWidth` — the table-driven measurement
 * `report-doc.ts` uses instead of importing pdf-lib — agrees with pdf-lib's
 * own `widthOfTextAtSize` for every printable ASCII character, both weights.
 *
 * Lives in `src/lib/export/pdf` (the "unit" vitest project — see
 * vitest.config.ts) rather than a separate project: pdf-lib and fontkit are
 * both plain Node-compatible libraries with no DOM or browser requirement of
 * their own. The ONLY reason `render.ts` needs Vite's asset pipeline
 * (`?url` + `fetch`) is to ship the font bytes to a BROWSER at runtime; a
 * Node test can just `readFileSync` the same .ttf files directly out of
 * node_modules, via `require.resolve` so the path is never hand-typed twice.
 */

const require = createRequire(import.meta.url)

const REGULAR_TTF_PATH = require.resolve(
  "@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf"
)
const BOLD_TTF_PATH = require.resolve("@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf")

describe("ops.ts's DM Sans width table vs the fonts render.ts actually embeds", () => {
  it("agrees with pdf-lib's widthOfTextAtSize for ASCII 32-126, regular and bold", async () => {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)

    const [regular, bold] = await Promise.all([
      doc.embedFont(readFileSync(REGULAR_TTF_PATH), { subset: false }),
      doc.embedFont(readFileSync(BOLD_TTF_PATH), { subset: false }),
    ])

    // At size 1000, `widthOfTextAtSize` for a single character returns the
    // same "1/1000 em advance" unit `ops.ts`'s tables are keyed in, and
    // `textWidth(ch, 1000, bold)` collapses to exactly that same unit for a
    // one-character string — so the two are directly comparable without any
    // further scaling.
    for (let code = 32; code <= 126; code++) {
      const ch = String.fromCharCode(code)

      const expectedRegular = regular.widthOfTextAtSize(ch, 1000)
      const expectedBold = bold.widthOfTextAtSize(ch, 1000)

      // Within one unit (1/1000 em) — pdf-lib's own advance widths are
      // integers at this scale, so this is not a loose tolerance, just
      // enough to absorb floating-point round-trip noise.
      expect(textWidth(ch, 1000, false), `regular "${ch}" (code ${code})`).toBeCloseTo(
        expectedRegular,
        0
      )
      expect(textWidth(ch, 1000, true), `bold "${ch}" (code ${code})`).toBeCloseTo(
        expectedBold,
        0
      )
    }
  })
})
