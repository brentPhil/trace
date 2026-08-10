import { useId } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { AXIS, ChartKey, GRID_STROKE, HatchDefs, HatchSwatch, Swatch } from "@/components/reports/chart-frame"
import { BAR_CURSOR, TooltipCard, hoveredRow } from "@/components/reports/chart-tooltip"
import { formatTotal } from "@/lib/format-total"
import type { DurationDisplay } from "@/lib/format-total"
import { hourTicks } from "@/lib/report-series"
import type { Bucket, Granularity } from "@/lib/report-series"
import type { ChartConfig } from "@/components/ui/chart"

/**
 * Time tracked per day (or per week, or per month — see `bucketDays`).
 *
 * The page's one hero chart, at full width, because "where did the fortnight
 * go" is the question Reports is opened to answer and every other panel is a
 * cut of it.
 *
 * NO HUE ANYWHERE. The Two Temperatures Rule reserves cold for "running now"
 * and warm for money, and neither is what a stacked bar of past work means. The
 * billable split is carried by the neutral ramp instead — ink against ink-muted,
 * which is the same "depth by tonal layering" the surfaces use — and is named in
 * words by the key underneath, so it survives both colour blindness and a
 * greyscale print.
 */

const config = {
  billableMs: { label: "Billable" },
  nonBillableMs: { label: "Non-billable" },
} satisfies ChartConfig

/**
 * How tall an empty span's hatch stub is drawn, as a fraction of the tallest
 * bar.
 *
 * A GLYPH, not a measurement — it is the Hatch Rule made visible on a chart
 * (DESIGN.md: gaps and untracked time are a texture, never a colour, and never
 * nothing at all). Without it a day off renders as bare axis, indistinguishable
 * from a day whose data has not arrived, and the eye closes the gap so a
 * fortnight with a Thursday off reads as an unbroken run.
 *
 * Small on purpose: a full-height column would shout "alarm" over what is
 * usually a weekend.
 */
const EMPTY_STUB = 0.035

export function DailyChart({
  buckets,
  granularity,
  display,
}: {
  buckets: Array<Bucket>
  granularity: Granularity
  display: DurationDisplay
}) {
  // Suffixed per instance: SVG resolves `url(#…)` against the whole document,
  // so two charts declaring one id would silently share whichever mounted first.
  const hatchId = `${useId().replace(/:/g, "")}-hatch`

  const tallest = buckets.reduce((max, bucket) => Math.max(max, bucket.totalMs), 0)
  const rows = buckets.map((bucket) => ({
    ...bucket,
    // Stacked with the real series rather than drawn beside them, so the bars
    // keep their full width and the stub sits exactly where the missing bar
    // would have been.
    emptyMs: bucket.empty ? Math.max(tallest * EMPTY_STUB, 60_000) : 0,
  }))

  // Includes the stub, which is a fraction of `tallest` and so cannot push
  // the axis to a taller step than the real bars already need.
  const ticks = hourTicks(tallest)
  const unit = granularity === "day" ? "day" : granularity === "week" ? "week" : "month"

  return (
    <>
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <HatchDefs id={hatchId} />
          {/* Horizontal only. Vertical rules on a category axis add a grid
              nobody reads against and make the plot look like a timesheet. */}
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis
            {...AXIS}
            dataKey="label"
            tickMargin={8}
            minTickGap={4}
            interval="preserveStartEnd"
          />
          {/* Ticks on round hours, and a domain pinned to them, so the
              gridlines mean something a reader can name — see `hourTicks`. */}
          <YAxis
            {...AXIS}
            width={48}
            tickFormatter={hoursTick}
            ticks={ticks}
            domain={[0, ticks[ticks.length - 1]]}
          />
          <ChartTooltip
            cursor={BAR_CURSOR}
            content={<DailyTooltip display={display} unit={unit} />}
          />
          {/* Billable at the BOTTOM, so a bar reads upward as "this much of it
              earns, this much does not" — and so the earning part shares a
              baseline across days and can be compared by eye.

              `isAnimationActive={false}`: see the note in chart-frame.tsx. */}
          <Bar
            dataKey="billableMs"
            stackId="tracked"
            fill="var(--ink)"
            isAnimationActive={false}
          />
          <Bar
            dataKey="nonBillableMs"
            stackId="tracked"
            fill="var(--ink-muted)"
            isAnimationActive={false}
          />
          <Bar
            dataKey="emptyMs"
            stackId="tracked"
            fill={`url(#${hatchId})`}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      <ChartKey
        items={[
          { label: "Billable", swatch: <Swatch color="var(--ink)" /> },
          { label: "Non-billable", swatch: <Swatch color="var(--ink-muted)" /> },
          { label: `Nothing tracked`, swatch: <HatchSwatch /> },
        ]}
      />
    </>
  )
}

/** Whole hours. The axis is a scale to read bars against, not a figure. */
function hoursTick(ms: number): string {
  return `${Math.round(ms / 3_600_000)}h`
}

function DailyTooltip({
  display,
  unit,
  active,
  payload,
}: {
  display: DurationDisplay
  unit: string
  active?: boolean
  payload?: unknown
}) {
  const row = hoveredRow<Bucket>(payload)
  if (active !== true || row === null) return null

  if (row.empty) {
    return <TooltipCard heading={row.title} rows={[]} footnote={`Nothing tracked this ${unit}.`} />
  }

  return (
    <TooltipCard
      heading={row.title}
      rows={[
        {
          label: "Tracked",
          value: formatTotal(row.totalMs, display),
        },
        {
          label: "Billable",
          value: formatTotal(row.billableMs, display),
          swatch: "var(--ink)",
        },
        {
          label: "Non-billable",
          value: formatTotal(row.nonBillableMs, display),
          swatch: "var(--ink-muted)",
        },
        {
          label: row.count === 1 ? "Entry" : "Entries",
          value: String(row.count),
        },
      ]}
    />
  )
}
