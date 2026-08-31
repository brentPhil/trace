import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { AXIS, GRID_STROKE, SPAN_AXIS } from "@/components/reports/chart-frame"
import { TooltipCard, hoveredRow } from "@/components/reports/chart-tooltip"
import { formatMoney } from "@shared/money"
import type { Bucket } from "@/lib/report-series"

/**
 * What the period has earned, accumulating.
 *
 * CUMULATIVE rather than per-day, and that is the whole reason this chart is
 * worth a panel next to the daily bars. Per-day amounts are the daily chart
 * again with a currency axis; the running total answers a different question —
 * "how close is this fortnight to what I need it to be" — and it is the shape a
 * freelancer actually watches.
 *
 * BRASS, which is the one place on this page a hue means anything: The Two
 * Temperatures Rule makes warm mean money, and every value on this axis is a
 * currency amount. The daily chart beside it plots the same billable hours in
 * ink precisely because those are a duration, not an amount.
 *
 * `earnedCents` lands EXACTLY on the period's headline figure at the last
 * point, by construction — `entries.rangeBreakdown` derives each day's amount
 * as the delta of a rounded running total rather than rounding each day on its
 * own, so the curve cannot end a few cents away from the number printed above
 * it. That reasoning is written out at the `days` accumulation there.
 */

export function EarningsChart({
  buckets,
  currency,
}: {
  buckets: Array<Bucket>
  currency: string
}) {
  return (
    <ChartContainer
      /* Empty on purpose: `config` exists so shadcn can emit a `--color-<key>`
         variable per series, and every series here already names its own
         colour (a `--chart-*` token, or the projects `--project-*` data hue).
         There is nothing for the container to declare. */
      config={{}} className="aspect-auto h-56 w-full">
      <AreaChart data={buckets} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
        <defs>
          {/*
            A fade to transparent, not to a second colour. The No Glow Rule
            forbids coloured halos, and a two-stop gradient between hues is the
            generic-SaaS look DESIGN.md names as an anti-reference; this is one
            hue losing opacity, which is what makes the line the figure and the
            fill merely its footprint.
          */}
          <linearGradient id="earned-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} />
        <XAxis {...AXIS} {...SPAN_AXIS} />
        <YAxis
          {...AXIS}
          width={64}
          tickFormatter={(cents: number) => formatMoney(cents, currency)}
        />
        <ChartTooltip
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          content={<EarningsTooltip currency={currency} />}
        />
        {/*
          `stepAfter`, not a curve. Money arrives when work is logged, in
          discrete jumps; a smoothed line would draw earnings accruing
          continuously through a Sunday nobody worked, and would dip below its
          own data points between them — a curve that shows less than was earned
          is the exact direction of error this product refuses everywhere else.
        */}
        <Area
          type="stepAfter"
          dataKey="earnedCents"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#earned-fill)"
          // A dot per day is noise at 45 points; one on hover is the affordance
          // that matters.
          dot={false}
          activeDot={{ r: 3, fill: "var(--chart-1)", stroke: "var(--card)" }}
          // See the note in chart-frame.tsx.
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

function EarningsTooltip({
  currency,
  active,
  payload,
}: {
  currency: string
  active?: boolean
  payload?: unknown
}) {
  const row = hoveredRow<Bucket>(active, payload)
  if (row === null) return null

  return (
    <TooltipCard
      heading={row.title}
      rows={[
        { label: "Earned so far", value: formatMoney(row.earnedCents, currency), money: true },
        { label: "This span", value: formatMoney(row.billableCents, currency), money: true },
      ]}
    />
  )
}
