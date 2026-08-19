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

type ShuffleCache = { seed: number; keys: Array<string> } | null

/**
 * The shuffle order, expressed as track IDENTITIES and reconciled against
 * whatever the track list looks like this render — never regenerated from
 * scratch just because the list changed shape.
 *
 * Calling `shuffledOrder(tracks.length, seed)` again every time `tracks`
 * changed was the earlier bug here: `listTracksImpl` (convex/music.ts) sorts
 * uploads ALPHABETICALLY BY NAME, so a newly arrived upload does not merely
 * append to the list — it can insert anywhere in the middle, shifting the
 * index of every upload that sorts after it. Regenerating on every change
 * reshuffles a queue the user is already mid-way through; the tempting
 * middle ground of only regenerating when the length grows would still be
 * wrong on its own, because a plain array of indices goes silently stale
 * the instant an insertion (not just an append) shifts what index N means —
 * `order` would keep pointing at the position, not the track. Keying by
 * `TrackRef` instead of by raw index sidesteps both problems: a track
 * already in the sequence keeps its place no matter where the array moves
 * it around, and only a track with no prior entry counts as "new" and gets
 * appended.
 */
function reconcileShuffleOrder(
  cache: ShuffleCache,
  currentKeys: Array<string>,
  seed: number
): Array<string> {
  if (cache === null || cache.seed !== seed) {
    // Shuffle just switched on, or the seed changed because the user
    // explicitly asked for a reshuffle (`toggleShuffle`) — nothing worth
    // preserving, so a full fresh permutation.
    return shuffledOrder(currentKeys.length, seed).map((i) => currentKeys[i])
  }
  const known = new Set(currentKeys)
  // Survivors keep the relative order they already had; a key with no
  // match in `known` names a track that was deleted and simply drops out.
  const kept = cache.keys.filter((key) => known.has(key))
  const keptSet = new Set(kept)
  const arrivedKeys = currentKeys.filter((key) => !keptSet.has(key))
  // New tracks are shuffled only AMONG THEMSELVES, then appended — never
  // interleaved with the existing sequence. That is what "does not reorder
  // a queue already in progress" means in practice; the seed offset just
  // keeps successive arrivals from all landing in the same relative order.
  const shuffledArrivals = shuffledOrder(
    arrivedKeys.length,
    seed + cache.keys.length
  ).map((i) => arrivedKeys[i])
  return [...kept, ...shuffledArrivals]
}

/** Generates a per-tab id, lazily and client-side only — see the announce
 *  effect below, which is the only caller, for why this must never run
 *  during render. */
