// @vitest-environment jsdom
//
// This file lives under src/lib, which the "unit" vitest project (see
// vitest.config.ts) runs in Node — no DOM globals. isDesktopShell reads
// `window` directly, per its wire contract with the Tauri shell, so this one
// file opts into jsdom rather than the whole module inventing a Node-safe
// window check that nothing else needs.
import { afterEach, describe, expect, it, vi } from "vitest"
import { isDesktopShell, onTrayCommand, pushTimerState } from "@/lib/desktop-bridge"

// vi.mock calls are hoisted above every import by vitest's transform, so
// this reads top-to-bottom (imports, then the mocks they back) without
// changing when `@tauri-apps/api/*` actually gets mocked.
const invoke = vi.fn(async () => undefined)
const listeners = new Map<string, (event: { payload: unknown }) => void>()
const unlisten = vi.fn()
const listen = vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
  listeners.set(name, handler)
  return unlisten
})

vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@tauri-apps/api/event", () => ({ listen }))

function enterShell() {
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
}

afterEach(() => {
  // Undoes stubGlobal("window", undefined) below *before* touching `window`
  // again, so every later test still sees the real jsdom window.
  vi.unstubAllGlobals()
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  listeners.clear()
  vi.clearAllMocks()
})

describe("isDesktopShell", () => {
  it("is false in a plain browser", () => {
    expect(isDesktopShell()).toBe(false)
  })

  it("is true when the Tauri IPC globals are present", () => {
    enterShell()
    expect(isDesktopShell()).toBe(true)
  })

  it("is false during SSR, where window does not exist", () => {
    // The suite otherwise runs under jsdom (enterShell() needs a real
    // `window` to hang the Tauri globals off of), which would leave the
    // `typeof window === "undefined"` branch of isDesktopShell untested by
    // everything else in this file. Stub window away for just this one
    // assertion to prove that branch still short-circuits: if the
    // `typeof window !== "undefined"` guard is ever removed, `"x" in window`
    // throws on the stubbed `undefined` and this test fails.
    vi.stubGlobal("window", undefined)
    expect(isDesktopShell()).toBe(false)
  })
})

describe("pushTimerState", () => {
  it("does nothing outside the shell", async () => {
    await pushTimerState({ running: false, title: "", startedAtMs: null })
    expect(invoke).not.toHaveBeenCalled()
  })

  it("forwards the state to the timer_state command", async () => {
    enterShell()
    await pushTimerState({ running: true, title: "Deep work", startedAtMs: 123 })
    expect(invoke).toHaveBeenCalledWith("timer_state", {
      running: true,
      title: "Deep work",
      startedAtMs: 123,
    })
  })
})

describe("onTrayCommand", () => {
  it("resolves to a no-op outside the shell", async () => {
    const cleanup = await onTrayCommand({ start: vi.fn(), stop: vi.fn() })
    expect(listen).not.toHaveBeenCalled()
    cleanup() // must not throw
  })

  it("routes tray events to the handlers and unlistens on cleanup", async () => {
    enterShell()
    const start = vi.fn()
    const stop = vi.fn()
    const cleanup = await onTrayCommand({ start, stop })

    listeners.get("tray-start")?.({ payload: null })
    listeners.get("tray-stop")?.({ payload: null })
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)

    cleanup()
    expect(unlisten).toHaveBeenCalledTimes(2)
  })
})
