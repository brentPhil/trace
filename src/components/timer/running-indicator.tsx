import { cn } from "@/lib/utils"

/**
 * The "something is being tracked" signal.
 *
 * Cold light (`--enlarger`) means running and nothing else in this system — see
 * The Cold Light Rule in DESIGN.md. Reserving one hue for one meaning is what
 * makes a running timer findable in half a second, and it survives peripheral
 * vision, where hue is the first thing the eye loses.
 *
 * But colour is never the only carrier. The dot is accompanied by a visible
 * word at every size above the smallest, and by text for screen readers at all
 * sizes, so the state reads without colour vision and without the dot.
 *
 * No glow, no pulse, no halo — The No Glow Rule. The duration ticking beside it
 * is already the motion on screen, and it is the motion that carries meaning.
 */
export function RunningIndicator({
  showLabel = true,
  className,
}: {
  showLabel?: boolean
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full bg-enlarger"
      />
      <span className={cn("text-enlarger", !showLabel && "sr-only")}>Recording</span>
    </span>
  )
}

/**
 * The idle counterpart. Deliberately a hollow ring rather than a dimmer dot:
 * filled versus hollow is a shape difference, legible without colour.
 */
export function IdleIndicator({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full border border-edge"
      />
      <span className="sr-only">Not tracking</span>
    </span>
  )
}
