import { useMemo, useState } from "react"
import Calendar from "@fullcalendar/react"
import timeGridPlugin from "@fullcalendar/react/timegrid"
import { CalendarEntryPopover } from "@/components/calendar/calendar-entry-popover"
import { CalendarMeetingPopover } from "@/components/calendar/calendar-meeting-popover"
import { ProjectDot } from "@/components/classifiers/project-dot"
import { MIN_SPAN_MS, calendarEvents, drawnDays } from "@/lib/calendar-events"
import { isMeetingEvent, meetingEvents } from "@/lib/calendar-meetings"
import { formatTimeOfInstant, formatTimeRange } from "@/lib/format-time"
import { formatTotal } from "@/lib/format-total"
import { HATCH_EMPTY } from "@/lib/hatch"
import { cn } from "@/lib/utils"
import { dayOf, dayWindow } from "@shared/day"
import { formatClock } from "@shared/duration"
import type {
  CalendarEventProps,
  CalendarRange,
} from "@/lib/calendar-events"
import type { Meeting, MeetingEventProps } from "@/lib/calendar-meetings"
import type { EntryActions } from "@/hooks/use-entry-actions"
import type { DayString } from "@shared/day"
import type { DurationDisplay } from "@/lib/format-total"
import type { EventApi } from "@fullcalendar/react"
import type { Doc } from "../../../convex/_generated/dataModel"

// Structure only. No theme is imported: every visible surface here is set
// through v7's class-name props, so DESIGN.md's rules are our own Tailwind
// classes rather than overrides fighting a vendored stylesheet — which is the
// failure DESIGN.md §5 records from recharts.
import "@fullcalendar/react/skeleton.css"

const PLUGINS = [timeGridPlugin]

/**
 * The generic timegrid view, deliberately — NOT `timeGridWeek`/`timeGridDay`.
 *
 * Those two carry a `duration` (`{weeks: 1}`, `{days: 1}`), and FullCalendar's
 * dateProfileGenerator consults `visibleRange` only when neither `duration` nor
 * `dayCount` is set. With a duration in the view spec the range prop below is
 * read and then ignored, and the grid quietly computes its own span again —
 * which is the entire defect this file was reshaped to remove.
 */
const VIEW = "timeGrid"

/** 48px an hour, the density every shipping calendar has converged on. */
const SLOT_MIN_HEIGHT = 48

/** Enough that a four-minute entry is still a click target. */
const EVENT_MIN_HEIGHT = 18

/*
 * WHAT ACTUALLY FITS INSIDE A BLOCK, in pixels, measured rather than guessed.
 *
 * Every line of a block's content is 16px: the title is `text-xs font-medium`
 * (16.00 measured) and both meta lines are `text-[0.6875rem]` (15.70, rounded
 * up so the taller of the two governs). `gap-0.5` puts 2px between them. The
 * block spends 7px on itself before any text — `mb-px`, its two 1px borders,
 * and `py-0.5` at each end.
 *
 * This exists because the content DID NOT ADAPT. Three lines needed 63px of
 * block, which is 79 minutes at 48px an hour, so every entry shorter than that
 * had its project name sliced through by the bottom edge — measured in Chrome
 * as `content.scrollHeight = 51` inside a `clientHeight` of 34 on a 45-minute
 * block. `overflow-hidden` made it a clean cut rather than a spill, which is
 * why it survived: it looked like a design decision.
 *
 * `py-0.5` AND NOT `py-1`, which is the one place this scale is worth arguing
 * about. Vertical padding at the bottom of the range is not spacing, it is
 * minutes: each pixel at both ends costs 2.5 minutes of the shortest block that
 * can still show its own title. At `py-1` that floor is 34 minutes, which
 * silences the commonest block in this product — the half-hour meeting — and
 * at `py-0.5` it is 29.
 */
const LINE_PX = 16
const LINE_GAP_PX = 2
const BLOCK_CHROME_PX = 1 + 2 + 4

/** What a block of this pixel height can show without clipping any of it. */
type BlockFit = { titleLines: 0 | 1 | 2; time: boolean; project: boolean }

/**
 * The content a block has room for, in the order the information is worth
 * reading.
 *
 * TITLE FIRST, always: a block's position on the axis already says when it ran,
 * which is the entire point of a time grid, so the title is the one thing the
 * picture cannot supply. Then the times (exact minutes the axis only
 * approximates), then the project. The last row bought is a SECOND TITLE LINE —
 * which is what the report of "titles truncate to … earlier than they need to"
 * actually was: a two-hour block has 70px of room and was spending 52 of it,
 * truncating a title with a blank third of the block underneath it.
 *
 * `hasProject` is taken rather than assumed because `ProjectDot` renders
 * nothing at all for an unclassified entry — so on those, the row the project
 * would have used is free for the title's second line instead of being left
 * empty.
 */
function blockFit(heightPx: number, hasProject: boolean): BlockFit {
  const rows = Math.floor(
    (heightPx - BLOCK_CHROME_PX + LINE_GAP_PX) / (LINE_PX + LINE_GAP_PX)
  )
  if (rows <= 0) return { titleLines: 0, time: false, project: false }
  if (rows === 1) return { titleLines: 1, time: false, project: false }
  if (rows === 2) return { titleLines: 1, time: true, project: false }
  if (rows === 3) {
    return hasProject
      ? { titleLines: 1, time: true, project: true }
      : { titleLines: 2, time: true, project: false }
  }
  return { titleLines: 2, time: true, project: hasProject }
}

/**
 * How tall FullCalendar will draw this block, from the same numbers it uses.
 *
 * The grid is a linear scale — `SLOT_MIN_HEIGHT` pixels per hour — so a
 * segment's height is its span, floored at `EVENT_MIN_HEIGHT`. Overlap packing
 * changes a block's WIDTH and never its height, so nothing here has to know
 * about it.
 *
 * CLIPPED AT MIDNIGHT, through `@shared/day` like every other boundary in this
 * product. An entry that crosses midnight is drawn as two segments and this
 * runs for the head, whose height is start-to-midnight rather than the whole
 * entry — a 23:00–04:00 shift is a one-hour block on the day it started, and
 * sizing its text for five hours would put four lines in a box with room for
 * one. The tail returns before this is reached; it carries no text by the Hatch
 * Rule.
 */
function blockHeightPx(
  startedAt: number,
  endedAt: number | null,
  nowMs: number,
  timeZone: string
): number {
  const dayEndMs = dayWindow(dayOf(startedAt, timeZone), timeZone).toMs
  // The same one-minute floor `calendarEvents` applies, so a zero-length entry
  // is measured as the block the grid actually draws for it.
  const drawnEnd = Math.min(
    Math.max(endedAt ?? nowMs, startedAt + MIN_SPAN_MS),
    dayEndMs
  )
  const hours = (drawnEnd - startedAt) / 3_600_000
  return Math.max(EVENT_MIN_HEIGHT, hours * SLOT_MIN_HEIGHT)
}

