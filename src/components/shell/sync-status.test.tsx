import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SyncStatus } from "./sync-status"

afterEach(cleanup)
afterEach(() => vi.useRealTimers())

describe("SyncStatus", () => {
  it("renders nothing when online with nothing pending", () => {
    const { container } = render(<SyncStatus offline={false} pending={0} />)
    expect(container.innerHTML).toBe("")
  })

  it("says offline and how many changes are waiting", () => {
    render(<SyncStatus offline pending={3} />)
    expect(screen.getByRole("status").textContent).toBe("Offline. 3 changes will sync when you're back.")
  })

  it("says syncing while online with pending changes", () => {
    render(<SyncStatus offline={false} pending={1} />)
    expect(screen.getByRole("status").textContent).toBe("Syncing 1 change…")
  })

  it("confirms briefly once the count returns to zero", () => {
    vi.useFakeTimers()
    const { rerender, container } = render(<SyncStatus offline={false} pending={2} />)
    rerender(<SyncStatus offline={false} pending={0} />)
    expect(screen.getByRole("status").textContent).toBe("All changes saved.")
    act(() => {
      vi.advanceTimersByTime(2_100)
    })
    expect(container.innerHTML).toBe("")
  })

  it("does not pin the confirmation when the socket blips mid-window", () => {
    // The timer used to be armed inside the effect that watches `offline`,
    // so an offline flip cleared it and the re-run never re-armed —
    // "All changes saved." then stayed on the shell indefinitely.
    vi.useFakeTimers()
    const { rerender, container } = render(<SyncStatus offline={false} pending={2} />)
    rerender(<SyncStatus offline={false} pending={0} />)
    rerender(<SyncStatus offline pending={0} />)
    rerender(<SyncStatus offline={false} pending={0} />)
    act(() => {
      vi.advanceTimersByTime(2_100)
    })
    expect(container.innerHTML).toBe("")
  })
})
