import { v } from "convex/values"
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { internal } from "./_generated/api"
import { requireUserId } from "./auth"
import { traceError } from "./errors"
import { getOwned } from "./owned"
import {
  MAX_LIBRARY_BYTES,
  MAX_TRACK_BYTES,
  MAX_TRACK_COUNT,
  MAX_TRACK_NAME_LENGTH,
  isAcceptedAudioContentType,
} from "./lib/audio"
import type { Id } from "./_generated/dataModel"
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server"

/*
 * The music library.
 *
 * The upload path is `settings.setLogo`'s, deliberately — including the part
 * that is easy to skip. Convex stores the blob BEFORE any of our code sees it
 * (the browser POSTs straight to the upload URL), so every rejection below has
 * to delete what is already there. Skip it and each rejected upload leaks a
 * paid-for file that no row references and no UI can reach.
 *
 * One thing it does NOT copy from `setLogoAction`: the order size and content
 * type are checked in. See the comment on the size check in `addTrackAction`
 * for why a 20 MiB cap earns a different order than a 1 MiB one.
 */

const trackReturns = v.object({
  _id: v.id("musicTracks"),
  name: v.string(),
  bytes: v.number(),
  durationMs: v.optional(v.number()),
  /** Signed and short-lived. Null when the blob has gone missing, which the
   *  client treats as an unplayable track rather than an error. */
  url: v.union(v.string(), v.null()),
})

async function liveTracks(ctx: QueryCtx | MutationCtx, userId: string) {
  const rows = await ctx.db
    .query("musicTracks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()
  return rows.filter((row) => row.deletedAt === null)
}

async function listTracksImpl(ctx: QueryCtx, userId: string) {
  const rows = await liveTracks(ctx, userId)
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return await Promise.all(
    rows.map(async (row) => ({
      _id: row._id,
      name: row.name,
      bytes: row.bytes,
      ...(row.durationMs === undefined ? {} : { durationMs: row.durationMs }),
      url: await ctx.storage.getUrl(row.storageId),
    }))
  )
}

export const listTracks = query({
  args: {},
  returns: v.array(trackReturns),
  handler: async (ctx) => await listTracksImpl(ctx, await requireUserId(ctx)),
})

export const listTracksAs = internalQuery({
  args: { userId: v.string() },
  returns: v.array(trackReturns),
  handler: async (ctx, args) => await listTracksImpl(ctx, args.userId),
})

const usageReturns = v.object({ bytes: v.number(), count: v.number() })

/**
 * How much of the account cap is used.
 *
 * Summed from the rows rather than held as a running total. A denormalised
 * counter is a number that can drift from what it claims to describe, and a
 * storage meter that lies is worse than one that costs a few hundred rows —
 * which `MAX_TRACK_COUNT` is what bounds.
 */
async function usageImpl(ctx: QueryCtx | MutationCtx, userId: string) {
  const rows = await liveTracks(ctx, userId)
  return {
    bytes: rows.reduce((total, row) => total + row.bytes, 0),
    count: rows.length,
  }
}

export const usage = query({
  args: {},
  returns: usageReturns,
  handler: async (ctx) => await usageImpl(ctx, await requireUserId(ctx)),
})

export const usageAs = internalQuery({
  args: { userId: v.string() },
  returns: usageReturns,
  handler: async (ctx, args) => await usageImpl(ctx, args.userId),
})

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUserId(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

// --- the upload path -------------------------------------------------------

export const readTrackMetadata = internalQuery({
  args: { storageId: v.id("_storage") },
  returns: v.union(
    v.object({ size: v.number(), contentType: v.optional(v.string()) }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const metadata = await ctx.db.system.get("_storage", args.storageId)
    if (metadata === null) return null
    return {
      size: metadata.size,
      ...(metadata.contentType === undefined
        ? {}
        : { contentType: metadata.contentType }),
    }
  },
})

export const deleteUpload = internalMutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Guarded the same way `settings.deleteLogoUpload` is: a caller reaches
    // here BECAUSE `readTrackMetadata` (or the delete below itself, on a
    // second rejection reason) already found nothing at this id, and Convex
    // deleting a storage id with no metadata is exactly the kind of call that
    // should never happen — asking it to do so anyway would surface an opaque
    // storage error in place of the caller's own INVALID_TRACK.
    if ((await ctx.db.system.get("_storage", args.storageId)) !== null) {
      await ctx.storage.delete(args.storageId)
    }
    return null
  },
})

