import { useEffect } from "react"
import { Toaster } from "@/components/ui/toast"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Timer } from "@/routes/_authed/-timer"
import {
  convexKey,
  paginatedKey,
  resetPaginatedStore,
  resolvePage,
} from "@/test-utils/convex-query"
import { TIMER_VIEW_KEY } from "@/lib/timer-view"
import { NOW, SETTINGS, makeEntry } from "@/test-utils/fixtures"
import { expectPageHeading } from "@/test-utils/page-heading"
import { addDays, dayOf, dayWindow, weekWindow } from "@shared/day"
import { getFunctionName } from "convex/server"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type { CalendarRange } from "@/lib/calendar-events"
import type * as ConvexReactModuleType from "convex/react"
import type * as ConvexReactQueryModuleType from "@convex-dev/react-query"
import type * as UseClockModuleType from "@/hooks/use-clock"

type ConvexReactModule = typeof ConvexReactModuleType
type ConvexReactQueryModule = typeof ConvexReactQueryModuleType
type UseClockModule = typeof UseClockModuleType

/*
 * Timer's own composition, at the route level.
 *
 * The riskiest thing on this page is not any one leaf component — it is the
 * branching between the grid, a bounded log and the unbounded paginated one,
 * and the range control that governs all three. None of that exists one
 * component down.
 *
 * THE REGRESSION THIS FILE EXISTS FOR: a branch that swapped `EntryLog` for
 * something else. The log holds everything that describes what the reader is
 * DOING rather than what the data is — the selection, which sittings are open,
 * and the half-typed note inside a row's inline field — and an unmount takes
 * all of it mid-sentence. It used to be a search keystroke that unmounted it;
 * the filter bar is gone and choosing a date range is the gesture in its
 * place, so that is what is asserted now.
 *
 * The leading `-` in the filename keeps TanStack Router's file-based route
 * generation from treating this as a route (see `-reports.test.tsx`).
 */

const { logLifecycle } = vi.hoisted(() => ({
  logLifecycle: { mounts: 0, unmounts: 0 },
}))

/*
 * `useSecond` reads a module-level clock store that starts ticking at import,
 * so it is already holding a real second by the time any `Date.now` spy is
 * installed — and Timer derives `today`, and therefore its whole query key,
 * from it. Pinning the hook is the only way to make that key predictable.
 */
vi.mock("@/hooks/use-clock", async (importOriginal) => {
  // `vi.mock` is hoisted above the imports, so the pinned instant has to be
  // pulled in from inside the factory rather than closed over.
  const { NOW: pinned } = await import("@/test-utils/fixtures")
  return {
    ...(await importOriginal<UseClockModule>()),
    useSecond: () => Math.floor(pinned / 1000),
  }
})

/*
 * `EntryLog` stands in as a mount-counting stub. What matters here is not what
 * it draws but WHETHER IT STAYS MOUNTED, because that is what decides whether
 * the state it owns survives a change of range. The real component drags in
 * four mutation hooks, a toast manager and a dialog, none of which this branch
 * depends on.
 */
vi.mock("@/components/entries/entry-log", () => ({
  EntryLog: ({
    groups,
    notesExpanded,
    grouped,
  }: {
    groups: Array<{ day: string }>
    notesExpanded?: boolean
    grouped?: boolean
  }) => {
    useEffect(() => {
      logLifecycle.mounts += 1
      return () => {
        logLifecycle.unmounts += 1
      }
    }, [])
    // The note mode is printed rather than swallowed: this page owns it and
    // the log merely carries it down, so the only thing assertable here is
    // that what the header switch says is what the log was handed. What a ROW
    // then draws is `day-list.test.tsx`.
    return (
      <div
        data-testid="entry-log"
        data-notes={notesExpanded === true ? "full" : "clipped"}
        // Printed for the same reason as the note mode, with one difference:
        // this one is not the page's to own. It comes from `settings.get`, and
        // all this page does is carry it down — so what is assertable here is
        // that it arrives at all. What a row then draws is `day-list.test.tsx`.
        // `String`, not a boolean test: once the OFF case is asserted too,
        // "the page passed false" and "the page passed nothing" have to stay
        // distinguishable, and the second is the regression.
        data-grouped={String(grouped)}
      >
        {groups.length} day groups
      </div>
    )
  },
}))

