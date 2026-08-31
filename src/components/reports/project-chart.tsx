import { useId } from "react"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts"
import { AXIS, HatchDefs } from "@/components/reports/chart-frame"
import { BAR_CURSOR, TooltipCard, hoveredRow } from "@/components/reports/chart-tooltip"
import { formatTotal } from "@/lib/format-total"
import { unpriced } from "@/lib/format-money"
import { projectColorVar } from "@/lib/project-color"
import { NO_PROJECT_LABEL } from "@/lib/report-series"
import { formatMoney } from "@shared/money"
import type { TooltipRow } from "@/components/reports/chart-tooltip"
import type { DurationDisplay } from "@/lib/format-total"
import type { ProjectTotal } from "@/lib/report-series"

/**
 * Where the time went, by project.
 *
 * A RANKED BAR, not a pie. A pie asks the reader to compare angles, which
 * people do badly and inconsistently; a bar puts every project on one baseline
 * so "twice as much" looks twice as long. It also degrades gracefully — a
 * fifteenth client adds a row, where a pie adds an unreadable slice.
 *
 * This is the one chart on the page that carries hue, and it is the one place
 * DESIGN.md already permits it: the project palette exists, it is capped at
 * twelve legible values, and it is never the sole carrier — every bar sits
 * beside its own name. The two reserved hues (the running accent, brass) are absent
 * from that palette by construction, so no project can be mistaken for a
 * running timer or for money.
 */

/**
 * How many projects get their own bar before the tail is rolled up.
 *
 * The roll-up is LABELLED with how many it covers rather than silently
 * dropped — a chart that quietly truncates reads as "this is all of it", and
 * the total above it would then disagree with the sum of the bars.
 */
const MAX_BARS = 8

type Row = ProjectTotal & { fill: string; rolled: number }

export function ProjectChart({
  projects,
  display,
  currency,
}: {
  projects: Array<ProjectTotal>
  display: DurationDisplay
  currency: string
}) {
  const hatchId = `${useId().replace(/:/g, "")}-hatch`
  const rows = rollUp(projects, hatchId)

  return (
    <ChartContainer
      /* Empty on purpose: `config` exists so shadcn can emit a `--color-<key>`
         variable per series, and every series here already names its own
         colour (a `--chart-*` token, or the projects `--project-*` data hue).
         There is nothing for the container to declare. */
      config={{}}
      // Height per bar rather than an aspect ratio: three projects in a
      // 16:9 box are three stripes with a field of empty beneath them.
      className="aspect-auto w-full"
      style={{ height: `${rows.length * 34 + 24}px` }}
    >
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
        barCategoryGap="22%"
      >
        <HatchDefs id={hatchId} />
        <XAxis type="number" dataKey="totalMs" hide />
        <YAxis
          {...AXIS}
          type="category"
          dataKey="name"
          width={132}
          tickMargin={6}
          tick={<ProjectTick />}
        />
        <ChartTooltip
          cursor={BAR_CURSOR}
          content={<ProjectTooltip display={display} currency={currency} />}
        />
        {/* `isAnimationActive={false}`: see the note in chart-frame.tsx. */}
        <Bar dataKey="totalMs" radius={2} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell key={row.name} fill={row.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/**
 * The top projects, with everything past `MAX_BARS` summed into one labelled
 * row.
 *
 * The tail is summed rather than dropped, so the bars still add up to the
 * period total printed above them. `projects` arrives sorted longest-first from
 * `entries.rangeBreakdown`, so "the tail" is genuinely the smallest ones.
 */
function rollUp(projects: Array<ProjectTotal>, hatchId: string): Array<Row> {
  const paint = (project: ProjectTotal): string =>
    // No project is an ABSENCE, and absence is a texture (the Hatch Rule) —
    // never a thirteenth colour, which would read as one more client.
    project.projectId === null ? `url(#${hatchId})` : projectColorVar(project.color)

  const named = (project: ProjectTotal): string =>
    project.projectId === null ? NO_PROJECT_LABEL : project.name

  if (projects.length <= MAX_BARS) {
    return projects.map((project) => ({
      ...project,
      name: named(project),
      fill: paint(project),
      rolled: 0,
    }))
  }

  const head = projects.slice(0, MAX_BARS - 1)
  const tail = projects.slice(MAX_BARS - 1)
  const rest = tail.reduce(
    (sum, project) => ({
      totalMs: sum.totalMs + project.totalMs,
      billableMs: sum.billableMs + project.billableMs,
      billableCents: sum.billableCents + project.billableCents,
      unratedBillableMs: sum.unratedBillableMs + project.unratedBillableMs,
      count: sum.count + project.count,
    }),
    { totalMs: 0, billableMs: 0, billableCents: 0, unratedBillableMs: 0, count: 0 }
  )

  return [
    ...head.map((project) => ({
      ...project,
      name: named(project),
      fill: paint(project),
      rolled: 0,
    })),
    {
      ...rest,
      projectId: null,
      name: `${tail.length} more`,
      color: "",
      fill: "var(--border)",
      rolled: tail.length,
    },
  ]
}

/**
 * The axis label, drawn by hand rather than by recharts' `Text`.
 *
 * `Text` word-WRAPS against the axis width, and each bar's row is 34px — so
 * "Harbourmaster Ltd" broke onto a second line and ran into the label below it.
 * The wrap is not configurable per tick, and its measurement is conservative
 * enough that a name which visibly fits still splits.
 *
 * A plain `<text>` cannot wrap, so the row height and the label height are the
 * same fact again. Long names are cut HERE and nowhere else — the tooltip
 * always shows the client's full name, because a truncated name on the one
 * screen where someone checks what to invoice is worse than no name.
 */
type TickProps = { x?: number; y?: number; payload?: { value?: string } }

function ProjectTick({ x = 0, y = 0, payload }: TickProps) {
  const name = payload?.value ?? ""
  return (
    <text
      x={x}
      y={y}
      dy="0.32em"
      textAnchor="end"
      fontSize={12}
      // Not `currentColor`: recharts writes `fill="#666"` onto its own ticks as
      // a presentation attribute, and this is the axis that no longer goes
      // through it. See `AXIS` in chart-frame.tsx.
      fill="var(--muted-foreground)"
    >
      {truncate(name)}
    </text>
  )
}

/** Roughly what fits 132px at 12px, which is the axis slot these sit in. */
function truncate(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name
}

function ProjectTooltip({
  display,
  currency,
  active,
  payload,
}: {
  display: DurationDisplay
  currency: string
  active?: boolean
  payload?: unknown
}) {
  const row = hoveredRow<Row>(active, payload)
  if (row === null) return null

  const rows: Array<TooltipRow> = [
    { label: "Tracked", value: formatTotal(row.totalMs, display) },
    { label: "Billable", value: formatTotal(row.billableMs, display) },
    { label: row.count === 1 ? "Entry" : "Entries", value: String(row.count) },
  ]

  // The amount is omitted entirely — never "$0.00" — when none of this
  // project's billable time could be priced. Same predicate as the totals
  // sentence and the Summary readout; see `unpriced`.
  const unpricedAll = unpriced(row).all
  if (row.billableMs > 0 && !unpricedAll) {
    // The one brass figure here: money, and nothing else.
    rows.push({
      label: "Amount",
      value: formatMoney(row.billableCents, currency),
      money: true,
    })
  }

  return (
    <TooltipCard
      heading={row.rolled > 0 ? `${row.rolled} smaller projects` : row.name}
      rows={rows}
      footnote={unpricedAll ? "No hourly rate is set for this work." : undefined}
    />
  )
}
