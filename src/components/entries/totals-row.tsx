import { formatClock } from "@shared/duration"
import { cn } from "@/lib/utils"

/**
 * Today and this week — the only two numbers a freelancer checks all day.
 *
 * A sentence-weight row, not a dashboard. The moment this becomes four bordered
 * cards with large numerals it has changed the page's genre, and readers skim
 * prose that sits below a metrics row. DESIGN.md rules that out by name.
 */
export function TotalsRow({
  todayMs,
  weekMs,
  billableMs,
  className,
}: {
  todayMs: number
  weekMs: number
  billableMs: number
  className?: string
}) {
  return (
    <div
      className={cn(
        // A tighter gap on narrow screens, so "Today" and "This week" share a
        // line at 375px instead of each taking one.
        "flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 text-sm sm:gap-x-6",
        className
      )}
    >
      <Total label="Today" value={todayMs} />
      <Total label="This week" value={weekMs} />
      {billableMs > 0 ? (
        // Brass is money — The Two Temperatures Rule. The word "billable"
        // carries it too, so the meaning survives without colour.
        <Total label="Billable" value={billableMs} tone="brass" />
      ) : null}
    </div>
  )
}

function Total({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: "brass"
}) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-medium tabular",
          tone === "brass" ? "text-brass" : "text-foreground"
        )}
      >
        {formatClock(value)}
      </span>
    </span>
  )
}
