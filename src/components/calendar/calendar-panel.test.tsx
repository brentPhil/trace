import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { CalendarPanel } from "@/components/calendar/calendar-panel"
import { dayTotals, rangeOf } from "@/lib/calendar-events"
import { noEntryActions } from "@/test-utils/fixtures"
import type { EntryActions } from "@/hooks/use-entry-actions"
import type { CalendarSize } from "@/lib/calendar-label"
import type { Meeting } from "@/lib/calendar-meetings"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type * as CalendarEventsModuleType from "@/lib/calendar-events"
import type * as CalendarMeetingsModuleType from "@/lib/calendar-meetings"

type CalendarEventsModule = typeof CalendarEventsModuleType
type CalendarMeetingsModule = typeof CalendarMeetingsModuleType

/*
 * `drawnDays` runs once per `datesSet`, and nowhere else in this component —
 * so counting its calls counts the times FullCalendar rebuilt its dateProfile.
 * That is the only observable left for the rebuild-per-tick defect the tick
 * test below guards, now that the panel announces nothing upward: the thing it
 * actually ruined is scroll position, and jsdom has no layout.
 */
const { datesSetCount } = vi.hoisted(() => ({ datesSetCount: { n: 0 } }))

/*
 * And the same trick on the meeting mapper, for the cost `startable` put at
 * risk. It is derived from the clock, and the clock ticks once a second for the
 * life of the tab — so the obvious wiring (hand `meetingEvents` the live
 * `nowMs`) rebuilds the whole array, and two `Date`s per meeting, every second
 * for an input that has not changed. That is the exact regression the panel's
 * own note above `meetingBlocks` records having already been made once.
 */
const { mapCount } = vi.hoisted(() => ({ mapCount: { n: 0 } }))

vi.mock("@/lib/calendar-meetings", async (importOriginal) => {
  const actual = await importOriginal<CalendarMeetingsModule>()
  return {
    ...actual,
    meetingEvents: (...args: Parameters<typeof actual.meetingEvents>) => {
      mapCount.n += 1
      return actual.meetingEvents(...args)
    },
  }
})

vi.mock("@/lib/calendar-events", async (importOriginal) => {
  // The module's type is pulled in at the top of the file rather than written
  // as an inline `import()` annotation here: `consistent-type-imports` forbids
  // the inline form, and `vi.mock`'s factory is hoisted above the imports so
  // only a TYPE may be closed over.
  const actual = await importOriginal<CalendarEventsModule>()
  return {
    ...actual,
    drawnDays: (...args: Parameters<typeof actual.drawnDays>) => {
      datesSetCount.n += 1
      return actual.drawnDays(...args)
    },
  }
})

/*
 * The grid, rendered.
 *
 * The claim this file exists to retire is that jsdom cannot test a
 * FullCalendar. Element GEOMETRY cannot — jsdom has no layout engine, so column
 * widths, row heights and the pixel offset of a block are all zero. Everything
 * else can: the hour rail's labels, a block's time text, which class each block
 * carries, how many columns a size renders, and what happens to the rendered
 * range when the anchor moves. Those are what this component decides, and every
 * Critical in the review it was written for was invisible to a typecheck and
 * visible in one of the assertions below.
 *
 * NO FAKE TIMERS. `nowMs` is a prop, so nothing here needs the clock moved —
 * which matters, because `findBy*`/`waitFor` hang under fake timers in this
 * repo (`test.globals` is unset and there is no `jest` shim, so
 * @testing-library/dom's fake-timer detection never fires). The DOM is complete
 * synchronously after `render`, so every query below is a `getBy*`.
 *
 * Asia/Manila is UTC+8 with no DST, and is the zone the 12-hour defect was
 * measured in: 09:30 and 21:30 local are 01:30 and 13:30 UTC.
 */

const MANILA = "Asia/Manila"

/** Monday, so the week anchored at 2026-08-11 runs Mon 10 – Sun 16 August. */
const MONDAY = 1

const ANCHOR = "2026-08-11"

/** 2026-08-11 12:00 Manila. Only the running-entry assertions read it. */
const NOW = Date.parse("2026-08-11T04:00:00Z")

function entry(over: Partial<Doc<"timeEntries">>): Doc<"timeEntries"> {
  return {
    _id: "e1",
    _creationTime: 0,
    userId: "u1",
    title: "Fixing the logbook",
    startedAt: Date.parse("2026-08-11T01:30:00Z"), // 09:30 Manila
    endedAt: Date.parse("2026-08-11T02:30:00Z"), // 10:30 Manila
    durationMs: 3_600_000,
    projectId: undefined,
    tagIds: [],
    billable: false,
    note: undefined,
    source: "web",
    clientKey: "k1",
    updatedAt: 0,
    deletedAt: null,
    ...over,
  } as unknown as Doc<"timeEntries">
}

/**
 * A Google meeting fixture, matching `entry`'s shape above.
 *
 * `startedAt` is 10:00 Manila on 2026-08-11 — inside the default `renderPanel`
 * week (Mon 10 – Sun 16 August), unlike the brief's own sample instant of
 * 2026-08-17, which falls in the FOLLOWING week and so is a day FullCalendar
 * never draws a column for: `visibleRange` bounds what is rendered, so a
 * meeting outside it would produce no block at all and every assertion below
 * would fail for a reason unrelated to the feature under test.
 *
 * `htmlLink` is set even though the brief's own sample omits it: without it
 * `CalendarMeetingPopover` renders no "Open in Google Calendar" link at all —
 * see that component's `meeting.htmlLink === undefined ? null : <a>…` branch
 * — and the click test below asserts exactly that link exists.
 */
function meetingFixture(over: Partial<Meeting> = {}): Meeting {
  const startedAt = Date.parse("2026-08-11T02:00:00.000Z")
  return {
    _id: "ge_1" as Id<"googleEvents">,
    _creationTime: startedAt,
    userId: "user_alice",
    calendarId: "primary",
    eventId: "evt_1",
    title: "Standup",
    startedAt,
    endedAt: startedAt + 1_800_000,
    isAllDay: false,
    status: "confirmed",
    myResponse: "accepted",
    attendees: [],
    attendeeCount: 0,
    googleUpdatedAt: startedAt,
    updatedAt: startedAt,
    htmlLink: "https://calendar.google.com/event?eid=evt_1",
    trackOnStart: false,
    entryId: null,
    ...over,
  }
}

/**
 * 2026-08-11 14:00 Manila — two hours AFTER `NOW`, and inside the default week.
 *
 * `meetingFixture` starts at 02:00Z, which is two hours BEFORE `NOW`: the
 * default meeting on this grid has already begun. That is what `pastMeeting`
 * names, so the tests below say which side of the clock they mean rather than
 * relying on a reader noticing the two constants.
 */
const FUTURE_START = Date.parse("2026-08-11T06:00:00.000Z")

/** A meeting the user could still tick: it has not started. Half an hour, which
 *  `blockFit` gives one title line — the room the checkbox shares. */
function futureMeeting(over: Partial<Meeting> = {}): Meeting {
  return meetingFixture({
    startedAt: FUTURE_START,
    endedAt: FUTURE_START + 1_800_000,
    ...over,
  })
}