/*
 * The grid, stubbed. FullCalendar MEASURES element geometry and jsdom reports
 * every element as zero-sized, so a real one rendered here would be an
 * assertion about nothing — and the panel's own suite already exercises what it
 * draws (`calendar-panel.test.tsx`). What this file is for is the branch around
 * it: which view is on screen and what the range control does across the
 * switch.
 *
 * WHAT A CLICK ON A BLOCK DOES IS NO LONGER THIS FILE'S BUSINESS. It used to
 * be: the click was handled by the PAGE, which switched view, scrolled a row
 * into view and focused it, or raised one of three toasts when no row existed.
 * The grid opens an editor anchored to the block instead, so the behaviour and
 * its tests live in `calendar-panel.test.tsx` beside the popover itself.
 *
 * IT RENDERS WHAT IT IS GIVEN, which a bare `<div />` did not. Discarding every
 * prop made four behaviours of this page unassertable. In particular it prints
 * the RANGE it was handed: the page computes that with `rangeOf` and hands the
 * same object to the query, the bar and the grid, so a stub that swallowed it
 * would leave the one thing this page is now responsible for unobservable.
 * The grid no longer reports a range back — see `calendar-events.ts`.
 */
vi.mock("@/components/calendar/calendar-panel", () => ({
  // The panel's own shared empty array, mocked alongside it: `-timer.tsx`
  // imports this from the real module for its `meetings` fallback, and an
  // unstubbed named export is `undefined` under `vi.mock`, not the array
  // `?? NO_MEETINGS` expects.
  NO_MEETINGS: [],
  CalendarPanel: ({
    entries,
    range,
    onSetTrack,
    onTrackNow,
  }: {
    entries: Array<Doc<"timeEntries">>
    range: CalendarRange
    onSetTrack?: (calendarId: string, eventId: string, track: boolean) => void
    onTrackNow?: (calendarId: string, eventId: string) => void
  }) => (
    <div
      data-testid="calendar-panel"
      data-from={range.fromMs}
      data-to={range.toMs}
      data-days={range.days.join(",")}
    >
      <span data-testid="calendar-rows">{entries.length}</span>
      {entries.map((entry) => (
        <span key={entry._id}>{`block: ${entry.title}`}</span>
      ))}
      {/*
        THE TWO WRITES THE GRID CAN MAKE, exposed as buttons so the page's own
        wiring is assertable. What the real panel draws for them is a checkbox
        on a meeting block and a verb in its popover — tested there. What is
        only testable HERE is that the page turns the panel's three loose
        arguments into the object shape the mutation actually takes, which no
        typecheck of the panel can see.
      */}
      <button onClick={() => onSetTrack?.("primary", "evt_1", true)}>
        stub track on
      </button>
      <button onClick={() => onTrackNow?.("primary", "evt_1")}>
        stub track now
      </button>
    </div>
  ),
}))

/* Reaches for `useConvexMutation`, which needs a real Convex client. Timer
 * only threads these through as props; nothing here presses any of them. */
vi.mock("@/hooks/use-entry-edit-mutations", () => ({
  useEntryEditMutations: () => ({ create: vi.fn(async () => {}) }),
}))

/* Same reason, one level up: Timer reaches for the log row's actions so it can
 * hand them to the grid's popover, and every one of them is a Convex mutation.
 * The grid is stubbed above, so nothing here can press one. */
vi.mock("@/hooks/use-entry-actions", () => ({
  useEntryActions: () => ({}),
}))

/*
 * The two meeting writes the grid is handed, as spies.
 *
 * `useConvexMutation` reaches for a live Convex client, which this harness does
 * not mount — so the page's first direct mutation would fail every case in this
 * file rather than only the ones that press it. Keyed by function name, the
 * same shape `-settings.test.tsx` uses for the same reason.
 */
const setTrackOnStart = vi.fn(async () => null)
const trackNow = vi.fn(async () => null)

vi.mock("@convex-dev/react-query", async (importOriginal) => {
  const actual = await importOriginal<ConvexReactQueryModule>()
  return {
    ...actual,
    useConvexMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
      getFunctionName(reference) === "googleTrack:trackNow"
        ? trackNow
        : setTrackOnStart,
  }
})

