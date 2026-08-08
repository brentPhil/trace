import { useEffect, useState } from "react"
import { Popover } from "@/components/ui/popover"
import { TimePopoverFields } from "@/components/entries/time-popover-fields"
import {
  formatTimeOfInstant,
  formatTimeRange,
  instantOfTypedTime,
  localMinutesOf,
} from "@/lib/format-time"
import { cn } from "@/lib/utils"
import { forceClosePopover, usePopoverActionsRef } from "@/lib/popover-force-close"
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
 *
 * The calendar, fields and their helpers live in `TimePopoverFields`; this
 * component owns only EDIT semantics — seeding from an existing entry and
 * committing each field the moment it is typed. The timer bar's duration
 * reuses the same body for a running entry's start (via the `trigger`
 * override below) and for a from-scratch create, which cannot commit until
 * both times are known — see `TimerDurationPopover`.
 */
export function EntryTimePopover({
  entry,
  timeZone,
  use12Hour,
  weekStartDay,
  onCommitTime,
  onCommitDay,
  className,
  trigger,
}: {
  entry: Entry
  timeZone: string
  use12Hour: boolean
  /** 0 = Sunday, from userSettings. The grid and the week totals must agree. */
  weekStartDay: number
  onCommitTime: (field: "start" | "end", instantMs: number) => Promise<void>
  /**
   * The DAY, not an instant. Resolving a date against the entry's own local
   * time-of-day needs the stored zone and a DST policy, and the caller owns
   * both — along with the undo that has to put the entry back.
   */
  onCommitDay: (day: DayString) => Promise<void>
  className?: string
  /**
   * Overrides the default time-range button. The timer bar renders the
   * elapsed duration in its place, so a timer running there can be edited
   * without a second calendar implementation. Must already be a full
   * interactive element — Base UI's `render` prop merges the trigger's own
   * behaviour onto whatever is passed here, the same as `Popover.Trigger`
   * always does.
   */
  trigger?: React.ReactElement
}) {
  const entryDay = dayOf(entry.startedAt, timeZone)
  const startMinutes = localMinutesOf(entry.startedAt, timeZone)
  const running = entry.endedAt === null

  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState<DayString>(entryDay)
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [error, setError] = useState<string | null>(null)
  const actionsRef = usePopoverActionsRef()

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

  return (
    <Popover.Root open={open} onOpenChange={setOpen} actionsRef={actionsRef}>
      <Popover.Trigger
        render={
          trigger ?? (
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
          )
        }
      />

      <Popover.Popup className="w-[19.5rem] gap-0 p-0">
        <TimePopoverFields
          running={running}
          startValue={start}
          onStartChange={setStart}
          onStartCommit={() => commitTime("start", start)}
          endValue={end}
          onEndChange={setEnd}
          onEndCommit={() => commitTime("end", end)}
          error={error}
          month={month}
          onMonthChange={setMonth}
          selectedDay={entryDay}
          weekStartDay={weekStartDay}
          onPickDay={(day) => {
            setOpen(false)
            forceClosePopover(actionsRef)
            void onCommitDay(day)
          }}
        />
      </Popover.Popup>
    </Popover.Root>
  )
}
