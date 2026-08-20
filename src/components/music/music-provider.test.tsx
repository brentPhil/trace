import { act, cleanup, renderHook } from "@testing-library/react"
// NO `user-event` import, and no jest-dom matchers — neither is a dependency.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CATALOG } from "@/lib/music/catalog"
import { MusicProvider, useMusic } from "./music-provider"
import type { MusicContextValue, MusicUpload } from "./music-provider"
import type { TrackRef } from "@/lib/music/track-ref"
import type { ReactNode } from "react"

/*
 * The player, finally tested.
 *
 * This file owns the `<audio>` element and every piece of queue state in the
 * feature, and it shipped with no tests at all — the two worst defects of the
 * whole build were in it and both were found by reading:
 *
 *   - `BroadcastChannel#postMessage` excludes only the SENDING OBJECT, so the
 *     provider's own listener received its own tab's announcement and paused
 *     the audio it had just started. Music could not play, ever, in any tab.
 *   - `setCurrentRef` is queued while `failAndAdvance` runs synchronously, so
 *     a dead track advanced into ITSELF until the failure budget ran out
 *     instead of stepping to the next track.
 *
 * Both are sequences across an async boundary, which is exactly what a reader
 * has to hold in their head and what a test holds for free. They have a case
 * each below, and neither can be deleted without the bug becoming invisible
 * again.
 *
 * `useAudioElement` is mocked, as its own docblock says every unit above it
 * must: jsdom has no media stack and `play()` there returns undefined rather
 * than a promise. The stub is the honest half of the contract — `play`
 * RESOLVES FALSE for a refusal rather than throwing, which is the distinction
 * `blocked` is built on.
 */

const { audio, handlers } = vi.hoisted(() => ({
  audio: {
    play: vi.fn(async (_url: string) => true),
    resume: vi.fn(async () => true),
    pause: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
  },
  /* A BOX, because the provider hands its `onEnded`/`onError` to the hook and
   * has no other way of being told a track finished or failed to decode.
   * Firing them is how this file simulates the element. */
  handlers: {
    current: null as null | { onEnded: () => void; onError: () => void },
  },
}))

vi.mock("@/hooks/use-audio-element", () => ({
  useAudioElement: (h: { onEnded: () => void; onError: () => void }) => {
    handlers.current = h
    // The SAME object every render, matching the real hook's individually
    // stable callbacks — the provider destructures them and depends on their
    // identity, and a fresh literal here would rebuild the element on every
    // render and mask exactly the churn that comment warns about.
    return audio
  },
}))

const CHANNEL = "chroneli:music"
const LOCAL_KEY = "chroneli:music"

/** Lets a queued macrotask run — what jsdom's `BroadcastChannel` delivery
 *  waits on, and what nothing in `act`'s microtask flush covers. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function renderPlayer(
  options: {
    uploads?: Array<MusicUpload>
    onError?: (message: string) => void
  } = {}
) {
  const box = { ...options }
  const view = renderHook(() => useMusic(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MusicProvider uploads={box.uploads} onError={box.onError}>
        {children}
      </MusicProvider>
    ),
  })
  return {
    ...view,
    /** The live context. Read through a getter so a test never holds a stale
     *  snapshot across an `act`. */
    get value(): MusicContextValue {
      return view.result.current
    },
    /** The uploads query answering — or answering differently — mid-session. */
    setUploads(uploads: Array<MusicUpload> | undefined) {
      box.uploads = uploads
      view.rerender()
    },
  }
}

/** Drives a context action and flushes the `await play(...)` inside it. */
async function press(action: () => void) {
  await act(async () => {
    action()
  })
}

const DEAD: MusicUpload = { _id: "u_dead", name: "Dead upload", url: null }
/* A SECOND, DISTINCT dead upload. Two rows sharing an `_id` share a `TrackRef`,
 * and `advance` locates the current track by ref — so a duplicated id makes the
 * queue find the first copy every time and step between the same two positions
 * forever. Convex ids are unique, so that is a fact about fixtures rather than
 * about the player, but it is a cheap mistake to make here twice. */
