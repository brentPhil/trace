import { useEffect, useRef } from "react"
import { convexQuery, useConvexMutation } from "@convex-dev/react-query"
import { useQuery } from "@tanstack/react-query"
import { useMusic } from "@/components/music/music-provider"
import { readLocalPrefs } from "@/lib/music/local-prefs"
import { CATALOG } from "@/lib/music/catalog"
import { useLatest } from "@/hooks/use-latest"
import { api } from "../../convex/_generated/api"
import type { TrackRef } from "@/lib/music/track-ref"
import type { Doc, Id } from "../../convex/_generated/dataModel"

/**
 * THE ONLY FILE THAT KNOWS ABOUT BOTH HALVES.
 *
 * The tracker never learns what audio is; the player never learns what an entry
 * is. Everything coupling them is here, so deleting this one file removes the
 * feature and leaves both sides working — which is the test of whether the
 * boundary is real rather than decorative.
 */
type MusicSettings = {
  musicAutoplay: boolean
  musicOnStop: "stop" | "pause" | "continue"
}

/**
 * Widens a `TrackRef` into the shape `api.music.setPreference` generates from
 * the schema's validator.
 *
 * `track-ref.ts` keeps `trackId` a plain `string` ON PURPOSE — its own
 * comment says so — so that module stays free of generated Convex types and
 * can run in the pure `unit` test project instead of needing a Convex
 * context. That means the branded `Id<"musicTracks">` TypeScript wants here
 * does not exist on the value TypeScript can see, only on the one Convex's
 * validator checks at the server boundary. The cast belongs at THIS seam,
 * where a plain ref crosses into a Convex call, rather than either loosening
 * the generated mutation's argument type or teaching the shared module about
 * branded ids it is deliberately built to avoid.
 */
function toPreferenceTrackRef(
  ref: TrackRef
):
  | { origin: "upload"; trackId: Id<"musicTracks"> }
  | { origin: "chroneli"; slug: string } {
  return ref.origin === "upload"
    ? { origin: "upload", trackId: ref.trackId as Id<"musicTracks"> }
    : ref
}

