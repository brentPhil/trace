import { useEffect, useRef } from "react"
import type { Popover as BasePopover } from "@base-ui/react/popover"

export type PopoverActionsRef = React.RefObject<BasePopover.Root.Actions | null>

/** Comfortably past the 100ms exit transition every popover in this app uses. */
const SAFETY_MS = 200

/**
 * Forces a closed `Popover.Popup` to actually leave the DOM.
 *
 * WHY IT CAN GET STUCK. Base UI keeps the popup mounted until it OBSERVES the
 * exit animation finish. `useOpenChangeComplete` delegates to
 * `useAnimationsFinished`, which awaits
 * `Promise.all(element.getAnimations().map(a => a.finished))` — and our popup
 * carries `transition-[opacity,transform] duration-100` (see
 * `components/ui/popover.tsx`). A CSS TRANSITION does not progress in a tab
 * that is not being painted, so in a hidden tab those promises simply never
 * settle, `onOpenChangeComplete` never fires, and the popup stays mounted
 * indefinitely while the component's own state is already correct (`open` is
 * `false`, `saving` is back to `false`). Nothing errors; it is
 * indistinguishable from a bug in this file.
 *
 * WHAT THIS FILE USED TO CLAIM, AND WHY IT WAS WRONG. The previous comment
 * blamed the `requestAnimationFrame` scheduler in `@base-ui/utils`
 * (`useAnimationFrame.js`) for leaving its `isScheduled` flag set when a frame
 * is never delivered. That scheduler is real and process-global, but a rAF
 * requested while a tab is hidden is DEFERRED, not dropped: the next painted
 * frame runs `tick()`, which clears `isScheduled` before invoking anything. It
 * self-heals, which does not match "mounted forever". The transition above
 * does not self-heal, which does. The fix below is the same either way —
 * `setTimeout` fires in a hidden tab — but the next person to read this will
 * act on the diagnosis, so it needs to be the right one.
 *
 * `actionsRef.unmount()` is Base UI's own documented escape hatch: "call this
 * after any externally controlled closing animation finishes." It resolves to
 * `forceUnmount` in `@base-ui/react/utils/popups/popupStoreUtils.js`, which
 * calls `setMounted(false)` and nulls `activeTriggerId`/`activeTriggerElement`
 * WITH NO CHECK ON `open` — verified against the installed 1.7.0. That is why
 * this is an effect keyed on `open` rather than a bare `setTimeout` fired at
 * the moment something closes:
 *
 *   - Re-opening inside the 200ms window (pick a day, then immediately click
 *     the trigger again — easy) used to leave a stale timeout armed against a
 *     live, OPEN popup. `useTransitionStatus` would restore `mounted: true`
 *     and re-run the entrance transition while the trigger and focus-return
 *     refs had just been nulled underneath it. The cleanup below cancels it.
 *   - The timer was never cleared, on unmount or otherwise.
 *   - It was called from exactly two programmatic close paths. If the stall is
 *     real it applies just as much to Escape, an outside click and the Close
 *     button, none of which went anywhere near this helper. Driving off `open`
 *     covers every way a popover can close, including ones not written yet.
 */
export function useForceCloseWhenClosed(
  open: boolean,
  actionsRef: PopoverActionsRef
): void {
  useEffect(() => {
    // Nothing to force while it is meant to be on screen. Returning early here
    // is also what makes re-opening cancel a pending force-close, via this
    // effect re-running and disposing the previous timer.
    if (open) return undefined
    const id = setTimeout(() => actionsRef.current?.unmount(), SAFETY_MS)
    return () => clearTimeout(id)
  }, [open, actionsRef])
}

/** A ref shaped for `Popover.Root`'s `actionsRef` prop. */
export function usePopoverActionsRef(): PopoverActionsRef {
  return useRef<BasePopover.Root.Actions | null>(null)
}
