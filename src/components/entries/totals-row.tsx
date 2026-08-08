import { formatTotal } from "@/lib/format-total"
import { cn } from "@/lib/utils"
import type { DurationDisplay } from "@/lib/format-total"

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
  display = "hms",
  className,
}: {
  todayMs: number
  weekMs: number
  billableMs: number
  /** Totals are one of the two places decimal hours apply. See format-total. */
  display?: DurationDisplay
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
      <Total label="Today" value={todayMs} display={display} />
      <Total label="This week" value={weekMs} display={display} />
      {billableMs > 0 ? (
        // Brass is money — The Two Temperatures Rule. The word "billable"
        // carries it too, so the meaning survives without colour.
        <Total label="Billable" value={billableMs} display={display} tone="brass" />
      ) : null}
    </div>
  )
}

function Total({
  label,
  value,
  display,
  tone,
}: {
  label: string
  value: number
  display: DurationDisplay
  tone?: "brass"
}) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        // A total that includes a RUNNING entry is time-dependent text: the
        // server renders it from the server's `Date.now()` and the client
        // rehydrates from its own, so with a timer going they differ by however
        // long the payload took to arrive — a hydration error and a re-render
        // of the subtree, essentially every load. `EntryDuration` already
        // carries this for the same reason; the aggregate needs it too.
        suppressHydrationWarning
        className={cn(
          "font-medium tabular",
          tone === "brass" ? "text-brass" : "text-foreground"
        )}
      >
        {formatTotal(value, display)}
      </span>
    </span>
  )
}

