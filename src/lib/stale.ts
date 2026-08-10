import { cn } from "@/lib/utils"

/**
 * "This is the last thing we knew, not the answer to the question just asked."
 *
 * A dimmed-but-still-legible affordance — never colour alone (DESIGN.md) — and
 * the transition is real motion, so it carries the `prefers-reduced-motion`
 * opt-out every animation in this app does.
 */
const STALE_CLASSES =
  "opacity-60 transition-opacity duration-150 motion-reduce:transition-none"

/**
 * The dimming AND its `aria-busy`, as one thing that cannot be half-applied.
 *
 * The rule was once stated in prose and applied by hand at three sites, and one
 * of the three forgot the ARIA half — the log was dimmed by opacity alone,
 * signalling nothing whatsoever to a screen-reader user changing the date
 * range. Spreading this makes the dimming unreachable without the half that
 * carries it to everybody else.
 *
 * It lives here rather than in a route file because BOTH Reports tabs need it:
 * the Detailed log and the Summary charts each carry a previous range's answer
 * across a refetch, and a second copy is how one of them loses the ARIA again.
 *
 * `className` is the site's OWN classes; the stale ones compose on top, because
 * every caller has layout classes of its own.
 */
export function staleProps(isStale: boolean, className?: string) {
  return {
    "aria-busy": isStale,
    className: cn(className, isStale && STALE_CLASSES),
  }
}