const DEAD_TOO: MusicUpload = { _id: "u_dead_2", name: "Dead too", url: null }
const GOOD: MusicUpload = {
  _id: "u_good",
  name: "Good upload",
  url: "https://files.example/good.mp3",
}

const catalogRef = (i: number): TrackRef => ({
  origin: "chroneli",
  slug: CATALOG[i].slug,
})

beforeEach(() => {
  localStorage.clear()
  audio.play.mockClear()
  audio.play.mockResolvedValue(true)
  audio.resume.mockClear()
  audio.resume.mockResolvedValue(true)
  audio.pause.mockClear()
  audio.stop.mockClear()
  audio.setVolume.mockClear()
  handlers.current = null
})

afterEach(cleanup)

describe("MusicProvider — the library it exposes", () => {
  it("has playable tracks on its very first render, with no uploads and no client", () => {
    const view = renderPlayer()
    expect(view.value.tracks.length).toBe(CATALOG.length)
    expect(view.value.tracks.every((t) => t.url !== null)).toBe(true)
  })

  /* `tracksReady` is the whole reason it is a flag and not `tracks === null`:
   * both states below produce the identical catalog-only array, and a consumer
   * resolving a stored upload ref has to tell "not answered yet" from "this
   * account has uploaded nothing" because they demand opposite behaviour. */
  it("is not ready while the uploads query has not answered", () => {
    expect(renderPlayer().value.tracksReady).toBe(false)
  })

  it("is ready once the query answers, even with nothing uploaded", () => {
    expect(renderPlayer({ uploads: [] }).value.tracksReady).toBe(true)
  })

  it("appends uploads after the catalog and keeps their urls", () => {
    const view = renderPlayer({ uploads: [GOOD] })
    const last = view.value.tracks[view.value.tracks.length - 1]
    expect(last.origin).toBe("upload")
    expect(last.name).toBe("Good upload")
    expect(last.url).toBe(GOOD.url)
  })
})

describe("MusicProvider — playRef says whether anything started", () => {
  it("plays a catalog track and reports the start", async () => {
    const view = renderPlayer()
    let started: boolean | undefined
    await press(() => {
      started = view.value.playRef(catalogRef(0))
    })
    expect(started).toBe(true)
    expect(audio.play).toHaveBeenCalledWith(CATALOG[0].file)
    expect(view.value.playing).toBe(true)
    expect(view.value.current?.name).toBe(CATALOG[0].name)
  })

  it("refuses a ref that names nothing in this render's list", async () => {
    const view = renderPlayer()
    let started: boolean | undefined
    await press(() => {
      started = view.value.playRef({ origin: "upload", trackId: "gone" })
    })
    expect(started).toBe(false)
    expect(audio.play).not.toHaveBeenCalled()
  })

  /* The row IS in `tracks` — `listTracks` hands it back so the panel can draw
   * it and say "unavailable" instead of silently dropping a file the user
   * knows they uploaded. Reporting `true` for it let the bridge record
   * `startedByUs` for a track that could never make a sound. */
  it("refuses a row that has no url, without pretending it started", async () => {
    const view = renderPlayer({ uploads: [DEAD] })
    let started: boolean | undefined
    await press(() => {
      started = view.value.playRef({ origin: "upload", trackId: "u_dead" })
    })
    expect(started).toBe(false)
    expect(audio.play).not.toHaveBeenCalled()
    expect(view.value.playing).toBe(false)
  })

  it("tells the pick listeners which ref was chosen", async () => {
    const view = renderPlayer()
    const picked: Array<TrackRef> = []
    act(() => {
      view.value.onUserPick((ref) => picked.push(ref))
    })
    await press(() => view.value.playRef(catalogRef(1)))
    expect(picked).toEqual([catalogRef(1)])
  })

  /* A ref that resolved to nothing must NOT reach the listeners: a pick is how
   * a preference gets written, and announcing an unresolvable ref manufactures
   * a stored preference pointing at a track that does not exist. */
  it("tells them nothing when the ref did not resolve", async () => {
    const view = renderPlayer({ uploads: [DEAD] })
    const picked: Array<TrackRef> = []
    act(() => {
      view.value.onUserPick((ref) => picked.push(ref))
    })
    await press(() => view.value.playRef({ origin: "upload", trackId: "gone" }))
    await press(() =>
      view.value.playRef({ origin: "upload", trackId: "u_dead" })
    )
    expect(picked).toEqual([])
  })

  it("stops listening once the subscription is dropped", async () => {
    const view = renderPlayer()
    const picked: Array<TrackRef> = []
    let unsubscribe = () => {}
    act(() => {
      unsubscribe = view.value.onUserPick((ref) => picked.push(ref))
    })
    act(() => unsubscribe())
    await press(() => view.value.playRef(catalogRef(0)))
    expect(picked).toEqual([])
  })
})

