import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/history/date-range-picker"
import type { DayString } from "@shared/day"

/**
 * `‹ [📅 This week] ›` — the range control, once, for both pages that have one.
 *
 * /timer and /reports each grew their own, and they had already converged on
 * the same three parts in the same order: a back arrow, the picker's pill, a
 * forward arrow. What had NOT converged was everything around them — /reports
 * drew `quiet`/`icon-row` buttons with `border-border`, /timer drew `ghost`/`icon`
 * ones sized `size-7`, and the pill between them printed prose on one page and
 * US digits on the other. One control, two appearances, depending on which tab
 * you were looking at.
 *
 * This is /reports' version, which is the one that reads: the arrows hug the
 * pill so the three parts read as one control — a range, and the two ways to
 * move it — rather than as three.
 *
 * WHAT STAYS WITH THE CALLER is everything the two pages genuinely disagree
 * about, which is only ever data: the preset rail, since /timer's list is about
 * a time grid and /reports' is about the spans a freelancer invoices on; the
 * label; how many months the popover shows; and what an arrow means. None of
 * those are appearance, and none of them could be unified without one page
 * losing something it needs.
 */
export function RangeStepper({
  from,
  to,
  today,
  weekStartDay,
  label,
  spokenLabel,
  months,
  presets,
  stepUnit,
  stepDisabled = false,
  onStep,
  onChange,
}: {
  /** `null` on both when nothing is bounded — /timer's "All dates". */
  from: DayString | null
  to: DayString | null
  today: DayString
  weekStartDay: number
  label: string
  /** The accessible name, when it differs from the visible text. */
  spokenLabel?: string
  /** /timer shows one month so the preset rail keeps its width; /reports has
   *  room for two. */
  months?: 1 | 2
  presets: React.ComponentProps<typeof DateRangePicker>["presets"]
  /** The word a screen reader hears in "Previous …" — "week", "period",
   *  "range". The arrows step by different things on the two pages and the
   *  label has to say which. */
  stepUnit: string
  /** "All dates" reaches every entry in both directions, so an arrow there
   *  would either do nothing or silently bound a selection the user did not
   *  make. A control that looks pressable and is not is worse than one that
   *  says it is disabled. */
  stepDisabled?: boolean
  onStep: (delta: -1 | 1) => void
  onChange: (range: { from: DayString; to: DayString }) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <StepButton
        label={`Previous ${stepUnit}`}
        disabled={stepDisabled}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft className="size-4" />
      </StepButton>

      <DateRangePicker
        from={from}
        to={to}
        today={today}
        weekStartDay={weekStartDay}
        label={label}
        spokenLabel={spokenLabel}
        months={months}
        showWeekNumber
        presets={presets}
        onChange={onChange}
      />

      <StepButton
        label={`Next ${stepUnit}`}
        disabled={stepDisabled}
        onClick={() => onStep(1)}
      >
        <ChevronRight className="size-4" />
      </StepButton>
    </div>
  )
}

// ---------------------------------------------------------------------------

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-row"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      // `border-input`, and this is the row that makes The Boundary Split worth
      // keeping: a stepper is a control, so its edge has to clear 3:1 wherever
      // it lands — on the page here, on a band in `filter-controls.tsx` — while
      // the divider tone beside it stays deliberately under the floor.
      className="border-input motion-reduce:transition-none"
    >
      {children}
    </Button>
  )
}
