import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import { PAGE, PAPER } from "./paper"
import type { PdfPage } from "./ops"
import type { PDFFont, PDFPage } from "pdf-lib"

/**
 * Ops onto paper. The ONLY file in the project that imports pdf-lib.
 *
 * Helvetica rather than the app's DM Sans. Embedding a variable webfont means
 * `@pdf-lib/fontkit`, a TTF asset in the bundle, and a subsetting step — a real
 * amount of weight for a document nobody reads for its typeface. Worth
 * revisiting when the invoice PDF lands, since that one carries the user's
 * brand; a report handed over as evidence does not.
 */

const HATCH_SPACING = 5

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
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.4, color })
  }
}

export async function renderPages(pages: Array<PdfPage>): Promise<Blob> {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  for (const model of pages) {
    const page = doc.addPage([PAGE.width, PAGE.height])
    for (const op of model.ops) {
      if (op.kind === "text") {
        const font: PDFFont = op.bold ? bold : regular
        // Right alignment is measured, not approximated: the amount column is
        // the one a reader scans down, and a ragged right edge in it reads as
        // a different number of digits than is there.
        const width = op.align === "right" ? font.widthOfTextAtSize(op.text, op.size) : 0
        page.drawText(op.text, {
          x: op.x - width,
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
