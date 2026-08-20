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
   * Whether this page's breakdown should also carry each row's entry notes.
   *
   * Driven by `settings.pdfIncludeNotes`, and therefore part of the QUERY KEY:
   * a user who turns notes on gets a refetch of the range they are looking at,
   * once, and every export from then on has the prose it needs. Threading it
   * here rather than fetching notes separately at export time is what keeps the
   * document built from the SAME scan the charts above it were drawn from —
   * a second query could disagree with the page it was exported from.
   *
   * Defaults to off so a caller that has no opinion mints the cheap key. Every
   * production call site DOES have one — the loader awaits `settings.get`
   * before it builds its key, and both panels read the same settings object —
   * so the default is really only reached by tests that do not care about
   * notes.
   */
  withNotes = false
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
    withNotes,
  }
}
