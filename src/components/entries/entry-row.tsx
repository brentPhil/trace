import { Play, Trash2 } from "lucide-react"
import {
  BillableToggle,
  ProjectPicker,
  TagPicker,
} from "@/components/classifiers/classifier-pickers"
import { EditableDuration, EditableTitle } from "@/components/entries/editable-fields"
import { EntryTimePopover } from "@/components/entries/entry-time-popover"
import { cn } from "@/lib/utils"
import type { Classification } from "@/components/timer/timer-bar"
import type { DayString } from "@shared/day"
import type { Entry } from "@/lib/group-entries"
import type { Doc, Id } from "../../../convex/_generated/dataModel"

/**
 * What a row can do. Passed in rather than reached for with a hook, so the row
 * stays renderable against fixtures and the writes all originate in one place.
 */
export type EntryRowActions = {
  onTitleChange: (entry: Entry, title: string) => Promise<void>
  onTimeChange: (entry: Entry, field: "start" | "end", instantMs: number) => Promise<void>
  /** The DATE moved. Separate from onTimeChange because it is the one edit that
   *  takes the row off the day it is rendered on, so it owes the user a word. */
  onDayChange: (entry: Entry, day: DayString) => Promise<void>
  onDurationChange: (entry: Entry, ms: number) => Promise<void>
  onClassify: (entry: Entry, change: Partial<Classification>) => void
  onCreateProject: (name: string) => Promise<{ projectId: Id<"projects"> }>
  onCreateTag: (name: string) => Promise<{ tagId: Id<"tags"> }>
  onNoteOpen: (entry: Entry) => void
  onRemove: (entry: Entry) => void
  onResume: (entry: Entry) => void
}

/**
 * One tracked entry.
 *
 * Column order follows the eye's job: what it was, then where it belongs, then
 * when, then how long. The duration is last and right-aligned so a column of
 * them aligns on the digit — the whole reason for the Tabular Rule.
 *
 * Every field on the row is editable in place. There is no detail view and no
 * save button, because the correction this product actually sees is one field
 * mistyped, ten times a day, and a modal turns that into four gestures.
 */
/**
 * An empty control: present in the layout so nothing shifts, invisible until
 * the row is hovered or something in it is focused.
 *
 * Always visible below `sm`, because a phone has no hover and a hover-revealed
 * control there is not subtle, it is unreachable.
 */
const revealed = cn(
  "opacity-100 sm:opacity-0",
  "transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
  "focus-visible:opacity-100 motion-reduce:transition-none"
)

