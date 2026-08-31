import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
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
import type { RepeatMode } from "@/lib/music/queue"
import type { TrackRef } from "@/lib/music/track-ref"
import type { ReactNode } from "react"

export type PlayableTrack = {
  ref: TrackRef
  name: string
  url: string | null
  origin: "chroneli" | "upload"
}

/**
 * One row of `api.music.listTracks`, described STRUCTURALLY rather than
 * imported.
 *
 * The three fields the player actually needs, and not one more: an id to build
 * a `TrackRef` from, a name to draw, and the signed URL (`null` when the blob
 * has gone missing — see `trackReturns` in convex/music.ts). The query also
 * returns `bytes`, `durationMs` and `_creationTime`; a structural type ignores
 * them, so the route can pass the rows through untouched while this file stays
 * a statement of what a PLAYER needs rather than a copy of what the query
 * happens to select today.
 *
 * `_id` is a plain `string`, not `Id<"musicTracks">`, for exactly the reason
 * `track-ref.ts` gives for its own `trackId`: the branded id is a generated
 * Convex type, and a component that imports one has learned the backend's
 * shape. A real `Id` is assignable to this, so `_authed.tsx` passes the query
 * result through untouched and the server's validator remains the only thing
 * that enforces the brand.
 */
export type MusicUpload = {
  _id: string
  name: string
  url: string | null
}