/** A meeting that has already begun. The bare fixture is one. */
function pastMeeting(over: Partial<Meeting> = {}): Meeting {
  return meetingFixture(over)
}

type PanelProps = Parameters<typeof CalendarPanel>[0]

/**
 * The harness speaks in SIZE AND ANCHOR, which is what the page holds, and
 * turns them into a range with `rangeOf` — the same function /timer calls. So
 * a case below cannot pass while the page hands the panel something else.
 */
type Harness = Partial<PanelProps> & { size?: CalendarSize; anchor?: string }

function buildProps(over: Harness): PanelProps {
  const { size = "week", anchor = ANCHOR, ...rest } = over
  const timeZone = rest.timeZone ?? MANILA
  const weekStartDay = rest.weekStartDay ?? MONDAY
  return {
    entries: [],
    timeZone,
    weekStartDay,
    use12Hour: false,
    display: "hms",
    nowMs: NOW,
    projects: [],
    projectsById: new Map(),
    tags: [],
    actions: noEntryActions,
    range: rangeOf(anchor, size, weekStartDay, timeZone),
    /*
     * The column totals, built here the way /timer builds them — the panel is
     * handed the map rather than computing it, so that the page can sum the
     * same one for "Range total" instead of making a second pass per tick.
     *
     * Through the real `dayTotals` and the real `nowMs`, so the assertions on
     * the day headers below still exercise attribution-by-start and the
     * running entry's elapsed time rather than a table typed out here.
     */
    dayTotals: dayTotals(rest.entries ?? [], timeZone, rest.nowMs ?? NOW),
    // Last, so an explicit `range` in a case beats the derived one.
    ...rest,
  }
}

function renderPanel(over: Harness = {}): {
  rerender: (next: Harness) => void
  container: HTMLElement
} {
  const view = render(<CalendarPanel {...buildProps(over)} />)
  return {
    container: view.container,
    rerender: (next) =>
      view.rerender(<CalendarPanel {...buildProps({ ...over, ...next })} />),
  }
}

/** The dates of the rendered day-header cells, in order. */
function renderedDays(container: HTMLElement): Array<string | null> {
  return [
    ...container.querySelectorAll('[role="columnheader"][data-date]'),
  ].map((cell) => cell.getAttribute("data-date"))
}

/** The hour rail's labels, top to bottom. */
function railLabels(container: HTMLElement): Array<string> {
  return [...container.querySelectorAll("[data-time] .tabular-nums")].map(
    (label) => label.textContent
  )
}

/**
 * The blocks on the grid.
 *
 * `rounded-md` is this component's own class on the element `columnEventClass`
 * styles, so the selector names what the panel wrote rather than a FullCalendar
 * internal.
 */
function blocks(container: HTMLElement): Array<HTMLElement> {
  return [...container.querySelectorAll<HTMLElement>(".rounded-md")]
}

/** The block reading `text` — the assertion target, and the click target. */
function blockSaying(container: HTMLElement, text: string): HTMLElement {
  const found = blocks(container).find((block) =>
    block.textContent.includes(text)
  )
  if (found === undefined) throw new Error(`no block reading "${text}"`)
  return found
}

/**
 * The tick on a meeting's block, by ROLE — with two concessions to jsdom, both
 * forced by the `visibility: hidden` harness `blocks` describes above.
 *
 * `hidden: true`, because a role query excludes anything the accessibility tree
 * calls hidden, and every block in this environment is.
 *
 * And the LABEL is matched off the attribute rather than through `name:`.
 * dom-accessibility-api returns an empty accessible name for a node inside a
 * hidden subtree — it refuses to walk one — so `name: /track standup/i` matches
 * nothing here even though the label is on the element and correct in a
 * browser. The attribute is the same claim, asserted where it can be seen.
 */
function trackBox(container: HTMLElement): HTMLInputElement | null {
  return (
    within(container)
      .queryAllByRole<HTMLInputElement>("checkbox", { hidden: true })
      .find((box) => /^track /i.test(box.getAttribute("aria-label") ?? "")) ??
    null
  )
}

afterEach(cleanup)