/* The same hand-driven `usePaginatedQuery` double `-reports.test.tsx` uses:
 * the real hook wants a subscription this test does not have, and the branch
 * under test keys off its `status`. See `@/test-utils/convex-query`. */
vi.mock("convex/react", async (importOriginal) => {
  const actual = await importOriginal<ConvexReactModule>()
  const { usePaginatedQueryDouble } = await import("@/test-utils/convex-query")
  return { ...actual, usePaginatedQuery: usePaginatedQueryDouble }
})

let dateSpy: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  resetPaginatedStore()
  logLifecycle.mounts = 0
  logLifecycle.unmounts = 0
  // The remembered view is real `localStorage` here, and it outlives a render.
  window.localStorage.clear()
  dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
})

afterEach(() => {
  cleanup()
  dateSpy?.mockRestore()
})

const today = dayOf(NOW, SETTINGS.timezone)
const yesterday = addDays(today, -1)
const week = weekWindow(today, SETTINGS.timezone, SETTINGS.weekStartDay)
const lastWeek = weekWindow(
  addDays(today, -7),
  SETTINGS.timezone,
  SETTINGS.weekStartDay
)
const logRange = { fromMs: 0, toMs: dayWindow(today, SETTINGS.timezone).toMs }

/** The args shape both the week totals and the range query mint. */
const rangeArgs = (w: { fromMs: number; toMs: number }) => ({
  fromMs: w.fromMs,
  toMs: w.toMs,
})

const PROJECT = {
  _id: "p1" as unknown as Id<"projects">,
  _creationTime: 0,
  userId: "user-1",
  name: "Acme",
  archived: false,
} as unknown as Doc<"projects">

/**
 * Everything Timer reads with `useSuspenseQuery`, so it never suspends — plus
 * the ranges the bar can ask for.
 *
 * THIS WEEK'S RANGE IS ONE KEY, not two: `entries.listRange` over the current
 * week is both the page's week totals and the calendar's own query. That is the
 * product's behaviour (one subscription, not two) and it is why the "TotalsRow
 * does not follow the range" test steps back a week before comparing — on this
 * week they are legitimately the same rows.
 */
