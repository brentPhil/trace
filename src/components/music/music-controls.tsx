import {
  Disc3,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Popover } from "@/components/ui/popover"
import { trackRefEquals, trackRefKey } from "@/lib/music/track-ref"
import { cn } from "@/lib/utils"
import type { MusicContextValue, PlayableTrack } from "./music-provider"

/**
 * Music, in the timer bar, without becoming the timer bar.
 *
 * TWO ICONS BY DEFAULT and nothing else, because the tracker's job is the
 * number and a media player is the opposite kind of object. Everything else is
 * behind the popover.
 *
 * NO SIGNAL COLOUR, IN ANY STATE. `--enlarger` is the running timer and only
 * the running timer: the moment a second thing on the surface is cold-lit, the
 * running state stops being findable in half a second, which is the property
 * the whole palette is built to buy. `--brass` is money. So playing-vs-muted is
 * carried by ICON SHAPE and by the track name — never by hue, which also
 * satisfies DESIGN.md's rule that meaning never rides on colour alone.
 *
 * Takes the context as a PROP rather than calling `useMusic()`, so it renders in
 * a test without a provider, an audio element, or a Convex client.
 */
export function MusicControls({ value }: { value: MusicContextValue }) {
  const { current, playing, blocked } = value

  const playLabel = blocked
    ? "Click to play music"
    : playing
      ? `Pause music${current === null ? "" : `: ${current.name}`}`
      : "Play music"

  return (
    <div className="flex items-center gap-1">
      {current === null || !playing ? null : (
        // The Now Playing line. One line, muted, truncated, never wrapping —
        // it sits beside a running timer and must never push it.
        <span className="hidden max-w-32 truncate text-xs text-muted-foreground sm:inline">
          {current.name}
        </span>
      )}

      <IconButton label={playLabel} onClick={value.toggle}>
        {playing ? (
          <Volume2 className="size-4" />
        ) : (
          <VolumeX className="size-4" />
        )}
      </IconButton>

      <Popover.Root>
        <Popover.Trigger aria-label="Music library" className={triggerClass}>
          {/*
            THE DISC TURNS WHILE SOMETHING IS PLAYING.

            Three seconds a revolution, not Tailwind's default one: a record
            turns at about that rate, and — more to the point — this sits a few
            pixels from a running timer, which DESIGN.md calls the only motion
            guaranteed to be on screen and the one that must stay readable when
            everything else stops. A one-second spin competes with it. Three is
            perceptible when you look and invisible when you do not, which is
            what a tracker that recedes can afford.

            `motion-reduce:animate-none`, per DESIGN.md's rule that every
            transition owes a reduced-motion alternative — and nothing is lost
            by it, because this is the THIRD carrier of "playing", after the
            speaker icon's own shape and the Now Playing name. It reinforces a
            state that is already legible without it rather than being the only
            place that state lives.
          */}
          <Disc3
            className={cn(
              "size-4",
              playing &&
                "animate-spin [animation-duration:3s] motion-reduce:animate-none"
            )}
          />
        </Popover.Trigger>
        <Popover.Popup className="w-72 p-0">
          <Panel value={value} />
        </Popover.Popup>
      </Popover.Root>
    </div>
  )
}

/*
 * NO BOX, AND ONE SOURCE FOR EVERYTHING ELSE.
 *
 * DESIGN.md's Boundary Rule asks that anything interactive carry a border at
 * Edge or brighter — and the rule is about a control sitting ALONE on a
 * surface, where a bare glyph is indistinguishable from an ornament. These do
 * not sit alone: they sit in the timer bar's footer beside the project, tag
 * and billable triggers, which are `variant="quiet"` over the button base's
 * transparent border and have never carried a box. Boxing two of five controls
 * in one strip is the inconsistency the rule exists to prevent, not an
 * instance of it.
 *
 * Which is exactly why these are built out of `buttonVariants` rather than
 * hand-rolled to LOOK like it. The hand-rolled version matched the missing
 * border and nothing else: it drew `focus-visible:ring-2 ring-ring` where its
 * three neighbours in the same strip draw the base's `focus-visible:border-ring
 * ring-3 ring-ring/30`, so tabbing along one row of five controls changed the
 * shape of the focus indicator halfway across — a difference that says
 * "different kind of control" to anyone navigating by keyboard, about controls
 * that are peers. Same story for the box: `size-7` against the classifiers'
 * `row-trigger`. Deriving both from the shared variants is what makes a future
 * change to the app's focus treatment reach this strip too, instead of leaving
 * two of five behind. `classifier-pickers.tsx` builds its own `triggerClass`
 * the same way, for the same reason.
 *
 * `size-6` is 24x24 — WCAG 2.2 AA's target floor exactly, and the smallest
 * these may get. `row-trigger` is `h-auto` because a classifier is sized by the
 * text sitting inside it; an icon-only control has no text to be sized by, so
 * it has to state the floor itself. `p-0` because at a fixed size the padding
 * would only shrink the glyph.
 */
const TRIGGER_BOX = "size-6 rounded-md p-0"

/** For `Popover.Trigger`, which brings its own element and takes a className —
 *  the same reason `classifier-pickers.tsx` reaches for `buttonVariants`
 *  instead of `<Button>` on two of its three controls. */