export function EntryRow({
  entry,
  timeZone,
  use12Hour,
  weekStartDay,
  projects,
  tags,
  actions,
  notesExpanded = false,
}: {
  entry: Entry
  timeZone: string
  use12Hour: boolean
  /** 0 = Sunday. The calendar's first column, from userSettings. */
  weekStartDay: number
  projects: Array<Doc<"projects">>
  tags: Array<Doc<"tags">>
  actions: EntryRowActions
  /**
   * READ THE NOTE, don't scan the row.
   *
   * The default is the log this product has always drawn: one clipped line,
   * fifty rows tall, scannable. `true` is the other job the same list does —
   * reading yesterday back at a standup — where a note ellipsed at the width
   * of a column is not a smaller version of the note, it is the note missing.
   *
   * A ROW PROP AND NOT ROW STATE. It is one mode over the whole log, set once
   * above and remembered; a per-row disclosure would mean opening every row of
   * a day to read the day, which is the gesture this replaces.
   */
  notesExpanded?: boolean
}) {
  const title = entry.title.trim()
  const note = (entry.note ?? "").trim()
  const hasNote = note !== ""

  return (
    <div
      /*
       * NOT ADDRESSABLE, and no longer focusable.
       *
       * This carried `data-entry-id` and `tabIndex={-1}` for one caller: the
       * calendar, which switched to List, found the row by that attribute and
       * called `.focus()` on it. A block on the grid opens its own editor now
       * — the same controls, the same writes, anchored to the block — so
       * nothing looks a row up by id and nothing focuses one programmatically.
       * The `:focus` outline that existed to make that arrival visible went
       * with them.
       */
      className={cn(
        "group border-b border-edge-soft/60 last:border-b-0",
        "transition-colors hover:bg-surface/60"
      )}
    >
      {/*
        Full width, left-flush, `px-4` for the gutter — the same pair the day
        header above and the timer bar in the shell use, so three files that
        cannot see each other put the left edge in the same place.

        This content was capped at a 1100px measure for exactly one release.
        The argument for the cap was that the title column grows to fill
        whatever it is given and spends the extra on gap: ~1000px between a
        four-word title and the classifier cluster at 1600. That is true, and
        it is also what a table row looks like — the trailing cluster pins
        right, the title takes the rest. The cap traded that gap for a dead
        band of page to the right of every row, which reads worse.

        6 + 20 + 2 + 20 + 6 = 54, so `min-h` is a floor the content sits exactly
        on rather than a number it fights. It is `--entry-row-height` and not a
        literal because the log's loading skeleton has to stand exactly as tall
        as this or the page shifts when the real rows land — one number, so
        that argument cannot be won here and lost there.

        IT WAS 4 + 20 + 2 + 20 + 4 = 50, and the answer to that argument is that
        4px was never a spacing decision — it is what was left over after two
        20px lines were fitted into a height picked so a working day fits on one
        screen. A row and the row under it were 9px apart, which is closer than
        a title is to its own note plus a rule between them, and the log read as
        one block of text. 13px instead (6 + the 1px rule + 6).

        The 2px between a title and its note does NOT move. They are one thing,
        and padding every gap at the same rate is how a list stops having any
        rhythm to read: the room goes AROUND the pair, and more of it again
        between one day and the next (see `day-list.tsx`).

        The note slot is a fixed 20px box because the hatch carries a border and
        the written note does not — left to size themselves, a day of mixed rows
        would ripple by two pixels down the whole column.
      */}
      {/*
        `items-start`, not `items-center`, and the trailing controls carry the
        row's height themselves (below). While every row is exactly 54px the two
        spellings draw the identical thing — the left column is 6 + 20 + 2 + 20 +
        6 by construction, so centring and top-aligning agree. They stop agreeing
        the moment a note is written out in full: a ten-line note against
        `items-center` floats the duration and the delete button in the vertical
        middle of a paragraph, disconnected from the title they belong to. The
        eye reads a row left to right along its FIRST line, so that is the line
        everything on it has to sit on.
      */}
      <div className="flex min-h-(--entry-row-height) w-full items-start gap-2 px-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <EditableTitle
              entry={entry}
              onCommit={(next) => actions.onTitleChange(entry, next)}
            />
            {entry.billable ? (
              // Brass means money — The Two Temperatures Rule. Paired with a
              // glyph so it survives without colour.
              // `sm:hidden` because the BillableToggle below carries this at
              // wider widths, where it is also editable. Below `sm` the toggle is
              // dropped for room, so this static mark is what keeps billable
              // visible on a phone rather than merely absent.
              //
              // `leading-5` matters as much as the colour here: an unsized span
              // establishes a 24px line box from the inherited 16px base, so
              // without it every billable row is four pixels taller than every
              // non-billable one and the whole log develops a stutter.
              <span
                className="flex shrink-0 items-center text-xs leading-5 text-brass sm:hidden"
                title="Billable"
              >
                <span aria-hidden="true" className="font-semibold">
                  $
                </span>
                <span className="sr-only">Billable</span>
              </span>
            ) : null}
          </div>

          {/*
            The slot is 20px so the row lands on 50, but a 20px control is under
            WCAG 2.2's 24px target minimum. `touch-target` (styles.css) extends
            the hit area with a pseudo-element instead of padding, so the target
            grows without the row growing with it.
          */}
          <div
            className={cn(
              "flex min-w-0 items-center",
              // A FIXED 20px BOX, so a day of mixed written/empty notes does not
              // ripple — except when the note is the thing being read, where a
              // fixed height is exactly the clip being lifted. `min-h-5` keeps
              // the floor (and with it the 54px row) for the one-line case.
              notesExpanded ? "min-h-5" : "h-5"
            )}
          >
            {hasNote ? (
              <button
                type="button"
                onClick={() => actions.onNoteOpen(entry)}
                className={cn(
                  "touch-target -mx-1 min-w-0 max-w-full rounded-sm px-1 py-0.5 text-left",
                  "text-muted-foreground transition-colors",
                  "hover:bg-surface-raised/70 hover:text-foreground",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  // A STEP UP IN SIZE, and not only in room. `text-xs` is a
                  // label size — right for a line you glance past on the way to
                  // the duration, wrong for the only prose in the product once
                  // it is what you came to read. `text-sm` is the body size the
                  // note sheet writes it at, so reading it in the log and
                  // reading it in the editor are the same act of reading.
                  notesExpanded ? "text-sm leading-relaxed" : "text-xs"
                )}
              >
                {/*
                  `truncate` lives on this span rather than on the button, and it
                  has to. `truncate` sets overflow:hidden, and `.touch-target` sets
                  position:relative — which makes the button the containing block
                  for its OWN ::after, so the 2px the pseudo-element hangs above
                  and below is clipped off by the overflow rule meant for the text.
                  The control silently stayed 20px and missed WCAG 2.2 SC 2.5.8,
                  while the class that was supposed to fix it was right there in
                  the list. Clipping the text one level in leaves the button's own
                  overflow visible.

                  Expanded, the same span drops `truncate` for `whitespace-pre-wrap`
                  — PRE-wrap and not plain wrapping, because a note is written in
                  a textarea where Enter inserts a newline (`note-sheet.tsx`), so
                  the paragraph breaks the user typed are part of what they wrote.
                  `break-words` is for the other half of the same promise: a
                  pasted URL or a 60-character ticket slug has no space to break
                  at and would otherwise push the whole row sideways.
                */}
                <span
                  className={cn(
                    "block",
                    notesExpanded ? "whitespace-pre-wrap break-words" : "truncate"
                  )}
                >
                  {note}
                </span>
              </button>
            ) : (
              // ALWAYS visible, never a hover reveal. PRODUCT.md: missing notes are
              // "visible, not absent". Hiding this until hover would make the one
              // thing the product exists to capture the one thing you cannot see is
              // missing — and it leaves a dead gap in the row besides.
              //
              // The hatch is the carrier (The Hatch Rule): absence is a texture,
              // never a colour, so it survives colour blindness and reads in
              // peripheral vision. It is an invitation, not a warning — which is
              // why it is quiet, and why nothing about it blocks or nags.
              <button
                type="button"
                onClick={() => actions.onNoteOpen(entry)}
                className={cn(
                  "hatch-empty touch-target -mx-0.5 flex h-5 items-center rounded-sm px-1.5 text-xs",
                  "text-muted-foreground/70 transition-colors",
                  "hover:text-foreground focus-visible:text-foreground",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                )}
              >
                + add note
              </button>
            )}
          </div>
        </div>

        {/*
          EVERYTHING AFTER THE TEXT, IN ONE BOX, and the box is a row's height.

          These four clusters used to be siblings of the title column, centred by
          the parent. They are grouped now for one reason: the group can hold
          `min-h-(--entry-row-height) items-center` while the parent top-aligns,
          which is what keeps them on the row's first line rather than halfway
          down a note (see the parent's own note above). The `gap-2` between them
          is the gap the parent used to supply, so nothing moves.
        */}
        <div className="flex min-h-(--entry-row-height) shrink-0 items-center gap-2">
          {/*
            The classifiers, editable in place like everything else on the row.
            Same three controls in the same order as the timer bar — a project is
            set the same way whether the work is running or finished, because a
            second way to do it is a second thing to remember.

            A control that HOLDS something is always visible, because it is data.
            An EMPTY one is only an affordance, and is revealed on hover like the
            row's other controls. Showing all three on every row put a dollar
            sign beside every entry in the log, which is exactly how "brass means
            money" stops meaning anything.
          */}
          <div className="flex shrink-0 items-center gap-0.5">
            <ProjectPicker
              projects={projects}
              value={entry.projectId ?? null}
              onCreate={actions.onCreateProject}
              onChange={(projectId) => actions.onClassify(entry, { projectId })}
              className={cn("max-w-[8rem]", entry.projectId === undefined && revealed)}
              // The dot survives at every width; the name is what gets dropped
              // when there is no room, because the dot plus the row's own
              // context is enough to tell two clients apart at a glance.
              nameClassName="hidden md:inline"
            />
            <TagPicker
              tags={tags}
              value={entry.tagIds}
              onCreate={actions.onCreateTag}
              onChange={(tagIds) => actions.onClassify(entry, { tagIds })}
              className={cn("hidden sm:inline-flex", entry.tagIds.length === 0 && revealed)}
            />
            <BillableToggle
              value={entry.billable}
              onChange={(billable) => actions.onClassify(entry, { billable })}
              className={cn("hidden sm:inline-flex", !entry.billable && revealed)}
            />
          </div>

          {/*
            Visible at EVERY width. The inline fields this replaced were
            `hidden sm:inline-flex`, so on a phone an entry's times could not be
            corrected at all — the surface Toggl abandoned, again.
          */}
          <EntryTimePopover
            entry={entry}
            timeZone={timeZone}
            use12Hour={use12Hour}
            weekStartDay={weekStartDay}
            onCommitTime={(field, value) => actions.onTimeChange(entry, field, value)}
            onCommitDay={(day) => actions.onDayChange(entry, day)}
          />

          <EditableDuration
            entry={entry}
            onCommit={(ms) => actions.onDurationChange(entry, ms)}
          />

          {/*
            Row controls stay in the layout at all times and fade in on hover or
            focus, rather than being added and removed. Reserving the space means
            the columns to their left do not shift when the pointer crosses a row
            — and it is what lets the keyboard reach them at all.

            On a touch screen they are simply always visible. There is no hover
            on a phone, so a hover-revealed control is not subtle there, it is
            absent: delete and resume would be unreachable by any means.
          */}
          <div className="flex shrink-0 items-center gap-0.5">
            <RowButton
              label={`Resume ${title === "" ? "this entry" : title}`}
              onClick={() => actions.onResume(entry)}
            >
              <Play className="size-4" />
            </RowButton>
            <RowButton
              label={`Delete ${title === "" ? "this entry" : title}`}
              onClick={() => actions.onRemove(entry)}
              destructive
            >
              <Trash2 className="size-4" />
            </RowButton>
          </div>
        </div>
      </div>
    </div>
  )
}

function RowButton({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "rounded-md p-1.5 text-muted-foreground",
        "opacity-100 sm:opacity-0",
        "transition-[opacity,color] sm:group-hover:opacity-100",
        "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
        "focus-visible:outline-none",
        destructive ? "hover:text-alarm" : "hover:text-foreground",
        "motion-reduce:transition-none"
      )}
    >
      {children}
    </button>
  )
}