function renderTimer({
  thisWeek = [],
  previousWeek = [],
  onYesterday = [],
  projects = [],
  settings = {},
}: {
  thisWeek?: Array<Doc<"timeEntries">>
  previousWeek?: Array<Doc<"timeEntries">>
  onYesterday?: Array<Doc<"timeEntries">>
  projects?: Array<Doc<"projects">>
  /**
   * Overrides on the `SETTINGS` fixture.
   *
   * Only what a test names moves; everything else stays the shipped default,
   * so a page that reads a setting this helper's callers have never heard of
   * still gets a real value. Added for `groupEntries`, whose OFF case is the
   * one a user reaches by unticking the box.
   */
  settings?: Partial<typeof SETTINGS>
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(convexKey(api.settings.get, {}), { ...SETTINGS, ...settings })
  queryClient.setQueryData(convexKey(api.projects.list, {}), projects)
  queryClient.setQueryData(convexKey(api.tags.list, {}), [])
  queryClient.setQueryData(
    convexKey(api.entries.listRange, rangeArgs(week)),
    thisWeek
  )
  queryClient.setQueryData(
    convexKey(api.entries.listRange, rangeArgs(lastWeek)),
    previousWeek
  )
  queryClient.setQueryData(
    convexKey(api.entries.listRange, rangeArgs(dayWindow(yesterday, SETTINGS.timezone))),
    onYesterday
  )
  return render(
    <QueryClientProvider client={queryClient}>
      {/* Timer raises one toast of its own — a calendar block whose row is not
          in the list. The provider is in the app shell in production; here it
          has to be spelt, and the viewport with it or nothing renders. */}
      <Toaster>
        <Timer />
      </Toaster>
    </QueryClientProvider>
  )
}

const tab = (name: "Calendar" | "List") => screen.getByRole("tab", { name })

/** The range picker's trigger — the pill between the two arrows. */
const pill = () => screen.getByRole("button", { name: /date range/i })

/** How many rows the calendar was handed, straight off the stub. */
const calendarRows = () => screen.getByTestId("calendar-rows").textContent

/** "Today1:00:00" — the label and the figure it belongs to, as one string, so
 *  an assertion cannot pick up an identical figure from somewhere else.
 *
 *  NOT `getByText` alone, since the range pill started naming its range: "This
 *  week" and "Today" are now the pill's words as well as this row's, and a bare
 *  text query matches both. The pill is a button and these labels are not,
 *  which is the one structural difference that separates them. */
const pageTotal = (label: "Today" | "This week") =>
  screen
    .getAllByText(label)
    .find((node) => node.closest("button") === null)?.parentElement?.textContent

/** The calendar's own total. `getByText` matches on an element's DIRECT text
 *  nodes, so this finds the wrapper and reads the figure inside it. */
const rangeTotal = () => screen.getByText("Range total").textContent

/*
 * THE HEADING THIS PAGE DID NOT HAVE.
 *
 * /timer rendered no `<h1>` at all — a document-structure gap rather than a
 * style choice: a screen reader's heading list is how a page is skimmed without
 * sight, and this one offered nothing to skim. It is `sr-only` because the
 * header directly beneath it already says what the page is, twice over, and
 * that is exactly why an assertion is the only thing that can hold it: nothing
 * about a missing invisible heading shows up in a screenshot.
 */
describe("Timer — the page heading", () => {
  it("has exactly one h1, named for the page, and does not paint it", () => {
    renderTimer()

    // `sr-only` — in the tree, out of sight.
    expectPageHeading("Timer", { hidden: true })
  })
})

/*
 * TABS, NOT TWO ROUTES.
 *
 * The whole argument for a tab is that the range bar below it is ONE control
 * governing both views — so the two assertions that matter here are that the
 * switch actually swaps what is on screen, and that the bar does not go with
 * it. A control that vanishes when you switch reads as the data having
 * changed, which is the one impression a billing tool cannot afford.
 */
describe("Timer — Calendar and List", () => {
  it("opens on the list, not the calendar", () => {
    renderTimer()

    expect(screen.queryByTestId("calendar-panel")).toBeNull()
    expect(tab("List").getAttribute("aria-selected")).toBe("true")
    expect(tab("Calendar").getAttribute("aria-selected")).toBe("false")
  })

  it("swaps the log for the calendar and back", () => {
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call" })],
      isDone: true,
    })
    renderTimer()

    expect(screen.getByTestId("entry-log")).toBeTruthy()

    fireEvent.click(tab("Calendar"))
    expect(screen.getByTestId("calendar-panel")).toBeTruthy()
    expect(screen.queryByTestId("entry-log")).toBeNull()

    fireEvent.click(tab("List"))
    expect(screen.queryByTestId("calendar-panel")).toBeNull()
    expect(screen.getByTestId("entry-log")).toBeTruthy()
  })

  it("keeps the range bar on screen in both views", () => {
    renderTimer()

    expect(pill()).toBeTruthy()
    fireEvent.click(tab("Calendar"))
    // ONE control, both views. It used to exist only alongside the grid,
    // because only the grid had a range; the range bounds the list now too.
    expect(pill()).toBeTruthy()
  })

  it("remembers the view across a remount", () => {
    // localStorage, adopted after the first paint rather than read in a state
    // initializer — see src/lib/timer-view.ts for why that is not optional on
    // a server-rendered page.
    renderTimer()
    fireEvent.click(tab("Calendar"))
    expect(window.localStorage.getItem(TIMER_VIEW_KEY)).toBe("calendar")

    cleanup()
    renderTimer()

    expect(tab("Calendar").getAttribute("aria-selected")).toBe("true")
    expect(screen.getByTestId("calendar-panel")).toBeTruthy()
  })

  it("shows the size select only where there are columns to size", () => {
    renderTimer()

    // A "Week view / Day view" select above a scrolling log is a control with
    // nothing to act on.
    expect(screen.queryByLabelText("Calendar range")).toBeNull()

    fireEvent.click(tab("Calendar"))
    expect(screen.getByLabelText("Calendar range")).toBeTruthy()
  })

  it("gives the calendar its own range total, and leaves the page totals alone", () => {
    renderTimer()
    fireEvent.click(tab("Calendar"))

    // The arrows and the range total belong to what is on screen…
    expect(screen.getByRole("button", { name: "Previous week" })).toBeTruthy()
    expect(screen.getByText("Range total")).toBeTruthy()

    // …and `TotalsRow` still says today and this week, which are facts about
    // the clock rather than about what the grid happens to be showing.
    expect(pageTotal("Today")).toContain("Today")
    expect(pageTotal("This week")).toContain("This week")
  })

  it("steps the range without touching the page totals", () => {
    renderTimer()
    fireEvent.click(tab("Calendar"))

    // NOW is Wednesday 5 August 2026, weekStartDay 1 (Monday) — so "All dates"
    // snaps to the week containing today, and one step back leaves it. The pill
    // NAMES a range that is exactly a preset and spells out one that is not;
    // the accessible name carries the dates either way, which is what pins the
    // step below to the days it actually moved.
    expect(pill().textContent).toContain("This week")

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }))

    expect(pill().textContent).toContain("Last week")
    expect(pill().getAttribute("aria-label")).toBe("Date range — 27 Jul – 2 Aug")
  })

  it("says a range failed rather than drawing it as an empty week", async () => {
    /*
     * An empty grid and a 0:00:00 range total are what a failed query used to
     * look like — indistinguishable from a week nobody tracked anything in, on
     * a product whose stated principle is never to lose time.
     *
     * Nothing is seeded for the week AFTER this one and this client has no
     * Convex `queryFn` behind it, so stepping forward is a range that genuinely
     * fails, the way a dropped connection would.
     */
    renderTimer()
    fireEvent.click(tab("Calendar"))

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next week" }))
    })
    // One macrotask, explicitly. React Query commits the failed fetch a tick
    // after the click, and `waitFor` — the idiomatic wait — is the one thing
    // this repo cannot use (see calendar-panel.test.tsx's header note).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(screen.getByRole("alert").textContent).toContain("could not be loaded")
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })

  it("keeps TotalsRow on the clock while the range total follows the grid", () => {
    /*
     * The constraint, asserted with figures that DIFFER — it was previously
     * asserted only by the presence of the labels, over a fixture where every
     * number was 0:00:00, so a TotalsRow wired to the selected range would have
     * passed it.
     */
    renderTimer({
      thisWeek: [makeEntry({ durationMs: 3_600_000 })], // 1h, today
      previousWeek: [
        makeEntry({
          _id: "old" as unknown as Id<"timeEntries">,
          startedAt: lastWeek.fromMs + 9 * 3_600_000,
          endedAt: lastWeek.fromMs + 11 * 3_600_000 + 1_800_000,
          durationMs: 9_000_000, // 2:30:00, last week
        }),
      ],
    })

    fireEvent.click(tab("Calendar"))
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }))

    // The grid is on last week, and its total says so…
    expect(pill().textContent).toContain("Last week")
    expect(rangeTotal()).toBe("Range total2:30:00")

    // …while today and this week are facts about the clock, unmoved.
    expect(pageTotal("Today")).toBe("Today1:00:00")
    expect(pageTotal("This week")).toBe("This week1:00:00")
  })

  it("hands the grid the rows for the range it is drawing", () => {
    renderTimer({ thisWeek: [makeEntry({ title: "Client call" })], projects: [PROJECT] })
    fireEvent.click(tab("Calendar"))

    expect(calendarRows()).toBe("1")
    // The window the page computed, printed by the stub — the same object the
    // query key and the pill are derived from.
    expect(screen.getByTestId("calendar-panel").dataset.from).toBe(String(week.fromMs))
    expect(screen.getByTestId("calendar-panel").dataset.to).toBe(String(week.toMs))
  })
})

