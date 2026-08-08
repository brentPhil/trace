import { useRef } from "react"
import type { Popover as BasePopover } from "@base-ui/react/popover"

export type PopoverActionsRef = React.RefObject<BasePopover.Root.Actions | null>

/** Comfortably past the 100ms exit transition every popover in this app uses. */
const SAFETY_MS = 200

/**
 * Base UI leaves a `Popover.Popup` mounted until it OBSERVES the exit CSS
 * transition finish, via a `requestAnimationFrame`-driven watcher
 * (`useAnimationsFinished`) built on a single scheduler shared by every
 * popover on the page. That watcher never settles if the tab loses paint
 * for even one frame right as it arms — confirmed live: with
 * `document.visibilityState` "hidden", the browser simply never delivers
 * the animation frame the scheduler is waiting on, its "already scheduled"
 * flag is never cleared, and from that moment every popover on the page is
 * stuck "open" — mounted forever, no error anywhere, indistinguishable
 * from a bug in the component's own state (which, by then, is already
 * correct: `open` is `false`, `saving` is back to `false`).
 *
 * `actionsRef.unmount()` is Base UI's own documented escape hatch for
 * exactly this — "call this after any externally controlled closing
 * animation finishes." A `setTimeout` well past the transition's 100ms
 * gives the real fade its chance to play normally, then forces the popup
 * closed regardless of whether the animation-frame watcher ever fired.
 * Calling `unmount()` after Base UI already closed the popup on its own is
 * a harmless no-op.
 */
export function forceClosePopover(actionsRef: PopoverActionsRef): void {
  setTimeout(() => actionsRef.current?.unmount(), SAFETY_MS)
}

/** A ref shaped for `Popover.Root`'s `actionsRef` prop. */
export function usePopoverActionsRef(): PopoverActionsRef {
  return useRef<BasePopover.Root.Actions | null>(null)
}
