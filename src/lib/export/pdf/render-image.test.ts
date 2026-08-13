import { describe, expect, it, vi } from "vitest"
import { drawImageOp } from "./render"
import type { ImageOp } from "./ops"
import type { PDFImage } from "pdf-lib"

const op: ImageOp = {
  kind: "image",
  x: 100,
  y: 200,
  width: 160,
  height: 48,
  data: new Uint8Array([1, 2, 3]),
  format: "png",
}

describe("drawImageOp", () => {
  it("omits corrupt decoration instead of failing the document", async () => {
    const drawImage = vi.fn()
    await expect(
      drawImageOp(
        {
          embedPng: vi.fn(async () => {
            throw new Error("bad png")
          }),
          embedJpg: vi.fn(),
        },
        { drawImage },
        op
      )
    ).resolves.toBeUndefined()
    expect(drawImage).not.toHaveBeenCalled()
  })

  it("fits and top-right anchors a valid image inside its box", async () => {
    const embedded = { width: 400, height: 200 } as PDFImage
    const drawImage = vi.fn()
    await drawImageOp(
      {
        embedPng: vi.fn(async () => embedded),
        embedJpg: vi.fn(),
      },
      { drawImage },
      op
    )

    expect(drawImage).toHaveBeenCalledWith(embedded, {
      x: 164,
      y: 200,
      width: 96,
      height: 48,
    })
  })
})
