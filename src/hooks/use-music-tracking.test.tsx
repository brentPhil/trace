import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook } from "@testing-library/react"
// NO `user-event` import, and no jest-dom matchers — neither is a dependency.
import { afterEach, describe, expect, it, vi } from "vitest"
import { CATALOG } from "@/lib/music/catalog"
import { trackRefKey } from "@/lib/music/track-ref"
import { convexKey } from "@/test-utils/convex-query"
import { makeEntry } from "@/test-utils/fixtures"
import { useMusicTracking } from "./use-music-tracking"
import { api } from "../../convex/_generated/api"
import type { MusicContextValue } from "@/components/music/music-provider"
import type { TrackRef } from "@/lib/music/track-ref"
import type { Doc, Id } from "../../convex/_generated/dataModel"
import type { ReactNode } from "react"
import type * as ConvexReactQueryModuleType from "@convex-dev/react-query"

type ConvexReactQueryModule = typeof ConvexReactQueryModuleType

/*
 * THE ONLY FILE THAT KNOWS ABOUT BOTH HALVES — and, until this file existed,
 * the only one in the feature with no tests at all.
 *
 * Three defects were found in it by reading rather than by running: a
 * re-resolution that restarted music the user had deliberately silenced, a
 * documented cold-tab retry whose branch could never execute, and a `playRef`
 * contract that reported success for a track it could not play. Every one of
 * them is a SEQUENCE — start, then pause, then type — which is precisely what
 * a reader has to simulate in their head and what a test does for free.
 *
 * So the shape here is: drive the hook through sequences with `rerender`, and
 * assert only on what the hook asks the provider to DO (`playRef`, `stop`,
 * `pause`) and what it writes (`setPreference`). Nothing here reaches for
 * `startedFor` or any other internal — those are the hook's bookkeeping, and a
 * test that asserted on them would have passed just as happily with the bugs
 * in place.
 */

const { setPreference, installed } = vi.hoisted(() => ({
  setPreference: vi.fn(async () => null),
  // A BOX rather than a value: `vi.mock`'s factory is hoisted above every
  // declaration in this file and may not close over one, but it may close over
  // a `vi.hoisted` result — and each test needs to swap the provider's state
  // (playing, blocked, tracksReady) between renders.
  installed: { current: null as MusicContextValue | null },
}))

vi.mock("@convex-dev/react-query", async (importOriginal) => {
  const actual = await importOriginal<ConvexReactQueryModule>()
  // `convexQuery` is kept REAL — it is a pure query-options factory, and
  // keeping it means the key this test seeds is the key the hook subscribes
  // to rather than a second spelling that could drift from it. Only the
  // mutation needs standing in for, because it is the one thing here that
  // would otherwise want a live Convex client.
  return { ...actual, useConvexMutation: () => setPreference }
})

vi.mock("@/components/music/music-provider", () => ({
  useMusic: () => {
    if (installed.current === null) {
      throw new Error("no music stub installed for this test")
    }
    return installed.current
  },
}))

/**
 * The provider's `onUserPick` subscribers, held HERE rather than inside a
 * stub, so that swapping the stub mid-test (to flip `playing` or
 * `tracksReady`) does not silently drop the hook's subscription the way a
 * per-stub `Set` would.
 */
const listeners = new Set<(ref: TrackRef) => void>()

