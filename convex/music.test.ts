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
import { MAX_TRACK_BYTES } from "./lib/audio"
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
    // Seed the library right up to the cap without uploading 500 MB: write the
    // row directly, which is what the sum reads.
    await t.run(async (ctx) => {
      await ctx.db.insert("musicTracks", {
        userId: ALICE,
        clientKey: "seed",
        storageId: await ctx.storage.store(
          new Blob([new Uint8Array(1)], { type: "audio/mpeg" })
        ),
        name: "Seed",
        contentType: "audio/mpeg",
        bytes: 500 * 1024 * 1024 - 10,
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
    const first = await addTrack(t, ALICE, { clientKey: "same" })
    const second = await addTrack(t, ALICE, { clientKey: "same" })
    expect(second).toBe(first)
    expect(
      await t.query(internal.music.listTracksAs, { userId: ALICE })
    ).toHaveLength(1)
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