/*
 * THE RANGE CONTROL ITSELF.
 *
 * "All dates" is the default because it is what /timer has always done: the
 * whole log, paginated newest first. A user who never touches this control must
 * get exactly the page they had before it existed.
 */
describe("Timer — the range control", () => {
  it("opens on All dates, with nothing to step", () => {
    renderTimer()

    expect(screen.getByText("All dates")).toBeTruthy()
    // Unbounded already reaches every entry in both directions, so an arrow
    // would either do nothing or bound a selection nobody made.
    expect(
      screen.getByRole("button", { name: "Previous range" }).hasAttribute("disabled")
    ).toBe(true)
    expect(
      screen.getByRole("button", { name: "Next range" }).hasAttribute("disabled")
    ).toBe(true)
  })

  it("offers the calendar four presets and the list six", () => {
    renderTimer()
    fireEvent.click(pill())

    const inRail = (label: string) =>
      screen.queryByRole("button", { name: label }) !== null

    expect(
      ["Today", "Yesterday", "This week", "Last week", "Last 30 days", "All dates"].filter(
        inRail
      )
    ).toHaveLength(6)

    // Escape the popover by picking something, then switch and re-open.
    fireEvent.click(screen.getByRole("button", { name: "All dates" }))
    fireEvent.click(tab("Calendar"))
    fireEvent.click(pill())

    // THE CONSTRAINT, VISIBLE: a time grid is a picture of a day at a fixed
    // pixels-per-hour, and thirty columns of that is not a smaller version of
    // the same thing.
    expect(
      ["Today", "Yesterday", "This week", "Last week"].filter(inRail)
    ).toHaveLength(4)
    expect(inRail("Last 30 days")).toBe(false)
    expect(inRail("All dates")).toBe(false)
  })

  it("bounds the list to the range that was picked", () => {
    /*
     * The whole point of the control in List view. Unbounded, the log is every
     * page it has walked back through; bounded, it is `entries.listRange` —
     * the same query the grid reads, for the same range.
     */
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [
        makeEntry({ _id: "a" as unknown as Id<"timeEntries">, title: "Today's work" }),
        makeEntry({
          _id: "b" as unknown as Id<"timeEntries">,
          title: "Yesterday's work",
          startedAt: NOW - 86_400_000,
          endedAt: NOW - 86_400_000 + 3_600_000,
        }),
      ],
      isDone: false, // pages remain, so "Load earlier entries" is offered
    })
    renderTimer({
      onYesterday: [
        makeEntry({
          _id: "b" as unknown as Id<"timeEntries">,
          title: "Yesterday's work",
          startedAt: NOW - 86_400_000,
          endedAt: NOW - 86_400_000 + 3_600_000,
        }),
      ],
    })

    expect(screen.getByTestId("entry-log").textContent).toBe("2 day groups")
    expect(screen.getByText("Load earlier entries")).toBeTruthy()

    fireEvent.click(pill())
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }))

    expect(screen.getByTestId("entry-log").textContent).toBe("1 day groups")
    // Through the pill rather than `getByText`: "Yesterday" is also the name of
    // the rail button that was just clicked, so a bare text query would pass on
    // finding the control instead of the answer.
    expect(pill().textContent).toContain("Yesterday")
    // And the accessible name still pins the DAY it resolved to — the preset
    // name alone would pass even if it had selected the wrong date.
    expect(pill().getAttribute("aria-label")).toBe("Date range — 4 Aug 2026")
    // Nothing left to load: `listRange` answers with the whole range at once,
    // so a button offering to load more of it would do nothing.
    expect(screen.queryByText("Load earlier entries")).toBeNull()
  })

  it("keeps EntryLog mounted across a change of range, so work in progress survives", () => {
    /*
     * THE REGRESSION THIS FILE EXISTS FOR, in its current spelling. The log
     * holds the selection, the open sittings and any note being typed into a
     * row right now. Two sibling branches each rendering their own log would
     * unmount one and mount the other on every change of range.
     */
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call" })],
      isDone: true,
    })
    renderTimer({ onYesterday: [] })

    expect(logLifecycle.mounts).toBe(1)

    fireEvent.click(pill())
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }))

    expect(screen.getByTestId("entry-log")).toBeTruthy()
    expect(logLifecycle.unmounts).toBe(0)
    expect(logLifecycle.mounts).toBe(1)
  })

  it("does not fall back to the onboarding copy for a quiet range", () => {
    // "Nothing tracked yet" means a new account. It is flatly false of a
    // freelancer who has narrowed to a day they did not work.
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call" })],
      isDone: true,
    })
    renderTimer({ onYesterday: [] })

    fireEvent.click(pill())
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }))

    expect(screen.getByTestId("entry-log").textContent).toBe("0 day groups")
  })

  it("snaps a span no grid could draw onto the week it starts in", () => {
    /*
     * "Last 30 days" is offered in List and not in Calendar, and the array is
     * not what enforces that — the state can still arrive by switching views
     * under a selection. Thirty columns at 48px an hour is unreadable, so the
     * grid draws the week the selection starts in and the arrows walk the rest.
     */
    renderTimer()
    fireEvent.click(pill())
    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }))
    // Through the pill, not `getByText`: "Last 30 days" also names the rail
    // button just clicked. The accessible name is what pins the span.
    expect(pill().getAttribute("aria-label")).toBe("Date range — 7 Jul – 5 Aug 2026")

    fireEvent.click(tab("Calendar"))

    // The week containing 7 July, Monday-start.
    expect(pill().textContent).toContain("6 – 12 Jul 2026")
    expect(screen.getByTestId("calendar-panel").dataset.days).toBe(
      [
        "2026-07-06",
        "2026-07-07",
        "2026-07-08",
        "2026-07-09",
        "2026-07-10",
        "2026-07-11",
        "2026-07-12",
      ].join(",")
    )
  })

  it("gives the list back its wide selection when the grid is left", () => {
    // The snap is what the GRID is looking at, not an edit to what the user
    // asked for — so peeking at the calendar cannot silently narrow the list.
    renderTimer()
    fireEvent.click(pill())
    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }))

    fireEvent.click(tab("Calendar"))
    fireEvent.click(tab("List"))

    // The wide selection came back intact — pinned by the dates in the
    // accessible name, not by the preset name that is also a button.
    expect(pill().getAttribute("aria-label")).toBe("Date range — 7 Jul – 5 Aug 2026")
  })
})

