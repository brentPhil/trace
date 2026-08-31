import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDayName } from "@/lib/format-time"
import { addMonths, monthGrid, monthLabel, weekdayLabels } from "@/lib/month-grid"
import { cn } from "@/lib/utils"
import type { DayString } from "@shared/day"

/**
 * The body of a time popover: Start, Stop, an error line, and a month
 * calendar.
 *
 * Extracted out of `EntryTimePopover` so the timer bar's duration can reuse
 * every pixel of it. The two callers disagree about what a field COMMITS —
 * the row edits an existing entry field by field, the timer bar's idle path
 * cannot write anything until both times are known — so this component knows
 * nothing about commit semantics at all. It only reports what was typed and
 * which day was picked; the caller decides when that turns into a write.
 *
 * `running` still lives here, not hoisted to the caller, because it is the
 * one piece of layout logic every caller needs identically: no end field
 * while nothing has stopped, full stop. Duplicating that branch at each call
 * site is exactly the kind of drift this extraction exists to prevent.
 */
export function TimePopoverFields({
  running,
  startValue,
  onStartChange,
  onStartCommit,
  endValue,
  onEndChange,
  onEndCommit,
  error,
  month,
  onMonthChange,
  selectedDay,
  weekStartDay,
  onPickDay,
  footer,
}: {
  /** Hides the Stop field behind the "still running" placeholder. */
  running: boolean
  startValue: string
  onStartChange: (value: string) => void
  /** Fired on blur and on Enter — same as the old inline fields. */
  onStartCommit: () => void
  endValue: string
  onEndChange: (value: string) => void
  onEndCommit: () => void
  error: string | null
  month: DayString
  onMonthChange: (day: DayString) => void
  /** The day highlighted in the grid. Not necessarily `month`'s own day. */
  selectedDay: DayString
  /** 0 = Sunday, from userSettings. The grid and the week totals must agree. */
  weekStartDay: number
  onPickDay: (day: DayString) => void
  /** Extra content below the calendar — the idle path's confirm button. */
  footer?: React.ReactNode
}) {
  const weeks = monthGrid(month, weekStartDay)

  return (
    <>
      <div className="grid grid-cols-2 gap-2 border-b border-border p-3">
        <Field label="Start">
          <input
            aria-label="Start time"
            value={startValue}
            inputMode="numeric"
            onChange={(event) => onStartChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onStartCommit()
            }}
            onBlur={onStartCommit}
            className={inputClass}
          />
        </Field>

        <Field label="Stop">
          {running ? (
            // No end exists yet. A field here would invite typing one, which
            // is a stop — and stopping belongs to the button that says Stop.
            <span
              className="flex h-8 items-center px-2 text-sm text-muted-foreground"
              title="Still running"
            >
              …
            </span>
          ) : (
            <input
              aria-label="End time"
              value={endValue}
              inputMode="numeric"
              onChange={(event) => onEndChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onEndCommit()
              }}
              onBlur={onEndCommit}
              className={inputClass}
            />
          )}
        </Field>

        {error === null ? null : (
          <p role="alert" className="col-span-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between pb-2">
          <span className="text-sm font-medium">{monthLabel(month)}</span>
          <div className="flex items-center gap-1">
            <MonthButton
              label="Previous month"
              onClick={() => onMonthChange(addMonths(month, -1))}
            >
              <ChevronLeft className="size-4" />
            </MonthButton>
            <MonthButton
              label="Next month"
              onClick={() => onMonthChange(addMonths(month, 1))}
            >
              <ChevronRight className="size-4" />
            </MonthButton>
          </div>
        </div>

        {/*
          A real table. A date grid IS font-mono tabular-nums tracking-[-0.02em] — the column a cell sits in
          carries its weekday — and `<th scope="col">` is what tells a screen
          reader that without a word of ARIA.
        */}
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {weekdayLabels(weekStartDay).map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="pb-1 text-center text-[0.6875rem] font-normal text-muted-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.find((d) => d !== null) ?? "pad"}>
                {week.map((day, index) => (
                  <td key={day ?? `pad-${index}`} className="p-0.5 text-center">
                    {day === null ? null : (
                      <DayCell
                        day={day}
                        selected={day === selectedDay}
                        onPick={() => onPickDay(day)}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {footer}
      </div>
    </>
  )
}

const inputClass = cn(
  "font-mono tabular-nums tracking-[-0.02em] h-8 w-full rounded-md border border-input bg-background px-2 text-sm",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
)

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </div>
  )
}

function MonthButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      onClick={onClick}
      // `border-input`: this is a control, so it takes the control half of The
      // Boundary Split rather than the divider. It carries no fill of its own
      // and sits inside a popover, which is exactly the case the split exists
      // for. The base variant ships `border border-transparent`, so this only
      // sets the colour.
      className="border-input"
    >
      {children}
    </Button>
  )
}

function DayCell({
  day,
  selected,
  onPick,
}: {
  day: DayString
  selected: boolean
  onPick: () => void
}) {
  const [year, month, date] = day.split("-").map(Number)
  // "Wednesday 12 August 2026" — shared with `ui/calendar.tsx`, the app's
  // other date grid, so the two cannot disagree about how a day reads out.
  const label = formatDayName(year, month, date)

  return (
    // `default` when selected is NOT the running accent: this marks which DAY is
    // selected in a date picker, not whether anything is running — a popover
    // opened on a completed entry would otherwise show the running accent beside a
    // dash where the end time goes. The variant's `bg-primary` /
    // `text-primary-foreground` is the same "affirmative action, deliberately
    // not enlarger" treatment the start/stop button itself uses when idle.
    //
    // `quiet` when not, rather than `ghost`: ghost carries a
    // `dark:hover:bg-muted/50` that outranks a plain `hover:bg-*` override,
    // and this grid wants the popover's own tone under the cursor.
    <Button
      type="button"
      variant={selected ? "default" : "ghost"}
      size="icon-sm"
      aria-pressed={selected}
      aria-label={label}
      onClick={onPick}
      className={cn(
        "font-mono tabular-nums tracking-[-0.02em]",
        selected ? "font-medium" : "text-foreground hover:bg-popover"
      )}
    >
      {date}
    </Button>
  )
}
