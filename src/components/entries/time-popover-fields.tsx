import { ChevronLeft, ChevronRight } from "lucide-react"
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
      <div className="grid grid-cols-2 gap-2 border-b border-edge-soft p-3">
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
          <p role="alert" className="col-span-2 text-xs text-alarm">
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
          A real table. A date grid IS tabular — the column a cell sits in
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
  "tabular h-8 w-full rounded-md border border-edge-soft bg-ground px-2 text-sm",
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
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "rounded-md border border-edge-soft p-1 text-muted-foreground",
        "transition-colors hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      )}
    >
      {children}
    </button>
  )
}

/** Formats a day for a screen reader: "Wednesday 12 August 2026". */
const dayNameFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
})

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
  // Formatted from a UTC noon instant: the calendar date is already decided,
  // and noon is far enough from either boundary that no zone can shift the
  // rendered weekday off it. Same trick as the day headers in the log.
  const label = dayNameFormatter.format(new Date(Date.UTC(year, month - 1, date, 12)))

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      onClick={onPick}
      className={cn(
        "tabular size-8 rounded-md text-sm transition-colors",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected
          ? "bg-enlarger font-medium text-ground"
          : "text-foreground hover:bg-surface-raised"
      )}
    >
      {date}
    </button>
  )
}