describe("CalendarPanel", () => {
  describe("the hour rail", () => {
    it("labels the hours in 24-hour form, in the stored zone", () => {
      // The rail is the app's clock, not FullCalendar's: timegrid's own label
      // is "9am", and everything else in the product says "09:00".
      const { container } = renderPanel()
      const labels = railLabels(container)
      expect(labels).toHaveLength(24)
      expect(labels[0]).toBe("00:00")
      expect(labels[9]).toBe("09:00")
      expect(labels[21]).toBe("21:00")
    })

    it("labels the hours in 12-hour form when the user bills that way", () => {
      // `hour12: true` on en-GB yields "1 pm"; `formatTimeOfInstant` yields
      // "1:00 PM". Same clock, one casing.
      const { container } = renderPanel({ use12Hour: true })
      const labels = railLabels(container)
      expect(labels[0]).toBe("12:00 AM")
      expect(labels[9]).toBe("9:00 AM")
      expect(labels[21]).toBe("9:00 PM")
    })
  })

  describe("a block's time", () => {
    /*
     * THE REGRESSION THIS FILE WAS WRITTEN FOR.
     *
     * timegrid's default event format is
     * `{hour:'numeric', minute:'2-digit', meridiem:false}`, and `meridiem:false`
     * deletes the am/pm STRING rather than switching to a 24-hour cycle. Through
     * FullCalendar's `timeText` both of these entries rendered "9:30 – 10:30" —
     * a morning and an evening block, indistinguishable, on a billing tool.
     */
    const morningAndEvening = [
      entry({}),
      entry({
        _id: "e2",
        title: "Evening shift",
        startedAt: Date.parse("2026-08-11T13:30:00Z"), // 21:30 Manila
        endedAt: Date.parse("2026-08-11T14:30:00Z"), // 22:30 Manila
      } as Partial<Doc<"timeEntries">>),
    ]

    it("tells a morning entry from an evening one in 24-hour form", () => {
      renderPanel({ entries: morningAndEvening })
      expect(screen.getByText("09:30 – 10:30")).toBeDefined()
      expect(screen.getByText("21:30 – 22:30")).toBeDefined()
    })

    it("tells a morning entry from an evening one in 12-hour form", () => {
      renderPanel({ entries: morningAndEvening, use12Hour: true })
      expect(screen.getByText("9:30 AM – 10:30 AM")).toBeDefined()
      expect(screen.getByText("9:30 PM – 10:30 PM")).toBeDefined()
    })
  })

  describe("the Cold Light Rule", () => {
    it("gives a running entry's block the cold light, and only that one", () => {
      const { container } = renderPanel({
        entries: [
          entry({ _id: "done", title: "Finished" } as Partial<
            Doc<"timeEntries">
          >),
          entry({
            _id: "live",
            title: "Still going",
            startedAt: Date.parse("2026-08-11T03:00:00Z"), // 11:00 Manila
            endedAt: null,
            durationMs: null,
          } as Partial<Doc<"timeEntries">>),
        ],
      })

      const live = blockSaying(container, "Still going")
      expect(live.className).toContain("border-enlarger")
      expect(live.className).toContain("bg-enlarger/15")
      // A completed entry is the ordinary raised surface. `enlarger` on the
      // grid means a timer is running and nothing else.
      const done = blockSaying(container, "Finished")
      expect(done.className).not.toContain("enlarger")
      expect(done.className).toContain("border-edge-raised")
    })

    it("shows the elapsed clock on a running block, not a closing time", () => {
      // The entry started at 11:00 Manila and `nowMs` is 12:00 there. There is
      // no end time to print, and printing "now" would be a value that looks
      // recorded when it is not.
      const { container } = renderPanel({
        entries: [
          entry({
            startedAt: Date.parse("2026-08-11T03:00:00Z"),
            endedAt: null,
            durationMs: null,
          }),
        ],
      })
      // Scoped to the block: the day header above it reads 1:00:00 too, which
      // is the point — the header's total and the block's clock agree.
      const [block] = blocks(container)
      expect(within(block).getByText("1:00:00")).toBeDefined()
      expect(block.textContent).not.toContain("–")
    })
  })

  describe("a block is a button, and looks like one", () => {
    /*
     * FullCalendar makes every block `role="button"` with `tabIndex: 0` and an
     * Enter/Space handler the moment an `eventClick` handler is registered —
     * which it has been since the click became an editor. What it does NOT
     * supply is any sign of that: its own pointer cursor is applied on
     * `(url || isDraggable)` and ours is neither, and it draws no focus style
     * at all. Both of those were invisible to every other assertion in this
     * file, because a control nobody can see is still a control the DOM agrees
     * exists.
     */
    it("is reachable by keyboard and says so when focused", () => {
      const { container } = renderPanel({ entries: [entry({})] })
      const [block] = blocks(container)

      expect(block.getAttribute("role")).toBe("button")
      expect(block.getAttribute("tabindex")).toBe("0")
      expect(block.className).toContain("cursor-pointer")

      // An OUTLINE, not a border shift: this border is already spent saying
      // running / complete / continued. Turned inward, because an outward ring
      // on a block inset 2px from its harness is drawn across the overlapping
      // block beside it.
      expect(block.className).toContain("focus-visible:outline-ring")
      expect(block.className).toContain("focus-visible:-outline-offset-2")
    })

    it("lifts on hover without spending the cold light on it", () => {
      const { container } = renderPanel({
        entries: [
          entry({ _id: "done", title: "Finished" } as Partial<
            Doc<"timeEntries">
          >),
          entry({
            _id: "live",
            title: "Still going",
            startedAt: Date.parse("2026-08-11T03:00:00Z"),
            endedAt: null,
            durationMs: null,
          } as Partial<Doc<"timeEntries">>),
        ],
      })

      /*
       * A `color-mix` toward Ink, not `hover:bg-foreground/5`. A `hover:bg-*`
       * REPLACES the block's own `bg-surface-raised` rather than layering over
       * it, so 5% ivory would composite over the LANE and land DARKER than the
       * block was before the pointer arrived — a hover that dims what it is
       * pointing at.
       */
      const done = blockSaying(container, "Finished")
      expect(done.className).toContain("color-mix")
      expect(done.className).not.toContain("hover:bg-enlarger")

      // The running block spends its hover step in its own light instead:
      // mixing ivory into it would wash the one signal the Cold Light Rule
      // reserves, and cold is legal on this block because it IS running.
      const live = blockSaying(container, "Still going")
      expect(live.className).toContain("hover:bg-enlarger/25")
      expect(live.className).not.toContain("color-mix")
    })
  })

  describe("an entry that crosses midnight", () => {
    /** 23:00 Manila on the 12th to 01:30 on the 13th. */
    const crosser = entry({
      title: "Night deploy",
      startedAt: Date.parse("2026-08-12T15:00:00Z"),
      endedAt: Date.parse("2026-08-12T17:30:00Z"),
    })

    it("draws two segments and hatches only the tail", () => {
      const { container } = renderPanel({ entries: [crosser] })

      const drawn = blocks(container)
      expect(drawn).toHaveLength(2)

      const hatched = drawn.filter((block) =>
        block.className.includes("border-dashed")
      )
      expect(hatched).toHaveLength(1)

      // The Hatch Rule: the tail is a texture with no title. Its only text is
      // the screen-reader line that says what it continues.
      const [tail] = hatched
      expect(within(tail).queryByText("Night deploy")).toBeNull()
      expect(tail.textContent).toBe(
        "Night deploy — continued from the previous day"
      )

      // The dashed edge is the Hatch Rule's load-bearing carrier — it is what
      // survives forced-colors once the UA drops the gradient. It used to come
      // from an unlayered `.hatch-empty` class, and this asserted the INVERSE
      // (that no Tailwind `border-` class was present at all) because any that
      // were would have been outranked and invisible. `HATCH_EMPTY` is
      // utilities now, so the real property is assertable directly: the tail
      // carries the dashed edge, and none of the hue borders a head gets.
      expect(tail.className).toContain("border-dashed")
      expect(tail.className).toContain("border-edge-soft")
      expect(tail.className).not.toContain("border-enlarger")
      expect(tail.className).not.toContain("border-edge-raised")
    })

    it("gives the tail the same Untitled fallback the head has", () => {
      // Starting the timer never requires a title, so an untitled entry is
      // normal — and " — continued from the previous day" is not a sentence.
      const { container } = renderPanel({
        entries: [entry({ ...crosser, title: "" })],
      })
      const [tail] = blocks(container).filter((block) =>
        block.className.includes("border-dashed")
      )
      expect(tail.textContent).toBe(
        "Untitled — continued from the previous day"
      )
    })
  })

  describe("the day headers", () => {
    it("carries each day's own total", () => {
      const { container } = renderPanel({
        entries: [
          entry({}), // 1h on the 11th
          entry({
            _id: "e2",
            startedAt: Date.parse("2026-08-12T01:00:00Z"), // 09:00 on the 12th
            endedAt: Date.parse("2026-08-12T03:30:00Z"), // 11:30
          } as Partial<Doc<"timeEntries">>),
        ],
      })

      const dayOf = (date: string) =>
        container.querySelector<HTMLElement>(
          `[role="columnheader"][data-date="${date}"]`
        )

      expect(dayOf("2026-08-11")?.textContent).toContain("1:00:00")
      expect(dayOf("2026-08-12")?.textContent).toContain("2:30:00")
    })

    it("prints nothing at all on an untracked day", () => {
      // `0:00:00` under five of seven columns on a light week is noise that
      // reads as a value. `formatCompactDuration` refuses to print `0m` for
      // exactly the same reason.
      const { container } = renderPanel({ entries: [entry({})] })
      const empty = container.querySelector<HTMLElement>(
        '[role="columnheader"][data-date="2026-08-13"]'
      )
      expect(empty?.textContent).toBe("Thu13")
      expect(empty?.textContent).not.toContain("0:00")
    })

    it("marks today's column, and marks exactly one", () => {
      // `NOW` is 12:00 on the 11th in Manila, and the rendered week is the
      // 10th to the 16th. The mark is the ramp and a figure/ground swap — no
      // hue anywhere, because `enlarger` on a grid means a timer is running
      // and a Tuesday is not a timer.
      const { container } = renderPanel()

      const marked = [
        ...container.querySelectorAll<HTMLElement>(
          '[role="columnheader"][data-date]'
        ),
      ].filter((cell) => cell.className.includes("bg-surface-raised"))

      expect(marked).toHaveLength(1)
      expect(marked[0].getAttribute("data-date")).toBe("2026-08-11")
      // The date itself inverts — Ink on ground, the loudest colourless mark
      // the system has.
      expect(
        marked[0].querySelector(".rounded-full")?.textContent
      ).toBe("11")
      expect(marked[0].className).not.toContain("enlarger")
    })

    it("takes today from the app's clock, never FullCalendar's", () => {
      /*
       * THE POINT OF COMPUTING THIS OURSELVES.
       *
       * `DayHeaderInfo` carries an `isToday`, and it is derived from the
       * machine clock against FullCalendar's own `todayRange` — a second answer
       * to a question `dayOf(nowMs, timeZone)` already answers for the page's
       * range, the day totals and the log's grouping alike. A user whose stored
       * zone is not their browser's would have seen the grid ring one column
       * while the totals called another one today.
       *
       * Moving `nowMs` alone moves the mark. Under FullCalendar's own flag this
       * assertion could not even be written: the machine clock is not a prop.
       */
      const { container, rerender } = renderPanel()
      const markedDay = () =>
        container
          .querySelector<HTMLElement>(
            '[role="columnheader"][data-date].bg-surface-raised'
          )
          ?.getAttribute("data-date")

      expect(markedDay()).toBe("2026-08-11")

      // 24 hours on: the 12th, still inside the drawn week.
      rerender({ nowMs: NOW + 86_400_000 })

      expect(markedDay()).toBe("2026-08-12")
    })

    it("lands on the right column in a zone BEHIND UTC", () => {
      /*
       * THE OFF-BY-ONE THIS WHOLE HOOK IS EXPOSED TO.
       *
       * `dayOf(info.date.getTime(), timeZone)` is only correct if FullCalendar
       * hands the render hook a true INSTANT — local midnight of that column.
       * If it handed over one of its internal "markers" (midnight expressed as
       * fake UTC) instead, then west of Greenwich every column would resolve to
       * the day BEFORE it: 2026-08-11T00:00Z read in New York is 19:00 on the
       * 10th. Asia/Manila is +8 and cannot show this — the error is absorbed —
       * so every other case in this file would stay green through it.
       *
       * It matters twice over, because the day TOTALS beside this marker are
       * keyed by the same expression. A totals column off by one on a tool
       * people invoice from is the expensive version of this bug; a ring around
       * the wrong day is the visible one.
       *
       * 2026-08-11T04:00Z is 00:00 on the 11th in New York — deliberately the
       * first minute of the day, where an off-by-one has nowhere to hide.
       */
      const NEW_YORK = "America/New_York"
      const { container } = renderPanel({
        timeZone: NEW_YORK,
        nowMs: Date.parse("2026-08-11T04:00:00Z"),
        entries: [
          entry({
            startedAt: Date.parse("2026-08-11T14:00:00Z"), // 10:00 on the 11th
            endedAt: Date.parse("2026-08-11T15:00:00Z"),
          }),
        ],
      })

      const marked = [
        ...container.querySelectorAll<HTMLElement>(
          '[role="columnheader"][data-date]'
        ),
      ].filter((cell) => cell.className.includes("bg-surface-raised"))

      expect(marked).toHaveLength(1)
      expect(marked[0].getAttribute("data-date")).toBe("2026-08-11")
      // And the hour's total is under that same column, not the one before it.
      expect(marked[0].textContent).toContain("1:00:00")
    })
  })

  describe("navigation", () => {
    it("moves the rendered range when the range it is given moves", () => {
      /*
       * THE OTHER REGRESSION THIS FILE WAS WRITTEN FOR, in its current
       * spelling.
       *
       * `initialDate` is read once, at init — FullCalendar's own docs say it
       * "should be initialized once and stay constant" — and the React
       * wrapper's every later render dispatches `IDLE`. A changed `initialDate`
       * moves nothing. `visibleRange` does: its refined value is an input to
       * the dateProfileGenerator, and the manager rebuilds the generator, and
       * with it the profile, whenever those inputs differ. So the columns
       * follow the page's range with no controller and no remount.
       */
      const { container, rerender } = renderPanel()

      expect(renderedDays(container)).toEqual([
        "2026-08-10",
        "2026-08-11",
        "2026-08-12",
        "2026-08-13",
        "2026-08-14",
        "2026-08-15",
        "2026-08-16",
      ])

      rerender({ anchor: "2026-08-18" })

      expect(renderedDays(container)).toEqual([
        "2026-08-17",
        "2026-08-18",
        "2026-08-19",
        "2026-08-20",
        "2026-08-21",
        "2026-08-22",
        "2026-08-23",
      ])
    })

    it("changes span without a remount when only the size changes", () => {
      // Mon 10 is the first day of both, so the range's START does not move —
      // only its end. `visibleRange` is memoised on BOTH instants, and a memo
      // keyed on the first day alone would leave seven columns on screen under
      // a bar labelling five.
      const { container, rerender } = renderPanel({ anchor: "2026-08-11" })
      expect(renderedDays(container)).toHaveLength(7)

      rerender({ size: "5day" })

      expect(renderedDays(container)).toEqual([
        "2026-08-10",
        "2026-08-11",
        "2026-08-12",
        "2026-08-13",
        "2026-08-14",
      ])
    })

    it("survives the clock ticking without rebuilding its range", () => {
      /*
       * The guard on the memoised `visibleRange`.
       *
       * It is refined by `identity` and absent from
       * `COMPLEX_OPTION_COMPARATORS`, so a freshly allocated object on each
       * render rebuilds the dateProfileGenerator, then the dateProfile — which
       * re-fires `datesSet` and calls `resetScroll()`. `nowMs` ticks every
       * second, so an inline `{ start, end }` would snap the grid back to
       * `scrollTime` about once a second and leave it unscrollable; with
       * anything setting state on `datesSet` the same rebuild is an unbounded
       * loop that React ends with "Maximum update depth exceeded". `hiddenDays`
       * carried exactly this hazard before it.
       *
       * Geometry is what that defect ruins and geometry is what jsdom cannot
       * see, so this counts the REBUILDS instead: `drawnDays` runs once per
       * `datesSet` and nowhere else, so the mock at the top of this file is a
       * direct count of them.
       */
      const { container, rerender } = renderPanel({ entries: [entry({})] })
      datesSetCount.n = 0

      rerender({ nowMs: NOW + 1_000 })
      rerender({ nowMs: NOW + 2_000 })

      expect(datesSetCount.n).toBe(0)
      expect(renderedDays(container)).toHaveLength(7)
    })
  })

  describe("the range sizes", () => {
    it("renders five weekday columns for a 5-day range", () => {
      // Monday to Friday whatever `weekStartDay` is, because `rangeOf` says so
      // — no hidden-day trim, and therefore no week that `firstDay` built for
      // the trim to land in the wrong place on. A Sunday start is one of the
      // three that happened to work under the old pairing;
      // `calendar-range-label.test.tsx` walks all seven, which is what this
      // single case could not.
      const { container } = renderPanel({ size: "5day", weekStartDay: 0 })
      expect(renderedDays(container)).toEqual([
        "2026-08-10",
        "2026-08-11",
        "2026-08-12",
        "2026-08-13",
        "2026-08-14",
      ])
    })

    it("renders one column for a single day", () => {
      const { container } = renderPanel({ size: "day" })
      expect(renderedDays(container)).toEqual(["2026-08-11"])
    })
  })

  describe("google meetings", () => {
    /*
     * `blockSaying`/`blocks`, NOT `screen.getByRole`, for finding the block
     * itself — the same substitution every other describe block in this file
     * already makes, and for the reason `blocks`' own comment gives: jsdom has
     * no layout, so FullCalendar's packer never finishes measuring column
     * widths and leaves every block's harness at `visibility: hidden` while it
     * waits for a resize that will never come. That inline style is honoured by
     * `getComputedStyle`, and `screen.getByRole` excludes anything the
     * accessibility tree calls hidden — so it can never find a block in this
     * environment, meeting or entry alike, which is exactly why the file's own
     * block-clicking tests below reach for `blockSaying` and `fireEvent.click`
     * on the raw element rather than `screen.getByRole`. `role="button"` is
     * still assertable directly off the element, which is what the block's own
     * "is a button" describe block above does.
     */
    it("draws a meeting as an unfilled block with a soft border", () => {
      const { container } = renderPanel({ meetings: [meetingFixture()] })
      const block = blockSaying(container, "Standup")
      expect(block.getAttribute("role")).toBe("button")
      // Fill means recorded, outline means scheduled. `surface-raised` is an
      // entry's fill and must NOT appear here, and `enlarger` is reserved for a
      // running timer by the Cold Light Rule.
      expect(block.className).toContain("border-edge-soft")
      expect(block.className).not.toContain("bg-surface-raised")
      expect(block.className).not.toContain("enlarger")
    })

    /*
     * A meeting's text is MEASURED, exactly as an entry's is.
     *
     * The meeting branch used to render a title line and a time line
     * unconditionally — 34px of content — while a half-hour meeting has 17px
     * of content box and a quarter-hour one has 11px. `overflow-hidden` cut
     * the title through the middle of its glyphs, and half-hour meetings are
     * the common case.
     */
    it("keeps only a half-hour meeting's title, and still says the time", () => {
      // 30 minutes is 24px: one 16px row over the 7px the block spends on
      // itself. `meetingFixture` is 10:00 – 10:30 Manila.
      const { container } = renderPanel({ meetings: [meetingFixture()] })
      const block = blockSaying(container, "Standup")
      expect(block.querySelector(".truncate")?.textContent).toBe("Standup")
      expect(block.querySelector(".tabular-nums")).toBeNull()
      expect(block.querySelector(".sr-only")?.textContent).toBe("10:00 – 10:30")
    })

    it("draws no text at all in a meeting at the minimum height", () => {
      const startedAt = Date.parse("2026-08-11T02:00:00.000Z")
      const { container } = renderPanel({
        meetings: [meetingFixture({ endedAt: startedAt + 60_000 })],
      })
      const block = blocks(container)[0]
      expect(block.querySelector("span:not(.sr-only)")).toBeNull()
      // Never silent: the whole description is on the screen-reader line, and
      // the title and times are both on the native tooltip.
      expect(block.querySelector(".sr-only")?.textContent).toBe(
        "Standup — 10:00 – 10:01"
      )
      expect(block.querySelector("[title]")?.getAttribute("title")).toBe(
        "Standup — 10:00 – 10:01"
      )
    })

    it("shows a long meeting both lines", () => {
      const startedAt = Date.parse("2026-08-11T02:00:00.000Z")
      const { container } = renderPanel({
        meetings: [meetingFixture({ endedAt: startedAt + 3_600_000 })],
      })
      const block = blockSaying(container, "Standup")
      expect(block.querySelector(".tabular-nums")?.textContent).toBe(
        "10:00 – 11:00"
      )
      expect(block.querySelector(".sr-only")).toBeNull()
    })

    describe("a meeting that crosses midnight", () => {
      /** 23:00 Manila on the 12th to 01:30 on the 13th. */
      const crosser = meetingFixture({
        title: "Night handover",
        startedAt: Date.parse("2026-08-12T15:00:00Z"),
        endedAt: Date.parse("2026-08-12T17:30:00Z"),
      })

      it("hatches the tail and does not repeat the title on it", () => {
        // `columnEventClass` had no `isStart` branch for a meeting, so the
        // tail got neither the dashed edge nor the hatch, and `eventContent`
        // printed the whole title again: one overnight meeting drew as two
        // identical-looking meetings on consecutive days.
        const { container } = renderPanel({ meetings: [crosser] })

        const drawn = blocks(container)
        expect(drawn).toHaveLength(2)

        const hatched = drawn.filter((block) =>
          block.className.includes("border-dashed")
        )
        expect(hatched).toHaveLength(1)

        const [tail] = hatched
        expect(within(tail).queryByText("Night handover")).toBeNull()
        expect(tail.textContent).toBe(
          "Night handover — continued from the previous day"
        )
        // A continuation is a texture, never a hue — and a ghost stays
        // unfilled, so neither segment may pick up an entry's fill.
        expect(tail.className).toContain("border-dashed")
        expect(tail.className).not.toContain("bg-surface-raised")
        expect(tail.className).not.toContain("enlarger")
      })

      it("leaves the head an ordinary outlined meeting block", () => {
        const { container } = renderPanel({ meetings: [crosser] })
        const head = blocks(container).find(
          (block) => !block.className.includes("border-dashed")
        )
        expect(head!.className).toContain("border-edge-soft")
        expect(head!.className).not.toContain("border-dashed")
        expect(head!.textContent).toContain("Night handover")
      })
    })

    it("does not draw a meeting whose entry already exists", () => {
      const { container } = renderPanel({
        meetings: [meetingFixture({ entryId: "te_1" as Id<"timeEntries"> })],
      })
      expect(blocks(container)).toHaveLength(0)
    })

    it("draws entries and meetings side by side when both are present", () => {
      const { container } = renderPanel({
        entries: [entry({ title: "Real work" })],
        meetings: [meetingFixture()],
      })
      expect(blockSaying(container, "Real work")).toBeTruthy()
      expect(blockSaying(container, "Standup")).toBeTruthy()
    })

    /*
     * `eventOrder` REPLACES FullCalendar's default rather than extending it.
     *
     * `parseFieldSpecs` turns a function input into a ONE-spec list, so
     * `compareByFieldSpecs` returned 0 for any two blocks of the same
     * population and `Array.sort`'s stability left them in the events array's
     * order — which is `entries.listRange`'s `.order("desc")`, i.e. latest
     * first. Overlapping entries packed latest-start leftmost, inverting
     * behaviour that predates this feature entirely. Both cases below read the
     * blocks in DOM order, which is the order the packer emitted them in.
     */
    it("packs two overlapping entries earliest-start first", () => {
      const { container } = renderPanel({
        entries: [
          // Handed over newest-first, exactly as `entries.listRange` returns
          // them — the input that made the defect visible.
          entry({
            _id: "e_late" as Id<"timeEntries">,
            title: "Started later",
            startedAt: Date.parse("2026-08-11T02:00:00Z"),
            endedAt: Date.parse("2026-08-11T03:00:00Z"),
          }),
          entry({
            _id: "e_early" as Id<"timeEntries">,
            title: "Started earlier",
            startedAt: Date.parse("2026-08-11T01:30:00Z"),
            endedAt: Date.parse("2026-08-11T03:00:00Z"),
          }),
        ],
      })
      const drawn = blocks(container).map((block) => block.textContent)
      expect(drawn[0]).toContain("Started earlier")
      expect(drawn[1]).toContain("Started later")
    })

    it("still sorts a meeting after an entry in the same window", () => {
      // The rank comparator is the FIRST spec, so it outranks `start`: the
      // meeting starts FIRST here, and still draws second. Built that way round
      // deliberately — an entry that also started earlier would pass on
      // `start` alone and prove nothing about the comparator.
      const { container } = renderPanel({
        entries: [
          entry({
            title: "Real work",
            startedAt: Date.parse("2026-08-11T02:15:00Z"),
            endedAt: Date.parse("2026-08-11T03:15:00Z"),
          }),
        ],
        meetings: [meetingFixture()], // 02:00Z – 02:30Z, the earlier start
      })
      const drawn = blocks(container).map((block) => block.textContent)
      expect(drawn[0]).toContain("Real work")
      expect(drawn[1]).toContain("Standup")
    })

    it("opens the meeting popover rather than the entry editor on click", () => {
      const { container } = renderPanel({ meetings: [meetingFixture()] })
      // `fireEvent.click` targets the element directly rather than through an
      // accessibility query, so the `visibility: hidden` harness above does not
      // stop the click from reaching it.
      fireEvent.click(blockSaying(container, "Standup"))
      // The popover itself is an ordinary mounted React tree, outside
      // FullCalendar's own packer, so it carries none of that hazard and
      // `screen.getByRole` finds it normally. Read-only, and says so: it
      // carries a link out to Google, which the entry editor never does.
      expect(
        screen.getByRole("link", { name: /Google Calendar/i })
      ).toBeTruthy()
    })

    describe("the tick on the block", () => {
      /** The popover's own observable — the link out to Google, which nothing
       *  else on this grid renders. The same thing the click test above asserts
       *  the presence of, asserted absent. */
      const popover = () =>
        screen.queryByRole("link", { name: /Google Calendar/i })

      it("ticks a meeting without opening its popover", () => {
        const onSetTrack = vi.fn()
        const { container } = renderPanel({
          meetings: [futureMeeting()],
          onSetTrack,
        })

        const box = trackBox(container)
        expect(box).not.toBeNull()
        fireEvent.click(box as HTMLInputElement)

        expect(onSetTrack).toHaveBeenCalledWith("primary", "evt_1", true)
        /*
         * THE NESTED-CONTROL PROBLEM, and the reason this assertion is the
         * point of the test rather than a footnote to it.
         *
         * FullCalendar's `EventClicking` is a NATIVE delegated `click` listener
         * on the calendar's own root element — not a React `onClick` — so it
         * sits BELOW React's root container in the tree and fires before React
         * dispatches anything at all. A `stopPropagation` on the React
         * synthetic event therefore arrives after the popover has already been
         * asked to open. Only a listener bound on the checkbox itself is inside
         * FullCalendar's, which is what the implementation does.
         */
        expect(popover()).toBeNull()
      })

      it("leaves a Space on the box alone, so it can still toggle", () => {
        /*
         * THE SECOND ROUTE INTO THE BLOCK, and it is not the click.
         *
         * Registering `eventClick` is what makes FullCalendar put `tabIndex={0}`
         * and a REACT `onKeyDown` on the segment, which fires `eventClick` on
         * Enter or Space and then calls `preventDefault()`. A Space aimed at
         * this checkbox bubbles straight into it — and a cancelled Space is a
         * checkbox that cannot be ticked from the keyboard at all.
         *
         * `fireEvent` returns false when a listener cancelled the event, which
         * is the only handle jsdom gives on this: it has no activation
         * behaviour for Space on a checkbox, so the toggle it would have
         * prevented is not itself observable here.
         */
        const onSetTrack = vi.fn()
        const { container } = renderPanel({
          meetings: [futureMeeting()],
          onSetTrack,
        })
        const box = trackBox(container) as HTMLInputElement
        box.focus()
        expect(fireEvent.keyDown(box, { key: " ", code: "Space" })).toBe(true)
        expect(popover()).toBeNull()

        // And the activation it leads to still reaches the handler.
        fireEvent.click(box)
        expect(onSetTrack).toHaveBeenCalledWith("primary", "evt_1", true)
      })

      it("still opens the popover from Enter on the block itself", () => {
        // The keydown guard is on the CHECKBOX. The block's own keyboard
        // activation — the thing that makes every block reachable — is
        // untouched by it.
        const { container } = renderPanel({
          meetings: [futureMeeting()],
          onSetTrack: vi.fn(),
        })
        fireEvent.keyDown(blockSaying(container, "Standup"), { key: "Enter" })
        expect(popover()).toBeTruthy()
      })

      it("unticks a meeting that was ticked", () => {
        const onSetTrack = vi.fn()
        const { container } = renderPanel({
          meetings: [futureMeeting({ trackOnStart: true })],
          onSetTrack,
        })
        fireEvent.click(trackBox(container) as HTMLInputElement)
        expect(onSetTrack).toHaveBeenCalledWith("primary", "evt_1", false)
      })

      it("names the meeting in the checkbox's label", () => {
        // "Track" alone would be four identical controls on a busy morning, and
        // the block's own title is not on the control.
        const { container } = renderPanel({
          meetings: [futureMeeting()],
          onSetTrack: vi.fn(),
        })
        expect(trackBox(container)?.getAttribute("aria-label")).toBe(
          "Track Standup"
        )
      })

      it("draws a ticked meeting's checkbox as checked", () => {
        const { container } = renderPanel({
          meetings: [futureMeeting({ trackOnStart: true })],
          onSetTrack: vi.fn(),
        })
        expect(trackBox(container)?.checked).toBe(true)
      })

      it("draws no checkbox on a meeting that has already started", () => {
        const { container } = renderPanel({
          meetings: [pastMeeting()],
          onSetTrack: vi.fn(),
        })
        expect(trackBox(container)).toBeNull()
      })

      it("draws no checkbox on a block too short for text", () => {
        // `blockFit` returning titleLines: 0 means the block has no room for
        // content, and a control it cannot show is a control the user cannot
        // hit. Five minutes is the 18px minimum block, which is under the 23px
        // one text row costs.
        const { container } = renderPanel({
          meetings: [futureMeeting({ endedAt: FUTURE_START + 5 * 60_000 })],
          onSetTrack: vi.fn(),
        })
        expect(blocks(container)[0]?.querySelector("span:not(.sr-only)")).toBeNull()
        expect(trackBox(container)).toBeNull()
      })

      it("draws no checkbox at all for a caller that cannot write", () => {
        // /timer passes the handler; a fixture harness with no Google link does
        // not, and an inert checkbox is worse than none.
        const { container } = renderPanel({ meetings: [futureMeeting()] })
        expect(trackBox(container)).toBeNull()
      })

      describe("the clock behind `startable`", () => {
        /*
         * The meetings are held in a CONST, not rebuilt per render: the memo is
         * keyed on that array's identity as well, and a fresh one per tick
         * would make the count go up for a reason unrelated to the clock.
         * /timer hands down `meetingsQuery.data`, which React Query keeps
         * stable while the data has not changed.
         */
        const held = [futureMeeting()]

        it("does not remap the meetings on a tick that changes nothing", () => {
          const { rerender } = renderPanel({
            meetings: held,
            onSetTrack: vi.fn(),
          })
          const before = mapCount.n
          rerender({ nowMs: NOW + 1000 })
          rerender({ nowMs: NOW + 2000 })
          expect(mapCount.n).toBe(before)
        })

        it("remaps when the clock crosses a meeting's start", () => {
          // …and the pinning is not a way of ignoring the clock: the checkbox
          // has to go away the moment its meeting begins, because there is no
          // longer a future switch for it to instruct.
          const { container, rerender } = renderPanel({
            meetings: held,
            onSetTrack: vi.fn(),
          })
          expect(trackBox(container)).not.toBeNull()

          rerender({ nowMs: FUTURE_START })
          expect(trackBox(container)).toBeNull()
        })
      })

      it("still opens the popover when the block itself is clicked", () => {
        // The guard is on the CHECKBOX, not on the block: everything else about
        // a ticked meeting's block still opens the popover.
        const { container } = renderPanel({
          meetings: [futureMeeting()],
          onSetTrack: vi.fn(),
        })
        fireEvent.click(blockSaying(container, "Standup"))
        expect(popover()).toBeTruthy()
      })
    })
  })
})

