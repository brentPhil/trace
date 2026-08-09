import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
 * WHEN A COUNT IS ALLOWED, AND WHEN IT IS NOT. Exactly one state can state a
 * number: `Exhausted`, where every entry that could match has been looked at.
 * Everywhere else the count of matches among a partially-loaded set is the
 * aggregate this file is specifically not allowed to compute — it would look
 * authoritative and be a floor. See src/lib/period-totals.ts. That is also why
 * the two zero-match sentences are different sentences: "no matches" and "no
 * matches YET" are different claims, and only one of them is true when pages
 * remain.
 */
export function FilteredLogStatus({
  filtering,
  matchCount,
  status,
  onLoadMore,
}: {
  filtering: boolean
  /**
   * How many entries the log is actually DRAWING, not how many groups it made.
   * Only ever read when `status` is `"Exhausted"` — see above.
   */
  matchCount: number
  status: LogStatus
  onLoadMore: () => void
}) {
  const exhausted = status === "Exhausted"
  const canLoadMore = status === "CanLoadMore"

  /*
   * ONE string, computed before render, rather than three conditionally
   * mounted `<p aria-live>` elements.
   *
   * A live region that is inserted into the DOM already containing its text is
   * not reliably announced — NVDA, JAWS and VoiceOver all watch a region they
   * already know about for CHANGES. Mounting the element and its message in
   * the same commit is the single most common way to write a live region that
   * never fires, and it is what this file did: none of its messages was ever
   * announced, so a filter keystroke told a screen-reader user nothing at all.
   * The element below is always in the tree, quiet, and only its text changes.
   */
  const message =
    !filtering || status === "LoadingFirstPage"
      ? null
      : matchCount === 0
        ? exhausted
          ? "No entries match these filters."
          : "No matches in the entries loaded so far."
        : exhausted
          ? `${matchCount} ${matchCount === 1 ? "entry matches" : "entries match"} these filters.`
          : "Showing matches in the entries loaded so far."

  return (
    /*
     * The padding is conditional because the region is not. Unfiltered and
     * exhausted — the ordinary state of a log somebody is just reading — there
     * is nothing to say and no button to press, and a permanent `py-4` left
     * 32px of dead space under the last row. An EMPTY block element generates
     * no line box, so the quiet live region below costs nothing.
     */
    <div
      className={cn(
        "flex flex-col items-center",
        message !== null && "gap-2",
        message !== null || canLoadMore ? "py-4" : null
      )}
    >
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {message}
      </p>

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
