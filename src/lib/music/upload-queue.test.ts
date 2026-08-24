import { describe, expect, it } from "vitest"
import {
  MAX_LIBRARY_BYTES,
  MAX_TRACK_BYTES,
  MAX_TRACK_COUNT,
  formatBytes,
} from "@shared/audio"
import { advance, precheck } from "./upload-queue"

const MB = 1024 * 1024
const file = (
  over: Partial<{ name: string; size: number; type: string }> = {}
) => ({
  name: "Track.mp3",
  size: MB,
  type: "audio/mpeg",
  ...over,
})
const empty = { libraryBytes: 0, trackCount: 0 }

describe("precheck", () => {
  it("accepts an ordinary track into an empty library", () => {
    expect(precheck(file(), empty)).toEqual({ ok: true })
  })

  it("refuses a track over the per-track cap, naming both sizes", () => {
    const result = precheck(file({ size: MAX_TRACK_BYTES + MB }), empty)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a refusal")
    // Both sizes are DERIVED, not typed out: this assertion went stale once
    // already when the cap moved from 20 MB to 250 MB, and a literal here is
    // just a promise to break again the next time it moves.
    expect(result.reason).toContain(formatBytes(MAX_TRACK_BYTES + MB))
    expect(result.reason).toContain(formatBytes(MAX_TRACK_BYTES))
  })

  it("accepts a track exactly at the per-track cap", () => {
    expect(precheck(file({ size: MAX_TRACK_BYTES }), empty)).toEqual({
      ok: true,
    })
  })

  it("refuses a type the server would refuse", () => {
    const result = precheck(file({ type: "image/png" }), empty)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a refusal")
    expect(result.reason).toContain("FLAC")
  })

  /*
   * THE LOAD-BEARING CASE. An empty `file.type` is what the OS gives for many
   * files, and `addTrackAction` sniffs the blob when the client sends no
   * Content-Type header. Refusing here would reject files the server ACCEPTS.
   */
  it("lets a file with no type through to the server's sniffing", () => {
    expect(precheck(file({ type: "" }), empty)).toEqual({ ok: true })
  })

  it("refuses a track that will not fit, naming the free space", () => {
    const result = precheck(file({ size: 18 * MB }), {
      libraryBytes: MAX_LIBRARY_BYTES - 12 * MB,
      trackCount: 3,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a refusal")
    expect(result.reason).toContain("12 MB free")
    expect(result.reason).toContain("18 MB")
  })

  it("refuses a track once the count cap is reached", () => {
    const result = precheck(file(), {
      libraryBytes: 0,
      trackCount: MAX_TRACK_COUNT,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected a refusal")
    expect(result.reason).toContain("500 tracks")
  })

  it("reports the size problem before the space problem", () => {
    const result = precheck(file({ size: MAX_TRACK_BYTES + MB }), {
      libraryBytes: MAX_LIBRARY_BYTES,
      trackCount: 0,
    })
    if (result.ok) throw new Error("expected a refusal")
    expect(result.reason).toContain("per track")
  })
})

describe("advance", () => {
  it("adds the candidate's bytes and one track", () => {
    expect(
      advance({ libraryBytes: 5 * MB, trackCount: 2 }, file({ size: 3 * MB }))
    ).toEqual({ libraryBytes: 8 * MB, trackCount: 3 })
  })

  /*
   * BATCH-CUMULATIVE. Thirty files dropped into a library with room for four
   * must refuse the fifth. Checking each against the pre-drop total would
   * pass all thirty and let the server refuse twenty-six of them one at a
   * time, after uploading every byte.
   */
  it("makes a batch refuse once the running total fills the library", () => {
    let state = { libraryBytes: MAX_LIBRARY_BYTES - 10 * MB, trackCount: 1 }
    const candidate = file({ size: 4 * MB })

    expect(precheck(candidate, state).ok).toBe(true)
    state = advance(state, candidate)
    expect(precheck(candidate, state).ok).toBe(true)
    state = advance(state, candidate)
    expect(precheck(candidate, state).ok).toBe(false)
  })
})
