import { useHeightVar } from "@/hooks/use-height-var"
import type { ReactNode } from "react"

/**
 * A page whose own header stays put under the shell's timer bar — and whose
 * log then sticks under both.
 *
 * WHY THIS IS A COMPONENT RATHER THAN A RECIPE. /timer and /reports each spelt
 * out the same four things: the property name to measure into, the
 * host/measured ref pairing, the sticky classes, and the calc that adds the
 * two measured heights. Every one of them fails SILENTLY when it drifts — swap
 * the two refs and the property lands on the wrong element, misspell it and
 * `top` computes to `auto` — so the copy that is one character out does not
 * throw, it just stops sticking. There is no pairing at a call site any more,
 * because there is no call site left to get it wrong in.
 *
 * THE Z-ORDER LADDER, argued once and here. The shell's timer bar is `z-30`,
 * this header is `z-20`, a day header inside the log is `z-10` — the same
 * order as their positions down the screen, so the thing that is higher up is
 * also the thing that passes over. `bg-ground`, opaque: rows scroll UNDER
 * this, and a transparent sticky element is a window onto them.
 *
 * WHY THE SUM IS COMPOSED IN CSS. Both halves are measured (see
 * `use-height-var.ts`, which is the primitive underneath this) and neither is
 * a constant — the bar grows a line while recording, this header rewraps. A
 * calc over two custom properties keeps the total true without anything
 * re-rendering to maintain it. `_+_` is Tailwind's escape for the spaces
 * `calc` requires.
 */
export function PageStickyHeader({
  children,
  header,
}: {
  /**
   * The rest of the page. It is a CHILD rather than a sibling because
   * `--log-sticky-top` is a custom property: it inherits down the tree and
   * never sideways, so the log has to sit inside the element that sets it.
   */
  children: ReactNode
  /** What stays on screen. It is measured, so it may change height freely. */
  header: ReactNode
}) {
  const { hostRef, measuredRef } = useHeightVar("--filter-band-height")

  return (
    <div
      ref={hostRef}
      className="flex flex-col [--log-sticky-top:calc(var(--shell-sticky-top)_+_var(--filter-band-height))]"
    >
      <div ref={measuredRef} className="sticky top-(--shell-sticky-top) z-20 bg-ground">
        {header}
      </div>
      {children}
    </div>
  )
}