export const acceptTrack = internalMutation({
  args: {
    userId: v.string(),
    storageId: v.id("_storage"),
    clientKey: v.string(),
    name: v.string(),
    contentType: v.string(),
    bytes: v.number(),
  },
  returns: v.union(v.id("musicTracks"), v.null()),
  handler: async (ctx, args): Promise<Id<"musicTracks"> | null> => {
    // Idempotency, checked INSIDE the mutation so two concurrent retries cannot
    // both pass a check made outside one.
    const existing = await ctx.db
      .query("musicTracks")
      .withIndex("by_user_clientKey", (q) =>
        q.eq("userId", args.userId).eq("clientKey", args.clientKey)
      )
      .first()
    if (existing !== null) {
      // A retry mints a FRESH blob before calling this, so returning the first
      // row without deleting it would dedupe the ROW and bill for both FILES —
      // which is the exact failure `clientKey` exists to prevent. Guarded on
      // inequality because a caller may legitimately re-send the same pair.
      if (existing.storageId !== args.storageId) {
        await ctx.storage.delete(args.storageId)
      }
      return existing._id
    }

    const { bytes, count } = await usageImpl(ctx, args.userId)
    if (bytes + args.bytes > MAX_LIBRARY_BYTES || count + 1 > MAX_TRACK_COUNT) {
      // NULL rather than a throw: the caller has a blob to delete first, and an
      // exception here would skip that cleanup.
      return null
    }

    return await ctx.db.insert("musicTracks", {
      userId: args.userId,
      clientKey: args.clientKey,
      storageId: args.storageId,
      name: args.name,
      contentType: args.contentType,
      bytes: args.bytes,
      updatedAt: Date.now(),
      deletedAt: null,
    })
  },
})

const addTrackArgs = {
  storageId: v.id("_storage"),
  clientKey: v.string(),
  name: v.string(),
  durationMs: v.optional(v.number()),
}

async function addTrackAction(
  ctx: ActionCtx,
  userId: string,
  args: {
    storageId: Id<"_storage">
    clientKey: string
    name: string
    durationMs?: number
  }
): Promise<Id<"musicTracks">> {
  const metadata = await ctx.runQuery(internal.music.readTrackMetadata, {
    storageId: args.storageId,
  })

  // `settings.setLogoAction` reads the blob's own content type BEFORE
  // checking size, and the plan modeled this action on that same order. That
  // order is fine for a logo, whose cap is 1 MiB: the worst an untyped upload
  // can force into the action's memory is one megabyte. This cap is 20 MiB —
  // twenty times as much — and `Content-Type` is entirely client-controlled,
  // so omitting it costs an attacker nothing and can be repeated for free.
  // Fetching the blob before its size is known would materialize an
  // arbitrarily large file in memory on every such attempt, and if that OOMs
  // or times out, the cleanup below never runs and the blob is orphaned for
  // good. So here the size check runs FIRST, against metadata alone — nothing
  // this cheap to trigger should ever cause a blob fetch — and the blob is
  // only read once a file is already known to fit.
  if (metadata === null || metadata.size > MAX_TRACK_BYTES) {
    await ctx.runMutation(internal.music.deleteUpload, {
      storageId: args.storageId,
    })
    traceError(
      "INVALID_TRACK",
      "Use an MP3, M4A, WAV, OGG or FLAC file no larger than 20 MB."
    )
  }

  // Convex does not always record a content type; fall back to the blob's
  // own, now that its size is known to be within bounds.
  const blob =
    metadata.contentType === undefined
      ? await ctx.storage.get(args.storageId)
      : null
  const contentType = metadata.contentType ?? blob?.type

  if (!isAcceptedAudioContentType(contentType)) {
    await ctx.runMutation(internal.music.deleteUpload, {
      storageId: args.storageId,
    })
    traceError(
      "INVALID_TRACK",
      "Use an MP3, M4A, WAV, OGG or FLAC file no larger than 20 MB."
    )
  }

  // A blank name and an unsupported file are different problems with
  // different fixes, so this earns its own check and its own message rather
  // than folding into the content-type rejection above — the combined
  // message used to send someone to re-encode a perfectly good file over a
  // name they simply left empty.
  const name = args.name.trim().slice(0, MAX_TRACK_NAME_LENGTH)
  if (name === "") {
    await ctx.runMutation(internal.music.deleteUpload, {
      storageId: args.storageId,
    })
    traceError("INVALID_TRACK", "A track needs a name.")
  }

  const trackId = await ctx.runMutation(internal.music.acceptTrack, {
    userId,
    storageId: args.storageId,
    clientKey: args.clientKey,
    name,
    contentType,
    bytes: metadata.size,
  })

  if (trackId === null) {
    await ctx.runMutation(internal.music.deleteUpload, {
      storageId: args.storageId,
    })
    traceError(
      "LIBRARY_FULL",
      "Your music library is full. Remove a track to make room."
    )
  }

  if (args.durationMs !== undefined) {
    await ctx.runMutation(internal.music.setTrackDuration, {
      userId,
      trackId,
      durationMs: args.durationMs,
    })
  }

  return trackId
}

