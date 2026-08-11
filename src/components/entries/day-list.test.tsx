import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { DayList, LogSkeleton } from "@/components/entries/day-list"
import { makeEntry } from "@/test-utils/fixtures"
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

/*
 * How the calendar reaches a row.
 *
 * Clicking a block on the grid switches to List and hands focus to that
 * entry's row, which it finds by `data-entry-id`. Both halves of that are
 * properties of the row and invisible in a screenshot, so this is the only
 * thing that can hold them.
 */
describe("EntryRow — addressable from the calendar", () => {
  const group = {
    day: "2026-08-05",
    label: "Today",
    entries: [makeEntry({ title: "Client call" })],
    notedCount: 0,
    totalMs: 3_600_000,
    billableMs: 0,
    runningCount: 0,
  }

  function renderOneRow() {
    render(
      <DayList
        groups={[group]}
        timeZone="UTC"
        use12Hour
        weekStartDay={1}
        projects={[]}
        tags={[]}
        actions={noActions}
      />
    )
  }

  it("carries the entry's id, so a block on the grid can find its row", () => {
    renderOneRow()
    const row = document.querySelector(`[data-entry-id="${group.entries[0]._id}"]`)
    expect(row).not.toBeNull()
  })

  it("is focusable programmatically without joining the tab order", () => {
    // `tabIndex` is load-bearing at -1: the calendar has to be able to call
    // `.focus()` on this, and at 0 a log of 200 rows would put 200 tab stops
    // between the filter band and anything beneath it.
    renderOneRow()
    const row = document.querySelector<HTMLElement>("[data-entry-id]")
    expect(row).not.toBeNull()
    expect(row!.tabIndex).toBe(-1)

    row!.focus()
    expect(document.activeElement).toBe(row)
  })
})

describe("LogSkeleton", () => {
  /*
   * The two tests that used to sit here could not fail. One asserted that
   * `LogSkeleton` does not contain "Nothing tracked yet." — it renders only
   * `<Skeleton>` divs, so that is true by construction and stays true if the
   * component is deleted. The other asserted that SOME descendant carries
   * `aria-hidden="true"`, which any descendant satisfies. These assert the
   * three properties the component actually has to have.
   */

  it("says out loud that something is loading", () => {
    // The whole thing used to be `aria-hidden`, and it is the ONLY content on
    // screen during the first page load. A screen-reader user got silence
    // where a sighted user gets shimmering bars.
    render(<LogSkeleton />)
    expect(screen.getByRole("status").textContent).toBe("Loading entries…")
  })

  it("hides the decorative bars, and only the bars, from the accessibility tree", () => {
    const { container } = render(<LogSkeleton />)
    const bars = container.querySelectorAll('[data-slot="skeleton"]')
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) expect(bar.closest('[aria-hidden="true"]')).not.toBeNull()
    // …and the announcement is NOT inside that hidden subtree, or it would be
    // just as silent as the bars.
    expect(screen.getByRole("status").closest('[aria-hidden="true"]')).toBeNull()
  })

  it("draws bars that are visible on the ground, and not pill-shaped", () => {
    // `bg-muted` resolves to `--surface`, which is 1.09:1 against the log's
    // ground — invisible, and halved again at the trough of `animate-pulse`.
    // `rounded-2xl` on an `h-4` bar is a full pill, the "rounded-everything"
    // look DESIGN.md rejects by name. Both are properties of the shared
    // primitive, so this is where they get pinned.
    const { container } = render(<LogSkeleton />)
    for (const bar of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(bar.className).toContain("bg-skeleton")
      expect(bar.className).not.toContain("bg-muted")
      expect(bar.className).not.toContain("rounded-2xl")
    }
  })
})