/*
 * WHY THE GRID IS BLANK.
 *
 * The `isError` branch already argued this and the argument was applied to one
 * branch of two: an empty grid and a `0:00:00` range total are
 * indistinguishable from a week nobody tracked anything in.
 */
describe("Timer — an empty grid says why", () => {
  it("says nothing was tracked when the range is genuinely empty", () => {
    renderTimer()
    fireEvent.click(tab("Calendar"))

    expect(screen.getByText("Nothing was tracked in this range.")).toBeTruthy()
  })

  it("says nothing at all while the grid has rows on it", () => {
    renderTimer({ thisWeek: [makeEntry({ title: "Client call" })] })
    fireEvent.click(tab("Calendar"))

    expect(screen.queryByText(/Nothing was tracked/)).toBeNull()
  })
})

describe("Timer — the range bar's place in the layout", () => {
  it("puts the whole range bar inside the header Page measures and pins", () => {
    // Not a detail: the bar is a control over what scrolls beneath it, so it
    // has to stick with the totals rather than scroll away with the grid.
    // `Page` measures its header slot for `--page-header-height`, so being
    // inside it is what buys that — and nothing about it shows up in a
    // screenshot.
    const { container } = renderTimer()
    fireEvent.click(tab("Calendar"))

    const pinned = container.querySelector(".sticky")
    expect(pinned).not.toBeNull()
    expect(pinned!.contains(screen.getByText("Range total"))).toBe(true)
    expect(pinned!.contains(pill())).toBe(true)
    expect(pinned!.contains(tab("Calendar"))).toBe(true)
  })
})

