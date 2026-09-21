import { HATCH_EMPTY } from "@/lib/hatch"
import { cn } from "@/lib/utils"
import { formatCompactDuration } from "@shared/duration"
import { lineAmountCents } from "@shared/invoiceMath"
import { formatMoney } from "@shared/money"
import { WEEK } from "../sample-data"
import { staggerDelay, useCountProgress, useReveal } from "../use-reveal"

const CENTI_MS = 36_000

/**
 * MIRRORS src/components/reports/summary-panel.tsx's readout — four
 * label-figure pairs between two hairlines, on the page's own background,
 * NOT tiles — and the daily chart's monochrome bars, with the empty day
 * hatched rather than left as bare axis (DESIGN.md §5 Charts).
 *
 * Earned is priced with `lineAmountCents`, the rule /reports and the invoice
 * share since 89d7b64.
 *
 * ON REVEAL THE WEEK ADDS UP: the four figures count to their values while the
 * bars rise from the baseline, Monday first. Every intermediate figure is a
 * real format of a real quantity (the amount is still `lineAmountCents` of the
 * hours shown), so no frame prints a number the app could not.
 */
export function ReportReadoutFragment({ className }: { className?: string }) {
  const [ref, reveal] = useReveal<HTMLDivElement>()
  const progress = useCountProgress(reveal)
  const trackedMs = WEEK.days.reduce((sum, d) => sum + d.ms, 0)
  const billableCentis = Math.round(WEEK.billableCentis * progress)
  const maxMs = Math.max(...WEEK.days.map((d) => d.ms))
  const figures = [
    { label: "Tracked", value: formatCompactDuration(trackedMs * progress) },
    {
      label: "Billable",
      value: formatCompactDuration(billableCentis * CENTI_MS),
    },
    {
      label: "Earned",
      value: formatMoney(
        lineAmountCents(billableCentis, WEEK.rateCents),
        "USD"
      ),
    },
    { label: "Entries", value: String(Math.round(WEEK.entryCount * progress)) },
  ]

  return (
    <div
      ref={ref}
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
      {/* Slim bars on a baseline, not slabs: at column width a bar outweighs
          the figures above it, and this strip is supporting evidence. */}
      <div className="flex h-32 items-stretch gap-3">
        {WEEK.days.map((d, i) => (
          <div
            key={d.label}
            className="flex flex-1 flex-col items-center justify-end gap-1.5"
          >
            {d.ms === 0 ? (
              <div
                data-hatched
                className={cn(HATCH_EMPTY, "h-2 w-full max-w-8 rounded-sm")}
              />
            ) : (
              <div
                className={cn(
                  "w-full max-w-8 origin-bottom rounded-sm bg-foreground/70",
                  reveal === "pending" && "scale-y-0",
                  reveal === "in" &&
                    "animate-landing-grow-y motion-reduce:animate-none"
                )}
                style={{
                  height: `${(d.ms / maxMs) * 100}px`,
                  ...(reveal === "in" ? staggerDelay(i, 90, 150) : {}),
                }}
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
