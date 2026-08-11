import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { calendarLabel } from "@/lib/calendar-label"
import { formatTotal } from "@/lib/format-total"
import { staleProps } from "@/lib/stale"
import { cn } from "@/lib/utils"
import type { CalendarSize } from "@/lib/calendar-label"
import type { DurationDisplay } from "@/lib/format-total"
import type { DayString } from "@shared/day"

const SIZES: Array<{ value: CalendarSize; label: string; unit: string }> = [
  { value: "week", label: "Week view", unit: "week" },
  { value: "5day", label: "5 days view", unit: "week" },
  { value: "day", label: "Day view", unit: "day" },
]

/**
 * The calendar's own range bar.
 *
 * It carries the RANGE total, and `TotalsRow` above it does not change. Today
 * and this-week are ambient facts about the clock, not properties of what the
 * calendar happens to be showing — so stepping back to July must not make the
 * page's "today" figure describe July. Two numbers that mean different things
 * sitting side by side pretending to be the same one is how a freelancer bills
 * the wrong week.
 */
export function CalendarHeader({
  firstDay,
  lastDay,
  size,
  today,
  rangeMs,
  display,
  isStale = false,
  onStep,
  onToday,
  onSizeChange,
}: {
  firstDay: DayString
  lastDay: DayString
  size: CalendarSize
  today: DayString
  rangeMs: number
  display: DurationDisplay
  /** Whether `rangeMs` is the PREVIOUS range's total, carried across a refetch
   *  by `placeholderData`. The label beside it already names the new range, so
   *  a stale figure here is two spans presented as one — the same failure the
   *  label's own derivation exists to prevent. Dimmed and said out loud. */
  isStale?: boolean
  onStep: (delta: -1 | 1) => void
  onToday: () => void
  onSizeChange: (size: CalendarSize) => void
}) {
  // A 5-day range steps by a whole week, because it IS the week view with the
  // weekend hidden — so the unit a screen reader hears must say "week" too.
  const unit = SIZES.find((s) => s.value === size)?.unit ?? "week"

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        className={cn(
          "flex items-center gap-1 rounded-md border border-edge-raised",
          "bg-ground px-1 py-0.5"
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Previous ${unit}`}
          className="size-7"
          onClick={() => onStep(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>

        {/* The label is a BUTTON: pressing the thing that says "This week"
            to get back to this week is the gesture people already try. */}
        <button
          type="button"
          onClick={onToday}
          className={cn(
            "tabular rounded px-2 py-1 text-sm text-foreground",
            "hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring",
            "focus-visible:outline-none"
          )}
        >
          {calendarLabel(firstDay, lastDay, size, today)}
        </button>

        <Button
          variant="ghost"
          size="icon"
          aria-label={`Next ${unit}`}
          className="size-7"
          onClick={() => onStep(1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        {/* Sentence case, per The Sentence Case Rule. */}
        <span className="sr-only">Calendar range</span>
        <select
          aria-label="Calendar range"
          value={size}
          onChange={(event) => onSizeChange(event.target.value as CalendarSize)}
          className={cn(
            "rounded-md border border-edge-raised bg-ground px-2 py-1.5",
            "text-sm text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <span
        {...staleProps(
          isStale,
          "ml-auto flex items-baseline gap-2 text-xs text-muted-foreground"
        )}
      >
        Range total
        {/* The Tabular Rule. */}
        <span className="tabular text-sm text-foreground">
          {formatTotal(rangeMs, display)}
        </span>
        {/* Dimming alone is not enough — DESIGN.md: meaning is never carried by
            colour, and opacity is easy to miss on a number nobody is staring
            at. The same sentence /reports uses for the same state. */}
        {isStale ? <span className="italic">Updating…</span> : null}
      </span>
    </div>
  )
}
