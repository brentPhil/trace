import { Play, Trash2 } from "lucide-react"
import {
  BillableToggle,
  ProjectPicker,
  TagPicker,
} from "@/components/classifiers/classifier-pickers"
import {
  EditableDuration,
  EditableTitle,
} from "@/components/entries/editable-fields"
import { EntryTimePopover } from "@/components/entries/entry-time-popover"
import { NoteLine } from "@/components/entries/note-line"
import { SelectionCheckbox } from "@/components/entries/selection-checkbox"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SelectionTarget } from "@/components/entries/selection-checkbox"
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
  onTimeChange: (
    entry: Entry,
    field: "start" | "end",
    instantMs: number
  ) => Promise<void>
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
  /** `onClassify`, for a sitting: applies one change to every member at once.
   *  See `SittingRow.onClassify` and `DayList`, which builds this from it. */
  onSittingClassify: (
    entries: Array<Entry>,
    change: Partial<Classification>
  ) => void
  /** `onNoteOpen`, for a sitting: opens the note editor on every member's note,
   *  joined. See `SittingRow.onNoteOpen` and `EntryLog`, which implements it. */
  onSittingNoteOpen: (entries: Array<Entry>) => void
  /**
   * `onRemove`, for a sitting: deletes every member at once.
   *
   * A separate verb rather than the row's `onRemove` in a loop, because a
   * sitting's delete has to be ONE mutation under ONE Undo — see `EntryLog`,
   * which routes this to `onRemoveMany`. Looping would raise a toast per member
   * and could leave the group half-deleted if a later call were refused.
   */
  onSittingRemove: (entries: Array<Entry>) => void
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
  "transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100",
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
  selection,
  notesExpanded = false,
  showNote = true,
}: {
  entry: Entry
  timeZone: string
  use12Hour: boolean
  /** 0 = Sunday. The calendar's first column, from userSettings. */
  weekStartDay: number
  projects: Array<Doc<"projects">>
  tags: Array<Doc<"tags">>
  actions: EntryRowActions
  selection?: SelectionTarget
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
  /**
   * Whether this row carries its own note.
   *
   * FALSE FOR A SITTING'S MEMBERS, and only there. The note belongs to the
   * piece of work rather than to each interval of it, so the parent carries it
   * and the members carry times — see `sitting-row.tsx`. Defaults true, so
   * every other caller in the product is unaffected and a row rendered without
   * thinking about this still behaves the way it always has.
   *
   * The row is SHORTER without the slot, deliberately: the fixed 20px box
   * exists to stop a day of mixed written/empty notes rippling, and a member
   * row has no note to be mixed about.
   */
  showNote?: boolean
}) {
  const title = entry.title.trim()
  const note = (entry.note ?? "").trim()

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
      {/* A FLEX ROW, not the day header's grid. `.entry-log-row` used to be
          named here as the opt-in to first-line column alignment; it was never
          actually applied to anything, and the rules it gated in styles.css
          were dead. The row's own `items-center` is what levels it. */}
      <div className="flex min-h-(--entry-row-height) w-full items-center gap-1.5 px-4">
        {selection === undefined ? null : (
          <SelectionCheckbox
            contextual
            label={selection.label}
            state={selection.state}
            onToggle={selection.onToggle}
          />
        )}
        <div className="flex flex-col w-full min-w-0 gap-2 py-1.5">
          {/* `min-h-6` PINS THE FIRST LINE. The fixed columns opposite are
              offset by half of exactly this, so the line cannot be allowed to size itself off
              whichever child happens to be tallest — a picker changing by two
              pixels would otherwise drag the title out of level with the time
              range beside it. */}
          <div className="flex min-h-6 min-w-0 items-center gap-1.5">
            <EditableTitle
              entry={entry}
              onCommit={(next) => actions.onTitleChange(entry, next)}
              // `leading-none`: the 16px title otherwise reserves a 24px line
              // box, and that half-leading is dead space above and below every
              // title in the log. The line's height is `min-h-6` above, set
              // deliberately, rather than whatever the type happens to imply.
              textClassName="text-base leading-none"
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
            {/* THE PROJECT READS AS PART OF THE TITLE, so it sits against it —
                "[B-CB-346] Fixing false status · Sealogs" is one phrase naming
                one piece of work, and a gap between the two halves makes the
                client look like a property of the row's numbers instead. This
                is why `EditableTitle` is deliberately not `flex-1`. */}
            <ProjectPicker
              projects={projects}
              value={entry.projectId ?? null}
              onCreate={actions.onCreateProject}
              onChange={(projectId) => actions.onClassify(entry, { projectId })}
              className={cn(
                "max-w-32 shrink-0",
                entry.projectId === undefined && revealed
              )}
              // The dot survives at every width; the name is what gets dropped
              // when there is no room, because the dot plus the row's own
              // context is enough to tell two clients apart at a glance.
              nameClassName="hidden md:inline"
            />

            {/* TAG AND BILLABLE GO TO THE RIGHT EDGE, against the time column.
                They are marks ON the work rather than part of its name, and
                `ml-auto` is what lands them in a true column: every other grid
                track is a fixed width, so this content cell is identical in
                every row and a right-aligned pair stacks down the log instead
                of ragging along behind titles of different lengths. */}
          </div>

          {/* The 20px slot and its `touch-target` sizing are explained in `NoteLine`.
              Omitted entirely for a sitting's members — see `showNote` above —
              rather than rendered empty, which is what makes the member row
              SHORTER than a plain one instead of merely blank where its note
              would be. */}
          {showNote ? (
            <NoteLine
              note={note}
              notesExpanded={notesExpanded}
              onOpen={() => actions.onNoteOpen(entry)}
            />
          ) : null}
        </div>

        <div className="flex h-full shrink-0 items-center justify-end gap-4">
          <TagPicker
            tags={tags}
            value={entry.tagIds}
            onCreate={actions.onCreateTag}
            onChange={(tagIds) => actions.onClassify(entry, { tagIds })}
            className={cn(
              "hidden sm:inline-flex",
              entry.tagIds.length === 0 && revealed
            )}
          />
          <BillableToggle
            value={entry.billable}
            onChange={(billable) => actions.onClassify(entry, { billable })}
            className={cn("hidden sm:inline-flex", !entry.billable && revealed)}
          />
          <EntryTimePopover
            entry={entry}
            timeZone={timeZone}
            use12Hour={use12Hour}
            weekStartDay={weekStartDay}
            onCommitTime={(field, value) =>
              actions.onTimeChange(entry, field, value)
            }
            onCommitDay={(day) => actions.onDayChange(entry, day)}
          />
          <EditableDuration
            entry={entry}
            onCommit={(ms) => actions.onDurationChange(entry, ms)}
          />
        </div>
        {/*
            Row controls stay in the layout at all times and fade in on hover or
            focus, rather than being added and removed. Reserving the space means
            the columns to their left do not shift when the pointer crosses a row
            — and it is what lets the keyboard reach them at all.

            On a touch screen they are simply always visible. There is no hover
            on a phone, so a hover-revealed control is not subtle there, it is
            absent: delete and resume would be unreachable by any means.
          */}
        <div className="flex h-full items-center justify-end">
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
    <Button
      type="button"
      variant="quiet"
      size="icon-row"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "opacity-100 sm:opacity-0",
        "transition-[opacity,color] sm:group-hover:opacity-100",
        "focus-visible:opacity-100",
        destructive && "hover:text-alarm",
        "motion-reduce:transition-none"
      )}
    >
      {children}
    </Button>
  )
}