const onUserPick = (listener: (ref: TrackRef) => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/**
 * A `playRef` that behaves like the real one in the two ways this hook can
 * actually observe: it reports whether anything started, and it notifies every
 * pick listener SYNCHRONOUSLY on the way past — including when the caller is
 * the resolver itself, because the provider cannot tell a click from a
 * fallback. That second property is not decoration: the hook's suppression
 * flag exists solely because of it, and a stub that skipped the notification
 * would make the "a start does not write a preference" tests pass for the
 * wrong reason.
 */
function makePlayer(resolves: (ref: TrackRef) => boolean = () => true) {
  return {
    playRef: vi.fn((ref: TrackRef): boolean => {
      if (!resolves(ref)) return false
      for (const listener of listeners) listener(ref)
      return true
    }),
    stop: vi.fn(),
    pause: vi.fn(),
  }
}

type Player = ReturnType<typeof makePlayer>

function stub(
  player: Player,
  over: Partial<MusicContextValue> = {}
): MusicContextValue {
  return {
    // The hook never reads `tracks` — it asks `playRef` and believes the
    // answer, which is the entire point of that boolean. An empty list here is
    // a fact about the hook's surface, not a shortcut.
    tracks: [],
    tracksReady: true,
    current: null,
    playing: false,
    blocked: false,
    volume: 0.6,
    shuffle: false,
    repeat: "all",
    playRef: player.playRef,
    toggle: () => {},
    next: () => {},
    previous: () => {},
    setVolume: () => {},
    toggleShuffle: () => {},
    cycleRepeat: () => {},
    stop: player.stop,
    pause: player.pause,
    onUserPick,
    ...over,
  }
}

const CATALOG_DEFAULT: TrackRef = {
  origin: "chroneli",
  slug: CATALOG[0].slug,
}
const UPLOAD: TrackRef = { origin: "upload", trackId: "t1" }

const AUTOPLAY = { musicAutoplay: true, musicOnStop: "stop" as const }

type Settings = {
  musicAutoplay: boolean
  musicOnStop: "stop" | "continue"
}
type Props = { running: Doc<"timeEntries"> | null; settings: Settings }

/** A running entry, as the shell hands one over. Only `_id`, `title` and
 *  `projectId` are ever read. */
function entry(title: string, projectId: Id<"projects"> | null = null) {
  return makeEntry({
    title,
    ...(projectId === null ? {} : { projectId }),
    endedAt: undefined,
  })
}

const preferenceKey = (
  title: string,
  projectId: Id<"projects"> | null = null
) => convexKey(api.music.preferenceFor, { title, projectId })

function render(props: Props, seed: Array<[string, TrackRef | null]> = []) {
  const client = new QueryClient({
    // No `queryFn` is registered anywhere in this file, so an ENABLED query
    // for a key nobody seeded would fail rather than hang — which is what
    // makes "performs no lookup" assertable below.
    defaultOptions: { queries: { retry: false } },
  })
  for (const [title, ref] of seed)
    client.setQueryData(preferenceKey(title), ref)

  const rendered = renderHook(
    (p: Props) => useMusicTracking(p.running, p.settings),
    {
      initialProps: props,
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  )
  return { ...rendered, client }
}

afterEach(() => {
  cleanup()
  listeners.clear()
  installed.current = null
  setPreference.mockClear()
  window.localStorage.clear()
})

describe("starting a timer", () => {
  it("plays the catalog default for a blank title, and looks nothing up", () => {
    const player = makePlayer()
    installed.current = stub(player)

    const { client } = render({ running: entry(""), settings: AUTOPLAY })

    expect(player.playRef).toHaveBeenCalledTimes(1)
    expect(player.playRef).toHaveBeenCalledWith(CATALOG_DEFAULT)

    // A blank title gets NO ROW AND NO LOOKUP — inherited from `groupSittings`,
    // which refuses to group an untitled entry. A query that had actually run
    // would be `fetching` at this instant (and would then error, this client
    // having no `queryFn`); `idle` is the disabled query never starting.
    expect(client.getQueryState(preferenceKey(""))?.fetchStatus ?? "idle").toBe(
      "idle"
    )
  })

  it("writes no preference for the track it chose itself", () => {
    const player = makePlayer()
    installed.current = stub(player)

    render({ running: entry(""), settings: AUTOPLAY })

    // The stub notified the hook's `onUserPick` listener on the way past, as
    // the real provider does. Writing here would make the resolver's own
    // third-choice fallback indistinguishable from a deliberate pick, and
    // within a week every record in the account "prefers" the first catalog
    // track.
    expect(setPreference).not.toHaveBeenCalled()
  })

  it("plays the record's stored preference over the catalog default", () => {
    const player = makePlayer()
    installed.current = stub(player)

    render({ running: entry("Invoice run"), settings: AUTOPLAY }, [
      ["Invoice run", UPLOAD],
    ])

    expect(player.playRef).toHaveBeenCalledTimes(1)
    expect(player.playRef).toHaveBeenCalledWith(UPLOAD)
  })

  it("walks past a candidate that does not resolve", () => {
    // The preference names a deleted upload. The chain is walked, not
    // committed to: a miss on (1) has to fall through to (3) rather than
    // producing permanent silence.
    const player = makePlayer((ref) => ref.origin === "chroneli")
    installed.current = stub(player)

    render({ running: entry("Invoice run"), settings: AUTOPLAY }, [
      ["Invoice run", UPLOAD],
    ])

    expect(player.playRef).toHaveBeenCalledTimes(2)
    expect(player.playRef).toHaveBeenNthCalledWith(1, UPLOAD)
    expect(player.playRef).toHaveBeenNthCalledWith(2, CATALOG_DEFAULT)
  })

  it("starts nothing at all when autoplay is off", () => {
    const player = makePlayer()
    installed.current = stub(player)

    render(
      {
        running: entry("Invoice run"),
        settings: { ...AUTOPLAY, musicAutoplay: false },
      },
      [["Invoice run", UPLOAD]]
    )

    expect(player.playRef).not.toHaveBeenCalled()
  })
})

describe("a title arriving after the start", () => {
  /*
   * The ordinary gesture: press start, then type what you are doing. The title
   * is `""` at creation, so these three tests are the ones that decide whether
   * the record's remembered track is ever consulted at all — and, more
   * delicately, whether re-asking the question is allowed to override a
   * decision about sound that has already been made.
   */

  it("resolves the record's preference once the title lands, when the start played nothing", () => {
    // A cold tab whose library has not arrived: nothing resolves yet.
    const available = new Set<string>()
    const player = makePlayer((ref) => available.has(trackRefKey(ref)))
    installed.current = stub(player)

    const { rerender } = render({ running: entry(""), settings: AUTOPLAY }, [
      ["Invoice run", UPLOAD],
    ])
    expect(player.playRef).toHaveBeenCalledTimes(1)
    expect(player.playRef).toHaveBeenCalledWith(CATALOG_DEFAULT)

    available.add(trackRefKey(UPLOAD))
    rerender({ running: entry("Invoice run"), settings: AUTOPLAY })

    // Nothing was ever started, so nothing is being interrupted — the title is
    // a NEW question and the stored preference is the answer to it.
    expect(player.playRef).toHaveBeenLastCalledWith(UPLOAD)
  })

  it("does not restart music the user silenced", () => {
    /*
     * FINDING 1, and the reason the guard is not simply `music.playing`.
     *
     * Press start (the default plays), decide you do not want music and press
     * the speaker button, then type the description. `playing` is false by
     * then, so a guard that only protects CURRENTLY PLAYING audio lets the
     * chain walk and starts the music back up — overriding a decision the user
     * made by hand, which is the same violation `startedByUs` prevents at the
     * other end of the timer.
     */
    const player = makePlayer()
    installed.current = stub(player)

    const { rerender } = render({ running: entry(""), settings: AUTOPLAY }, [
      ["Invoice run", UPLOAD],
    ])
    expect(player.playRef).toHaveBeenCalledTimes(1)

    // Playback really began...
    installed.current = stub(player, { playing: true })
    rerender({ running: entry(""), settings: AUTOPLAY })

    // ...and the user turned it off. `blocked` stays false: nothing refused
    // anything, a person pressed a button.
    installed.current = stub(player, { playing: false, blocked: false })
    rerender({ running: entry("Invoice run"), settings: AUTOPLAY })

    expect(player.playRef).toHaveBeenCalledTimes(1)
  })

  it("does re-resolve when the browser was the one that refused", () => {
    /*
     * The other half of finding 1, and the test that proves the fix did not
     * simply switch the re-resolve off. `blocked` means playback never began,
     * so there is nothing the user could have silenced — and the very
     * keystroke that changed the title is the gesture that can lift the
     * refusal.
     */
    const player = makePlayer()
    installed.current = stub(player)

    const { rerender } = render({ running: entry(""), settings: AUTOPLAY }, [
      ["Invoice run", UPLOAD],
    ])
    expect(player.playRef).toHaveBeenCalledTimes(1)

    installed.current = stub(player, { playing: false, blocked: true })
    rerender({ running: entry("Invoice run"), settings: AUTOPLAY })

    expect(player.playRef).toHaveBeenCalledTimes(2)
    expect(player.playRef).toHaveBeenLastCalledWith(UPLOAD)
  })

  it("does not switch the track out from under music that is playing", () => {
    const player = makePlayer()
    installed.current = stub(player, { playing: true })

    const { rerender } = render({ running: entry(""), settings: AUTOPLAY }, [
      ["Invoice run", UPLOAD],
    ])
    expect(player.playRef).not.toHaveBeenCalled()

    rerender({ running: entry("Invoice run"), settings: AUTOPLAY })
    expect(player.playRef).not.toHaveBeenCalled()
  })
})

describe("waiting for the uploads to land", () => {
  /*
   * FINDING 2. `music.tracks` is never empty — the catalog is compiled into
   * the bundle — so "the ref did not resolve" cannot distinguish a deleted
   * upload from a list that has not arrived. `preferenceFor` is one index read
   * and `listTracks` is a signed-URL round trip per row, so on a cold tab the
   * preference really does win the race, and the record's remembered upload
   * used to lose to the arbitrary catalog default with the key pinned behind
   * it.
   */

  it("commits nothing while an upload preference cannot be judged", () => {
    const player = makePlayer()
    installed.current = stub(player, { tracksReady: false })

    render({ running: entry("Invoice run"), settings: AUTOPLAY }, [
      ["Invoice run", UPLOAD],
    ])

    // Crucially it does not fall through to the catalog either: playing the
    // wrong track is the outcome being prevented, not merely a late one.
    expect(player.playRef).not.toHaveBeenCalled()
  })

  it("resolves the upload the moment the list arrives", () => {
    const player = makePlayer()
    installed.current = stub(player, { tracksReady: false })

    const { rerender } = render(
      { running: entry("Invoice run"), settings: AUTOPLAY },
      [["Invoice run", UPLOAD]]
    )
    expect(player.playRef).not.toHaveBeenCalled()

    installed.current = stub(player, { tracksReady: true })
    rerender({ running: entry("Invoice run"), settings: AUTOPLAY })

    expect(player.playRef).toHaveBeenCalledTimes(1)
    expect(player.playRef).toHaveBeenCalledWith(UPLOAD)
  })

  it("does not hold up a blank title or a catalog preference", () => {
    // Neither has anything to wait for — a blank title performs no lookup at
    // all, and a catalog slug resolves against the bundle. Blocking either on
    // `listTracks` would mean an untitled timer plays nothing until a query it
    // does not depend on comes back.
    const player = makePlayer()
    installed.current = stub(player, { tracksReady: false })

    const { rerender } = render({ running: entry(""), settings: AUTOPLAY }, [
      ["Invoice run", CATALOG_DEFAULT],
    ])
    expect(player.playRef).toHaveBeenCalledTimes(1)

    installed.current = stub(player, { tracksReady: false, blocked: true })
    rerender({ running: entry("Invoice run"), settings: AUTOPLAY })

    expect(player.playRef).toHaveBeenCalledTimes(2)
    expect(player.playRef).toHaveBeenLastCalledWith(CATALOG_DEFAULT)
  })
})

describe("stopping the timer", () => {
  /*
   * "Stop the music" SILENCES BY PAUSING, and the assertion is deliberately
   * that way round rather than a mismatch nobody noticed.
   *
   * The provider's `stop` and `pause` differ by one `element.currentTime = 0`,
   * so they are indistinguishable here and diverge only on the next press of
   * Play: rewind, or resume where you were. That was a third settings option
   * once — "Pause the music" — and it asked a user to predict a difference
   * they cannot hear on a lo-fi loop and which a page reload erases anyway.
   * One option survived, and it takes the kinder of the two behaviours.
   *
   * `stop` is asserted NOT to be called so that a future edit "restoring
   * symmetry" by swapping them has to come through this test first.
   */
  it("silences music it started itself, without losing the position", () => {
    const player = makePlayer()
    installed.current = stub(player)

    const { rerender } = render({ running: entry(""), settings: AUTOPLAY })
    expect(player.playRef).toHaveBeenCalledTimes(1)

    rerender({ running: null, settings: AUTOPLAY })
    expect(player.pause).toHaveBeenCalledTimes(1)
    expect(player.stop).not.toHaveBeenCalled()
  })

  it("leaves continue alone", () => {
    const kept = makePlayer()
    installed.current = stub(kept)
    const carryOn = { musicAutoplay: true, musicOnStop: "continue" as const }
    const { rerender } = render({ running: entry(""), settings: carryOn })
    rerender({ running: null, settings: carryOn })
    expect(kept.stop).not.toHaveBeenCalled()
    expect(kept.pause).not.toHaveBeenCalled()
  })

  it("leaves music alone that it never started", () => {
    /*
     * Autoplay OFF, and the user presses play by hand. Nothing on screen links
     * a timer they told not to touch the music to the music stopping, so
     * `musicOnStop` must not fire here — this is the defect `startedByUs` was
     * introduced for, kept honest.
     */
    const player = makePlayer()
    installed.current = stub(player)
    const settings = { musicAutoplay: false, musicOnStop: "stop" as const }

    const { rerender } = render({ running: entry("Invoice run"), settings }, [
      ["Invoice run", null],
    ])
    expect(player.playRef).not.toHaveBeenCalled()

    // The user picks a track from the panel.
    act(() => void installed.current?.playRef(UPLOAD))

    rerender({ running: null, settings })
    expect(player.stop).not.toHaveBeenCalled()
    expect(player.pause).not.toHaveBeenCalled()
  })

  it("leaves a track the user hand-picked over the autoplayed one alone", () => {
    /*
     * FINDING 5. Autoplay starts something, the user stops it and picks a
     * different track from the panel — `startedByUs` used to survive that, so
     * stopping the timer silenced the user's OWN choice. A takeover is a
     * change of owner, and the flag has to say so.
     */
    const player = makePlayer()
    installed.current = stub(player)

    const { rerender } = render(
      { running: entry("Invoice run"), settings: AUTOPLAY },
      [["Invoice run", null]]
    )
    expect(player.playRef).toHaveBeenCalledWith(CATALOG_DEFAULT)

    act(() => void installed.current?.playRef(UPLOAD))

    rerender({ running: null, settings: AUTOPLAY })
    // BOTH, because the stop branch now silences by pausing. Asserting only on
    // `stop` would leave this case passing vacuously — the guard it exists to
    // hold could break and nothing here would notice.
    expect(player.stop).not.toHaveBeenCalled()
    expect(player.pause).not.toHaveBeenCalled()
  })
})

describe("recording a choice", () => {
  it("writes a preference for a genuine pick while a timer runs", () => {
    const player = makePlayer()
    installed.current = stub(player)

    render({ running: entry("Invoice run"), settings: AUTOPLAY }, [
      ["Invoice run", null],
    ])
    // The resolver's own pick, notified through the same listener — and not a
    // preference.
    expect(setPreference).not.toHaveBeenCalled()

    act(() => void installed.current?.playRef(UPLOAD))

    expect(setPreference).toHaveBeenCalledTimes(1)
    expect(setPreference).toHaveBeenCalledWith({
      title: "Invoice run",
      projectId: null,
      trackRef: { origin: "upload", trackId: "t1" },
    })
  })

  it("writes nothing for a pick made against a blank title", () => {
    const player = makePlayer()
    installed.current = stub(player)

    render({ running: entry(""), settings: AUTOPLAY })
    act(() => void installed.current?.playRef(UPLOAD))

    // No title, no row — the same rule `groupSittings` applies. Otherwise
    // every unnamed entry in the account shares one preference and overwrites
    // it in turn.
    expect(setPreference).not.toHaveBeenCalled()
  })

  it("writes nothing when no timer is running", () => {
    const player = makePlayer()
    installed.current = stub(player)

    render({ running: null, settings: AUTOPLAY })
    act(() => void installed.current?.playRef(UPLOAD))

    expect(setPreference).not.toHaveBeenCalled()
  })
})