/*
 * THE REGRESSION THAT MADE MUSIC IMPOSSIBLE.
 *
 * `postMessage` excludes the sending channel OBJECT, not the sending document.
 * The announce effect opens a second channel object in this very document, so
 * the provider's own listener received the announcement and paused what it had
 * just started. The per-tab tag is the fix, and this pair is what holds it in
 * place — the first case fails the moment the tag is "simplified" away, and
 * the second proves the tag did not simply disable the feature.
 */
describe("MusicProvider — two tabs", () => {
  it("does not pause the playback it just started itself", async () => {
    const view = renderPlayer()
    await press(() => view.value.playRef(catalogRef(0)))
    await act(async () => {
      await tick()
    })
    expect(view.value.playing).toBe(true)
    expect(audio.pause).not.toHaveBeenCalled()
  })

  it("yields to another tab that starts playing", async () => {
    const view = renderPlayer()
    await press(() => view.value.playRef(catalogRef(0)))
    const other = new BroadcastChannel(CHANNEL)
    await act(async () => {
      other.postMessage({ tab: "a-different-tab" })
      await tick()
    })
    other.close()
    expect(audio.pause).toHaveBeenCalled()
    expect(view.value.playing).toBe(false)
  })
})

describe("MusicProvider — a track that cannot play", () => {
  /*
   * The stale-ref defect, exactly. `start` writes `currentRef` through state
   * AND through the ref because `failAndAdvance` runs before any render: with
   * the state write alone, `advance` read the PREVIOUS track and re-picked the
   * same dead one until the budget ran out, never reaching the track after it.
   */
  it("steps past it to the next track rather than picking it again", async () => {
    const view = renderPlayer({ uploads: [DEAD, GOOD] })
    // The last catalog entry, so `next` walks straight into the dead upload.
    await press(() => view.value.playRef(catalogRef(CATALOG.length - 1)))
    await press(() => view.value.next())
    expect(view.value.current?.name).toBe("Good upload")
    expect(audio.play).toHaveBeenLastCalledWith(GOOD.url)
  })

  /* One unplayable file in a healthy library is a non-event: the queue steps
   * past it and the user hears music, so a toast would be noise about a
   * problem that already fixed itself. */
  it("says nothing when the queue recovers on its own", async () => {
    const onError = vi.fn()
    const view = renderPlayer({ uploads: [DEAD, DEAD_TOO], onError })
    await press(() => view.value.playRef(catalogRef(CATALOG.length - 1)))
    await press(() => view.value.next())
    expect(onError).not.toHaveBeenCalled()
    expect(view.value.playing).toBe(true)
  })

  /*
   * And the other side of the same bound: when nothing can be reached, the
   * music stops and says so ONCE — not once per skipped track, which is how a
   * library of dead uploads produced a stack of toasts for one silence.
   *
   * Driven by firing the element's own error handler with `play` refusing, so
   * no attempt resets the failure counter — the shape of a library whose files
   * all fail to decode, which the compiled-in catalog makes unreachable by
   * simply deleting rows.
   */
  it("stops and says so exactly once when everything fails", async () => {
    const onError = vi.fn()
    audio.play.mockResolvedValue(false)
    const view = renderPlayer({ onError })
    await press(() => view.value.playRef(catalogRef(0)))
    // One decode failure per track in the library — the count the bound is
    // expressed in, so the last of them is the one that gives up.
    for (const _track of CATALOG) {
      await act(async () => {
        handlers.current?.onError()
      })
    }
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatch(/could not be played/i)
    expect(view.value.playing).toBe(false)
  })
})