export const addTrack = action({
  args: addTrackArgs,
  returns: v.id("musicTracks"),
  handler: async (ctx, args): Promise<Id<"musicTracks">> => {
    const userId: string = await ctx.runQuery(internal.music.callerUserId, {})
    return await addTrackAction(ctx, userId, args)
  },
})

export const addTrackAs = internalAction({
  args: { ...addTrackArgs, userId: v.string() },
  returns: v.id("musicTracks"),
  handler: async (ctx, args): Promise<Id<"musicTracks">> =>
    await addTrackAction(ctx, args.userId, args),
})

/** An action cannot call `requireUserId` directly — it has no database ctx. */
export const callerUserId = internalQuery({
  args: {},
  returns: v.string(),
  handler: async (ctx) => await requireUserId(ctx),
})

export const setTrackDuration = internalMutation({
  args: {
    userId: v.string(),
    trackId: v.id("musicTracks"),
    durationMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const track = await getOwned(ctx, args.userId, "musicTracks", args.trackId)
    await ctx.db.patch(track._id, {
      durationMs: args.durationMs,
      updatedAt: Date.now(),
    })
    return null
  },
})

// --- rename and remove -----------------------------------------------------

async function renameTrackImpl(
  ctx: MutationCtx,
  userId: string,
  args: { trackId: Id<"musicTracks">; name: string }
): Promise<null> {
  const track = await getOwned(ctx, userId, "musicTracks", args.trackId)
  const name = args.name.trim().slice(0, MAX_TRACK_NAME_LENGTH)
  if (name === "") {
    traceError("INVALID_TRACK", "A track needs a name.")
  }
  await ctx.db.patch(track._id, { name, updatedAt: Date.now() })
  return null
}

const renameArgs = { trackId: v.id("musicTracks"), name: v.string() }

export const renameTrack = mutation({
  args: renameArgs,
  returns: v.null(),
  handler: async (ctx, args) =>
    await renameTrackImpl(ctx, await requireUserId(ctx), args),
})

export const renameTrackAs = internalMutation({
  args: { ...renameArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await renameTrackImpl(ctx, args.userId, args),
})

/**
 * Removes a track and DELETES ITS BLOB in the same mutation.
 *
 * A hard delete, unlike projects and clients: nothing historical references a
 * track the way an invoice references a client, so there is no past document to
 * keep renderable. Leaving the blob behind would mean the usage meter and the
 * storage bill disagree — and the bill is the one that is right, so the user
 * would be charged for files the product has told them are gone.
 */
async function removeTrackImpl(
  ctx: MutationCtx,
  userId: string,
  args: { trackId: Id<"musicTracks"> }
): Promise<null> {
  const track = await getOwned(ctx, userId, "musicTracks", args.trackId)
  await ctx.storage.delete(track.storageId)
  await ctx.db.delete(track._id)
  return null
}

export const removeTrack = mutation({
  args: { trackId: v.id("musicTracks") },
  returns: v.null(),
  handler: async (ctx, args) =>
    await removeTrackImpl(ctx, await requireUserId(ctx), args),
})

export const removeTrackAs = internalMutation({
  args: { trackId: v.id("musicTracks"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await removeTrackImpl(ctx, args.userId, args),
})
