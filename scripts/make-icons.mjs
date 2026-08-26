// Regenerates the PWA icons in public/ from src/logo.svg.
// Run: node scripts/make-icons.mjs
import sharp from "sharp"

const GROUND = "#14110e" // --ground from src/styles.css, converted to sRGB

const svg = "src/logo.svg"
const transparent = { r: 0, g: 0, b: 0, alpha: 0 }

// No explicit `density` here: src/logo.svg's own viewBox is already
// 5355x3786 (~20MP), far higher-res than any target below, and a
// density of 300 pushes librsvg's rasterization past sharp's default
// pixel-count limit ("Input image exceeds pixel limit") on this file's
// dimensions. Rendering at the SVG's native size and downsampling gives
// the same (in fact cleaner, since it's a downscale not an upscale)
// result for icons this small.

await sharp(svg)
  .resize(192, 192, { fit: "contain", background: transparent })
  .png()
  .toFile("public/logo192.png")

await sharp(svg)
  .resize(512, 512, { fit: "contain", background: transparent })
  .png()
  .toFile("public/logo512.png")

// Maskable: the mark inside the 80% safe zone on a solid ground, so any
// platform mask shape leaves the logo intact.
const mark = await sharp(svg)
  .resize(400, 400, { fit: "contain", background: transparent })
  .png()
  .toBuffer()
await sharp({
  create: { width: 512, height: 512, channels: 4, background: GROUND },
})
  .composite([{ input: mark, gravity: "centre" }])
  .png()
  .toFile("public/logo512-maskable.png")

// Desktop app icon source for `tauri icon` (Task 4). Same native-size
// render + downsample as above — no explicit density, for the same
// pixel-limit reason.
await sharp(svg)
  .resize(1024, 1024, { fit: "contain", background: transparent })
  .png()
  .toFile("src-tauri/app-icon.png")

// Tray icons: 32px. Idle is the mark alone; recording adds a red dot badge.
// Same no-density render as above, for the same pixel-limit reason.
const tray = await sharp(svg)
  .resize(32, 32, { fit: "contain", background: transparent })
  .png()
  .toBuffer()

await sharp(tray).png().toFile("src-tauri/icons/tray-idle.png")

const dot = Buffer.from(
  '<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="7" fill="#e5484d" stroke="#14110e" stroke-width="2"/></svg>',
)
await sharp(tray)
  .composite([{ input: dot }])
  .png()
  .toFile("src-tauri/icons/tray-recording.png")

console.log(
  "wrote public/logo192.png, logo512.png, logo512-maskable.png, src-tauri/app-icon.png, src-tauri/icons/tray-idle.png, src-tauri/icons/tray-recording.png",
)
