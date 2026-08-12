import { useEffect, useMemo, useRef, useState } from "react"
import { Link, createFileRoute } from "@tanstack/react-router"
import { useQuery, useSuspenseQuery } from "@tanstack/react-query"
import { convexQuery } from "@convex-dev/react-query"
import { usePaginatedQuery } from "convex/react"
import { EntryLog } from "@/components/entries/entry-log"
import { LogSkeleton } from "@/components/entries/day-list"
import { FilterBand } from "@/components/history/filter-band"
import { FilterControls } from "@/components/history/filter-controls"
import { PeriodControls } from "@/components/history/period-controls"
import { CreateInvoiceLink } from "@/components/reports/create-invoice-link"
import { ExportMenu } from "@/components/reports/export-menu"
import { SummaryPanel } from "@/components/reports/summary-panel"
import { Page } from "@/components/shell/page"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useClassifiers } from "@/hooks/use-classifiers"
import { useEntryActions } from "@/hooks/use-entry-actions"
import { groupByDay } from "@/lib/group-entries"
import {
  entryFilterOf,
  hasClientSideFilter,
  matches,
  rangeOf,
} from "@/lib/history-filters"
import { reportsDefaultFilters } from "@/lib/date-range-picker"
import { staleProps } from "@/lib/stale"
import {
  exportDisabledReason,
  invoiceDisabledReason,
} from "@/lib/export/export-disabled-reason"
import { invoiceSearchOf } from "@/lib/invoice-search"
import { pageTitle } from "@shared/brand"
import { dayOf } from "@shared/day"
import { billableBucketsOf, invoiceLineDrafts } from "@shared/invoiceLines"
import { unpriced } from "@/lib/format-money"
import { formatMoney } from "@shared/money"
import { formatTotal } from "@/lib/format-total"
import { api } from "../../../convex/_generated/api"
import { EMPTY_BREAKDOWN, EMPTY_TOTALS } from "@/lib/report-series"
import type { Filters } from "@/lib/history-filters"
import type { FunctionReturnType } from "convex/server"

/*
 * Read off the query rather than imported from convex/settings.ts, which is
 * excluded from the root tsconfig (it targets the Convex runtime). Derived
 * either way, so a field added there reaches these panels without an edit.
 */
type Settings = FunctionReturnType<typeof api.settings.get>

const PAGE_SIZE = 100

/**
 * The two views, as data.
 *
 * TABS RATHER THAN TWO ROUTES, so the filter bar above them is one control
 * governing both. A freelancer narrows to a client and a fortnight once, then
 * looks at the shape of it and at the rows behind the shape — making that a
 * second page would mean setting the same filters twice and, worse, would let
 * the two drift apart with nothing on screen to say they had.
 *
 * Summary is the default, matching what the page is opened for: "how did this
 * period go" is answered by the charts, and the rows are what you drop into
 * when one of them looks wrong.
 */
const VIEWS = [
  { value: "summary", label: "Summary" },
  { value: "detailed", label: "Detailed" },
] as const

type View = (typeof VIEWS)[number]["value"]

/**
 * The four filter fields `entries.rangeBreakdown` applies server-side.
 *
 * Exported so the loader, the panel and the tests all mint the SAME query key.
 * A key assembled by hand in a second place is a cache miss that looks like a
 * refetch, and in a test it is a seeded fixture the component never sees.
 */
export function breakdownArgs(
  range: { fromMs: number; toMs: number },
  timeZone: string,
  filters: Filters,
  weekStartDay: number
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
  }
}

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
        breakdownArgs(range, settings.timezone, filters, settings.weekStartDay)
      )
    )
  },
})

/**
 * The shell: one filter bar, one range, two views of it.
 *
 * The panels below own their own queries rather than being handed results,
 * because Base UI unmounts an inactive `TabsContent` — so the tab you are not
 * looking at holds no Convex subscription and costs no reads. Hoisting the
 * fetching here to "share" it would give that back and buy nothing: the two
 * tabs read different shapes.
 */
