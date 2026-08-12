import { useEffect } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Chip } from "@/components/history/filter-controls"
import { DateRangePicker } from "@/components/history/date-range-picker"
import { rangeTriggerLabel } from "@/lib/date-range-picker"
import { periodFilters, stepPeriod } from "@/lib/history-filters"
import { cn } from "@/lib/utils"
import type { Filters } from "@/lib/history-filters"

/**
 * WHEN — the first thing a person narrows, and the only one of /reports'
 * filters that is not shared with /timer.
 *
 * THIS USED TO BE THE TOP THIRD OF `FilterBar`, which stacked these controls,
 * `FilterControls` and the preset chips in one column. That single component
 * could only ever land in one container, so /reports put the whole stack on
 * bare ground while /timer put the identical `FilterControls` in a Surface
 * band. Split, the page composes the two rows the way /timer already does: the
 * period row on the page's own ground beside the actions it belongs with, and
 * everything that narrows WITHIN a period inside `FilterBand`.
 *
 * Every control here is a plain form control. This is the screen where someone
 * is hunting for a specific hour they know exists, and a clever custom widget is
 * a thing to learn rather than use.
 */
export function PeriodControls({
  filters,
  today,
  weekStartDay,
  onChange,
}: {
  filters: Filters
  today: string
  weekStartDay: number
  onChange: (next: Filters | ((current: Filters) => Filters)) => void
}) {
  /*
   * Arrow keys step the period.
   *
   * It lives HERE, with the stepper buttons, because stepping the period is
   * what it does — the same action `stepPeriod` gives the two chevrons below,
   * reachable without aiming at them. It came across from `FilterBar` with the
   * controls it drives rather than staying behind with the filters it does not
   * touch.
   *
   * Bound at the document so they work wherever the eye is — but suppressed
   * while focus is in a text field, a select, or anything contenteditable,
   * where `←` and `→` mean "move the caret". Stealing them there would make
   * the search box unusable, which is the control most likely to have focus.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return
      }
      event.preventDefault()
      onChange((current) => stepPeriod(current, event.key === "ArrowLeft" ? -1 : 1))
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onChange])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5">
        <IconButton
          label="Previous period"
          onClick={() => onChange((f) => stepPeriod(f, -1))}
        >
          <ChevronLeft className="size-4" />
        </IconButton>
        <IconButton label="Next period" onClick={() => onChange((f) => stepPeriod(f, 1))}>
          <ChevronRight className="size-4" />
        </IconButton>
      </div>

      <div className="flex items-center gap-1">
        {(["day", "week", "month"] as const).map((period) => (
          <Chip
            key={period}
            active={filters.period === period}
            onClick={() => onChange((f) => periodFilters(period, today, weekStartDay, f))}
          >
            {period === "day" ? "Day" : period === "week" ? "Week" : "Month"}
          </Chip>
        ))}
      </div>

      {/* The trigger's WORDS are this page's, not the picker's: /reports names
          the active period ("This week") where /timer prints US dates. See
          `date-range-picker.tsx` for why that moved out to the callers. */}
      <DateRangePicker
        from={filters.from}
        to={filters.to}
        today={today}
        weekStartDay={weekStartDay}
        label={rangeTriggerLabel(
          filters.period,
          filters.from,
          filters.to,
          today,
          weekStartDay
        )}
        onChange={(range) => onChange((f) => ({ ...f, period: "custom", ...range }))}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        // `border-edge`, and this row is the reason the distinction is worth
        // keeping: it sits on the page's own GROUND, above the band, where
        // --edge measures 3.15:1. The chips beside it are fill-less and could
        // land on either layer, which is why `Chip` hard-codes --edge-raised.
        "rounded-md border border-edge p-1.5 text-muted-foreground transition-colors",
        "hover:text-foreground motion-reduce:transition-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      {children}
    </button>
  )
}
