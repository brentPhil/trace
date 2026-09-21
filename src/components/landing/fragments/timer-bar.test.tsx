import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TimerBarFragment } from "./timer-bar"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("TimerBarFragment", () => {
  it("opens at the sample value and advances with the wall clock", () => {
    vi.useFakeTimers()
    const { container } = render(<TimerBarFragment />)
    const elapsed = () =>
      container.querySelector("[data-landing-elapsed]")?.textContent

    expect(elapsed()).toBe("1:47:12")

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    // The clock store aligns to wall-clock second boundaries, so the exact
    // figure depends on where in the second the test started. It must have
    // moved, and by seconds, not minutes.
    expect(elapsed()).not.toBe("1:47:12")
    expect(elapsed()).toMatch(/^1:47:1[3-9]$/)
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
