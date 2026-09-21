import { DollarSign, Square } from "lucide-react"
import { ProjectDot } from "@/components/classifiers/project-dot"
import { cn } from "@/lib/utils"
import { formatClock } from "@shared/duration"
import { RUNNING_ENTRY } from "../sample-data"
import { useRunningSeconds } from "../use-running-seconds"

/**
 * MIRRORS src/components/timer/timer-bar.tsx in its RECORDING state — the
 * `border-primary` boundary, the 42px `--primary` disc showing the stop glyph,
 * the mono duration, and the footer strip with project and billable. If that
 * file's strings change, change these.
 *
 * Not the real component: TimerBar brings popovers, ManualEntryDialog, inline
 * editors and the `useAnnounce` context, none of which belong inside an inert
 * illustration on a signed-out page.
 *
 * The tick lives in `useRunningSeconds`, shared with the day ruler.
 */
export function TimerBarFragment({ className }: { className?: string }) {
  const elapsedSeconds = useRunningSeconds()

  return (
    <div
      data-landing-fragment="timer"
      inert
      className={cn(
        "flex flex-col rounded-md border border-primary bg-card",
        className
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4 sm:py-3">
        <span className="min-w-[7rem] flex-1 truncate pr-2 text-base sm:text-lg">
          {RUNNING_ENTRY.title}
        </span>
        <span
          data-landing-elapsed
          className="font-mono text-lg tracking-[-0.02em] text-primary tabular-nums"
        >
          {formatClock(elapsedSeconds * 1000)}
        </span>
        <span className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Square className="size-4 fill-current" />
        </span>
      </div>
      <div className="flex items-center gap-3 border-t border-border px-4 py-1.5">
        <ProjectDot project={RUNNING_ENTRY.project} />
        <span className="flex items-center gap-1 text-xs text-foreground">
          <DollarSign className="size-3.5" />
          Billable
        </span>
      </div>
    </div>
  )
}
