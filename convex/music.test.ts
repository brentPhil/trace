/// <reference types="vite/client" />
// The music library.
//
// The tests that matter most here are the two the spec argues at length: an
// upload rejected for ANY reason must not leave a paid-for blob behind, and no
// user may reach another user's track by id. The rest of the file is the
// ordinary CRUD surface.
import { convexTest } from "convex-test"
import { describe, expect, it } from "vitest"
import schema from "./schema"
import { api, internal } from "./_generated/api"
import { traceErrorCode } from "./lib/codes"
import { MAX_LIBRARY_BYTES, MAX_TRACK_BYTES } from "./lib/audio"
import type { Id } from "./_generated/dataModel"

const modules = import.meta.glob("./**/*.*s")
const setup = () => convexTest(schema, modules)

const ALICE = "user_alice"
const BOB = "user_bob"

async function expectCode(
  promise: Promise<unknown>,
  code: string
): Promise<void> {
  try {
    await promise
  } catch (error) {
    expect(traceErrorCode(error) ?? String(error)).toBe(code)
    return
  }
  throw new Error(`expected rejection with code ${code}, but it resolved`)
}

async function storedBlob(
  t: ReturnType<typeof setup>,
  type: string,
  size: number
): Promise<Id<"_storage">> {
  return await t.run(
    async (ctx) =>
      await ctx.storage.store(new Blob([new Uint8Array(size)], { type }))
  )
}

async function blobExists(
  t: ReturnType<typeof setup>,
  storageId: Id<"_storage">
): Promise<boolean> {
  return (
    (await t.run(
      async (ctx) => await ctx.db.system.get("_storage", storageId)
    )) !== null
  )
}

async function addTrack(
  t: ReturnType<typeof setup>,
  userId: string,
  opts: { type?: string; size?: number; name?: string; clientKey?: string } = {}
): Promise<Id<"musicTracks">> {
  const storageId = await storedBlob(
    t,
    opts.type ?? "audio/mpeg",
    opts.size ?? 1024
  )
  return await t.action(internal.music.addTrackAs, {
    userId,
    storageId,
    clientKey: opts.clientKey ?? `key_${Math.random()}`,
    name: opts.name ?? "A track",
  })
}

describe("authorization", () => {
  it("rejects anonymous callers on every public function", async () => {
    const t = setup()
    await expectCode(t.query(api.music.listTracks, {}), "UNAUTHENTICATED")
    await expectCode(t.query(api.music.usage, {}), "UNAUTHENTICATED")
    await expectCode(
      t.mutation(api.music.generateUploadUrl, {}),
      "UNAUTHENTICATED"
    )
    const storageId = await storedBlob(t, "audio/mpeg", 16)
    await expectCode(
      t.action(api.music.addTrack, { storageId, clientKey: "k", name: "n" }),
      "UNAUTHENTICATED"
    )
  })

  it("hides another user's track behind NOT_FOUND", async () => {
    const t = setup()
    const trackId = await addTrack(t, ALICE)
    await expectCode(
      t.mutation(internal.music.renameTrackAs, {
        userId: BOB,
        trackId,
        name: "mine",
      }),
      "NOT_FOUND"
    )
    await expectCode(
      t.mutation(internal.music.removeTrackAs, { userId: BOB, trackId }),
      "NOT_FOUND"
    )
    expect(await t.query(internal.music.listTracksAs, { userId: BOB })).toEqual(
      []
    )
  })
})

