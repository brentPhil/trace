import { traceError } from "./errors"
import type { Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

/** The `migrationState` row that says `entryTags` covers all of history. */
export const ENTRY_TAGS_MIGRATION = "entryTags"

/**
 * The sole writer of the `entryTags` join table.
 *
 * Lives at the convex root next to owned.ts rather than in convex/lib, because
 * convex/lib is aliased as `@shared` and imported by the CLIENT — everything in
 * there has to stay pure. This touches the database.
 *
 * RECONCILES rather than inserts: it reads what the entry currently has and
 * makes the table equal `tagIds`, adding and removing as needed. Three things
 * fall out of that, all of them load-bearing:
 *
 *   - Retagging an entry cannot leave a stale row behind. A stale row protects
 *     its tag from deletion forever, on the strength of an entry that no longer
 *     carries it — a refusal the user could never act on, because the entry they
 *     would be sent to fix is already correct.
 *   - Calling it twice is the same as calling it once, so the backfill can be
 *     re-run over rows it has already done without producing duplicates.
 *   - `[]` is the ordinary way to say "this entry carries nothing now", so a
 *     soft-delete has no separate code path.
 *
 * The reads are bounded by the per-entry tag cap (10), not by history.
 */
export async function syncEntryTags(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"timeEntries">,
  tagIds: Array<Id<"tags">>
): Promise<void> {
  const existing = await ctx.db
    .query("entryTags")
    .withIndex("by_user_entry", (q) =>
      q.eq("userId", userId).eq("entryId", entryId)
    )
    .collect()

  const wanted = new Set<Id<"tags">>(tagIds)

  for (const row of existing) {
    // Deletes duplicates too: the second row for a tag is not in `wanted` by
    // the time it is reached, because the first one removed it.
    if (wanted.has(row.tagId)) wanted.delete(row.tagId)
    else await ctx.db.delete(row._id)
  }

  for (const tagId of wanted) {
    await ctx.db.insert("entryTags", { userId, entryId, tagId })
  }
}

/**
 * Drops every row for an entry that has stopped being live.
 *
 * Named separately from `syncEntryTags(..., [])` so the call sites in
 * `entries.remove` and `entries.discardRunning` say what they mean. The entry
 * keeps its `tagIds` — it is in the trash, not edited — and `restore` puts the
 * rows back from that same array.
 */
export async function dropEntryTags(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"timeEntries">
): Promise<void> {
  await syncEntryTags(ctx, userId, entryId, [])
}

/**
 * The completion marker, or null.
 *
 * `.first()` rather than `.unique()`. A duplicate row here cannot arise from
 * this code, but it can from a hand-run dashboard insert or a `convex import` —
 * and `.unique()` would then throw a non-Trace error on every tag delete AND
 * inside `markEntryTagsBackfilled`, so the wedge could not be cleared by
 * re-running the backfill. Two rows saying the same thing is not a problem
 * worth turning into an outage.
 */
async function migrationRow(ctx: QueryCtx | MutationCtx) {
  return await ctx.db
    .query("migrationState")
    .withIndex("by_name", (q) => q.eq("name", ENTRY_TAGS_MIGRATION))
    .first()
}

/**
 * Refuses anything that would read an incomplete `entryTags` as the truth.
 *
 * The dangerous read is the EMPTY one. A tag with no join rows is indis-
 * tinguishable from a tag whose rows have not been written yet, and the first
 * means "safe to delete". Between deploy and backfill every tag looks unused,
 * so without this the first person to tidy their tag list in that window
 * deletes tags a thousand entries carry — and the entries keep pointing at rows
 * that are gone, which is the one thing the whole refusal design exists to make
 * impossible.
 *
 * A deployment with NO entries is exempt, and marked complete on the spot. The
 * argument above is that an empty index cannot be told apart from an unindexed
 * one; where there is no history there is nothing to tell apart, and the table
 * is complete by virtue of covering nothing. Without this every fresh
 * environment — a new dev instance, a preview branch, a first install — would
 * start wedged behind a migration over zero rows, which is a worse default than
 * the problem it guards.
 *
 * It RECORDS completion rather than just allowing it, so the answer cannot
 * flap: re-deriving emptiness on every call would mean tag deletion worked
 * until the user tracked their first entry and then silently stopped.
 *
 * Deliberately its own code rather than IN_USE: this is not a statement about
 * the tag, and an operator reading the logs should not have to guess that.
 */
export async function assertEntryTagsBackfilled(
  ctx: MutationCtx
): Promise<void> {
  if (await entryTagsBackfilled(ctx)) return

  if ((await ctx.db.query("timeEntries").first()) === null) {
    await markEntryTagsBackfilled(ctx)
    return
  }

  // No promise about when this clears. Nothing clears it on its own — it takes
  // `npx convex run migrations:runEntryTagsBackfill` — and a message that says
  // otherwise sends the user away to wait for something that will not happen.
  traceError(
    "NOT_READY",
    "Tags cannot be deleted yet: existing entries are still being indexed. Renaming works now."
  )
}

/** True once the backfill has run to the END of the table, not merely started. */
export async function entryTagsBackfilled(
  ctx: QueryCtx | MutationCtx
): Promise<boolean> {
  const row = await migrationRow(ctx)
  return row !== null && row.completedAt !== null
}

/**
 * Where the next page starts.
 *
 * Read from the database rather than taken from the caller. An externally
 * supplied starting point silently defines COVERAGE: hand in a cursor from the
 * middle of the table and every earlier entry goes unreconciled, while the run
 * still reaches the end and records itself complete. `tags.remove` then trusts
 * an index covering a fraction of history and deletes tags that live entries
 * carry. Resumability is worth having; it is not worth an argument that can
 * quietly narrow what "done" means.
 */
export async function readEntryTagsCursor(
  ctx: MutationCtx
): Promise<string | null> {
  return (await migrationRow(ctx))?.cursor ?? null
}

/**
 * Advances the checkpoint.
 *
 * Called in the SAME mutation as the page it describes, so the rows and the
 * record of having written them commit together. A crash between the two is
 * therefore not a state this can be in.
 */
export async function saveEntryTagsCursor(
  ctx: MutationCtx,
  cursor: string
): Promise<void> {
  const row = await migrationRow(ctx)
  if (row === null) {
    await ctx.db.insert("migrationState", {
      name: ENTRY_TAGS_MIGRATION,
      cursor,
      completedAt: null,
    })
    return
  }
  await ctx.db.patch(row._id, { cursor })
}

/** Records that the backfill reached the end. Idempotent. */
export async function markEntryTagsBackfilled(ctx: MutationCtx): Promise<void> {
  const row = await migrationRow(ctx)
  const completedAt = Date.now()
  if (row === null) {
    await ctx.db.insert("migrationState", {
      name: ENTRY_TAGS_MIGRATION,
      cursor: null,
      completedAt,
    })
    return
  }
  if (row.completedAt !== null) return
  await ctx.db.patch(row._id, { cursor: null, completedAt })
}
