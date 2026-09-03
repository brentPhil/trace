import type { SVGProps } from "react"

/**
 * The Chroneli mark — a clock face beside a page — as an inline SVG.
 *
 * The paths are `public/logo.svg`'s, which is the one source every icon the
 * product ships is rendered from (see `scripts/make-icons.mjs`). Two things
 * are deliberately NOT carried over from that file:
 *
 *   - the white tile behind the mark. It belongs where the OS draws the icon
 *     — favicon, dock, tray — and there it is what keeps the mark legible on a
 *     taskbar whose colour is not ours. In the product the ground IS ours, and
 *     a white square on a dark sidebar is a sticker, not a logo.
 *   - the near-black fill. `currentColor` instead, so the mark takes the ramp
 *     exactly the way a Lucide icon does: `text-foreground` on the auth
 *     pages, the sidebar's own foreground in the rail, and whatever a theme
 *     preset says those are.
 *
 * The viewBox is cropped to the mark's bounds rather than the source's full
 * 478.78 square, which had ~16% of tile on every side. Sized by the caller
 * like any icon — `size-4` in a sidebar button comes from the cva — so it
 * carries no size of its own. Decorative everywhere it is used; the name
 * sits beside it as text or on the parent link, so it is `aria-hidden`.
 */
export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="68 60 360 360"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M77.31,231.71l36.14.21-.04,16.81-36,.18c-.19-3.15-.28-6.32-.28-9.52,0-2.58.06-5.14.18-7.68Z" />
      <path d="M231.16,118.62l-.03-41.28c2.74-.14,5.49-.21,8.26-.21s5.67.07,8.48.22l-.17,42.4-13.97.31c-.68.11-2.57-.47-2.57-1.44Z" />
      <path d="M247.68,360.68l.22,40.75c-2.82.15-5.66.22-8.51.22s-5.57-.07-8.33-.21l.23-40.74,16.39-.02Z" />
      <path d="M401.66,239.39c0,3.2-.09,6.38-.28,9.53l-34.51-.09c-1.44,0-2.2-1.25-2.19-2.51l.09-12.39c-.01-.99.79-2.16,1.91-2.16l34.8-.09c.12,2.55.18,5.12.18,7.71Z" />
      <polygon points="131.51 168.44 125.32 178.88 99.57 163.62 105.75 153.18 131.51 168.44" />
      <polygon points="378.75 164.61 353.76 179.38 347.67 169.07 372.66 154.29 378.75 164.61" />
      <rect
        x="100.33"
        y="306.55"
        width="28.86"
        height="11.94"
        transform="translate(-144.01 103.06) rotate(-30.85)"
      />
      <rect
        x="162.58"
        y="101.94"
        width="11.87"
        height="28.8"
        transform="translate(-35.27 96.23) rotate(-28.98)"
      />
      <rect
        x="295.6"
        y="110.7"
        width="28.82"
        height="11.77"
        transform="translate(58.1 331.63) rotate(-61.1)"
      />
      <path d="M180.01,354.47l-13.1,23.79c-3.63-.34-5.5-2.46-8.3-3.6-.96-.39-1.9-1.83-1.25-2.99l12.55-22.34c2.74-.2,7.9,2.63,10.1,5.14Z" />
      <path d="M418.07,276.15c-.01-6.87-6.56-13.35-13.64-13.33l-118.74.19c-10.76.02-20.07,10.89-20.09,21.25l-.13,108.41c-.02,12.04,8.8,21.5,20.52,23.04l78.19.06c6.2,0,10.58-2.62,14.75-6.79l20.95-20.92,13.62-15.35c2.7-3.04,4.74-6.68,4.73-10.99l-.15-85.57ZM403.97,359.14c0,1.75-1.46,2.75-3.04,2.75l-22.07.07c-9.58.04-18.51,7.96-18.55,17.99l-.07,19.31c-.01,1.65-1.01,2.93-2.88,2.93l-68.65-.06c-6.34,0-9.12-5.5-9.11-11.1l.05-105.05c0-4.85,2.82-9.5,8.26-9.51l111.11-.08c2.97,0,4.95,1.92,4.95,4.75v77.98Z" />
      <path d="M378.08,323.93l-72.16.05c-2.98,0-4.34-4.01-4.51-5.92-.19-2.24.94-6.81,4.31-6.81l72.23-.06c3.2,0,4.53,4.1,4.61,6.17.07,2-.95,6.58-4.48,6.58Z" />
      <path d="M355.91,362.06l-49.85.09c-3.1,0-4.46-3.74-4.61-5.77-.16-2.33.88-6.85,4.27-6.85l50.22-.04c3.31,0,4.53,3.99,4.62,6.14.08,2.21-1.08,6.41-4.65,6.41Z" />
      <path d="M319.66,199.08l-66.73,40.31c0,7.48-6.06,13.54-13.54,13.54s-13.53-6.06-13.53-13.54c0-4.49,2.18-8.46,5.53-10.92v-70.02c0-4.42,3.58-8,8-8s8,3.58,8,8v67.93l-1.69,1.02c.59.32,1.16.67,1.69,1.07v-2.09l65.03-39.29c3.31-1.99,7.61-.93,9.61,2.38s.93,7.61-2.37,9.61Z" />
    </svg>
  )
}
