import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useDesktopBridge } from "@/hooks/use-desktop-bridge"
import type { Doc } from "../../convex/_generated/dataModel"

const bridge = vi.hoisted(() => ({
  isDesktopShell: vi.fn(() => true),
  pushTimerState: vi.fn(async () => undefined),
  onTrayCommand: vi.fn(async (_handlers: { start: () => void; stop: () => void }) => vi.fn()),
}))
vi.mock("@/lib/desktop-bridge", () => bridge)

// Only `getSkewMs` is mocked because it is the only thing this hook takes from
// the clock module. Mocked rather than driven through `recordServerNow` so the
// skew is an exact number the assertions can name, instead of one derived from
// whatever `Date.now()` said mid-test.
const clock = vi.hoisted(() => ({ getSkewMs: vi.fn(() => 0) }))
vi.mock("@/lib/clock", () => clock)

function runningEntry(overrides: Partial<Doc<"timeEntries">> = {}): Doc<"timeEntries"> {
  return {
    _id: "e1" as Doc<"timeEntries">["_id"],
    _creationTime: 1000,
    userId: "u1",
    clientKey: "k1",
    title: "Deep work",
    startedAt: 1000,
    endedAt: null,
    durationMs: null,
    tagIds: [],
    billable: false,
    source: "web",
    updatedAt: 1000,
    deletedAt: null,
    ...overrides,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  // `clearAllMocks` only forgets the CALLS; a `mockReturnValue` survives it and
  // would leak one test's skew into every test declared after it. `mockReset`
  // puts back the implementation `vi.fn` was constructed with — zero skew.
  clock.getSkewMs.mockReset()
})

describe("useDesktopBridge", () => {
  it("pushes the running state on mount and again when it changes", () => {
    const actions = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) }
    const { rerender } = renderHook(
      ({ running }) => useDesktopBridge(running, actions, vi.fn()),
      { initialProps: { running: null as Doc<"timeEntries"> | null } }
    )
    expect(bridge.pushTimerState).toHaveBeenCalledWith({
      running: false,
      title: "",
      startedAtMs: null,
    })

    rerender({ running: runningEntry() })
    expect(bridge.pushTimerState).toHaveBeenLastCalledWith({
      running: true,
      title: "Deep work",
      startedAtMs: 1000,
    })
  })

  /**
   * The tray clock and the in-page clock have to agree on a drifting machine.
   *
   * `startedAt` is Convex server time; the shell can only read the device
   * clock. The web app already reconciles the two everywhere it paints a
   * duration (`useElapsedMs`, `useTabTitleClock`) by adding the skew to `now`.
   * Pushing the raw server value left the shell doing `local_now - startedAt`
   * with no such correction, so the tray and the timer bar disagreed by the
   * whole skew for the same entry. Subtracting it here is the same correction,
   * moved to the other side of the subtraction — see `ShellTimerState`.
   */
  it("pushes a device-clock start time, not the server's", () => {
    // The device is 90s BEHIND the server, so the server stamps a start 90s
    // later than this machine would have; the tray must be told the earlier,
    // local instant or it would show 90s too little.
    clock.getSkewMs.mockReturnValue(90_000)
    const actions = { start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined) }
    renderHook(() => useDesktopBridge(runningEntry({ startedAt: 5_000_000 }), actions, vi.fn()))

    expect(bridge.pushTimerState).toHaveBeenCalledWith({
      running: true,
      title: "Deep work",
      startedAtMs: 5_000_000 - 90_000,
    })
  })

  it("leaves the start time null when nothing is running, whatever the skew", () => {
    // Guards the obvious wrong shape, `(running?.startedAt ?? 0) - skew`, which
    // would hand the shell a bare negative skew and draw a tray clock counting
    // up from the epoch for a timer that does not exist.
    clock.getSkewMs.mockReturnValue(90_000)
    renderHook(() => useDesktopBridge(null, { start: vi.fn(), stop: vi.fn() }, vi.fn()))

    expect(bridge.pushTimerState).toHaveBeenCalledWith({
      running: false,
      title: "",
      startedAtMs: null,
    })
  })

  it("does nothing outside the shell", () => {
    bridge.isDesktopShell.mockReturnValueOnce(false).mockReturnValueOnce(false)
    renderHook(() => useDesktopBridge(null, { start: vi.fn(), stop: vi.fn() }, vi.fn()))
    expect(bridge.pushTimerState).not.toHaveBeenCalled()
    expect(bridge.onTrayCommand).not.toHaveBeenCalled()
  })

  it("wires tray commands to the actions and reports their failures", async () => {
    const start = vi.fn(async () => undefined)
    const stop = vi.fn(async () => {
      throw new Error("offline")
    })
    const onError = vi.fn()
    renderHook(() => useDesktopBridge(null, { start, stop }, onError))

    // The handlers the hook registered with the bridge:
    const handlers = bridge.onTrayCommand.mock.calls[0][0]
    handlers.start()
    handlers.stop()
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it("unlistens on unmount", async () => {
    const unlisten = vi.fn()
    bridge.onTrayCommand.mockResolvedValueOnce(unlisten)
    const { unmount } = renderHook(() =>
      useDesktopBridge(null, { start: vi.fn(), stop: vi.fn() }, vi.fn())
    )
    await vi.waitFor(() => expect(bridge.onTrayCommand).toHaveBeenCalled())
    unmount()
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalled())
  })
})
