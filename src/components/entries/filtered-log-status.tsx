import { Button } from "@/components/ui/button"

/** The four states `usePaginatedQuery` can report, spelled out so this file
 * never has to import convex/react to know them. */
export type LogStatus = "LoadingFirstPage" | "LoadingMore" | "CanLoadMore" | "Exhausted"

/**
 * What sits below Timer's log while a client-side filter is active.
 *
 * Timer's range is all of history (`fromMs: 0`), so unlike Reports it cannot
 * pull the rest of the range before drawing a conclusion from a filter — that
 * would mean loading a freelancer's entire history on a keystroke. A filter
 * here can only ever describe the entries paginated in so far, and this is
 * the one place that says so: the caveat renders exactly while that is true
 * (a filter is active and `status` is not yet `"Exhausted"`), and disappears
 * the instant it stops being true, because the result is then complete.
 *
 * Two sentences, not one glossed-over one — "no matches" and "showing matches
 * so far" are different claims, and only one of them is true when
 * `hasResults` is false. Neither ever states a count: the number of matches
 * among a partially-loaded set is exactly the aggregate this file is not
 * allowed to compute. See src/lib/period-totals.ts for why.
 */
export function FilteredLogStatus({
  filtering,
  hasResults,
  status,
  onLoadMore,
}: {
  filtering: boolean
  hasResults: boolean
  status: LogStatus
  onLoadMore: () => void
}) {
  const exhausted = status === "Exhausted"
  const canLoadMore = status === "CanLoadMore"

  return (
    <div className="flex flex-col items-center gap-2 py-4">
      {filtering && !hasResults && status !== "LoadingFirstPage" ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {exhausted
            ? "No entries match these filters."
            : "No matches in the entries loaded so far."}
        </p>
      ) : null}

      {filtering && hasResults && !exhausted ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Showing matches in the entries loaded so far.
        </p>
      ) : null}

      {/*
        Independent of `filtering` — this is how the user widens either an
        unfiltered browse or a filtered search, and it stays a button one
        press away rather than something that vanishes while it is most
        useful.
      */}
      {canLoadMore ? (
        <Button variant="outline" onClick={onLoadMore}>
          Load earlier entries
        </Button>
      ) : null}
    </div>
  )
}
