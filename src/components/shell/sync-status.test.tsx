import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SyncStatus } from "./sync-status"

afterEach(cleanup)

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
    vi.useRealTimers()
  })
})
