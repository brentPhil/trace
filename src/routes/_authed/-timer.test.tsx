import { useEffect } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Timer } from "@/routes/_authed/timer"
import {
  convexKey,
  paginatedKey,
  resetPaginatedStore,
  resolvePage,
} from "@/test-utils/convex-query"
import { expectFilterControlsInBand } from "@/test-utils/filter-band"
import { NOW, SETTINGS, makeEntry } from "@/test-utils/fixtures"
import { expectPageHeading } from "@/test-utils/page-heading"
import { dayOf, dayWindow, weekWindow } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import type { Id } from "../../../convex/_generated/dataModel"
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
 * assertion about nothing — and it would never fire `datesSet`, which is what
 * the panel's own 14 tests exercise (`calendar-panel.test.tsx`). What this file
 * is for is the branch around it: which view is on screen, and what the filter
 * band does across the switch.
 */
vi.mock("@/components/calendar/calendar-panel", () => ({
  CalendarPanel: () => <div data-testid="calendar-panel" />,
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
  dateSpy = vi.spyOn(Date, "now").mockReturnValue(NOW)
})

afterEach(() => {
  cleanup()
  dateSpy?.mockRestore()
})

const today = dayOf(NOW, SETTINGS.timezone)
const week = weekWindow(today, SETTINGS.timezone, SETTINGS.weekStartDay)
const logRange = { fromMs: 0, toMs: dayWindow(today, SETTINGS.timezone).toMs }

/** Everything Timer reads with `useSuspenseQuery`, so it never suspends. */
function renderTimer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(convexKey(api.settings.get, {}), SETTINGS)
  queryClient.setQueryData(convexKey(api.projects.list, {}), [])
  queryClient.setQueryData(convexKey(api.tags.list, {}), [])
  queryClient.setQueryData(
    convexKey(api.entries.listRange, { fromMs: week.fromMs, toMs: week.toMs }),
    []
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <Timer />
    </QueryClientProvider>
  )
}

const search = () =>
  screen.getByPlaceholderText<HTMLInputElement>("Search titles, notes and projects")

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
    // opens on this week and one step back leaves it.
    expect(screen.getByText("This week · 3–9 Aug")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }))

    expect(screen.getByText("27 Jul – 2 Aug")).toBeTruthy()
    expect(screen.queryByText("This week · 3–9 Aug")).toBeNull()
  })

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
