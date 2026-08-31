import { MAX_LIBRARY_BYTES, MAX_TRACK_COUNT, formatBytes } from "@shared/audio"
import { cn } from "@/lib/utils"

/*
 * The storage meter, and the page's honest header.
 *
 * EVERY CEILING IS A CONSTANT, never a literal. The number in each sentence
 * and the number `acceptTrack` refuses an upload against are the same import,
 * so they cannot drift into telling the user two different things.
 *
 * `count` is drawn here for the first time. `usageImpl` has computed it,
 * `usageReturns` has validated it, and the query has sent it on every page
 * load since the feature shipped — while the page rendered only `bytes`, so
 * the 500-track cap was enforced and never mentioned.
 *
 * THE MEASURE BELONGS TO THE CALLER now, not to this component: the library
 * section wraps this and the accepted-formats line in one `max-w-prose` column
 * so the two blocks share an edge and a width. A `max-w-prose` in here as well
 * would cap the same column twice and make the outer one a lie.
 *
 * The bar is `aria-hidden` and the sentences carry the values: they are
 * already the exact figures in the units a person thinks in, and a
 * `progressbar` role would announce the same number again as a bare percent.
 *
 * NO BRASS HERE, and this is not a stylistic preference. styles.css reserves
 * all three signals by meaning — enlarger is RUNNING and nothing else, brass
 * is MONEY, safelight is "act here" — to the point that the project palette
 * deliberately skips hues ~230 and ~85 so a project tint can never be misread
 * as a state. A storage meter is none of those three things, so a brass bar
 * would spend a reserved signal on an unrelated meaning.
 *
 * Which leaves a two-step: "nearly full" is INFORMATION and is carried by the
 * sentence alone, at the ordinary muted weight. "Full" is an ERROR — the next
 * upload really will be refused by `acceptTrack` — and takes `alarm`, which is
 * the system's colour for exactly that. Both change their wording, so the
 * colour is the redundant half of the signal in the one case that has any.
 */

const NEARLY_FULL = 0.9

/** The shared spelling — which is what renders the 2 GiB library cap as
 *  "2 GB" rather than the "2048 MB" a megabytes-only formatter would give. */
const formatMb = formatBytes

export function LibraryUsage({
  bytes,
  count,
}: {
  bytes: number
  count: number
}) {
  const fraction = Math.min(1, bytes / MAX_LIBRARY_BYTES)
  const free = Math.max(0, MAX_LIBRARY_BYTES - bytes)
  const nearlyFull = fraction >= NEARLY_FULL
  const full = free === 0

  return (
    /*
      TWO LINES IN THE ORDINARY CASE, and it was three.
      
      "used", the bar, and "free" each had a row of their own, which spent three
      stacked lines and a bar on a meter that is almost always reading "plenty
      of room" — and read as a whole block of page furniture in a settings
      section that is mostly one-line controls. What is used and what is left
      are the two halves of one sentence, so they share a row: the reading on
      the left, the headroom on the right, the bar under both.

      THE THIRD LINE IS NOW CONDITIONAL and says something when it appears. It
      only renders at "nearly full" and "full" — the two states that ask the
      user to DO something — so its presence is itself the signal, rather than a
      permanent row that says "1.99 GB free" in the same place a warning would
      later go and trains the eye to skip it.
    */
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-4 text-xs text-muted-foreground">
        <p>
          {`${formatMb(bytes)} of ${formatMb(MAX_LIBRARY_BYTES)} used · ${count} of ${MAX_TRACK_COUNT} tracks`}
        </p>
        {/* Suppressed at the cap, where "0 B free" is a restatement of the
            alarm sentence below in weaker words. */}
        {full ? null : <p className="shrink-0">{`${formatMb(free)} free`}</p>}
      </div>

      <div
        aria-hidden="true"
        className="h-1 overflow-hidden rounded-full bg-popover"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width]",
            // Paired with a sentence, never alone. DESIGN.md: meaning is never
            // carried by colour.
            full ? "bg-destructive" : "bg-muted-foreground"
          )}
          style={{ width: `${(fraction * 100).toFixed(1)}%` }}
        />
      </div>

      {full || nearlyFull ? (
        <p
          className={cn(
            "text-xs",
            full ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {full
            ? "Library full. Remove a track to make room."
            : `Nearly full — ${formatMb(free)} free. Remove a track to make room.`}
        </p>
      ) : null}
    </div>
  )
}
