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
   * WHAT HAS ALREADY BEEN RESOLVED, AND WHETHER WE ARE THE ONES PLAYING.
   *
   * Declared above the pick listener rather than beside the resolver it mostly
   * serves, because BOTH write it: the resolver sets it, and a genuine user
   * pick clears `startedByUs` on it. A reader who meets the listener first
   * should meet this first too.
   *
   * `running?._id` rather than `running` for the read below: the document's
   * reference changes on every tick of the elapsed-time query, and this must
   * not re-fire on each one.
   *
   * THE KEY IS THE RESOLUTION'S INPUTS, NOT THE ENTRY ID. Keying on the id
   * alone made resolution a once-per-entry event fired at entry CREATION, and
   * the ordinary way a timer is started is: press start, then type what you
   * are doing. At creation the title is `""`, so `preferenceFor` is disabled,
   * there is no preference to consult, resolution lands on the default track —
   * and the id is pinned. The title arriving a few seconds later re-runs this
   * effect, which returns at the top, so the record's remembered track was
   * consulted on precisely the entries nobody names up front, i.e. almost
   * none. Keying on `{id, title, projectId}` makes a title (or a project)
   * arriving after start count as a NEW question, which it is.
   *
   * THE RE-RESOLVE IS SUBORDINATE TO EVERY DECISION ALREADY MADE ABOUT SOUND,
   * DELIBERATELY. Three guards sit ahead of it and each one wins outright, so
   * the second resolution takes effect in exactly one situation: nothing is
   * playing and nothing this hook started was ever silenced by hand.
   *
   *   - Music is PLAYING (`music.playing`): typing a title over music does not
   *     switch the track. Yanking a track out from under someone mid-listen
   *     because they corrected a typo is a product that cannot be trusted to
   *     be left running.
   *   - We started something and it is NOT playing (`startedByUs` without
   *     `blocked`): the user turned it off. This is the most common of the
   *     three and the one the guard list used to omit — press start, hear
   *     music, hit the speaker button, then type the description, and the
   *     re-resolve started the audio back up.
   *   - The browser REFUSED (`blocked`): the one case worth retrying, because
   *     playback never began and the very keystroke that changed the title is
   *     the user gesture that can lift the refusal.
   *
   * So in practice the re-resolve serves the cold start: a title arriving over
   * silence, over a blocked autoplay, or over a first resolution that found
   * nothing playable. That is the trade the project owner chose.
   *
   * `startedByUs` rides along because the stop branch needs it — see there.
   */
  const startedFor = useRef<{ key: string; startedByUs: boolean } | null>(null)

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
        // THE USER HAS TAKEN THE WHEEL, so this hook no longer owns what is
        // playing. `startedByUs` is the permission slip for `musicOnStop`, and
        // leaving it set through a hand-picked track means stopping the timer
        // silences a track the user chose themselves — the same violation the
        // `startedByUs` flag was introduced to fix, arriving by a different
        // route. Clearing it rather than re-deriving it later is what keeps
        // "did WE start this?" answerable from one field: the answer became
        // "no" at this exact moment, and nothing downstream has to reconstruct
        // when that happened. The key is kept as-is — this is not a new
        // resolution, only a change of owner.
        const owned = startedFor.current
        if (owned !== null) {
          startedFor.current = { key: owned.key, startedByUs: false }
        }
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

  useEffect(() => {
    const id = running?._id ?? null

    if (id === null) {
      const prior = startedFor.current
      if (prior !== null) {
        startedFor.current = null
        // A USER'S OWN PLAYBACK IS THEIRS, AND THE TRACKER DOES NOT GET TO
        // STOP IT. `startedFor` used to be set on every path through the
        // resolver — including the autoplay-OFF path and the
        // already-playing path — so it recorded "this entry has been seen",
        // not "this hook started audio". `musicOnStop` was then applied on
        // the strength of it, which meant switching autoplay off, pressing
        // play by hand, and later stopping the timer silenced music this
        // hook had nothing to do with. The user never connected the two
        // actions, and could not have: nothing on screen links a timer they
        // told not to touch the music to the music stopping.
        if (prior.startedByUs) {
          if (settings.musicOnStop === "stop") music.stop()
          if (settings.musicOnStop === "pause") music.pause()
          // "continue" does nothing, deliberately.
        }
      }
      return
    }

    const key = `${id}\0${title}\0${projectId ?? ""}`

    // `\0` as the separator for `sittingKey`'s reason: a user-supplied string
    // must not be able to impersonate another key by containing the delimiter,
    // and a title is entirely user-supplied.
    if (startedFor.current?.key === key) return

    // Carried across re-resolutions of the same running timer. A title
    // arriving after start mints a new key, but it does not un-start the audio
    // this hook already began — and if the stop branch above forgot that, the
    // fix for `musicOnStop` would break the ordinary case it exists for.
    const startedByUs = startedFor.current?.startedByUs ?? false

    if (!settings.musicAutoplay) {
      // Nothing to resolve — autoplay is off, so no query result could ever
      // change this outcome. Final answer, mark it handled now.
      startedFor.current = { key, startedByUs }
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
      startedFor.current = { key, startedByUs }
      return
    }

    /*
     * MUSIC THIS HOOK STARTED, AND THAT IS NOT PLAYING NOW, WAS TURNED OFF BY
     * THE USER — AND THEIR CHOICE OUTRANKS ANY RE-RESOLUTION.
     *
     * `music.playing` above protects sound that is CURRENTLY COMING OUT. It
     * says nothing about sound the user deliberately stopped, and the ordinary
     * flow walks straight through that hole: press start (title is `""`, the
     * catalog default plays, `startedByUs` becomes true), decide you do not
     * want music and press the speaker button (`pause()`, `playing: false`),
     * then type the description — or pick a project, which now sits in the
     * same footer strip. A new key is minted, `playing` is false, the chain
     * walks, and the audio the user just silenced starts again. This is the
     * same class of violation as applying `musicOnStop` to a track this hook
     * never started: the tracker overriding a music decision made by hand.
     *
     * `blocked` is the exception, and the reason this is not simply
     * `startedByUs`: there, playback never actually began because the browser
     * refused it, so there is nothing the user could have silenced — and the
     * very interaction that changed the title is the user gesture that can
     * lift the refusal. Retrying is the whole point in that case.
     *
     * The key is still committed. This is a decided question, not a deferred
     * one: nothing arriving later makes silence the user asked for wrong.
     */
    if (startedByUs && !music.blocked) {
      startedFor.current = { key, startedByUs }
      return
    }

    /*
     * AN UPLOAD PREFERENCE CANNOT BE JUDGED AGAINST A LIST THAT HAS NOT
     * ARRIVED.
     *
     * `music.tracks` is never empty — the catalog is compiled into the bundle
     * — so a cold tab can resolve, play the catalog default and pin the key
     * before `listTracks` has come back. `preferenceFor` is a single index
     * read while `listTracks` costs one signed-URL round trip per row, so the
     * preference really does arrive first, and the record's remembered upload
     * loses to the arbitrary third-choice fallback on exactly the flow this
     * feature exists for: opening a fresh tab and picking a task back up.
     *
     * This used to be "handled" by declining to commit `startedFor` when
     * candidates existed and none resolved — a branch that could never run,
     * because the candidate list always ends with a catalog slug and catalog
     * tracks are in `music.tracks` unconditionally. The last candidate always
     * resolved, so the retry the comment there promised was fiction.
     *
     * `tracksReady` is the fact that was missing: the provider now says
     * whether `listTracks` has answered at all. Deliberately NOT committing
     * `startedFor` is what makes this a WAIT rather than a decision — the
     * provider mints a new context value on the render the uploads land,
     * `music` is a dependency of this effect, so the effect re-runs and
     * resolves against the real list. It cannot spin: `tracksReady` flips once
     * per mount and never flips back, and the guard is narrow enough that
     * neither a blank title (no preference at all) nor a catalog preference
     * ever reaches it — those have nothing to wait for.
     */
    if (
      !music.tracksReady &&
      preference !== undefined &&
      preference !== null &&
      preference.origin === "upload"
    ) {
      return
    }

    /*
     * A CHAIN THAT IS WALKED, NOT A CHOICE THAT IS COMMITTED TO.
     *
     * 1. what this record was last using, 2. the last track played on this
     * device, 3. the first catalog track — unchanged in priority, changed in
     * how a miss is handled. The old code collapsed all three into one
     * `preference ?? fallback` and handed the winner to `playRef`, which
     * returned `void` and did nothing at all if the ref named no track in the
     * list. So a preference pointing at a deleted upload did not fall through
     * to (2) or (3) as the spec promised — it produced SILENCE, permanently,
     * because `startedFor` was pinned on the way past. `playRef` now reports
     * whether it resolved, and this loop stops at the first candidate that
     * actually started something.
     */
    const candidates: Array<TrackRef> = []
    // `undefined` (query not settled) is unreachable here — the
    // `preferencePending` guard above already returned — but it is part of the
    // type and is not a candidate either way, so both empties are excluded
    // explicitly rather than through a truthiness test that would also silently
    // swallow a future falsy member of `TrackRef`.
    if (preference !== undefined && preference !== null) {
      candidates.push(preference)
    }
    const lastTrack = readLocalPrefs().lastTrack
    if (lastTrack !== null) candidates.push(lastTrack)
    if (CATALOG.length > 0) {
      candidates.push({ origin: "chroneli", slug: CATALOG[0].slug })
    }

    // The suppression flag wraps the WHOLE walk rather than each call: every
    // `playRef` in here is this resolver's own, and a `finally` around the
    // loop means a throw from any one of them still clears it. See the long
    // comment on `resolvingOwnPick` above for why the flag lives here at all.
    let started = false
    resolvingOwnPick.current = true
    try {
      for (const candidate of candidates) {
        if (music.playRef(candidate)) {
          started = true
          break
        }
      }
    } finally {
      resolvingOwnPick.current = false
    }

    /*
     * MARKED HANDLED ONLY WHEN THERE IS SOMETHING TO HANDLE.
     *
     * Started: obviously done, and `startedByUs` is now true, which is what
     * earns this hook the right to apply `musicOnStop` later.
     *
     * Nothing started but there were no candidates at all: the library is
     * genuinely empty — no preference, no remembered track, no catalog — and
     * no re-run of this effect can change that, so mark it and stop. Retrying
     * forever on an empty library is a re-render loop nobody can see.
     *
     * Nothing started BUT candidates existed: every one of them failed to
     * resolve. Deliberately NOT marked, so a later render can try again —
     * though note this is a backstop, not the cold-tab fix it was once
     * described as. In the shipped app the walk always ends at a catalog slug
     * and catalog tracks are in `music.tracks` unconditionally, so this branch
     * is only reachable if the catalog itself is empty of playable files. The
     * uploads-are-still-loading race is closed ahead of the walk, by the
     * `tracksReady` guard above, which is the only place that can distinguish
     * "this upload does not exist" from "the list has not arrived".
     *
     * This also covers the timer-stops-while-the-query-is-in-flight case for
     * free: if `running` clears before any of this ran, the `id === null`
     * branch takes over with `startedFor.current` still null and stops nothing.
     */
    if (started || candidates.length === 0) {
      // `||`, not `= started`: a re-resolution that starts nothing must not
      // erase the fact that an EARLIER resolution for this same timer did.
      startedFor.current = { key, startedByUs: startedByUs || started }
    }
  }, [
    music,
    preference,
    preferencePending,
    projectId,
    running?._id,
    settings.musicAutoplay,
    settings.musicOnStop,
    title,
  ])
}