/*
 * CLICKING A BLOCK OPENS AN EDITOR, which reverses what this grid used to do.
 *
 * It switched to List, scrolled the entry's row into view and focused it — and
 * for the running entry, for anything outside the loaded pages and for anything
 * dated ahead of today there was no row to land on, so it raised a toast and
 * stayed where it was. Those three cases are gone rather than fixed: every block
 * is editable now, including the ones the log never had a row for, which is what
 * made the click worth reversing.
 *
 * Every assertion below is that the CONTROL is present and reports what was
 * typed. What each write then does to the database is tested where the mutations
 * are, because this surface and the log row reach one `useEntryActions`.
 */
function spyActions(over: Partial<EntryActions> = {}): EntryActions {
  return {
    onTitleChange: vi.fn(async () => {}),
    onTimeChange: vi.fn(async () => {}),
    onDayChange: vi.fn(async () => {}),
    onDurationChange: vi.fn(async () => {}),
    onClassify: vi.fn(),
    onCreateProject: vi.fn(async () => ({
      projectId: "p1" as unknown as Id<"projects">,
    })),
    onCreateTag: vi.fn(async () => ({ tagId: "t1" as unknown as Id<"tags"> })),
    onRemove: vi.fn(),
    onRemoveMany: vi.fn(async () => false),
    onResume: vi.fn(),
    onDuplicate: vi.fn(),
    ...over,
  }
}