describe("MusicProvider — the queue", () => {
  it("walks forward and back", async () => {
    const view = renderPlayer()
    await press(() => view.value.playRef(catalogRef(1)))
    await press(() => view.value.next())
    expect(view.value.current?.name).toBe(CATALOG[2].name)
    await press(() => view.value.previous())
    expect(view.value.current?.name).toBe(CATALOG[1].name)
  })

  it("wraps at the end, because repeat starts on 'all'", async () => {
    const view = renderPlayer()
    expect(view.value.repeat).toBe("all")
    await press(() => view.value.playRef(catalogRef(CATALOG.length - 1)))
    await press(() => view.value.next())
    expect(view.value.current?.name).toBe(CATALOG[0].name)
  })

  it("replays the same track when it ends under repeat-one", async () => {
    const view = renderPlayer()
    await press(() => view.value.playRef(catalogRef(1)))
    act(() => view.value.cycleRepeat())
    expect(view.value.repeat).toBe("one")
    audio.play.mockClear()
    await act(async () => {
      handlers.current?.onEnded()
    })
    expect(audio.play).toHaveBeenCalledWith(CATALOG[1].file)
    expect(view.value.current?.name).toBe(CATALOG[1].name)
  })

  /* Pressing Next is an instruction, not a track ending — repeat-one governs
   * the second and must not swallow the first. */
  it("still moves when the user presses next under repeat-one", async () => {
    const view = renderPlayer()
    await press(() => view.value.playRef(catalogRef(1)))
    act(() => view.value.cycleRepeat())
    await press(() => view.value.next())
    expect(view.value.current?.name).toBe(CATALOG[2].name)
  })

  it("stops at the end with repeat off, and does not claim the browser refused", async () => {
    const view = renderPlayer()
    act(() => view.value.cycleRepeat())
    act(() => view.value.cycleRepeat())
    expect(view.value.repeat).toBe("off")
    await press(() => view.value.playRef(catalogRef(CATALOG.length - 1)))
    await press(() => view.value.next())
    expect(audio.stop).toHaveBeenCalled()
    expect(view.value.playing).toBe(false)
    expect(view.value.blocked).toBe(false)
  })
})

describe("MusicProvider — toggle", () => {
  it("starts the first catalog track when nothing has ever played", async () => {
    const view = renderPlayer()
    await press(() => view.value.toggle())
    expect(audio.play).toHaveBeenCalledWith(CATALOG[0].file)
  })

  /* Play and autoplay must not disagree about "start SOMETHING": the resolver
   * in use-music-tracking has always honoured `lastTrack` at this priority,
   * and a Play button that ignored it is an inconsistency nobody can explain
   * to a user. */
  it("prefers the track this device last played", async () => {
    localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({
        lastTrack: { origin: "chroneli", slug: CATALOG[2].slug },
      })
    )
    const view = renderPlayer()
    await press(() => view.value.toggle())
    expect(audio.play).toHaveBeenCalledWith(CATALOG[2].file)
  })

  it("falls through to the catalog when the remembered track is gone", async () => {
    localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({ lastTrack: { origin: "upload", trackId: "deleted" } })
    )
    const view = renderPlayer({ uploads: [] })
    await press(() => view.value.toggle())
    expect(audio.play).toHaveBeenCalledWith(CATALOG[0].file)
  })

  it("pauses what is playing, and resumes it rather than restarting it", async () => {
    const view = renderPlayer()
    await press(() => view.value.playRef(catalogRef(0)))
    await press(() => view.value.toggle())
    expect(audio.pause).toHaveBeenCalled()
    expect(view.value.playing).toBe(false)
    audio.play.mockClear()
    await press(() => view.value.toggle())
    expect(audio.resume).toHaveBeenCalled()
    expect(audio.play).not.toHaveBeenCalled()
    expect(view.value.playing).toBe(true)
  })
})

