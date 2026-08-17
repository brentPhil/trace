/**
 * The Hatch Rule, as Tailwind utilities.
 *
 * Gaps, untracked time, a midnight continuation and an entry missing a note are
 * marked with a TEXTURE, never a colour. Absence is a hatch, not a hue — which
 * is what makes it survive colour blindness and peripheral vision alike, and
 * keeps it an invitation rather than a warning. See DESIGN.md.
 *
 * The dashed border is the load-bearing carrier: in forced-colors mode the UA
 * drops the gradient entirely, and the border is what remains.
 *
 * ONE STRING, IN TYPESCRIPT, rather than a `.hatch-empty` class in styles.css.
 * Three surfaces draw it — the calendar grid, the log's add-note affordance and
 * /reports' legend — and the gradient is long enough that three inline copies
 * would drift. This is still Tailwind: it is what the class attribute would say,
 * named once so `go to definition` reaches it.
 *
 * A NOTE ON WHAT CHANGED WITH THE MOVE. The old class was UNLAYERED, so it
 * outranked every Tailwind utility — `calendar-panel.tsx` had to state its
 * borders per branch because a `border-enlarger` beside `.hatch-empty` would be
 * in the class list and absent from the screen. As utilities it now competes
 * normally, so the class list finally says what renders.
 */
export const HATCH_EMPTY = [
  "border border-dashed border-edge-soft",
  "bg-[image:repeating-linear-gradient(-45deg,color-mix(in_oklch,var(--edge-soft)_55%,transparent)_0_1px,transparent_1px_6px)]",
  "forced-colors:border-current forced-colors:bg-none",
].join(" ")