const timesTrigger = () =>
  screen.getByRole("button", { name: /edit start, end and day/i })

const noTimesTrigger = () =>
  screen.queryByRole("button", { name: /edit start, end and day/i })

describe("CalendarPanel — clicking a block", () => {
  /** 09:30–10:30 Manila: an hour, which is two rows of content. */
  const clicked = entry({ title: "Client call" })

  function openEditor(over: Harness = {}) {
    const actions = spyActions()
    const { container } = renderPanel({ entries: [clicked], actions, ...over })
    fireEvent.click(blockSaying(container, "Client call"))
    return { actions, container }
  }

  it("opens an editor on that entry rather than navigating anywhere", () => {
    openEditor()
    // The heading is the entry's own title, editable in place — the same
    // `EditableTitle` the log row carries, one size larger.
    expect(
      screen.getByRole("button", { name: "Description: Client call" })
    ).toBeTruthy()
  })

  it("shows the entry's start and end, through the app's own formatter", () => {
    openEditor()
    expect(timesTrigger().textContent).toBe("09:3010:30")
    expect(timesTrigger().getAttribute("aria-label")).toContain(
      "09:30 to 10:30"
    )
  })

  it("commits a title edit", () => {
    const { actions } = openEditor()

    fireEvent.click(
      screen.getByRole("button", { name: "Description: Client call" })
    )
    const field = screen.getByLabelText("Description: Client call")
    fireEvent.change(field, { target: { value: "Client call, rescheduled" } })
    fireEvent.keyDown(field, { key: "Enter" })

    expect(actions.onTitleChange).toHaveBeenCalledWith(
      clicked,
      "Client call, rescheduled"
    )
  })

  it("commits a time edit through the row's own time popover", () => {
    // Not a second implementation of parsing: `EntryTimePopover` is mounted
    // here with a different trigger, so `0915` still means 09:15 and the
    // overnight and DST rules are the ones already tested against it.
    const { actions } = openEditor()

    fireEvent.click(timesTrigger())
    const start = screen.getByLabelText("Start time")
    fireEvent.change(start, { target: { value: "0915" } })
    fireEvent.keyDown(start, { key: "Enter" })

    expect(actions.onTimeChange).toHaveBeenCalledWith(
      clicked,
      "start",
      Date.parse("2026-08-11T01:15:00Z")
    )
  })

  it("offers the classifiers the row offers, and reports a billable toggle", () => {
    const { actions } = openEditor()

    expect(screen.getByRole("button", { name: "Project" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Tags" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Not billable" }))

    expect(actions.onClassify).toHaveBeenCalledWith(clicked, { billable: true })
  })

  it("resumes and duplicates through the log's own actions", () => {
    const { actions } = openEditor()

    fireEvent.click(screen.getByRole("button", { name: "Resume Client call" }))
    expect(actions.onResume).toHaveBeenCalledWith(clicked)

    const again = openEditor()
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Client call" }))
    expect(again.actions.onDuplicate).toHaveBeenCalledWith(clicked)
  })

  it("closes on Escape", () => {
    openEditor()
    expect(noTimesTrigger()).not.toBeNull()

    fireEvent.keyDown(document.body, { key: "Escape" })

    expect(noTimesTrigger()).toBeNull()
  })

  it("closes when the × is pressed", () => {
    openEditor()
    fireEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(noTimesTrigger()).toBeNull()
  })

  it("opens the same entry's editor from the tail of a midnight crossing", () => {
    /*
     * A tail is a CONTINUATION, not a second entry — the Hatch Rule — so a
     * click on one must not offer an editor claiming otherwise. Both segments
     * carry the same `entryId`, so both open the one entry, times and all.
     */
    const { container } = renderPanel({
      entries: [
        entry({
          title: "Night deploy",
          startedAt: Date.parse("2026-08-12T15:00:00Z"), // 23:00 on the 12th
          endedAt: Date.parse("2026-08-12T17:30:00Z"), // 01:30 on the 13th
        }),
      ],
      actions: spyActions(),
    })

    const tail = blocks(container).find((block) =>
      block.className.includes("border-dashed")
    )
    fireEvent.click(tail!)

    expect(
      screen.getByRole("button", { name: "Description: Night deploy" })
    ).toBeTruthy()
    expect(timesTrigger().textContent).toBe("23:0001:30")
  })

  describe("the running entry", () => {
    /** Started 11:00 Manila; `NOW` is 12:00 there. */
    const live = entry({
      title: "Still going",
      startedAt: Date.parse("2026-08-11T03:00:00Z"),
      endedAt: null,
      durationMs: null,
    })

    function openLive() {
      const { container } = renderPanel({
        entries: [live],
        actions: spyActions(),
      })
      fireEvent.click(blockSaying(container, "Still going"))
    }

    it("is editable, and prints no end time it does not have", () => {
      // The whole reason the old click had to raise a toast here: `groupByDay`
      // keeps the running entry out of the log, so there was never a row to
      // navigate to. Printing "now" as an end would be a value that looks
      // recorded when it is not.
      openLive()
      expect(timesTrigger().textContent).toBe("11:00…")
      expect(timesTrigger().getAttribute("aria-label")).toContain(
        "still running"
      )
      // Its elapsed clock instead — the number that is still moving. Twice on
      // screen: the block behind, and the popover's duration.
      expect(screen.getAllByText("1:00:00").length).toBeGreaterThan(1)
    })

    it("offers no end field, and no verb that could not be written", () => {
      // `entries.create` takes a definite `endedAt`, so there is nothing
      // honest to duplicate; and starting a copy would stop the very entry the
      // popover is describing, so Resume is absent too.
      openLive()
      fireEvent.click(timesTrigger())
      expect(screen.queryByLabelText("End time")).toBeNull()

      expect(screen.queryByRole("button", { name: /^Duplicate/ })).toBeNull()
      expect(screen.queryByRole("button", { name: /^Resume/ })).toBeNull()
    })
  })
})

