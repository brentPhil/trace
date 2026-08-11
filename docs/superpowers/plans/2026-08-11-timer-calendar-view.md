# Timer Calendar View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `Calendar | List` switcher to /timer, where Calendar draws the visible range as a FullCalendar v7 time grid at week, 5-day or day width — and move the `Add entry` button into the timer bar as a tiny `+` beside Play.

**Architecture:** FullCalendar v7 (`@fullcalendar/react`, `timeGrid` view) owns the grid: overlap packing, the now-line, midnight segmenting, minimum block height. Two pure modules are ours — `calendar-events.ts` maps `Doc<"timeEntries">` rows to `EventInput`s and computes per-day totals, `calendar-label.ts` produces the stepper's text. Styling is entirely through v7's class-name props with Tailwind utilities; no FullCalendar theme is imported. The visible window comes back from `datesSet` and keys the existing `api.entries.listRange` query. No backend change.

**Tech Stack:** React 19, TanStack Router/Query, Convex, Tailwind v4, base-ui, vitest + @testing-library/react, FullCalendar v7.

**Spec:** `docs/superpowers/specs/2026-08-11-timer-calendar-view-design.md`

## Before Task 3 or Task 6: re-read timer.tsx

**The quoted `timer.tsx` blocks in Tasks 3 and 6 are stale and must be re-derived from the file, not applied as written.**

At the time this plan was written, /timer's totals row was a plain `<div className="flex w-full items-center gap-4 px-4">` holding `TotalsRow` and `ManualEntryDialog`. A sticky-header rework landed after that, and it rewrites exactly that block: the page root gains a `hostRef` and a `--log-sticky-top` custom property, the totals-and-filter region becomes one measured band publishing `--filter-band-height` through `useHeightVar`, and `ManualEntryDialog`'s placement changed with it.

The two changes fit together — the calendar header from Task 5 belongs **inside** the measured band, so it sticks with the totals rather than scrolling away above them — but that is a merge, not a coincidence. Before dispatching either task:

1. Read the current `src/routes/_authed/timer.tsx` in full.
2. Rewrite that task's quoted block against what is actually there, preserving the `hostRef` / `measuredRef` wiring and the `--log-sticky-top` composition untouched.
3. Put the `CalendarHeader` inside the element `measuredRef` measures, so `--filter-band-height` accounts for it.

## Global Constraints

- **FullCalendar v7 only.** `@fullcalendar/react@^7.0.2` plus peer deps `temporal-polyfill@^1.0.1` and `@full-ui/headless-calendar` (installed transitively by `@fullcalendar/react`). The `timeGrid` plugin is the **subpath export** `@fullcalendar/react/timegrid`. **Never install `@fullcalendar/timegrid`** — that standalone package is stranded at 6.1.21 and pins core to v6.
- **No FullCalendar theme.** Import `@fullcalendar/react/skeleton.css` only. Do not import anything under `@fullcalendar/react/themes/`.
- **Every day boundary goes through `@shared/day`** (`convex/lib/day.ts`). No `new Date(...)` arithmetic in local time, no `86_400_000` divisors. `@shared/*` resolves to `./convex/lib/*`.
- **The Cold Light Rule.** `enlarger` marks a running timer and nothing else. The now-indicator is Ink Muted, never `enlarger`.
- **The Tabular Rule.** Every digit the user reads carries the `tabular` class — hour labels, day totals, the range total, times inside a block.
- **The Two Temperatures Rule.** Blocks carry no project hue. Project identity is `ProjectDot` plus the name.
- **The Boundary Rule / Adjacent Colour Rule.** A block sits on a panel, so its border is `edge-raised`, not `edge`.
- **Nothing animates** on the grid. No transitions on the now-line or the running block.
- Commands: `pnpm vitest run <file>`, `pnpm typecheck`, `pnpm lint`.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: `calendar-events.ts` — rows to events, and day totals

**Files:**
- Create: `src/lib/calendar-events.ts`
- Test: `src/lib/calendar-events.test.ts`

**Interfaces:**
- Consumes: `Doc<"timeEntries">` from `convex/_generated/dataModel`; `dayOf` from `@shared/day`.
- Produces:
  - `type CalendarEvent` — an `EventInput` with typed `extendedProps`
  - `calendarEvents(entries: Array<Doc<"timeEntries">>, nowMs: number): Array<CalendarEvent>`
  - `dayTotals(entries: Array<Doc<"timeEntries">>, timeZone: string, nowMs: number): Map<DayString, number>`
  - `earliestHour(entries: Array<Doc<"timeEntries">>, timeZone: string, fallbackHour: number): number`

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendar-events.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { calendarEvents, dayTotals, earliestHour } from "./calendar-events"
import type { Doc } from "../../convex/_generated/dataModel"

/*
 * The mapping into FullCalendar, and the day totals beside it.
 *
 * Pure and tested here rather than through the grid, because FullCalendar
 * measures element geometry to lay itself out and jsdom reports every element
 * as zero-sized — a rendered assertion about this file would be a rendered
 * assertion about nothing.
 */

const UTC = "UTC"

/** A completed entry. Only the fields this module reads are populated. */
function entry(over: Partial<Doc<"timeEntries">>): Doc<"timeEntries"> {
  return {
    _id: "e1",
    _creationTime: 0,
    userId: "u1",
    title: "Fixing the logbook",
    startedAt: Date.UTC(2026, 7, 10, 9, 0),
    endedAt: Date.UTC(2026, 7, 10, 10, 0),
    projectId: undefined,
    tagIds: [],
    billable: false,
    note: undefined,
    clientKey: "k1",
    deletedAt: null,
    ...over,
  } as unknown as Doc<"timeEntries">
}

const NOW = Date.UTC(2026, 7, 10, 12, 0)

describe("calendarEvents", () => {
  it("carries absolute instants, not wall-clock strings", () => {
    // An ISO string without an offset is interpreted in the calendar's own
    // timeZone. That is right by accident until something reads the field a
    // different way, so the contract is a Date built from the stored instant.
    const [event] = calendarEvents([entry({})], NOW)
    expect(event.start).toBeInstanceOf(Date)
    expect((event.start as Date).getTime()).toBe(Date.UTC(2026, 7, 10, 9, 0))
    expect((event.end as Date).getTime()).toBe(Date.UTC(2026, 7, 10, 10, 0))
  })

  it("ends a running entry at now", () => {
    const [event] = calendarEvents([entry({ endedAt: null })], NOW)
    expect((event.end as Date).getTime()).toBe(NOW)
    expect(event.extendedProps.running).toBe(true)
  })

  it("floors a zero-length entry to one minute", () => {
    // FullCalendar drops an event whose end equals its start. A row that
    // exists must be visible, or it cannot be edited from this view at all.
    const at = Date.UTC(2026, 7, 10, 9, 0)
    const [event] = calendarEvents([entry({ startedAt: at, endedAt: at })], NOW)
    expect((event.end as Date).getTime()).toBe(at + 60_000)
  })

  it("passes the classification through for styling", () => {
    const [event] = calendarEvents(
      [entry({ projectId: "p1" as never, billable: true })],
      NOW
    )
    expect(event.extendedProps.projectId).toBe("p1")
    expect(event.extendedProps.billable).toBe(true)
    expect(event.extendedProps.running).toBe(false)
    expect(event.id).toBe("e1")
  })
})

describe("dayTotals", () => {
  it("attributes a midnight-crossing entry wholly to the day it began", () => {
    // convex/entries.ts:207. The grid draws this entry in both columns, so
    // this is the assertion that keeps a column total from disagreeing with
    // the same day's header in List.
    const totals = dayTotals(
      [
        entry({
          startedAt: Date.UTC(2026, 7, 10, 23, 0),
          endedAt: Date.UTC(2026, 7, 11, 1, 30),
        }),
      ],
      UTC,
      NOW
    )
    expect(totals.get("2026-08-10")).toBe(2.5 * 3_600_000)
    expect(totals.get("2026-08-11")).toBeUndefined()
  })

  it("sums several entries on one day", () => {
    const totals = dayTotals(
      [
        entry({
          startedAt: Date.UTC(2026, 7, 10, 9, 0),
          endedAt: Date.UTC(2026, 7, 10, 10, 0),
        }),
        entry({
          _id: "e2",
          startedAt: Date.UTC(2026, 7, 10, 14, 0),
          endedAt: Date.UTC(2026, 7, 10, 14, 30),
        } as Partial<Doc<"timeEntries">>),
      ],
      UTC,
      NOW
    )
    expect(totals.get("2026-08-10")).toBe(1.5 * 3_600_000)
  })

  it("counts a running entry's elapsed time so far", () => {
    const totals = dayTotals(
      [
        entry({
          startedAt: Date.UTC(2026, 7, 10, 11, 0),
          endedAt: null,
        }),
      ],
      UTC,
      NOW
    )
    expect(totals.get("2026-08-10")).toBe(3_600_000)
  })
})

