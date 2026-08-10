import { useMemo } from "react"
import { ChartFrame } from "@/components/reports/chart-frame"
import { DailyChart } from "@/components/reports/daily-chart"
import { EarningsChart } from "@/components/reports/earnings-chart"
import { HoursChart } from "@/components/reports/hours-chart"
import { ProjectChart } from "@/components/reports/project-chart"
import { formatTotal } from "@/lib/format-total"
import { bucketDays, busiest } from "@/lib/report-series"
import { staleProps } from "@/lib/stale"
import { unpriced } from "@/lib/format-money"
import { formatMoney } from "@shared/money"
import type { DurationDisplay } from "@/lib/format-total"
import type { Breakdown } from "@/lib/report-series"
import type { DayString } from "@shared/day"
import type { ReactNode } from "react"

/**
 * Reports' Summary tab: the same range the Detailed tab lists, drawn.
 *
 * PURE. It takes a `Breakdown` and renders it — no query, no `api`, no
 * mutation. That is the boundary `eslint.config.js` enforces for writes, and
 * holding to it for reads is what makes every chart here renderable against a
 * fixture, which is the only practical way to look at a chart under a dozen
 * shapes of data before real ones arrive.
 *
 * It is deliberately NOT a dashboard of tiles. DESIGN.md rejects the
 * big-number hero-metric template by name, so the figures at the top are an
 * instrument readout — a label, a figure, a hairline — and the panels beneath
 * are four cuts of ONE question ("where did this period go"), not twelve
 * metrics competing for the same attention.
 */

export function SummaryPanel({
  breakdown,
  from,
  to,
  display,
  currency,
  use12Hour,
  isStale,
}: {
  breakdown: Breakdown
  /** The range on screen, so empty days can be drawn as empty rather than
   *  closed up — the server sends only days that hold entries. */
  from: DayString
  to: DayString
  display: DurationDisplay
  currency: string
  use12Hour: boolean
  isStale: boolean
}) {
  const { granularity, buckets } = useMemo(
    () => bucketDays(breakdown.days, from, to),
    [breakdown.days, from, to]
  )
  const heaviest = useMemo(() => busiest(buckets), [buckets])

  // The same predicate the totals sentence and the project tooltip use, so
  // the three cannot disagree about whether an amount is printable.
  const { some: unpricedSome, all: unpricedAll } = unpriced(breakdown)

  if (breakdown.count === 0) {
    return (
      <div {...staleProps(isStale, "px-4 py-12")}>
        <p className="text-sm text-muted-foreground">
          Nothing tracked in this period. Try a wider date range, or clear the
          filters.
        </p>
      </div>
    )
  }

  return (
    <div {...staleProps(isStale, "flex flex-col gap-4 px-4 py-4")}>
      <Readout>
        <Figure label="Tracked" value={formatTotal(breakdown.totalMs, display)} />
        <Figure
          label="Billable"
          value={formatTotal(breakdown.billableMs, display)}
          note={`of ${formatTotal(breakdown.totalMs, display)}`}
        />
        {/*
          NO AMOUNT AT ALL when none of it could be priced — never "$0.00".
          A rate of zero is priced (pro bono is a decision somebody made) and
          still renders its amount; a rate nobody has set does not.
        */}
        <Figure
          label="Earned"
          value={unpricedAll ? "—" : formatMoney(breakdown.billableCents, currency)}
          money={!unpricedAll}
          note={
            unpricedAll
              ? "no rate set"
              : unpricedSome
                ? `${formatTotal(breakdown.unratedBillableMs, display)} unpriced`
                : undefined
          }
        />
        <Figure
          label={breakdown.count === 1 ? "Entry" : "Entries"}
          value={String(breakdown.count)}
          note={
            breakdown.runningCount > 0 ? "one still running, not counted" : undefined
          }
        />
      </Readout>

      {breakdown.truncated ? (
        <p role="alert" className="text-sm text-alarm">
          This period is too large to total exactly — every figure and every bar
          below is a floor, not the real total. Narrow the dates.
        </p>
      ) : null}

      <ChartFrame
        title={granularity === "day" ? "Time per day" : `Time per ${granularity}`}
        caption={
          heaviest === null
            ? undefined
            : `Busiest: ${heaviest.title}, ${formatTotal(heaviest.totalMs, display)}`
        }
      >
        <DailyChart buckets={buckets} granularity={granularity} display={display} />
      </ChartFrame>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title="Where the time went"
          caption={`${breakdown.projects.length} ${
            breakdown.projects.length === 1 ? "project" : "projects"
          } in this period`}
        >
          <ProjectChart
            projects={breakdown.projects}
            display={display}
            currency={currency}
          />
        </ChartFrame>

        <ChartFrame
          title="When you work"
          caption="Tracked time by the hour an entry started in"
        >
          <HoursChart hours={breakdown.hours} display={display} use12Hour={use12Hour} />
        </ChartFrame>
      </div>

      {/*
        Only when there is money to draw. An earnings chart flat on zero for a
        fortnight of unbilled work is a panel that says nothing, and reads as a
        product telling someone their work was worthless.
      */}
      {breakdown.billableMs > 0 && !unpricedAll ? (
        <ChartFrame
          title="Earned"
          caption="Running total across the period"
          aside={
            unpricedSome ? (
              <p className="max-w-64 text-right text-xs text-muted-foreground">
                {formatTotal(breakdown.unratedBillableMs, display)} of billable time
                is unpriced and is not in this line.
              </p>
            ) : undefined
          }
        >
          <EarningsChart buckets={buckets} currency={currency} />
        </ChartFrame>
      ) : null}
    </div>
  )
}

/**
 * The figures, as an instrument readout rather than a row of cards.
 *
 * One hairline-separated strip, left-flush, at the page's own gutter — DESIGN.md
 * rejects the hero-metric template, and a card per number with its own border,
 * padding and icon is exactly that template. Here the numbers sit on the page's
 * ground with nothing framing them, which is also how the timer bar presents
 * its totals.
 */
function Readout({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-edge-soft py-3 sm:grid-cols-4">
      {children}
    </dl>
  )
}

function Figure({
  label,
  value,
  note,
  money = false,
}: {
  label: string
  value: string
  note?: string
  /** The Two Temperatures Rule: brass is a currency amount, and nothing else.
   *  A billable DURATION is time that will become money, so it stays in ink. */
  money?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`tabular text-xl leading-tight ${money ? "text-brass" : "text-foreground"}`}
      >
        {value}
      </dd>
      {note === undefined ? null : (
        <p className="truncate text-xs text-muted-foreground">{note}</p>
      )}
    </div>
  )
}
