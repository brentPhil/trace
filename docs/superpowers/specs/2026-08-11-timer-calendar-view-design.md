# A calendar view on /timer

*2026-08-11*

## The problem

/timer answers "what did I record" and cannot answer "what did the day look
like". The log is a list of rows ordered by start time, grouped by day. A list
tells you an entry ran 2:13:38 and it tells you the next one started at 15:04.
It does not tell you there was fifty minutes of nothing in between, and it
cannot tell you at a glance — you have to read two timestamps and subtract.

Gaps are the thing a freelancer needs to see. An hour that is not in the log is
either an hour that was not billable or an hour that was worked and never
recorded, and those two have very different consequences at the end of the
month. The product principle is "never lose time"; a list is structurally
incapable of showing time that is missing, because absence has no row.

A second, smaller problem sits beside it. The `Add entry` button is a
full-width-label ghost button next to the totals on /timer, which means it is
absent from every other page — including Reports, where noticing a forgotten
block is most likely.

## What this adds

A `Calendar | List` switcher on /timer. Calendar draws the visible range as a
time grid: day columns over a 24-hour axis, entries as positioned blocks. List
is the existing log, unchanged.

```
[ 8:06:53 today  14:57:28 week  6:12:00 billable ]  ‹ This week · W33 ›  [Week ▾]  [ Calendar | List ]
─────────────────────────────────────────────────────────────────────────────────
[ project ▾ ]  [ $ billable ]  [ search…                                       ]
─────────────────────────────────────────────────────────────────────────────────
        MON 10   TUE 11   WED 12   THU 13   FRI 14   SAT 15   SUN 16
        8:06:53  6:50:35  0:00:00  0:00:00  0:00:00  0:00:00  0:00:00
 11 AM │        │ ▓▓▓▓▓▓ │        │        │        │        │
 12 PM │ ▓▓▓▓▓▓ │ ▓▓▓▓▓▓ │        │        │        │        │
  1 PM │ ▓▓▓▓▓▓ │ ▓▓▓▓▓▓ │        │        │        │        │
  2 PM │        │ ▓▓▓▓▓▓ │        │        │        │        │
  3 PM │ ▓▓▓▓▓▓ │        │        │        │        │        │
```

The figure under each day is that column's total. It is computed from the
placed entries by **attribution by start** — heads only, never the hatched tail
of an entry that began the day before — so a column's total and the same day's
header in List always agree. The range total in the header is the sum of those,
and both include the running entry's elapsed time so far.

And the `Add entry` button becomes a tiny `+` beside Play in the timer bar,
which lives in the shell — so it is reachable from every page rather than only
from /timer.

## Decisions taken, and why

**Read, not draw.** Blocks are not draggable. Clicking one opens the editing
that already exists (`EntryTimePopover`, `NoteSheet`, the inline title). The
view exists to show the shape of a day, and drag-to-create is a second product
with its own failure modes — an accidental 40-minute entry created by a stray
drag is precisely the kind of silent data corruption "defensible by default"
rules out. It can be added later on top of this layout model without a rewrite.

**A tab, not a route.** [reports.tsx:49](../../../src/routes/_authed/reports.tsx)
already settled this argument for Summary and Detailed: *tabs rather than two
routes, so the FilterBar above them is one control governing both.* Same
reasoning, same conclusion. A freelancer narrows to a client and then looks at
the shape of it and at the rows behind the shape; making that a second page
means setting the same filter twice and lets the two silently disagree.

