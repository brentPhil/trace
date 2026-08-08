import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { forceClosePopover } from "@/lib/popover-force-close"
import type { PopoverActionsRef } from "@/lib/popover-force-close"

/*
 * Base UI's own animated close is not exercised by this suite: jsdom has no
 * `Element.prototype.getAnimations`, so `useAnimationsFinished` takes its
 * synchronous fallback branch and every popover closes immediately in tests,
 * fixed or not — confirmed by running `timer-bar.test.tsx`'s "closes the
 * popover" case against the ORIGINAL, unfixed component: it already passed.
 * The bug that prompted this file is real only in a browser, where Base UI's
 * shared `requestAnimationFrame` scheduler can permanently stall if the tab
 * ever loses paint for a single frame at the wrong moment (verified live via
 * `document.visibilityState`). What IS unit-testable is the guarantee this
 * helper adds on top: given enough time, the popup gets force-closed no
 * matter what Base UI's own animation watcher does.
 */
describe("forceClosePopover", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("force-unmounts the popover shortly after being called", () => {
    const unmount = vi.fn()
    const ref: PopoverActionsRef = { current: { unmount, close: vi.fn() } }

    forceClosePopover(ref)
    expect(unmount).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(unmount).toHaveBeenCalledTimes(1)
  })

  it("does nothing if the popover has already unmounted on its own", () => {
    // Base UI clears the ref to `null` when the underlying `Popover.Root`
    // itself unmounts — its own animation-driven close already succeeded,
    // so there is nothing left to force.
    const ref: PopoverActionsRef = { current: null }

    expect(() => {
      forceClosePopover(ref)
      vi.advanceTimersByTime(200)
    }).not.toThrow()
  })
})