export function Reports() {
  const { data: settings } = useSuspenseQuery(convexQuery(api.settings.get, {}))
  const { projects } = useClassifiers()

  const today = dayOf(Date.now(), settings.timezone)
  /*
   * THE CURRENT QUARTER, not the current week — see `REPORTS_DEFAULT_PRESET`.
   * A week is the span you check a timer against; a quarter is the one this
   * page's charts, its export and its Create invoice button are for. The rail
   * inside the range picker badges the same preset "Default", off the same
   * constant, so the two cannot drift.
   */
  const [filters, setFilters] = useState<Filters>(() =>
    reportsDefaultFilters(today, settings.weekStartDay)
  )
  const [view, setView] = useState<View>("summary")

  /*
   * The breakdown, read HERE as well as inside SummaryTab.
   *
   * Deliberately the same `breakdownArgs` key, which is why that helper is
   * exported: convexQuery + TanStack Query dedupe an identical key into ONE
   * Convex subscription, so with the Summary tab open this costs no extra
   * reads. With the Detailed tab open it costs one, which is the price of
   * export working from either tab — and exporting only from the tab that
   * happens to be mounted would be a worse answer than a second subscription.
   */
  const range = useMemo(
    () => rangeOf(filters, settings.timezone),
    [filters, settings.timezone]
  )
  const { data: breakdown, isPlaceholderData } = useQuery({
    ...convexQuery(
      api.entries.rangeBreakdown,
      breakdownArgs(range, settings.timezone, filters, settings.weekStartDay)
    ),
    placeholderData: (previous) => previous,
  })

  const exportReason = exportDisabledReason(breakdown, isPlaceholderData)
  /*
   * HOW MANY LINES THIS RANGE WOULD ACTUALLY PRICE, through the shared
   * derivation — the same `billableBucketsOf` + `invoiceLineDrafts` pair
   * /invoices/new previews with and `createFromRange` writes from.
   *
   * Zero means a NUMBERED, permanent, un-deletable $0.00 document, which is why
   * the link has to be disabled here rather than at the far end of it. Counted
   * off THIS page's breakdown, which may have been scanned with the billable
   * chip off — that does not change the answer, because `billableBucketsOf`
   * keeps only buckets with billable time and a bucket's rate is a fact about
   * the project rather than about the scan. What the chip CAN change is
   * `breakdown.count`, which is why `invoiceDisabledReason` checks
   * `billableMs` too.
   */
  const invoiceLineCount = useMemo(
    () =>
      breakdown === undefined
        ? 0
        : invoiceLineDrafts(
            billableBucketsOf(breakdown.projects),
            settings.defaultHourlyRateCents ?? null
          ).length,
    [breakdown, settings.defaultHourlyRateCents]
  )
  /*
   * A SECOND reason, not the same one. The two refuse the same three states in
   * the same priority order — that order lives once, in `rangeBlocker` — and
   * word them differently, because an export of a floor is a wrong report while
   * an invoice raised from one is a client under-billed. The invoice control
   * then refuses one state the export has no analogue for: a range that would
   * price no lines at all.
   *
   * It used to refuse a different fourth state, a view narrowed by anything but
   * its dates. `createFromRange` now takes the filter too, so there is nothing
   * left to refuse there — see `invoiceDisabledReason`.
   */
  const invoiceReason = invoiceDisabledReason(
    breakdown,
    isPlaceholderData,
    invoiceLineCount
  )

  return (
    /*
      The range, the filter over it and the two things you do with the result
      stay on screen while the summary or the rows scroll. A date range you
      cannot see is a date range you have to scroll back up to check before
      believing any figure under it — which is precisely `Page`'s test for
      pinning: a header that stops being TRUE once it leaves the screen.
      `sticky` is opt-in there and argued here for that reason. `Page` (shared
      with /timer) owns how that is done, and what the Detailed tab's day
      headers then stick to.

      The header ENDS in the filter band's own bottom hairline now, where it
      used to end in nothing. That was argued as avoiding two hairlines 12px
      apart, since the tab strip below draws one — but the band's is a
      boundary of a filled strip rather than a spare rule, and the tab strip's
      sits a whole row lower, so the pair brackets the tabs instead of doubling
      up on them. /timer's band closes the same way onto its log.

      `titleHidden`, and the heading is NEW — the same gap and the same answer
      as /timer. This page had no `<h1>` at all, so it offered nothing to a
      screen reader skimming by heading. It stays out of sight because a
      `text-sm` word "Reports" above a date range and two charts labels
      something that has already introduced itself: the heading is here so the
      page has an OUTLINE, not so it has a caption.
    */
    /*
      `Tabs` WRAPS THE PAGE, and `display: contents` is what makes that free.

      The switcher belongs in the header, beside the range it applies to — but
      `TabsList` and `TabsContent` have to share one provider, and the header is
      a PROP of `Page` while the panels are its children. Hoisting the provider
      above `Page` is the only arrangement that puts them in one tree without
      hand-rolling the roving focus and `aria-controls` wiring Base UI already
      does correctly.

      `contents` because this element must not be a box. `Page` measures its own
      header for `--page-header-height` and composes a sticky offset from it; a
      wrapper with a layout box between the route and `Page` is exactly the kind
      of thing that silently changes what gets measured.
    */
    <Tabs
      value={view}
      onValueChange={(value) => setView(value as View)}
      className="contents"
    >
    <Page
      title="Reports"
      titleHidden
      sticky
      header={
        <>
          {/*
            THE PERIOD, AND THE TWO THINGS YOU DO WITH IT — on the page's own
            ground, outside the band, which is where /timer's totals row sits
            for the same reason: this row says what the page IS SHOWING and
            offers the two exports of it, rather than narrowing what is on
            screen. `w-full px-4` is spelt here because it is spelt on every
            row this page draws itself; the band below supplies its own, since
            a full-bleed fill cannot take its gutter from a caller.
          */}
          <div className="flex w-full flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
              {/*
                THE SWITCHER FIRST, THEN THE RANGE — the two halves of one
                question, in the order they are decided. WHICH view you want is
                the coarser choice and the one that changes the whole page;
                WHEN narrows whichever view you landed on. Reading left to
                right, that is "show me the summary — of this quarter", which is
                the sentence a person actually forms.

                It also puts the least volatile control on the left. The range
                pill's width changes with the range it names (`1 Jul – 30 Sep
                2026` against `Today`), so with the pill first the switcher slid
                sideways every time the range changed — a control that moves
                when you change something else is one you have to re-find.

                It sat below the filter band until 2026-08-12, between the band
                and the figures, which put the control that CHOOSES what is on
                screen underneath two rows of the thing it was choosing. At the
                top it is read before what it governs.

                A SEGMENTED GROUP rather than the underline this used to draw.
                Summary and Detailed are alternative views of one thing rather
                than sections of a document, and a filled cell is what that
                reads as; the old rule ran the page's full width and read as a
                section divider, so the tabs looked like a heading above a
                horizon rather than a switch sitting on one. Selection is not
                carried by colour alone — the fill is a fill, and Base UI puts
                `aria-selected` on the trigger regardless.

                `w-fit` so the group is as wide as its two cells. A segmented
                control stretched across a row is a nav bar, not a switch.
              */}
              <TabsList variant="segmented" className="w-fit">
                {VIEWS.map((item) => (
                  <TabsTrigger key={item.value} value={item.value}>
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <PeriodControls
                filters={filters}
                today={today}
                weekStartDay={settings.weekStartDay}
                onChange={setFilters}
              />
            </div>
            {/*
              TWO CONTROLS, side by side, in that order: `[ Create invoice ]
              [ Export ▾ ]`. The spec draws them this way and argues why they are
              not one menu — see `CreateInvoiceButton`. `items-start` because the
              invoice control grows a refusal underneath itself and the Export
              trigger must not follow it down.
            */}
            <div className="flex shrink-0 items-start gap-2">
              {/*
               * THE RANGE AND THE FILTER OVER IT — what this page is showing, not
               * merely when it is showing it. Read through the same
               * `entryFilterOf` that `breakdownArgs` above builds the query key
               * from, so /invoices/new previews and then bills the very filter
               * the figures beside this control were drawn with.
               *
               * `billableOnly` is left behind on purpose, and `invoiceSearchOf`
               * has no slot for it: `createFromRange` hard-codes it true, so a
               * link able to say otherwise could only ever weaken a rule the
               * document depends on.
               */}
              <CreateInvoiceLink
                disabledReason={invoiceReason}
                search={invoiceSearchOf(range, entryFilterOf(filters))}
              />
              <ExportMenu
                breakdown={breakdown ?? EMPTY_BREAKDOWN}
                from={filters.from}
                to={filters.to}
                currency={settings.currency}
                disabledReason={exportReason}
              />
            </div>
          </div>

          {/*
            EVERYTHING THAT CUTS INTO THE PERIOD, in the same band /timer draws
            — the point of the exercise. Both rows narrow what is already
            bounded by the row above, so they belong on one fill together;
            `FilterControls` in particular is the identical component /timer
            renders, and it now sits on the identical Surface.
          */}
          {/*
            `PresetChips` — No project / No note / Under a minute — was the
            second row in here and was removed on 2026-08-12 at the user's
            request. The component itself is DELETED, not merely unrendered: it
            sat in `src/components/history/preset-chips.tsx` with no caller left
            anywhere. It offered three canned filters for hunting anomalies; the
            two that remain in `FilterControls` (project, billable) plus the
            search box are what the page keeps.

            Worth knowing what went with it: those three were the only way to
            ASK for the absences — an entry with no project, an entry with no
            note, an entry under a minute — and `hasClientSideFilter` still
            understands them, so the capability is in the predicate even though
            nothing on screen reaches it now.
          */}
          {/*
            DETAILED ONLY. These three narrow ROWS — a text search over titles
            and notes, a project, a billable mark — and Summary has no rows. It
            answers "where did this range go" with four figures and four charts,
            and a search box over a bar chart is a control offering to do
            something the view cannot show you the result of.

            THE FILTERS STILL APPLY, which is the part that needs saying out
            loud rather than hiding. `breakdownArgs` carries them into the one
            query both tabs read, so a project chosen on Detailed still narrows
            Summary's charts after the switch — correctly, since the two tabs
            are two views of one question, but invisibly once the band is gone.
            A silently-narrowed chart on a billing tool is the same defect class
            as a header total belonging to another range, so when a filter is
            set and the band is not on screen, the page says so instead.
          */}
          {view === "detailed" ? (
            <FilterBand>
              <FilterControls filters={filters} projects={projects} onChange={setFilters} />
            </FilterBand>
          ) : hasClientSideFilter(filters) ? (
            <FilterBand>
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                These figures are narrowed by a filter set on Detailed.
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      projectId: null,
                      billableOnly: false,
                      text: "",
                      presets: [],
                    }))
                  }
                >
                  Clear it
                </Button>
              </p>
            </FilterBand>
          ) : null}
        </>
      }
    >
      <TabsContent value="summary">
        <SummaryTab filters={filters} settings={settings} />
      </TabsContent>
      <TabsContent value="detailed">
        <DetailedTab filters={filters} settings={settings} />
      </TabsContent>
    </Page>
    </Tabs>
  )
}

