import { HATCH_EMPTY } from "@/lib/hatch"
import { cn } from "@/lib/utils"
import { formatCompactDuration } from "@shared/duration"
import { lineAmountCents } from "@shared/invoiceMath"
import { formatMoney } from "@shared/money"
import { WEEK } from "../sample-data"

const CENTI_MS = 36_000

/**
 * MIRRORS src/components/reports/summary-panel.tsx's readout — four
 * label-figure pairs between two hairlines, on the page's own background,
 * NOT tiles — and the daily chart's monochrome bars, with the empty day
 * hatched rather than left as bare axis (DESIGN.md §5 Charts).
 *
 * Earned is priced with `lineAmountCents`, the rule /reports and the invoice
 * share since 89d7b64.
 */
export function ReportReadoutFragment({ className }: { className?: string }) {
  const trackedMs = WEEK.days.reduce((sum, d) => sum + d.ms, 0)
  const maxMs = Math.max(...WEEK.days.map((d) => d.ms))
  const figures = [
    { label: "Tracked", value: formatCompactDuration(trackedMs) },
    {
      label: "Billable",
      value: formatCompactDuration(WEEK.billableCentis * CENTI_MS),
    },
    {
      label: "Earned",
      value: formatMoney(
        lineAmountCents(WEEK.billableCentis, WEEK.rateCents),
        "USD"
      ),
    },
    { label: "Entries", value: String(WEEK.entryCount) },
  ]

  return (
    <div
      data-landing-fragment="report"
      inert
      className={cn("flex flex-col gap-6", className)}
    >
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-border py-3 sm:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className="font-mono text-xl leading-tight tracking-[-0.02em] text-foreground tabular-nums">
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex h-32 items-stretch gap-3">
        {WEEK.days.map((d) => (
          <div
            key={d.label}
            className="flex flex-1 flex-col justify-end gap-1.5"
          >
            {d.ms === 0 ? (
              <div
                data-hatched
                className={cn(HATCH_EMPTY, "h-2 w-full rounded-sm")}
              />
            ) : (
              <div
                className="w-full rounded-sm bg-foreground/80"
                style={{ height: `${(d.ms / maxMs) * 100}px` }}
              />
            )}
            <span className="text-center text-xs text-muted-foreground">
              {d.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
