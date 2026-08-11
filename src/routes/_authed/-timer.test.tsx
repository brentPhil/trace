import { useEffect } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Timer } from "@/routes/_authed/timer"
import { Toast, ToastViewport } from "@/components/ui/toast"
import {
  convexKey,
  paginatedKey,
  resetPaginatedStore,
  resolvePage,
} from "@/test-utils/convex-query"
import { expectFilterControlsInBand } from "@/test-utils/filter-band"
import { NOW, SETTINGS, makeEntry } from "@/test-utils/fixtures"
import { expectPageHeading } from "@/test-utils/page-heading"
import { addDays, dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import type { Doc, Id } from "../../../convex/_generated/dataModel"
import type * as ConvexReactModuleType from "convex/react"
import type * as UseClockModuleType from "@/hooks/use-clock"

type ConvexReactModule = typeof ConvexReactModuleType
type UseClockModule = typeof UseClockModuleType

/*
 * Timer's own composition, at the route level.
 *
 * The riskiest thing on this page is not any one leaf component — it is the
 * three-way branch between "still loading", "a filter matched nothing" and
 * "the log". Every part of it was previously tested only one component down,
 * where the branch itself does not exist.
 *
 * THE REGRESSION THIS FILE EXISTS FOR: the middle branch used to render
 * `null` in place of `EntryLog`. `EntryLog` owns `NoteSheet`, and `NoteSheet`
 * owns `draftsRef` — the in-memory copy of a note whose save is still in
 * flight or has failed. So any keystroke in the search box that dropped the
 * match count to zero unmounted the log and destroyed every held draft,
 * flatly contradicting what note-sheet.tsx promises for exactly that case.
 *
 * The leading `-` in the filename keeps TanStack Router's file-based route
 * generation from treating this as a route (see `-reports.test.tsx`).
 */

const { logLifecycle, calendarStub } = vi.hoisted(() => ({
  logLifecycle: { mounts: 0, unmounts: 0 },
  /** `silent` makes the stub below skip its `datesSet`, which is the one state
   *  the real grid also passes through: mounted, and not yet having said what
   *  it is drawing. */
  calendarStub: { silent: false },
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
 * the state it owns survives a filter keystroke. The real component drags in
 * four mutation hooks, a toast manager and a dialog, none of which this branch
 * depends on.
 */
vi.mock("@/components/entries/entry-log", () => ({
  EntryLog: ({ groups }: { groups: Array<{ day: string }> }) => {
    useEffect(() => {
      logLifecycle.mounts += 1
      return () => {
        logLifecycle.unmounts += 1
      }
    }, [])
    return <div data-testid="entry-log">{groups.length} day groups</div>
  },
}))

/*
 * The grid, stubbed. FullCalendar MEASURES element geometry and jsdom reports
 * every element as zero-sized, so a real one rendered here would be an
 * assertion about nothing — and the panel's own suite already exercises what it
 * draws (`calendar-panel.test.tsx`). What this file is for is the branch around
 * it: which view is on screen, what the filter band does across the switch, and
 * what a click on a block does.
 *
 * IT RENDERS WHAT IT IS GIVEN, which the previous `<div />` did not. Discarding
 * every prop made four behaviours of this page unassertable, and one of them was
 * silently unimplemented-able: deleting the filter from `calendarEntries`
 * outright left all thirteen tests in this file green.
 *
 * It also REPORTS A RANGE, because the real grid does — the page's header label
 * and its range query are both derived from what `datesSet` hands back, and a
 * stub that never reported would leave the page permanently in its
 * before-first-`datesSet` state. `weekWindow` is a faithful stand-in for the
 * week view specifically: FullCalendar builds a week view from `firstDay` with
 * nothing trimmed, so the two agree by construction. It is NOT a stand-in for
 * the 5-day view, where `hiddenDays` trims the ends — that disagreement is the
 * whole subject of `calendar-range-label.test.tsx`, which renders the real grid.
 */
vi.mock("@/components/calendar/calendar-panel", () => ({
  CalendarPanel: ({
    entries,
    anchor,
    timeZone,
    weekStartDay,
    onEntryClick,
    onRangeChange,
  }: {
    entries: Array<Doc<"timeEntries">>
    anchor: string
    timeZone: string
    weekStartDay: number
    onEntryClick: (entryId: string) => void
    onRangeChange: (range: { fromMs: number; toMs: number }) => void
  }) => {
    const { fromMs, toMs } = weekWindow(anchor, timeZone, weekStartDay)
    useEffect(() => {
      if (calendarStub.silent) return
      onRangeChange({ fromMs, toMs })
    }, [fromMs, toMs, onRangeChange])

    return (
      <div data-testid="calendar-panel">
        <span data-testid="calendar-rows">{entries.length}</span>
        {entries.map((entry) => (
          <button key={entry._id} onClick={() => onEntryClick(entry._id)}>
            {`block: ${entry.title}`}
          </button>
        ))}
      </div>
    )
  },
}))

/* Reaches for `useConvexMutation`, which needs a real Convex client. Timer
 * only threads these through as props; nothing here presses any of them. */
vi.mock("@/hooks/use-entry-edit-mutations", () => ({
  useEntryEditMutations: () => ({ create: vi.fn(async () => {}) }),
}))

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
  calendarStub.silent = false
  dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
})

afterEach(() => {
  cleanup()
  dateSpy?.mockRestore()
})

const today = dayOf(NOW, SETTINGS.timezone)
const week = weekWindow(today, SETTINGS.timezone, SETTINGS.weekStartDay)
const lastWeek = weekWindow(
  addDays(today, -7),
  SETTINGS.timezone,
  SETTINGS.weekStartDay
)
const logRange = { fromMs: 0, toMs: dayWindow(today, SETTINGS.timezone).toMs }

/** The args shape both the week totals and the calendar's range query mint. */
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
 * the two ranges the calendar can ask for.
 *
 * THIS WEEK'S RANGE IS ONE KEY, not two: `entries.listRange` over the current
 * week is both the page's week totals and, once the grid reports, the
 * calendar's own query. That is the product's behaviour (one subscription, not
 * two) and it is why the "TotalsRow does not follow the range" test steps back
 * a week before comparing — on this week they are legitimately the same rows.
 */
function renderTimer({
  thisWeek = [],
  previousWeek = [],
  projects = [],
}: {
  thisWeek?: Array<Doc<"timeEntries">>
  previousWeek?: Array<Doc<"timeEntries">>
  projects?: Array<Doc<"projects">>
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(convexKey(api.settings.get, {}), SETTINGS)
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
  return render(
    <QueryClientProvider client={queryClient}>
      {/* Timer raises one toast of its own — a calendar block whose row is not
          in the list. The provider is in the app shell in production; here it
          has to be spelt, and the viewport with it or nothing renders. */}
      <Toast.Provider>
        <Timer />
        <ToastViewport />
      </Toast.Provider>
    </QueryClientProvider>
  )
}

const search = () =>
  screen.getByPlaceholderText<HTMLInputElement>("Search titles, notes and projects")

/** How many rows the calendar was handed, straight off the stub. */
const calendarRows = () => screen.getByTestId("calendar-rows").textContent

/** "Today1:00:00" — the label and the figure it belongs to, as one string, so
 *  an assertion cannot pick up an identical figure from somewhere else. */
const pageTotal = (label: "Today" | "This week") =>
  screen.getByText(label).parentElement?.textContent

/** The calendar's own total. `getByText` matches on an element's DIRECT text
 *  nodes, so this finds the wrapper and reads the figure inside it. */
const rangeTotal = () => screen.getByText("Range total").textContent

/*
 * THE HEADING THIS PAGE DID NOT HAVE.
 *
 * /timer rendered no `<h1>` at all — a document-structure gap rather than a
 * style choice: a screen reader's heading list is how a page is skimmed without
 * sight, and this one offered nothing to skim. It is `sr-only` because the
 * header directly beneath it already says what the page is twice over, and that
 * is exactly why an assertion is the only thing that can hold it: nothing about
 * a missing invisible heading shows up in a screenshot.
 */
describe("Timer — the page heading", () => {
  it("has exactly one h1, named for the page, and does not paint it", () => {
    renderTimer()

    // `sr-only` — in the tree, out of sight.
    expectPageHeading("Timer", { hidden: true })
  })
})

/*
 * The band this page has always drawn, now asserted rather than assumed.
 *
 * It used to be spelt out inline here and nowhere else, which is how /reports
 * came to render the same `FilterControls` on bare ground. Both pages call
 * `FilterBand` now, and both make this assertion, so removing the band from
 * either one fails a test instead of only looking wrong.
 */
describe("Timer — the filter band", () => {
  it("puts the filter controls on the shared Surface strip", () => {
    renderTimer()

    expectFilterControlsInBand()
  })
})

/*
 * TABS, NOT TWO ROUTES.
 *
 * The whole argument for a tab is that the filter band below it is ONE control
 * governing both views — so the two assertions that matter here are that the
 * switch actually swaps what is on screen, and that the band does not go with
 * it. A control that vanishes when you switch reads as the data having
 * changed, which is the one impression a billing tool cannot afford.
 */
describe("Timer — Calendar and List", () => {
  const tab = (name: "Calendar" | "List") => screen.getByRole("tab", { name })

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

  it("keeps the filter band, and what was typed into it, across both views", () => {
    renderTimer()

    fireEvent.change(search(), { target: { value: "client" } })
    fireEvent.click(tab("Calendar"))

    // The band is still on screen, still holding the same text: ONE filter,
    // narrowing both views. Hiding it with the list would silently drop a
    // filter the user set.
    expectFilterControlsInBand()
    expect(search().value).toBe("client")
  })

  it("gives the calendar its own range bar, and leaves the page totals alone", () => {
    renderTimer()
    fireEvent.click(tab("Calendar"))

    // The stepper and the range total belong to the calendar…
    expect(screen.getByRole("button", { name: "Previous week" })).toBeTruthy()
    expect(screen.getByText("Range total")).toBeTruthy()

    // …and `TotalsRow` still says today and this week, which are facts about
    // the clock rather than about what the grid happens to be showing.
    expect(screen.getByText("Today")).toBeTruthy()
    expect(screen.getByText("This week")).toBeTruthy()
  })

  it("steps the range without touching the page totals", () => {
    renderTimer()
    fireEvent.click(tab("Calendar"))

    // NOW is Wednesday 5 August 2026, weekStartDay 1 (Monday) — so the label
    // opens on this week and one step back leaves it. Both labels are derived
    // from the range the grid REPORTED, never from the anchor: see
    // `visibleDaysOf`, and `calendar-range-label.test.tsx` for the 31 of 49
    // combinations where computing it from the anchor disagreed with the
    // columns on screen.
    expect(screen.getByText("This week · 3–9 Aug")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }))

    expect(screen.getByText("27 Jul – 2 Aug")).toBeTruthy()
    expect(screen.queryByText("This week · 3–9 Aug")).toBeNull()
  })

  it("draws no range bar at all until the grid has said what it is showing", () => {
    /*
     * The header's days come from `datesSet` and from nothing else, so before
     * the first one there is nothing honest to put on the bar — and the only
     * other way to produce a label and a total is the second derivation this
     * replaced, which disagreed with the grid 31 times in 49. A bar that
     * arrives a commit late beats a bar that is confidently wrong.
     */
    calendarStub.silent = true
    renderTimer()

    fireEvent.click(tab("Calendar"))

    expect(screen.getByTestId("calendar-panel")).toBeTruthy()
    expect(screen.queryByText("Range total")).toBeNull()
    expect(screen.queryByRole("button", { name: "Previous week" })).toBeNull()
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

    expect(screen.getByRole("alert").textContent).toContain(
      "could not be loaded"
    )
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })

  it("narrows the calendar's rows with the same project filter the list uses", () => {
    // The regression this replaces: `return rows` in place of the filter left
    // every test in this file green, because the stub discarded `entries`.
    const onProject = makeEntry({
      _id: "a" as unknown as Id<"timeEntries">,
      title: "Acme work",
      projectId: PROJECT._id,
    })
    const offProject = makeEntry({
      _id: "b" as unknown as Id<"timeEntries">,
      title: "Admin",
    })
    renderTimer({ thisWeek: [onProject, offProject], projects: [PROJECT] })

    fireEvent.click(tab("Calendar"))
    expect(calendarRows()).toBe("2")

    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: PROJECT._id },
    })
    expect(calendarRows()).toBe("1")

    // …and the text box narrows it too, through the same `matches`.
    fireEvent.change(screen.getByLabelText("Project"), {
      target: { value: "all" },
    })
    fireEvent.change(search(), { target: { value: "admin" } })
    expect(calendarRows()).toBe("1")
  })

  it("keeps TotalsRow on the clock while the range total follows the grid", () => {
    /*
     * The constraint, asserted with figures that DIFFER — it was previously
     * asserted only by the presence of the labels, over a fixture where every
     * number was 0:00:00, so a TotalsRow wired to the calendar's range would
     * have passed it.
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
    expect(screen.getByText("27 Jul – 2 Aug")).toBeTruthy()
    expect(rangeTotal()).toBe("Range total2:30:00")

    // …while today and this week are facts about the clock, unmoved.
    expect(pageTotal("Today")).toBe("Today1:00:00")
    expect(pageTotal("This week")).toBe("This week1:00:00")
  })
})

/*
 * CLICKING A BLOCK, when there is no row to land on.
 *
 * Both of these used to switch the view and focus nothing — for the running
 * entry, ALWAYS, since `groupByDay` never gives it a row; for anything outside
 * the loaded pages, whenever the user had stepped back further than the log has
 * paginated. The second is the worse of the two: the week on screen is replaced
 * by a log of recent rows, and nothing says why.
 */
describe("Timer — clicking a calendar block", () => {
  const tab = (name: "Calendar" | "List") => screen.getByRole("tab", { name })
  const block = (title: string) =>
    screen.getByRole("button", { name: `block: ${title}` })

  it("switches to the list when the entry has a row there", () => {
    const entry = makeEntry({ title: "Client call" })
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [entry],
      isDone: true,
    })
    renderTimer({ thisWeek: [entry] })

    fireEvent.click(tab("Calendar"))
    fireEvent.click(block("Client call"))

    expect(screen.getByTestId("entry-log")).toBeTruthy()
    expect(screen.queryByTestId("calendar-panel")).toBeNull()
  })

  it("stays on the calendar for the running entry, and says where it is", () => {
    const running = makeEntry({
      _id: "live" as unknown as Id<"timeEntries">,
      title: "Standup",
      endedAt: null,
      durationMs: null,
    })
    // In the paginated results — and still not in the log's rows, because
    // `groupByDay` deliberately keeps a running entry out of them.
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [running],
      isDone: true,
    })
    renderTimer({ thisWeek: [running] })

    fireEvent.click(tab("Calendar"))
    fireEvent.click(block("Standup"))

    expect(screen.getByTestId("calendar-panel")).toBeTruthy()
    expect(screen.queryByTestId("entry-log")).toBeNull()
    expect(screen.getByText(/is still running/)).toBeTruthy()
  })

  it("stays on the calendar for an entry outside the loaded pages", () => {
    // The log paginates 50 at a time, newest first; the grid steps to any week.
    // This block is on the grid and its row has simply never been fetched.
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ _id: "recent" as unknown as Id<"timeEntries"> })],
      isDone: false,
    })
    renderTimer({
      thisWeek: [
        makeEntry({
          _id: "unloaded" as unknown as Id<"timeEntries">,
          title: "Deep history",
        }),
      ],
    })

    fireEvent.click(tab("Calendar"))
    fireEvent.click(block("Deep history"))

    expect(screen.getByTestId("calendar-panel")).toBeTruthy()
    expect(screen.queryByTestId("entry-log")).toBeNull()
    expect(screen.getByText(/has not been loaded into the list yet/)).toBeTruthy()
  })
})