/*
 * FULL NOTES, WITHOUT LEAVING THE PAGE.
 *
 * The log clips a note to one line so a day is scannable, which is right up
 * until the moment the note is the thing being read — at a standup, or writing
 * up an invoice. That used to mean opening each note's sheet in turn, or going
 * to /reports while the timer is still running here.
 *
 * What this file can hold is the switch and what it hands down; the row's own
 * drawing of it — wrapped instead of ellipsed, a size up — is
 * `day-list.test.tsx`, against a real `EntryRow`.
 */
describe("Timer — reading the notes in full", () => {
  const notesButton = () => screen.getByRole("button", { name: "Full notes" })
  const logNotes = () => screen.getByTestId("entry-log").getAttribute("data-notes")

  beforeEach(() => {
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call", note: "Rewrote the import step." })],
      isDone: true,
    })
  })

  it("clips notes until asked, then writes them out in full", () => {
    renderTimer()

    // The default is the log this page has always drawn.
    expect(notesButton().getAttribute("aria-pressed")).toBe("false")
    expect(logNotes()).toBe("clipped")

    fireEvent.click(notesButton())

    expect(notesButton().getAttribute("aria-pressed")).toBe("true")
    expect(logNotes()).toBe("full")

    // And back — a mode you cannot leave is a mode, not a switch.
    fireEvent.click(notesButton())
    expect(logNotes()).toBe("clipped")
  })

  it("is offered only where there are note lines to unclip", () => {
    renderTimer()
    expect(notesButton()).toBeTruthy()

    fireEvent.click(tab("Calendar"))

    // The grid draws blocks, not rows: there is no clipped line for this to
    // act on, and a switch governing nothing on screen is worse than absent.
    expect(screen.queryByRole("button", { name: "Full notes" })).toBeNull()

    fireEvent.click(tab("List"))
    expect(notesButton()).toBeTruthy()
  })

  it("remembers the mode across a remount", () => {
    // Someone reading yesterday back at a standup sets this once. Resetting it
    // on every reload would mean setting it again every morning.
    renderTimer()
    fireEvent.click(notesButton())

    cleanup()
    renderTimer()

    expect(notesButton().getAttribute("aria-pressed")).toBe("true")
    expect(logNotes()).toBe("full")
  })
})

