import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { CalendarPanel } from "@/components/calendar/calendar-panel"
import type { Doc } from "../../../convex/_generated/dataModel"

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

function renderPanel(
  over: Partial<Parameters<typeof CalendarPanel>[0]> = {}
): {
  onRangeChange: ReturnType<typeof vi.fn>
  rerender: (next: Partial<Parameters<typeof CalendarPanel>[0]>) => void
  container: HTMLElement
} {
  const onRangeChange = vi.fn()
  const props: Parameters<typeof CalendarPanel>[0] = {
    entries: [],
    size: "week",
    anchor: ANCHOR,
    timeZone: MANILA,
    weekStartDay: MONDAY,
    use12Hour: false,
    display: "hms",
    nowMs: NOW,
    projectsById: new Map(),
    onEntryClick: vi.fn(),
    onRangeChange,
    ...over,
  }
  const view = render(<CalendarPanel {...props} />)
  return {
    onRangeChange,
    container: view.container,
    rerender: (next) => view.rerender(<CalendarPanel {...props} {...next} />),
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
  return [...container.querySelectorAll("[data-time] .tabular")].map(
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

      const blockSaying = (text: string) => {
        const found = blocks(container).find((block) =>
          block.textContent.includes(text)
        )
        if (found === undefined) throw new Error(`no block reading "${text}"`)
        return found
      }

      expect(blockSaying("Still going").className).toContain("border-enlarger")
      expect(blockSaying("Still going").className).toContain("bg-enlarger/15")
      // A completed entry is the ordinary raised surface. `enlarger` on the
      // grid means a timer is running and nothing else.
      expect(blockSaying("Finished").className).not.toContain("enlarger")
      expect(blockSaying("Finished").className).toContain("border-edge-raised")
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
        block.className.includes("hatch-empty")
      )
      expect(hatched).toHaveLength(1)

      // The Hatch Rule: the tail is a texture with no title. Its only text is
      // the screen-reader line that says what it continues.
      const [tail] = hatched
      expect(within(tail).queryByText("Night deploy")).toBeNull()
      expect(tail.textContent).toBe(
        "Night deploy — continued from the previous day"
      )

      // And the tail's dashed border is `.hatch-empty`'s own, so no Tailwind
      // border class sits in the list unable to render.
      expect(tail.className).not.toContain("border-")
    })

    it("gives the tail the same Untitled fallback the head has", () => {
      // Starting the timer never requires a title, so an untitled entry is
      // normal — and " — continued from the previous day" is not a sentence.
      const { container } = renderPanel({
        entries: [entry({ ...crosser, title: "" })],
      })
      const [tail] = blocks(container).filter((block) =>
        block.className.includes("hatch-empty")
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
  })

  describe("navigation", () => {
    it("moves the rendered range when the anchor changes", () => {
      /*
       * THE OTHER REGRESSION THIS FILE WAS WRITTEN FOR.
       *
       * `initialDate` is read once, at init — FullCalendar's own docs say it
       * "should be initialized once and stay constant" — and the React
       * wrapper's re-render dispatches `IDLE`. A changed `initialDate` prop
       * moved nothing: the header's arrows would have moved their label and
       * left the grid, the Convex query and the range total on the old week.
       */
      const { container, onRangeChange, rerender } = renderPanel()

      expect(renderedDays(container)).toEqual([
        "2026-08-10",
        "2026-08-11",
        "2026-08-12",
        "2026-08-13",
        "2026-08-14",
        "2026-08-15",
        "2026-08-16",
      ])
      onRangeChange.mockClear()

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
      // And the range goes upward, so the query and the total follow the grid.
      expect(onRangeChange).toHaveBeenCalledWith({
        fromMs: Date.parse("2026-08-16T16:00:00Z"), // Mon 17th, Manila midnight
        toMs: Date.parse("2026-08-23T16:00:00Z"),
      })
    })

    it("survives the clock ticking without rebuilding its range", () => {
      /*
       * The guard on `hiddenDays`.
       *
       * It is refined by `identity` and absent from
       * `COMPLEX_OPTION_COMPARATORS`, so a freshly allocated array on each
       * render rebuilt the dateProfileGenerator, then the dateProfile — which
       * re-fires `datesSet` and calls `resetScroll()`. `nowMs` ticks every
       * second, so the grid used to snap back to `scrollTime` about once a
       * second and could not be scrolled at all.
       *
       * Geometry is what that defect ruined and geometry is what jsdom cannot
       * see, so this asserts the same rebuild by its other two effects: the
       * range must not be re-announced, and — because the controller wired up
       * for navigation re-renders this component on every `datesSet` — the
       * render must terminate at all. With an inline array this throws
       * "Maximum update depth exceeded".
       */
      const { container, onRangeChange, rerender } = renderPanel({
        entries: [entry({})],
      })
      onRangeChange.mockClear()

      rerender({ nowMs: NOW + 1_000 })
      rerender({ nowMs: NOW + 2_000 })

      expect(onRangeChange).not.toHaveBeenCalled()
      expect(renderedDays(container)).toHaveLength(7)
    })
  })

  describe("the range sizes", () => {
    it("renders five weekday columns for a 5-day range", () => {
      // `[0, 6]`, so Monday to Friday whatever `weekStartDay` is. On a Sunday
      // start the range is still the working week.
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
})
