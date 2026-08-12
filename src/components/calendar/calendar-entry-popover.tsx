import { ArrowRight, CalendarDays, Copy, EllipsisVertical, Play, Trash2, X } from "lucide-react"
import {
  BillableToggle,
  ProjectPicker,
  TagPicker,
} from "@/components/classifiers/classifier-pickers"
import { EditableDuration, EditableTitle } from "@/components/entries/editable-fields"
import { EntryTimePopover } from "@/components/entries/entry-time-popover"
import { Button } from "@/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu"
import { Popover } from "@/components/ui/popover"
import { formatTimeOfInstant } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import type { EntryActions } from "@/hooks/use-entry-actions"
import type { Entry } from "@/lib/group-entries"
import type { Doc } from "../../../convex/_generated/dataModel"

/**
 * One entry, edited where it is drawn.
 *
 * THIS REVERSES A DOCUMENTED DECISION, deliberately. The calendar used to
 * navigate rather than edit: a click switched to List, scrolled that entry's row
 * into view and focused it, and raised a toast for the three kinds of block that
 * have no row (the running entry, an unpaginated one, a future one). The
 * argument was that a second editor is a second place to fix the same mistyped
 * field. What it cost in practice was that the most common reason to look at the
 * grid — spotting a block that starts half an hour late — threw away the week
 * you were reading to fix it, and for a third of the blocks it could not even do
 * that.
 *
 * The objection is answered by REUSE rather than by refusal. Every control below
 * is the one the log row already uses — `EditableTitle`, `EditableDuration`,
 * `EntryTimePopover` (with its DST and overnight rules), the three classifier
 * pickers — and every write goes through `useEntryActions`, which is the row's
 * own vocabulary. There is one implementation of each edit; there are two places
 * it is reachable from.
 *
 * WHAT IS NOT HERE. Notes: the sheet belongs to the log, which owns its drafts,
 * and a grid is not where you write prose. Drag to create, move or resize: still
 * out of scope, still for the reason the spec gives — the grid is read-only as a
 * SURFACE, and a click on a block is not a drag.
 */