function mintTabId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

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

  // Caches the shuffle sequence between renders, keyed by track identity
  // rather than by index — see `reconcileShuffleOrder` above for why.
  const shuffleCacheRef = useRef<ShuffleCache>(null)

  const order = useMemo(() => {
    if (!prefs.shuffle) {
      shuffleCacheRef.current = null
      return null
    }
    const currentKeys = tracks.map((t) => trackRefKey(t.ref))
    const keys = reconcileShuffleOrder(
      shuffleCacheRef.current,
      currentKeys,
      shuffleSeed
    )
    shuffleCacheRef.current = { seed: shuffleSeed, keys }
    // `keys` is a permutation of `currentKeys` (see `reconcileShuffleOrder`),
    // so every lookup below succeeds and `indices` ends up the same length
    // as `tracks` — a full permutation of `0..tracks.length-1`, matching
    // what `QueuePosition.order` promises its callers.
    const keyToIndex = new Map(currentKeys.map((key, i) => [key, i] as const))
    const indices: Array<number> = []
    for (const key of keys) {
      const i = keyToIndex.get(key)
      if (i !== undefined) indices.push(i)
    }
    return indices
  }, [prefs.shuffle, shuffleSeed, tracks])

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

  // Shared by a genuine decode/network error (`onError` below) and by
  // `start` finding a track with no URL at all: both mean "this track
  // cannot play, move on", and both need to count against the same bound —
  // otherwise a library that is entirely dead URLs advances forever instead
  // of stopping.
  const failAndAdvance = useCallback(() => {
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
  }, [])

  // Destructured rather than kept as `audio.play`/`audio.pause`/etc: the
  // object `useAudioElement` returns is a fresh literal on every render even
  // though each callback inside it is individually `useCallback`-stable, so
  // depending on the OBJECT (`[audio]`) instead of on the functions it
  // contains defeats every memoization below that depends on it — effects
  // that should run once on mount instead run on every render, and the
  // context `value` memo at the bottom never actually memoizes. Depending on
  // the individual functions fixes all of that for free, because they really
  // are stable. `useAudioElement` itself is shared and out of scope here.
  const { play, resume, pause, stop, setVolume } = useAudioElement({
    onEnded: () => void advanceRef.current(1, "ended"),
    onError: failAndAdvance,
  })

  const start = useCallback(
    async (track: PlayableTrack) => {
      setCurrentRef(track.ref)
      writeLocalPrefs({ lastTrack: track.ref })
      if (track.url === null || track.url === "") {
        // No URL to play — most likely an upload whose storage URL failed
        // to resolve. This used to just stop the session outright, which
        // meant one bad upload froze the whole queue even though the
        // failure-and-advance machinery below existed for exactly this
        // case. Routing it through the same path a playback error takes
        // means it costs one failure against the bound instead of ending
        // the session.
        failAndAdvance()
        return
      }
      const ok = await play(track.url)
      setPlaying(ok)
      setBlocked(!ok)
      if (ok) failures.current = 0
    },
    [failAndAdvance, play]
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
        stop()
        setPlaying(false)
        return
      }
      await start(state.tracks[target])
    },
    [start, stop]
  )

  // Keeps `advanceRef` pointed at the current `advance` closure, so the
  // `useAudioElement` callbacks above — created once, before `advance` exists —
  // always call the live version rather than a stale one captured on mount.
  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  useEffect(() => {
    setVolume(prefs.volume)
  }, [setVolume, prefs.volume])

  // This tab's own identity for the "who started playing" announcements
  // below. A ref, not state — it never needs to trigger a render — and
  // populated lazily by the announce effect rather than here or in
  // `useState`'s initialiser, because this component renders on the SERVER
  // during SSR, where `crypto` may not behave the same as it does on the
  // client. The value never reaches markup, so it could not cause a
  // hydration mismatch either way, but minting it only in an effect means
  // that stays true by construction instead of by accident.
  const tabId = useRef<string | null>(null)

  /**
   * Two pinned tabs are two players, and Chroneli is explicitly a pinned-tab
   * app — so this WILL happen. Whichever tab starts most recently wins.
   *
   * Deps `[pause]` rather than `[audio]`: `pause` is genuinely stable, so
   * this effect really does open the channel once, on mount, as the shape
   * of the code implies — not on every render, which is what depending on
   * the unstable `audio` object used to do.
   */
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      // `BroadcastChannel#postMessage` excludes only the SENDING OBJECT
      // from delivery — every other channel opened on this channel name in
      // the SAME DOCUMENT still receives the message, tab or no tab. The
      // announce effect below opens its own, second channel object in this
      // very document every time this tab starts playing, so without the
      // tag-and-ignore check here, this listener receives its own tab's
      // announcement and immediately pauses the audio it just started —
      // playback becomes impossible even with a single tab open. It is
      // tempting to "simplify" this back to a bare string message once that
      // symptom stops reproducing; don't — the exclusion rule above never
      // covered same-document delivery, so the self-pause returns the
      // moment the tag is dropped.
      if (event.data?.tab === tabId.current) return
      pause()
      setPlaying(false)
    }
    return () => channel.close()
  }, [pause])

  useEffect(() => {
    if (!playing || typeof BroadcastChannel === "undefined") return
    if (tabId.current === null) tabId.current = mintTabId()
    const channel = new BroadcastChannel(CHANNEL)
    channel.postMessage({ tab: tabId.current })
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
      pause()
      setPlaying(false)
      return
    }
    if (current === null) {
      const track = tracks[0]
      if (track === undefined) return
      void start(track)
      return
    }
    void resume().then((ok) => {
      setPlaying(ok)
      setBlocked(!ok)
    })
  }, [current, pause, playing, resume, start, tracks])

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
      // Calls the destructured `setVolume`/`stop`/`pause` from
      // `useAudioElement` above, NOT itself — an object literal's key does
      // not bind its own name inside the function assigned to it, so this
      // resolves through the ordinary closure over the outer `const`.
      setVolume: (volume: number) => {
        // State first so the slider tracks the thumb; localStorage is written
        // in the same call because it is synchronous and cheap. NEITHER is a
        // network round trip, which is the whole reason volume is not a
        // Convex field.
        setPrefs((p) => ({ ...p, volume }))
        writeLocalPrefs({ volume })
        setVolume(volume)
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
        stop()
        setPlaying(false)
      },
      pause: () => {
        pause()
        setPlaying(false)
      },
      onUserPick,
    }),
    [
      advance,
      blocked,
      current,
      onUserPick,
      pause,
      playRef,
      playing,
      prefs,
      setVolume,
      stop,
      toggle,
      tracks,
    ]
  )

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>
}

export { trackRefKey }
