import { isProjectColor } from "@shared/palette"

/**
 * A project's palette hue as a CSS value, for somewhere `--project-color`
 * cannot reach.
 *
 * The log paints a swatch by putting `data-project-color` on the element and
 * letting the rules in src/styles.css resolve `--project-color`. A chart cannot:
 * it paints into SVG, where `fill` resolves against the element being filled and
 * recharts owns those elements. So the hues are also declared as
 * `--project-<name>` variables and this names one — the SAME declaration the
 * attribute rules point at, so a project is one colour everywhere or neither.
 *
 * An unknown key falls back to the same ink-muted the `[data-project-color]`
 * fallback rule uses. A colour that is not in the palette should be
 * unreachable — `convex/lib/palette.ts` is validated on write — but a row
 * written before a hue was retired must still paint as something.
 */
export function projectColorVar(color: string): string {
  return isProjectColor(color) ? `var(--project-${color})` : "var(--muted-foreground)"
}