describe("earliestHour", () => {
  it("returns the hour of the earliest start in the user's zone", () => {
    const hour = earliestHour(
      [
        entry({ startedAt: Date.UTC(2026, 7, 10, 14, 12) }),
        entry({ _id: "e2", startedAt: Date.UTC(2026, 7, 10, 9, 45) } as Partial<
          Doc<"timeEntries">
        >),
      ],
      UTC,
      8
    )
    expect(hour).toBe(9)
  })

  it("falls back when nothing is tracked", () => {
    expect(earliestHour([], UTC, 8)).toBe(8)
  })

  it("reads the hour in the stored zone, not the browser's", () => {
    // 23:30 UTC is 07:30 the next morning in Manila. A grid scrolled to 23:00
    // for a 07:30 start is a grid scrolled past every block on it.
    const hour = earliestHour(
      [entry({ startedAt: Date.UTC(2026, 7, 9, 23, 30) })],
      "Asia/Manila",
      8
    )
    expect(hour).toBe(7)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/calendar-events.test.ts`
Expected: FAIL — `Failed to resolve import "./calendar-events"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendar-events.ts`:

```ts
import { dayOf, localPartsOf } from "@shared/day"
import type { DayString } from "@shared/day"
import type { EventInput } from "@fullcalendar/react"
import type { Doc } from "../../convex/_generated/dataModel"

/**
 * Time entries, in the shape FullCalendar takes.
 *
 * Pure and separately tested, for a reason worth stating: FullCalendar measures
 * element geometry to lay a grid out and jsdom reports every element as
 * zero-sized, so nothing about the rendered calendar can be asserted in a unit
 * test. Everything that CAN be asserted therefore lives here, on this side of
 * the boundary.
 */

/** The typed half of `extendedProps`, read by the panel's class-name props. */
export type CalendarEventProps = {
  entryId: string
  projectId: string | undefined
  billable: boolean
  running: boolean
}

export type CalendarEvent = EventInput & { extendedProps: CalendarEventProps }

/** The smallest span FullCalendar will still draw. See `calendarEvents`. */
const MIN_SPAN_MS = 60_000

export function calendarEvents(
  entries: Array<Doc<"timeEntries">>,
  nowMs: number
): Array<CalendarEvent> {
  return entries.map((entry) => {
    const running = entry.endedAt === null
    const ended = entry.endedAt ?? nowMs

    return {
      id: entry._id,
      title: entry.title,
      /*
       * `Date`s built from the stored instants, never ISO strings.
       *
       * FullCalendar reads a string with no UTC offset as a wall-clock time in
       * the calendar's own `timeZone`. That happens to agree with the stored
       * instant today and stops agreeing the moment anything formats the field
       * differently — and a time entry drawn an hour off its real start is the
       * defect this product can least afford. A `Date` is an absolute moment
       * and cannot be reinterpreted.
       */
      start: new Date(entry.startedAt),
      /*
       * Floored to one minute. FullCalendar drops an event whose end equals its
       * start, and a row that exists must be visible or it cannot be edited
       * from this view. `eventMinHeight` keeps it clickable once it is drawn.
       */
      end: new Date(Math.max(ended, entry.startedAt + MIN_SPAN_MS)),
      extendedProps: {
        entryId: entry._id,
        projectId: entry.projectId,
        billable: entry.billable,
        running,
      },
    }
  })
}

/**
 * Milliseconds tracked per local day, keyed by `DayString`.
 *
 * ATTRIBUTION BY START, matching convex/entries.ts: an entry running 23:00 to
 * 01:30 belongs wholly to the day it began. The grid draws that entry in both
 * columns — FullCalendar segments it and the tail is hatched — so this function
 * is what keeps the column header from claiming time the day did not earn, and
 * what keeps it agreeing with the same day's header in the list.
 */
export function dayTotals(
  entries: Array<Doc<"timeEntries">>,
  timeZone: string,
  nowMs: number
): Map<DayString, number> {
  const totals = new Map<DayString, number>()
  for (const entry of entries) {
    const day = dayOf(entry.startedAt, timeZone)
    const ended = entry.endedAt ?? nowMs
    const elapsed = Math.max(0, ended - entry.startedAt)
    totals.set(day, (totals.get(day) ?? 0) + elapsed)
  }
  return totals
}

/**
 * The hour the grid should open scrolled to.
 *
 * The earliest start in the range, in the USER's stored zone — read through
 * `localPartsOf` rather than `getHours()`, which would answer for the browser.
 * A grid scrolled to 23:00 because the entry is 23:30 UTC, when the user is in
 * Manila and started at 07:30, is scrolled past every block on it.
 */
export function earliestHour(
  entries: Array<Doc<"timeEntries">>,
  timeZone: string,
  fallbackHour: number
): number {
  if (entries.length === 0) return fallbackHour
  let earliest = Infinity
  for (const entry of entries) {
    if (entry.startedAt < earliest) earliest = entry.startedAt
  }
  return localPartsOf(earliest, timeZone).hour
}
```

- [ ] **Step 4: Confirm `localPartsOf` returns an `hour` field**

Run: `grep -n "type LocalParts" -A 10 convex/lib/day.ts`
Expected: a field named `hour`. If it is named differently, use that name — do not add a second way to read the hour.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/calendar-events.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. `@fullcalendar/react` is not installed yet, so if the `EventInput` import fails, **stop and do Task 4's Step 1 (install) first**, then return here.

- [ ] **Step 7: Commit**

```bash
git add src/lib/calendar-events.ts src/lib/calendar-events.test.ts
git commit -m "feat(calendar): map entries to events, and total each day by start

Attribution by start is the load-bearing half. The grid draws a
midnight-crossing entry in both columns, so without this a column header
would claim time the day did not earn and disagree with the same day's
header in the list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `calendar-label.ts` — the stepper's text

**Files:**
- Create: `src/lib/calendar-label.ts`
- Test: `src/lib/calendar-label.test.ts`

**Interfaces:**
- Consumes: `addDays`, `parseDayString`, `weekdayOf` from `@shared/day`.
- Produces:
  - `type CalendarSize = "day" | "5day" | "week"`
  - `calendarLabel(firstDay: DayString, lastDay: DayString, size: CalendarSize, today: DayString): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/calendar-label.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { calendarLabel } from "./calendar-label"

/*
 * The stepper's text.
 *
 * Toggl's "W33" is deliberately absent and the absence is tested by omission:
 * ISO week numbers are Monday-based by definition and this app's week start is
 * configurable, so under weekStartDay 0 the number would name a week other
 * than the one on screen.
 */

const TODAY = "2026-08-11" // a Tuesday

describe("calendarLabel — day", () => {
  it("names today", () => {
    expect(calendarLabel("2026-08-11", "2026-08-11", "day", TODAY)).toBe(
      "Today · Tue 11 Aug"
    )
  })

  it("names yesterday", () => {
    expect(calendarLabel("2026-08-10", "2026-08-10", "day", TODAY)).toBe(
      "Yesterday · Mon 10 Aug"
    )
  })

  it("gives any other day its date alone", () => {
    expect(calendarLabel("2026-08-07", "2026-08-07", "day", TODAY)).toBe(
      "Fri 7 Aug"
    )
  })
})

describe("calendarLabel — week and 5day", () => {
  it("prefixes the week containing today", () => {
    expect(calendarLabel("2026-08-10", "2026-08-16", "week", TODAY)).toBe(
      "This week · 10–16 Aug"
    )
  })

  it("prefixes a 5-day range in the week containing today", () => {
    // Mon-Fri. Today is Tuesday, so it is inside the range.
    expect(calendarLabel("2026-08-10", "2026-08-14", "5day", TODAY)).toBe(
      "This week · 10–14 Aug"
    )
  })

  it("still says This week when today is the weekend a 5-day range hides", () => {
    // Saturday 15 Aug: not in Mon-Fri, but it IS this week. Dropping the
    // prefix here would tell the user they were looking at some other week.
    expect(calendarLabel("2026-08-10", "2026-08-14", "5day", "2026-08-15")).toBe(
      "This week · 10–14 Aug"
    )
  })

  it("drops the prefix for another week", () => {
    expect(calendarLabel("2026-08-03", "2026-08-09", "week", TODAY)).toBe(
      "3–9 Aug"
    )
  })

  it("names both months when the range crosses one", () => {
    expect(calendarLabel("2026-07-27", "2026-08-02", "week", TODAY)).toBe(
      "27 Jul – 2 Aug"
    )
  })

  it("names both years when the range crosses one", () => {
    expect(calendarLabel("2026-12-28", "2027-01-03", "week", TODAY)).toBe(
      "28 Dec 2026 – 3 Jan 2027"
    )
  })

  it("uses an en dash, per the house style for a range", () => {
    // formatTimeRange in src/lib/format-time.ts sets the precedent.
    expect(calendarLabel("2026-08-03", "2026-08-09", "week", TODAY)).toContain(
      "–"
    )
    expect(calendarLabel("2026-08-03", "2026-08-09", "week", TODAY)).not.toContain(
      " - "
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/calendar-label.test.ts`
Expected: FAIL — `Failed to resolve import "./calendar-label"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/calendar-label.ts`:

```ts
import { addDays, parseDayString, weekdayOf } from "@shared/day"
import type { DayString } from "@shared/day"

/**
 * The text between the stepper's arrows.
 *
 * Owned here rather than assembled in the header, so the calendar has one
 * answer to "which range am I looking at" — and so the awkward cases (a range
 * crossing a month, a range crossing a year, the weekend a 5-day view hides)
 * are decided in a test rather than in a template.
 *
 * NO ISO WEEK NUMBER. The reference screenshot carries "W33" and it is
 * deliberately absent: ISO weeks are Monday-based by definition, this app's
 * `weekStartDay` is configurable, and under a Sunday start the number would
 * name a week other than the one drawn on screen.
 */

export type CalendarSize = "day" | "5day" | "week"

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** "Tue 11 Aug" — a single day, without its year. */
function dayText(day: DayString): string {
  const d = parseDayString(day)
  return `${WEEKDAYS[weekdayOf(day)]} ${d.day} ${MONTHS[d.month - 1]}`
}

/**
 * "10–16 Aug", "27 Jul – 2 Aug", "28 Dec 2026 – 3 Jan 2027".
 *
 * The month is stated once when the range does not leave it, and the year only
 * when the range crosses one — a year on every label is noise on the 51 weeks
 * it cannot disambiguate. An en dash, matching `formatTimeRange`; spaced when
 * either side carries more than a bare number, so "27 Jul – 2 Aug" does not
 * read as one token.
 */
function rangeText(firstDay: DayString, lastDay: DayString): string {
  const a = parseDayString(firstDay)
  const b = parseDayString(lastDay)

  if (a.year !== b.year) {
    return `${a.day} ${MONTHS[a.month - 1]} ${a.year} – ${b.day} ${MONTHS[b.month - 1]} ${b.year}`
  }
  if (a.month !== b.month) {
    return `${a.day} ${MONTHS[a.month - 1]} – ${b.day} ${MONTHS[b.month - 1]}`
  }
  return `${a.day}–${b.day} ${MONTHS[a.month - 1]}`
}

export function calendarLabel(
  firstDay: DayString,
  lastDay: DayString,
  size: CalendarSize,
  today: DayString
): string {
  if (size === "day") {
    if (firstDay === today) return `Today · ${dayText(firstDay)}`
    if (firstDay === addDays(today, -1)) return `Yesterday · ${dayText(firstDay)}`
    return dayText(firstDay)
  }

  /*
   * "This week" is decided against the whole seven days, not against the
   * columns on screen.
   *
   * A 5-day range is Mon-Fri, so on a Saturday `today` is outside it — and
   * dropping the prefix there would tell the user they were looking at some
   * other week, which is the one thing the label exists to prevent. String
   * comparison is safe: a `DayString` is zero-padded ISO, so it sorts
   * chronologically.
   */
  const weekEnd = addDays(firstDay, 6)
  const thisWeek = today >= firstDay && today <= weekEnd

  const range = rangeText(firstDay, lastDay)
  return thisWeek ? `This week · ${range}` : range
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/calendar-label.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calendar-label.ts src/lib/calendar-label.test.ts
git commit -m "feat(calendar): the stepper's text, without an ISO week number

The reference screenshot says W33. ISO weeks are Monday-based by
definition and weekStartDay is configurable here, so under a Sunday start
that number would name a week other than the one on screen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The `+` button — relocate it, and drop the prop that would go stale

This task is independent of the calendar and is shippable on its own.

**Files:**
- Modify: `src/components/entries/manual-entry-dialog.tsx`
- Modify: `src/components/timer/timer-bar.tsx`
- Modify: `src/routes/_authed.tsx`
- Modify: `src/routes/_authed/timer.tsx`
- Test: `src/components/entries/manual-entry-dialog.test.tsx`

**Interfaces:**
- Produces: `ManualEntryDialog` props change from `{ today, timeZone, onCreate }` to `{ timeZone, onCreate }`. `TimerBar` gains one prop: `onCreateManual: ManualEntryDialogProps["onCreate"]`.

- [ ] **Step 1: Write the failing test — the day is read when the dialog opens, not when it mounted**

Append to `src/components/entries/manual-entry-dialog.test.tsx`:

```tsx
it("seeds the day from the clock at open, not from a prop fixed at mount", async () => {
  /*
   * The regression this guards.
   *
   * The dialog used to take `today` as a prop. /timer recomputed it every
   * second through `useSecond`, so it was always current there — but the
   * dialog now mounts in the shell (`_authed.tsx`), which has no clock at
   * all. A prop would freeze at page load, and a tab opened yesterday
   * evening would offer yesterday at 09:00 this morning: precisely the
   * failure the re-seed-on-open effect was written to prevent, reintroduced
   * by moving the mount point.
   *
   * So the dialog reads the wall clock itself. This test mounts it, moves the
   * clock across midnight WITHOUT re-rendering, and opens it.
   */
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date("2026-08-10T23:50:00Z"))

    render(<ManualEntryDialog timeZone="UTC" onCreate={vi.fn()} />)

    vi.setSystemTime(new Date("2026-08-11T00:10:00Z"))

    fireEvent.click(screen.getByLabelText("Add entry"))

    const day = await screen.findByLabelText("Day")
    expect((day as HTMLInputElement).value).toBe("2026-08-11")
  } finally {
    vi.useRealTimers()
  }
})
```

Add `vi` to the existing `vitest` import in that file if it is not already there.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/entries/manual-entry-dialog.test.tsx`
Expected: FAIL — a TypeScript/prop error on the missing `today`, or the value comes back `2026-08-10`.

- [ ] **Step 3: Change the dialog's contract**

In `src/components/entries/manual-entry-dialog.tsx`:

Remove `today` from the props type and the destructure, so the signature reads:

```tsx
export function ManualEntryDialog({
  timeZone,
  onCreate,
}: {
  timeZone: string
  /** Passed in, not reached for — see TimerBarActions on why. */
  onCreate: (input: {
    title?: string
    note?: string
    startedAt: number
    endedAt: number
  }) => Promise<unknown>
}) {
```

Add the import for `dayOf`:

```tsx
import { dayOf } from "@shared/day"
```

Replace the `day` state initialiser and the re-seed effect. `useState` now seeds from the clock, and the effect re-reads it on open:

```tsx
  const [day, setDay] = useState<DayString>(() => dayOf(Date.now(), timeZone))
```

Replace the existing `useEffect` block and its comment with:

```tsx
  /*
   * Re-read the day every time the dialog OPENS, from the wall clock.
   *
   * This is a page people leave open, and the tab that has been sitting there
   * since yesterday evening must not offer yesterday when it is used at 09:00
   * this morning — an entry meant for today would land on a day that has very
   * likely already been reported, and go missing from the total the user is
   * looking at while they add it.
   *
   * THE CLOCK, NOT A PROP. This used to be `today: DayString`, which /timer
   * kept current by recomputing it every second (`useSecond`). The dialog now
   * mounts in the shell, above the outlet, and the shell has no clock — so a
   * prop would freeze at page load and reintroduce the exact bug this effect
   * exists to prevent. Reading `Date.now()` here removes the hazard by
   * construction rather than by whoever mounts the dialog remembering to tick.
   */
  useEffect(() => {
    if (open) setDay(dayOf(Date.now(), timeZone))
  }, [open, timeZone])
```

In `reset()`, replace `setDay(today)` with:

```tsx
    setDay(dayOf(Date.now(), timeZone))
```

Make the trigger icon-only at every width:

```tsx
      {/*
        Icon only, at every width. It sits beside Play now — the most important
        control in the app — and a label there would either crowd Play or push
        the title field, which the bar's own doc comment says must never give.
        `aria-label` carries the name, so nothing is lost but the ink.

        A 36px ghost SQUARE, deliberately not a second 42px filled circle:
        two round controls of similar weight side by side is how the one button
        that must never be mis-clicked gets mis-clicked.
      */}
      <Dialog.Trigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Add entry"
            className="size-9 shrink-0 rounded-md"
          >
            <Plus className="size-4" />
          </Button>
        }
      />
```

- [ ] **Step 4: (resolved in pre-flight — no action)**

`Button` has `size: "icon"` resolving to `size-9` ([button.tsx:32](../../../src/components/ui/button.tsx)), which is exactly the 36px square this needs. The `size-9` in the `className` above is therefore redundant; keep `rounded-md` and `shrink-0`, which are not in the variant. Verified 2026-08-11.

- [ ] **Step 5: Run the dialog tests**

Run: `pnpm vitest run src/components/entries/manual-entry-dialog.test.tsx`
Expected: PASS. The existing `getByLabelText("Add entry")` assertions keep working because the `aria-label` is unchanged.

- [ ] **Step 6: Commit the contract change**

```bash
git add src/components/entries/manual-entry-dialog.tsx src/components/entries/manual-entry-dialog.test.tsx
git commit -m "refactor(entries): the manual dialog reads the clock, not a today prop

It is about to mount in the shell, which has no clock. A \`today\` prop
would freeze at page load and offer yesterday at 09:00 this morning —
exactly what the re-seed-on-open effect was written to prevent. Reading
Date.now() at open removes the hazard by construction.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Render the trigger inside the timer bar**

In `src/components/timer/timer-bar.tsx`, add the import:

```tsx
import { ManualEntryDialog } from "@/components/entries/manual-entry-dialog"
```

Add one prop to the component's props type, immediately after `onError`:

```tsx
  /**
   * Creates a completed entry from the `+` beside Play.
   *
   * A prop for the same reason every other write here is one: the bar must
   * stay renderable against fixtures with no backend anywhere near it.
   *
   * Distinct from `actions.createCompleted`, which the idle duration popover
   * uses and which carries the staged title and classification. This one is
   * the dialog's own four fields and nothing else.
   */
  onCreateManual: (input: {
    title?: string
    note?: string
    startedAt: number
    endedAt: number
  }) => Promise<unknown>
```

Insert the dialog immediately **before** the Play button's `<button>`, after `<TimerDurationPopover … />`:

```tsx
        <ManualEntryDialog timeZone={timeZone} onCreate={onCreateManual} />
```

- [ ] **Step 8: Supply it from the layout, and remove it from the page**

In `src/routes/_authed.tsx`, add to the `<TimerBar>` element:

```tsx
            onCreateManual={editMutations.create}
```

In `src/routes/_authed/timer.tsx`:

- Delete the `import { ManualEntryDialog } from "@/components/entries/manual-entry-dialog"` line.
- The page is built on `<Page title="Timer" titleHidden sticky header={…}>`. Inside that `header` fragment, replace the **first** block — the one currently holding `TotalsRow` and `ManualEntryDialog` — with the following. The comment there argued this button belongs beside the totals; that is now the wrong answer and is rewritten rather than deleted. Note the indentation: this sits inside `header={<>`, at ten spaces.

```tsx
          {/*
            Just the totals now.

            "+ Add entry" used to sit here, and the comment this replaces
            argued for it: the numbers to its left are what prompt "I forgot to
            start the timer", so the control belonged next to them. That was
            right while the button lived on this page — and the button living
            on this page was the problem. Noticing a forgotten block happens on
            /reports at least as often, and the control was not there.

            It is a `+` beside Play in the timer bar now, which sits in the
            shell above the outlet and is therefore on every page. Same
            argument about adjacency, applied to the control it is actually
            adjacent to: the one that starts and stops the timer you forgot to
            start.
          */}
          <div className="flex w-full items-center gap-4 px-4">
            <TotalsRow
              className="py-3"
              todayMs={totals.todayMs}
              weekMs={totals.weekMs}
              billableMs={totals.billableMs}
              display={settings.durationDisplay}
            />
          </div>
```

Leave the `<FilterBand>` block that follows it untouched. Do not reintroduce `useHeightVar` — `Page` owns the measuring now.

`today` stays in use elsewhere in the file (`weekWindow`, `logRange`, `periodTotals`), so removing the dialog must not remove that binding.

- [ ] **Step 9: Move the route test's mock**

`src/routes/_authed/-timer.test.tsx:87` mocks `ManualEntryDialog` for a component the page no longer renders. Remove that entry from the page's `vi.mock` factory. If a layout-level test file exists for `_authed.tsx`, add the same mock there; if none exists, do not create one in this task.

Run: `grep -rn "ManualEntryDialog" src/routes/`
Expected: no hits in `-timer.test.tsx` after the edit.

- [ ] **Step 10: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: all pass. If a snapshot or a query for "Add entry" inside a /timer test fails, the button genuinely moved — update the assertion to reflect where it is, do not restore the old placement.

- [ ] **Step 11: Verify in the browser**

Start the dev server with the preview tooling and confirm: the `+` sits left of Play as a 36px square, opening it shows today's date, and it is present on /reports as well as /timer.

- [ ] **Step 12: Commit**

```bash
git add src/components/timer/timer-bar.tsx src/routes/_authed.tsx src/routes/_authed/timer.tsx src/routes/_authed/-timer.test.tsx
git commit -m "feat(timer): the plus moves to the bar, beside Play

Adjacency was the old comment's argument and it stays the argument — the
control just moved next to the one it is actually about. The bar lives
above the outlet, so a forgotten block can now be logged from /reports,
which is where noticing one is most likely.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Install FullCalendar and build the panel

**Files:**
- Modify: `package.json` (via the install command)
- Create: `src/components/calendar/calendar-panel.tsx`

**Interfaces:**
- Consumes: `calendarEvents`, `dayTotals`, `earliestHour` from Task 1; `CalendarSize` from Task 2.
- Produces: `CalendarPanel`, with props
  ```ts
  {
    entries: Array<Doc<"timeEntries">>
    size: CalendarSize
    anchor: DayString
    timeZone: string
    weekStartDay: number
    use12Hour: boolean
    display: DurationDisplay
    nowMs: number
    projectsById: Map<string, Doc<"projects">>
    onEntryClick: (entryId: string) => void
    onRangeChange: (range: { fromMs: number; toMs: number }) => void
  }
  ```

- [ ] **Step 1: Install**

```bash
pnpm add @fullcalendar/react@^7.0.2 temporal-polyfill@^1.0.1
```

**Do not install `@fullcalendar/timegrid`.** In v7 the plugin is the subpath export `@fullcalendar/react/timegrid`; the standalone package is stranded at 6.1.21 and pins core to v6, which will not resolve.

Verify: `grep -n "fullcalendar\|temporal-polyfill" package.json`
Expected: exactly `@fullcalendar/react` and `temporal-polyfill`.

- [ ] **Step 2: Commit the dependency on its own**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: add FullCalendar v7 for the timer calendar view

v7 specifically. It is built on temporal-polyfill, so \`timeZone\` takes an
IANA name natively — which is what makes a calendar library viable here at
all, since every alternative decides which day an instant falls on in the
BROWSER's zone and would have meant luxon as a second date system beside
convex/lib/day.ts.

Note the packaging: the plugin is the subpath @fullcalendar/react/timegrid.
The standalone @fullcalendar/timegrid package is stranded at 6.1.21.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Write the panel**

Create `src/components/calendar/calendar-panel.tsx`:

```tsx
import { useMemo, useRef } from "react"
import Calendar from "@fullcalendar/react"
import timeGridPlugin from "@fullcalendar/react/timegrid"
import { ProjectDot } from "@/components/classifiers/project-dot"
import {
  calendarEvents,
  dayTotals,
  earliestHour,
} from "@/lib/calendar-events"
import { formatTotal } from "@/lib/format-total"
import { cn } from "@/lib/utils"
import { dayOf } from "@shared/day"
import { formatClock } from "@shared/duration"
import type { CalendarSize } from "@/lib/calendar-label"
import type { DurationDisplay } from "@/lib/format-total"
import type { DayString } from "@shared/day"
import type { Doc } from "../../../convex/_generated/dataModel"

// Structure only. No theme is imported: every visible surface here is set
// through v7's class-name props, so DESIGN.md's rules are our own Tailwind
// classes rather than overrides fighting a vendored stylesheet — which is the
// failure DESIGN.md §5 records from recharts.
import "@fullcalendar/react/skeleton.css"

const PLUGINS = [timeGridPlugin]

/** 48px an hour, the density every shipping calendar has converged on. */
const SLOT_MIN_HEIGHT = 48

/** Enough that a four-minute entry is still a click target. */
const EVENT_MIN_HEIGHT = 18

/** Where the grid opens when the range is empty. */
const FALLBACK_SCROLL_HOUR = 8

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
  size,
  anchor,
  timeZone,
  weekStartDay,
  use12Hour,
  display,
  nowMs,
  projectsById,
  onEntryClick,
  onRangeChange,
}: {
  entries: Array<Doc<"timeEntries">>
  size: CalendarSize
  anchor: DayString
  timeZone: string
  weekStartDay: number
  use12Hour: boolean
  display: DurationDisplay
  nowMs: number
  projectsById: Map<string, Doc<"projects">>
  onEntryClick: (entryId: string) => void
  onRangeChange: (range: { fromMs: number; toMs: number }) => void
}) {
  const events = useMemo(() => calendarEvents(entries, nowMs), [entries, nowMs])

  const totals = useMemo(
    () => dayTotals(entries, timeZone, nowMs),
    [entries, timeZone, nowMs]
  )

  const scrollHour = useMemo(
    () => earliestHour(entries, timeZone, FALLBACK_SCROLL_HOUR),
    [entries, timeZone]
  )

  /*
   * The last range handed upward, so `datesSet` firing on a re-render cannot
   * loop. `onRangeChange` sets state in the page, which re-renders this, which
   * re-runs `datesSet` — without this guard that is a render loop, and it is
   * the standard way to get one out of this callback.
   */
  const lastRange = useRef<string>("")

  return (
    <Calendar
      plugins={PLUGINS}
      // `key` on the view, not `changeView` through a ref. The size is a prop
      // here, and remounting on a change is both simpler and correct — there
      // is no imperative state in this component worth preserving across it.
      key={size}
      initialView={size === "day" ? "timeGridDay" : "timeGridWeek"}
      initialDate={anchor}
      // The user's STORED zone, never the browser's. This is the whole reason
      // v7 is usable here: it resolves an IANA name through temporal-polyfill,
      // so the grid's midnight and `convex/lib/day.ts`'s midnight are the same
      // instant.
      timeZone={timeZone}
      firstDay={weekStartDay}
      // `[0, 6]` hides Saturday and Sunday whatever `firstDay` is, which is
      // exactly "Monday to Friday regardless of weekStartDay". A 5-day range
      // therefore also steps by a whole week for free, because it IS the week.
      hiddenDays={size === "5day" ? [0, 6] : []}
      headerToolbar={false}
      // Nothing here is all-day. An entry is a span of a working day, and an
      // empty all-day rail above every column is a band of nothing.
      allDaySlot={false}
      nowIndicator
      slotDuration="01:00:00"
      slotMinHeight={SLOT_MIN_HEIGHT}
      eventMinHeight={EVENT_MIN_HEIGHT}
      // A fixed height makes the body a scroll container with the day-header
      // row fixed above it — the arrangement every shipping calendar uses, and
      // what keeps the headers in place over 24 hours of grid.
      height={640}
      expandRows={false}
      // Opened where the work is, never at midnight. `scrollTimeReset` is left
      // at its default: it resets on navigation and is untouched by an event
      // change, which is exactly the rule — a live subscription pushes on
      // every keystroke into a title, and a grid that jumped back each time
      // would be unusable while anything is running.
      scrollTime={`${String(scrollHour).padStart(2, "0")}:00:00`}
      events={events}
      datesSet={(info) => {
        const fromMs = info.start.getTime()
        const toMs = info.end.getTime()
        const key = `${fromMs}-${toMs}`
        if (key === lastRange.current) return
        lastRange.current = key
        onRangeChange({ fromMs, toMs })
      }}
      eventClick={(info) => {
        info.jsEvent.preventDefault()
        const { entryId } = info.event.extendedProps as { entryId: string }
        onEntryClick(entryId)
      }}
      // ---- Styling. One prop per element; no stylesheet override anywhere. --
      className="text-sm"
      viewClass="rounded-lg border border-edge-soft bg-surface overflow-hidden"
      tableClass="bg-surface"
      // The header row sits outside the scroller, so it needs its own boundary
      // against the grid scrolling beneath it.
      tableHeaderClass="border-b border-edge-soft bg-surface"
      tableBodyClass="bg-surface"
      // Dividers between passive content: Edge Soft, no contrast floor.
      slotLaneClass="border-edge-soft"
      slotHeaderClass="border-edge-soft"
      slotHeaderContent={(info) => (
        // The Tabular Rule: every digit the user reads, at any size.
        <span className="tabular pr-2 text-xs text-muted-foreground">
          {formatHour(info.date, timeZone, use12Hour)}
        </span>
      )}
      dayHeaderClass="border-edge-soft py-2"
      dayHeaderContent={(info) => {
        // Through `dayOf`, so the column header and the same day's header in
        // the list are computed by one function and cannot disagree.
        const day = dayOf(info.date.getTime(), timeZone)
        const total = totals.get(day) ?? 0
        return (
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xs text-muted-foreground uppercase-none">
              {weekdayShort(info.date, timeZone)}
            </span>
            <span className="tabular text-base text-foreground">
              {dayNumber(info.date, timeZone)}
            </span>
            <span className="tabular text-xs text-muted-foreground">
              {formatTotal(total, display)}
            </span>
          </div>
        )
      }}
      // The now-indicator marks NOW, not RUNNING. Ink Muted, never
      // `enlarger` — see the Cold Light Rule.
      nowIndicatorLineClass="border-t border-muted-foreground"
      nowIndicatorDotClass="bg-muted-foreground"
      columnEventClass={(info) => {
        const running = Boolean(info.event.extendedProps.running)
        return cn(
          // No transition anywhere: the running block's height changes with
          // the clock, and an eased height change is continuous motion with no
          // reduced-motion alternative.
          "overflow-hidden rounded-md border px-1.5 py-1 text-left",
          running
            ? // Cold light, and only here: something IS running.
              "border-enlarger bg-enlarger/15 text-foreground"
            : // A block sits on a panel, not on ground, so Edge Raised is the
              // token that clears 3:1 there — the Adjacent Colour Rule.
              "border-edge-raised bg-surface-raised text-foreground",
          // The tail of an entry that crossed midnight. FullCalendar segments
          // it across both columns and `isStart` says which half this is. A
          // continuation is a TEXTURE, never a hue — the Hatch Rule.
          info.isStart ? null : "hatch-empty"
        )
      }}
      eventContent={(info) => {
        const running = Boolean(info.event.extendedProps.running)
        const projectId = info.event.extendedProps.projectId as
          | string
          | undefined
        const project =
          projectId === undefined ? null : (projectsById.get(projectId) ?? null)

        // A tail carries no title. It is the same entry as the block at the
        // bottom of the previous column, and repeating the title there reads
        // as a second entry rather than as a continuation.
        if (!info.isStart) {
          return (
            <span className="sr-only">
              {info.event.title} — continued from the previous day
            </span>
          )
        }

        return (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-xs font-medium">
              {info.event.title.trim() === "" ? "Untitled" : info.event.title}
            </span>
            <span className="tabular truncate text-[0.6875rem] text-muted-foreground">
              {running ? formatClock(nowMs - info.event.start!.getTime()) : info.timeText}
            </span>
            <ProjectDot project={project} className="text-[0.6875rem]" />
          </div>
        )
      }}
    />
  )
}

/*
 * Three small formatters, kept local.
 *
 * Each takes a `Date` that FullCalendar hands to a render hook and formats it
 * in the USER's stored zone — never through `getHours()`/`getDate()`, which
 * would answer for the browser and put the whole grid's labels an hour or a
 * day out for anyone not sitting in their own timezone.
 */

function formatHour(date: Date, timeZone: string, use12Hour: boolean): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    hour12: use12Hour,
    ...(use12Hour ? {} : { minute: "2-digit" }),
  }).format(date)
}

