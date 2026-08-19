import { InlineEdit } from "@/components/entries/inline-edit"
import { EntryDuration } from "@/components/timer/entry-duration"
import { parseDuration } from "@shared/duration"
import { cn } from "@/lib/utils"
import type { Entry } from "@/lib/group-entries"

const MAX_TITLE_LENGTH = 500

/**
 * The failure message.
 *
 * It names the input that would work, because "invalid" tells a person only
 * that they were wrong, and this field is being edited by someone in a hurry
 * who wants to get back to work.
 */
const DURATION_HELP = "Try 1:30, 90m, or 1.5h."

export function EditableTitle({
  entry,
  onCommit,
  textClassName = "text-sm",
}: {
  entry: Entry
  onCommit: (title: string) => Promise<void>
  /**
   * The type size, on the display span, the trigger and the input alike.
   *
   * One prop rather than three, because all three have to agree: the trigger
   * establishes the line box (see `className` below) and a size set on only the
   * text inside it makes the control taller than what it holds. The calendar's
   * entry popover passes `text-base` — a popover is one entry at a time and its
   * title is the heading of it, where a log row is one of fifty and `text-sm`
   * is what fits a working day on a screen.
   */
  textClassName?: string
}) {
  const title = entry.title.trim()

  return (
    <InlineEdit<string>
      display={
        <span
          className={cn(
            // `py-0.5 -my-0.5` costs nothing and prevents a clip. `truncate`
            // is `overflow: hidden`, which clips BOTH axes — so a caller
            // passing `leading-none` (the log rows do) leaves a 16px box
            // holding ~19.7px of DM Sans ink, and the descenders of g, y and p
            // get shaved off inside this span no matter what padding the
            // trigger around it carries. Two pixels of room each side covers
            // the overflow; the negative margin hands the height straight back
            // so no row grows.
            "block truncate py-0.5 -my-0.5 font-medium",
            textClassName,
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
      // The size goes on the TRIGGER, not only on the text inside it. The
      // button establishes its own line box, so without this it inherits the
      // 16px base and reserves a 24px line for 20px of text — four wasted
      // pixels on every row, which is a whole entry per screenful.
      className={cn("-mx-1 -my-0.5 min-w-0 px-1 py-0.5", textClassName)}
      inputClassName={cn("font-medium", textClassName)}
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

/*
 * `EditableTimeRange` used to live here: two inline text fields, start and end,
 * `hidden` below `sm`. It was replaced by `entry-time-popover.tsx`, which can
 * additionally express the DATE — something these fields deliberately could not,
 * pinning `dayOffset: 0` so a typed time could never silently move an entry off
 * the day the user was looking at. A calendar says out loud what it is doing, so
 * the capability arrives with the control that makes it legible.
 */

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
        // The log's duration column, named where it can be queried — the day
        // header and the sitting total carry the same mark. The timer bar's
        // EntryDuration is deliberately unmarked: it is not a cell of this
        // column.
        data-log-cell="duration"
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
          data-log-cell="duration"
          className="text-right text-sm font-medium"
        />
      }
      initialInput={hhmmss(current)}
      ariaLabel="Duration"
      className={cn(durationClass, "px-1 py-0.5")}
      inputClassName="text-right text-sm font-medium font-mono tabular-nums tracking-[-0.02em]"
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
