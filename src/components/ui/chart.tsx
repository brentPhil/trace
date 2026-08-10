import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

/**
 * shadcn's chart wrapper, trimmed to the parts this product can use.
 *
 * What is gone, and why — deliberately, rather than by neglect:
 *
 *   `ChartTooltipContent` renders a value with `Number.toLocaleString()`. Every
 *   figure in this product is a duration in milliseconds or an amount in cents,
 *   and neither survives that: "28,800,000" where "8:00:00" belongs. It is also
 *   where the Tabular Rule and the money/duration distinction have to be
 *   applied. See `TooltipCard` in src/components/reports/chart-tooltip.tsx.
 *
 *   `ChartLegendContent` renders a swatch carrying the series identity, and
 *   DESIGN.md never allows colour to be the sole carrier of a meaning. See
 *   `ChartKey` in src/components/reports/chart-frame.tsx.
 *
 *   `ChartConfig` and the `ChartStyle`/`ChartContext`/`useChart` machinery that
 *   consumed it. Its whole job was to emit `--color-<key>` variables for series
 *   that declare a `color` or `theme`, and to hand `label` to the two components
 *   above. This product paints every series from a design token at the call site
 *   — the Monochrome Rule means most of them are one of two greys — so no config
 *   ever carried a colour, `ChartStyle` returned `null` on every render, and
 *   `useChart` had no callers at all. Sixty lines and a required prop that did
 *   nothing but had to be read to find that out.
 *
 * `npx shadcn add chart --overwrite` restores all of it if a future surface
 * wants it; this file is not attempting to be the upstream one.
 */

const INITIAL_DIMENSION = { width: 320, height: 200 } as const

function ChartContainer({
  className,
  children,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<"div"> & {
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"]
  initialDimension?: {
    width: number
    height: number
  }
}) {
  return (
    <div
      data-slot="chart"
      className={cn(
        "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
        className
      )}
      {...props}
    >
      <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>
        {children}
      </RechartsPrimitive.ResponsiveContainer>
    </div>
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

export { ChartContainer, ChartTooltip }
