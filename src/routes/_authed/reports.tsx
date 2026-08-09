import { useEffect, useMemo, useRef, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { usePaginatedQuery } from "convex/react"
import { EntryLog } from "@/components/entries/entry-log"
import { LogSkeleton } from "@/components/entries/day-list"
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
import { formatMoney } from "@shared/money"
import { formatTotal } from "@/lib/format-total"
import { cn } from "@/lib/utils"
import { api } from "../../../convex/_generated/api"
import type { Filters } from "@/lib/history-filters"

const PAGE_SIZE = 100

export const Route = createFileRoute("/_authed/reports")({
  head: () => ({ meta: [{ title: "Reports — Trace" }] }),
  component: Reports,
  loader: async ({ context }) => {
    const settings = await context.queryClient.ensureQueryData(
      convexQuery(api.settings.get, {})
    )

    // The component below reads this exact range with `useQuery` for the
    // headline total. Without prefetching it here, the very first paint would
    // sit in the "no data yet" branch of that hook for a round trip AFTER
    // this loader has already resolved — the same reason `/timer`'s loader
    // prefetches its own week range (see timer.tsx).
    const today = dayOf(Date.now(), settings.timezone)
    const range = rangeOf(defaultFilters(today, settings.weekStartDay), settings.timezone)
    await context.queryClient.ensureQueryData(
      convexQuery(api.entries.rangeSummary, { fromMs: range.fromMs, toMs: range.toMs })
    )
  },
})

/** What the sentence below shows before any real summary has ever arrived. */
const EMPTY_SUMMARY = {
  totalMs: 0,
  billableMs: 0,
  count: 0,
  runningCount: 0,
  truncated: false,
  billableCents: 0,
  unratedBillableMs: 0,
}

// A dimmed-but-still-legible affordance for "this is the last thing we knew,
// not the answer to the question just asked" — never colour alone (DESIGN.md),
// paired everywhere it's used with an explicit "Updating…" or `aria-busy`.
// The transition is real motion, so it gets the reduced-motion opt-out every
// animation in this app carries.
const STALE_CLASSES = "opacity-60 transition-opacity duration-150 motion-reduce:transition-none"

export function Reports() {
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
  // A plain string so it can be compared with `===` below — `range` itself is
  // a fresh object every render even when its contents did not change.
  const rangeKey = `${range.fromMs}:${range.toMs}`

  const rawPage = usePaginatedQuery(
    api.entries.listPage,
    { fromMs: range.fromMs, toMs: range.toMs },
    { initialNumItems: PAGE_SIZE }
  )

  /*
   * `usePaginatedQuery` resets `results` to `[]` and `status` to
   * "LoadingFirstPage" the INSTANT its args change — synchronously, before
   * the new first page has round-tripped. Left alone, that is this file's
   * headline bug all over again, one level down: every date-range change
   * would swap the log for `LogSkeleton`, wiping the very rows the user was
   * just reading. There is no `placeholderData` option here the way there is
   * for `rangeSummary` below, so this ref reimplements "keep the previous
   * page on screen while the new one loads" by hand: it remembers the last
   * range that finished loading a first page, and the render below prefers
   * ITS results over the live (possibly just-reset) ones until the new
   * range's first page actually lands — at which point they swap atomically,
   * never through an empty/skeleton state in between.
   */
  const settledPageRef = useRef({ rangeKey, results: rawPage.results })
  if (rawPage.status !== "LoadingFirstPage") {
    settledPageRef.current = { rangeKey, results: rawPage.results }
  }
  const logIsStale = settledPageRef.current.rangeKey !== rangeKey
  const results = logIsStale ? settledPageRef.current.results : rawPage.results
  const { status, loadMore } = rawPage

  /*
   * `useQuery`, not `useSuspenseQuery` — deliberately. `fromMs`/`toMs` are
   * part of the query key, so any filter change that moves the range mints a
   * brand new key with nothing cached for it yet. `useSuspenseQuery` answers
   * that by THROWING, which unmounts this whole component up to the nearest
   * Suspense boundary — FilterBar, the log, everything — and swaps in its
   * fallback. That throw-and-unmount is exactly the "the whole page briefly
   * goes blank" bug reported against this file.
   *
   * `placeholderData: (previous) => previous` (v5's replacement for
   * `keepPreviousData`) keeps the OLD range's summary on screen across the
   * key change instead of discarding it, and `isPlaceholderData` says
   * whether what render sees is that carried-over summary or the new range's
   * own — driving `summaryIsStale` below rather than ever presenting a
   * previous period's total as though it were the answer to the question
   * just asked.
   */
  const { data: summary, isPlaceholderData } = useQuery({
    ...convexQuery(api.entries.rangeSummary, { fromMs: range.fromMs, toMs: range.toMs }),
    placeholderData: (previous) => previous,
  })
  // `summary === undefined` only on a render before ANY summary has ever
  // arrived — the loader above prefetches the default range so this should
  // not happen in practice, but a filter changed before that prefetch landed
  // is still an honest "we don't know yet", not a green light to show zero.
  const summaryIsStale = summary === undefined || isPlaceholderData
  const shownSummary = summary ?? EMPTY_SUMMARY

  /*
   * How much of the billable time `billableCents` could not put a price on —
   * a subset of `billableMs`, over the same rows, from `entries.rangeSummary`.
   *
   * Two flags rather than one because the sentence genuinely branches. With
   * SOME of it unpriced the amount is still right for the part it covers and
   * only needs qualifying; with ALL of it unpriced there is no amount worth
   * printing at all, and "$0.00" would be a confident answer to a question
   * nobody has answered. A rate of zero is priced — pro bono contributes zero
   * cents and zero unrated milliseconds — so this correctly stays false there
   * and `$0.00` still renders, which is the honest figure in that case.
   */
  const unpricedSome = shownSummary.unratedBillableMs > 0
  const unpricedAll =
    unpricedSome && shownSummary.unratedBillableMs >= shownSummary.billableMs

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
   * Reports drops a running entry ENTIRELY — not just its row, its time too.
   *
   * `/timer` keeps the running time in the day total, because "today so far" is
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

  // Covers the plain, unfiltered first fetch too — `stillLoading` above is
  // deliberately scoped to the filtered bulk-load case only (see its own
  // comment), so on its own it says nothing about the ordinary cold load
  // every visit to this page starts from. Without this, `groups` reads as
  // `[]` for that first round trip and the log falls through to the
  // zero-groups branch below, showing Timer's onboarding empty state on the
  // page a freelancer opens to check their invoice numbers.
  //
  // `!logIsStale` matters just as much as `status` does: once a range change
  // has SETTLED results to show (even a previous range's), showing those
  // beats swapping the whole log for a skeleton a second time on the same
  // visit — that skeleton swap is the log's own version of the blank this
  // file exists to avoid.
  const logLoading = (status === "LoadingFirstPage" && !logIsStale) || stillLoading

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
            <span
              aria-busy={logIsStale}
              className={cn("inline", logIsStale && STALE_CLASSES)}
            >
              <strong className="font-medium tabular text-foreground">
                {formatTotal(shownMs, settings.durationDisplay)}
              </strong>{" "}
              across {completed.length} {completed.length === 1 ? "entry" : "entries"}{" "}
              matching these filters.
              {logIsStale ? (
                <span className="italic"> Updating for the new range…</span>
              ) : null}
            </span>
          ) : (
            <span
              aria-busy={summaryIsStale}
              className={cn("inline", summaryIsStale && STALE_CLASSES)}
            >
              <strong className="font-medium tabular text-foreground">
                {formatTotal(shownSummary.totalMs, settings.durationDisplay)}
              </strong>{" "}
              across {shownSummary.count} {shownSummary.count === 1 ? "entry" : "entries"}
              {shownSummary.billableMs > 0 ? (
                <>
                  , of which{" "}
                  {/*
                    NOT `text-brass` — the Two Temperatures Rule reserves brass
                    for money, and this is a duration. `text-foreground`
                    matches the total above it; the strong/tabular weight is
                    what marks it as a figure, not the colour.
                  */}
                  <strong className="font-medium tabular text-foreground">
                    {formatTotal(shownSummary.billableMs, settings.durationDisplay)}
                  </strong>{" "}
                  billable
                  {/*
                    NO AMOUNT AT ALL when nothing here could be priced.

                    `billableCents: 0` has two opposite meanings and only
                    `unratedBillableMs` separates them: work done for free
                    (a rate of zero somebody chose) and work nobody has put a
                    price on yet. Rendering "$0.00" for the second reads as
                    "these eight hours earned nothing" — a confident, wrong
                    figure in the one place a freelancer copies numbers onto an
                    invoice. The qualifying sentence below carries the real
                    answer instead.
                  */}
                  {unpricedAll ? null : (
                    <>
                      {" "}
                      (
                      {/*
                        THE one brass use in the product: money, and nothing
                        else. Rounding rule is stated once, in
                        `entries.rangeSummary` — every rated, billable entry's
                        exact fractional-cent value is summed first and the
                        total rounded to the nearest cent exactly once, so this
                        figure is reproducible by hand from the entries below.
                      */}
                      <strong className="font-medium tabular text-brass">
                        {formatMoney(shownSummary.billableCents, settings.currency)}
                      </strong>
                      )
                    </>
                  )}
                </>
              ) : null}
              .
              {/*
                Said in words, immediately after the amount it qualifies, and
                never folded into it. "$499.20" beside eight billable hours is
                a complete claim as far as the reader is concerned, so the only
                way to stop it being read as one is another sentence — and the
                fix has to be reachable, not just stated, hence the link to the
                one screen where a rate gets set.
              */}
              {unpricedSome ? (
                <>
                  {" "}
                  {unpricedAll ? (
                    "None of it is priced: no hourly rate is set for that work."
                  ) : (
                    <>
                      <strong className="font-medium tabular text-foreground">
                        {formatTotal(
                          shownSummary.unratedBillableMs,
                          settings.durationDisplay
                        )}
                      </strong>{" "}
                      of that is unpriced and is not in the amount above: no
                      hourly rate is set for it.
                    </>
                  )}{" "}
                  <Link to="/projects" className="underline underline-offset-2">
                    Set rates on Projects
                  </Link>
                  .
                </>
              ) : null}
              {/*
                A running entry has no duration to add, so it is excluded and
                said out loud. Folding it in as zero made this figure contradict
                the day header directly beneath it, which counts live elapsed
                time on the client.
              */}
              {shownSummary.runningCount > 0 ? (
                <>
                  {" "}
                  One entry is still running and is not counted.
                </>
              ) : null}
              {shownSummary.truncated ? (
                <span className="text-alarm">
                  {" "}
                  This period is too large to total exactly — the time and the
                  billable amount above are both a floor, not the real total.
                  Narrow the dates.
                </span>
              ) : null}
              {/*
                The figure above is a PREVIOUS range's total the instant this
                is true — see the `useQuery` comment above. Dimming alone is
                not enough (DESIGN.md: meaning never by colour, and opacity is
                easy to miss at a glance on a number nobody is staring at), so
                it is also said outright.
              */}
              {summaryIsStale ? <span className="italic"> Updating…</span> : null}
            </span>
          )}
        </p>
      </div>

      <div
        className={cn("flex-1 border-t border-edge-soft", logIsStale && STALE_CLASSES)}
      >
        {/*
          An onboarding-empty-state flash is the bug this guards against: while
          `logLoading` is true, `groups` is `[]` for reasons that have nothing
          to do with the account being empty, so a skeleton renders instead of
          asking EntryLog to draw any conclusion from an empty array. Once
          loading is settled, a real empty result gets Reports' own sentence —
          passed to `EntryLog` rather than substituted for it, so the log and
          its empty state are always the same component swapping states, not
          two different branches that can drift apart.
        */}
        {logLoading ? (
          <LogSkeleton />
        ) : (
          <EntryLog
            groups={groups}
            timeZone={settings.timezone}
            use12Hour={settings.timeFormat === "12"}
            weekStartDay={settings.weekStartDay}
            display={settings.durationDisplay}
            empty={
              <p className="px-4 py-12 text-sm text-muted-foreground">
                Nothing here. Try a wider date range, or clear the filters.
              </p>
            }
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
      </div>
    </div>
  )
}
