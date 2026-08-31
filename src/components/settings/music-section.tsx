import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

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
 *
 * AND "WHEN TRACKING STOPS" OFFERS TWO, not the three it shipped with. The
 * cut option was "Pause the music", and the paragraph above is exactly why it
 * had to go — the reasoning was already written here and simply had not been
 * turned on the control below it. `stop` and `pause` differed by a single
 * `currentTime = 0`: identical at the moment the timer stopped, distinguishable
 * only by whether the NEXT press of Play restarted the track or resumed it, and
 * not even that across a reload, which clears the position anyway. For a lo-fi
 * loop with no narrative that is not a difference a person can hear, so it was
 * a dropdown asking someone to predict a future they cannot feel.
 *
 * What survives keeps the gentler behaviour: choosing "Stop the music" calls
 * the player's `pause`, not its `stop`, so the track resumes where it left off.
 * Whether the playhead rewinds is an implementation detail, and the moment it
 * became a question put to the user it became a worse product.
 */

/** The one write this section makes, shaped as a patch so a caller can
 *  forward it straight into the same `save` every other control on the page
 *  already calls, without a second callback prop per field. */
export type MusicSettingsPatch =
  { musicAutoplay: boolean } | { musicOnStop: "stop" | "continue" }

export function MusicSection({
  musicAutoplay,
  musicOnStop,
  onChange,
}: {
  musicAutoplay: boolean
  musicOnStop: "stop" | "continue"
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
          // `--foreground`, the same accent every other checkbox on the
          // settings page uses. A checked setting is not a timer running, and
          // the two should not look alike — which mattered more when the
          // running state had a hue of its own, and is still why this does not
          // reach for `--primary`.
          className="size-4 accent-foreground"
        />
        Play music when tracking starts
      </label>

      {/*
        A `<div>`, not a `<label>`, now that the control is a Select: a Base UI
        trigger is a button, and wrapping a button in a label makes the label's
        click handler and the button's own fight over the same press. The
        trigger carries its own `aria-label`, which is what named it before.

        The hand-mirrored `fieldClass` utilities are gone with the native
        control — `SelectTrigger` IS that vocabulary now, stated once in
        `ui/select.tsx` instead of copied into every file that needed a field.
      */}
      <div className="flex flex-col gap-1 text-sm">
        <span>When tracking stops</span>
        <Select
          value={musicOnStop}
          onValueChange={(next) => onChange({ musicOnStop: next })}
        >
          <SelectTrigger aria-label="When tracking stops" className="w-52">
            {/* The values are `stop`/`continue`; the labels are prose. */}
            <SelectValue>
              {(value) =>
                value === "continue" ? "Keep playing" : "Stop the music"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stop">Stop the music</SelectItem>
            <SelectItem value="continue">Keep playing</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