/* The setting reaches the log, or the whole feature is off however the account
 * has it set. `SETTINGS.groupEntries` is the shipped default — true — and
 * `DayList`'s own prop defaults false, so a page that forgets to pass it draws
 * a flat log and nothing else complains. */
describe("Timer — the grouping setting reaches the log", () => {
  const grouped = () => screen.getByTestId("entry-log").getAttribute("data-grouped")

  beforeEach(() => {
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call" })],
      isDone: true,
    })
  })

  it("hands the log the account's own groupEntries", () => {
    renderTimer()
    expect(grouped()).toBe("true")
  })

  /* BOTH VALUES, because only this one is reachable by unticking the box —
   * and asserting the default alone would pass against a page that hardcoded
   * the prop, which is the same as not passing the setting at all. */
  it("hands it down turned off, rather than ignoring the account", () => {
    renderTimer({ settings: { groupEntries: false } })
    expect(grouped()).toBe("false")
  })
})

describe("Timer — the unbounded log", () => {
  it("shows the skeleton, not an empty state, while the first page is in flight", () => {
    renderTimer() // no page resolved: status stays LoadingFirstPage

    expect(screen.queryByTestId("entry-log")).toBeNull()
    // …and it is not silent: the skeleton is the only thing on screen here.
    expect(screen.getByRole("status").textContent).toBe("Loading entries…")
  })

  it("keeps the load-more button while pages remain", () => {
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call" })],
      isDone: false,
    })
    renderTimer()

    expect(screen.getByText("Load earlier entries")).toBeTruthy()
  })
})

/*
 * THE MEETING WRITES, from the grid's loose arguments to the mutation's object.
 *
 * The panel says `(calendarId, eventId, track)` because that is what a block
 * has; the Convex function takes `{ calendarId, eventId, track }`. The join is
 * this page's, it is invisible to a typecheck on either side of it, and a
 * transposed pair here would tick the wrong meeting.
 */
describe("Timer — ticking a meeting", () => {
  const openCalendar = () => {
    renderTimer()
    fireEvent.click(tab("Calendar"))
  }

  beforeEach(() => {
    setTrackOnStart.mockClear()
    trackNow.mockClear()
  })

  it("hands setTrackOnStart the meeting the grid named", () => {
    openCalendar()
    fireEvent.click(screen.getByRole("button", { name: "stub track on" }))
    expect(setTrackOnStart).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "evt_1",
      track: true,
    })
  })

  it("hands trackNow the meeting the popover named", () => {
    openCalendar()
    fireEvent.click(screen.getByRole("button", { name: "stub track now" }))
    expect(trackNow).toHaveBeenCalledWith({
      calendarId: "primary",
      eventId: "evt_1",
    })
  })

  it("says so when the write fails, rather than failing silently", async () => {
    // No optimistic update stands behind these: the checkbox is drawn from the
    // mirrored row, so a rejected write leaves the box exactly where it was and
    // this line is the only evidence the user gets.
    setTrackOnStart.mockRejectedValueOnce(new Error("ConvexError: whatever"))
    openCalendar()
    fireEvent.click(screen.getByRole("button", { name: "stub track on" }))
    // Through `errorMessage`, which refuses to print a Convex internal at a
    // user: anything that is not a trace error becomes this one sentence.
    // `findAll`: Base UI renders the title twice — once in the toast and once
    // in the offscreen live region it announces from.
    expect(
      (await screen.findAllByText("That didn't save. Try again.")).length
    ).toBeGreaterThan(0)
  })
})
