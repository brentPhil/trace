import { cn } from "@/lib/utils"

/*
 * The Music settings block.
 *
 * PRESENTATIONAL: its data and its write both arrive as props, the same shape
 * `GoogleCalendarSection` uses. That is what lets it render against fixtures
 * with no backend anywhere near it, and it keeps every write in this feature
 * originating in one place — the page.
 *
 * THERE IS NO "pause music when the timer pauses" CONTROL HERE, and its
 * absence is the design. This product has no pause state on a time entry —
 * one is running (`endedAt === null`) or it is stopped — so a switch for
 * "when the timer pauses" would be a preference that can never fire. That is
 * worse than simply not offering it: a user who turns it on believes it now
 * governs something, and it never will. If a pause state is ever added to
 * entries, this is the file to revisit — not before.
 */

/** The one write this section makes, shaped as a patch so a caller can
 *  forward it straight into the same `save` every other control on the page
 *  already calls, without a second callback prop per field. */
export type MusicSettingsPatch =
  { musicAutoplay: boolean } | { musicOnStop: "stop" | "pause" | "continue" }

export function MusicSection({
  musicAutoplay,
  musicOnStop,
  onChange,
}: {
  musicAutoplay: boolean
  musicOnStop: "stop" | "pause" | "continue"
  onChange: (patch: MusicSettingsPatch) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={musicAutoplay}
          onChange={(event) =>
            onChange({ musicAutoplay: event.target.checked })
          }
          // The neutral `--ink` accent every other checkbox on the settings
          // page uses. NOT `--enlarger`: a checked setting is not a timer
          // running, and the Cold Light Rule reads the two differently.
          // `--brass` is money and is not used here either.
          className="size-4 accent-[var(--ink)]"
        />
        Play music when tracking starts
      </label>

      <label className="flex flex-col gap-1 text-sm">
        When tracking stops
        <select
          aria-label="When tracking stops"
          value={musicOnStop}
          onChange={(event) =>
            onChange({
              musicOnStop: event.target.value as "stop" | "pause" | "continue",
            })
          }
          // `fieldClass` on the settings page is a private, un-exported
          // constant (`rounded-md border border-edge bg-ground px-2 py-1.5
          // text-sm`, plus a focus ring), so this mirrors those utilities
          // inline rather than importing something that does not exist
          // outside that file.
          className={cn(
            "rounded-md border border-edge bg-ground px-2 py-1.5 text-sm",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          )}
        >
          <option value="stop">Stop the music</option>
          <option value="pause">Pause the music</option>
          <option value="continue">Keep playing</option>
        </select>
      </label>
    </div>
  )
}
