import { PDFDocument, rgb } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import { PAGE, PAPER } from "./paper"
import type { PdfPage } from "./ops"
import type { PDFFont, PDFPage } from "pdf-lib"

// The two TTF weights this document embeds — regular body text and every
// `bold: true` op (headings, TOTAL, tile values). `?url` keeps Vite from
// inlining the bytes into this module: it resolves to an asset URL, fetched
// below, so the font bytes live in the same lazily-loaded chunk as pdf-lib
// itself rather than the app's main bundle (this file is only ever reached
// through `to-pdf.ts`'s `await import()`, never a static import).
//
// `@expo-google-fonts/dm-sans` rather than the app's own
// `@fontsource-variable/dm-sans`: the latter ships only `.woff2`, which
// pdf-lib cannot decode, and is a variable font, which fontkit embeds far
// less reliably than a static instance. This package is the same DM Sans as
// static per-weight `.ttf` files with zero runtime dependencies of its own
// (verified: its `package.json` has no `dependencies` field at all — it is
// font assets, not Expo code) — a clean way to get a real TTF into pdf-lib.
import dmSansRegularUrl from "@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf?url"
import dmSansBoldUrl from "@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf?url"

/**
 * Ops onto paper. The ONLY file in the project that imports pdf-lib.
 *
 * Embeds the app's own DM Sans rather than `StandardFonts.Helvetica` — a
 * report is the product's own document and should carry its identity, not
 * whatever pdf-lib can draw without embedding anything. `ops.ts`'s width
 * table was regenerated against these exact two TTFs (see its own comment);
 * changing which weight is embedded here without updating that table is what
 * would reopen the DURATION-column overprint P0-1 fixed, just measured
 * against the wrong font.
 */
async function fetchFontBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  return await response.arrayBuffer()
}

// P1-5: on a range with many empty days and few real bars (26 empty against
// 5 real, the observed case), a dense hatch reads louder than the data next
// to it — absence shouting over presence. Widened spacing and a thinner
// stroke (was 5pt / 0.4pt) keep it a quiet texture while staying visibly
// distinct from both a real bar (a fill) and the measured-zero mark (a solid
// tick) — the Hatch Rule requires the distinction survive, not that it shout.
const HATCH_SPACING = 9
const HATCH_THICKNESS = 0.3

function drawHatch(
  page: PDFPage,
  op: { x: number; y: number; width: number; height: number }
): void {
  const color = rgb(...PAPER.hatch)
  // Diagonals at 45 degrees, clipped by drawing only within the box. Absence as
  // a texture (the Hatch Rule) — never a fill, which would read as a value.
  for (let offset = 0; offset < op.width + op.height; offset += HATCH_SPACING) {
    const x1 = op.x + Math.min(offset, op.width)
    const y1 = op.y + Math.max(0, offset - op.width)
    const x2 = op.x + Math.max(0, offset - op.height)
    const y2 = op.y + Math.min(offset, op.height)
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: HATCH_THICKNESS,
      color,
    })
  }
}

export async function renderPages(pages: Array<PdfPage>): Promise<Blob> {
  const doc = await PDFDocument.create()
  // Embedding a TTF (rather than one of pdf-lib's built-in `StandardFonts`)
  // requires fontkit — pdf-lib parses and subsets arbitrary font files
  // through it, not through code of its own.
  doc.registerFontkit(fontkit)

  const [regularBytes, boldBytes] = await Promise.all([
    fetchFontBytes(dmSansRegularUrl),
    fetchFontBytes(dmSansBoldUrl),
  ])
  // `subset: true` keeps the OUTPUT pdf small: without it, embedding ships
  // the font's full glyph set (accents, non-Latin scripts, ligatures) inside
  // every exported PDF for a document that only ever draws ASCII. pdf-lib
  // collects which glyphs were actually used across every `drawText` call
  // below and writes only those into the saved file.
  const regular = await doc.embedFont(regularBytes, { subset: true })
  const bold = await doc.embedFont(boldBytes, { subset: true })

  for (const model of pages) {
    const page = doc.addPage([PAGE.width, PAGE.height])
    for (const op of model.ops) {
      if (op.kind === "text") {
        const font: PDFFont = op.bold ? bold : regular
        // Alignment is measured, not approximated: the amount column is the one
        // a reader scans down, and a ragged right edge in it reads as a
        // different number of digits than is there. `center` is the same
        // measurement halved — an axis tick sitting under the bar it labels.
        const measured =
          op.align === undefined || op.align === "left"
            ? 0
            : font.widthOfTextAtSize(op.text, op.size)
        const offset = op.align === "center" ? measured / 2 : measured
        page.drawText(op.text, {
          x: op.x - offset,
          y: op.y,
          size: op.size,
          font,
          color: rgb(...(op.color ?? PAPER.ink)),
        })
      } else if (op.kind === "rect") {
        page.drawRectangle({
          x: op.x,
          y: op.y,
          width: op.width,
          height: op.height,
          color: rgb(...op.color),
        })
      } else if (op.kind === "path") {
        // pdf-lib's SVG path space is y-DOWN from the given origin, while every
        // coordinate in `ops.ts` is y-up PDF user space. `scale: -1` on y is
        // what reconciles them, and it is done here rather than in the path
        // builder so the ops stay in one coordinate system.
        page.drawSvgPath(op.d, { x: op.x, y: PAGE.height, color: rgb(...op.color) })
      } else {
        drawHatch(page, op)
      }
    }
  }

  // `doc.save()` returns `Uint8Array<ArrayBufferLike>` (it may be backed by a
  // `SharedArrayBuffer`), which `BlobPart` does not accept. Copying into a
  // fresh `Uint8Array` gives it a plain `ArrayBuffer` backing store.
  const bytes = await doc.save()
  return new Blob([new Uint8Array(bytes)], { type: "application/pdf" })
}
