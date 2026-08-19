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
  const { data: preference } = useQuery({
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
  useEffect(
    () =>
      music.onUserPick((ref: TrackRef) => {
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
    startedFor.current = id
    if (!settings.musicAutoplay) return
    // Already playing something the user chose — a new timer must not
    // interrupt it with a resolution of its own.
    if (music.playing) return

    // 1. what this record was last using, 2. the last track played on this
    // device, 3. the first catalog track.
    const fallback: TrackRef | null =
      readLocalPrefs().lastTrack ??
      (CATALOG.length === 0
        ? null
        : { origin: "chroneli", slug: CATALOG[0].slug })
    const chosen = preference ?? fallback
    if (chosen !== null) music.playRef(chosen)
  }, [
    music,
    preference,
    running?._id,
    settings.musicAutoplay,
    settings.musicOnStop,
  ])
}
