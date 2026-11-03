import { entryFilterOf } from "@/lib/history-filters"
import type { Filters } from "@/lib/history-filters"

/**
 * The four filter fields `entries.rangeBreakdown` applies server-side.
 *
 * Exported so the loader, the panel and the tests all mint the SAME query key.
 * A key assembled by hand in a second place is a cache miss that looks like a
 * refetch, and in a test it is a seeded fixture the component never sees.
 *
 * IN LIB, NOT IN THE ROUTE'S OWN FILES, because its two callers sit on opposite
 * sides of the code-split boundary: the loader stays in reports.tsx (the eager
 * route chunk) and the panels live in ./-reports (the split one). Housed with
 * the panels, the loader's import would drag the whole page — charts, log,
 * export menu — back into the eager bundle, which is exactly what the split
 * exists to prevent.
 */
export function breakdownArgs(
  range: { fromMs: number; toMs: number },
  timeZone: string,
  filters: Filters,
  weekStartDay: number,
  /*
   * What only a DOCUMENT reads — each row's notes and each row's entries — and
   * so what only the export asks for, in its own one-shot read at the moment it
   * is pressed (see `ExportMenu`'s `load`).
   *
   * The page's subscription leaves both off. It is re-read on every date change
   * and every reactive update and draws neither, so carrying a range's prose
   * and its every entry there was paying for a document nobody had asked for.
   * The document still comes from ONE scan: its totals, its rows, their notes
   * and their entries all arrive in the same response.
   */
  extras: { withNotes?: boolean; withEntries?: boolean } = {}
) {
  const filter = entryFilterOf(filters)
  return {
    fromMs: range.fromMs,
    toMs: range.toMs,
    timeZone,
    weekStartDay,
    projectId: filter.projectId,
    billableOnly: filter.billableOnly,
    text: filter.text,
    presets: [...filter.presets],
    withNotes: extras.withNotes ?? false,
    withEntries: extras.withEntries ?? false,
  }
}