function weekdayShort(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" }).format(
    date
  )
}

function dayNumber(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric" }).format(
    date
  )
}
```

- [ ] **Step 4: Remove the placeholder class**

`uppercase-none` in `dayHeaderContent` is not a Tailwind utility — it was written to make the Sentence Case Rule explicit and does nothing. Delete it; the default case is already correct.

- [ ] **Step 5: Confirm `formatClock` is exported from `@shared/duration`**

Run: `grep -n "export function formatClock" convex/lib/duration.ts`
Expected: one hit. If it is named differently, use the real name — do not add a second duration formatter.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. Two things commonly bite here:
- `info.event.start` is `Date | null`; the non-null assertion above is safe inside `eventContent` because every event this panel produces has a start, but if the compiler config forbids `!`, guard with `info.event.start === null ? "" : …`.
- `slotHeaderContent` and friends must return a `ReactNode`. If v7 wants `{ domNodes }` or a string for a particular hook, the type error will say so — follow it rather than casting.

- [ ] **Step 7: Commit**

```bash
git add src/components/calendar/calendar-panel.tsx
git commit -m "feat(calendar): the grid, styled through v7's class-name props

No theme imported and no stylesheet override: skeleton.css for structure,
then one Tailwind class prop per element. The two rules most at risk here
are written into the props themselves — the now-indicator is Ink Muted
because it marks NOW and not RUNNING, and the midnight tail is hatched
rather than tinted because a continuation is a texture.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `calendar-header.tsx` — stepper, size, range total