const triggerClass = cn(
  buttonVariants({ variant: "quiet", size: "row-trigger" }),
  TRIGGER_BOX
)

function IconButton({
  label,
  onClick,
  pressed,
  children,
}: {
  label: string
  onClick: () => void
  pressed?: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="quiet"
      size="row-trigger"
      aria-label={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      onClick={onClick}
      className={cn(TRIGGER_BOX, pressed === true && "text-foreground")}
    >
      {children}
    </Button>
  )
}

function Panel({ value }: { value: MusicContextValue }) {
  const chroneli = value.tracks.filter((t) => t.origin === "chroneli")
  const mine = value.tracks.filter((t) => t.origin === "upload")

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b border-edge-soft p-3">
        <p className="truncate text-sm">
          {value.current?.name ?? "Nothing playing"}
        </p>

        <div className="flex items-center gap-1">
          <IconButton label="Previous track" onClick={value.previous}>
            <SkipBack className="size-4" />
          </IconButton>
          <IconButton
            label={value.playing ? "Pause music" : "Play music"}
            onClick={value.toggle}
          >
            {value.playing ? (
              <Volume2 className="size-4" />
            ) : (
              <VolumeX className="size-4" />
            )}
          </IconButton>
          <IconButton label="Next track" onClick={value.next}>
            <SkipForward className="size-4" />
          </IconButton>
          <IconButton
            label="Shuffle"
            pressed={value.shuffle}
            onClick={value.toggleShuffle}
          >
            <Shuffle className="size-4" />
          </IconButton>
          <IconButton
            // The label carries the MODE, because the two repeat icons differ
            // by one glyph and nothing announces which is active otherwise.
            label={`Repeat: ${value.repeat === "off" ? "off" : value.repeat === "one" ? "this track" : "all tracks"}`}
            pressed={value.repeat !== "off"}
            onClick={value.cycleRepeat}
          >
            {value.repeat === "one" ? (
              <Repeat1 className="size-4" />
            ) : (
              <Repeat className="size-4" />
            )}
          </IconButton>
        </div>

        <label className="flex items-center gap-2">
          <span className="sr-only">Volume</span>
          <input
            type="range"
            aria-label="Volume"
            min={0}
            max={1}
            step={0.01}
            value={value.volume}
            onChange={(event) => value.setVolume(Number(event.target.value))}
            className="h-1 w-full accent-[var(--ink)]"
          />
        </label>
      </div>

      <div className="max-h-64 overflow-y-auto">
        <TrackGroup label="Chroneli Music" tracks={chroneli} value={value} />
        <TrackGroup
          label="My Music"
          tracks={mine}
          value={value}
          empty="Nothing uploaded yet."
        />
      </div>
    </div>
  )
}

function TrackGroup({
  label,
  tracks,
  value,
  empty,
}: {
  label: string
  tracks: Array<PlayableTrack>
  value: MusicContextValue
  empty?: string
}) {
  return (
    <div role="group" aria-label={label} className="p-2">
      <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
        {label}
      </p>
      {tracks.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">
          {empty ?? "Nothing here."}
        </p>
      ) : (
        tracks.map((track) => {
          // Identity is the REF, never the name. A name is user-supplied and
          // renameable, so two uploads may legitimately share one — and then a
          // name-keyed row collides with its twin in React's reconciliation and
          // lights the wrong row as playing. `trackRefKey` and `trackRefEquals`
          // exist for exactly this and are what the provider already uses.
          const isCurrent = trackRefEquals(
            value.current?.ref ?? null,
            track.ref
          )
          return (
            <button
              key={trackRefKey(track.ref)}
              type="button"
              aria-label={`Play ${track.name}`}
              aria-current={isCurrent ? "true" : undefined}
              onClick={() => value.playRef(track.ref)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-raised",
                isCurrent && "font-medium"
              )}
            >
              <span className="truncate">{track.name}</span>
              {/*
                THE TURNING DISC IS THE ANSWER TO "WHICH ONE IS PLAYING?".

                Only the current row draws it, at the end of the row, so the
                eye finds it by position rather than by re-reading four names
                and comparing them to the header. `font-medium` alone was
                carrying that job, and one notch of weight is not a difference
                you can see without looking for it.

                It SPINS only while playback is actually running, and stands
                still on the loaded-but-paused row — which is the more useful
                pair of states than showing nothing when paused: you still know
                where you are, and you can tell stopped from playing.

                `aria-hidden`, because `aria-current="true"` on the button
                already says this to a screen reader and a second announcement
                on the same row would be noise. Same three-second revolution
                and the same reduced-motion opt-out as the trigger above.
              */}
              {track.url === null ? (
                // "unavailable" OUTRANKS the disc, including on the current
                // row. `start` sets the current ref before it discovers the
                // track has no URL, so a dead track can be current for a beat
                // — and a spinning disc on a track that cannot play is the one
                // thing this indicator must never say.
                <span className="shrink-0 text-xs text-muted-foreground">
                  unavailable
                </span>
              ) : isCurrent ? (
                <Disc3
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground",
                    value.playing &&
                      "animate-spin [animation-duration:3s] motion-reduce:animate-none"
                  )}
                />
              ) : null}
            </button>
          )
        })
      )}
    </div>
  )
}