describe("upload validation", () => {
  it("accepts an mp3 and lists it", async () => {
    const t = setup()
    await addTrack(t, ALICE, { name: "Rainfall", size: 2048 })
    const tracks = await t.query(internal.music.listTracksAs, { userId: ALICE })
    expect(tracks).toHaveLength(1)
    expect(tracks[0].name).toBe("Rainfall")
    expect(tracks[0].bytes).toBe(2048)
    expect(typeof tracks[0]._creationTime).toBe("number")
  })

  /*
   * `_creationTime` is what makes the client's "Recently added" sort a fact
   * rather than a guess — see -music.tsx's `orderTracks`. Sorted here by
   * NAME, deliberately out of insertion order, so a test that happened to
   * read the rows back already in creation order could not pass by accident.
   */
  it("returns _creationTime, strictly increasing with insertion order", async () => {
    const t = setup()
    await addTrack(t, ALICE, { name: "Bravo" })
    await addTrack(t, ALICE, { name: "Alpha" })
    const tracks = await t.query(internal.music.listTracksAs, { userId: ALICE })
    const byName = [...tracks].sort((a, b) => a.name.localeCompare(b.name))
    const [alpha, bravo] = byName
    expect(alpha.name).toBe("Alpha")
    expect(bravo.name).toBe("Bravo")
    expect(alpha._creationTime).toBeGreaterThan(bravo._creationTime)
  })

  it("rejects an unsupported content type AND deletes the blob", async () => {
    const t = setup()
    const storageId = await storedBlob(t, "application/pdf", 32)
    await expectCode(
      t.action(internal.music.addTrackAs, {
        userId: ALICE,
        storageId,
        clientKey: "k1",
        name: "n",
      }),
      "INVALID_TRACK"
    )
    expect(await blobExists(t, storageId)).toBe(false)
  })

  it("rejects a file over the per-file cap AND deletes the blob", async () => {
    const t = setup()
    const storageId = await storedBlob(t, "audio/mpeg", MAX_TRACK_BYTES + 1)
    await expectCode(
      t.action(internal.music.addTrackAs, {
        userId: ALICE,
        storageId,
        clientKey: "k2",
        name: "n",
      }),
      "INVALID_TRACK"
    )
    expect(await blobExists(t, storageId)).toBe(false)
  })

  it("rejects an upload that would exceed the account cap AND deletes the blob", async () => {
    const t = setup()
    // Seed the library right up to the cap without actually uploading a
    // library's worth of bytes: write the row directly, which is what the sum
    // reads. Derived from `MAX_LIBRARY_BYTES` rather than spelled out — this
    // seed was a literal `500 * 1024 * 1024` and silently stopped reaching the
    // cap the moment the cap moved.
    await t.run(async (ctx) => {
      await ctx.db.insert("musicTracks", {
        userId: ALICE,
        clientKey: "seed",
        storageId: await ctx.storage.store(
          new Blob([new Uint8Array(1)], { type: "audio/mpeg" })
        ),
        name: "Seed",
        contentType: "audio/mpeg",
        bytes: MAX_LIBRARY_BYTES - 10,
        updatedAt: Date.now(),
        deletedAt: null,
      })
    })
    const storageId = await storedBlob(t, "audio/mpeg", 1024)
    await expectCode(
      t.action(internal.music.addTrackAs, {
        userId: ALICE,
        storageId,
        clientKey: "k3",
        name: "n",
      }),
      "LIBRARY_FULL"
    )
    expect(await blobExists(t, storageId)).toBe(false)
  })

  it("is idempotent on clientKey — a retry returns the first row, not a second", async () => {
    const t = setup()
    // A retry mints a FRESH blob before calling addTrack with the SAME
    // clientKey, exactly what clientKey exists to survive — the storedBlob
    // calls below stand in for the two separately-billed uploads a client
    // makes on a lost-response retry.
    const firstStorageId = await storedBlob(t, "audio/mpeg", 1024)
    const first = await t.action(internal.music.addTrackAs, {
      userId: ALICE,
      storageId: firstStorageId,
      clientKey: "same",
      name: "A track",
    })
    const secondStorageId = await storedBlob(t, "audio/mpeg", 1024)
    const second = await t.action(internal.music.addTrackAs, {
      userId: ALICE,
      storageId: secondStorageId,
      clientKey: "same",
      name: "A track",
    })
    expect(second).toBe(first)
    expect(
      await t.query(internal.music.listTracksAs, { userId: ALICE })
    ).toHaveLength(1)
    // The retry's second, freshly-billed blob must not be left unreachable —
    // dedupe the ROW but leak the FILE is the exact failure this guards.
    expect(await blobExists(t, secondStorageId)).toBe(false)
  })

  it("rejects an oversized upload with no content type before ever reading the blob, AND deletes it", async () => {
    const t = setup()
    const storageId = await storedBlob(t, "", MAX_TRACK_BYTES + 1)
    await expectCode(
      t.action(internal.music.addTrackAs, {
        userId: ALICE,
        storageId,
        clientKey: "k7",
        name: "n",
      }),
      "INVALID_TRACK"
    )
    expect(await blobExists(t, storageId)).toBe(false)
  })
})

