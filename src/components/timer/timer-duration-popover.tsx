import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover } from "@/components/ui/popover"
import { EntryTimePopover } from "@/components/entries/entry-time-popover"
import { TimePopoverFields } from "@/components/entries/time-popover-fields"
import { EntryDuration } from "@/components/timer/entry-duration"
import {
  formatTimeOfInstant,
  instantMovedToDay,
  instantOfDayTime,
} from "@/lib/format-time"
import { errorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import { forceClosePopover, usePopoverActionsRef } from "@/lib/popover-force-close"
import { dayOf } from "@shared/day"
import { parseTimeOfDay, resolveEndAfterStart } from "@shared/timeOfDay"
import type { DayString } from "@shared/day"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

const TIME_HELP = "Try 9:15, 0915, or 2pm."

/**
 * Toggl's gesture, ported: clicking the timer bar's duration opens a popover
 * with START, STOP and a calendar — exactly what clicking a log row's time
 * range already opens.
 *
 * Two entirely different write semantics live behind that one gesture,
 * chosen by whether anything is running:
 *
 *   Running — there IS a row, so this is an EDIT. `EntryTimePopover` already
 *   does that, seeded from `entry`; the only thing swapped in is the trigger,
 *   so the duration itself opens it rather than a separate time-range button.
 *
 *   Idle — there is no row yet, so this is a CREATE. Nothing can be written
 *   until BOTH times are known, unlike the edit path where each field commits
 *   the moment it is typed — so this half owns its own draft state and a
 *   confirm button, rather than reusing `EntryTimePopover`'s per-field commit.
 *
 * Both halves render the exact same `TimePopoverFields` body as the row's
 * popover, which is the point of having extracted it: one calendar
 * implementation, two callers who disagree about when a write happens.
 */
export function TimerDurationPopover({
  running,
  timeZone,
  use12Hour,
  weekStartDay,
  onEditTime,
  onCreateCompleted,
}: {
  running: Doc<"timeEntries"> | null
  timeZone: string
  use12Hour: boolean
  /** 0 = Sunday, from userSettings. The grid and the week totals must agree. */
  weekStartDay: number
  /** Mirrors `EntryRowActions.onTimeChange`/`onDayChange` — a `"day"` edit
   *  carries the resolved START instant, exactly as `editTime` already
   *  expects everywhere else it is called. */
  onEditTime: (
    entryId: Id<"timeEntries">,
    field: "start" | "end" | "day",
    instantMs: number
  ) => Promise<void>
  onCreateCompleted: (input: {
    startedAt: number
    endedAt: number
  }) => Promise<unknown>
}) {
  if (running !== null) {
    return (
      <RunningDurationPopover
        entry={running}
        timeZone={timeZone}
        use12Hour={use12Hour}
        weekStartDay={weekStartDay}
        onEditTime={onEditTime}
      />
    )
  }

  return (
    <IdleDurationPopover
      timeZone={timeZone}
      use12Hour={use12Hour}
      weekStartDay={weekStartDay}
      onCreateCompleted={onCreateCompleted}
    />
  )
}

/**
 * The shared button styling for the duration trigger, in both states.
 *
 * Deliberately no colour of its own — see The Cold Light Rule in DESIGN.md.
 * `--enlarger` marking the running state lives entirely in `EntryDuration`'s
 * own className, exactly as it did before this was a button; wrapping it must
 * not add a competing accent, so the hover/focus treatment here is the same
 * neutral one the row's own time trigger uses.
 */
const triggerClass = cn(
  "touch-target shrink-0 rounded-sm px-1 py-0.5 sm:px-2",
  "transition-colors hover:bg-surface-raised/70",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
)

const durationClass = "text-base font-medium sm:text-lg"

function RunningDurationPopover({
  entry,
  timeZone,
  use12Hour,
  weekStartDay,
  onEditTime,
}: {
  entry: Doc<"timeEntries">
  timeZone: string
  use12Hour: boolean
  weekStartDay: number
  onEditTime: (
    entryId: Id<"timeEntries">,
    field: "start" | "end" | "day",
    instantMs: number
  ) => Promise<void>
}) {
  return (
    <EntryTimePopover
      entry={entry}
      timeZone={timeZone}
      use12Hour={use12Hour}
      weekStartDay={weekStartDay}
      onCommitTime={(field, instantMs) => onEditTime(entry._id, field, instantMs)}
      onCommitDay={(day) =>
        onEditTime(entry._id, "day", instantMovedToDay(entry.startedAt, day, timeZone))
      }
      trigger={
        <button
          type="button"
          // Says what it does, not the digits it wraps — a screen reader
          // hears "Edit start time — running", never "9:12:04, button".
          aria-label="Edit start time — running"
          className={triggerClass}
        >
          {/* `role="timer"` lives inside a `role="button"` ancestor here. That
           *  is a live-region role, not a widget one, so it is not
           *  interactive content and the nesting is valid — but the button's
           *  own `aria-label` is what a screen reader announces on focus, so
           *  the timer role only narrates for anyone browsing by content. */}
          <EntryDuration
            startedAt={entry.startedAt}
            endedAt={null}
            className={cn(durationClass, "text-enlarger")}
          />
        </button>
      }
    />
  )
}

function IdleDurationPopover({
  timeZone,
  use12Hour,
  weekStartDay,
  onCreateCompleted,
}: {
  timeZone: string
  use12Hour: boolean
  weekStartDay: number
  onCreateCompleted: (input: {
    startedAt: number
    endedAt: number
  }) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState<DayString>(() => dayOf(Date.now(), timeZone))
  const [month, setMonth] = useState<DayString>(day)
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const actionsRef = usePopoverActionsRef()

  // Re-seed every time it opens, to "now" — the Toggl gesture this is. A tab
  // left open since yesterday must not offer yesterday's moment today.
  useEffect(() => {
    if (!open) return
    const now = Date.now()
    const today = dayOf(now, timeZone)
    setDay(today)
    setMonth(today)
    const nowLabel = formatTimeOfInstant(now, timeZone, use12Hour)
    setStart(nowLabel)
    setEnd(nowLabel)
    setError(null)
  }, [open, timeZone, use12Hour])

  const confirm = async () => {
    if (saving) return
    setError(null)

    const startParsed = parseTimeOfDay(start, 0)
    if (!startParsed.ok) {
      setError(`Start time — ${TIME_HELP}`)
      return
    }
    const endParsed = parseTimeOfDay(end, startParsed.time.minutes)
    if (!endParsed.ok) {
      setError(`Stop time — ${TIME_HELP}`)
      return
    }
    // Both fields default to the SAME instant on open, and confirming without
    // touching either is a real path — someone logging a task the moment it
    // finishes. `resolveEndAfterStart` treats an end equal to the start as a
    // full day later (it exists to catch a stop typed EARLIER than the start,
    // an overnight shift), which here would silently create a 24-hour entry
    // from a bare double-click. Asking for a real stop is safer than guessing
    // which of "zero length" or "a whole day" was meant.
    if (endParsed.time.minutes === startParsed.time.minutes) {
      setError("Stop time — must be after the start.")
      return
    }

    const startedAt = instantOfDayTime(
      day,
      { minutes: startParsed.time.minutes, dayOffset: 0 },
      timeZone
    )
    // An end earlier in the clock than the start is the overnight case, not a
    // typo — the same reasoning ManualEntryDialog and EntryTimePopover use.
    const endedAt = instantOfDayTime(
      day,
      resolveEndAfterStart(endParsed.time, {
        minutes: startParsed.time.minutes,
        dayOffset: 0,
      }),
      timeZone
    )

    setSaving(true)
    try {
      await onCreateCompleted({ startedAt, endedAt })
      setOpen(false)
      forceClosePopover(actionsRef)
    } catch (thrown) {
      setError(errorMessage(thrown))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen} actionsRef={actionsRef}>
      <Popover.Trigger
        render={
          <button
            type="button"
            // Idle, the digits are always 0:00:00 — a name built from them
            // would say nothing. This says what clicking it does instead.
            aria-label="Add a completed entry"
            className={triggerClass}
          >
            {/* Idle has no entry to measure — the duration is a constant
             *  zero, not a live one, so both endpoints are fixed rather than
             *  re-evaluating `Date.now()` on every render. That render churn
             *  was a real anti-pattern (a new `startedAt` prop on every
             *  render, the same instability React's hydration-mismatch
             *  warning calls out) but it was NOT what left the popup below
             *  stuck open — that was verified separately; see
             *  `popover-force-close.ts`. This is a correctness fix on its
             *  own merits: the idle duration IS zero, not "now minus zero". */}
            <EntryDuration
              startedAt={0}
              endedAt={0}
              className={cn(durationClass, "text-muted-foreground")}
            />
          </button>
        }
      />

      <Popover.Popup className="w-[19.5rem] gap-0 p-0">
        <TimePopoverFields
          running={false}
          startValue={start}
          onStartChange={setStart}
          // Deliberately inert: committing on blur (as the edit path does)
          // would fire a create the instant focus left the Start field, with
          // Stop still at its default — before the user has finished. Only
          // the explicit button below commits.
          onStartCommit={() => {}}
          endValue={end}
          onEndChange={setEnd}
          onEndCommit={() => {}}
          error={error}
          month={month}
          onMonthChange={setMonth}
          selectedDay={day}
          weekStartDay={weekStartDay}
          onPickDay={setDay}
          footer={
            <div className="mt-3 flex justify-end">
              <Button size="sm" disabled={saving} onClick={() => void confirm()}>
                Create entry
              </Button>
            </div>
          }
        />
      </Popover.Popup>
    </Popover.Root>
  )
}
