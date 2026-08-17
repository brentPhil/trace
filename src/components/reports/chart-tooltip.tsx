import { Swatch } from "@/components/reports/chart-frame"
import { cn } from "@/lib/utils"

/**
 * The tooltip every chart on the Summary tab uses.
 *
 * NOT shadcn's `ChartTooltipContent`. That renders a value with
 * `Number.toLocaleString()`, which turns a duration in milliseconds into
 * "28,800,000" — every figure in this product is a duration or an amount, and
 * neither survives that. It is also where the Tabular Rule and the Two
 * Temperatures Rule have to be applied, and applying them by passing a
 * `formatter` at four call sites is four chances to forget one.
 */

export type TooltipRow = {
  label: string
  value: string
  /**
   * A currency amount, and the ONLY thing that may be brass (DESIGN.md, The Two
   * Temperatures Rule). A billable DURATION is not money — it is time that will
   * become money — so it renders in ink like every other duration.
   */
  money?: boolean
  /** A swatch tying the row to its series, when the chart has more than one. */
  swatch?: string
}

export function TooltipCard({
  heading,
  rows,
  footnote,
}: {
  heading: string
  rows: Array<TooltipRow>
  footnote?: string
}) {
  return (
    <div className="grid min-w-44 gap-1.5 rounded-md border border-edge-soft bg-surface-raised px-2.5 py-2 text-xs">
      <div className="font-medium">{heading}</div>
      <div className="grid gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {row.swatch === undefined ? null : (
                <Swatch color={row.swatch} className="size-2" />
              )}
              {row.label}
            </span>
            <span
              className={cn("font-mono tabular-nums tracking-[-0.02em] font-medium", row.money ? "text-brass" : undefined)}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {footnote === undefined ? null : (
        <p className="text-muted-foreground">{footnote}</p>
      )}
    </div>
  )
}

/**
 * The datum under the cursor, or null when there is nothing to show.
 *
 * Recharts hands a tooltip's `content` an array of one entry PER SERIES, each
 * carrying the whole row under `.payload`. Every chart here wants the row, not
 * the series — the tooltip states the day's whole story, not just the segment
 * the pointer happens to be over — so this unwraps it once instead of at four
 * call sites.
 *
 * It takes `active` as well, because recharts renders `content` with `active`
 * undefined and the `active !== true` guard was otherwise restated at all four
 * of those sites — a convention a fifth chart could only get right by copying.
 */
export function hoveredRow<T>(
  active: boolean | undefined,
  payload: unknown
): T | null {
  if (active !== true) return null
  if (!Array.isArray(payload) || payload.length === 0) return null
  const first: unknown = payload[0]
  if (typeof first !== "object" || first === null || !("payload" in first)) return null
  return (first as { payload: T }).payload
}

/** The hover highlight behind a bar. `--muted` resolves to the panel's own fill. */
export const BAR_CURSOR = { fill: "var(--surface-raised)" } as const
