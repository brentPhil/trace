import { ProjectDot } from "@/components/classifiers/project-dot"
import { HATCH_EMPTY } from "@/lib/hatch"
import { cn } from "@/lib/utils"
import { formatClock, formatCompactDuration } from "@shared/duration"
import { DAY, TYPED_NOTE } from "../sample-data"
import { staggerDelay, useReveal, useTyped } from "../use-reveal"

const ROW_STAGGER_MS = 70

/**
 * MIRRORS src/components/entries/entry-row.tsx and note-line.tsx: a 54px row
 * (`min-h-(--entry-row-height)`), the title at the Title role with its project
 * beside it, the note line under it, and the mono duration pinned right. The
 * noteless row wears `HATCH_EMPTY` exactly as the log's add-note trigger does.
 * If those files' strings change, change these.
 *
 * THE ONE EMPTY NOTE GETS WRITTEN. When the log scrolls into view its rows
 * arrive in order, and then the hatched "Add note" is typed over — the
 * section's whole argument ("the note is the product") performed once, in the
 * place it happens in the app. Without script, motion or an observer the row
 * simply stays hatched, which is the truthful resting state.
 */
export function DayLogFragment({ className }: { className?: string }) {
  const [ref, reveal] = useReveal<HTMLDivElement>()
  const { typed, done } = useTyped(TYPED_NOTE, reveal === "in", {
    startMs: DAY.entries.length * ROW_STAGGER_MS + 900,
  })
  const totalMinutes = DAY.entries.reduce(
    (sum, e) => sum + (e.endMinute - e.startMinute),
    0
  )

  return (
    <div
      ref={ref}
      data-landing-fragment="day-log"
      inert
      className={cn("rounded-lg border border-border bg-background", className)}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
        <span className="font-medium">{DAY.label}</span>
        <span className="font-mono tracking-[-0.02em] text-muted-foreground tabular-nums">
          {formatCompactDuration(totalMinutes * 60_000)}
        </span>
      </div>
      <ul>
        {DAY.entries.map((entry, i) => (
          <li
            key={entry.title}
            style={
              reveal === "in" ? staggerDelay(i, ROW_STAGGER_MS) : undefined
            }
            className={cn(
              "flex min-h-(--entry-row-height) items-center gap-4 px-4 py-1.5",
              reveal === "pending" && "opacity-0",
              reveal === "in" &&
                "animate-landing-rise motion-reduce:animate-none"
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-base font-medium tracking-[-0.01em]">
                  {entry.title}
                </span>
                <ProjectDot project={entry.project} className="shrink-0" />
              </div>
              {entry.note !== null ? (
                <p className="truncate text-xs text-muted-foreground">
                  {entry.note}
                </p>
              ) : typed === "" ? (
                <span
                  data-hatched
                  className={cn(
                    HATCH_EMPTY,
                    "h-5 self-start rounded-sm px-1.5 text-xs text-muted-foreground/70"
                  )}
                >
                  Add note
                </span>
              ) : (
                <p
                  data-typed-note
                  className="h-5 truncate text-xs leading-5 text-foreground"
                >
                  {typed}
                  {done ? null : (
                    <span className="ml-px inline-block h-3 w-px translate-y-0.5 animate-landing-caret bg-primary" />
                  )}
                </p>
              )}
            </div>
            <span className="hidden font-mono text-sm tracking-[-0.02em] text-muted-foreground tabular-nums sm:inline">
              {clockLabel(entry.startMinute)} – {clockLabel(entry.endMinute)}
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-sm tracking-[-0.02em] tabular-nums">
              {formatClock((entry.endMinute - entry.startMinute) * 60_000)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** `9:02`, `13:10`. Sample times only; the app formats by the user's setting. */
function clockLabel(minute: number): string {
  return `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`
}
