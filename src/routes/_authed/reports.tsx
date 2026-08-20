import { createFileRoute } from "@tanstack/react-router"
import { convexQuery } from "@convex-dev/react-query"
import { breakdownArgs } from "@/lib/breakdown-args"
import { rangeOf } from "@/lib/history-filters"
import { reportsDefaultFilters } from "@/lib/date-range-picker"
import { pageTitle } from "@shared/brand"
import { dayOf } from "@shared/day"
import { api } from "../../../convex/_generated/api"
import { Reports } from "./-reports"

/*
 * The page itself is in ./-reports — see that file's header. The route file
 * holds the definition and the loader, so `component:` is an import from a
 * non-route file and the code-splitter can do its job. The loader builds its
 * query key with the same `breakdownArgs` the panels use, imported from
 * @/lib/breakdown-args rather than from ./-reports: a static import of the
 * page here would pull the whole split chunk back into the eager bundle.
 */
export const Route = createFileRoute("/_authed/reports")({
  head: () => ({ meta: [{ title: pageTitle("Reports") }] }),
  component: Reports,
  loader: async ({ context }) => {
    const settings = await context.queryClient.ensureQueryData(
      convexQuery(api.settings.get, {})
    )

    /*
     * The DEFAULT TAB's data, and only it.
     *
     * Without this the first paint would sit in the "no data yet" branch for a
     * round trip AFTER this loader has already resolved — the same reason
     * /timer's loader prefetches its own week range. Detailed's `rangeSummary`
     * is deliberately NOT prefetched: it is a second scan of the same range for
     * a tab the user may never open, and opening that tab is a deliberate act
     * with an honest "Updating…" already wired up for it.
     */
    const today = dayOf(Date.now(), settings.timezone)
    const filters = reportsDefaultFilters(today, settings.weekStartDay)
    const range = rangeOf(filters, settings.timezone)
    await context.queryClient.ensureQueryData(
      convexQuery(
        api.entries.rangeBreakdown,
        breakdownArgs(
          range,
          settings.timezone,
          filters,
          settings.weekStartDay,
          settings.pdfIncludeNotes
        )
      )
    )
  },
})
