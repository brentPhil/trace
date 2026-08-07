import { InlineEdit } from "@/components/entries/inline-edit"
import { EntryDuration } from "@/components/timer/entry-duration"
import {
  formatTimeOfInstant,
  instantOfTypedTime,
  localMinutesOf,
} from "@/lib/format-time"
import { parseDuration } from "@shared/duration"
import { parseTimeOfDay, resolveEndAfterStart } from "@shared/timeOfDay"
import { cn } from "@/lib/utils"
import type { ParseOutcome } from "@/components/entries/inline-edit"
import type { Entry } from "@/lib/group-entries"

const MAX_TITLE_LENGTH = 500

/**
 * The failure messages.
 *
 * Each one names the input that would work, because "invalid" tells a person
 * only that they were wrong, and this field is being edited by someone in a
 * hurry who wants to get back to work.
 */
const DURATION_HELP = "Try 1:30, 90m, or 1.5h."
const TIME_HELP = "Try 9:15, 0915, or 2pm."

export function EditableTitle({
  entry,
  onCommit,
}: {
  entry: Entry
  onCommit: (title: string) => Promise<void>
}) {
  const title = entry.title.trim()

  return (
    <InlineEdit<string>
      display={
        <span
          className={cn(
            "block truncate text-sm font-medium",
            title === "" && "text-muted-foreground italic"
          )}
        >
          {title === "" ? "No description" : title}
        </span>
      }
      initialInput={entry.title}
      ariaLabel={title === "" ? "Add a description" : `Description: ${title}`}
      placeholder="What are you working on?"
      // `min-w-0` so it can shrink and truncate, but NOT `flex-1`: the trigger
      // must size to its text so the billable mark sits against the end of the
      // title. Filling the row would strand the mark by the time column, where
      // it reads as belonging to the duration rather than to the work.
      //
      // The negative margins pay for the padding. Without them the hover target
      // adds four pixels to every row and the log loses a line per screen.
      //
      // `text-sm` on the TRIGGER, not only on the text inside it. The button
      // establishes its own line box, so without this it inherits the 16px base
      // and reserves a 24px line for 20px of text — four wasted pixels on every
      // row, which is a whole entry per screenful.
      className="-mx-1 -my-0.5 min-w-0 px-1 py-0.5 text-sm"
      inputClassName="text-sm font-medium"
      grow
      parse={(raw) =>
        raw.length > MAX_TITLE_LENGTH
          ? { ok: false, message: `Keep it under ${MAX_TITLE_LENGTH} characters.` }
          : { ok: true, value: raw }
      }
      onCommit={onCommit}
    />
  )
}

/**
 * Start and end, each editable on its own.
 *
 * Two separate fields rather than one "09:12 – 10:58" string, because the
 * reconciliation rule turns on WHICH one moved — editing the start leaves the
 * end alone and vice versa — and a single field cannot express that. It would
 * also make correcting one timestamp require retyping both.
 */
