import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { DayList, LogSkeleton } from "@/components/entries/day-list"
import type { EntryRowActions } from "@/components/entries/entry-row"

/*
 * The regression this guards: `/reports` used to fall through to Timer's
 * onboarding copy ("Nothing tracked yet…") for the entire first page load,
 * because `usePaginatedQuery` reports `groups.length === 0` for exactly the
 * same shape of empty array a genuinely empty account produces. `DayList`
 * cannot itself know whether zero groups means "still loading" or "actually
 * empty" — that is the caller's call to make, via `empty` — so these tests
 * pin down the two building blocks a caller needs to make it: an overridable
 * empty state, and a loading placeholder that can never be confused with it.
 */

const noActions = {} as EntryRowActions

afterEach(cleanup)

describe("DayList empty state", () => {
  it("falls back to the Timer onboarding copy when no empty state is supplied", () => {
    render(
      <DayList
        groups={[]}
        timeZone="UTC"
        use12Hour
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={noActions}
      />
    )
    expect(screen.getByText("Nothing tracked yet.")).toBeTruthy()
  })

  it("renders the caller's own empty state instead, when one is given", () => {
    render(
      <DayList
        groups={[]}
        timeZone="UTC"
        use12Hour
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={noActions}
        empty={<p>Nothing here. Try a wider date range, or clear the filters.</p>}
      />
    )
    expect(
      screen.getByText("Nothing here. Try a wider date range, or clear the filters.")
    ).toBeTruthy()
    // The onboarding copy must not also be present underneath it — a caller
    // supplying its own empty state expects it to REPLACE the default, not
    // sit alongside it.
    expect(screen.queryByText("Nothing tracked yet.")).toBeNull()
  })

  /*
   * `empty ?? <EmptyLog/>` made "render nothing" inexpressible: `null` is the
   * obvious way to ask for it and fell straight back to the onboarding copy.
   * Timer's answer was to stop rendering `EntryLog` at all while a filter
   * matched nothing — which took `NoteSheet` and every held note draft down
   * with it on a keystroke. This is the API that lets it keep the log mounted.
   */
  it("renders nothing at all when the caller explicitly passes null", () => {
    const { container } = render(
      <DayList
        groups={[]}
        timeZone="UTC"
        use12Hour
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={noActions}
        empty={null}
      />
    )
    expect(screen.queryByText("Nothing tracked yet.")).toBeNull()
    expect(container.textContent).toBe("")
  })

  it("never shows any empty state — onboarding or custom — once groups arrive", () => {
    const groups = [
      {
        day: "2026-08-09",
        label: "Today",
        entries: [],
        notedCount: 0,
        totalMs: 0,
        billableMs: 0,
        runningCount: 0,
      },
    ]
    render(
      <DayList
        groups={groups}
        timeZone="UTC"
        use12Hour
        weekStartDay={0}
        projects={[]}
        tags={[]}
        actions={noActions}
        empty={<p>Nothing here.</p>}
      />
    )
    expect(screen.queryByText("Nothing tracked yet.")).toBeNull()
    expect(screen.queryByText("Nothing here.")).toBeNull()
    expect(screen.getByText("Today")).toBeTruthy()
  })
})

describe("LogSkeleton", () => {
  it("is distinct from the empty state — it never contains the onboarding sentence", () => {
    // This is the property the fix actually depends on: whatever `status ===
    // "LoadingFirstPage"` renders instead of the log must be textually
    // impossible to mistake for "the account is empty".
    render(<LogSkeleton />)
    expect(screen.queryByText("Nothing tracked yet.")).toBeNull()
    expect(screen.queryByText(/Nothing here/)).toBeNull()
  })

  it("is presentational only, hidden from the accessibility tree", () => {
    const { container } = render(<LogSkeleton />)
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })
})
