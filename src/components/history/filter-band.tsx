import type { ReactNode } from "react"

/**
 * The strip a page's filters sit in: full-bleed Surface, a hairline above and
 * below, and the page's own gutter on the controls inside it.
 *
 * WHY IT IS A COMPONENT AND NOT A CLASS STRING. /timer spelt this band out
 * inline and /reports drew its filters straight onto ground, so the very same
 * `FilterControls` sat on two different fills on two pages that are otherwise
 * built the same way. The COMPONENTS were already shared; the chrome around
 * them was not, and chrome that is copied is chrome that drifts — copying it to
 * a second page is precisely what produced the inconsistency. There is one
 * declaration now, and both pages render it, so the next change lands on both
 * or on neither.
 *
 * THE TOKENS. `bg-surface` steps the ramp and `border-y border-edge-soft` adds
 * an edge — the Tonal Depth Rule asks for either, and this band deliberately
 * does both, which is what /timer's version already did. The step from ground
 * to surface is one warm rung and is meant to be quiet; the hairlines are what
 * keep the strip's two boundaries unambiguous while rows scroll UNDER it, where
 * the fill below the band is an entry row's rather than ground. `edge-soft` is
 * correct for those hairlines because they separate passive content and carry
 * no contrast minimum. The CONTROLS inside are a different question and the
 * Adjacent Colour Rule is theirs to answer: on this fill `--edge` measures
 * 2.90:1, so anything fill-less in here needs `--edge-raised` — see
 * `filter-controls.tsx`, which uses it for the chips and keeps `--edge` only on
 * the two controls that carry their own `bg-ground`.
 *
 * THE GUTTER, against DESIGN.md's "never inside a reusable component". That
 * rule is about a component carrying its CALLER's gutter and forcing the next
 * caller to compensate. Here the full bleed and the gutter are one decision,
 * not two: the fill has to run edge to edge like a day header, while the search
 * box has to start on the same pixel as the entry titles below it and the
 * totals above it — so there is no arrangement where the caller supplies the
 * inset without this component supplying the strip. `children` is handed the
 * gutter already applied, and every caller is a `Page` header, whose slot is
 * documented as full-bleed for exactly this. Nothing compensates for anything.
 */
export function FilterBand({ children }: { children: ReactNode }) {
  return (
    <div className="border-y border-edge-soft bg-surface py-2.5">
      <div className="w-full px-4">{children}</div>
    </div>
  )
}
