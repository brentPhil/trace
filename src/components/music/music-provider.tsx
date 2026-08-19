import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { convexQuery } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useAudioElement } from "@/hooks/use-audio-element"
import { CATALOG } from "@/lib/music/catalog"
import { nextIndex, prevIndex, shuffledOrder } from "@/lib/music/queue"
import {
  resolveTrackUrl,
  trackRefEquals,
  trackRefKey,
} from "@/lib/music/track-ref"
import {
  DEFAULT_LOCAL_PREFS,
  readLocalPrefs,
  writeLocalPrefs,
} from "@/lib/music/local-prefs"
import { api } from "../../../convex/_generated/api"
import type { RepeatMode } from "@/lib/music/queue"
import type { TrackRef } from "@/lib/music/track-ref"
import type { ReactNode } from "react"

export type PlayableTrack = {
  ref: TrackRef
  name: string
  url: string | null
  origin: "chroneli" | "upload"
}

export type MusicContextValue = {
  tracks: Array<PlayableTrack>
  current: PlayableTrack | null
  playing: boolean
  blocked: boolean
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  playRef: (ref: TrackRef) => void
  toggle: () => void
  next: () => void
  previous: () => void
  setVolume: (volume: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  stop: () => void
  pause: () => void
  onUserPick: (listener: (ref: TrackRef) => void) => () => void
}

const MusicContext = createContext<MusicContextValue | null>(null)

export function useMusic(): MusicContextValue {
  const value = useContext(MusicContext)
  if (value === null) {
    throw new Error("useMusic must be used inside <MusicProvider>")
  }
  return value
}

/** Names the channel that keeps two pinned tabs from playing over each other. */
const CHANNEL = "chroneli:music"

/**
 * The player.
 *
 * MOUNTED IN THE `_authed` LAYOUT, ABOVE THE ROUTER OUTLET, and that placement
 * is the whole reason this is a provider rather than a hook on /timer. TanStack
 * Router unmounts a route component on navigation; an `<audio>` element inside
 * one stops the music every time the user clicks Reports.
 *
 * It knows nothing about timers. `use-music-tracking.ts` is the only file aware
 * of both halves — delete that one file and this keeps working, which is the
 * test of whether the boundary is real.
 */
export function MusicProvider({ children }: { children: ReactNode }) {
  // Not `useSuspenseQuery`: the library is not worth blocking the authed shell
  // on, and an empty list is a correct first render — the catalog is still
  // playable while uploads load.
  const { data: uploads } = useQuery(convexQuery(api.music.listTracks, {}))

  const [prefs, setPrefs] = useState(DEFAULT_LOCAL_PREFS)
  // localStorage is read in an effect rather than in `useState`'s initialiser
  // because this component renders on the SERVER during SSR, where reading it
  // would either throw or produce markup that disagrees with the client's and
  // trip a hydration mismatch.
  useEffect(() => setPrefs(readLocalPrefs()), [])

  const [currentRef, setCurrentRef] = useState<TrackRef | null>(null)
  const [playing, setPlaying] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [shuffleSeed, setShuffleSeed] = useState(1)

  const tracks = useMemo<Array<PlayableTrack>>(() => {
    const uploadUrls = new Map(
      (uploads ?? []).map((t) => [t._id as string, t.url ?? ""])
    )
    return [
      ...CATALOG.map((track) => ({
        ref: { origin: "chroneli" as const, slug: track.slug },
        name: track.name,
        url: resolveTrackUrl(
          { origin: "chroneli", slug: track.slug },
          uploadUrls
        ),
        origin: "chroneli" as const,
      })),
      ...(uploads ?? []).map((track) => ({
        ref: { origin: "upload" as const, trackId: track._id as string },
        name: track.name,
        url: track.url,
        origin: "upload" as const,
      })),
    ]
  }, [uploads])

  const indexOfRef = useCallback(
    (ref: TrackRef | null) =>
      ref === null
        ? -1
        : tracks.findIndex((track) => trackRefEquals(track.ref, ref)),
    [tracks]
  )

  const current = useMemo(() => {
    const at = indexOfRef(currentRef)
    return at === -1 ? null : tracks[at]
  }, [currentRef, indexOfRef, tracks])

  const order = useMemo(
    () => (prefs.shuffle ? shuffledOrder(tracks.length, shuffleSeed) : null),
    [prefs.shuffle, shuffleSeed, tracks.length]
  )

  // Listeners rather than a callback prop: the bridge subscribes, and a prop
  // would make the provider's placement depend on the bridge's.
  const pickListeners = useRef(new Set<(ref: TrackRef) => void>())
  const onUserPick = useCallback((listener: (ref: TrackRef) => void) => {
    pickListeners.current.add(listener)
    return () => void pickListeners.current.delete(listener)
  }, [])

  // Refs so the audio callbacks below never go stale without re-creating the
  // element, which would restart the track.
  const stateRef = useRef({ tracks, currentRef, order, repeat: prefs.repeat })
  stateRef.current = { tracks, currentRef, order, repeat: prefs.repeat }

  // How many consecutive tracks have failed. Bounded so a library where every
  // url is dead stops rather than walking the list forever.
  const failures = useRef(0)

  // `useAudioElement`'s callbacks are created before `advance` exists as a
  // `const` below — referencing it directly here would be a temporal-dead-zone
  // error, not just a stale closure. Routing through a ref sidesteps needing
  // `advance` to exist yet: the ref is populated once it does, and by the time
  // either callback can actually fire (an element load completing, or a
  // decode error) a render has already run the effect that fills it in.
  const advanceRef = useRef<
    (delta: 1 | -1, cause: "user" | "ended" | "error") => void
  >(() => {})

  const audio = useAudioElement({
    onEnded: () => void advanceRef.current(1, "ended"),
    onError: () => {
      failures.current += 1
      if (
        failures.current >= stateRef.current.tracks.length ||
        failures.current > 10
      ) {
        failures.current = 0
        setPlaying(false)
        return
      }
      void advanceRef.current(1, "error")
    },
  })

  const start = useCallback(
    async (track: PlayableTrack) => {
      setCurrentRef(track.ref)
      writeLocalPrefs({ lastTrack: track.ref })
      if (track.url === null || track.url === "") {
        setPlaying(false)
        return
      }
      const ok = await audio.play(track.url)
      setPlaying(ok)
      setBlocked(!ok)
      if (ok) failures.current = 0
    },
    [audio]
  )

  const advance = useCallback(
    async (delta: 1 | -1, cause: "user" | "ended" | "error") => {
      const state = stateRef.current
      const at = state.tracks.findIndex((t) =>
        trackRefEquals(t.ref, state.currentRef)
      )
      if (at === -1 || state.tracks.length === 0) {
        setPlaying(false)
        return
      }
      const position = {
        length: state.tracks.length,
        index: at,
        // Pressing next/previous must move even under repeat-one; only a track
        // ending on its own honours it.
        repeat:
          cause === "user" && state.repeat === "one"
            ? ("off" as const)
            : state.repeat,
        order: state.order,
      }
      const target = delta === 1 ? nextIndex(position) : prevIndex(position)
      if (target === null) {
        audio.stop()
        setPlaying(false)
        return
      }
      await start(state.tracks[target])
    },
    [audio, start]
  )

  // Keeps `advanceRef` pointed at the current `advance` closure, so the
  // `useAudioElement` callbacks above — created once, before `advance` exists —
  // always call the live version rather than a stale one captured on mount.
  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  useEffect(() => {
    audio.setVolume(prefs.volume)
  }, [audio, prefs.volume])

  /**
   * Two pinned tabs are two players, and Chroneli is explicitly a pinned-tab
   * app — so this WILL happen. Whichever tab starts most recently wins.
   */
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === "playing") {
        audio.pause()
        setPlaying(false)
      }
    }
    return () => channel.close()
  }, [audio])

  useEffect(() => {
    if (!playing || typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(CHANNEL)
    channel.postMessage("playing")
    channel.close()
  }, [playing])

  const playRef = useCallback(
    (ref: TrackRef) => {
      const track = tracks.find((t) => trackRefEquals(t.ref, ref))
      if (track === undefined) return
      for (const listener of pickListeners.current) listener(ref)
      void start(track)
    },
    [start, tracks]
  )

  const toggle = useCallback(() => {
    if (playing) {
      audio.pause()
      setPlaying(false)
      return
    }
    const track = current ?? tracks[0]
    if (track === undefined) return
    if (current === null) {
      void start(track)
      return
    }
    void audio.resume().then((ok) => {
      setPlaying(ok)
      setBlocked(!ok)
    })
  }, [audio, current, playing, start, tracks])

  const value = useMemo<MusicContextValue>(
    () => ({
      tracks,
      current,
      playing,
      blocked,
      volume: prefs.volume,
      shuffle: prefs.shuffle,
      repeat: prefs.repeat,
      playRef,
      toggle,
      next: () => void advance(1, "user"),
      previous: () => void advance(-1, "user"),
      setVolume: (volume: number) => {
        // State first so the slider tracks the thumb; localStorage is written
        // in the same call because it is synchronous and cheap. NEITHER is a
        // network round trip, which is the whole reason volume is not a
        // Convex field.
        setPrefs((p) => ({ ...p, volume }))
        writeLocalPrefs({ volume })
        audio.setVolume(volume)
      },
      toggleShuffle: () => {
        const shuffle = !prefs.shuffle
        setPrefs((p) => ({ ...p, shuffle }))
        writeLocalPrefs({ shuffle })
        // A fresh order each time shuffle is switched on, so turning it off and
        // on again is a reshuffle rather than the same sequence.
        if (shuffle) setShuffleSeed((seed) => seed + 1)
      },
      cycleRepeat: () => {
        const order: Array<RepeatMode> = ["off", "all", "one"]
        const repeat = order[(order.indexOf(prefs.repeat) + 1) % order.length]
        setPrefs((p) => ({ ...p, repeat }))
        writeLocalPrefs({ repeat })
      },
      stop: () => {
        audio.stop()
        setPlaying(false)
      },
      pause: () => {
        audio.pause()
        setPlaying(false)
      },
      onUserPick,
    }),
    [
      advance,
      audio,
      blocked,
      current,
      onUserPick,
      playRef,
      playing,
      prefs,
      toggle,
      tracks,
    ]
  )

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>
}

export { trackRefKey }
