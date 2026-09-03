// Regenerates every raster icon the product ships from public/logo.svg.
// Run: pnpm icons — then `pnpm tauri icon src-tauri/app-icon.png` to fan the
// desktop icon out into src-tauri/icons/ (see docs/desktop.md).
//
// public/logo.svg is the mark ON ITS WHITE TILE, and every file written here
// keeps the tile: these icons are drawn by the OS — a browser tab, a home
// screen, a dock, the Windows tray — on a ground that is not ours, and the
// tile is what keeps a near-black mark legible on a dark taskbar. The one
// place the tile is dropped is inside the product, where src/components/
// logo.tsx renders the same paths in `currentColor` on our own surfaces.
import { writeFile } from "node:fs/promises"
import sharp from "sharp"

const svg = "public/logo.svg"

// The SVG has only a viewBox (478.78 units square) and no intrinsic size, so
// librsvg would rasterise it at 96 DPI — 479px — and every icon above that
// would be an UPSCALE. 300 DPI renders it at ~1496px, above the largest
// target (1024), so each size below is a clean downsample.
const source = () => sharp(svg, { density: 300 })

const png = (size) =>
  source().resize(size, size, { fit: "contain" }).png().toBuffer()

// PWA icons, as the manifest declares them.
await writeFile("public/logo192.png", await png(192))
await writeFile("public/logo512.png", await png(512))

// Maskable: the mark inside the 80% safe zone so any platform mask shape —
// circle, squircle, rounded square — leaves the clock and the page intact.
// The 400px render carries its own tile, and it sits on a white 512 so the
// cropped corners are tile too rather than a second colour.
await sharp({
  create: { width: 512, height: 512, channels: 4, background: "#ffffff" },
})
  .composite([{ input: await png(400), gravity: "centre" }])
  .png()
  .toFile("public/logo512-maskable.png")

// iOS Safari reads this off the `apple-touch-icon` link, never the manifest.
await writeFile("public/apple-touch-icon.png", await png(180))

// favicon.ico — the fallback for browsers that do not take the SVG favicon,
// and what Windows shows for a pinned site. An ICO is a 6-byte header, one
// 16-byte directory entry per image, then the images; PNG-encoded entries
// have been valid since Vista and every modern browser reads them. sharp
// does not write the container, so it is assembled here rather than pulling
// in a package for 40 lines of bookkeeping.
const favicon = (entries) => {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(16 * entries.length)
  let offset = header.length + directory.length
  entries.forEach(({ size, data }, index) => {
    const at = index * 16
    // Width and height are one byte each, with 0 standing for 256.
    directory.writeUInt8(size === 256 ? 0 : size, at)
    directory.writeUInt8(size === 256 ? 0 : size, at + 1)
    directory.writeUInt8(0, at + 2) // palette size: none
    directory.writeUInt8(0, at + 3) // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(data.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += data.length
  })

  return Buffer.concat([header, directory, ...entries.map((e) => e.data)])
}

const faviconSizes = [16, 32, 48]
await writeFile(
  "public/favicon.ico",
  favicon(
    await Promise.all(
      faviconSizes.map(async (size) => ({ size, data: await png(size) }))
    )
  )
)

// Desktop app icon source for `tauri icon`.
await writeFile("src-tauri/app-icon.png", await png(1024))

// Tray icons: 32px. Idle is the mark alone; recording adds a red dot badge,
// ringed in the tile's white so it separates from the mark underneath.
const tray = await png(32)
await writeFile("src-tauri/icons/tray-idle.png", tray)

const dot = Buffer.from(
  '<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="7" fill="#e5484d" stroke="#ffffff" stroke-width="2"/></svg>'
)
await sharp(tray)
  .composite([{ input: dot }])
  .png()
  .toFile("src-tauri/icons/tray-recording.png")

console.log(
  "wrote public/logo192.png, logo512.png, logo512-maskable.png, apple-touch-icon.png, favicon.ico, src-tauri/app-icon.png, src-tauri/icons/tray-idle.png, tray-recording.png"
)