/**
 * The Summary tab's data, and nothing else — the drawing is `SummaryPanel`.
 *
 * EVERY filter is applied by the server here, including the text box and the
 * preset chips, which the Detailed tab applies on the client. That difference
 * is deliberate and is the reason `convex/lib/entryFilter.ts` exists: a list can
 * say "still loading the rest of this period" and be believed, but a chart
 * cannot — half a period's bars look exactly like a period with less work in
 * it. So the charts are drawn from an exact answer over the whole range or not
 * at all.
 */
function SummaryTab({ filters, settings }: { filters: Filters; settings: Settings }) {
  const range = useMemo(
    () => rangeOf(filters, settings.timezone),
    [filters, settings.timezone]
  )

  /*
   * `useQuery` with `placeholderData`, not `useSuspenseQuery` — the same
   * reasoning as the Detailed tab's summary below. The range is part of the
   * query key, so every date change mints a key with nothing cached for it, and
   * suspending on that unmounts the tab strip and the filter bar along with the
   * charts.
   */
  const { data, isPlaceholderData } = useQuery({
    ...convexQuery(
      api.entries.rangeBreakdown,
      breakdownArgs(range, settings.timezone, filters, settings.weekStartDay)
    ),
    placeholderData: (previous) => previous,
  })

  return (
    <SummaryPanel
      breakdown={data ?? EMPTY_BREAKDOWN}
      from={filters.from}
      to={filters.to}
      display={settings.durationDisplay}
      currency={settings.currency}
      use12Hour={settings.timeFormat === "12"}
      isStale={data === undefined || isPlaceholderData}
    />
  )
}

