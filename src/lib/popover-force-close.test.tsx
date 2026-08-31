import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useForceCloseWhenClosed } from "@/lib/popover-force-close"
import type { PopoverActionsRef } from "@/lib/popover-force-close"

/*
 * Base UI's own animated close is not exercised by this suite: jsdom has no
 * `Element.prototype.getAnimations`, so `useAnimationsFinished` takes its
 * synchronous fallback branch and every popover closes immediately in tests,
 * fixed or not — confirmed by running `timer-bar.test.tsx`'s "closes the
 * popover" case against the ORIGINAL, unfixed component: it already passed.
 * The bug that prompted this file is real only in a browser, where the popup's
 * `transition-[opacity,scale] duration-100` never progresses in an
 * unpainted tab, so the `animation.finished` promises Base UI awaits never
 * settle. What IS unit-testable is the guarantee this hook adds on top: given
 * enough time a closed popup gets force-unmounted no matter what Base UI's own
 * watcher does, and — the half the previous fire-and-forget version got wrong
 * — a LIVE, re-opened popup never does.
 */
describe("useForceCloseWhenClosed", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const makeRef = () => {
    const unmount = vi.fn()
    const ref: PopoverActionsRef = { current: { unmount, close: vi.fn() } }
    return { ref, unmount }
  }

  it("force-unmounts shortly after the popover closes", () => {
    const { ref, unmount } = makeRef()
    const view = renderHook(({ open }) => useForceCloseWhenClosed(open, ref), {
      initialProps: { open: true },
    })

    vi.advanceTimersByTime(1_000)
    expect(unmount).not.toHaveBeenCalled()

    view.rerender({ open: false })
    expect(unmount).not.toHaveBeenCalled()

    vi.advanceTimersByTime(200)
    expect(unmount).toHaveBeenCalledTimes(1)
  })

  it("does not force-unmount a popover that was re-opened inside the window", () => {
    // The race the fire-and-forget version could not see. `unmount` resolves to
    // Base UI's `forceUnmount`, which sets `mounted: false` and nulls the
    // active trigger with NO check on `open` — so firing it against a live
    // popup replays the entrance transition against nulled refs.
    const { ref, unmount } = makeRef()
    const view = renderHook(({ open }) => useForceCloseWhenClosed(open, ref), {
      initialProps: { open: true },
    })

    view.rerender({ open: false })
    vi.advanceTimersByTime(50)
    view.rerender({ open: true })

    vi.advanceTimersByTime(1_000)
    expect(unmount).not.toHaveBeenCalled()
  })

  it("cancels the pending force-close when the component goes away", () => {
    const { ref, unmount } = makeRef()
    // Opened first, so there is genuinely a timer in flight to cancel. Starting
    // closed would pass this vacuously now that a never-opened popover arms
    // nothing at all — see the case below.
    const view = renderHook(({ open }) => useForceCloseWhenClosed(open, ref), {
      initialProps: { open: true },
    })

    view.rerender({ open: false })
    view.unmount()
    vi.advanceTimersByTime(1_000)

    expect(unmount).not.toHaveBeenCalled()
  })

  /*
   * `EntryTimePopover` renders once per log row, so keying purely on `open`
   * armed a 200ms timer per row at mount — fifty on a fresh log, fifty more on
   * every "Load earlier entries" — for popups that had never been on screen.
   * Nothing needs forcing out of the DOM before a popup has ever been in it.
   */
  it("arms nothing for a popover that has never been opened", () => {
    const { ref, unmount } = makeRef()
    renderHook(({ open }) => useForceCloseWhenClosed(open, ref), {
      initialProps: { open: false },
    })

    // Several closed re-renders, as a row gets in a real log.
    vi.advanceTimersByTime(1_000)
    expect(unmount).not.toHaveBeenCalled()

    // And it still works the first time it really does open and close.
    const view = renderHook(({ open }) => useForceCloseWhenClosed(open, ref), {
      initialProps: { open: false },
    })
    view.rerender({ open: true })
    view.rerender({ open: false })
    vi.advanceTimersByTime(200)
    expect(unmount).toHaveBeenCalledTimes(1)
  })

  it("does nothing if the popover has already unmounted on its own", () => {
    // Base UI clears the ref to `null` when the underlying `Popover`
    // itself unmounts — its own animation-driven close already succeeded,
    // so there is nothing left to force.
    const ref: PopoverActionsRef = { current: null }

    expect(() => {
      renderHook(() => useForceCloseWhenClosed(false, ref))
      vi.advanceTimersByTime(200)
    }).not.toThrow()
  })
})
