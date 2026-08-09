import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { FilteredLogStatus } from "@/components/entries/filtered-log-status"

/*
 * The finding-prone part of Timer's filters: a filtered list here only ever
 * covers what has been paginated in, and that has to be stated in words while
 * it is true and gone the instant it stops being true. These are real
 * assertions on that sentence's presence and absence, not on the component
 * rendering at all.
 */

afterEach(cleanup)

const CAVEAT = "Showing matches in the entries loaded so far."
const NO_MATCHES_YET = "No matches in the entries loaded so far."

/** The one live region. It is always mounted, so this never returns null. */
function region(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[aria-live="polite"]')
  if (el === null) throw new Error("the live region is not mounted")
  return el
}

describe("FilteredLogStatus", () => {
  it("states the caveat when a filter is active and pages remain", () => {
    render(
      <FilteredLogStatus filtering matchCount={3} status="CanLoadMore" onLoadMore={vi.fn()} />
    )
    expect(screen.getByText(CAVEAT)).toBeTruthy()
  })

  it("also states the caveat while a page is actively loading", () => {
    render(
      <FilteredLogStatus filtering matchCount={3} status="LoadingMore" onLoadMore={vi.fn()} />
    )
    expect(screen.getByText(CAVEAT)).toBeTruthy()
  })

  it("removes the caveat once the list is exhausted — the result is then complete", () => {
    render(
      <FilteredLogStatus filtering matchCount={3} status="Exhausted" onLoadMore={vi.fn()} />
    )
    expect(screen.queryByText(CAVEAT)).toBeNull()
  })

  it("never shows the caveat when no filter is active, regardless of status", () => {
    render(
      <FilteredLogStatus
        filtering={false}
        matchCount={3}
        status="CanLoadMore"
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.queryByText(CAVEAT)).toBeNull()
  })

  it("keeps the load-earlier button reachable while filtering", () => {
    render(
      <FilteredLogStatus filtering matchCount={3} status="CanLoadMore" onLoadMore={vi.fn()} />
    )
    expect(screen.getByRole("button", { name: "Load earlier entries" })).toBeTruthy()
  })

  it("hides the button once nothing more can be loaded", () => {
    render(
      <FilteredLogStatus filtering matchCount={3} status="Exhausted" onLoadMore={vi.fn()} />
    )
    expect(screen.queryByRole("button", { name: "Load earlier entries" })).toBeNull()
  })

  it("says so distinctly — not the log's onboarding copy — when a filter matches nothing loaded so far", () => {
    render(
      <FilteredLogStatus filtering matchCount={0} status="CanLoadMore" onLoadMore={vi.fn()} />
    )
    expect(screen.getByText(NO_MATCHES_YET)).toBeTruthy()
  })

  it("states plain non-existence once exhausted and nothing matched", () => {
    render(
      <FilteredLogStatus filtering matchCount={0} status="Exhausted" onLoadMore={vi.fn()} />
    )
    expect(screen.getByText("No entries match these filters.")).toBeTruthy()
    expect(screen.queryByText(NO_MATCHES_YET)).toBeNull()
  })
})

describe("the count", () => {
  /*
   * Reports has always announced a match count on a filter change and Timer
   * never has, sighted or not. The reason was real — a count over a
   * half-loaded set is a floor dressed up as a total — but it only applies
   * while pages remain. Exhausted, every entry that could match has been
   * looked at, and the number is simply true.
   */
  it("states a count once the log is exhausted, where the number is complete", () => {
    render(
      <FilteredLogStatus filtering matchCount={7} status="Exhausted" onLoadMore={vi.fn()} />
    )
    expect(screen.getByText("7 entries match these filters.")).toBeTruthy()
  })

  it("agrees with itself about one", () => {
    render(
      <FilteredLogStatus filtering matchCount={1} status="Exhausted" onLoadMore={vi.fn()} />
    )
    expect(screen.getByText("1 entry matches these filters.")).toBeTruthy()
  })

  it("never states a count while pages remain", () => {
    for (const status of ["CanLoadMore", "LoadingMore"] as const) {
      cleanup()
      render(
        <FilteredLogStatus filtering matchCount={7} status={status} onLoadMore={vi.fn()} />
      )
      expect(region().textContent).toBe(CAVEAT)
      expect(region().textContent).not.toContain("7")
    }
  })
})

describe("the live region", () => {
  /*
   * Every message here used to live in its own conditionally-mounted
   * `<p aria-live>`. A live region inserted into the DOM already holding its
   * text is not reliably announced — screen readers watch a region they
   * already know about for changes — so none of these sentences ever reached
   * anyone using one. The region has to exist, and be quiet, BEFORE the text
   * it will carry does.
   */
  it("is mounted and silent before any filter is applied", () => {
    render(
      <FilteredLogStatus
        filtering={false}
        matchCount={3}
        status="Exhausted"
        onLoadMore={vi.fn()}
      />
    )
    expect(region().textContent).toBe("")
  })

  it("is the SAME element before and after the message appears", () => {
    const { rerender } = render(
      <FilteredLogStatus
        filtering={false}
        matchCount={0}
        status="Exhausted"
        onLoadMore={vi.fn()}
      />
    )
    const before = region()

    rerender(
      <FilteredLogStatus filtering matchCount={0} status="Exhausted" onLoadMore={vi.fn()} />
    )

    // Element identity is the whole assertion. A remounted region with the
    // text already in it is the bug, and it looks identical in a DOM dump.
    expect(region()).toBe(before)
    expect(before.textContent).toBe("No entries match these filters.")
  })

  it("keeps the same element across a change of message", () => {
    const { rerender } = render(
      <FilteredLogStatus filtering matchCount={0} status="CanLoadMore" onLoadMore={vi.fn()} />
    )
    const before = region()
    expect(before.textContent).toBe(NO_MATCHES_YET)

    rerender(
      <FilteredLogStatus filtering matchCount={0} status="Exhausted" onLoadMore={vi.fn()} />
    )
    expect(region()).toBe(before)
    expect(before.textContent).toBe("No entries match these filters.")
  })
})

describe("the dead space under an unfiltered log", () => {
  it("carries no vertical padding when there is nothing to show at all", () => {
    const { container } = render(
      <FilteredLogStatus
        filtering={false}
        matchCount={3}
        status="Exhausted"
        onLoadMore={vi.fn()}
      />
    )
    // The ordinary state of a log somebody is just reading. 32px of empty
    // space used to sit under the last row for it.
    expect(container.firstElementChild?.className).not.toContain("py-4")
  })

  it("still pads itself once it has something to show", () => {
    const { container } = render(
      <FilteredLogStatus
        filtering={false}
        matchCount={3}
        status="CanLoadMore"
        onLoadMore={vi.fn()}
      />
    )
    expect(container.firstElementChild?.className).toContain("py-4")
  })
})
