import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { AXIS, GRID_STROKE } from "@/components/reports/chart-frame"
import { BAR_CURSOR, TooltipCard, hoveredRow } from "@/components/reports/chart-tooltip"
import { formatTotal } from "@/lib/format-total"
import { hourAxis, hourRows } from "@/lib/report-series"
import type { DurationDisplay } from "@/lib/format-total"

/**
 * When in the day the work starts.
 *
 * Twenty-four buckets, always all of them, in clock order — dropping the empty
 * hours would squeeze a nine-to-five into the same width as a whole day and
 * destroy the one thing the chart is for, which is the SHAPE: where the day
 * begins, whether there is an afternoon dip, whether anything is happening at
 * midnight.
 *
 * Entries are attributed to the hour they STARTED in, matching how an entry is
 * attributed to a day. A block from 23:00 to 01:30 lands wholly in hour 23
 * rather than being split across two buckets, which is the same rule (and the
 * same reason) as the day attribution `entries.listRange` documents.
 */

export function HoursChart({
  hours,
  display,
  use12Hour,
}: {
  hours: Array<number>
  display: DurationDisplay
  use12Hour: boolean
}) {
  const rows = hourRows(hours, use12Hour)
  const yAxis = hourAxis(Math.max(...rows.map((row) => row.totalMs)))

  return (
    <ChartContainer
      /* Empty on purpose: `config` exists so shadcn can emit a `--color-<key>`
         variable per series, and every series here already names its own
         colour (a `--chart-*` token, or the projects `--project-*` data hue).
         There is nothing for the container to declare. */
      config={{}} className="aspect-auto h-56 w-full">
      <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} />
        <XAxis
          {...AXIS}
          dataKey="label"
          tickMargin={8}
          // Every fourth hour: 00, 04, 08 … Enough to orient by, few enough to
          // stay readable in half a page's width.
          interval={3}
        />
        <YAxis {...AXIS} {...yAxis} width={44} />
        <ChartTooltip cursor={BAR_CURSOR} content={<HourTooltip display={display} />} />
        {/* One tone. This chart says nothing about billability, and a second
            series here would be a distinction the reader has to hold for no
            question they are asking.

            `isAnimationActive={false}`: see the note in chart-frame.tsx. */}
        <Bar dataKey="totalMs" fill="var(--muted-foreground)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

function HourTooltip({
  display,
  active,
  payload,
}: {
  display: DurationDisplay
  active?: boolean
  payload?: unknown
}) {
  const row = hoveredRow<{ label: string; totalMs: number }>(active, payload)
  if (row === null) return null

  return (
    <TooltipCard
      heading={`Started at ${row.label}`}
      rows={[{ label: "Tracked", value: formatTotal(row.totalMs, display) }]}
    />
  )
}
