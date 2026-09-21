import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TimerBarFragment } from "./timer-bar"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("TimerBarFragment", () => {
  it("opens at the sample value and advances with the wall clock", () => {
    // A whole second strictly after real now: the store's snapshot (set at
    // module import from real time) is already in the past relative to fake
    // time, the way a remount minutes later would leave it.
    vi.useFakeTimers({ now: Math.floor(Date.now() / 1000) * 1000 + 2000 })
    const { container } = render(<TimerBarFragment />)
    const elapsed = () =>
      container.querySelector("[data-landing-elapsed]")?.textContent

    expect(elapsed()).toBe("1:47:12")

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    expect(elapsed()).toBe("1:47:15")
  })

  it("does not jump after a remount long after the store's snapshot was set", () => {
    vi.useFakeTimers({ now: Math.floor(Date.now() / 1000) * 1000 + 2000 })
    const first = render(<TimerBarFragment />)
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    first.unmount()

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    const second = render(<TimerBarFragment />)
    const elapsed = () =>
      second.container.querySelector("[data-landing-elapsed]")?.textContent

    expect(elapsed()).toBe("1:47:12")

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(elapsed()).toBe("1:47:13")
  })

  it("is an inert illustration", () => {
    const { container } = render(<TimerBarFragment />)
    const root = container.querySelector('[data-landing-fragment="timer"]')
    expect(root?.hasAttribute("inert")).toBe(true)
  })

  it("shows the recording state without relying on colour", () => {
    const { container } = render(<TimerBarFragment />)
    expect(container.textContent).toContain("Harbour Studio")
    expect(container.textContent).toContain("Billable")
    expect(container.querySelector("svg.lucide-square")).not.toBeNull()
  })
})
