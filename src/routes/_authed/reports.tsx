import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { usePaginatedQuery } from "convex/react"
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
import { formatTotal } from "@/lib/format-total"
import { api } from "../../../convex/_generated/api"
import type { Filters } from "@/lib/history-filters"

const PAGE_SIZE = 100

export const Route = createFileRoute("/_authed/reports")({
  head: () => ({ meta: [{ title: "Reports — Trace" }] }),
  component: Reports,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(convexQuery(api.settings.get, {}))
  },
})

function Reports() {
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

  /*
   * History drops a running entry ENTIRELY — not just its row, its time too.
   *
   * `/today` keeps the running time in the day total, because "today so far" is
   * a live number people watch. Here it would be neither live nor complete:
   * `Date.now()` is not a dependency of this memo, so the elapsed figure freezes
   * at whenever `filtered` last changed, and `entries.rangeSummary` — the
   * sentence underneath these groups — already excludes running entries from
   * its total. Leaving it in meant a day header quietly disagreeing with the
   * summary directly below it, using a stale number, for time that now has no
   * row to explain it.
   *
   * Derived ONCE and used for the rows, the total and the count alike. Filtering
   * only where the rows are built left a running entry counted but not drawn:
   * the sentence claimed a match, the total it was added to gained nothing, and
   * no row appeared to account for either. "1 entry" above an empty list.
   */
  const completed = useMemo(
    () => filtered.filter((entry) => entry.durationMs !== null),
    [filtered]
  )

  const groups = useMemo(
    () => groupByDay(completed, settings.timezone, Date.now()),
    [completed, settings.timezone]
  )

  const shownMs = completed.reduce((n, e) => n + (e.durationMs ?? 0), 0)

  /*
   * "LoadingMore" counts as still loading, not just "CanLoadMore".
   *
   * The auto-loader spends almost all of its time in LoadingMore — CanLoadMore
   * is the instant between two fetches. Checking only the latter meant the
   * partial filtered total was presented as final for essentially the whole
   * bulk load: exactly the half-loaded number this page goes out of its way to
   * avoid reporting.
   */
  const stillLoading =
    filtering && (status === "CanLoadMore" || status === "LoadingMore")

  return (
    <div className="flex flex-col">
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
                {formatTotal(shownMs, settings.durationDisplay)}
              </strong>{" "}
              across {completed.length} {completed.length === 1 ? "entry" : "entries"}{" "}
              matching these filters.
            </>
          ) : (
            <>
              <strong className="font-medium tabular text-foreground">
                {formatTotal(summary.totalMs, settings.durationDisplay)}
              </strong>{" "}
              across {summary.count} {summary.count === 1 ? "entry" : "entries"}
              {summary.billableMs > 0 ? (
                <>
                  , of which{" "}
                  <strong className="font-medium tabular text-brass">
                    {formatTotal(summary.billableMs, settings.durationDisplay)}
                  </strong>{" "}
                  billable
                </>
              ) : null}
              .
              {/*
                A running entry has no duration to add, so it is excluded and
                said out loud. Folding it in as zero made this figure contradict
                the day header directly beneath it, which counts live elapsed
                time on the client.
              */}
              {summary.runningCount > 0 ? (
                <>
                  {" "}
                  One entry is still running and is not counted.
                </>
              ) : null}
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
        {/*
          `stillLoading` is part of this condition because the auto-loader
          starts from an empty filtered set: without it the page told the user
          to widen the range or clear the filters at the exact moment it was
          fetching the pages that would answer them.
        */}
        {groups.length === 0 && status !== "LoadingFirstPage" && !stillLoading ? (
          <p className="px-4 py-12 text-sm text-muted-foreground">
            Nothing here. Try a wider date range, or clear the filters.
          </p>
        ) : (
          <EntryLog
            groups={groups}
            timeZone={settings.timezone}
            use12Hour={settings.timeFormat === "12"}
            display={settings.durationDisplay}
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

