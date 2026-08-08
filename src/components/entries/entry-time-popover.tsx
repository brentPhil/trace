import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Popover } from "@/components/ui/popover"
import {
  formatTimeOfInstant,
  formatTimeRange,
  instantOfTypedTime,
  localMinutesOf,
} from "@/lib/format-time"
import {
  addMonths,
  monthGrid,
  monthLabel,
  weekdayLabels,
} from "@/lib/month-grid"
import { cn } from "@/lib/utils"
import { dayOf } from "@shared/day"
import { parseTimeOfDay, resolveEndAfterStart } from "@shared/timeOfDay"
import type { DayString } from "@shared/day"
import type { Entry } from "@/lib/group-entries"

const TIME_HELP = "Try 9:15, 0915, or 2pm."

/**
 * Start, stop and the date, in one control.
 *
 * Replaces the two inline text fields the row used to carry. Those could not
 * express a DATE at all — they pinned `dayOffset: 0` on purpose, because a
 * typed time silently moving an entry to another day is exactly the kind of
 * guess this product does not make. A calendar is not silent, so the capability
 * arrives with something to look at.
 *
 * Text fields, not steppers or a masked input. `0915` and `2pm` are why the old
 * fields were quick, and `parseTimeOfDay` is kept for precisely that; a
 * calendar must not cost the fast path.
 *
 * It also unhides the control below `sm`, where the inline fields were
 * `hidden` outright — times were simply not editable on a phone.
 */
export function EntryTimePopover({
  entry,
  timeZone,
  use12Hour,
  weekStartDay,
  onCommitTime,
  onCommitDay,
  className,
}: {
  entry: Entry
  timeZone: string
  use12Hour: boolean
  /** 0 = Sunday, from userSettings. The grid and the week totals must agree. */
  weekStartDay: number
  onCommitTime: (field: "start" | "end", instantMs: number) => Promise<void>
  /**
   * The DAY, not an instant. Resolving a date against the entry's local
   * time-of-day needs the stored zone and a DST policy, and the caller owns
   * both — along with the undo that has to put the entry back.
   */
  onCommitDay: (day: DayString) => Promise<void>
  className?: string
}) {
  const entryDay = dayOf(entry.startedAt, timeZone)
  const startMinutes = localMinutesOf(entry.startedAt, timeZone)
  const running = entry.endedAt === null

  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState<DayString>(entryDay)
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [error, setError] = useState<string | null>(null)

  /*
   * Re-seed every time it OPENS, not once at mount.
   *
   * The row behind this can change underneath it — a resume, a stop, another
   * tab — and a field seeded at mount would offer a stale time as though the
   * user had typed it. The same reason ManualEntryDialog re-seeds its day.
   */
  useEffect(() => {
    if (!open) return
    setMonth(entryDay)
    setStart(formatTimeOfInstant(entry.startedAt, timeZone, use12Hour))
    setEnd(
      entry.endedAt === null
        ? ""
        : formatTimeOfInstant(entry.endedAt, timeZone, use12Hour)
    )
    setError(null)
  }, [open, entry.startedAt, entry.endedAt, entryDay, timeZone, use12Hour])

  const commitTime = (field: "start" | "end", raw: string) => {
    const parsed = parseTimeOfDay(raw, startMinutes)
    if (!parsed.ok) {
      setError(
        field === "start"
          ? `Start time — ${TIME_HELP}`
          : `End time — ${TIME_HELP}`
      )
      return
    }
    setError(null)

    // A start belongs to the day it is filed under; the calendar is what moves
    // an entry, not a typed time. An END earlier in the clock than the start is
    // the ordinary overnight case, anchored to the start's day.
    const time =
      field === "start"
        ? { minutes: parsed.time.minutes, dayOffset: 0 }
        : resolveEndAfterStart(parsed.time, {
            minutes: startMinutes,
            dayOffset: 0,
          })

    void onCommitTime(
      field,
      instantOfTypedTime(entry.startedAt, time, timeZone)
    ).catch((thrown: unknown) => {
      setError(thrown instanceof Error ? thrown.message : "That didn't save.")
    })
  }

  const weeks = monthGrid(month, weekStartDay)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <button
            type="button"
            aria-label={`Edit times — ${formatTimeRange(entry.startedAt, entry.endedAt, timeZone, use12Hour)}`}
            className={cn(
              "tabular shrink-0 rounded-sm px-1 py-0.5 text-xs text-muted-foreground",
              "transition-colors hover:bg-surface-raised/70 hover:text-foreground",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              className
            )}
          >
            {formatTimeRange(
              entry.startedAt,
              entry.endedAt,
              timeZone,
              use12Hour
            )}
          </button>
        }
      />

      <Popover.Popup className="w-[19.5rem] gap-0 p-0">
        <div className="grid grid-cols-2 gap-2 border-b border-edge-soft p-3">
          <Field label="Start">
            <input
              aria-label="Start time"
              value={start}
              inputMode="numeric"
              onChange={(event) => setStart(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitTime("start", start)
              }}
              onBlur={() => commitTime("start", start)}
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
                value={end}
                inputMode="numeric"
                onChange={(event) => setEnd(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitTime("end", end)
                }}
                onBlur={() => commitTime("end", end)}
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
                onClick={() => setMonth(addMonths(month, -1))}
              >
                <ChevronLeft className="size-4" />
              </MonthButton>
              <MonthButton
                label="Next month"
                onClick={() => setMonth(addMonths(month, 1))}
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
                    <td
                      key={day ?? `pad-${index}`}
                      className="p-0.5 text-center"
                    >
                      {day === null ? null : (
                        <DayCell
                          day={day}
                          selected={day === entryDay}
                          onPick={() => {
                            setOpen(false)
                            void onCommitDay(day)
                          }}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Popover.Popup>
    </Popover.Root>
  )
}

const inputClass = cn(
  "tabular h-8 w-full rounded-md border border-edge-soft bg-ground px-2 text-sm",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
)

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
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
  const label = dayNameFormatter.format(
    new Date(Date.UTC(year, month - 1, date, 12))
  )

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
