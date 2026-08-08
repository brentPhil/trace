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

describe("FilteredLogStatus", () => {
  it("states the caveat when a filter is active and pages remain", () => {
    render(
      <FilteredLogStatus
        filtering
        hasResults
        status="CanLoadMore"
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText(CAVEAT)).toBeTruthy()
  })

  it("also states the caveat while a page is actively loading", () => {
    render(
      <FilteredLogStatus
        filtering
        hasResults
        status="LoadingMore"
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText(CAVEAT)).toBeTruthy()
  })

  it("removes the caveat once the list is exhausted — the result is then complete", () => {
    render(
      <FilteredLogStatus
        filtering
        hasResults
        status="Exhausted"
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.queryByText(CAVEAT)).toBeNull()
  })

  it("never shows the caveat when no filter is active, regardless of status", () => {
    render(
      <FilteredLogStatus
        filtering={false}
        hasResults
        status="CanLoadMore"
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.queryByText(CAVEAT)).toBeNull()
  })

  it("keeps the load-earlier button reachable while filtering", () => {
    render(
      <FilteredLogStatus
        filtering
        hasResults
        status="CanLoadMore"
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByRole("button", { name: "Load earlier entries" })).toBeTruthy()
  })

  it("hides the button once nothing more can be loaded", () => {
    render(
      <FilteredLogStatus
        filtering
        hasResults
        status="Exhausted"
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.queryByRole("button", { name: "Load earlier entries" })).toBeNull()
  })

  it("says so distinctly — not the log's onboarding copy — when a filter matches nothing loaded so far", () => {
    render(
      <FilteredLogStatus
        filtering
        hasResults={false}
        status="CanLoadMore"
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText(NO_MATCHES_YET)).toBeTruthy()
  })

  it("states plain non-existence once exhausted and nothing matched", () => {
    render(
      <FilteredLogStatus
        filtering
        hasResults={false}
        status="Exhausted"
        onLoadMore={vi.fn()}
      />
    )
    expect(screen.getByText("No entries match these filters.")).toBeTruthy()
    expect(screen.queryByText(NO_MATCHES_YET)).toBeNull()
  })
})
