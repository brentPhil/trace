import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover } from "@/components/ui/popover"
import { EntryTimePopover } from "@/components/entries/entry-time-popover"
import { TimePopoverFields } from "@/components/entries/time-popover-fields"
import { EntryDuration } from "@/components/timer/entry-duration"
import { useElapsedMs } from "@/hooks/use-clock"
import {
  formatTimeOfInstant,
  instantMovedToDay,
  instantOfDayTime,
  localMinutesOf,
} from "@/lib/format-time"
import { errorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import { useForceCloseWhenClosed, usePopoverActionsRef } from "@/lib/popover-force-close"
import { dayOf } from "@shared/day"
import { spokenDuration } from "@shared/duration"
import {
  MINUTES_PER_DAY,
  absoluteMinutes,
  formatTimeOfDay,
  parseTimeOfDay,
  resolveInterval,
  timeFieldHelp,
} from "@shared/timeOfDay"
import type { DayString } from "@shared/day"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

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
  stagedStartAt,
  onEditTime,
  onCreateCompleted,
  onStageStart,
  onError,
}: {
  running: Doc<"timeEntries"> | null
  timeZone: string
  use12Hour: boolean
  /** 0 = Sunday, from userSettings. The grid and the week totals must agree. */
  weekStartDay: number
  /**
   * The instant Play would currently use, or null for "now" — already put
   * through the bar's staleness rules. The idle popover seeds ITSELF from
   * this, so opening it to check what Play will do cannot show one time while
   * the armed row below shows another.
   */
  stagedStartAt: number | null
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
  /**
   * Fired whenever the idle popover's Start field or day resolves to a valid
   * instant — stages it on the bar so Play can pick it up. There is no
   * running entry here to write into yet, the same reasoning `staged`
   * classification already rests on; see the comment above `staged` in
   * `timer-bar.tsx`.
   *
   * `null` disarms it. "Create entry" consumes the fields it was staged from,
   * so leaving the stage armed after one would silently backdate the NEXT
   * press of Play by however far the created entry reached back.
   */
  onStageStart: (instantMs: number | null) => void
  /**
   * Reports a write that rejected AFTER the popover has closed — a day pick,
   * which commits on click and takes the popup with it. There is nowhere left
   * on screen for an inline error by then, so it has to go to whatever the
   * page uses for out-of-band failures. Same prop, same reason, as
   * `TimerBar`'s own `onError`.
   */
  onError?: (thrown: unknown) => void
}) {
  if (running !== null) {
    // Bound to a `const` so the narrowing survives into the callbacks below.
    const entry = running
    return (
      <>
        <EntryTimePopover
          entry={entry}
          timeZone={timeZone}
          use12Hour={use12Hour}
          weekStartDay={weekStartDay}
          onCommitTime={(field, instantMs) => onEditTime(entry._id, field, instantMs)}
          onCommitDay={async (day) => {
            // Reported rather than thrown: this settles after the popup has
            // gone, so an uncaught rejection was a console warning and a row
            // that silently jumped back where it started.
            try {
              await onEditTime(
                entry._id,
                "day",
                instantMovedToDay(entry.startedAt, day, timeZone)
              )
            } catch (thrown) {
              onError?.(thrown)
            }
          }}
          trigger={
            <button
              type="button"
              // Says what it does, not the digits it wraps — a screen reader
              // hears "Edit start time — running", never "9:12:04, button".
              aria-label="Edit start time — running"
              // The digits themselves, which the button role prunes. See
              // `SpokenElapsed`.
              aria-describedby={ELAPSED_DESCRIPTION_ID}
              className={triggerClass}
            >
              <EntryDuration
                startedAt={entry.startedAt}
                endedAt={null}
                className={cn(durationClass, "text-enlarger")}
              />
            </button>
          }
        />
        <SpokenElapsed startedAt={entry.startedAt} />
      </>
    )
  }

  return (
    <IdleDurationPopover
      timeZone={timeZone}
      use12Hour={use12Hour}
      weekStartDay={weekStartDay}
      stagedStartAt={stagedStartAt}
      onCreateCompleted={onCreateCompleted}
      onStageStart={onStageStart}
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

/** Ties the trigger to the elapsed time it can no longer expose itself. */
const ELAPSED_DESCRIPTION_ID = "timer-elapsed-description"

/**
 * The running elapsed time, for a screen reader only.
 *
 * `EntryDuration` renders `<time role="timer" aria-label="Running, 1 hour 5
 * minutes">`, and that used to be the whole control. Wrapping it in a button
 * to make the duration clickable took the label away: `button` has Children
 * Presentational: True in WAI-ARIA, so every descendant role and name is
 * pruned from the accessibility tree. The digits were then readable by nobody
 * — not on focus (the button's own `aria-label` wins), and not by browsing
 * either (the subtree is gone, not merely deprioritised).
 *
 * So it is re-exposed OUTSIDE the button, as the trigger's description. Not
 * folded into the button's name, which would re-announce the whole control
 * every time the clock ticked; and deliberately not an `<output>`, whose
 * implicit `role="status"` is a live region and would narrate every tick on
 * its own. A description is read once, when focus lands.
 *
 * Its own component so the per-second subscription re-renders one `<span>`,
 * not the popover and its 42-button calendar.
 */
function SpokenElapsed({ startedAt }: { startedAt: number }) {
  const ms = useElapsedMs(startedAt, null)
  return (
    <span id={ELAPSED_DESCRIPTION_ID} className="sr-only">
      {spokenDuration(ms)}
    </span>
  )
}

/**
 * The IDLE half, which — unlike the running one inlined above — genuinely
 * needs to be its own component.
 *
 * It owns draft state, and unmounting it on start is what resets that draft:
 * once `start` resolves, `TimerDurationPopover` swaps to the running branch and
 * whatever was half-typed in here goes with it. Hoisting this body would keep
 * the draft alive across that transition.
 */
function IdleDurationPopover({
  timeZone,
  use12Hour,
  weekStartDay,
  stagedStartAt,
  onCreateCompleted,
  onStageStart,
}: {
  timeZone: string
  use12Hour: boolean
  weekStartDay: number
  stagedStartAt: number | null
  onCreateCompleted: (input: {
    startedAt: number
    endedAt: number
  }) => Promise<unknown>
  onStageStart: (instantMs: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState<DayString>(() => dayOf(Date.now(), timeZone))
  const [month, setMonth] = useState<DayString>(day)
  const [start, setStart] = useState("")
  const [end, setEnd] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const actionsRef = usePopoverActionsRef()
  useForceCloseWhenClosed(open, actionsRef)

  /*
   * Re-seed on the OPEN TRANSITION — from the STAGED start when one is armed,
   * and from "now" otherwise. A tab left open since yesterday must not offer
   * yesterday's moment today, which is what the "now" half is for; seeding
   * from "now" unconditionally made the popover lie, showing 9:00 PM in Start
   * while the armed row below it still said "Starts 4:06 AM" and Play still
   * used 4:06 AM. This is the surface someone opens to CHECK the staged time.
   *
   * Seeding from the stage rather than re-staging from "now" is the deliberate
   * direction: the other way round, merely looking at the popover would
   * destroy a stage that had been set on purpose.
   *
   * ADJUSTED DURING RENDER, not in an effect — React's documented pattern for
   * state derived from a prop change, and the same one `timer-bar.tsx` uses to
   * re-seed its title draft. An effect could only read `stagedStartAt` without
   * listing it as a dependency by mirroring it into a ref, because typing into
   * Start stages what was typed and would otherwise re-run the effect and
   * overwrite the field from the value it had just produced. That took a ref,
   * a second effect to sync it, and a paragraph to justify. It also meant
   * `timeZone` and `use12Hour` were dependencies, so changing either while the
   * popover was open wiped whatever the user had typed. This form cannot: it
   * runs on the open transition and nothing else.
   */
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      const seedFrom = stagedStartAt ?? Date.now()
      const seedDay = dayOf(seedFrom, timeZone)
      setDay(seedDay)
      setMonth(seedDay)
      // Both fields to the same instant: `confirm` refuses a stop equal to the
      // start, so the default state asks for a real stop rather than guessing
      // one. Seeding Stop from "now" against a backdated Start would instead
      // offer a multi-hour entry a single click could commit.
      const label = formatTimeOfInstant(seedFrom, timeZone, use12Hour)
      setStart(label)
      setEnd(label)
      setError(null)
    }
  }

  /**
   * The reference `parseTimeOfDay` disambiguates a bare hour against.
   *
   * Passing a literal `0` here pinned that reference to midnight, so every
   * bare `1`-`11` resolved to AM and a bare `12` to `00:00`. Typing `3` over
   * Start at three in the afternoon recorded a 3 AM entry — twelve hours out,
   * from the exact terse input the parser exists to support, and with a
   * project rate set that is wrong billable data. `EntryTimePopover` gets this
   * right by anchoring to the entry's own start; the idle path has no entry,
   * so it anchors to the wall clock, which is what the parser documents.
   */
  const nowMinutes = () => localMinutesOf(Date.now(), timeZone)

  /**
   * Stages Play's start instant from whatever START and day are on screen
   * right now — called after every keystroke in the Start field and every
   * calendar pick, so the bar's armed indicator (and Play itself) always
   * reflect exactly what is currently typed, not what was last confirmed.
   *
   * Silently does nothing on a Start that does not yet parse (mid-keystroke,
   * e.g. "4:0") rather than clearing the stage — half-typed input is not the
   * same thing as "I changed my mind", and the last value that DID parse is
   * still the correct thing for Play to use if pressed right now.
   */
  const stageFromFields = (dayValue: DayString, startText: string) => {
    const parsed = parseTimeOfDay(startText, nowMinutes())
    if (!parsed.ok) return
    onStageStart(
      instantOfDayTime(dayValue, { minutes: parsed.time.minutes, dayOffset: 0 }, timeZone)
    )
  }

  const confirm = async () => {
    if (saving) return
    setError(null)

    const interval = resolveInterval(start, end, nowMinutes())
    if (!interval.ok) {
      setError(timeFieldHelp(interval.field))
      return
    }
    // Both fields default to the SAME instant on open, and confirming without
    // touching either is a real path — someone logging a task the moment it
    // finishes. An end equal to the start resolves to a full day later (the
    // rule exists to catch a stop typed EARLIER than the start, an overnight
    // shift), which here would silently create a 24-hour entry from a bare
    // double-click. Asking for a real stop is safer than guessing which of
    // "zero length" or "a whole day" was meant.
    //
    // Measured on the RESOLVED span rather than on the two raw readings, so
    // that "9:00 PM" against "9pm" — the same instant, spelled two ways — is
    // caught too.
    if (absoluteMinutes(interval.end) - absoluteMinutes(interval.start) === MINUTES_PER_DAY) {
      // "End time", matching `timeFieldHelp` and the field's own aria-label.
      setError("End time — must be after the start.")
      return
    }

    const startedAt = instantOfDayTime(day, interval.start, timeZone)
    const endedAt = instantOfDayTime(day, interval.end, timeZone)

    setSaving(true)
    try {
      await onCreateCompleted({ startedAt, endedAt })
      // Disarm. Every keystroke in Start and every calendar pick above has
      // already staged an instant for Play, and "Create entry" has just spent
      // those same fields on a completed entry — leaving them armed meant the
      // user's next press of Play, the most-used control in the product,
      // silently began a running entry backdated to whatever this entry
      // started at. Nothing about "Create entry" implies it should arm Play.
      onStageStart(null)
      setOpen(false)
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
          onStartChange={(value) => {
            setStart(value)
            // A rejection reported against the PREVIOUS contents of this field
            // must not outlive them; leaving it up put a red line under input
            // it no longer described.
            setError(null)
            stageFromFields(day, value)
          }}
          // Deliberately inert: committing on blur (as the edit path does)
          // would fire a create the instant focus left the Start field, with
          // Stop still at its default — before the user has finished. Only
          // the explicit button below commits.
          onStartCommit={() => {}}
          endValue={end}
          onEndChange={(value) => {
            setEnd(value)
            setError(null)
          }}
          onEndCommit={() => {}}
          error={error}
          month={month}
          onMonthChange={setMonth}
          selectedDay={day}
          weekStartDay={weekStartDay}
          onPickDay={(pickedDay) => {
            setDay(pickedDay)
            setError(null)
            stageFromFields(pickedDay, start)
          }}
          footer={
            <div className="mt-3 flex items-center justify-between gap-2">
              <ParseEcho
                start={start}
                end={end}
                use12Hour={use12Hour}
                nowMinutes={nowMinutes}
              />
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

/**
 * What the two fields currently MEAN, echoed before anything is written.
 *
 * `formatTimeOfDay`'s own docstring calls this echo "the product's stated
 * defence against a mis-parse", and this popover had none: a two-keystroke
 * overnight resolution producing a 23-hour entry was invisible until it landed
 * in the log, and a bare hour resolving to the wrong half of the clock was
 * invisible full stop. The `+1d` marker is the part that earns its place.
 *
 * Renders nothing while either field is unparseable — a half-typed time has no
 * meaning to echo, and the error line above already speaks for a bad one.
 *
 * Deliberately NOT a live region. It changes on every keystroke, and a polite
 * region that re-reads a time range per character is the same unusable chatter
 * `useMinute` exists to avoid. It is ordinary content, read on the way to the
 * Create button.
 */
function ParseEcho({
  start,
  end,
  use12Hour,
  nowMinutes,
}: {
  start: string
  end: string
  use12Hour: boolean
  nowMinutes: () => number
}) {
  const interval = resolveInterval(start, end, nowMinutes())
  if (!interval.ok) return null

  return (
    // The Tabular Rule: every duration, timestamp and total, at any size.
    <span className="tabular text-xs text-muted-foreground">
      {formatTimeOfDay(interval.start, use12Hour)} –{" "}
      {formatTimeOfDay(interval.end, use12Hour)}
    </span>
  )
}