export function EditableTimeRange({
  entry,
  timeZone,
  use12Hour,
  onCommit,
}: {
  entry: Entry
  timeZone: string
  use12Hour: boolean
  onCommit: (field: "start" | "end", instantMs: number) => Promise<void>
}) {
  const startMinutes = localMinutesOf(entry.startedAt, timeZone)

  const parseStart = (raw: string): ParseOutcome<number> => {
    const parsed = parseTimeOfDay(raw, startMinutes)
    if (!parsed.ok) return { ok: false, message: TIME_HELP }
    // dayOffset is forced to 0: a start belongs to the day it is filed under.
    // Honouring an offset here would silently move the entry to another day,
    // and therefore out of the total the user is looking at.
    return {
      ok: true,
      value: instantOfTypedTime(
        entry.startedAt,
        { minutes: parsed.time.minutes, dayOffset: 0 },
        timeZone
      ),
    }
  }

  const parseEnd = (raw: string): ParseOutcome<number> => {
    const parsed = parseTimeOfDay(raw, startMinutes)
    if (!parsed.ok) return { ok: false, message: TIME_HELP }
    // An end earlier in the clock than the start means the next morning —
    // 23:40 to 01:15 is the ordinary overnight case, not a typo. Anchored to
    // the START's day, which is also how the entry is filed.
    const resolved = resolveEndAfterStart(parsed.time, {
      minutes: startMinutes,
      dayOffset: 0,
    })
    return { ok: true, value: instantOfTypedTime(entry.startedAt, resolved, timeZone) }
  }

  return (
    <span className="hidden shrink-0 items-center gap-0.5 text-xs text-muted-foreground tabular sm:inline-flex">
      <InlineEdit<number>
        display={formatTimeOfInstant(entry.startedAt, timeZone, use12Hour)}
        initialInput={formatTimeOfInstant(entry.startedAt, timeZone, use12Hour)}
        ariaLabel="Start time"
        className="px-1 py-0.5"
        inputClassName="w-[5.5rem] text-xs tabular"
        parse={parseStart}
        onCommit={(value) => onCommit("start", value)}
      />
      <span aria-hidden="true">–</span>
      {entry.endedAt === null ? (
        // No end exists yet. A field here would invite typing one, which is a
        // stop — and stopping belongs to the button that says Stop.
        <span className="px-1 py-0.5" aria-label="Still running">
          …
        </span>
      ) : (
        <InlineEdit<number>
          display={formatTimeOfInstant(entry.endedAt, timeZone, use12Hour)}
          initialInput={formatTimeOfInstant(entry.endedAt, timeZone, use12Hour)}
          ariaLabel="End time"
          className="px-1 py-0.5"
          inputClassName="w-[5.5rem] text-xs tabular"
          parse={parseEnd}
          onCommit={(value) => onCommit("end", value)}
        />
      )}
    </span>
  )
}

/**
 * The duration, editable.
 *
 * Editing this on a COMPLETED entry moves the end and anchors the start.
 * Editing it on a RUNNING one moves the start, because there is no end to move
 * — so the field is not offered while running. "It has been going 45 minutes"
 * is a legitimate assertion, but silently rewriting a start time from the
 * duration column is exactly the ambiguity the anchored-field rule exists to
 * prevent; it belongs in a control that says what it is about to do.
 */
export function EditableDuration({
  entry,
  onCommit,
}: {
  entry: Entry
  onCommit: (ms: number) => Promise<void>
}) {
  const durationClass = cn(
    "w-[4.5rem] shrink-0 text-right text-sm font-medium",
    entry.endedAt === null && "text-enlarger"
  )

  // Tested inline rather than through a `running` boolean, so the narrowing
  // survives past the early return and `endedAt` is a number below.
  if (entry.endedAt === null) {
    return (
      <EntryDuration
        startedAt={entry.startedAt}
        endedAt={null}
        className={durationClass}
      />
    )
  }

  const current = entry.durationMs ?? entry.endedAt - entry.startedAt

  return (
    <InlineEdit<number>
      display={
        <EntryDuration
          startedAt={entry.startedAt}
          endedAt={entry.endedAt}
          className="text-right text-sm font-medium"
        />
      }
      initialInput={hhmmss(current)}
      ariaLabel="Duration"
      className={cn(durationClass, "px-1 py-0.5")}
      inputClassName="text-right text-sm font-medium tabular"
      parse={(raw) => {
        const parsed = parseDuration(raw)
        if (parsed.ok) return { ok: true, value: parsed.ms }
        switch (parsed.reason) {
          case "zero":
            return { ok: false, message: "An entry has to be longer than zero." }
          case "too-long":
            return { ok: false, message: "Longer than a day — split it into two entries." }
          default:
            return { ok: false, message: DURATION_HELP }
        }
      }}
      onCommit={onCommit}
    />
  )
}

/** The seed value for the duration field — editable, so it round-trips. */
function hhmmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}