describe("MusicProvider — a browser that refuses to start", () => {
  it("reports blocked rather than pretending to play", async () => {
    audio.play.mockResolvedValue(false)
    const view = renderPlayer()
    await press(() => view.value.playRef(catalogRef(0)))
    expect(view.value.playing).toBe(false)
    expect(view.value.blocked).toBe(true)
  })

  /* `blocked` means "the browser refused". Once the user acts, whatever it was
   * tracking is moot — leaving it set draws a "click to play" affordance over
   * a player nobody refused. */
  it("clears blocked when the user stops", async () => {
    audio.play.mockResolvedValue(false)
    const view = renderPlayer()
    await press(() => view.value.playRef(catalogRef(0)))
    act(() => view.value.stop())
    expect(view.value.blocked).toBe(false)
  })

  it("clears blocked when the user pauses", async () => {
    audio.play.mockResolvedValue(false)
    const view = renderPlayer()
    await press(() => view.value.playRef(catalogRef(0)))
    act(() => view.value.pause())
    expect(view.value.blocked).toBe(false)
  })
})

describe("MusicProvider — device preferences", () => {
  it("sends the stored volume to the element on mount", () => {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ volume: 0.25 }))
    const view = renderPlayer()
    expect(view.value.volume).toBe(0.25)
    expect(audio.setVolume).toHaveBeenLastCalledWith(0.25)
  })

  it("writes a volume change straight to the device, never to the account", () => {
    const view = renderPlayer()
    act(() => view.value.setVolume(0.4))
    expect(view.value.volume).toBe(0.4)
    expect(audio.setVolume).toHaveBeenLastCalledWith(0.4)
    expect(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}").volume).toBe(0.4)
  })

  it("remembers shuffle", () => {
    const view = renderPlayer()
    expect(view.value.shuffle).toBe(false)
    act(() => view.value.toggleShuffle())
    expect(view.value.shuffle).toBe(true)
    expect(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}").shuffle).toBe(
      true
    )
  })

  it("cycles repeat all → one → off → all and remembers it", () => {
    const view = renderPlayer()
    act(() => view.value.cycleRepeat())
    expect(view.value.repeat).toBe("one")
    act(() => view.value.cycleRepeat())
    expect(view.value.repeat).toBe("off")
    expect(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}").repeat).toBe(
      "off"
    )
    act(() => view.value.cycleRepeat())
    expect(view.value.repeat).toBe("all")
  })

  it("records the track it started, so the next cold start can prefer it", async () => {
    const view = renderPlayer()
    await press(() => view.value.playRef(catalogRef(2)))
    expect(
      JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "{}").lastTrack
    ).toEqual({
      origin: "chroneli",
      slug: CATALOG[2].slug,
    })
  })
})

describe("MusicProvider — shuffle", () => {
  /* `order` is reconciled by track IDENTITY rather than regenerated, because
   * uploads sort alphabetically and a new one INSERTS rather than appends —
   * shifting every index after it. Regenerating reshuffles a queue the user is
   * already midway through; this asserts the queue in progress survives an
   * upload landing. */
  it("does not reshuffle a queue in progress when an upload arrives", async () => {
    const view = renderPlayer({ uploads: [] })
    act(() => view.value.toggleShuffle())
    await press(() => view.value.playRef(catalogRef(0)))
    await press(() => view.value.next())
    const before = view.value.current?.name
    act(() => view.setUploads([GOOD]))
    expect(view.value.current?.name).toBe(before)
    // The arrival is appended to the sequence, never interleaved, so walking
    // on from here still reaches only tracks that were already queued.
    await press(() => view.value.next())
    expect(view.value.current?.name).not.toBe(before)
  })

  it("still reaches every track exactly once before repeating", async () => {
    const view = renderPlayer()
    act(() => view.value.toggleShuffle())
    await press(() => view.value.playRef(catalogRef(0)))
    const seen = [view.value.current?.name]
    for (let i = 1; i < CATALOG.length; i += 1) {
      await press(() => view.value.next())
      seen.push(view.value.current?.name)
    }
    expect(new Set(seen).size).toBe(CATALOG.length)
  })
})

describe("useMusic", () => {
  it("refuses to be used outside the provider, by name", () => {
    // React logs the thrown error as well as rethrowing it; silenced so the
    // suite's output stays about failures rather than about an expected throw.
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => renderHook(() => useMusic())).toThrow(/MusicProvider/)
    error.mockRestore()
  })
})
