import { readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CATALOG } from "./catalog"
import { resolveTrackUrl, trackRefEquals, trackRefKey } from "./track-ref"

/*
 * The catalog is a hand-written manifest beside a directory of binaries, and
 * nothing in the type system relates the two. The two tests at the bottom of
 * this block are what relate them, and they run here — in the `unit` project,
 * which is node and therefore has a filesystem — rather than anywhere the app
 * runs, where the answer would arrive as a 404 mid-playback.
 *
 * Both directions matter, and they fail differently:
 *   - a manifest entry with no file is a track that appears in the panel and
 *     will not play;
 *   - a file with no manifest entry is a track nobody can reach, shipped in
 *     the bundle and paid for in git history forever. That is the one that
 *     actually happened: three mp3s sat in the folder unwired.
 */
const MUSIC_DIR = fileURLToPath(new URL("../../../public/music/", import.meta.url))
const AUDIO = /\.(mp3|m4a|wav|ogg|flac)$/i

describe("CATALOG", () => {
  it("has at least one track, and every slug is unique", () => {
    expect(CATALOG.length).toBeGreaterThan(0)
    expect(new Set(CATALOG.map((t) => t.slug)).size).toBe(CATALOG.length)
  })

  it("serves every file from /music/", () => {
    for (const track of CATALOG) expect(track.file.startsWith("/music/")).toBe(true)
  })

  it("names no file twice", () => {
    expect(new Set(CATALOG.map((t) => t.file)).size).toBe(CATALOG.length)
  })

  it("points every entry at a file that exists", () => {
    const onDisk = new Set(readdirSync(MUSIC_DIR))
    const missing = CATALOG.filter(
      (t) => !onDisk.has(t.file.replace("/music/", ""))
    ).map((t) => t.file)
    expect(missing).toEqual([])
  })

  it("leaves no audio file in public/music unwired", () => {
    const orphans = readdirSync(MUSIC_DIR)
      .filter((name) => AUDIO.test(name))
      .filter((name) => !CATALOG.some((t) => t.file === `/music/${name}`))
    expect(orphans).toEqual([])
  })
})

describe("resolveTrackUrl", () => {
  it("resolves a catalog track to its public path", () => {
    const first = CATALOG[0]
    expect(resolveTrackUrl({ origin: "chroneli", slug: first.slug }, new Map())).toBe(
      first.file
    )
  })

  it("returns null for an unknown slug rather than a broken URL", () => {
    expect(resolveTrackUrl({ origin: "chroneli", slug: "nope" }, new Map())).toBe(null)
  })

  it("resolves an upload from the supplied url map", () => {
    const urls = new Map([["track_1", "https://files.example/a.mp3"]])
    expect(resolveTrackUrl({ origin: "upload", trackId: "track_1" }, urls)).toBe(
      "https://files.example/a.mp3"
    )
  })

  it("returns null for an upload with no url — a deleted track", () => {
    expect(resolveTrackUrl({ origin: "upload", trackId: "gone" }, new Map())).toBe(null)
  })
})

describe("trackRefEquals", () => {
  it("compares within an origin", () => {
    expect(trackRefEquals({ origin: "chroneli", slug: "a" }, { origin: "chroneli", slug: "a" })).toBe(true)
    expect(trackRefEquals({ origin: "chroneli", slug: "a" }, { origin: "chroneli", slug: "b" })).toBe(false)
  })

  it("never equates across origins", () => {
    expect(trackRefEquals({ origin: "chroneli", slug: "a" }, { origin: "upload", trackId: "a" })).toBe(false)
  })

  it("treats null as equal to nothing, including itself", () => {
    expect(trackRefEquals(null, null)).toBe(false)
    expect(trackRefEquals(null, { origin: "chroneli", slug: "a" })).toBe(false)
  })
})

describe("trackRefKey", () => {
  it("cannot collide across origins", () => {
    expect(trackRefKey({ origin: "upload", trackId: "x" })).not.toBe(
      trackRefKey({ origin: "chroneli", slug: "x" })
    )
  })
})