export function CalendarEntryPopover({
  entry,
  anchor,
  onClose,
  timeZone,
  use12Hour,
  weekStartDay,
  projects,
  tags,
  actions,
}: {
  entry: Entry
  /**
   * The block's own element, handed over by FullCalendar's `eventClick`.
   *
   * There is no `Popover.Trigger` here because there is no element of ours to
   * make one out of — the grid draws the blocks. A midnight TAIL anchors the
   * same entry's popover as its head does: both segments carry the same
   * `entryId`, and the tail is a continuation rather than a second entry, so
   * offering an editor that claimed otherwise would be the Hatch Rule broken
   * from the inside.
   */
  anchor: HTMLElement
  onClose: () => void
  timeZone: string
  use12Hour: boolean
  /** 0 = Sunday, from userSettings. The month grid inside must match the week
   *  totals. */
  weekStartDay: number
  projects: Array<Doc<"projects">>
  tags: Array<Doc<"tags">>
  actions: EntryActions
}) {
  const title = entry.title.trim()
  const label = title === "" ? "this entry" : title
  const running = entry.endedAt === null

  return (
    <Popover.Root
      open
      onOpenChange={(next) => {
        // Escape, an outside press and the × below all arrive here. The panel
        // above drops its selection, which unmounts this — so there is one way
        // closed rather than a local flag that could disagree with it.
        if (!next) onClose()
      }}
    >
      <Popover.Popup
        anchor={anchor}
        // Beside the block rather than under it. A day column is 48px an hour
        // tall and the popover is ~200px; opening downward from a 2 PM block
        // covers the rest of the afternoon, which is the part of the picture
        // the user is comparing against. The positioner flips to the other side
        // on its own when the last column has no room.
        side="right"
        align="start"
        aria-label={`Entry: ${title === "" ? "Untitled" : title}`}
        className="w-[21rem] gap-0 p-0"
      >
        <div className="flex flex-col gap-3 p-3">
          {/*
            THE VERBS, on their own row above the entry rather than beside it.
            The same set the log row offers, in the same order — resume, then
            the destructive things behind a menu — so "what may be done to an
            entry" reads identically in both places.
          */}
          <div className="flex items-center gap-0.5">
            {running ? null : (
              /*
                Resume: a NEW timer carrying this entry's title and
                classification, which is exactly what `useEntryMutations.start`
                takes. Absent while this entry IS the running one, because
                starting another stops it — "resume" would mean stopping the
                thing you are looking at and starting a copy of it.
              */
              <IconButton
                label={`Resume ${label}`}
                onClick={() => {
                  actions.onResume(entry)
                  onClose()
                }}
              >
                <Play className="size-4" />
              </IconButton>
            )}

            {running ? null : (
              /*
                Duplicate goes through `entries.create`, which requires a
                definite `endedAt` — so a running entry has nothing to
                duplicate and the control is absent rather than disabled. A
                disabled button here would be a promise the backend cannot
                keep.
              */
              <IconButton
                label={`Duplicate ${label}`}
                onClick={() => {
                  actions.onDuplicate(entry)
                  onClose()
                }}
              >
                <Copy className="size-4" />
              </IconButton>
            )}

            <Menu>
              <MenuTrigger
                aria-label={`More actions for ${label}`}
                className={ICON_BUTTON}
              >
                <EllipsisVertical className="size-4" />
              </MenuTrigger>
              <MenuContent>
                {/*
                  Delete is the log row's own `onRemove`: the same optimistic
                  drop, the same six-second undo toast naming what went, the
                  same alarm if the undo is itself refused. No confirmation
                  dialog, because that is the posture the log already has and
                  an Undo that works is worth more than a modal that asks.
                */}
                <MenuItem
                  className="text-alarm"
                  onClick={() => {
                    actions.onRemove(entry)
                    onClose()
                  }}
                >
                  <Trash2 className="size-4" />
                  Delete entry
                </MenuItem>
              </MenuContent>
            </Menu>

            <Popover.Close
              aria-label="Close"
              className={cn(ICON_BUTTON, "ml-auto")}
            >
              <X className="size-4" />
            </Popover.Close>
          </div>

          <div className="flex min-w-0">
            <EditableTitle
              entry={entry}
              textClassName="text-base"
              onCommit={(next) => actions.onTitleChange(entry, next)}
            />
          </div>

          {/*
            All three always visible, unlike the log row's hover-reveal. A row
            hides an empty picker because fifty rows of dollar signs is how
            "brass means money" stops meaning anything; a popover is one entry
            that the user has deliberately opened, so every control it offers
            should be on screen.
          */}
          <div className="flex items-center gap-0.5">
            <ProjectPicker
              projects={projects}
              value={entry.projectId ?? null}
              onCreate={actions.onCreateProject}
              onChange={(projectId) => actions.onClassify(entry, { projectId })}
              className="max-w-[10rem]"
            />
            <TagPicker
              tags={tags}
              value={entry.tagIds}
              onCreate={actions.onCreateTag}
              onChange={(tagIds) => actions.onClassify(entry, { tagIds })}
            />
            <BillableToggle
              value={entry.billable}
              onChange={(billable) => actions.onClassify(entry, { billable })}
            />
          </div>

          <div className="flex items-center gap-2">
            {/*
              The whole start–end pair is ONE trigger for the row's own time
              popover, rather than two fields rebuilt here. That popover owns
              the parsing (`0915`, `2pm`), the "an end earlier than its start is
              the next morning" rule, the DST-safe re-dating and the month grid
              — none of which may exist twice. The calendar glyph is what says
              the DAY is editable in there too.
            */}
            <EntryTimePopover
              entry={entry}
              timeZone={timeZone}
              use12Hour={use12Hour}
              weekStartDay={weekStartDay}
              onCommitTime={(field, value) => actions.onTimeChange(entry, field, value)}
              onCommitDay={(day) => actions.onDayChange(entry, day)}
              trigger={
                <button
                  type="button"
                  aria-label={`Edit start, end and day — ${timesLabel(entry, timeZone, use12Hour)}`}
                  className={cn(
                    "flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1",
                    "text-sm text-foreground transition-colors hover:bg-surface",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  )}
                >
                  <CalendarDays
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  {/*
                    `whitespace-nowrap`, on both stamps below. "1:00 PM" is ONE
                    reading, and the space inside it is the only break
                    opportunity in the string — so in a narrow popover the
                    meridiem wrapped to its own line and the row grew to two,
                    which is what the trailing `…` and the `min-w-0` on this
                    button between them made possible. A timestamp broken across
                    lines is not a timestamp; it is two numbers.
                  */}
                  <span className="tabular whitespace-nowrap">
                    {formatTimeOfInstant(entry.startedAt, timeZone, use12Hour)}
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-3 shrink-0 text-muted-foreground"
                  />
                  {/*
                    A running entry has no end, and printing "now" would be a
                    value that looks recorded when it is not — the same
                    ellipsis `formatTimeRange` uses everywhere else.
                  */}
                  <span className="tabular whitespace-nowrap">
                    {entry.endedAt === null
                      ? "…"
                      : formatTimeOfInstant(entry.endedAt, timeZone, use12Hour)}
                  </span>
                </button>
              }
            />

            {/*
              The duration, editable on a completed entry and LIVE on a running
              one — `EditableDuration` already draws that distinction, because
              editing it while running would move the start rather than the
              end. `ml-auto` so the digits pin to the right of the row, which is
              where the log's own duration column puts them.
            */}
            <div className="ml-auto flex items-center gap-2">
              <EditableDuration
                entry={entry}
                onCommit={(ms) => actions.onDurationChange(entry, ms)}
              />

              {/*
                SAVE CLOSES; IT DOES NOT WRITE, and that is not a dead control.
                Every field above commits on Enter and on blur — the discipline
                `inline-edit.tsx` argues for at length — so by the time this
                button's click fires, the pointerdown that moved focus off
                whatever was being typed has already committed it. What the
                button is for is the moment after: a person who has finished
                and wants the panel gone without hunting for the ×.

                `variant="default"` is `bg-primary`, deliberately NOT
                `enlarger`. Cold light means a timer is running; a save button
                wearing it would say so on every completed entry on the grid.
              */}
              <Popover.Close render={<Button size="sm">Save</Button>} />
            </div>
          </div>
        </div>
      </Popover.Popup>
    </Popover.Root>
  )
}

/**
 * The icon controls on the top row.
 *
 * Same 24px box and same quiet-until-hovered colour as `EntryRow`'s, but always
 * at full opacity: the row fades its controls in so a log of fifty does not read
 * as a wall of buttons, and a popover holding one entry has no such problem.
 */
const ICON_BUTTON = cn(
  "rounded-md p-1.5 text-muted-foreground transition-colors",
  "hover:text-foreground",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
)

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={ICON_BUTTON}>
      {children}
    </button>
  )
}

/** What the times trigger reads out, for the label a screen reader hears. */
function timesLabel(entry: Entry, timeZone: string, use12Hour: boolean): string {
  const start = formatTimeOfInstant(entry.startedAt, timeZone, use12Hour)
  if (entry.endedAt === null) return `${start}, still running`
  return `${start} to ${formatTimeOfInstant(entry.endedAt, timeZone, use12Hour)}`
}