/*
 * Hour rules and column dividers.
 *
 * A COLOUR ALONE DRAWS NOTHING. Tailwind's preflight sets `border: 0 solid` on
 * every element, `skeleton.css` only ever REMOVES borders, and the widths a
 * calendar normally gets live in `themes/`, which this file deliberately does
 * not import — so `border-edge-soft` without a width is an invisible grid.
 *
 * A full `border` on each of these is right rather than excessive, because the
 * skeleton subtracts the edges that would double up, with `!important`: the
 * first lane and the first column get `border: 0` (`.fc-Tu`), the remaining
 * lanes lose left/right/bottom (`.fc-hU`) and the remaining columns lose
 * top/bottom/end (`.fc-PB`). What survives is exactly one rule per hour and one
 * per column boundary. It is the same mechanism every bundled theme uses.
 *
 * Edge Soft throughout: these are dividers between passive content, where no
 * contrast floor applies.
 */
/*
 * `h-12` IS THE ROW HEIGHT, because `slotMinHeight` does not survive here.
 *
 * The prop is passed and typed and FullCalendar accepts it, and the rows still
 * came out ~21px — measured in the browser, 24 slots inside a 564px grid. It is
 * a MINIMUM, and it is only consulted on the path that expands rows to fill a
 * definite height; with `height="auto"` there is no height to fill, so the
 * table simply sizes to its content and the minimum is never asked about.
 *
 * 48px an hour is the density every shipping calendar has converged on, and it
 * is the difference between a half-hour entry being a readable block and being
 * a 10px sliver. So the row states its own height rather than asking for a
 * floor: `h-12` is exactly the 48 `SLOT_MIN_HEIGHT` names, and that constant is
 * still what `slotMinHeight` is given, so the two cannot drift.
 */
const HOUR_RULE = "h-12 border border-edge-soft"
const COLUMN_RULE = "border border-edge-soft"
/** The hour rail's own boundary. No cell border can draw it — the first
 *  column's are all stripped — so this divider element is what separates the
 *  hours from the grid, in the header row and in the body alike. */
const RAIL_RULE = "border-r border-edge-soft"

/*
 * A BLOCK IS A BUTTON, AND NOW LOOKS LIKE ONE.
 *
 * FullCalendar already makes it one: registering `eventClick` is what makes
 * `getEventTagAndAttrs` return `role="button"`, `tabIndex: 0` and an
 * Enter/Space handler. So every block on this grid has been keyboard-reachable
 * and keyboard-activatable since the click became an editor — with nothing on
 * screen to say so at either end of the interaction.
 *
 * THE CURSOR, because FullCalendar will not supply it. Its own `cursorPointer`
 * is applied on `(url || isDraggable)`, and ours is neither: the entries carry
 * no `url` and dragging is out of scope by decision. A `role="button"` under an
 * arrow cursor is a control that has to be guessed at.
 *
 * THE FOCUS RING IS AN OUTLINE, NOT A BORDER SHIFT — DESIGN.md's second focus
 * pattern, for a control whose border already carries state. This border says
 * three different things already (`enlarger` = running, `edge-raised` =
 * completed, the hatch's dashed rule = a midnight continuation), and
 * spending it on focus would delete whichever one the focused block was saying.
 *
 * `-outline-offset-2`, INSET, where the timer bar's version of this pattern
 * uses `outline-offset-2`. The bar sits on open ground and can afford to put
 * ground on both sides of its outline; a block cannot. It is inset from its
 * harness by only the 2px `mx-0.5` below, and an overlapping block is packed
 * hard against it — so an outward outline would be drawn across the neighbour
 * it is meant to be distinguished from. Inset, it lands wholly on the block's
 * own fill: `ring` on `surface-raised` is measured in `styles.contrast.test.ts`
 * and clears the 3:1 that SC 2.4.11 asks of it. `overflow-hidden` on the block
 * does not clip this — overflow clips descendants, not an element's own
 * outline.
 *
 * NO TRANSITION, which is the same call the block's own comment makes below and
 * for a stricter reason than it needed: a running block's height is rewritten
 * once a second, and this element is the one being hovered. An instant fill
 * change needs no `prefers-reduced-motion` alternative because there is no
 * motion to reduce.
 */
const BLOCK_INTERACTIVE = cn(
  "cursor-pointer",
  "focus-visible:outline-2 focus-visible:-outline-offset-2",
  "focus-visible:outline-ring"
)

/*
 * THE HOVER LIFT, one step up the neutral ramp — and it has to be MIXED rather
 * than layered.
 *
 * `hover:bg-foreground/5` is the obvious spelling and it is wrong here: a
 * `hover:bg-*` REPLACES the block's `bg-surface-raised` rather than sitting on
 * top of it, so 5% ivory would composite over the LANE (`surface`, L 0.22) and
 * land at roughly L 0.24 — darker than the 0.26 it was before the pointer
 * arrived. A hover that dims the thing under the cursor is worse than none.
 *
 * `color-mix` states the destination instead of a layer over a guess, which is
 * the idiom `ui/tabs.tsx` already uses for the same problem. 8% of Ink into
 * Surface Raised is ~L 0.31: a clear step at a glance, and still well under the
 * `edge-raised` border that has to keep reading as this block's boundary.
 */
const BLOCK_HOVER =
  "hover:bg-[color-mix(in_oklch,var(--surface-raised),var(--foreground)_8%)]"

/*
 * The same step for a RUNNING block, spent in its own light rather than in
 * ivory. Cold light is legal here and nowhere else on this grid, because this
 * block is the one thing on screen that IS running — mixing ivory into it would
 * wash the one signal the Cold Light Rule reserves.
 */
const RUNNING_HOVER = "hover:bg-enlarger/25"

/*
 * A MEETING IS AN OUTLINE, AN ENTRY IS A FILL.
 *
 * DESIGN.md leaves exactly one axis free here and it happens to be the right
 * one. `enlarger` means *a timer is running* (the Cold Light Rule) and cannot be
 * spent on a meeting. Hue means money under the Two Temperatures Rule and blocks
 * take none. A dashed border plus hatch is the Hatch Rule's midnight
 * continuation and is already spoken for.
 *
 * What is left is FILL, and an unfilled block is a true statement: this is
 * scheduled time, not recorded time. It also reads correctly in peripheral
 * vision, which is where this page lives — the filled blocks are the day's
 * substance and the outlines are its plan.
 *
 * `bg-transparent` is stated rather than omitted: the lane behind it is
 * `surface`, and letting the block inherit nothing is what makes the ghost read
 * as a hole in the grid rather than as a second surface.
 */
/*
 * Split in two so the midnight TAIL can take the box without the outline —
 * `HATCH_EMPTY` carries its own dashed border, and a solid `border-edge-soft`
 * beside it would win on source order and erase the dash. The head is
 * `MEETING_BLOCK_BOX + MEETING_BLOCK_OUTLINE`, which is what `MEETING_BLOCK`
 * used to be in one piece.
 */
const MEETING_BLOCK_BOX = cn(
  "mx-0.5 mb-px overflow-hidden rounded-md px-1 py-0.5 text-left",
  "bg-transparent text-muted-foreground",
  "hover:bg-[color-mix(in_oklch,var(--surface),var(--foreground)_5%)]"
)
const MEETING_BLOCK_OUTLINE = "border border-edge-soft"

