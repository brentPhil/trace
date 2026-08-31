import { useId } from "react"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  AXIS,
  ChartKey,
  GRID_STROKE,
  HatchDefs,
  HatchSwatch,
  SPAN_AXIS,
  Swatch,
} from "@/components/reports/chart-frame"
import { BAR_CURSOR, TooltipCard, hoveredRow } from "@/components/reports/chart-tooltip"
import { formatTotal } from "@/lib/format-total"
import type { DurationDisplay } from "@/lib/format-total"
import { hourAxis } from "@/lib/report-series"
import type { Bucket, Granularity } from "@/lib/report-series"

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
  const yAxis = hourAxis(tallest)
  const unit = granularity === "day" ? "day" : granularity === "week" ? "week" : "month"

  return (
    <>
      <ChartContainer
      /* Empty on purpose: `config` exists so shadcn can emit a `--color-<key>`
         variable per series, and every series here already names its own
         colour (a `--chart-*` token, or the projects `--project-*` data hue).
         There is nothing for the container to declare. */
      config={{}} className="aspect-auto h-64 w-full">
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <HatchDefs id={hatchId} />
          {/* Horizontal only. Vertical rules on a category axis add a grid
              nobody reads against and make the plot look like a timesheet. */}
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis {...AXIS} {...SPAN_AXIS} />
          {/* Ticks on round hours, with the domain pinned to them, so the
              gridlines mean something a reader can name — see `hourAxis`. */}
          <YAxis {...AXIS} {...yAxis} width={48} />
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
            fill="var(--foreground)"
            isAnimationActive={false}
          />
          <Bar
            dataKey="nonBillableMs"
            stackId="tracked"
            fill="var(--muted-foreground)"
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
          { label: "Billable", swatch: <Swatch color="var(--foreground)" /> },
          { label: "Non-billable", swatch: <Swatch color="var(--muted-foreground)" /> },
          { label: `Nothing tracked`, swatch: <HatchSwatch /> },
        ]}
      />
    </>
  )
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
  const row = hoveredRow<Bucket>(active, payload)
  if (row === null) return null

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
          swatch: "var(--foreground)",
        },
        {
          label: "Non-billable",
          value: formatTotal(row.nonBillableMs, display),
          swatch: "var(--muted-foreground)",
        },
        {
          label: row.count === 1 ? "Entry" : "Entries",
          value: String(row.count),
        },
      ]}
    />
  )
}
