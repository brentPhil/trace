import { useElapsedMs } from "@/hooks/use-clock"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatCompactDuration } from "@shared/duration"
import type { Doc } from "../../../convex/_generated/dataModel"

/**
 * "This has been running a while."
 *
 * Entirely client-side, from `startedAt` and the wall clock — no cron, no
 * stored flag, nothing to fall out of sync. It appears the moment the elapsed
 * time crosses the user's threshold and disappears when the timer stops.
 *
 * It NEVER stops anything. A nine-hour session might be a real day's work on
 * one thing, and a tracker that ends a timer on your behalf is a tracker that
 * loses time — which is the one thing this product promises not to do. It also
 * does not nag: no repetition, no escalation, no modal. It states a fact and
 * puts the two plausible corrections within reach.
 *
 * Not styled as an error. Being wrong about how long you have been working is
 * ordinary, and `--alarm` here would teach people to dismiss the colour that
 * needs to mean something later.
 */
export function RunawayBanner({
  running,
  thresholdMs,
  onStop,
  onDiscard,
}: {
  running: Doc<"timeEntries"> | null
  thresholdMs: number
  onStop: () => void
  onDiscard: () => void
}) {
  /*
   * `running.endedAt` is passed THROUGH, not defaulted.
   *
   * It is `null` for a running entry, and `null` is exactly what tells
   * `elapsedMs` to measure against the wall clock. Writing `?? 0` here — as
   * this first did — coerces every running entry into a completed one that
   * ended at the epoch, so the elapsed time is a large negative number and the
   * banner can never appear at all. The only thing worse than a warning that
   * nags is one that silently never fires.
   */
  const elapsed = useElapsedMs(
    running?.startedAt ?? 0,
    running === null ? 0 : running.endedAt
  )

  if (running === null || elapsed < thresholdMs) return null

  return (
    <div
      // `status`, not `alert`: this is not urgent and must not interrupt.
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-border",
        "bg-card px-4 py-2 text-sm"
      )}
    >
      <span>
        This timer has been running for{" "}
        <strong className="font-medium font-mono tabular-nums tracking-[-0.02em]">
          {formatCompactDuration(elapsed)}
        </strong>
        .
      </span>
      <span className="text-muted-foreground">Still working?</span>
      <span className="flex items-center gap-3">
        <BannerAction onClick={onStop}>Stop it now</BannerAction>
        {/*
          Discard is offered because the common cause of a runaway timer is one
          started by accident and forgotten — but it is the second option and
          plainly labelled, never the default.
        */}
        <BannerAction onClick={onDiscard} destructive>
          Discard it
        </BannerAction>
      </span>
    </div>
  )
}

function BannerAction({
  onClick,
  destructive = false,
  children,
}: {
  onClick: () => void
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    // `link` for the underline and offset; everything below is the hue, which
    // the variant deliberately leaves at `text-primary`.
    <Button
      type="button"
      variant="link"
      size="row-trigger"
      onClick={onClick}
      className={cn(
        "text-sm underline",
        destructive
          ? "text-muted-foreground hover:text-destructive"
          : // NOT the running treatment. The banner is genuinely ABOUT a running
            // timer, but that does not license spending the running mark on a
            // hover state: it belongs to the signal that something
            // IS running (the bar's border, icon, "Recording", the tab
            // clock) precisely so it stays a singular, unambiguous marker in
            // peripheral vision. A button's :hover feedback is decoration —
            // the Two Temperatures Rule's own words for the one use it
            // explicitly rules out — regardless of what the button is on.
            //
            // Not a plain `hover:text-foreground` either: this action is
            // already `text-foreground` at rest (full ink, more prominent
            // than "Discard it" beside it, matching its status as the
            // default of the two), so that would be a no-op. Dimming
            // slightly on hover keeps a real, visible state change without
            // reaching for a second hue.
            "text-foreground hover:text-foreground/80"
      )}
    >
      {children}
    </Button>
  )
}
