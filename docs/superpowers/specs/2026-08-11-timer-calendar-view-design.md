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

**Read, not draw.** Blocks are not draggable, and the calendar contains no
editing of its own. Clicking a block **switches to List and focuses that
entry's row**, where the editing already exists — `EntryTimePopover`,
`NoteSheet`, the inline title. The calendar navigates to the editor; it is not
one. A popover on the grid would be a second place to fix the same mistyped
field, which is how two places come to disagree about it.

The view exists to show the shape of a day, and drag-to-create is a second
product with its own failure modes — an accidental 40-minute entry created by a
stray drag is precisely the kind of silent data corruption "defensible by
default" rules out. It can be added later on top of this layout model without a
rewrite.

Two clicks are deliberately inert rather than misleading, because the row they
would navigate to does not exist: the **running** entry (`groupByDay` keeps it
out of the list on purpose) and any entry **outside the loaded pages** or dated
in the **future** (the list's range is pinned to the end of today). Each says
why instead of silently doing nothing.

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
something else on a Sunday-start calendar. It is achieved by overriding
`firstDay` to Monday **for that size only** — see the range table below for why
`hiddenDays` alone does not deliver it.

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
anything is running. FullCalendar's `scrollTimeReset` defaults to exactly this
behaviour — reset on navigation, untouched by an event change — so it is left
alone rather than configured, and `scrollTime` carries the computed hour.

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

FullCalendar segments the crossing event across both columns on its own and
reports which half is which: the render props carry `isStart` and `isEnd`, so
the tail is exactly the segment where `isStart === false`. Both the hatch class
and the suppressed title key off that one boolean.

## Structure

The grid itself is **FullCalendar v7** (`@fullcalendar/react@7`, `timeGrid`
view). Hand-rolling it was the first proposal and was rejected on evidence:

- v7 is built on `temporal-polyfill`, so `timeZone` takes an IANA name
  natively. That was the decisive objection to a library here — v6 and every
  competitor compute *which day an instant falls on* in the **browser's** zone,
  which would have meant adopting luxon as a second date system that must agree
  with `convex/lib/day.ts` about midnight and DST forever.
- v7 styles through **class-name props** — one per element, taking Tailwind
  utilities directly. DESIGN.md's rules are applied as our own classes rather
  than as overrides fighting a vendored stylesheet, which is the failure mode
  DESIGN.md §5 records from recharts.
- Overlap packing, the now-line, midnight segmenting, `eventMinHeight` and
  `slotMinHeight` are all built in.

**Packaging note.** v7 moved plugins to subpath exports:
`@fullcalendar/react/timegrid`, not the standalone `@fullcalendar/timegrid`
package (which is stranded at 6.1.21 and must not be installed). `plugins` and
`temporal-polyfill` are peer dependencies and are installed explicitly.

**No theme is imported.** `@fullcalendar/react/skeleton.css` supplies structure
only; every visible surface is ours.

```
src/lib/calendar-events.ts       entries -> EventInput[], and per-day totals
src/lib/calendar-label.ts        range + size + today -> the stepper's text
src/components/calendar/
  calendar-panel.tsx             the <Calendar>, every class-name prop
  calendar-header.tsx            ‹ label ›, size dropdown, range total
```

Two pure modules and two components. What is left to hand-write is the mapping
in and the styling out — the layout math that was going to be `day-grid.ts` is
the library's job now.

### Range state

`{ anchor: DayString, size: "day" | "5day" | "week" }` in `useState` in
timer.tsx beside `filters`, matching how Reports holds its period. Not in the
URL: Reports does not put its filters there either, and one page inventing a
second convention for the same kind of state is how the two drift.

Size maps onto views directly, with no custom view registration:

| size   | `initialView`   | `hiddenDays` | `firstDay`      |
| ------ | --------------- | ------------ | --------------- |
| `week` | `timeGridWeek`  | `[]`         | `weekStartDay`  |
| `5day` | `timeGridWeek`  | `[0, 6]`     | `1` (Monday)    |
| `day`  | `timeGridDay`   | `[]`         | `weekStartDay`  |

**`hiddenDays` alone does not give Monday–Friday, and the two columns above are
one decision.** FullCalendar builds the week from `firstDay` and then removes
hidden days only from the **ends** of it, so a weekend falling in the *interior*
is not removed at all. Measured, anchor 2026-08-11 in Asia/Manila, with
`firstDay = weekStartDay`:

| `weekStartDay` | columns drawn                     | `datesSet` width |
| -------------- | --------------------------------- | ---------------- |
| 0, 1, 6        | Mon 10 – Fri 14                   | 5 days           |
| 2              | Tue 11, Wed 12, Thu 13, Fri 14, **Mon 17** | 7 days  |
| 3              | Wed 5, Thu 6, Fri 7, **Mon 10, Tue 11**    | 7 days  |
| 4              | Thu 6, Fri 7, **Mon 10, Tue 11, Wed 12**   | 7 days  |
| 5              | Fri 7, **Mon 10, Tue 11, Wed 12, Thu 13**  | 7 days  |

`/settings` offers all seven starts, so a user whose week begins on Wednesday got
a discontinuous grid: three days of one week and two of the next.

Pinning `firstDay` to Monday for this size fixes every row. The week is then
Mon,Tue,Wed,Thu,Fri,Sat,Sun; trimming from the front stops immediately at Mon,
and trimming from the back removes Sun, then Sat, and stops at Fri. That is also
exactly why 0, 1 and 6 already worked — in each of those the weekend already sat
at an end.

Overriding the user's week start here is the *rule*, not a workaround: 5 days is
the working week and the working week is Monday to Friday by definition. `week`
and `day` still take the stored `weekStartDay`.

`visibleRange` would express the same thing directly and is rejected: it is an
object, and a freshly allocated dateProfile input on every render is the render
loop `calendar-panel.tsx` documents at length. `firstDay` is a number and is
compared by value.

`5day` still steps by a whole week for free, because it *is* the week view.

The visible window comes back from FullCalendar's `datesSet` callback as
`{ start: Date, end: Date, timeZone }`, and those two instants are what the
Convex query is keyed on. Nothing computes the range twice.

The panel reports the **drawn days** alongside those instants, because with
`hiddenDays` in play the range's width and the number of columns are different
questions. "Range total" is summed over that day list and over nothing else, so
it is the sum of the figures in the column headers by construction — a total
that included a day with no column is the same defect as a total belonging to a
range other than the one on screen.

**This is the one place the two date systems could disagree**, so it is
asserted rather than assumed: a test checks that `datesSet`'s range for a given
anchor equals `weekWindow(anchor, timeZone, weekStartDay)` from `day.ts`,
including across a DST boundary. If FullCalendar's Temporal-based midnight and
`day.ts`'s Intl-based midnight ever drift, that test is what says so.

### The label

`calendar-label.ts` owns the stepper's text so the header cannot assemble it a
second way:

| size          | today in range          | otherwise                     |
| ------------- | ----------------------- | ----------------------------- |
| `week`/`5day` | `This week · 10–16 Aug` | `3–9 Aug`                     |
| `day`         | `Today · Mon 11 Aug`    | `Sun 10 Aug`                  |

Toggl's `W33` is deliberately absent. ISO week numbers are Monday-based by
definition, and this app's week start is configurable — under
`weekStartDay: 0` the number would name a week different from the one on
screen.

### Mapping entries in

`calendar-events.ts` turns rows into `EventInput`s. Two rules it owns:

**Instants, never wall-clock strings.** `start` and `end` are `Date` objects
built from the stored millisecond instants. An ISO string without an offset
would be interpreted in the calendar's `timeZone`, which is right by accident
today and wrong the moment anything reads the field differently.

**A zero-length entry is floored to one minute.** FullCalendar drops an event
whose end equals its start, and a row that exists must be visible or it cannot
be edited from this view. `eventMinHeight` keeps it clickable once drawn.

Day totals are computed here too, by **attribution by start**
([convex/entries.ts:207](../../../convex/entries.ts)) — so a column header and
the same day's header in List can never disagree, even on the one day an entry
crosses midnight.

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

Each of those is a class-name prop rather than a stylesheet override, which is
what makes them auditable. The ones this feature sets:

| prop                  | carries                                              |
| --------------------- | ---------------------------------------------------- |
| `columnEventClass`    | the block: `surface-raised` + `edge-raised`; `enlarger` while running; `hatch-empty` when `!isStart` |
| `eventContent`        | title, `ProjectDot`, time — title suppressed on a tail |
| `slotLaneClass`       | the hour rules, `border-edge-soft`                    |
| `slotHeaderClass` / `slotHeaderContent` | hour labels, `tabular`              |
| `dayHeaderClass` / `dayHeaderContent` | weekday, date, and the day's total   |
| `nowIndicatorLineClass` / `nowIndicatorDotClass` | Ink Muted — never `enlarger` |
| `tableClass` / `tableHeaderClass` / `tableBodyClass` | the frame and the fixed header row |

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

- **Empty range.** The axis and hour rules draw, with one quiet line of copy:
  *Nothing was tracked in this range.* Not DayList's onboarding text — that
  belongs to the log and would be false here for anyone stepping back to a week
  they did not work.
- **A filter that matched nothing** is a *different* sentence: *No entries in
  this range match these filters.* "Nothing was tracked" would be flatly false
  while a filter is hiding rows the range does hold. This is the same
  distinction `FilteredLogStatus` draws for the list, and drawing it in only one
  of the two views is the asymmetry "one filter, both views" exists to close.
  Both messages share one always-mounted `aria-live` region, because a live
  region inserted already holding its text is not reliably announced.
- **A block whose entry has no row in the list** raises a toast and leaves the
  grid where it is. Three cases, three different true sentences: the entry is
  *running* (it is in the timer bar), it is *not yet paginated in* ("Load
  earlier entries" reaches it), or it is *dated after today* — the log's range
  ends with today, so no amount of loading earlier will ever reach it. The
  reachable way to get one is a mistyped day in the add-entry dialog's unbounded
  `<input type="date">`, and noticing that is exactly what a calendar is for.
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

Overlap packing and midnight segmenting are the library's now, so the tests
follow the code: what remains ours is the mapping in, the label, and the
agreement between the two date systems.

`src/lib/calendar-events.test.ts`: a running entry ends at `nowMs`; a
zero-length entry is floored to one minute; `start`/`end` are absolute instants,
not wall-clock strings; day totals attribute a midnight-crossing entry wholly to
its start day; a filtered-out entry produces no event.

`src/lib/calendar-label.test.ts`: each size in its today-in-range and
out-of-range form, a range spanning a month boundary, a range spanning a year
boundary, and `weekStartDay` 0 versus 1.

**The date-system agreement test** is the one that earns its keep:
FullCalendar's `datesSet` range for a given anchor must equal
`weekWindow(anchor, timeZone, weekStartDay)`, checked across a DST boundary. It
is the only assertion standing between us and a grid that quietly disagrees with
the day headers.

Component tests: the switcher swaps views, a project filter narrows both views,
and clicking a block switches to List and focuses that entry's row — *not* a
popover on the grid; the calendar navigates and does not edit. Where there is no
row to land on, it stays put and says which of the three reasons applies.

`calendar-range-label.test.tsx` walks all seven `weekStartDay` values against
the grid's own `data-date` columns, and asserts the 5-day view draws **exactly
Monday–Friday** rather than merely that the label agrees with whatever was
drawn. That weaker assertion is what let a false claim about `hiddenDays`
survive. The same matrix asserts "Range total" equals the sum of the day totals
printed in the column headers.

`-timer.test.tsx`'s existing
`ManualEntryDialog` mock moves to the layout test;
`manual-entry-dialog.test.tsx` keeps working unchanged, since `aria-label="Add
entry"` is unchanged.

**A jsdom caveat, stated so nobody wastes an afternoon on it.** FullCalendar
measures element geometry to lay a grid out, and jsdom reports every element as
zero-sized. Rendering the real calendar in a unit test is therefore not a
reliable assertion about anything visual. `calendar-panel.tsx` is mocked in the
route-level tests, its logic lives in the two pure modules above, and its
appearance is verified in a browser.

## Staging

1. `calendar-events.ts`, `calendar-label.ts` and their tests. No UI.
2. The `+` button move, including the `today` → `timeZone` contract change.
   Independent of the calendar and shippable alone.
3. Install FullCalendar v7; `calendar-panel.tsx` at week width, fully styled.
4. `calendar-header.tsx`, the sizes and the stepper.
5. Wire into timer.tsx: the `Calendar | List` switcher, `listRange` keyed on
   `datesSet`, and the filter applied to both views.

## Out of scope

Drag to create, move or resize — the one place a library plainly earns its keep,
and now a config change rather than a rewrite, but not this plan.

A month view. A date-range picker or presets on /timer. Split-at-midnight as a
data operation — `Split` already exists as the manual correction and this view
does not change what an entry is.

The `−/+` zoom from the reference screenshot. It is a `slotMinHeight` change, so
it is nearly free — but it is only worth anything with a persisted preference,
and that means a `userSettings` field and a mutation. Its own plan.
