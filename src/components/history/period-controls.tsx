import { useEffect } from "react"
import { RangeStepper } from "@/components/history/range-stepper"
import {
  REPORTS_DEFAULT_PRESET,
  REPORTS_PRESETS,
  REPORTS_PRESET_LABELS,
  activeReportsPreset,
  rangeTriggerLabel,
  reportsPresetFilters,
} from "@/lib/date-range-picker"
import { stepPeriod } from "@/lib/history-filters"
import type { ReportsPreset } from "@/lib/date-range-picker"
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

  /*
    THE DAY / WEEK / MONTH CHIPS ARE GONE, removed 2026-08-12 at the user's
    request. They set the range by a coarser name than the picker's own rail
    already does — This week, This month, This quarter, This year — so they were
    a second control for one thing, and the one that could say less.

    THE ARROWS AND THE PILL now come from `RangeStepper`, shared with /timer.
    They were the same three parts in the same order on both pages, drawn with
    different buttons and printing a different date format; this page's version
    is the one that survived.

    `stepPeriod` still steps by whatever the current range's WIDTH is, so the
    arrows keep working for a quarter or a year even though no chip names those.
    The ← / → document binding above is unchanged and stays HERE rather than
    moving into the shared control: it is a page-level key binding on the
    document, and /timer's grid has its own claim on the arrow keys.
  */
  return (
    <RangeStepper
      from={filters.from}
      to={filters.to}
      today={today}
      weekStartDay={weekStartDay}
      stepUnit="period"
      /* The trigger's WORDS are this page's, not the picker's: /reports names
         the active period ("This week") and falls back to a prose range. See
         `date-range-picker.tsx` for why that moved out to the callers. */
      label={rangeTriggerLabel(
        filters.period,
        filters.from,
        filters.to,
        today,
        weekStartDay
      )}
      /* The RAIL is this page's too, and it is a different list from /timer's:
         quarters and years are the spans a freelancer reports and invoices on,
         and "All dates" is not a range this page can scan. Two months — the
         default — because there is room for them here; /timer forces one to
         leave the rail its width. */
      presets={{
        items: REPORTS_PRESETS.map((preset) => ({
          value: preset,
          label: REPORTS_PRESET_LABELS[preset],
          badge: preset === REPORTS_DEFAULT_PRESET ? "Default" : undefined,
        })),
        active: activeReportsPreset(filters.from, filters.to, today, weekStartDay),
        onSelect: (value) =>
          onChange((f) =>
            reportsPresetFilters(value as ReportsPreset, today, weekStartDay, f)
          ),
      }}
      onStep={(delta) => onChange((f) => stepPeriod(f, delta))}
      onChange={(range) => onChange((f) => ({ ...f, period: "custom", ...range }))}
    />
  )
}
