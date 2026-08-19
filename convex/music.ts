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
  /** Convex sets this on every document automatically; it is surfaced here so
   *  the client's "Recently added" sort can order by an actual timestamp
   *  instead of the document id, which carries no ordering guarantee. */
  _creationTime: v.number(),
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
      _creationTime: row._creationTime,
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
    await ctx.runMutation(internal.music.setTrackDurationAs, {
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

/** `As`, not a bare name: this file's convention is that a function taking an
 *  explicit `userId` instead of reading it off the caller's identity says so in
 *  its name, so a reviewer can tell at a glance which functions trust an
 *  argument for ownership. It was the one internal in here that did not. */
export const setTrackDurationAs = internalMutation({
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

// --- preferences -----------------------------------------------------------

/**
 * Which music goes with which piece of work.
 *
 * The key is `sittingKey`'s — the title trimmed, beside the project — because
 * that is the only identity that survives a resume. See the schema for the
 * argument at length.
 */
const trackRefValidator = v.union(
  v.object({ origin: v.literal("upload"), trackId: v.id("musicTracks") }),
  v.object({ origin: v.literal("chroneli"), slug: v.string() })
)

const preferenceKeyArgs = {
  title: v.string(),
  projectId: v.union(v.id("projects"), v.null()),
}

async function findPreference(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  title: string,
  projectId: Id<"projects"> | null
) {
  return await ctx.db
    .query("musicPreferences")
    .withIndex("by_user_title_project", (q) =>
      q.eq("userId", userId).eq("title", title).eq("projectId", projectId)
    )
    .first()
}

/**
 * The stored ref, or `null` — INCLUDING when the row exists but names a track
 * that no longer does.
 *
 * `removeTrackImpl` above hard-deletes the row and the blob and leaves every
 * preference pointing at it, so a stale upload ref is not an exotic state: it
 * is what deleting a track you had once picked always produces. Handing that
 * ref back unchecked is what made a record autoplay nothing forever — the
 * client resolved it against a list it was not in, `playRef` found no track,
 * and nothing ever re-resolved.
 *
 * The stale row is NOT deleted here, and the spec's "cleaned on read" wording
 * overpromised. `preferenceFor` is a `query`; a query cannot write, and the
 * cures for that are all worse than the disease — turning a read every timer
 * start performs into a mutation costs a write on the hot path and forfeits
 * the reactive cache; scheduling a delete from a query is not a thing Convex
 * offers; a migration is the explicitly rejected option. What actually matters
 * is the ANSWER, and `null` here is exactly the answer a deleted track should
 * produce: the client falls through to the next resolution step, and the next
 * genuine user pick overwrites the row in place via `setPreferenceImpl`'s
 * upsert. A row nobody can observe is not a bug, it is a few dozen bytes.
 *
 * A catalog ref is deliberately NOT validated against `CATALOG` — that list
 * lives in the client bundle, the server has no copy, and inventing one here
 * would put the same array in two places that must never disagree. A slug
 * whose file has gone fails the same way on the client, through
 * `resolveTrackUrl` returning null, which the resolver already walks past.
 */
async function preferenceForImpl(
  ctx: QueryCtx,
  userId: string,
  args: { title: string; projectId: Id<"projects"> | null }
) {
  const title = args.title.trim()
  if (title === "") return null
  const row = await findPreference(ctx, userId, title, args.projectId)
  const ref = row?.trackRef ?? null
  if (ref === null || ref.origin !== "upload") return ref

  // `ctx.db.get` rather than `getOwned`: this is a lookup that is ALLOWED to
  // come back empty, and `getOwned` answers "missing" by throwing NOT_FOUND —
  // which here would turn one deleted track into a hard failure of the query
  // the whole autoplay path waits on, i.e. exactly the silence being fixed.
  // The ownership half of `getOwned` is still enforced, by hand, because a
  // preference row is user-supplied storage and must not become a way to ask
  // whether another account's track id exists.
  const track = await ctx.db.get(ref.trackId)
  if (track === null || track.userId !== userId || track.deletedAt !== null) {
    return null
  }
  return ref
}

export const preferenceFor = query({
  args: preferenceKeyArgs,
  returns: v.union(trackRefValidator, v.null()),
  handler: async (ctx, args) =>
    await preferenceForImpl(ctx, await requireUserId(ctx), args),
})

export const preferenceForAs = internalQuery({
  args: { ...preferenceKeyArgs, userId: v.string() },
  returns: v.union(trackRefValidator, v.null()),
  handler: async (ctx, args) => await preferenceForImpl(ctx, args.userId, args),
})

/**
 * Records a choice the USER made.
 *
 * Called when the user changes track while an entry is running — NEVER on
 * timer start. Writing on start would mean the resolver's own arbitrary
 * fallback immediately becomes a stored preference indistinguishable from a
 * deliberate one, and after a week every record in the account "prefers" the
 * first catalog track.
 *
 * A blank title writes NOTHING and does not raise: it is a normal state, not an
 * error, and the caller has no useful response to an exception here.
 */
async function setPreferenceImpl(
  ctx: MutationCtx,
  userId: string,
  args: {
    title: string
    projectId: Id<"projects"> | null
    trackRef:
      | { origin: "upload"; trackId: Id<"musicTracks"> }
      | { origin: "chroneli"; slug: string }
  }
): Promise<null> {
  const title = args.title.trim()
  if (title === "") return null

  // An upload must belong to the caller. Without this, a preference is a place
  // to stash a reference to another user's track id and have the client fetch
  // its signed URL.
  if (args.trackRef.origin === "upload") {
    await getOwned(ctx, userId, "musicTracks", args.trackRef.trackId)
  }

  const existing = await findPreference(ctx, userId, title, args.projectId)
  const updatedAt = Date.now()
  if (existing === null) {
    await ctx.db.insert("musicPreferences", {
      userId,
      title,
      projectId: args.projectId,
      trackRef: args.trackRef,
      updatedAt,
    })
  } else {
    await ctx.db.patch(existing._id, { trackRef: args.trackRef, updatedAt })
  }
  return null
}

const setPreferenceArgs = { ...preferenceKeyArgs, trackRef: trackRefValidator }

export const setPreference = mutation({
  args: setPreferenceArgs,
  returns: v.null(),
  handler: async (ctx, args) =>
    await setPreferenceImpl(ctx, await requireUserId(ctx), args),
})

export const setPreferenceAs = internalMutation({
  args: { ...setPreferenceArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await setPreferenceImpl(ctx, args.userId, args),
})
