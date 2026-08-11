import { useEffect, useRef } from "react"

/**
 * Publishes one element's measured height as a CSS custom property on an
 * ancestor, so that a SIBLING of it can offset itself by that height.
 *
 * WHY MEASURE RATHER THAN WRITE THE NUMBER DOWN. /timer's sticky top is
 * assembled from two components that cannot see each other: the timer bar
 * belongs to the shell (it is on every page and belongs to none of them), the
 * totals and filter rows belong to the route. Whatever sticks second has to
 * know how tall the thing above it is — and that height is not a constant. The
 * bar grows a second line while recording, `RunawayBanner` adds another once a
 * timer overruns, and both rewrap at narrow widths. A hard-coded offset is
 * correct in exactly one of those states and silently wrong in the rest: the
 * failure is a filter row sliding under the bar, or a gap of ground below it,
 * and neither throws.
 *
 * WHY A CUSTOM PROPERTY ON A HOST, not on the measured node: custom properties
 * inherit DOWN the tree and never sideways, and the element that needs the
 * number is a sibling, not a child.
 *
 * `useEffect`, not `useLayoutEffect`. This tree renders on the server, where
 * `useLayoutEffect` warns; and a sticky offset is never a size input — nothing
 * reserves space for it — so a value that lands one frame late cannot move
 * anything. That is also why there is no load jump: a page opens at scroll 0,
 * where `top` has no effect at all.
 */
export function useHeightVar<
  THost extends HTMLElement = HTMLDivElement,
  TMeasured extends HTMLElement = HTMLDivElement,
>(name: string) {
  const hostRef = useRef<THost | null>(null)
  const measuredRef = useRef<TMeasured | null>(null)

  useEffect(() => {
    const host = hostRef.current
    const measured = measuredRef.current
    if (host === null || measured === null) return

    /*
     * Written imperatively rather than through a `style` prop on purpose.
     * React only ever removes style properties it set on a previous render, so
     * a property it has never heard of survives every re-render — whereas
     * driving this through state would re-render the whole page on every
     * resize tick to move a number that only CSS reads.
     */
    const publish = () => {
      host.style.setProperty(name, `${measured.getBoundingClientRect().height}px`)
    }
    publish()

    // One observer covers both kinds of change: the viewport resizing (the bar
    // rewraps) and the content growing (the banner appears).
    const observer = new ResizeObserver(publish)
    observer.observe(measured)
    return () => observer.disconnect()
  }, [name])

  return { hostRef, measuredRef }
}