describe("Timer — the range bar's place in the layout", () => {
  const tab = (name: "Calendar" | "List") => screen.getByRole("tab", { name })

  it("puts the whole range bar inside the header Page measures and pins", () => {
    // Not a detail: the stepper is a control over what scrolls beneath it, so
    // it has to stick with the totals rather than scroll away with the grid.
    // `Page` measures its header slot for `--page-header-height`, so being
    // inside it is what buys that — and nothing about it shows up in a
    // screenshot.
    const { container } = renderTimer()
    fireEvent.click(tab("Calendar"))

    const pinned = container.querySelector(".sticky")
    expect(pinned).not.toBeNull()
    expect(pinned!.contains(screen.getByText("Range total"))).toBe(true)
    expect(pinned!.contains(tab("Calendar"))).toBe(true)
  })
})

describe("Timer — filtering to nothing", () => {
  it("keeps EntryLog mounted, so the drafts it holds survive the keystroke", () => {
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call" })],
      isDone: true,
    })
    renderTimer()

    expect(screen.getByTestId("entry-log")).toBeTruthy()
    expect(logLifecycle.mounts).toBe(1)

    // A search that matches nothing already loaded.
    fireEvent.change(search(), { target: { value: "zzzz" } })

    expect(screen.getByText("No entries match these filters.")).toBeTruthy()
    // THE ASSERTION. Before the fix this was 1: the log was replaced with
    // `null`, taking NoteSheet's `draftsRef` with it.
    expect(logLifecycle.unmounts).toBe(0)
    expect(logLifecycle.mounts).toBe(1)
  })

  it("does not fall back to the log's onboarding copy while a filter is active", () => {
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call" })],
      isDone: true,
    })
    renderTimer()

    fireEvent.change(search(), { target: { value: "zzzz" } })

    // `empty={null}` is what buys this: the log renders, and draws nothing,
    // rather than inheriting DayList's "an empty log means a new account".
    expect(screen.queryByText("Nothing tracked yet.")).toBeNull()
  })

  it("shows the skeleton, not an empty state, while the first page is in flight", () => {
    renderTimer() // no page resolved: status stays LoadingFirstPage

    expect(screen.queryByTestId("entry-log")).toBeNull()
    expect(screen.queryByText("Nothing tracked yet.")).toBeNull()
    // …and it is not silent: the skeleton is the only thing on screen here.
    expect(screen.getByRole("status").textContent).toBe("Loading entries…")
  })

  it("distinguishes 'no matches yet' from 'no matches' by whether pages remain", () => {
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [makeEntry({ title: "Client call" })],
      isDone: false, // more history behind this page
    })
    renderTimer()

    fireEvent.change(search(), { target: { value: "zzzz" } })

    expect(screen.getByText("No matches in the entries loaded so far.")).toBeTruthy()
    expect(screen.queryByText("No entries match these filters.")).toBeNull()
  })

  it("announces the match count once the log is exhausted", () => {
    resolvePage(paginatedKey(api.entries.listPage, logRange), {
      page: [
        makeEntry({ _id: "a" as unknown as Id<"timeEntries">, title: "Client call" }),
        makeEntry({ _id: "b" as unknown as Id<"timeEntries">, title: "Client email" }),
        makeEntry({ _id: "c" as unknown as Id<"timeEntries">, title: "Invoicing" }),
      ],
      isDone: true,
    })
    renderTimer()

    fireEvent.change(search(), { target: { value: "client" } })

    // The live region is the same element it was before the keystroke — see
    // filtered-log-status.test.tsx for why that is the whole point.
    expect(screen.getByText("2 entries match these filters.")).toBeTruthy()
  })
})