/**
 * The empty meetings list, ONE allocation for the life of the module.
 *
 * A `meetings = []` default — or a `?? []` in the page above — mints a fresh
 * array on every render, and this component re-renders once a second. That array
 * is in the `events` memo's dependency list, so a new one busts the memo every
 * tick and reallocates the whole events array forever: exactly the defect the
 * `clockMs` comment below was written to fix, reintroduced through the door
 * beside it. Exported so the page uses the same constant rather than its own
 * literal.
 */
export const NO_MEETINGS: Array<Meeting> = []

/*
 * ENTRIES FIRST when a meeting and an entry share a window — AND FullCalendar's
 * OWN ORDER FOR EVERYTHING ELSE.
 *
 * The first spec is ours. Two blocks in the same hour only happens on a
 * calendar that is shown but whose meetings have produced no entries — a
 * tracked meeting's ghost is not drawn at all — and in that case the RECORDED
 * thing should hold the left column: it is the one that counts toward the total
 * and can be edited. A comparator rather than a field name, because the
 * ordering key is which population a block belongs to and that lives on
 * `extendedProps`, which no field-spec string can reach.
 *
 * THE FOUR STRINGS AFTER IT ARE NOT DECORATION. `parseFieldSpecs` REPLACES the
 * `eventOrder` default (`'start,-duration,allDay,title'`) with whatever it is
 * given; handed a bare function it produces a ONE-spec list, and
 * `compareByFieldSpecs` then returns 0 for any two blocks of the same
 * population. `Array.sort` is stable, so those ties fell back to the order of
 * the events array — which comes from `entries.listRange`'s `.order("desc")`.
 * Two overlapping ENTRIES therefore packed latest-start leftmost, silently
 * inverting pre-existing behaviour that this feature had no business touching.
 * Restating the defaults after the comparator puts them back.
 *
 * `as` BECAUSE THE TYPE IS NARROWER THAN THE PARSER. `FieldSpecInput<Subject>`
 * is `string | string[] | Func | Func[]` — it has no member for a MIXED array,
 * while `parseFieldSpecs` itself walks the array and switches on `typeof token`
 * per element, handling strings and functions in any arrangement (verified in
 * node_modules/@fullcalendar/react/chunks). `unknown` in the comparator's
 * signature is honest for the same reason the old inline version documented:
 * `CalendarOptions` instantiates `parseFieldSpecs<Subject>` with nothing to
 * infer `Subject` from, so `(a: EventApi, b: EventApi) => number` is rejected
 * outright. `propsOf` recovers the real shape.
 *
 * Module-level rather than inline, so the prop is reference-stable across the
 * once-a-second re-render this component lives under.
 */
const EVENT_ORDER = [
  (a: unknown, b: unknown) => {
    const rank = (event: unknown) =>
      isMeetingEvent(propsOf(event as EventApi)) ? 1 : 0
    return rank(a) - rank(b)
  },
  "start",
  "-duration",
  "allDay",
  "title",
] as unknown as Parameters<typeof Calendar>[0]["eventOrder"]

/**
 * The calendar grid.
 *
 * FullCalendar owns what a time grid is genuinely hard at: packing overlapping
 * blocks into columns, segmenting an entry that crosses midnight, the
 * now-line, and a minimum block height. What is ours is the mapping in
 * (`calendar-events.ts`) and the styling out (every `*Class` prop below).
 *
 * THE COLD LIGHT RULE IS THE THING TO WATCH IN HERE. A running entry's block
 * is the only `enlarger` on the grid. The now-indicator marks *now*, not
 * *running*, so it is Ink Muted — cold light on a grid where nothing is being
 * tracked is exactly the failure that rule exists to prevent.
 */
