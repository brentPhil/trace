import type { CSSProperties } from "react"
import { HATCH_EMPTY } from "@/lib/hatch"
import { projectColorVar } from "@/lib/project-color"
import { cn } from "@/lib/utils"
import { DAY, DAY_AXIS, HATCH_GAP_MINUTES, RUNNING_ENTRY } from "../sample-data"
import type { SampleProject } from "../sample-data"
import { useRunningSeconds } from "../use-running-seconds"

export type RulerSegment =
  | { kind: "entry"; left: number; width: number; project: SampleProject }
  | { kind: "gap"; left: number; width: number }
  | { kind: "running"; left: number; width: number; project: SampleProject }

type Span = { startMinute: number; endMinute: number }

/**
 * The day as positioned segments, in PERCENT of the axis.
 *
 * Pure, so the geometry is tested without a DOM: entries in order, a hatched
 * gap wherever untracked time between two of them reaches
 * `HATCH_GAP_MINUTES`, and the running entry from its start to now, clamped
 * to the axis so a long enough visit cannot push it off the end.
 */
export function rulerSegments(
  entries: ReadonlyArray<Span & { project: SampleProject }>,
  running: {
    startMinute: number
    project: SampleProject
    elapsedSeconds: number
  },
  axis: Span
): Array<RulerSegment> {
  const span = axis.endMinute - axis.startMinute
  const pct = (minute: number) =>
    ((Math.min(Math.max(minute, axis.startMinute), axis.endMinute) -
      axis.startMinute) /
      span) *
    100
  const place = (from: number, to: number) => ({
    left: pct(from),
    width: pct(to) - pct(from),
  })

  const segments: Array<RulerSegment> = []
  entries.forEach((entry, i) => {
    const previous = entries[i - 1] as
      (Span & { project: SampleProject }) | undefined
    if (
      previous &&
      entry.startMinute - previous.endMinute >= HATCH_GAP_MINUTES
    ) {
      segments.push({
        kind: "gap",
        ...place(previous.endMinute, entry.startMinute),
      })
    }
    segments.push({
      kind: "entry",
      project: entry.project,
      ...place(entry.startMinute, entry.endMinute),
    })
  })

  const runningEnd = running.startMinute + running.elapsedSeconds / 60
  segments.push({
    kind: "running",
    project: running.project,
    ...place(running.startMinute, runningEnd),
  })
  return segments
}

const HOUR_LABELS = [8, 10, 12, 14, 16, 18]

/**
 * THE DAY, DRAWN — the landing page's one image, and the literal answer to its
 * headline. The same picture the app's calendar view draws of a day, laid on
 * its side: each entry a block in its project's hue, lunch hatched because
 * absence is a texture (DESIGN.md, The Hatch Rule), and the running entry
 * outlined in `--primary` and growing into the present.
 *
 * Colour is never the only carrier: the blocks are named in the day log below,
 * and project hues are data (`--project-*`), so they hold still under any
 * theme. The block grows with `useRunningSeconds`, the same tick as the timer
 * bar — at eleven hours across, a second is a fraction of a pixel, which is
 * the point: it is the timer's time, not an animation.
 *
 * ON LOAD THE DAY REPLAYS: the blocks are uncovered from 8:00 to now while the
 * playhead rides the uncovered edge, on one curve (`landing-sweep-*` in
 * styles.css), so the first thing the page does is what the product does —
 * account for a day. CSS only, so it needs no hydration; `backwards` fill, so
 * once it ends (or if it never runs) nothing is clipped. The "now" line then
 * breathes, which is the page's standing signal that something is recording.
 */
const SWEEP_DELAY = "[animation-delay:700ms]"

export function DayRulerFragment({ className }: { className?: string }) {
  const elapsedSeconds = useRunningSeconds()
  const segments = rulerSegments(
    DAY.entries,
    { ...RUNNING_ENTRY, elapsedSeconds },
    DAY_AXIS
  )
  const span = DAY_AXIS.endMinute - DAY_AXIS.startMinute
  const hourLeft = (hour: number) =>
    ((hour * 60 - DAY_AXIS.startMinute) / span) * 100
  const running = segments.at(-1)
  const now = running ? running.left + running.width : 100

  return (
    <div
      data-landing-fragment="day-ruler"
      inert
      className={cn("flex flex-col gap-2", className)}
    >
      <div className="relative h-16 overflow-hidden rounded-md border border-border bg-background sm:h-20">
        {Array.from({ length: 10 }, (_, i) => 9 + i).map((hour) => (
          <span
            key={hour}
            className="absolute inset-y-0 w-px bg-border"
            style={{ left: `${hourLeft(hour)}%` }}
          />
        ))}
        <div
          style={{ "--landing-now": `${now}%` } as CSSProperties}
          className={cn(
            "absolute inset-0 animate-landing-sweep-clip motion-reduce:animate-none",
            SWEEP_DELAY
          )}
        >
          {segments.map((segment, i) => {
            const box = { left: `${segment.left}%`, width: `${segment.width}%` }
            if (segment.kind === "gap") {
              return (
                <span
                  key={i}
                  data-hatched
                  className={cn(HATCH_EMPTY, "absolute inset-y-2.5 rounded-sm")}
                  style={box}
                />
              )
            }
            const color = {
              ...box,
              "--project-color": projectColorVar(segment.project.color),
            } as CSSProperties
            if (segment.kind === "running") {
              return (
                <span
                  key={i}
                  data-running
                  style={color}
                  className="absolute inset-y-2.5"
                >
                  <span className="absolute inset-0 rounded-l-sm border-2 border-r-0 border-primary bg-[color-mix(in_oklab,var(--primary)_14%,var(--background))]" />
                </span>
              )
            }
            return (
              <span
                key={i}
                data-entry
                style={color}
                className={cn(
                  "absolute inset-y-2.5 rounded-sm border",
                  // Mixed against the page, not against transparent: an opaque
                  // block covers the hour rules instead of wearing them. OKLAB,
                  // not OKLCH: `--background` is achromatic at hue 0, and an
                  // OKLCH mix swings teal toward brown on the way there.
                  "border-[color-mix(in_oklab,var(--project-color)_70%,var(--background))]",
                  "bg-[color-mix(in_oklab,var(--project-color)_30%,var(--background))]",
                  "forced-colors:border-[CanvasText]"
                )}
              />
            )
          })}
        </div>
        {/* "Now": the running edge, full height, so the present is a line
            rather than the end of a box. Its wrapper is as wide as the day so
            far, so sliding it in from -100% keeps the line on the sweep's
            leading edge. */}
        <div
          data-now
          style={{ width: `${now}%` }}
          className={cn(
            "absolute inset-y-0 left-0 animate-landing-sweep-head motion-reduce:animate-none",
            SWEEP_DELAY
          )}
        >
          <span className="absolute inset-y-0 right-0 w-0.5 animate-landing-breathe bg-primary motion-reduce:animate-none" />
        </div>
      </div>
      <div className="relative h-4 font-mono text-xs tracking-[-0.02em] text-muted-foreground tabular-nums">
        {HOUR_LABELS.map((hour) => (
          <span
            key={hour}
            className={cn("absolute", hour !== 8 && "-translate-x-1/2")}
            style={{ left: `${hourLeft(hour)}%` }}
          >
            {hour}:00
          </span>
        ))}
      </div>
    </div>
  )
}
