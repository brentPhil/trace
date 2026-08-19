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
import { Popover } from "@/components/ui/popover"
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
          <Disc3 className="size-4" />
        </Popover.Trigger>
        <Popover.Popup className="w-72 p-0">
          <Panel value={value} />
        </Popover.Popup>
      </Popover.Root>
    </div>
  )
}

const triggerClass =
  "inline-flex size-8 items-center justify-center rounded-md border border-edge text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

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
    <button
      type="button"
      aria-label={label}
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      onClick={onClick}
      className={cn(triggerClass, pressed === true && "text-foreground")}
    >
      {children}
    </button>
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
          const isCurrent =
            value.current !== null &&
            value.current.name === track.name &&
            value.current.origin === track.origin
          return (
            <button
              key={`${track.origin}:${track.name}`}
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
              {track.url === null ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  unavailable
                </span>
              ) : null}
            </button>
          )
        })
      )}
    </div>
  )
}