**Files:**
- Create: `src/components/calendar/calendar-header.tsx`
- Test: `src/components/calendar/calendar-header.test.tsx`

**Interfaces:**
- Consumes: `calendarLabel` and `CalendarSize` from Task 2; `formatTotal` from `@/lib/format-total`.
- Produces: `CalendarHeader`, with props
  ```ts
  {
    firstDay: DayString
    lastDay: DayString
    size: CalendarSize
    today: DayString
    rangeMs: number
    display: DurationDisplay
    onStep: (delta: -1 | 1) => void
    onToday: () => void
    onSizeChange: (size: CalendarSize) => void
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/components/calendar/calendar-header.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { CalendarHeader } from "./calendar-header"

const base = {
  firstDay: "2026-08-10",
  lastDay: "2026-08-16",
  size: "week" as const,
  today: "2026-08-11",
  rangeMs: 53_848_000,
  display: "hms" as const,
  onStep: vi.fn(),
  onToday: vi.fn(),
  onSizeChange: vi.fn(),
}

describe("CalendarHeader", () => {
  it("shows the label and the range total", () => {
    render(<CalendarHeader {...base} />)
    expect(screen.getByText("This week · 10–16 Aug")).toBeTruthy()
    expect(screen.getByText("14:57:28")).toBeTruthy()
  })

  it("steps back and forward", () => {
    const onStep = vi.fn()
    render(<CalendarHeader {...base} onStep={onStep} />)
    fireEvent.click(screen.getByLabelText("Previous week"))
    expect(onStep).toHaveBeenCalledWith(-1)
    fireEvent.click(screen.getByLabelText("Next week"))
    expect(onStep).toHaveBeenCalledWith(1)
  })

  it("names the step buttons for the size on screen", () => {
    // "Previous week" is a lie on a day view, and it is the accessible name —
    // the only name a screen-reader user gets.
    render(<CalendarHeader {...base} size="day" />)
    expect(screen.getByLabelText("Previous day")).toBeTruthy()
    expect(screen.getByLabelText("Next day")).toBeTruthy()
  })

  it("changes size", () => {
    const onSizeChange = vi.fn()
    render(<CalendarHeader {...base} onSizeChange={onSizeChange} />)
    fireEvent.change(screen.getByLabelText("Calendar range"), {
      target: { value: "day" },
    })
    expect(onSizeChange).toHaveBeenCalledWith("day")
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/components/calendar/calendar-header.test.tsx`
Expected: FAIL — `Failed to resolve import "./calendar-header"`.