describe("rename and remove", () => {
  it("renames", async () => {
    const t = setup()
    const trackId = await addTrack(t, ALICE, { name: "Old" })
    await t.mutation(internal.music.renameTrackAs, {
      userId: ALICE,
      trackId,
      name: "New",
    })
    const [track] = await t.query(internal.music.listTracksAs, {
      userId: ALICE,
    })
    expect(track.name).toBe("New")
  })

  it("refuses a blank name", async () => {
    const t = setup()
    const trackId = await addTrack(t, ALICE)
    await expectCode(
      t.mutation(internal.music.renameTrackAs, {
        userId: ALICE,
        trackId,
        name: "   ",
      }),
      "INVALID_TRACK"
    )
  })

  it("removing a track deletes its storage blob", async () => {
    const t = setup()
    const storageId = await storedBlob(t, "audio/mpeg", 64)
    const trackId = await t.action(internal.music.addTrackAs, {
      userId: ALICE,
      storageId,
      clientKey: "k4",
      name: "Doomed",
    })
    await t.mutation(internal.music.removeTrackAs, { userId: ALICE, trackId })
    expect(
      await t.query(internal.music.listTracksAs, { userId: ALICE })
    ).toEqual([])
    expect(await blobExists(t, storageId)).toBe(false)
  })
})

describe("duration", () => {
  it("stores durationMs and returns it from listTracksAs", async () => {
    const t = setup()
    const storageId = await storedBlob(t, "audio/mpeg", 4096)
    const trackId = await t.action(internal.music.addTrackAs, {
      userId: ALICE,
      storageId,
      clientKey: "k8",
      name: "Timed",
      durationMs: 187_000,
    })
    const [track] = await t.query(internal.music.listTracksAs, {
      userId: ALICE,
    })
    expect(track._id).toBe(trackId)
    expect(track.durationMs).toBe(187_000)
  })

  it("setTrackDurationAs hides another user's track behind NOT_FOUND", async () => {
    const t = setup()
    const trackId = await addTrack(t, ALICE)
    await expectCode(
      t.mutation(internal.music.setTrackDurationAs, {
        userId: BOB,
        trackId,
        durationMs: 1000,
      }),
      "NOT_FOUND"
    )
  })
})

describe("usage", () => {
  it("reports bytes and count", async () => {
    const t = setup()
    await addTrack(t, ALICE, { size: 100 })
    await addTrack(t, ALICE, { size: 250 })
    expect(await t.query(internal.music.usageAs, { userId: ALICE })).toEqual({
      bytes: 350,
      count: 2,
    })
  })

  it("does not count a removed track", async () => {
    const t = setup()
    const trackId = await addTrack(t, ALICE, { size: 100 })
    await t.mutation(internal.music.removeTrackAs, { userId: ALICE, trackId })
    expect(await t.query(internal.music.usageAs, { userId: ALICE })).toEqual({
      bytes: 0,
      count: 0,
    })
  })
})