export function CalendarPanel({
  entries,
  range,
  timeZone,
  weekStartDay,
  use12Hour,
  display,
  nowMs,
  dayTotals,
  projects,
  projectsById,
  tags,
  actions,
  meetings = NO_MEETINGS,
}: {
  entries: Array<Doc<"timeEntries">>
  /**
   * The window to draw, computed by the page with `rangeOf`.
   *
   * THE GRID NO LONGER DECIDES THIS. It used to: `firstDay` plus `hiddenDays`
   * produced a span, `datesSet` reported it upward, and the page labelled and
   * queried whatever came back. That could only work while the range lived in
   * Calendar view — the range bar is on screen in List now, and in List no
   * grid is mounted to report anything. One computation, in one pure function,
   * consumed here and by the label, the query and the total alike.
   */
  range: CalendarRange
  timeZone: string
  /** Which weekday a 7-day week opens on. It no longer decides the SPAN — see
   *  `range` — but FullCalendar still reads it for week-boundary work inside
   *  the view, and the 5-day view's Monday is now `rangeOf`'s business. */
  weekStartDay: number
  use12Hour: boolean
  display: DurationDisplay
  nowMs: number
  /**
   * Milliseconds tracked per local day, for the column headers.
   *
   * COMPUTED BY THE PAGE, not here. This component used to build it from
   * `entries` with `calendar-events.ts`'s `dayTotals`, behind a guard that
   * pinned the clock while nothing was running — and /timer then built the
   * identical map from the identical array to sum "Range total", against the
   * raw once-a-second clock, defeating the guard one level up and doing the
   * work twice per tick. One pass now, in the page, guarded there, read here
   * per column and summed there for the figure above the columns.
   */
  dayTotals: Map<DayString, number>
  /** The pickers' options. `projectsById` is the same list keyed for the render
   *  hooks, which look a block's project up once per block per render. */
  projects: Array<Doc<"projects">>
  projectsById: Map<string, Doc<"projects">>
  tags: Array<Doc<"tags">>
  /**
   * What a block's popover may do to its entry — the log row's own vocabulary,
   * from `useEntryActions`.
   *
   * PASSED IN, not reached for, exactly as `EntryRow` takes its actions: this
   * component stays renderable against fixtures with no backend anywhere near
   * it, and every write in the product still originates in one hook.
   */
  actions: EntryActions
  /**
   * Google meetings for this range, from `google.listMeetings`.
   *
   * A SECOND POPULATION on one grid, and the block styling is what keeps them
   * apart. Defaults to `NO_MEETINGS` so a caller with no Google link — and every
   * existing test — renders exactly as before.
   */
  meetings?: Array<Meeting>
}) {
  /*
   * THE CLOCK, ADMITTED ONLY WHEN SOMETHING IS ACTUALLY RUNNING.
   *
   * `nowMs` advances once a second for the life of the tab, and the memo below
   * takes it — so it re-ran every second, reallocating the whole events array
   * (two `Date`s per entry), forever. On a page this product describes as an
   * always-open desktop companion.
   *
   * But `nowMs` only ever REACHES the output through a running entry: it is
   * where `calendarEvents` ends a block with no `endedAt`. With nothing running
   * — every past week, and the current one whenever the timer is stopped, which
   * is the ordinary case — each tick rebuilt an array byte-identical to the one
   * before it.
   *
   * So the clock is pinned to `0` unless an entry in view has no end. Pinning
   * rather than dropping it from the dependency list: a deliberately incomplete
   * dependency array is a stale closure waiting for the next reader to trip
   * over, whereas passing a value that provably cannot be read keeps the memo
   * honest and the lint rule satisfied. `0` is never observable — the only code
   * that would read it is the `entry.endedAt ?? nowMs` branch that this flag
   * says nothing takes.
   *
   * THE DAY TOTALS USED TO BE GUARDED HERE TOO, and that guard was undone by
   * the page above: /timer built the same map from the same array against the
   * raw `nowMs` to sum "Range total". Both the guard and the single pass live
   * in `timer.tsx` now, and the map arrives as `dayTotals`.
   */
  const clockMs = entries.some((entry) => entry.endedAt === null) ? nowMs : 0

  /*
   * WHICH COLUMN IS TODAY, computed here rather than taken from FullCalendar.
   *
   * `DayHeaderInfo` and `DayLaneInfo` both carry an `isToday` and it is
   * tempting, and it is a SECOND ANSWER to a question this product answers in
   * one place: FullCalendar derives it from the machine clock against its own
   * `todayRange`, while every other "what day is it" on this page — the page's
   * range, the day totals below, `groupByDay` in the log — comes from `dayOf`
   * against `nowMs`. Two derivations of one boundary is the defect this whole
   * feature was reshaped to remove once already, and the failure mode is the
   * quiet one: a user whose stored zone is not their browser's would see the
   * grid ring a different column from the one the totals call today.
   *
   * Recomputed every render, which is once a second. `dayOf` is one
   * `Intl.DateTimeFormat` lookup and the header hook below already runs it once
   * per column per render; one more is not a cost worth memoising against.
   */
  const today = dayOf(nowMs, timeZone)

  /*
   * THE BLOCK THAT IS BEING EDITED, and the element its popover hangs off.
   *
   * The element rather than only the id, because the grid draws the blocks and
   * there is no `Popover.Trigger` of ours to anchor to — FullCalendar's
   * `eventClick` hands over the node it built, and Base UI's positioner takes
   * it directly.
   *
   * The ENTRY is looked up from `entries` on every render rather than stored
   * here, so an edit made inside the popover is reflected by the popover: the
   * Convex subscription pushes the new row through this prop, and a snapshot
   * taken at click time would show the user their own edit failing to appear.
   * It also means a row that is deleted — or that leaves the range because its
   * day was changed — closes the popover by simply not being found.
   */
  const [selected, setSelected] = useState<{
    entryId: string
    anchor: HTMLElement
  } | null>(null)

  const editing =
    selected === null
      ? null
      : (entries.find((entry) => entry._id === selected.entryId) ?? null)

  /*
   * The MEETING being read, looked up from `meetings` on every render for the
   * same reason `editing` is looked up from `entries`: a sync that removes the
   * event — cancelled in Google, or the calendar hidden — closes the popover by
   * simply not finding it, with no second flag that could disagree.
   */
  const [selectedMeeting, setSelectedMeeting] = useState<{
    calendarId: string
    eventId: string
    anchor: HTMLElement
  } | null>(null)

  const reading =
    selectedMeeting === null
      ? null
      : (meetings.find(
          (meeting) =>
            meeting.calendarId === selectedMeeting.calendarId &&
            meeting.eventId === selectedMeeting.eventId
        ) ?? null)

  /*
   * ONE ARRAY, TWO POPULATIONS.
   *
   * FullCalendar takes a single `events` array and hands back a single
   * `EventApi` from `eventClick`, so the discriminator has to travel on
   * `extendedProps` rather than in a second source. `isMeetingEvent` is the only
   * place that is read.
   *
   * `meetings` is NOT in the clock's dependency: a meeting's end is a stored
   * instant, so nothing in that half of the array moves with `nowMs`.
   */
  const events = useMemo(
    () => [...calendarEvents(entries, clockMs), ...meetingEvents(meetings)],
    [entries, clockMs, meetings]
  )

  /*
   * NAVIGATION, and the one hazard this prop carries.
   *
   * `visibleRange` is refined by `identity` and is absent from FullCalendar's
   * `COMPLEX_OPTION_COMPARATORS`, so it is compared by REFERENCE — a fresh
   * object rebuilds the dateProfileGenerator, which rebuilds the dateProfile,
   * which re-fires `datesSet` and calls `resetScroll()`. `nowMs` ticks every
   * second, so an inline `{ start, end }` would snap the grid back about once a
   * second and make it unscrollable; with anything listening on `datesSet` it
   * is worse than a nuisance, because the re-render allocates another object
   * and the loop is unbounded — React ends it with "Maximum update depth
   * exceeded". `hiddenDays` used to carry exactly this hazard, for exactly this
   * reason, and `calendar-panel.test.tsx`'s re-render test is what holds it
   * shut.
   *
   * Memoised on the two INSTANTS rather than on `range`, so a page that
   * recomputes an equal range (it does, once a second) does not rebuild this.
   *
   * The `Date`s are absolute instants, computed by `rangeOf` through
   * `@shared/day` — never a wall-clock string, which FullCalendar would
   * reinterpret in the calendar's own zone.
   *
   * This is also what MOVES the grid. `initialDate` is read once, at init, and
   * every later render dispatches `IDLE`; changing it is inert. Changing
   * `visibleRange` is not — the manager rebuilds the generator when its inputs
   * differ, so the columns follow the range without a controller, a `gotoDate`
   * or a remount.
   */
  const visibleRange = useMemo(
    () => ({ start: new Date(range.fromMs), end: new Date(range.toMs) }),
    [range.fromMs, range.toMs]
  )

  return (
    <>
    <Calendar
      plugins={PLUGINS}
      initialView={VIEW}
      visibleRange={visibleRange}
      // Where the FIRST profile is built from, before the range above overrides
      // it. Kept because `getInitialDate` defaults to *now*, and a grid whose
      // internal date starts three months from what it is drawing relies on the
      // reducer's out-of-range clamp to correct itself.
      initialDate={range.days[0]}
      // The user's STORED zone, never the browser's. This is the whole reason
      // v7 is usable here: it resolves an IANA name through temporal-polyfill,
      // so the grid's midnight and `convex/lib/day.ts`'s midnight are the same
      // instant.
      timeZone={timeZone}
      // Which weekday a week opens on. It no longer picks the SPAN — the range
      // above does — and in particular the 5-day view is Mon–Fri because
      // `rangeOf` says so, not because `hiddenDays` trimmed a week built from
      // here. That pairing is gone: it removed hidden days only off the ENDS of
      // the week, so a weekend in the INTERIOR survived and 31 of the 49
      // (weekStartDay × anchor) combinations drew something other than Mon–Fri.
      firstDay={weekStartDay}
      headerToolbar={false}
      // Nothing here is all-day. An entry is a span of a working day, and an
      // empty all-day rail above every column is a band of nothing.
      allDaySlot={false}
      nowIndicator
      slotDuration="01:00:00"
      slotMinHeight={SLOT_MIN_HEIGHT}
      eventMinHeight={EVENT_MIN_HEIGHT}
      /*
       * THE WHOLE DAY, AT FULL HEIGHT. No inner scroller.
       *
       * `"auto"` lets the grid run to its natural height — 24 hours at
       * `SLOT_MIN_HEIGHT` — so every hour is on the page and the PAGE is what
       * scrolls. Two earlier arrangements are worth recording, because each is
       * the obvious thing to reach for again:
       *
       *   `height={640}` — a constant with no argument behind it. The grid was
       *   640px in a 1400px window, scrolling internally while a third of the
       *   page sat empty beneath it.
       *
       *   `height="100%"` against a viewport-sized container — better, and still
       *   a cap. It made the grid exactly as tall as the window and no taller,
       *   which on a 24-hour axis means most of the day is behind a scrollbar
       *   inside a page that does not scroll. Two scroll contexts, and the one
       *   holding the content was the one the wheel did not reach first.
       *
       * The cost of `"auto"`, paid deliberately: FullCalendar only makes its
       * body a scroll container when it has a definite height, so the day-header
       * row is no longer pinned by the library. `tableHeaderClass` below pins it
       * with CSS instead, against the same measured offset the log's day headers
       * use — so the columns stay labelled all the way down.
       *
       * `scrollTime` and `scrollTimeReset` went with the inner scroller. There
       * is nothing left to position: with the full day on the page, "open where
       * the work is" would have to move the PAGE's scroll on the user's behalf,
       * which fights the scroll they own and the sticky header both.
       */
      height="auto"
      expandRows={false}
      events={events}
      datesSet={(info) => {
        /*
         * A CHECK, NOT THE SOURCE.
         *
         * This used to be where the range came FROM: the grid computed a span
         * and handed it up, and the page labelled, queried and totalled
         * whatever arrived. Now the page says what to draw and this says
         * whether the grid drew it. The two can only disagree if FullCalendar
         * has quietly stopped honouring `visibleRange` — a view spec that
         * regrows a `duration`, a hidden-day set, a `validRange` clamp — and
         * that is the class of defect this component has shipped once already:
         * a header labelling one week above columns showing another, on a tool
         * people invoice from.
         *
         * `console.error` rather than a thrown error or a silent correction. A
         * throw takes the page down over a cosmetic disagreement; a correction
         * puts the second source of truth straight back. Loud, in the console,
         * and asserted in `calendar-range-label.test.tsx`, which walks all 49
         * (weekStartDay × anchor) combinations and fails if this ever fires.
         *
         * No dedupe ref is needed any more: nothing here sets state, so this
         * cannot feed itself, and FullCalendar only fires it when the
         * dateProfile actually changes.
         */
        const fromMs = info.start.getTime()
        const toMs = info.end.getTime()
        const drawn = drawnDays(fromMs, toMs, timeZone, [])

        if (
          fromMs !== range.fromMs ||
          toMs !== range.toMs ||
          drawn.join(",") !== range.days.join(",")
        ) {
          console.error(
            "CalendarPanel drew a range other than the one it was given.",
            { asked: range, drew: { fromMs, toMs, days: drawn } }
          )
        }
      }}
      /*
       * A CLICK OPENS AN EDITOR, ANCHORED TO THE BLOCK.
       *
       * It used to switch to List, scroll that entry's row into view and focus
       * it — and for three kinds of block (the running entry, one outside the
       * loaded pages, one dated ahead of today) there was no row to land on, so
       * it raised a toast and stayed put. The spec argued that at length under
       * "Read, not draw", and the spec has been rewritten: the grid still draws
       * nothing by drag, but a block is now editable in place. Every control in
       * that popover is the log row's, and every write goes through the same
       * hook, so "two places to fix the same mistyped field" is two doors onto
       * one implementation rather than two implementations.
       *
       * `info.el` is the block's own element. A midnight TAIL hands over the
       * same `entryId` as its head — both segments are one entry — so clicking
       * a continuation opens that entry's editor rather than pretending there
       * is a second entry to edit.
       */
      eventClick={(info) => {
        info.jsEvent.preventDefault()
        const props = propsOf(info.event)
        if (isMeetingEvent(props)) {
          setSelectedMeeting({
            calendarId: props.calendarId,
            eventId: props.eventId,
            anchor: info.el,
          })
          return
        }
        setSelected({ entryId: props.entryId, anchor: info.el })
      }}
      eventOrder={EVENT_ORDER}
      // ---- Styling. One prop per element; no stylesheet override anywhere. --
      className="text-sm"
      /*
       * FULL-BLEED: no radius, no side or bottom border.
       *
       * This was `rounded-lg border border-edge-soft`, which drew the grid as a
       * card floating on the page — and DESIGN.md's elevation section is
       * explicit that depth here is tonal, not cast, with a card treatment
       * reserved for genuinely floating UI. The grid is not floating; it is the
       * page's whole remaining surface, reaching both edges the way the filter
       * band above it does.
       *
       * A radius on a box flush with the viewport is also just wrong: the
       * corners curve away from edges that are still there, leaving two slivers
       * of ground that read as a rendering fault.
       *
       * No TOP border either — `FilterBand` directly above already ends in a
       * `border-b`, and a second hairline against it is a two-pixel rule nobody
       * asked for. `bg-surface` alone is what separates the grid from the ground
       * behind it, which is the tonal step DESIGN.md asks for.
       */
      /*
       * NO `overflow-hidden` HERE, and that is not a tidy-up — it is what makes
       * the sticky day-header row work at all.
       *
       * `position: sticky` pins against the nearest SCROLLING ancestor. An
       * ancestor with `overflow: hidden` becomes that ancestor, and this one
       * never scrolls — so the header had a correct `top` of 184px, was
       * correctly `position: sticky`, and still slid straight off the screen,
       * because it was pinning inside a box that does not move. Measured at
       * -329px while the page had scrolled 697.
       *
       * It was only ever here to clip the `rounded-lg` corners, and those went
       * when the grid became full-bleed. Nothing needs clipping now.
       */
      viewClass="bg-surface"
      tableClass="bg-surface"
      /*
       * THE DAY HEADERS STAY PUT, pinned by CSS rather than by the library.
       *
       * With `height="auto"` there is no inner scroller for FullCalendar to
       * hold them above, and the whole point of a column header is that it is
       * readable while you are looking at the column — a grid scrolled to 4 PM
       * with the dates off screen is seven unlabelled columns of blocks.
       *
       * `top-(--log-sticky-top)` is the same measured offset the log's own day
       * headers stick to: the shell's timer bar plus this page's header. So the
       * dates come to rest exactly under the filter band, in the same place the
       * log's day headers do, and neither has to know the other's number.
       *
       * `z-10` matches the log's day headers — one step under the page header's
       * `z-20` and two under the timer bar's `z-30`, which is the ladder
       * `page.tsx` argues for: the thing higher up the screen passes over.
       *
       * `bg-surface`, opaque, and a `border-b`: rows scroll under this, and a
       * transparent sticky element is a window onto them.
       */
      /*
       * `top-…!` IS LOAD-BEARING, and the `!` is the whole fix.
       *
       * THE CANONICAL EXPLANATION FOR EVERY `!` IN THIS FILE. The other two
       * sites — `px-2! py-2!` and `items-center!` on `dayHeaderClass` — point
       * here rather than restating it, because the reasoning is easy to get
       * subtly wrong and the wrong version invites a change that breaks all
       * four at once.
       *
       * WHAT WENT WRONG. `skeleton.css` already makes this row
       * `position: sticky; top: 0 !important`, and a plain
       * `top-(--log-sticky-top)` lost to it: the computed `top` stayed `0px`,
       * the row pinned to the very top of the VIEWPORT, and the page header —
       * `z-20` against this row's `z-10` — drew straight over it. The dates
       * vanished under the range bar the moment you scrolled, which reads as
       * "the header does not stick" even though it was sticking perfectly,
       * just to the wrong line.
       *
       * WHY IT LOST, precisely: an author `!important` declaration outranks
       * every author NORMAL declaration, whatever layer either sits in and
       * whatever their specificity. Layers never entered it. (It is separately
       * true that unlayered NORMAL declarations beat layered ones — that is
       * what made our own unlayered `.hatch-empty` win before it became utilities — but
       * that is a different rule and it is not what happened here.)
       *
       * WHY THE `!` WINS. It makes ours important too, and for IMPORTANT
       * declarations CSS Cascade 5 INVERTS the layer order: the earliest layer
       * wins, and UNLAYERED-important is the WEAKEST of all. `skeleton.css` is
       * imported as a plain stylesheet — unlayered — so its `top: 0 !important`
       * is the weakest important declaration in the document, and Tailwind's
       * `@layer utilities` important beats it. That inversion is the entire
       * mechanism, and it is why the `!` modifiers are the MINIMAL CORRECT FIX
       * rather than a blunt instrument.
       *
       * WHAT NOT TO DO, and it is the obvious tidy-up: moving `skeleton.css`
       * into a low-priority `@layer vendor` would REVERSE this. Its ~130
       * `!important` rules would stop being unlayered — the weakest — and
       * become the strongest important declarations in the sheet, since a
       * layer declared before `utilities` wins the inverted ordering. All four
       * `!` sites in this file would break at once, silently, with the class
       * lists still reading correctly.
       */
      tableHeaderClass="sticky top-(--log-sticky-top)! z-10 border-b border-edge-soft bg-surface"
      tableBodyClass="bg-surface"
      slotLaneClass={HOUR_RULE}
      slotHeaderClass={HOUR_RULE}
      slotHeaderDividerClass={RAIL_RULE}
      dayLaneClass={COLUMN_RULE}
      slotHeaderContent={(info) => (
        /*
         * Through the app's own formatter, not FullCalendar's.
         *
         * timegrid's own label is "9am"; `formatTimeOfInstant` says "9:00 AM",
         * and it is what every other time in the product is spelled with. Two
         * casings of the same clock on one screen is the defect. It also caches
         * its `Intl.DateTimeFormat`, which matters here: this hook runs 24
         * times per render, and this component re-renders every second.
         *
         * The Tabular Rule: every digit the user reads, at any size.
         *
         * `px-3` rather than `pr-2`. The rail is as wide as this label plus its
         * padding, so this is the only control over how far the hours sit from
         * both the viewport edge and the divider they label across — and at
         * `pr-2` with no left padding, "12:00 AM" started on the page's first
         * pixel and ended 8px from the first column's blocks. 12px each side
         * puts the digits inside a margin on the left and clear of the grid on
         * the right, and the first column's blocks add 2px of their own (see
         * `columnEventClass`).
         */
        <span className="font-mono tabular-nums tracking-[-0.02em] px-3 text-xs text-muted-foreground">
          {formatTimeOfInstant(info.date.getTime(), timeZone, use12Hour)}
        </span>
      )}
      /*
       * TODAY'S COLUMN IS MARKED AT THE TOP OF IT, and deliberately not down
       * its length.
       *
       * A tonal wash on the LANE was the first shape of this and it is the one
       * to argue against, because it looks free and is not: a lane is
       * `surface` (L 0.22) and the blocks standing on it are `surface-raised`
       * (L 0.26), which is the whole 0.04 that makes a block read as an object
       * rather than as a stain. Any wash big enough to see spends most of that
       * gap, and it spends it on the column where the blocks most need it —
       * today's, which is the one being worked in.
       *
       * So the marker goes where it costs nothing and is never off screen
       * anyway: this row is `sticky`, so a column labelled at the top is
       * labelled at every scroll position. `surface-raised` on the cell is the
       * same step the log's own hovered rows use, and it is the ramp rather
       * than a hue — `enlarger` here would say A TIMER IS RUNNING about a day.
       */
      /*
       * `px-2! py-2!` — THE `!` AGAIN, same cause as the sticky header's
       * `top-…!` above. `skeleton.css` zeroes cell padding with `!important`,
       * so a plain `py-2` here computed to `0px` on all four sides: measured in
       * Chrome as `padding: 0px 0px 0px 0px` on a 144px cell. The full
       * mechanism — and, more to the point, what must NOT be done about it —
       * is on `tableHeaderClass` above. If a class on this component looks
       * ignored, read that comment first.
       *
       * Horizontal padding as well as vertical, which the old rule never had:
       * without it a column's label sits flush against the rule dividing it
       * from the next column, and at narrow widths the weekday of one day and
       * the total of the next touch.
       */
      dayHeaderClass={(info) =>
        cn(
          COLUMN_RULE,
          /*
           * `justify-center` BELONGS HERE, not on the content.
           *
           * The cell is already `display: flex`, and FullCalendar inserts its
           * own wrapper between this element and whatever `dayHeaderContent`
           * returns. That wrapper is a flex ITEM, so it shrinks to fit — 50px
           * inside a 144px column — and any `w-full`/`items-center` on the
           * content below resolves against those 50px and centres the label
           * within itself. Measured 38px left of the column's centre with the
           * content trying to do it. Centring the wrapper is the only place the
           * column's real width is known.
           */
          /*
           * AND THE AXIS IS COLUMN, which is the part worth writing down. The
           * cell is `flex-direction: column`, so `justify-*` is the VERTICAL
           * axis here and `items-*` is the horizontal one — the opposite of the
           * reflex. `justify-center` alone moved nothing sideways: the label
           * stayed 38px left because `align-items: flex-start` was holding it
           * there. Both are kept — `justify-center` for the vertical and
           * `items-center!` for the horizontal, the `!` because skeleton.css
           * sets that one too, with `!important`. See `tableHeaderClass` above
           * for why the `!` is what beats it and why layering skeleton.css
           * would take it back out.
           */
          "items-center! justify-center px-2! py-2!",
          dayOf(info.date.getTime(), timeZone) === today && "bg-surface-raised"
        )
      }
      dayHeaderContent={(info) => {
        // Through `dayOf`, so the column header and the same day's header in
        // the list are computed by one function and cannot disagree.
        const day = dayOf(info.date.getTime(), timeZone)
        const total = dayTotals.get(day) ?? 0
        const isToday = day === today
        return (
          /*
           * TWO ROWS, NOT THREE. The weekday and the date are one label — "Thu
           * 13" — and stacking them spent a whole 16px line of a STICKY element
           * on splitting a two-word phrase in half. Inline, this row is ~58px
           * where it was ~76, and the 18px comes off the top of every scroll
           * position on the page, not just the first screen. The total keeps
           * its own line below, because it is a different kind of fact: the
           * pair above says which column this is, and the figure says what is
           * in it.
           */
          /* Centred by the CELL's `justify-center`, not from in here — see the
             comment on `dayHeaderClass`. This box only stacks its own two
             rows. */
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1.5">
              {/* FullCalendar has already formatted both of these, in the
               * calendar's own timeZone. Building an `Intl.DateTimeFormat` per
               * cell to recompute them is the cost this render hook can least
               * afford — see `format-time.ts`'s note on why its formatters are
               * cached. */}
              <span
                className={cn(
                  "text-xs",
                  isToday ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {info.weekdayText}
              </span>
              {/*
                The date, and on today the one INVERTED thing on this page.
                Ink on ground is the same figure/ground swap DESIGN.md gives the
                primary button, and it is chosen for the same reason it is:
                it is the loudest mark the system has that carries no hue at
                all. `size-6` fixes the box at the 24px the `text-base` line it
                replaced already occupied, so today's column is not a row taller
                than its neighbours.
              */}
              <span
                className={cn(
                  "font-mono tabular-nums tracking-[-0.02em] flex size-6 items-center justify-center text-sm",
                  isToday
                    ? "rounded-full bg-foreground font-medium text-ground"
                    : "text-foreground"
                )}
              >
                {info.dayNumberText}
              </span>
            </div>
            {/* Nothing at all on an untracked day. `0:00:00` under five of
             * seven columns on a light week is noise that reads as a value,
             * and `formatCompactDuration` refuses to print `0m` for the same
             * reason: a zero total reads as a defect. */}
            {total === 0 ? null : (
              <span className="font-mono tabular-nums tracking-[-0.02em] text-xs text-muted-foreground">
                {formatTotal(total, display)}
              </span>
            )}
          </div>
        )
      }}
      // The now-indicator marks NOW, not RUNNING. Ink Muted, never
      // `enlarger` — see the Cold Light Rule.
      nowIndicatorLineClass="border-t border-muted-foreground"
      // A filled dot, sized. The element FullCalendar hands us is empty and has
      // no intrinsic size, so a background colour alone paints a 0×0 box. The
      // negative margin centres the 8px circle on the line's left end, which is
      // what the themes do with their own `border-width`/`margin` pair.
      nowIndicatorDotClass="-m-1 size-2 rounded-full bg-muted-foreground"
      columnEventClass={(info) => {
        const props = propsOf(info.event)
        if (isMeetingEvent(props)) {
          /*
           * A MEETING CROSSES MIDNIGHT THE SAME WAY AN ENTRY DOES.
           *
           * FullCalendar segments it across both columns and `isStart` says
           * which half this is. Without a branch here the tail got the plain
           * `MEETING_BLOCK` — no hatch, no dashed edge — and `eventContent`
           * repeated the full title on it, so one overnight meeting drew as
           * two identical-looking meetings on consecutive days.
           *
           * `HATCH_EMPTY` REPLACES the outline rather than joining it: it
           * carries its own `border border-dashed border-edge-soft`, and a
           * second solid `border-edge-soft` from `MEETING_BLOCK` would win on
           * source order and erase the dash. So the tail takes the block's
           * box (margins, padding, radius, the transparent fill that makes a
           * ghost a ghost) and the hatch's edge — a continuation is a texture,
           * never a hue, and a ghost stays unfilled either way.
           */
          return cn(
            MEETING_BLOCK_BOX,
            BLOCK_INTERACTIVE,
            info.isStart ? MEETING_BLOCK_OUTLINE : HATCH_EMPTY
          )
        }

        const running = props.endedAt === null
        return cn(
          // No transition anywhere: the running block's height changes with
          // the clock, and an eased height change is continuous motion with no
          // reduced-motion alternative.
          /*
           * THE MARGINS ARE WHAT MAKE TWO BLOCKS TWO OBJECTS.
           *
           * FullCalendar positions a harness at `left: 0; right: 0` inside the
           * column and lays this element out as its only flex child, so a
           * margin here — and nothing else — insets the block. Measured: a
           * 143.16px harness draws a 141.16px block under `mx-0.5`.
           *
           * Without them a block ran edge to edge into the column dividers and
           * two back-to-back entries shared one hairline, which read as a
           * single striped block. `mb-px` rather than `mb-0.5` because each
           * block already carries its own 1px border: 1 + 1 + 1 is three pixels
           * of separation, and every pixel taken here comes off the text.
           *
           * `px-1` where it used to be `px-1.5`: the 2px margin now sits
           * outside the border, so the title's usable width is 129px either
           * way. Spending the same budget differently, not narrowing the text.
           */
          "mx-0.5 mb-px overflow-hidden rounded-md px-1 py-0.5 text-left",
          // The pointer cursor and the focus ring, which FullCalendar gives a
          // `role="button"` block neither of.
          BLOCK_INTERACTIVE,
          running
            ? // Cold light, and only here: something IS running.
              cn("bg-enlarger/15 text-foreground", RUNNING_HOVER)
            : cn("bg-surface-raised text-foreground", BLOCK_HOVER),
          /*
           * The tail of an entry that crossed midnight. FullCalendar segments
           * it across both columns and `isStart` says which half this is. A
           * continuation is a TEXTURE, never a hue — the Hatch Rule.
           *
           * The border is stated per branch rather than once above, and the
           * three branches are mutually exclusive so nothing competes. This
           * used to be load-bearing for a different reason: `.hatch-empty` was
           * an unlayered CSS class carrying its own `1px dashed`, so it
           * outranked every Tailwind utility and a `border-enlarger` beside it
           * would be in the class list and absent from the screen. `HATCH_EMPTY`
           * is utilities now and competes normally — the class list says what
           * renders either way.
           */
          info.isStart
            ? running
              ? "border border-enlarger"
              : // A block sits on a panel, not on ground, so Edge Raised is
                // the token that clears 3:1 there — the Adjacent Colour Rule.
                "border border-edge-raised"
            : HATCH_EMPTY
        )
      }}
      eventContent={(info) => {
        const props = propsOf(info.event)
        if (isMeetingEvent(props)) {
          // A tail carries no title, for the reason an entry's tail does not:
          // it is the same meeting as the block at the bottom of the previous
          // column, and repeating the title reads as a second meeting rather
          // than as a continuation. The hatch says "continued" visually; this
          // says it out loud.
          if (!info.isStart) {
            return (
              <span className="sr-only">
                {titleOf(info.event)} — continued from the previous day
              </span>
            )
          }

          const meetingTimeText = formatTimeRange(
            props.startedAt,
            props.endedAt,
            timeZone,
            use12Hour
          )

          /*
           * MEASURED, not assumed — the same discipline as the entry branch
           * below, through the same `blockFit`/`blockHeightPx` pair rather
           * than a second measurement that could disagree with it.
           *
           * A title line and a time line unconditionally is 34px of content,
           * and by this file's own constants a HALF-HOUR meeting has 17px of
           * content box (24px of block, less the 7px it spends on its margin,
           * borders and padding) and a quarter-hour one has 11px. So
           * `overflow-hidden` cut the title through the middle of its glyphs
           * on the commonest block this feature draws. What does not fit is
           * dropped and said on the screen-reader line instead, so the block's
           * accessible name stays complete however short it is.
           *
           * `hasProject: false`, HONESTLY: a meeting has no project line at
           * all. Claiming one would spend the third row on something that
           * never renders instead of on the title's second line.
           */
          const meetingFit = blockFit(
            blockHeightPx(props.startedAt, props.endedAt, nowMs, timeZone),
            false
          )
          const meetingSpoken = [
            meetingFit.titleLines === 0 ? titleOf(info.event) : null,
            meetingFit.time ? null : meetingTimeText,
          ]
            .filter((part) => part !== null)
            .join(" — ")

          return (
            <div
              title={`${titleOf(info.event)} — ${meetingTimeText}`}
              className="flex min-w-0 flex-col gap-0.5"
            >
              {meetingFit.titleLines === 0 ? null : (
                <span
                  className={cn(
                    "text-xs font-medium",
                    meetingFit.titleLines === 1 ? "truncate" : "line-clamp-2"
                  )}
                >
                  {titleOf(info.event)}
                </span>
              )}
              {meetingFit.time ? (
                <span className="font-mono tabular-nums tracking-[-0.02em] truncate text-[0.6875rem]">
                  {meetingTimeText}
                </span>
              ) : null}
              {meetingSpoken === "" ? null : (
                <span className="sr-only">{meetingSpoken}</span>
              )}
            </div>
          )
        }

        // Narrowed to an entry from here down. This is the line that used to
        // open the hook.
        const { projectId, startedAt, endedAt } = props
        const project =
          projectId === undefined ? null : (projectsById.get(projectId) ?? null)

        // A tail carries no title. It is the same entry as the block at the
        // bottom of the previous column, and repeating the title there reads
        // as a second entry rather than as a continuation.
        if (!info.isStart) {
          return (
            <span className="sr-only">
              {titleOf(info.event)} — continued from the previous day
            </span>
          )
        }

        /*
         * `formatTimeRange`, never FullCalendar's `timeText`.
         *
         * timegrid's default event format is
         * `{hour:'numeric', minute:'2-digit', meridiem:false}`, and
         * `meridiem:false` DELETES the am/pm string rather than switching to a
         * 24-hour cycle — so a 09:30 entry and a 21:30 entry both rendered
         * "9:30 – 10:30" and `use12Hour` was ignored entirely. Going through
         * the app's own formatter is also what makes a block read identically
         * to the same entry's row in the log: one spelling of a time,
         * everywhere.
         *
         * A running entry shows its elapsed clock instead, because that is the
         * number that is still moving. Both instants come from `extendedProps`,
         * so this is the STORED start, not a `Date` that has been through
         * FullCalendar's own parsing.
         */
        const timeText =
          endedAt === null
            ? formatClock(nowMs - startedAt)
            : formatTimeRange(startedAt, endedAt, timeZone, use12Hour)

        const fit = blockFit(
          blockHeightPx(startedAt, endedAt, nowMs, timeZone),
          project !== null
        )

        /*
         * What the block cannot show, said out loud instead.
         *
         * Only the parts that were dropped, so nothing is announced twice —
         * and the block's accessible name stays complete however short it is.
         * The spec's "a block too short for text shows nothing but its fill;
         * its title is on the `title` attribute and in its accessible name" is
         * this line.
         */
        const spoken = [
          fit.titleLines === 0 ? titleOf(info.event) : null,
          fit.time ? null : timeText,
          fit.project || project === null ? null : project.name,
        ]
          .filter((part) => part !== null)
          .join(" — ")

        return (
          /*
           * `title`, in ADDITION to the accessible name the text below already
           * gives the block. A block only as tall as `eventMinHeight` shows no
           * text at all, and the native tooltip is the only way to read it
           * without leaving the grid — so it carries the times as well as the
           * title, since those are the first thing to go. It sits on this
           * element rather than on the block itself because `columnEventClass`
           * is the only hook the block element has and it takes class names,
           * not attributes — and this div fills the block's content box, so the
           * hover target is the same one.
           *
           * The midnight TAIL is deliberately excluded: it returns above, and
           * "no title on the tail" is the Hatch Rule, not an oversight.
           */
          <div
            title={`${titleOf(info.event)} — ${timeText}`}
            className="flex min-w-0 flex-col gap-0.5"
          >
            {fit.titleLines === 0 ? null : (
              <span
                className={cn(
                  "text-xs font-medium",
                  // `line-clamp-2` is a truncate that is allowed a second line:
                  // it still ends in an ellipsis, but only after using the room
                  // the block actually has. `truncate` at one line, because
                  // `line-clamp-1` sets `display: -webkit-box`, which a
                  // single-line title does not need.
                  fit.titleLines === 1 ? "truncate" : "line-clamp-2"
                )}
              >
                {titleOf(info.event)}
              </span>
            )}
            {fit.time ? (
              <span className="font-mono tabular-nums tracking-[-0.02em] truncate text-[0.6875rem] text-muted-foreground">
                {timeText}
              </span>
            ) : null}
            {fit.project ? (
              <ProjectDot project={project} className="text-[0.6875rem]" />
            ) : null}
            {spoken === "" ? null : <span className="sr-only">{spoken}</span>}
          </div>
        )
      }}
    />

      {/*
        THE EDITOR, mounted only while a block is selected.
        Unmounting is what closes it, so there is no second flag that could
        disagree with the selection — and `editing` going `null` because the
        entry was deleted or re-dated out of the range closes it for free.
      */}
      {selected === null || editing === null ? null : (
        <CalendarEntryPopover
          entry={editing}
          anchor={selected.anchor}
          onClose={() => setSelected(null)}
          timeZone={timeZone}
          use12Hour={use12Hour}
          weekStartDay={weekStartDay}
          projects={projects}
          tags={tags}
          actions={actions}
        />
      )}

      {/*
        THE MEETING POPOVER, mounted only while a ghost is selected — the same
        unmount-closes-it discipline as the entry editor above, and the same
        reason: `reading` going `null` because the meeting was cancelled or the
        calendar was hidden closes this for free.
      */}
      {selectedMeeting === null || reading === null ? null : (
        <CalendarMeetingPopover
          meeting={reading}
          anchor={selectedMeeting.anchor}
          onClose={() => setSelectedMeeting(null)}
          timeZone={timeZone}
          use12Hour={use12Hour}
        />
      )}
    </>
  )
}

/** The typed half of an event, which FullCalendar hands back as a `Dictionary`. */
function propsOf(event: EventApi): CalendarEventProps | MeetingEventProps {
  return event.extendedProps as CalendarEventProps | MeetingEventProps
}

/** A block's heading. An entry with no title is normal — starting the timer
 *  must never require one — so both the head and the midnight tail need the
 *  same fallback, or the tail's screen-reader text opens with a bare dash. */
function titleOf(event: EventApi): string {
  return event.title.trim() === "" ? "Untitled" : event.title
}