/*
 * WHAT FITS IN A BLOCK.
 *
 * The defect: three lines of content need 63px of block — 79 minutes at 48px an
 * hour — and everything shorter had its project name cut through by the bottom
 * edge, cleanly, because the block is `overflow-hidden`. Measured in Chrome as
 * `scrollHeight 51` inside a `clientHeight` of 34 on a 45-minute block.
 *
 * These assert the CONTENT, not the geometry. The panel computes the height it
 * is about to be given from the same two numbers FullCalendar uses, so what it
 * chooses to draw is checkable in jsdom even though jsdom lays nothing out.
 */
describe("CalendarPanel — a block shows only what it can hold", () => {
  const SEALOGS = {
    _id: "p1",
    name: "Sealogs",
    color: "iris",
    archived: false,
  } as unknown as Doc<"projects">

  const projectsById = new Map<string, Doc<"projects">>([["p1", SEALOGS]])

  /** A classified entry of `minutes`, starting 09:00 Manila. */
  function sized(minutes: number): Doc<"timeEntries"> {
    const startedAt = Date.parse("2026-08-11T01:00:00Z")
    return entry({
      title: "Fixing the logbook",
      startedAt,
      endedAt: startedAt + minutes * 60_000,
      durationMs: minutes * 60_000,
      projectId: "p1",
    } as Partial<Doc<"timeEntries">>)
  }

  function blockOf(minutes: number): HTMLElement {
    const { container } = renderPanel({
      entries: [sized(minutes)],
      projectsById,
    })
    return blocks(container)[0]
  }

  it("draws the project line only in a block tall enough for it", () => {
    // 90 minutes is 72px: three 16px rows with 2px between them, over the 7px
    // the block spends on its own margin, borders and padding.
    const tall = blockOf(90)
    expect(tall.querySelector("[data-project-color]")).not.toBeNull()
    expect(tall.querySelector(".sr-only")).toBeNull()
  })

  it("drops the project rather than slicing it, and still says it", () => {
    // 60 minutes is 48px, which holds two rows.
    const short = blockOf(60)
    expect(short.querySelector("[data-project-color]")).toBeNull()
    expect(short.querySelector(".tabular-nums")?.textContent).toBe("09:00 – 10:00")
    expect(short.querySelector(".sr-only")?.textContent).toBe("Sealogs")
  })

  it("keeps only the title when there is room for one line", () => {
    // 30 minutes is 24px: one row. The times join the screen-reader line.
    const tiny = blockOf(30)
    expect(tiny.querySelector(".truncate")?.textContent).toBe(
      "Fixing the logbook"
    )
    expect(tiny.querySelector(".tabular-nums")).toBeNull()
    expect(tiny.querySelector(".sr-only")?.textContent).toBe(
      "09:00 – 09:30 — Sealogs"
    )
  })

  it("draws no text at all in a block at the minimum height", () => {
    // `eventMinHeight` is 18px and the block spends 7 of that on itself: 11px
    // is not a line of anything. The spec's "shows nothing but its fill".
    const minimal = blockOf(1)
    expect(minimal.querySelector("span:not(.sr-only)")).toBeNull()
    // Never silent, though — the whole description is on the screen-reader
    // line, and the times are on the native tooltip beside the title.
    expect(minimal.querySelector(".sr-only")?.textContent).toBe(
      "Fixing the logbook — 09:00 – 09:01 — Sealogs"
    )
    expect(minimal.querySelector("[title]")?.getAttribute("title")).toBe(
      "Fixing the logbook — 09:00 – 09:01"
    )
  })

  it("spends a tall block's spare row on a second line of title", () => {
    // The other half of "titles truncate to … earlier than they need to": a
    // two-hour block has room for four rows and was using three.
    expect(blockOf(120).querySelector(".line-clamp-2")?.textContent).toBe(
      "Fixing the logbook"
    )
  })

  it("measures the HEAD of a midnight crossing against midnight", () => {
    // 23:00 to 04:00 is a five-hour entry drawn as a ONE-hour block on the day
    // it started. Sizing its text for five hours would put four rows of
    // content in a box with room for two.
    const { container } = renderPanel({
      entries: [
        entry({
          title: "Night deploy",
          startedAt: Date.parse("2026-08-12T15:00:00Z"), // 23:00 on the 12th
          endedAt: Date.parse("2026-08-12T20:00:00Z"), // 04:00 on the 13th
          projectId: "p1",
        } as Partial<Doc<"timeEntries">>),
      ],
      projectsById,
    })
    const head = blocks(container).find(
      (block) => !block.className.includes("border-dashed")
    )
    expect(head!.querySelector(".line-clamp-2")).toBeNull()
    expect(head!.querySelector(".truncate")?.textContent).toBe("Night deploy")
  })
})