export type MusicContextValue = {
  tracks: Array<PlayableTrack>
  /**
   * Whether `tracks` is the WHOLE library yet, or only the bundled catalog.
   *
   * `tracks` is never empty and never `undefined` — the catalog is compiled
   * into the bundle, so the very first render already has playable rows — and
   * that is exactly what makes "have the uploads landed?" unanswerable from
   * the array itself. A consumer resolving a stored preference cannot tell
   * "this upload does not exist" from "`listTracks` has not come back yet",
   * and the two demand opposite behaviour: give up and fall through, versus
   * wait one render and try again.
   *
   * It is a flag rather than making `tracks` nullable on purpose: nothing else
   * in the feature has to care, the player keeps working against the catalog
   * while the query is in flight, and only `use-music-tracking.ts` — the one
   * consumer that walks a priority chain — ever reads it.
   */
  tracksReady: boolean
  current: PlayableTrack | null
  playing: boolean
  blocked: boolean
  volume: number
  shuffle: boolean
  repeat: RepeatMode
  /**
   * Starts the named track, and says WHETHER ANYTHING STARTED.
   *
   * `false` means nothing began playing, in either of the two ways that can
   * happen: the ref did not resolve against this render's track list — a
   * deleted upload, a catalog slug that no longer ships, or simply
   * `listTracks` not having arrived yet in a cold tab — or it resolved to a
   * row that has no URL to hand an `<audio>` element, which is what an upload
   * whose signed URL failed to resolve looks like in `tracks`.
   *
   * It used to return `void` and swallow the first case, which is how a
   * preference naming a missing track became permanent silence:
   * `use-music-tracking.ts` committed to its first choice, got no signal that
   * nothing happened, and never re-resolved. The boolean is the whole seam
   * that lets a caller walk a priority chain without the provider learning
   * what a priority chain is — and it is only worth anything if `true`
   * really does mean "audio is on its way", which is why the URL-less row
   * counts as a miss rather than as a resolution.
   */
  playRef: (ref: TrackRef) => boolean
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
 *
 * ITS DATA ARRIVES AS A PROP, AND THAT IS THE SAME RULE `TimerBarActions`
 * FOLLOWS. This used to call `useQuery(convexQuery(api.music.listTracks, {}))`
 * itself, which is the shorter diff and the one the codebase forbids — the
 * lint rule in eslint.config.js names the case that earned it: a design
 * harness rendered the timer bar against fixtures while the bar reached for
 * live Convex internally, and fired real writes at the backend carrying
 * fixture ids. Nothing here writes, so the danger is milder; the reason is
 * not. A component that imports `api` has learned the backend's function
 * surface, and every consequence of that follows whether or not the call
 * happens to be a read: it cannot be rendered against fixtures, it cannot be
 * mounted without a Convex client, and the one file allowed to know both
 * halves of this feature stops being the only one that does.
 *
 * The alternative worth arguing with is not "import `api` anyway" but "take
 * the finished `tracks` array as a prop and drop the catalog code too". That
 * is wrong for a specific reason: `CATALOG` is a pure local module, compiled
 * into the bundle, needing no client and no network, and it is what makes this
 * provider render something playable on its very first frame. Pushing it up to
 * the route would make every caller assemble the same two halves in the same
 * order, and would move the one part of the library that CANNOT fail to arrive
 * behind something that can. So the split is: the half that needs a server
 * comes in as a prop, the half that does not is built here.
 *
 * `uploads` being OPTIONAL is what keeps "mount this with no Convex client at
 * all" true — more true than before, since there is no longer a query to fail.
 * A provider rendered with no `uploads` plays the catalog and reports
 * `tracksReady: false`, which is precisely the honest answer: nobody has told
 * it what this account has uploaded.
 */
export function MusicProvider({
  children,
  uploads,
  onError,
}: {
  children: ReactNode
  /**
   * What `api.music.listTracks` returned, or `undefined` while it has not
   * answered — and the DISTINCTION IS LOAD-BEARING, not incidental laxity
   * about optional props.
   *
   * `undefined` means "no answer yet"; `[]` means "this account has uploaded
   * nothing". Both produce the same `tracks` array below — catalog only — and
   * `tracksReady` on the context type exists solely because a consumer
   * resolving a stored upload ref has to tell them apart. Passing the query's
   * `data` straight through preserves that difference for free: TanStack Query
   * already spells "not settled" as `undefined`, so nothing here has to invent
   * a second flag alongside the array and keep the two in step.
   */
  uploads?: Array<MusicUpload>
  /**
   * "One quiet toast", and the reason it is a PROP.
   *
   * The provider importing `Toast` directly would be the shortest diff and
   * the wrong one: it owns the `<audio>` element and nothing else, and a
   * toast dependency makes it unmountable in a test, unusable outside the
   * authed shell, and coupled to the app's notification library forever. A
   * callback is the seam — `_authed.tsx` passes the same `report` handler
   * every other failure in the shell already goes through, so music errors
   * look and behave like the rest of the product instead of like a second,
   * parallel notification system.
   *
   * Optional because the provider must stay mountable with no wiring at all.
   */
  onError?: (message: string) => void
}) {
  // The whole of "has the library arrived?", derived from the prop rather than
  // held as a second one. Two props that must agree is two props that can
  // disagree; see the `uploads` doc above and `tracksReady` on the context
  // type.
  const tracksReady = uploads !== undefined

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
    const uploadUrls = new Map<string, string>(
      (uploads ?? []).map((t) => [t._id, t.url ?? ""])
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
        ref: { origin: "upload" as const, trackId: track._id },
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

  // `onError` behind a ref, written during render exactly as `stateRef` below
  // is. `_authed.tsx` builds its `report` handler inline, so the prop is a new
  // function on every render of the shell; depending on it directly would make
  // `failAndAdvance` — and through it the `useAudioElement` callbacks, and
  // through those the element itself — rebuild on every render, which restarts
  // the track. That is the same trap the destructuring comment below records.
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

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
      // ONE toast, HERE, and not one per skipped track. A single unplayable
      // file in a healthy library is a non-event — the queue steps past it and
      // the user hears music, so telling them about it would be noise about a
      // problem that already fixed itself. What deserves saying is the moment
      // the music stops without anyone having asked it to, which is precisely
      // this branch: every candidate the queue could reach failed. Firing per
      // skip would also mean a library of ten dead uploads produces ten
      // stacked toasts for one silence, which is how "ghost" was specified
      // against in the first place.
      onErrorRef.current?.("Music stopped — those tracks could not be played.")
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
      // The ref, not just the state. `setCurrentRef` is QUEUED, and the null-url
      // path below calls into `advance` synchronously — with no render in between,
      // `advance` would read the PREVIOUS track from `stateRef` and re-pick this
      // same dead one until the failure budget ran out, never reaching the track
      // after it. Writing both is what makes the skip actually step forward.
      stateRef.current = { ...stateRef.current, currentRef: track.ref }
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
        // The current track is gone from the list (or the list is empty) —
        // this attempt is over and unrelated to whatever happens next, so the
        // failure budget must not carry forward into a future, unrelated
        // playback attempt. `failAndAdvance` already incremented it to get us
        // here; leaving it non-zero would let a handful of stale failures
        // trip the bound early on a perfectly healthy next attempt.
        failures.current = 0
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
        // `blocked` means "the browser refused to start playback" — that is
        // simply not true once the queue has run out and there is nothing
        // left to play. Leaving it set would show a stale "click to play"
        // affordance over a player that stopped on its own, not one the
        // browser rejected.
        setBlocked(false)
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
    (ref: TrackRef): boolean => {
      const track = tracks.find((t) => trackRefEquals(t.ref, ref))
      // The listeners fire ONLY on a resolved ref, unchanged: `onUserPick` is
      // how a pick becomes a stored preference, and announcing a ref that
      // named nothing would write a preference for a track that does not
      // exist — manufacturing the exact dangling row `preferenceForImpl` now
      // has to defend against.
      if (track === undefined) return false
      // A ROW WITH NO URL IS NOT A RESOLUTION EITHER.
      //
      // An upload whose signed URL failed to resolve is still IN `tracks` —
      // `listTracksImpl` hands back the row with `url: null` so the panel can
      // draw it and say "unavailable" rather than silently dropping a file the
      // user knows they uploaded. Returning `true` for it made the caller's
      // priority walk stop on a track that could never play: the resolver
      // recorded `startedByUs: true`, which is the flag that later licenses
      // `musicOnStop` to silence a player this hook never actually started.
      //
      // The deliberate cost: clicking an "unavailable" row in the panel is now
      // a no-op instead of advancing the queue through `start`'s
      // `failAndAdvance`. That is the honest behaviour — the row already says
      // the track cannot be played, so stepping to a DIFFERENT track would be
      // the surprising outcome — and it is a strictly better answer than
      // reporting a start that did not occur.
      if (track.url === null || track.url === "") return false
      for (const listener of pickListeners.current) listener(ref)
      void start(track)
      return true
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
      // COLD START — nothing is current because nothing has played in this
      // tab yet. `currentRef` is state, so a reload empties it; it is never
      // rehydrated from `prefs.lastTrack`, deliberately, because rehydrating
      // it would make a reloaded tab claim to be "on" a track it has not
      // loaded and cannot resume. But pressing Play with no current track is
      // an instruction to start SOMETHING, and the last thing this device
      // played is a far better guess at what than the first row of the
      // catalog — the autoplay resolver in `use-music-tracking.ts` has always
      // honoured `lastTrack` at exactly this priority, and Play disagreeing
      // with autoplay about the same question is the kind of inconsistency
      // nobody can explain to a user. Falls back to `tracks[0]` when the
      // remembered track is gone from the list (deleted upload, uploads not
      // loaded yet), which is the same fall-through the resolver performs.
      const remembered =
        prefs.lastTrack === null
          ? undefined
          : tracks.find((t) => trackRefEquals(t.ref, prefs.lastTrack))
      // `.at(0)`, not `[0]`. This project does not set
      // `noUncheckedIndexedAccess`, so `tracks[0]` types as a `PlayableTrack`
      // even on an empty array and the guard below reads to the linter as dead
      // code — while at runtime it is the only thing standing between an empty
      // list and `start(undefined)`. `.at` returns `PlayableTrack | undefined`,
      // which is what is actually true, so the check survives on its own merits
      // rather than as a suppression. Today `tracks` always holds the compiled-in
      // catalog and cannot be empty; that is a fact about `catalog.ts`, not
      // about this function, and it stops being true the day the catalog moves
      // to R2 — the exact move `resolveTrackUrl`'s indirection exists for.
      const track = remembered ?? tracks.at(0)
      if (track === undefined) return
      void start(track)
      return
    }
    void resume().then((ok) => {
      setPlaying(ok)
      setBlocked(!ok)
    })
  }, [current, pause, playing, prefs.lastTrack, resume, start, tracks])

  const value = useMemo<MusicContextValue>(
    () => ({
      tracks,
      tracksReady,
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
        // Named `modes`, not `order`: `order` is already the shuffle
        // permutation memoised above, and two different things under one name
        // in nested scopes is how a later edit reaches for the wrong one.
        const modes: Array<RepeatMode> = ["off", "all", "one"]
        const repeat = modes[(modes.indexOf(prefs.repeat) + 1) % modes.length]
        setPrefs((p) => ({ ...p, repeat }))
        writeLocalPrefs({ repeat })
      },
      stop: () => {
        stop()
        setPlaying(false)
        // Deliberate user action, not a browser rejection — a lingering
        // "click to play" affordance over a player the user just stopped
        // would be describing a refusal that never happened.
        setBlocked(false)
      },
      pause: () => {
        pause()
        setPlaying(false)
        // Same reasoning as `stop` above: pausing is the user's choice, so
        // whatever `blocked` was tracking is moot the moment they act.
        setBlocked(false)
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
      // Listed even though it changes exactly once per mount: a new context
      // value on the render where the uploads land is precisely what re-runs
      // `use-music-tracking.ts`'s resolver, which is deliberately holding off
      // committing an upload preference until this flips.
      tracksReady,
    ]
  )

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>
}

export { trackRefKey }
