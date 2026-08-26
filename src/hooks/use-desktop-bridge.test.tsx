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

afterEach(() => vi.clearAllMocks())

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