function DetailedTab({ filters, settings }: { filters: Filters; settings: Settings }) {
  const { projectsById } = useClassifiers()

  /* Reached for here rather than inside `EntryLog`, the same way /timer does
   * it: the hook is the one place an entry changes, and one instance per page
   * is what makes that literally rather than nominally true. */
  const entryActions = useEntryActions(settings.timezone)

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
  /*
   * SEEDED WITH A SENTINEL, not with the current range.
   *
   * `useRef({ rangeKey, results })` on mount claimed the first range had
   * already settled while `status` was `LoadingFirstPage` and `results` was
   * `[]`. Change the range inside that window — the loader prefetches the
   * Summary tab's breakdown but NOT `listPage`, so it is a real window — and
   * the ref then disagreed with `rangeKey`: `logIsStale` true, `logLoading`
   * false, `EntryLog` rendered with zero groups, and "Nothing here. Try a wider
   * date range" appeared over a range that was still loading. `null` can never
   * equal a rangeKey, so nothing is stale until a page has genuinely landed.
   *
   * ON WRITING TO A REF DURING RENDER, which is normally unsafe under
   * concurrent React: what is written here is derived entirely from this
   * render's own inputs and is idempotent, and the `status` guard means a
   * range is only ever marked settled once its page HAS settled — so a
   * discarded render can only write a value a committed render would write
   * too. The alternative, a render-phase `setState`, would have to compare
   * `results` by identity to converge, and `usePaginatedQuery` does not
   * promise a stable one.
   */
  const settledPageRef = useRef<{ rangeKey: string | null; results: typeof rawPage.results }>(
    { rangeKey: null, results: [] }
  )
  if (rawPage.status !== "LoadingFirstPage") {
    settledPageRef.current = { rangeKey, results: rawPage.results }
  }
  // "Stale" means "these are a DIFFERENT range's settled rows", which needs
  // a settled range to be true of. Before the first page of the visit lands
  // there is nothing to carry over and nothing to dim: that is loading, and
  // `logLoading` below is what has to be true then, not this.
  const settledPage = settledPageRef.current
  const logIsStale = settledPage.rangeKey !== null && settledPage.rangeKey !== rangeKey
  const results = logIsStale ? settledPage.results : rawPage.results
  const { status, loadMore } = rawPage

  /*
   * `useQuery`, not `useSuspenseQuery` — deliberately. `fromMs`/`toMs` are
   * part of the query key, so any filter change that moves the range mints a
   * brand new key with nothing cached for it yet. `useSuspenseQuery` answers
   * that by THROWING, which unmounts this whole component up to the nearest
   * Suspense boundary — the filter bar, the log, everything — and swaps in its
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
  /*
   * Before ANY summary has arrived, the sentence says so instead of totalling.
   *
   * That window is real on this tab: the loader prefetches the Summary tab's
   * breakdown and not this, deliberately, so the first visit to Detailed waits
   * a round trip. `EMPTY_SUMMARY` renders "0:00:00 across 0 entries" — dimmed
   * and captioned "Updating…", but still a figure, and a figure of zero is the
   * one wrong answer this page must never give while it has entries. Dimming
   * makes a stale number quieter; it does not make a fabricated one true.
   */
  const summaryUnknown = summary === undefined
  const summaryIsStale = summaryUnknown || isPlaceholderData
  // Never actually read while `summaryUnknown` — the sentence says so instead of
  // totalling — but the JSX below still needs a value of the right shape.
  const shownSummary = summary ?? EMPTY_TOTALS

  /*
   * How much of the billable time `billableCents` could not put a price on —
   * a subset of `billableMs`, over the same rows, from `entries.rangeSummary`.
   *
   * Two flags rather than one because the sentence genuinely branches; the rule
   * itself lives in `unpriced`, which the Summary tab's readout and the project
   * tooltip also call. A rate of zero is priced — pro bono contributes zero
   * cents and zero unrated milliseconds — so both stay false there and `$0.00`
   * still renders, which is the honest figure in that case.
   */
  const { some: unpricedSome, all: unpricedAll } = unpriced(shownSummary)

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
      <div className="w-full px-4 py-3">
        {/*
          Totals as a sentence, not a dashboard — and two different sentences,
          because the honest claim genuinely changes. Unfiltered, the server has
          counted the whole range exactly. Filtered, the number describes what
          is on screen, and says so.
        */}
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {stillLoading ? (
            "Loading the rest of this period…"
          ) : summaryUnknown && !filtering ? (
            "Totalling this period…"
          ) : filtering ? (
            <span {...staleProps(logIsStale, "inline")}>
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
            <span {...staleProps(summaryIsStale, "inline")}>
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
                    "None of it is priced: no rate is set for that work, and no default rate either."
                  ) : (
                    <>
                      <strong className="font-medium tabular text-foreground">
                        {formatTotal(
                          shownSummary.unratedBillableMs,
                          settings.durationDisplay
                        )}
                      </strong>{" "}
                      of that is unpriced and is not in the amount above: no
                      rate is set for it, and no default rate either.
                    </>
                  )}{" "}
                  {/*
                    BOTH places, because there are now two and they answer
                    different questions. A project rate is "this client pays
                    X"; the default is "my rate is X" — and the default is the
                    only one that can reach billable time with no project at
                    all, which is exactly the time this sentence is usually
                    about.
                  */}
                  <Link to="/projects" className="underline underline-offset-2">
                    Set a rate on Projects
                  </Link>
                  , or{" "}
                  <Link to="/settings" className="underline underline-offset-2">
                    a default in Settings
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
                <> One entry is still running and is not counted.</>
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

      {/*
        `aria-busy` as well as the dimming, which `staleProps` is now what
        guarantees. This site is the one that forgot it: the staleness of the
        ROWS — the larger, more consequential half of the page — was signalled
        by opacity alone, which is nothing at all to a screen-reader user
        changing the range.
      */}
      <div {...staleProps(logIsStale, "flex-1 border-t border-edge-soft")}>
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
            actions={entryActions}
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
