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
import { useForceCloseWhenClosed, usePopoverActionsRef } from "@/lib/popover-force-close"
import { dayOf } from "@shared/day"
import { parseEndTime, parseStartTime, timeFieldHelp } from "@shared/timeOfDay"
import type { DayString } from "@shared/day"
import type { Entry } from "@/lib/group-entries"

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
   *
   * MUST REPORT ITS OWN FAILURE. Unlike `onCommitTime`, which commits into a
   * popover that is still on screen and can show the error inline, a day pick
   * closes this popover as it fires — there is no surface left here by the
   * time the write can reject. Both implementations raise a toast; the
   * `.catch` at the call site is only the backstop that keeps a third one from
   * producing an unhandled rejection.
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
  useForceCloseWhenClosed(open, actionsRef)

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
    /*
     * `parseStartTime` and `parseEndTime`, the same two `resolveInterval` is
     * built from — but reached separately, because this popover commits ONE
     * FIELD AT A TIME as it is typed, and `resolveInterval` needs both texts
     * to answer. The start's reference is also the entry's own start rather
     * than the wall clock: this is an edit of something already filed.
     *
     * `parseStartTime` carries the "the calendar is what moves an entry"
     * clamp, and `parseEndTime` the "an end is bounded below by its start"
     * rule — which reads a bare hour as the first one after the start ("9"
     * then "5" is eight hours, not twenty) and anchors a genuinely earlier end
     * to the next day, the ordinary overnight case.
     */
    const parsed =
      field === "start"
        ? parseStartTime(raw, startMinutes)
        : parseEndTime(raw, { minutes: startMinutes, dayOffset: 0 })
    if (!parsed.ok) {
      setError(timeFieldHelp(field))
      return
    }
    setError(null)

    void onCommitTime(
      field,
      instantOfTypedTime(entry.startedAt, parsed.time, timeZone)
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
                // `touch-target`: the box is a 16px `text-xs` line plus
                // `py-0.5`, so ~20px — under WCAG 2.2 SC 2.5.8's 24px. That
                // was survivable while the control was `hidden sm:inline-flex`
                // and desktop-only; it is now the phone affordance for editing
                // a time. The class grows the hit area to 24px without growing
                // the box, which the 54px row height depends on.
                "touch-target tabular shrink-0 rounded-sm px-1 py-0.5 text-xs text-muted-foreground",
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
            // Re-picking the day already selected is not an edit. It used to
            // fire a real `editTime("day", …)` — which, before
            // `instantMovedToDay` learned to keep seconds, moved the entry by
            // up to 59.999s and dragged its end along with it — and then
            // raised a "Moved to Today" toast offering Undo for a move that
            // never happened. On a running entry it moved the live start.
            if (day === entryDay) return
            void onCommitDay(day).catch(() => {
              // The popup is already gone, so there is nowhere in HERE to put
              // this. `onCommitDay` owns reporting it; see its prop docs.
            })
          }}
        />
      </Popover.Popup>
    </Popover.Root>
  )
}
