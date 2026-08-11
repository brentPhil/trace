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
export function useHeightVar<THost extends HTMLElement = HTMLDivElement>(
  name: string
) {
  const hostRef = useRef<THost | null>(null)
  /* Concretely a `<div>` rather than a second type parameter. Only the HOST
   * ever varies — `AppShell` measures into `SidebarInset`'s `<main>`, and React
   * refs are invariant, so that one genuinely cannot be widened away. Every
   * measured node is a div, and a parameter with no call site reads as though
   * it had one. */
  const measuredRef = useRef<HTMLDivElement | null>(null)

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
    /*
     * GATED ON CHANGE, because the observer fires on WIDTH too and this hook
     * only ever publishes height.
     *
     * `SidebarInset` is the `flex-1` sibling of a `sidebar-gap` that animates
     * `width` for 200ms on every ⌘B or rail click, so both observed elements
     * are resized ~12 frames per toggle at a byte-identical height. Ungated,
     * each of those frames wrote the property again — and the host is `<main>`
     * or a page root, so the write invalidates the whole subtree beneath it.
     * On /timer that subtree is the log, where every mounted day heading now
     * resolves its `top` from a calc over this value. A compare is the whole
     * fix.
     */
    let published = -1
    const publish = (height: number) => {
      if (height === published) return
      published = height
      host.style.setProperty(name, `${height}px`)
    }

    // One observer covers both kinds of change: the viewport resizing (the bar
    // rewraps) and the content growing (the banner appears).
    //
    // `border-box` because that is the box being published — the bar's own
    // padding changes at `md`, and observing `content-box` while writing
    // `getBoundingClientRect().height` would measure one box and report the
    // other. The entry's own size is read rather than re-measured, so the
    // callback costs no layout.
    //
    // `.at(0)` rather than destructuring the first entry: the DOM types promise
    // an entry is always there, so a `?.` on `entries[0]` is dead code as far
    // as the compiler is concerned and lint says so — while the fallback below
    // exists precisely because a stubbed observer (jsdom) may deliver neither
    // an entry nor a box.
    const observer = new ResizeObserver((entries) => {
      publish(
        entries.at(0)?.borderBoxSize[0]?.blockSize ??
          measured.getBoundingClientRect().height
      )
    })
    // Before observing, so the first paint has a real number rather than the
    // `0px` fallback. `observe()` then delivers its own initial callback, which
    // the gate above collapses to a compare.
    publish(measured.getBoundingClientRect().height)
    observer.observe(measured, { box: "border-box" })
    return () => observer.disconnect()
  }, [name])

  return { hostRef, measuredRef }
}
