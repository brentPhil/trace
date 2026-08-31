import { HATCH_EMPTY } from "@/lib/hatch"
import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

/**
 * The panel every chart sits in, and the two SVG primitives they share.
 *
 * NOT shadcn's `Card`. That ships `rounded-4xl`, `shadow-md` and a
 * `ring-foreground/5` — three things DESIGN.md rejects by name (the
 * rounded-everything look, "Flat: depth is tonal, not cast", and a border so
 * dim it identifies nothing). Overriding all three at every call site is a
 * worse artefact than a fifteen-line panel that is right by construction, so
 * the card was removed rather than fought.
 *
 * Depth here is the ramp: `bg-card` on the page's ground, with one
 * `edge-soft` line where the boundary has to be unambiguous. No shadow.
 */
export function ChartFrame({
  title,
  caption,
  aside,
  className,
  children,
}: {
  title: string
  /** What the chart is measuring, when that is not obvious from the title. */
  caption?: ReactNode
  /** A figure or legend pinned to the title's right. */
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          {/* The Sentence Case Rule: no tracked-out uppercase eyebrows. */}
          <h2 className="text-sm font-medium">{title}</h2>
          {caption === undefined ? null : (
            <p className="text-xs text-muted-foreground">{caption}</p>
          )}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

/**
 * Why every series on this page sets `isAnimationActive={false}`.
 *
 * Recharts animates a bar's height up from zero on mount, through
 * `requestAnimationFrame`. A tab that is not compositing frames does not run
 * rAF — so the animation never starts, the height stays at zero, and the chart
 * renders as an empty plot with axes. Not a hypothetical: it is how these
 * charts first rendered here, and it is the same class of failure this codebase
 * already hit once with a CSS transition in an unpainted tab (see
 * `useForceCloseWhenClosed` in src/lib/popover-force-close.ts).
 *
 * It would be wrong even if it always worked. Convex queries are live, so every
 * push would replay the entrance; every date-range change would replay it
 * again; and DESIGN.md requires a `prefers-reduced-motion` alternative for
 * anything that moves, which an animation buried in a vendored chart library
 * does not have. A measuring instrument does not need its numbers to fly in.
 */

/**
 * Axis styling, set on every axis rather than left to a stylesheet.
 *
 * Recharts writes `fill="#666"` onto each tick as a presentation ATTRIBUTE.
 * shadcn's chart wrapper tries to undo that with a descendant selector
 * (`[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground`), and it did
 * not take here — the ticks measured `rgb(102, 102, 102)` in the browser, which
 * is far under the floor on a card. DESIGN.md puts the floor for ANY text at
 * `--muted-foreground`, and an axis a reader has to lean in for is not a scale,
 * it is a decoration pretending to be one.
 *
 * Passed as props because that is the version that cannot silently stop
 * working: a selector aimed at a vendored library's internal class names is one
 * upgrade away from matching nothing, and it fails invisibly — the chart still
 * draws, just dimmer.
 */
export const AXIS = {
  tickLine: false,
  axisLine: false,
  tick: { fill: "var(--muted-foreground)", fontSize: 12 },
} as const

/** The gridlines. Passive content between passive content — no floor applies. */
export const GRID_STROKE = "var(--border)"

/**
 * The X axis for a chart plotting `Bucket[]`.
 *
 * The daily chart and the earnings chart sit one above the other and are read
 * together, so their ticks have to behave identically — which nothing enforced
 * while the same four props were copied between them.
 */
export const SPAN_AXIS = {
  dataKey: "label",
  tickMargin: 8,
  minTickGap: 4,
  interval: "preserveStartEnd",
} as const

/**
 * The id of the hatch pattern, and the `<defs>` that declares it.
 *
 * The Hatch Rule (DESIGN.md): gaps and untracked time are marked with a
 * texture, never a hue. That rule is `HATCH_EMPTY` in src/lib/hatch.ts, but
 * an SVG `fill` cannot take a CSS `background-image`, so a chart needs the
 * same texture as a paint server. Same angle, same spacing, same colour token —
 * changing one without the other is how a page ends up with two hatches.
 *
 * `id` is per-chart rather than a constant: two charts on one page would
 * otherwise declare the same id twice, and SVG resolves `url(#…)` against the
 * whole document, so whichever mounted first would silently paint both.
 */
export function HatchDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern
        id={id}
        width="6"
        height="6"
        patternTransform="rotate(-45)"
        patternUnits="userSpaceOnUse"
      >
        <rect width="6" height="6" fill="transparent" />
        <line
          x1="0"
          y1="0"
          x2="0"
          y2="6"
          stroke="var(--border)"
          strokeWidth="2"
        />
      </pattern>
    </defs>
  )
}

/**
 * A key, in words, under a chart that carries more than one series.
 *
 * Its own component because the shadcn `ChartLegendContent` draws a swatch and
 * nothing else, which makes the colour the sole carrier of the meaning — the
 * one thing DESIGN.md never allows. Every item here is a swatch AND its name.
 */
export function ChartKey({
  items,
}: {
  items: Array<{ label: string; swatch: ReactNode }>
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.swatch}
          {item.label}
        </li>
      ))}
    </ul>
  )
}

/**
 * A solid key swatch. `color` is a CSS colour, usually a token.
 *
 * Shared with the tooltip, which wants the same mark one size smaller — the
 * swatch under a chart and the swatch inside its tooltip are what tie a row to
 * its series, and two definitions is how a radius change reaches only one.
 */
export function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-[2px]", className)}
      style={{ backgroundColor: color }}
    />
  )
}

/** The key swatch for the hatch — the same texture the chart paints. */
export function HatchSwatch() {
  return (
    <span
      aria-hidden
      className={cn(HATCH_EMPTY, "size-2.5 shrink-0 rounded-[2px]")}
    />
  )
}
