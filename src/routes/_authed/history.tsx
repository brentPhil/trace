import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { usePaginatedQuery } from "convex/react"
import { AppHeader } from "@/components/app-header"
import { EntryLog } from "@/components/entries/entry-log"
import { FilterBar } from "@/components/history/filter-bar"
import { Button } from "@/components/ui/button"
import { useClassifiers } from "@/hooks/use-classifiers"
import { groupByDay } from "@/lib/group-entries"
import {
  defaultFilters,
  hasClientSideFilter,
  matches,
  rangeOf,
} from "@/lib/history-filters"
import { dayOf } from "@shared/day"
import { formatCompactDuration } from "@shared/duration"
import { api } from "../../../convex/_generated/api"
import type { Filters } from "@/lib/history-filters"

const PAGE_SIZE = 100

export const Route = createFileRoute("/_authed/history")({
  head: () => ({ meta: [{ title: "History — Trace" }] }),
  component: History,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(convexQuery(api.settings.get, {})),
      context.queryClient.ensureQueryData(convexQuery(api.projects.list, {})),
      context.queryClient.ensureQueryData(convexQuery(api.tags.list, {})),
      context.queryClient.ensureQueryData(
        convexQuery(api.auth.getAuthenticatedUser, {})
      ),
    ])
  },
})

function History() {
  const { data: user } = useSuspenseQuery(
    convexQuery(api.auth.getAuthenticatedUser, {})
  )
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const { projects, projectsById } = useClassifiers()

  const today = dayOf(Date.now(), settings.timezone)
  const [filters, setFilters] = useState<Filters>(() =>
    defaultFilters(today, settings.weekStartDay)
  )

  const range = useMemo(
    () => rangeOf(filters, settings.timezone),
    [filters, settings.timezone]
  )

  const { results, status, loadMore } = usePaginatedQuery(
    api.entries.listPage,
    { fromMs: range.fromMs, toMs: range.toMs },
    { initialNumItems: PAGE_SIZE }
  )

  // Exact, and computed by the server over the WHOLE range rather than derived
  // from the pages that happen to be loaded. See entries.rangeSummary.
  const { data: summary } = useSuspenseQuery(
    convexQuery(api.entries.rangeSummary, { fromMs: range.fromMs, toMs: range.toMs })
  )

  /*
   * With a client-side filter active, pull the whole range before drawing any
   * conclusion from it.
   *
   * Text and the preset chips are scans over what has been fetched, so a
   * half-loaded period would silently search a prefix of itself and report a
   * total for it — a number that looks authoritative and is not. The date
   * filter bounds the range, so this terminates. Browsing without a filter
   * still paginates normally.
   */
  const filtering = hasClientSideFilter(filters)
  useEffect(() => {
    if (filtering && status === "CanLoadMore") loadMore(PAGE_SIZE)
  }, [filtering, status, loadMore])

  const filtered = useMemo(() => {
    // Built inside the memo so the dependency list is honest — a `nameOf`
    // declared outside would be a new function every render.
    const nameOf = (id: string | undefined) =>
      id === undefined ? "" : (projectsById.get(id)?.name ?? "")
    return results.filter((entry) => matches(entry, filters, nameOf))
  }, [results, filters, projectsById])

  const groups = useMemo(
    () => groupByDay(filtered, settings.timezone, Date.now()),
    [filtered, settings.timezone]
  )

  const shownMs = filtered.reduce((n, e) => n + (e.durationMs ?? 0), 0)
  const stillLoading = filtering && status === "CanLoadMore"

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-4xl flex-col">
      <AppHeader email={user.email} />

      <div className="flex flex-col gap-3 px-4 py-3">
        <FilterBar
          filters={filters}
          projects={projects}
          today={today}
          weekStartDay={settings.weekStartDay}
          onChange={setFilters}
        />

        {/*
          Totals as a sentence, not a dashboard — and two different sentences,
          because the honest claim genuinely changes. Unfiltered, the server has
          counted the whole range exactly. Filtered, the number describes what
          is on screen, and says so.
        */}
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {stillLoading ? (
            "Loading the rest of this period…"
          ) : filtering ? (
            <>
              <strong className="font-medium tabular text-foreground">
                {formatCompactDuration(shownMs)}
              </strong>{" "}
              across {filtered.length} {filtered.length === 1 ? "entry" : "entries"}{" "}
              matching these filters.
            </>
          ) : (
            <>
              <strong className="font-medium tabular text-foreground">
                {formatCompactDuration(summary.totalMs)}
              </strong>{" "}
              across {summary.count} {summary.count === 1 ? "entry" : "entries"}
              {summary.billableMs > 0 ? (
                <>
                  , of which{" "}
                  <strong className="font-medium tabular text-brass">
                    {formatCompactDuration(summary.billableMs)}
                  </strong>{" "}
                  billable
                </>
              ) : null}
              .
              {summary.truncated ? (
                <span className="text-alarm">
                  {" "}
                  This period is too large to total exactly — narrow the dates.
                </span>
              ) : null}
            </>
          )}
        </p>
      </div>

      <main className="flex-1 border-t border-edge-soft">
        {groups.length === 0 && status !== "LoadingFirstPage" ? (
          <p className="px-4 py-12 text-sm text-muted-foreground">
            Nothing here. Try a wider date range, or clear the filters.
          </p>
        ) : (
          <EntryLog
            groups={groups}
            timeZone={settings.timezone}
            use12Hour={settings.timeFormat === "12"}
          />
        )}

        {/*
          Manual, and only while nothing is filtering. With a filter active the
          effect above is already pulling the whole period, and a competing
          button would invite acting on a half-loaded answer.
        */}
        {!filtering && status === "CanLoadMore" ? (
          <div className="flex justify-center p-4">
            <Button variant="ghost" size="sm" onClick={() => loadMore(PAGE_SIZE)}>
              Load earlier entries
            </Button>
          </div>
        ) : null}
      </main>
    </div>
  )
}
