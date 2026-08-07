import { Play } from "lucide-react"
import { EntryDuration } from "@/components/timer/entry-duration"
import { formatTimeRange } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import type { Entry } from "@/lib/group-entries"

/**
 * One tracked entry.
 *
 * Column order follows the eye's job: what it was, then where it belongs, then
 * when, then how long. The duration is last and right-aligned so a column of
 * them aligns on the digit — the whole reason for the Tabular Rule.
 *
 * The row is 50px, matching the density of a real tracker's log. Denser reads
 * as a spreadsheet; looser and a working day stops fitting on one screen.
 */
export function EntryRow({
  entry,
  timeZone,
  use12Hour,
}: {
  entry: Entry
  timeZone: string
  use12Hour: boolean
}) {
  const running = entry.endedAt === null
  const title = entry.title.trim()
  const note = (entry.note ?? "").trim()
  const hasNote = note !== ""

  return (
    <div
      className={cn(
        "group flex min-h-[50px] items-center gap-3 px-4",
        "border-b border-edge-soft/60 last:border-b-0",
        "transition-colors hover:bg-surface/60"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "truncate text-sm font-medium",
              title === "" && "text-muted-foreground italic"
            )}
          >
            {title === "" ? "No description" : title}
          </span>
          {entry.billable ? (
            // Brass means money — The Two Temperatures Rule. Paired with a
            // glyph so it survives without colour.
            <span className="shrink-0 text-brass" title="Billable">
              <span aria-hidden="true" className="text-xs font-semibold">
                $
              </span>
              <span className="sr-only">Billable</span>
            </span>
          ) : null}
        </div>

        {/*
          The note is the product, so it is shown in the row rather than hidden
          behind a hover or a detail panel. An entry WITHOUT one gets the hatch
          treatment (The Hatch Rule): absence is a texture, never a colour, and
          it is an invitation rather than a scold.
        */}
        {hasNote ? (
          <span className="truncate text-xs text-muted-foreground">{note}</span>
        ) : (
          // ALWAYS visible, never a hover reveal. PRODUCT.md: missing notes are
          // "visible, not absent". Hiding this until hover would make the one
          // thing the product exists to capture the one thing you cannot see is
          // missing — and it leaves a dead gap in the row besides.
          //
          // The hatch is the carrier (The Hatch Rule): absence is a texture,
          // never a colour, so it survives colour blindness and reads in
          // peripheral vision. It is an invitation, not a warning — which is
          // why it is quiet, and why nothing about it blocks or nags.
          <button
            type="button"
            className={cn(
              "hatch-empty w-fit rounded-sm px-1.5 py-0.5 text-xs",
              "text-muted-foreground/70 transition-colors",
              "hover:text-foreground focus-visible:text-foreground"
            )}
          >
            + add note
          </button>
        )}
      </div>

      <span className="hidden shrink-0 text-xs text-muted-foreground tabular sm:inline">
        {formatTimeRange(entry.startedAt, entry.endedAt, timeZone, use12Hour)}
      </span>

      <EntryDuration
        startedAt={entry.startedAt}
        endedAt={entry.endedAt}
        className={cn(
          "w-[4.5rem] shrink-0 text-right text-sm font-medium",
          running && "text-enlarger"
        )}
      />

      <button
        type="button"
        aria-label={`Resume ${title === "" ? "this entry" : title}`}
        className={cn(
          "shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0",
          "transition-opacity hover:text-foreground",
          "group-hover:opacity-100 focus-visible:opacity-100"
        )}
      >
        <Play className="size-4" />
      </button>
    </div>
  )
}