describe("preferences", () => {
  const KEY = { title: "Website Development", projectId: null }

  it("returns null when nothing has been chosen", async () => {
    const t = setup()
    expect(
      await t.query(internal.music.preferenceForAs, { userId: ALICE, ...KEY })
    ).toBe(null)
  })

  it("stores and returns a catalog choice", async () => {
    const t = setup()
    await t.mutation(internal.music.setPreferenceAs, {
      userId: ALICE,
      ...KEY,
      trackRef: { origin: "chroneli", slug: "lofi-chill-beats" },
    })
    expect(
      await t.query(internal.music.preferenceForAs, { userId: ALICE, ...KEY })
    ).toEqual({ origin: "chroneli", slug: "lofi-chill-beats" })
  })

  it("upserts rather than accumulating rows", async () => {
    const t = setup()
    for (const slug of ["a", "b", "c"]) {
      await t.mutation(internal.music.setPreferenceAs, {
        userId: ALICE,
        ...KEY,
        trackRef: { origin: "chroneli", slug },
      })
    }
    expect(
      await t.query(internal.music.preferenceForAs, { userId: ALICE, ...KEY })
    ).toEqual({ origin: "chroneli", slug: "c" })
    const rows = await t.run(
      async (ctx) => await ctx.db.query("musicPreferences").collect()
    )
    expect(rows).toHaveLength(1)
  })

  // The rule inherited from groupSittings. Without it every unnamed entry in
  // the account shares one preference and overwrites it in turn.
  it("never stores a preference for a blank title", async () => {
    const t = setup()
    await t.mutation(internal.music.setPreferenceAs, {
      userId: ALICE,
      title: "   ",
      projectId: null,
      trackRef: { origin: "chroneli", slug: "lofi-chill-beats" },
    })
    const rows = await t.run(
      async (ctx) => await ctx.db.query("musicPreferences").collect()
    )
    expect(rows).toEqual([])
  })

  it("trims the title, so a stray space is the same work", async () => {
    const t = setup()
    await t.mutation(internal.music.setPreferenceAs, {
      userId: ALICE,
      title: "  Coding  ",
      projectId: null,
      trackRef: { origin: "chroneli", slug: "lofi-chill-beats" },
    })
    expect(
      await t.query(internal.music.preferenceForAs, {
        userId: ALICE,
        title: "Coding",
        projectId: null,
      })
    ).toEqual({ origin: "chroneli", slug: "lofi-chill-beats" })
  })

  it("keeps one user's preference out of another's", async () => {
    const t = setup()
    await t.mutation(internal.music.setPreferenceAs, {
      userId: ALICE,
      ...KEY,
      trackRef: { origin: "chroneli", slug: "lofi-chill-beats" },
    })
    expect(
      await t.query(internal.music.preferenceForAs, { userId: BOB, ...KEY })
    ).toBe(null)
  })

  /*
   * The two halves of "a preference naming a missing track must not produce
   * silence". `removeTrackImpl` leaves the preference row behind by design —
   * so the read is where the dangling ref has to stop, and these two tests
   * together say it stops there WITHOUT also swallowing live refs, which is
   * the way an over-eager guard would "fix" this and break the feature.
   */
  it("reads back as null once the upload it names has been removed", async () => {
    const t = setup()
    const trackId = await addTrack(t, ALICE, { name: "Doomed" })
    await t.mutation(internal.music.setPreferenceAs, {
      userId: ALICE,
      ...KEY,
      trackRef: { origin: "upload", trackId },
    })
    expect(
      await t.query(internal.music.preferenceForAs, { userId: ALICE, ...KEY })
    ).toEqual({ origin: "upload", trackId })

    await t.mutation(internal.music.removeTrackAs, { userId: ALICE, trackId })

    expect(
      await t.query(internal.music.preferenceForAs, { userId: ALICE, ...KEY })
    ).toBe(null)
    // The row itself is deliberately left alone — a query cannot write, and
    // the next genuine pick overwrites it. Asserted so a future "tidy-up"
    // that turns this query into a mutation has to argue with a test first.
    const rows = await t.run(
      async (ctx) => await ctx.db.query("musicPreferences").collect()
    )
    expect(rows).toHaveLength(1)
  })

  it("still returns a preference naming a live upload", async () => {
    const t = setup()
    const trackId = await addTrack(t, ALICE, { name: "Alive" })
    await t.mutation(internal.music.setPreferenceAs, {
      userId: ALICE,
      ...KEY,
      trackRef: { origin: "upload", trackId },
    })
    expect(
      await t.query(internal.music.preferenceForAs, { userId: ALICE, ...KEY })
    ).toEqual({ origin: "upload", trackId })
  })

  it("refuses a preference pointing at someone else's upload", async () => {
    const t = setup()
    const trackId = await addTrack(t, ALICE)
    await expectCode(
      t.mutation(internal.music.setPreferenceAs, {
        userId: BOB,
        ...KEY,
        trackRef: { origin: "upload", trackId },
      }),
      "NOT_FOUND"
    )
  })
})
