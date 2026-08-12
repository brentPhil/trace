import { ChevronLeft, ChevronRight } from "lucide-react"
import { DateRangePicker } from "@/components/history/date-range-picker"
import { Button } from "@/components/ui/button"
import { formatTotal } from "@/lib/format-total"
import { staleProps } from "@/lib/stale"
import {
  TIMER_PRESET_LABELS,
  activePreset,
  presetsFor,
  rangePillLabel,
  rangeSpokenLabel,
} from "@/lib/timer-range"
import { cn } from "@/lib/utils"
import type { CalendarSize } from "@/lib/calendar-label"
import type { DurationDisplay } from "@/lib/format-total"
import type { DayRange, TimerPreset, TimerRange } from "@/lib/timer-range"
import type { DayString } from "@shared/day"

/** The size select's options, in the order it lists them. */
const SIZES: Array<{ value: CalendarSize; label: string }> = [
  { value: "week", label: "Week view" },
  { value: "5day", label: "5 days view" },
  { value: "day", label: "Day view" },
]

/**
 * What each size's arrows step by, in the word a screen reader hears.
 *
 * A `Record`, so the type checker requires every `CalendarSize` to have one and
 * the lookup is exact. It was a `.find()` over the list above with a
 * `?? "week"` fallback — a scan for a key that is always present, and a branch
 * that could not be reached or tested. Adding a fourth size now fails the
 * typecheck here rather than silently defaulting to "week".
 */
const STEP_UNIT: Record<CalendarSize, string> = {
  week: "week",
  // Mon–Fri is the week with its weekend hidden, so its arrows move seven days.
  // See `stepRange`.
  "5day": "week",
  day: "day",
}

/**
 * /timer's range bar: `‹ [📅 08/10/2026 - 08/16/2026] ›`, plus what the
 * calendar alone needs.
 *
 * ON SCREEN IN BOTH VIEWS, which is the change that reshaped this file. It used
 * to be `CalendarHeader` — a bare stepper that existed only while the grid did,
 * carrying a label the grid had reported. The range bounds the LIST now as well
 * as the grid, so it outlives the grid, and the label it shows is computed by
 * the page rather than reported by anything.
 *
 * The two controls answer different questions and are deliberately not merged.
 * The PICKER says WHERE — one click for a preset, two for anything else. The
 * size select says HOW WIDE, which is the number of columns and the distance
 * the arrows step. A preset sets both at once, because "Today" on a grid means
 * one column and not this week with today somewhere inside it.
 *
 * `TotalsRow` above this bar does not move with it. Today and this week are
 * facts about the clock, not properties of what is being looked at — so
 * stepping back to July must not make the page's "today" figure describe July.
 * Two numbers that mean different things sitting side by side pretending to be
 * the same one is how a freelancer bills the wrong week.
 */
export function RangeBar({
  view,
  range,
  size,
  today,
  weekStartDay,
  rangeMs,
  display,
  isStale = false,
  onStep,
  onRangeChange,
  onPresetChange,
  onSizeChange,
}: {
  view: "calendar" | "list"
  /** `null` is "All dates" — see `TimerRange`. */
  range: TimerRange
  size: CalendarSize
  today: DayString
  weekStartDay: number
  /** The RANGE's total, shown beside the grid only. */
  rangeMs: number
  display: DurationDisplay
  /** Whether `rangeMs` is the PREVIOUS range's total, carried across a refetch
   *  by `placeholderData`. The label beside it already names the new range, so
   *  a stale figure here is two spans presented as one — the same failure the
   *  label's own derivation exists to prevent. Dimmed and said out loud. */
  isStale?: boolean
  onStep: (delta: -1 | 1) => void
  onRangeChange: (range: DayRange) => void
  onPresetChange: (preset: TimerPreset) => void
  onSizeChange: (size: CalendarSize) => void
}) {
  /*
   * What the arrows are called.
   *
   * A 5-day range steps by a whole WEEK, because it is the week view with its
   * weekend hidden — so the unit a screen reader hears has to say "week" too
   * (see `stepRange`). In List there is no grid and no size: the thing that
   * moves is the range itself, whatever span the user picked.
   */
  const unit = view === "calendar" ? STEP_UNIT[size] : "range"

  // No range, nothing to step. "All dates" already reaches every entry in both
  // directions, so an arrow here would either do nothing or silently bound a
  // selection the user did not make — and a control that looks pressable and is
  // not is worse than one that says it is disabled.
  const stepDisabled = range === null

  const presets = presetsFor(view).map((preset) => ({
    value: preset,
    label: TIMER_PRESET_LABELS[preset],
  }))

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Previous ${unit}`}
          className="size-7"
          disabled={stepDisabled}
          onClick={() => onStep(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>

        <DateRangePicker
          from={range?.from ?? null}
          to={range?.to ?? null}
          today={today}
          weekStartDay={weekStartDay}
          // Digits for the eye, prose for the ear. See `rangeSpokenLabel`.
          label={rangePillLabel(range)}
          spokenLabel={rangeSpokenLabel(
            range,
            view === "calendar" ? size : null,
            today
          )}
          // ONE month, against /reports' two. The rail takes the width the
          // second month would have had, and a range picked here is nearly
          // always a week or less — the spans this page steps through.
          months={1}
          showWeekNumber
          presets={{
            items: presets,
            active: activePreset(range, today, weekStartDay),
            onSelect: (value) => onPresetChange(value as TimerPreset),
          }}
          onChange={onRangeChange}
        />

        <Button
          variant="ghost"
          size="icon"
          aria-label={`Next ${unit}`}
          className="size-7"
          disabled={stepDisabled}
          onClick={() => onStep(1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {/*
        THE GRID'S OWN TWO CONTROLS, and they go with the grid.

        The size select sets how many columns there are; in List there are no
        columns, and a "Week view / Day view" select above a scrolling log would
        be a control with nothing to act on. The range total is the calendar's
        answer to "how much is on this screen" — the log has no fixed screenful.
      */}
      {view === "calendar" ? (
        <>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {/* Sentence case, per The Sentence Case Rule. */}
            <span className="sr-only">Calendar range</span>
            <select
              aria-label="Calendar range"
              value={size}
              onChange={(event) =>
                onSizeChange(event.target.value as CalendarSize)
              }
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
            {/* Dimming alone is not enough — DESIGN.md: meaning is never
                carried by colour, and opacity is easy to miss on a number
                nobody is staring at. The same sentence /reports uses for the
                same state. */}
            {isStale ? <span className="italic">Updating…</span> : null}
          </span>
        </>
      ) : null}
    </div>
  )
}