The consequence is that /timer gains a bounded period, which
[timer.tsx:101](../../../src/routes/_authed/timer.tsx) currently rules out
("Timer's range is `fromMs: 0`, all of history, so it has no bounded period for
a preset or a step to act on"). That comment becomes wrong and must be
rewritten rather than deleted: the period is real now, but it belongs to the
*calendar view*, not to the page. List keeps `fromMs: 0` and its all-history
pagination. Presets and a date-range picker stay exclusive to Reports — the
calendar has a stepper over a fixed-width window, which is a different control
answering a different question.

**Week, 5 days, Day — not Month.** All three are the same component with 7, 5
or 1 columns, so it is one layout algorithm, one stepper, one set of tests. A
month grid is a genuinely different component (date cells carrying a daily
total, no time axis) and is out of scope. `src/lib/month-grid.ts` remains the
date-range picker's.

5 days means **Monday to Friday regardless of `weekStartDay`**. It exists to
hide the weekend; rotating it by the user's week start would make it mean
something else on a Sunday-start calendar.

**The filter applies to both views.** Same `filters` state, same `matches()`,
run over the calendar's entries before placement. The alternative — hiding the
band with the list — silently drops a filter the user set, and a control
disappearing is indistinguishable from data changing.

**Full 24 hours, scrolled.** The convention every shipping calendar shares
(Google, Outlook, Toggl, Clockify, Notion Calendar): a scroll container over
all 24 hours at a fixed pixels-per-hour, with the day-header row fixed *outside*
the scroller so it stays put. Opened scrolled to where the work is — the
earliest entry in the range, falling back to the current hour on an empty
range — never to midnight.

The scroll is set when the **range** changes and at no other time. Not on every
query update: a live subscription pushes on every keystroke into a title, and a
grid that jumped back to its earliest entry each time would be unusable while
anything is running.

Cropping the axis to the entries was considered and
rejected: the grid's height would then change every time the range did, and two
weeks would be drawn at two different scales, which makes them uncomparable by
eye. That is the one thing a time grid is for.

**Blocks carry no project colour.** DESIGN.md's Two Temperatures Rule holds:
cold means running, warm means money, everything else is text, shape or
position. Blocks are `surface-raised` with an `edge-raised` border; project
identity is a `ProjectDot` plus the name inside the block, exactly as on an
entry row. The twelve-hue project palette stays where DESIGN.md granted it — the
project chart, one bar beside one name. A grid of project-tinted blocks would
put more hue on screen than anything else in the product and the running entry
would stop being findable in half a second, which is the whole reason cold light
is reserved.

**An entry crossing midnight is drawn in both columns.** It appears at the
bottom of the day it started and again at the top of the next, the way Google
and Outlook draw it — because the picture of where the time went is what the
view is for, and clipping it at midnight hides ninety minutes of real work.

This is in tension with attribution-by-start
([convex/entries.ts:207](../../../convex/entries.ts): *an entry running from
23:00 to 01:30 belongs wholly to the day it began*), and the tension is
resolved rather than ignored. The **tail is hatched and carries no title**, so
it reads as a continuation rather than as a second entry. Tuesday's header
total still counts zero for it, and the hatch is what explains the apparent
discrepancy on the one day it shows up. The Hatch Rule already covers this:
absence and continuation are textures, never hues.

## Structure

```
src/lib/calendar-range.ts        anchor + size -> { days, fromMs, toMs, label }
src/lib/day-grid.ts              entries + days -> positioned blocks
src/components/calendar/
  calendar-view.tsx              composes the below; takes entries and a range
  calendar-header.tsx            ‹ label ›, size dropdown, range total
  time-axis.tsx                  hour labels, fixed left column
  day-column.tsx                 one day: its blocks and the now-line
  entry-block.tsx                one positioned entry
```

The split is the shape this codebase already uses four times — `month-grid.ts`,
`group-entries.ts`, `period-totals.ts`, `report-series.ts` are each pure,
separately tested, with presentational components on top. It is chosen here for
a specific reason rather than for symmetry: overlap packing and day-boundary
arithmetic are wrong in ways nobody notices until one particular week arrives,
which is the argument [month-grid.ts:6](../../../src/lib/month-grid.ts) makes
for itself. Those cases want a test file, not a component test.

A calendar library (FullCalendar, react-big-calendar, schedule-x) was
considered and rejected. It reaches a working grid quickly and then every rule
in DESIGN.md becomes an override on someone else's DOM. DESIGN.md §5 already
records that lesson from recharts: *a selector aimed at a vendored library's
internal class names fails silently, and dimmer-than-the-floor is exactly the
failure nobody notices.*

### Range state

`{ anchor: DayString, size: "day" | "5day" | "week" }`, held in `useState` in
timer.tsx beside `filters`, matching how Reports holds its period. Not in the
URL: Reports does not put its filters there either, and one page inventing a
second convention for the same kind of state is how the two drift.

`calendar-range.ts` turns that pair into the concrete window:

```ts
export type CalendarSize = "day" | "5day" | "week"

export function calendarRange(
  anchor: DayString,
  size: CalendarSize,
  timeZone: string,
  weekStartDay: number
): { days: Array<DayString>; fromMs: number; toMs: number; label: string }

export function stepRange(
  anchor: DayString,
  size: CalendarSize,
  delta: -1 | 1,
  weekStartDay: number
): DayString
```

`label` is the stepper's own text, computed here so the header cannot assemble
it a second way:

| size    | current                | otherwise              |
| ------- | ---------------------- | ---------------------- |
| `week`  | `This week · W33`      | `4–10 Aug · W32`       |
| `5day`  | `This week · Mon–Fri`  | `4–8 Aug`              |
| `day`   | `Today · Mon 11 Aug`   | `Sun 10 Aug`           |

`5day` steps by a whole week, not by five days — otherwise paging twice lands
on a weekend the view cannot show.

### Layout

```ts
export type Placed = {
  entry: Doc<"timeEntries">
  dayIndex: number        // which column
  startFraction: number   // 0..1 through that day
  endFraction: number     // 0..1, clamped
  column: number          // slot within its overlap cluster
  columns: number         // how wide that cluster is
  continuedFrom: boolean  // this is the hatched tail of the previous day
}

export function placeEntries(
  entries: Array<Doc<"timeEntries">>,
  days: Array<DayString>,
  timeZone: string,
  nowMs: number
): Array<Placed>
```

Three things it owns, each a bug that surfaces on exactly one day of the year:

**Day length is read, never assumed.** Fractions are computed against the day's
real span from `dayWindow`, never against `86_400_000`. A spring-forward day is
23 hours; a hard-coded divisor puts every block on it four percent out of place.

**Midnight splits into two `Placed`.** A head in the start day, a tail in the
next with `continuedFrom: true` — and the tail is emitted only when that next
day is actually within `days`, so the last column of a range does not sprout a
tail with nowhere to go.

**Overlaps pack into columns.** Sort by start, then by duration descending;
sweep into clusters of mutually overlapping entries; each takes the first free
column. Entries that merely touch — one ending on the tick the next starts — are
not a cluster, which is the case a naive `<=` gets wrong and which is the
commonest shape in real data.

The running entry is placed with `endedAt ?? nowMs`, using the `nowMs` timer.tsx
already computes for the totals. Nothing special-cases it in the layout.

Minimum block height is a **rendering** floor in `entry-block.tsx` (~18px, so a
four-minute entry stays clickable), never a layout adjustment. Growing a short
block by moving its top is how a 09:03 entry ends up drawn at 08:58.

## Data

`convexQuery(api.entries.listRange, { fromMs, toMs })`, with the args memoised
on the range so a once-a-second re-render does not tear the subscription down
and rebuild it — the discipline
[timer.tsx:68](../../../src/routes/_authed/timer.tsx) spells out for the week
totals. No backend change: `listRange` already exists, takes exactly this pair,
and defaults to 500 rows, which is far above what any week holds.

The calendar **does not** use `groupByDay`, which deliberately keeps the running
entry out of `entries`. A view whose purpose is showing the shape of the day
must show the thing currently running; that is where the cold light goes.

## Design system

The places this feature is most likely to break a rule, and what it does
instead:

- **The now-line marks *now*, not *running*,** so it may not be `enlarger`. It
  is a 1px Ink Muted rule with a small filled dot at the left edge of today's
  column. Cold light on a grid where nothing is being tracked is precisely the
  failure the Cold Light Rule names.
- **The running entry's block is the only cold thing on the grid.** Everything
  completed is `surface-raised` with an `edge-raised` border — the block sits on
  a panel, not on ground, so Edge Raised is the token that clears 3:1 there
  (3.73:1 on surface). This is the Adjacent Colour Rule applied.
- **Nothing animates.** Not the now-line, not the running block growing. Both
  change position; neither transitions. A block that eased into a new height
  once a second would be continuous motion with no reduced-motion alternative.
- **No shadow on blocks.** The grid does not float — Tonal Depth Rule.
- **The Tabular Rule** covers every hour label on the axis, the range total in
  the header, each column's day total, and any time rendered inside a block.
- **Sentence case** on the size dropdown and every label.

## The `+` button

Icon-only: `<Plus className="size-4" />` with `aria-label="Add entry"` and no
text at any width. A 36px ghost square at `rounded-md`, immediately left of
Play, inside the timer bar's existing flex row. Deliberately **not** a second
42px filled circle: Play is the one control in this product that must never be
mis-clicked, and two round buttons of similar weight side by side is how that
happens.

`ManualEntryDialog` moves from timer.tsx into `TimerBar`, so it needs its
`onCreate` from `_authed.tsx` (which already holds `editMutations`) rather than
from the page.

**The move reintroduces a bug the dialog already documents, and the fix is a
contract change.** [manual-entry-dialog.tsx:56](../../../src/components/entries/manual-entry-dialog.tsx)
re-seeds its Day field on every open specifically so that *a tab opened
yesterday evening does not offer yesterday when it is used at 09:00 this
morning* — but it re-seeds from a `today` **prop**. /timer recomputes that prop
every second through `useSecond`. `_authed.tsx` has no clock, so the prop would
freeze at page load and the dialog would offer a stale day: exactly the failure
its own comment exists to prevent, reintroduced by moving the mount point.

So the `today` prop is removed. The dialog already receives `timeZone`; it
derives the day itself with `dayOf(Date.now(), timeZone)` when it opens. The
hazard goes away by construction rather than depending on whoever mounts the
dialog remembering to tick a clock.

Two consequences worth stating: the dialog is now mounted on every authed page,
so a forgotten block can be logged from Reports — consistent with why the bar
sits above the outlet at all. And [timer.tsx:158](../../../src/routes/_authed/timer.tsx)'s
comment arguing this button belongs *adjacent to the totals it relates to* is
now the wrong answer and must be rewritten to record why it moved, not deleted.

The timer bar keeps its idle duration popover, which also writes a completed
entry via `createCompleted`. Two paths to a manual entry is accepted, not
overlooked: the `+` is the discoverable one and the popover is the fast one, and
removing the popover's fields would take a path someone may already be using.

## Edge cases

- **Empty range.** The axis and hour rules draw, with one quiet line of copy.
  Not DayList's onboarding text — that belongs to the log and would be false
  here for anyone stepping back to a week they did not work.
- **An untitled entry** uses the same fallback the entry row uses.
- **A block too short for text** shows nothing but its fill; its title is on the
  `title` attribute and in its accessible name.
- **More than 500 entries in one range** cannot happen for a week, but the
  `limit` is left at its default rather than raised, so the failure mode is a
  truncated grid rather than a slow query.
- **A zero-length entry** (start equals end) is placed at the minimum height
  rather than skipped — a row that exists must be visible, or editing it is
  impossible from this view.

## Tests

`src/lib/day-grid.test.ts` carries the weight:

- two-way, three-way, and chained overlaps
- entries that touch but do not overlap
- midnight crossing, with and without the following day in `days`
- a spring-forward day and a fall-back day
- a running entry (`endedAt === null`)
- a zero-length entry

`src/lib/calendar-range.test.ts`: stepping across a month and a year boundary,
`weekStartDay` 0 versus 1, 5-day resolving to Monday–Friday under both, 5-day
stepping by a whole week rather than five days, and each size's label in its
current and non-current form.

Component tests: the switcher swaps views, a project filter narrows both views,
clicking a block opens the time popover. `-timer.test.tsx`'s existing
`ManualEntryDialog` mock moves to the layout test;
`manual-entry-dialog.test.tsx` keeps working unchanged, since `aria-label="Add
entry"` is unchanged.

## Staging

1. `calendar-range.ts`, `day-grid.ts` and their tests. No UI.
2. The `+` button move, including the `today` → `timeZone` contract change.
   Independent of the calendar and shippable alone.
3. Week grid, `Calendar | List` switcher, filter wiring.
4. Day and 5-day sizes, the stepper, the size dropdown.
5. `−/+` zoom over pixels-per-hour. Last, and optional — Toggl has it, Google
   does not, and it needs a persisted preference to be worth anything.

## Out of scope

Drag to create, move or resize. A month view. A date-range picker or presets on
/timer. Split-at-midnight as a data operation — `Split` already exists as the
manual correction and this view does not change what an entry is.