export function useMusicTracking(
  running: Doc<"timeEntries"> | null,
  settings: MusicSettings
): void {
  const music = useMusic()
  const setPreference = useLatest(useConvexMutation(api.music.setPreference))

  const title = running?.title.trim() ?? ""
  const projectId = running?.projectId ?? null

  // Skipped entirely for a blank title — inherited from `groupSittings`, which
  // refuses to group an untitled entry. Without it every unnamed entry in the
  // account would share one preference and overwrite it in turn.
  const { data: preference, isPending: preferencePending } = useQuery({
    ...convexQuery(api.music.preferenceFor, { title, projectId }),
    enabled: title !== "",
  })

  /*
   * RECORDING A CHOICE, NOT A FALLBACK.
   *
   * Only a user pick writes. Writing on start would mean the resolver's own
   * arbitrary third-choice fallback becomes a stored preference
   * indistinguishable from a deliberate one, and within a week every record in
   * the account "prefers" the first catalog track.
   */
  // `useLatest` takes a FUNCTION and returns a permanently stable one that
  // always calls the newest closure. It is NOT a ref: passing it an object is
  // a type error, and reading `.current` off its result is another. Task 6
  // learned this the expensive way — see commit 15ef1d4.
  const context = useLatest(() => ({ title, projectId }))

  /*
   * SUPPRESSING THE RESOLVER'S OWN NOTIFICATION.
   *
   * `playRef` (music-provider.tsx) has exactly one call site for "the user
   * clicked a track" (music-controls.tsx) and exactly one for "the timer
   * just started and something has to play" (the effect below) — and it is
   * the SAME function either way. It notifies every `onUserPick` listener
   * unconditionally, synchronously, before it even starts audio, because
   * from inside the provider a click and a resolver's fallback look
   * identical: both are just "play this ref". The provider has no way to
   * tell them apart, and it should not grow one — teaching `playRef` a
   * second parameter like `{ userInitiated: boolean }` would leak this
   * hook's start-of-timer bookkeeping into a shared API that
   * `music-controls.tsx` and every other future caller would then have to
   * know to set correctly, forever, or silently reintroduce this exact bug.
   * This hook is the only subscriber that ALSO causes picks — every other
   * conceivable listener only reacts to what's playing — so the flag that
   * tells "was this my own call" belongs here, next to the one call site
   * that needs to ask the question, not on the provider that cannot answer
   * it.
   *
   * A plain set/clear around the `playRef` call below is enough because
   * `playRef` notifies synchronously, before any `await` — there is no
   * chance for a re-render or another `playRef` call to interleave between
   * the set and the clear. The `finally` exists only so a throw out of
   * `playRef` (or a future change that makes it throw) can't leave the flag
   * stuck `true` and silently swallow every real user pick afterward.
   */
  const resolvingOwnPick = useRef(false)

  useEffect(
    () =>
      music.onUserPick((ref: TrackRef) => {
        // This notification is the resolver's own `playRef` call below,
        // echoing straight back to the one hook that is subscribed AND
        // caused it. Not a user pick — must not become a stored preference.
        if (resolvingOwnPick.current) return
        const { title: t, projectId: p } = context()
        if (t === "") return
        void setPreference({
          title: t,
          projectId: p,
          trackRef: toPreferenceTrackRef(ref),
        }).catch(() => {
          // A preference that failed to save is not worth interrupting a
          // running timer for. The music is already playing.
        })
      }),
    [context, music, setPreference]
  )

  // `running?._id` rather than `running`: the document's reference changes on
  // every tick of the elapsed-time query, and this must fire once per timer.
  const startedFor = useRef<string | null>(null)

  useEffect(() => {
    const id = running?._id ?? null

    if (id === null) {
      if (startedFor.current !== null) {
        startedFor.current = null
        if (settings.musicOnStop === "stop") music.stop()
        if (settings.musicOnStop === "pause") music.pause()
        // "continue" does nothing, deliberately.
      }
      return
    }

    if (startedFor.current === id) return

    if (!settings.musicAutoplay) {
      // Nothing to resolve — autoplay is off, so no query result could ever
      // change this outcome. Final answer, mark it handled now.
      startedFor.current = id
      return
    }

    /*
     * WAITING FOR THE QUERY TO ACTUALLY SETTLE — `undefined` IS NOT `null`.
     *
     * `useQuery`'s `data` is `undefined` on the first render for any
     * {title, projectId} key that is not already in the cache — that is
     * "haven't heard back yet", not "confirmed, no preference exists". Both
     * `preference ?? fallback` and a `null`-check treat those identically,
     * so folding `data` into the fallback chain on this same render silently
     * promotes priority (3), the arbitrary catalog default, over priority
     * (1), the record's actual stored preference — on every cold-cache
     * start, which is precisely the case this feature is for: opening a
     * fresh tab and picking up a task, and hearing the music that record is
     * associated with rather than whatever track happens to be first.
     *
     * `isPending` is TanStack Query's own name for exactly that "haven't
     * heard back yet" state, so it is what we wait on — but only when the
     * query is actually enabled. A DISABLED query (blank title, see
     * `enabled` above) reports `isPending: true` forever, because it never
     * even starts a fetch to settle; waiting on it for a blank title would
     * mean autoplay never fires for an untitled entry. A blank title has no
     * preference to look up in the first place, so there is nothing to wait
     * for — resolve straight from the fallbacks.
     */
    if (title !== "" && preferencePending) return

    // Already playing something the user chose — re-checked HERE, at the
    // point of actually resolving, rather than only once up front. The
    // branch above can return early and let this effect re-run later once
    // the query lands; in the time between, the user could have started
    // something themselves, and a timer's autoplay must not stomp on music
    // that began while this effect was mid-wait.
    if (music.playing) {
      startedFor.current = id
      return
    }

    // 1. what this record was last using, 2. the last track played on this
    // device, 3. the first catalog track.
    const fallback: TrackRef | null =
      readLocalPrefs().lastTrack ??
      (CATALOG.length === 0
        ? null
        : { origin: "chroneli", slug: CATALOG[0].slug })
    const chosen = preference ?? fallback

    // Only marked handled once actually resolved (immediately for a blank
    // title, or after the query settled for a real one) — setting this any
    // earlier is what let the cold-cache preference get skipped forever,
    // since a later, correct re-run of this effect returns at the very top
    // the moment it sees `startedFor.current === id`. This also covers the
    // timer-stops-while-query-is-in-flight case for free: if `running`
    // clears before this line ever runs, the `id === null` branch above
    // takes over on the next pass, `startedFor.current` was never set for
    // this id, and nothing here plays anything.
    startedFor.current = id
    if (chosen === null) return

    resolvingOwnPick.current = true
    try {
      music.playRef(chosen)
    } finally {
      resolvingOwnPick.current = false
    }
  }, [
    music,
    preference,
    preferencePending,
    running?._id,
    settings.musicAutoplay,
    settings.musicOnStop,
    title,
  ])
}
