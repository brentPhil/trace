import { v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { getOwned } from "./owned"
import { traceError } from "./errors"
import { ENTRY_SCAN_LIMIT } from "./lib/scan"
import { tagDoc } from "./lib/docs"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

const MAX_NAME_LENGTH = 60

/*
 * Tags.
 *
 * Flat by design — see the schema. Hierarchy is what turns tags into a second
 * project taxonomy, at which point the user has two systems that disagree about
 * where a piece of work belongs.
 *
 * Unlike projects, tags have no colour and no archive. A tag is a word; the
 * only operations that make sense are create, rename, and delete.
 */

async function allTags(
  ctx: QueryCtx | MutationCtx,
  userId: string
): Promise<Array<Doc<"tags">>> {
  const rows = await ctx.db
    .query("tags")
    .withIndex("by_user_name", (q) => q.eq("userId", userId))
    .collect()
  return rows.filter((row) => row.deletedAt === null)
}

function checkName(name: string): string {
  // Leading "#" is stripped: the picker is reached by typing `#`, so the
  // character ends up in the buffer constantly. Storing "#urgent" and "urgent"
  // as different tags would be a papercut on every single use.
  const trimmed = name.trim().replace(/^#+/, "").trim()
  if (trimmed === "") traceError("TOO_LONG", "A tag needs a name.")
  if (trimmed.length > MAX_NAME_LENGTH) {
    traceError("TOO_LONG", `Keep the tag under ${MAX_NAME_LENGTH} characters.`)
  }
  return trimmed
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

async function listImpl(ctx: QueryCtx, userId: string): Promise<Array<Doc<"tags">>> {
  const rows = await allTags(ctx, userId)
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export const list = query({
  args: {},
  returns: v.array(tagDoc),
  handler: async (ctx) => await listImpl(ctx, await requireUserId(ctx)),
})

export const listAs = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await listImpl(ctx, args.userId),
})

// ---------------------------------------------------------------------------
// ensure
// ---------------------------------------------------------------------------

const ensureReturns = v.object({
  tagId: v.id("tags"),
  created: v.boolean(),
})

/**
 * Returns the tag with this name, creating it if it does not exist.
 *
 * Get-or-create rather than create, because the picker's flow is "type a word,
 * press Enter" and the user does not know or care whether that word is already
 * a tag. Two tags differing only in case would be the same word to a human, so
 * the match is case-insensitive — but the ORIGINAL casing is kept on the row
 * that already exists, since renaming someone's "OKRs" to "okrs" because they
 * typed it lowercase once is not a thing they asked for.
 */
async function ensureImpl(ctx: MutationCtx, userId: string, name: string) {
  const clean = checkName(name)
  const existing = await allTags(ctx, userId)
  const match = existing.find(
    (row) => row.name.toLowerCase() === clean.toLowerCase()
  )
  if (match !== undefined) return { tagId: match._id, created: false }

  const tagId = await ctx.db.insert("tags", {
    userId,
    name: clean,
    updatedAt: Date.now(),
    deletedAt: null,
  })
  return { tagId, created: true }
}

export const ensure = mutation({
  args: { name: v.string() },
  returns: ensureReturns,
  handler: async (ctx, args) => await ensureImpl(ctx, await requireUserId(ctx), args.name),
})

export const ensureAs = internalMutation({
  args: { name: v.string(), userId: v.string() },
  returns: ensureReturns,
  handler: async (ctx, args) => await ensureImpl(ctx, args.userId, args.name),
})

// ---------------------------------------------------------------------------
// rename
// ---------------------------------------------------------------------------

/**
 * Renames a tag in place.
 *
 * Entries reference the tag by id, so this correctly updates every historical
 * row — the same property that makes `remove` below allowed to refuse. Merging
 * into an existing tag of the same name is deliberately NOT done: it is a
 * destructive many-to-one operation hiding behind a rename box.
 */
async function renameImpl(
  ctx: MutationCtx,
  userId: string,
  tagId: Id<"tags">,
  name: string
) {
  const tag = await getOwned(ctx, userId, "tags", tagId)
  const clean = checkName(name)

  const existing = await allTags(ctx, userId)
  const clash = existing.find(
    (row) => row._id !== tag._id && row.name.toLowerCase() === clean.toLowerCase()
  )
  if (clash !== undefined) {
    traceError("IN_USE", `You already have a tag called "${clash.name}".`)
  }

  await ctx.db.patch(tag._id, { name: clean, updatedAt: Date.now() })
  return null
}

const renameArgs = { tagId: v.id("tags"), name: v.string() }

export const rename = mutation({
  args: renameArgs,
  returns: v.null(),
  handler: async (ctx, args) =>
    await renameImpl(ctx, await requireUserId(ctx), args.tagId, args.name),
})

export const renameAs = internalMutation({
  args: { ...renameArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await renameImpl(ctx, args.userId, args.tagId, args.name),
})

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

/**
 * Deletes a tag, and REFUSES while any live entry carries it.
 *
 * Same contract as projects, for the same reason: no dangling reference means
 * no denormalised copy, which means a rename fixes history everywhere.
 *
 * There is no index on `tagIds` — Convex cannot index array membership — so
 * proving a tag is unused means reading EVERY entry the account has, not just
 * the ones that carry it. That is the difference from `projects.remove`, which
 * has `by_user_project` and reads only its own.
 *
 * The scan is bounded, because an unbounded `.collect()` over a long history
 * exceeds the per-transaction byte limit and fails with an internal error the
 * user can do nothing with.
 *
 * KNOWN LIMITATION, stated plainly because the bound is not the whole story:
 * the scan is not filtered by tag, so once an account passes ENTRY_SCAN_LIMIT
 * entries in total, this refuses for EVERY tag, permanently — including a tag
 * created this morning and used on nothing. It is not an occasional refusal
 * that a heavy user meets now and then; past the threshold, tag deletion simply
 * stops working. Renaming still works and still reaches every entry, so the tag
 * remains manageable, but it cannot be removed.
 *
 * The fix is an `entryTags` join table indexed by tag, which turns this whole
 * function into a single indexed lookup. That is a schema change with a
 * backfill, so it is recorded as follow-up work rather than smuggled in here.
 */
async function removeImpl(ctx: MutationCtx, userId: string, tagId: Id<"tags">) {
  const tag = await getOwned(ctx, userId, "tags", tagId)

  const entries = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_started", (q) => q.eq("userId", userId))
    .take(ENTRY_SCAN_LIMIT + 1)

  const live = entries
    .slice(0, ENTRY_SCAN_LIMIT)
    .filter((entry) => entry.deletedAt === null && entry.tagIds.includes(tag._id))

  if (live.length > 0) {
    traceError(
      "IN_USE",
      `${live.length} ${live.length === 1 ? "entry carries" : "entries carry"} this tag. Remove it from them first.`,
      { count: live.length }
    )
  }

  // Nothing found, but not everything was looked at — so "it is unused" is not
  // a claim this can make, and it does not make it.
  //
  // The message does not offer renaming as a substitute. Renaming is a useful
  // thing to do and it does reach every entry, but it does not delete the tag,
  // and telling someone to rename when they asked to delete is answering a
  // question they did not ask. Better to say what is true.
  if (entries.length > ENTRY_SCAN_LIMIT) {
    traceError(
      "IN_USE",
      "This account has too many entries to check a tag against, so deleting one is not possible here. Renaming it still works and reaches every entry that carries it."
    )
  }

  await ctx.db.patch(tag._id, { deletedAt: Date.now(), updatedAt: Date.now() })
  return null
}

export const remove = mutation({
  args: { tagId: v.id("tags") },
  returns: v.null(),
  handler: async (ctx, args) => await removeImpl(ctx, await requireUserId(ctx), args.tagId),
})

export const removeAs = internalMutation({
  args: { tagId: v.id("tags"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await removeImpl(ctx, args.userId, args.tagId),
})