- [ ] **Step 3: Write the header**

Create `src/components/calendar/calendar-header.tsx`:

```tsx
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { calendarLabel } from "@/lib/calendar-label"
import { formatTotal } from "@/lib/format-total"
import { cn } from "@/lib/utils"
import type { CalendarSize } from "@/lib/calendar-label"
import type { DurationDisplay } from "@/lib/format-total"
import type { DayString } from "@shared/day"

const SIZES: Array<{ value: CalendarSize; label: string; unit: string }> = [
  { value: "week", label: "Week view", unit: "week" },
  { value: "5day", label: "5 days view", unit: "week" },
  { value: "day", label: "Day view", unit: "day" },
]

/**
 * The calendar's own range bar.
 *
 * It carries the RANGE total, and `TotalsRow` above it does not change. Today
 * and this-week are ambient facts about the clock, not properties of what the
 * calendar happens to be showing — so stepping back to July must not make the
 * page's "today" figure describe July. Two numbers that mean different things
 * sitting side by side pretending to be the same one is how a freelancer bills
 * the wrong week.
 */
export function CalendarHeader({
  firstDay,
  lastDay,
  size,
  today,
  rangeMs,
  display,
  onStep,
  onToday,
  onSizeChange,
}: {
  firstDay: DayString
  lastDay: DayString
  size: CalendarSize
  today: DayString
  rangeMs: number
  display: DurationDisplay
  onStep: (delta: -1 | 1) => void
  onToday: () => void
  onSizeChange: (size: CalendarSize) => void
}) {
  // A 5-day range steps by a whole week, because it IS the week view with the
  // weekend hidden — so the unit a screen reader hears must say "week" too.
  const unit = SIZES.find((s) => s.value === size)?.unit ?? "week"

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        className={cn(
          "flex items-center gap-1 rounded-md border border-edge-raised",
          "bg-ground px-1 py-0.5"
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Previous ${unit}`}
          className="size-7"
          onClick={() => onStep(-1)}
        >
          <ChevronLeft className="size-4" />
        </Button>

        {/* The label is a BUTTON: pressing the thing that says "This week"
            to get back to this week is the gesture people already try. */}
        <button
          type="button"
          onClick={onToday}
          className={cn(
            "tabular rounded px-2 py-1 text-sm text-foreground",
            "hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring",
            "focus-visible:outline-none"
          )}
        >
          {calendarLabel(firstDay, lastDay, size, today)}
        </button>

        <Button
          variant="ghost"
          size="icon"
          aria-label={`Next ${unit}`}
          className="size-7"
          onClick={() => onStep(1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        {/* Sentence case, per The Sentence Case Rule. */}
        <span className="sr-only">Calendar range</span>
        <select
          aria-label="Calendar range"
          value={size}
          onChange={(event) => onSizeChange(event.target.value as CalendarSize)}
          className={cn(
            "rounded-md border border-edge-raised bg-ground px-2 py-1.5",
            "text-sm text-foreground",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <span className="ml-auto flex items-baseline gap-2 text-xs text-muted-foreground">
        Range total
        {/* The Tabular Rule. */}
        <span className="tabular text-sm text-foreground">
          {formatTotal(rangeMs, display)}
        </span>
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/calendar/calendar-header.test.tsx`
Expected: PASS, 4 tests. `Button` does have a `size="icon"` variant (`size-9`); the `size-7` in `className` deliberately overrides it, because these steppers sit inside a bordered group and a 36px control there makes the group taller than the totals beside it.

- [ ] **Step 5: Commit**

```bash
git add src/components/calendar/calendar-header.tsx src/components/calendar/calendar-header.test.tsx
git commit -m "feat(calendar): the range bar, carrying the range's own total

TotalsRow stays pinned to today and this week. Stepping back to July must
not make the page's 'today' figure describe July, so the range's figure
lives here instead — two numbers meaning different things side by side is
how a freelancer bills the wrong week.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire it into /timer

**Files:**
- Modify: `src/routes/_authed/timer.tsx`
- Test: `src/routes/_authed/-timer.test.tsx`
- Test: `src/lib/calendar-range-agreement.test.ts` (create)

**Interfaces:**
- Consumes: `CalendarPanel` (Task 4), `CalendarHeader` (Task 5), `calendarEvents`/`dayTotals` (Task 1), `CalendarSize` (Task 2).
- Produces: nothing downstream.

- [ ] **Step 1: Write the date-system agreement test**

This is the assertion the whole library decision rests on. Create `src/lib/calendar-range-agreement.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { Temporal } from "temporal-polyfill"
import { addDays, startOfDay, weekWindow } from "@shared/day"

/*
 * The one place two date systems could disagree.
 *
 * FullCalendar v7 resolves timezones through temporal-polyfill; everything
 * else in this app resolves them through `Intl` in convex/lib/day.ts. Both are
 * correct implementations of the same rules, so they SHOULD agree about when a
 * local day begins — and if they ever stop, every block on the calendar shifts
 * relative to the day headers and nothing else in the suite would say so.
 *
 * This asserts the agreement directly, rather than trying to render the grid:
 * FullCalendar measures element geometry and jsdom reports every element as
 * zero-sized, so a rendered assertion here would be an assertion about
 * nothing.
 */

/** Midnight for a local day, computed the way FullCalendar's engine would. */
function temporalStartOfDay(day: string, timeZone: string): number {
  return Temporal.PlainDate.from(day)
    .toZonedDateTime({ timeZone })
    .epochMilliseconds
}

const ZONES = ["UTC", "Asia/Manila", "America/New_York", "Europe/Berlin"]

describe("day.ts and temporal agree about midnight", () => {
  it("agrees on an ordinary day in every zone we care about", () => {
    for (const zone of ZONES) {
      expect(temporalStartOfDay("2026-08-10", zone)).toBe(
        startOfDay("2026-08-10", zone)
      )
    }
  })

  it("agrees across a spring-forward boundary", () => {
    // 8 March 2026, America/New_York: 02:00 does not exist.
    for (const day of ["2026-03-07", "2026-03-08", "2026-03-09"]) {
      expect(temporalStartOfDay(day, "America/New_York")).toBe(
        startOfDay(day, "America/New_York")
      )
    }
  })

  it("agrees across a fall-back boundary", () => {
    // 1 November 2026, America/New_York: 01:00 happens twice.
    for (const day of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
      expect(temporalStartOfDay(day, "America/New_York")).toBe(
        startOfDay(day, "America/New_York")
      )
    }
  })

  it("agrees about a whole week's span, including a DST week", () => {
    for (const anchor of ["2026-08-11", "2026-03-08", "2026-11-01"]) {
      for (const weekStartDay of [0, 1]) {
        const week = weekWindow(anchor, "America/New_York", weekStartDay)
        expect(temporalStartOfDay(week.firstDay, "America/New_York")).toBe(
          week.fromMs
        )
        expect(
          temporalStartOfDay(addDays(week.lastDay, 1), "America/New_York")
        ).toBe(week.toMs)
      }
    }
  })
})
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run src/lib/calendar-range-agreement.test.ts`
Expected: PASS, 4 tests. **If any fail, stop and report it** — a disagreement here means the calendar cannot be trusted against the day headers, and the fix is a design decision, not a code tweak.

- [ ] **Step 3: Commit the agreement test on its own**

```bash
git add src/lib/calendar-range-agreement.test.ts
git commit -m "test(calendar): assert temporal and day.ts agree about midnight

The library decision rests on this. FullCalendar v7 resolves zones through
temporal-polyfill and the rest of the app resolves them through Intl in
convex/lib/day.ts; if those ever drift, every block shifts relative to the
day headers and nothing else in the suite would notice. Checked across
both DST boundaries and four zones.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Add the view state and the calendar's query to timer.tsx**

Add these imports:

```tsx
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CalendarHeader } from "@/components/calendar/calendar-header"
import { CalendarPanel } from "@/components/calendar/calendar-panel"
import { dayTotals } from "@/lib/calendar-events"
import { weekStartOf } from "@shared/day"
import type { CalendarSize } from "@/lib/calendar-label"
```

After the existing `filters` state, add:

```tsx
  /*
   * The calendar's view and its anchor.
   *
   * `useState` beside `filters`, not in the URL — Reports does not put its
   * period in the URL either, and one page inventing a second convention for
   * the same kind of state is how the two come to disagree.
   *
   * This gives /timer a bounded PERIOD, which the comment on `filters` above
   * says it does not have. That comment is still true of the LIST, whose range
   * is `fromMs: 0` and always will be. The period belongs to the calendar
   * view, and presets and a date-range picker stay exclusive to Reports: a
   * stepper over a fixed-width window is a different control answering a
   * different question.
   */
  const [view, setView] = useState<"calendar" | "list">("list")
  const [size, setSize] = useState<CalendarSize>("week")
  const [anchor, setAnchor] = useState<DayString>(today)

  /*
   * The window FullCalendar is actually showing, reported back by `datesSet`.
   *
   * Taken from the grid rather than computed here on purpose: computing it
   * twice is how the query and the columns come to describe different weeks.
   * `null` until the first `datesSet` fires, which is why the query below is
   * `useQuery` with an enabled guard rather than `useSuspenseQuery`.
   */
  const [calendarRange, setCalendarRange] = useState<{
    fromMs: number
    toMs: number
  } | null>(null)

  const calendarQuery = useQuery({
    ...convexQuery(
      api.entries.listRange,
      calendarRange ?? { fromMs: 0, toMs: 0 }
    ),
    enabled: view === "calendar" && calendarRange !== null,
  })
```

Add `useQuery` to the `@tanstack/react-query` import, and `DayString` to the `@shared/day` type imports.

- [ ] **Step 5: Apply the same filter to the calendar's rows**

Immediately after `calendarQuery`:

```tsx
  /*
   * ONE filter, both views.
   *
   * The same `filters` state and the same `matches` the list uses. Hiding the
   * band with the list was the alternative and it silently drops a filter the
   * user set — a control disappearing is indistinguishable from the data
   * changing, which is the one impression a billing tool cannot afford.
   */
  const calendarEntries = useMemo(() => {
    const rows = calendarQuery.data ?? []
    return filtering ? rows.filter((entry) => matches(entry, filters, nameOf)) : rows
  }, [calendarQuery.data, filtering, filters, nameOf])

  const calendarTotalMs = useMemo(() => {
    let sum = 0
    for (const ms of dayTotals(calendarEntries, settings.timezone, nowMs).values()) {
      sum += ms
    }
    return sum
  }, [calendarEntries, settings.timezone, nowMs])
```

- [ ] **Step 6: Add the switcher to the totals row**

Replace the totals-row block from Task 3 with:

```tsx
      <div className="flex w-full flex-wrap items-center gap-4 px-4">
        <TotalsRow
          className="py-3"
          todayMs={totals.todayMs}
          weekMs={totals.weekMs}
          billableMs={totals.billableMs}
          display={settings.durationDisplay}
        />

        {/*
          TABS, NOT TWO ROUTES — reports.tsx settled this argument for Summary
          and Detailed and it holds here for the same reason: the filter band
          below is ONE control governing both views. A freelancer narrows to a
          client and then looks at the shape of the week and at the rows behind
          the shape; a second page would mean setting the filter twice and
          would let the two drift apart with nothing on screen to say so.
        */}
        <Tabs
          value={view}
          onValueChange={(next) => setView(next as "calendar" | "list")}
          className="ml-auto"
        >
          <TabsList variant="line">
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "calendar" ? (
        <div className="w-full px-4 pb-3">
          <CalendarHeader
            firstDay={
              size === "day" ? anchor : weekStartOf(anchor, settings.weekStartDay)
            }
            lastDay={lastVisibleDay(anchor, size, settings.weekStartDay)}
            size={size}
            today={today}
            rangeMs={calendarTotalMs}
            display={settings.durationDisplay}
            onStep={(delta) =>
              setAnchor((current) => addDays(current, size === "day" ? delta : delta * 7))
            }
            onToday={() => setAnchor(today)}
            onSizeChange={setSize}
          />
        </div>
      ) : null}
```

Add `addDays` to the `@shared/day` import, and define the helper at the bottom of the file:

```tsx
/**
 * The last day the grid is showing.
 *
 * A 5-day range ends on Friday, four days after the week's Monday — NOT on the
 * week's last day, which is the weekend it exists to hide. The label would
 * otherwise say "10–16 Aug" over five columns ending on the 14th.
 */
function lastVisibleDay(
  anchor: DayString,
  size: CalendarSize,
  weekStartDay: number
): DayString {
  if (size === "day") return anchor
  if (size === "5day") return addDays(weekStartOf(anchor, 1), 4)
  return addDays(weekStartOf(anchor, weekStartDay), 6)
}
```

- [ ] **Step 7: Render the panel instead of the log when Calendar is on**

Wrap the existing log block. Replace `{status === "LoadingFirstPage" ? … }` and the `FilteredLogStatus` beneath it with:

```tsx
        {view === "calendar" ? (
          <div className="w-full px-4 pb-4">
            <CalendarPanel
              entries={calendarEntries}
              size={size}
              anchor={anchor}
              timeZone={settings.timezone}
              weekStartDay={settings.weekStartDay}
              use12Hour={settings.timeFormat === "12"}
              display={settings.durationDisplay}
              nowMs={nowMs}
              projectsById={projectsById}
              onEntryClick={(entryId) => {
                // Editing lives where it already lives. The calendar is a
                // picture of the week, not a second editor — a block opens the
                // row's own controls rather than growing a form of its own.
                const target = document.querySelector<HTMLElement>(
                  `[data-entry-id="${entryId}"]`
                )
                target?.scrollIntoView({ block: "center" })
                target?.focus()
              }}
              onRangeChange={setCalendarRange}
            />
          </div>
        ) : status === "LoadingFirstPage" ? (
          <LogSkeleton />
        ) : (
          <>
            <EntryLog
              groups={groups}
              timeZone={settings.timezone}
              use12Hour={settings.timeFormat === "12"}
              weekStartDay={settings.weekStartDay}
              display={settings.durationDisplay}
              empty={filtering ? null : undefined}
            />
            <FilteredLogStatus
              filtering={filtering}
              matchCount={rowCount}
              status={status}
              onLoadMore={() => loadMore(PAGE_SIZE)}
            />
          </>
        )}
```

- [ ] **Step 8: Make the entry row addressable, and route the click through it**

Pre-flight confirmed there is **no `data-entry-id` anywhere in the codebase**, so `onEntryClick` as sketched in Step 7 would query for an attribute that does not exist and silently do nothing. Decided 2026-08-11: add the attribute rather than drop the affordance.

In `src/components/entries/entry-row.tsx`, on the row's outermost element, add:

```tsx
      data-entry-id={entry._id}
      tabIndex={-1}
```

`tabIndex={-1}`, not `0`. The row must be **focusable programmatically** so the calendar can hand focus to it, and must **not** join the tab order — a log of 200 rows would otherwise put 200 stops between the filter band and anything below it, and every control inside a row is already reachable on its own.

Then in timer.tsx, replace the `onEntryClick` body from Step 7 with:

```tsx
              onEntryClick={(entryId) => {
                /*
                 * The calendar navigates; it does not edit.
                 *
                 * A block is a picture of an entry, and the editing controls
                 * for that entry already exist on its row — inline title, the
                 * time popover, the note sheet. Growing a second editor inside
                 * a popover on the grid would mean two places to fix the same
                 * mistyped field, which is how they come to disagree.
                 *
                 * So: switch to List, then focus the row. The switch has to
                 * happen first and the focus after paint, because the row is
                 * not mounted until List renders.
                 */
                setView("list")
                requestAnimationFrame(() => {
                  const row = document.querySelector<HTMLElement>(
                    `[data-entry-id="${entryId}"]`
                  )
                  row?.scrollIntoView({ block: "center" })
                  row?.focus()
                })
              }}
```

- [ ] **Step 8a: Test that the row is addressable**

Add to `src/components/entries/day-list.test.tsx` (or `entry-row`'s own test file if one exists):

```tsx
it("makes each row addressable and focusable without joining the tab order", () => {
  // The calendar hands focus to a row by id. tabIndex -1 is load-bearing:
  // at 0, a log of 200 rows puts 200 tab stops between the filter band and
  // anything beneath it.
  renderDayList() // use this file's existing helper
  const row = document.querySelector<HTMLElement>("[data-entry-id]")
  expect(row).not.toBeNull()
  expect(row!.tabIndex).toBe(-1)
})
```

Run: `pnpm vitest run src/components/entries/day-list.test.tsx`
Expected: PASS.

- [ ] **Step 9: Mock the panel in the route test**

FullCalendar measures element geometry and jsdom reports every element as zero-sized, so the real panel cannot be rendered meaningfully in a unit test. In `src/routes/_authed/-timer.test.tsx`, add to the existing mock block:

```tsx
vi.mock("@/components/calendar/calendar-panel", () => ({
  CalendarPanel: () => <div data-testid="calendar-panel" />,
}))
```

- [ ] **Step 10: Test the switcher and the shared filter**

Add to `src/routes/_authed/-timer.test.tsx`:

```tsx
it("swaps the log for the calendar and back", async () => {
  renderTimer() // use whatever helper this file already has

  expect(screen.queryByTestId("calendar-panel")).toBeNull()

  fireEvent.click(screen.getByRole("tab", { name: "Calendar" }))
  expect(await screen.findByTestId("calendar-panel")).toBeTruthy()

  fireEvent.click(screen.getByRole("tab", { name: "List" }))
  expect(screen.queryByTestId("calendar-panel")).toBeNull()
})

it("keeps the filter band visible across both views", () => {
  // The band belongs to BOTH views. A control that vanishes when you switch
  // reads as the data having changed.
  renderTimer()
  fireEvent.click(screen.getByRole("tab", { name: "Calendar" }))
  expect(screen.getByPlaceholderText(/search/i)).toBeTruthy()
})
```

Match the existing file's render helper and query conventions rather than inventing new ones.

- [ ] **Step 11: Full verification**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: everything passes.

- [ ] **Step 12: Verify in the browser**

Start the dev server. Confirm each of these by looking at it, because none of them can be asserted in jsdom:

1. The week grid draws seven columns, hour rules, and a day-header row that stays put while the body scrolls.
2. It opens scrolled to the working hours, not to midnight.
3. Overlapping entries sit side by side.
4. The now-line is on today's column and is **grey, not blue**.
5. A running timer's block is the only blue thing on screen.
6. Switching to `5 days view` hides Saturday and Sunday; `Day view` shows one column.
7. Stepping back changes the label and the range total, and `TotalsRow` above does **not** change.
8. A project filter narrows the grid.
9. Each column's total matches the same day's header in List.

- [ ] **Step 13: Commit**

```bash
git add src/routes/_authed/timer.tsx src/routes/_authed/-timer.test.tsx
git commit -m "feat(timer): a Calendar tab beside List, sharing one filter

Tabs rather than two routes, on reports.tsx's argument: the filter band is
one control governing both, and a second page would mean setting it twice
while letting the two drift with nothing on screen to say so.

/timer now has a bounded period, which the comment on filters said it did
not. Still true of the list — fromMs: 0, all of history. The period belongs
to the calendar view, and presets stay exclusive to Reports.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage.** Read/not-draw → no interaction plugin is installed, so drag is not merely disabled but absent (Task 4). Tab not route → Task 6 Step 6. Week/5-day/day → Task 4's `hiddenDays` table. Filter applies to both → Task 6 Step 5. Full 24h scrolled → Task 4's `height`/`scrollTime`/`scrollTimeReset`. No project fill → `columnEventClass` in Task 4. Midnight in both columns, tail hatched and titleless → `columnEventClass` and `eventContent`. Now-line not `enlarger` → Task 4, and it is item 4 on the browser checklist. Range total in the header, `TotalsRow` unchanged → Task 5. `+` button and the `today` → `timeZone` change → Task 3. Date-system agreement → Task 6 Steps 1–3.

**Not covered, deliberately.** The `−/+` zoom is out of scope per the spec (it needs a persisted `userSettings` field). The empty-range copy is not specified as a task — FullCalendar draws the axis and empty columns on its own, which satisfies the requirement without a component.

**Two places this plan will need a decision from whoever runs it**, both flagged inline rather than papered over: whether `Button` has a `size="icon"` variant (Task 3 Step 4, Task 5 Step 4), and whether an entry row is addressable for the click-through (Task 6 Step 8).
