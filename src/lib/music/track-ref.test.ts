import { describe, expect, it } from "vitest"
import { CATALOG } from "./catalog"
import { resolveTrackUrl, trackRefEquals, trackRefKey } from "./track-ref"

describe("CATALOG", () => {
  it("has at least one track, and every slug is unique", () => {
    expect(CATALOG.length).toBeGreaterThan(0)
    expect(new Set(CATALOG.map((t) => t.slug)).size).toBe(CATALOG.length)
  })

  it("serves every file from /music/", () => {
    for (const track of CATALOG) expect(track.file.startsWith("/music/")).toBe(true)
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
