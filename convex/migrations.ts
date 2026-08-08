import { v } from "convex/values"
import { internalAction, internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import { markEntryTagsBackfilled, syncEntryTags } from "./entryTags"

/**
 * One-off data migrations.
 *
 * Hand-rolled rather than `@convex-dev/migrations`, because this project has
 * exactly one migration and adding a component for it would be a larger change
 * than the migration.
 */

/**
 * How many entries one call of the backfill reconciles.
 *
 * A mutation has a write ceiling as well as a read one, and the per-entry tag
 * cap is 10, so a page of 200 is at most 2,000 tiny inserts. Well under the
 * limit, and small enough that a page which fails can simply be re-run.
 */
const BACKFILL_PAGE = 200

/** What one page of the backfill reports back. */
type BackfillPage = {
  cursor: string | null
  isDone: boolean
  scanned: number
}

/**
 * Fills `entryTags` from the `tagIds` already on every entry.
 *
 * Returns its cursor rather than looping internally, so one call is one bounded
 * transaction and a deployment with years of history does not fail atomically
 * and repair nothing. `runEntryTagsBackfill` below is the loop.
 *
 * Idempotent, because `syncEntryTags` reconciles rather than inserts. Re-running
 * over pages already done is a no-op, which is what makes it safe to restart
 * after a timeout without tracking how far it got.
 *
 * Paginates the table unindexed and on purpose: this has to reach EVERY entry
 * of every user, and an index would only narrow it.
 */
export const backfillEntryTags = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
  },
  returns: v.object({
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
    scanned: v.number(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("timeEntries").paginate({
      cursor: args.cursor ?? null,
      numItems: args.numItems ?? BACKFILL_PAGE,
    })

    for (const entry of page.page) {
      // A soft-deleted entry does not hold its tags, so it gets an empty set
      // rather than being skipped — skipping would leave stale rows behind on a
      // re-run over an entry deleted since the last pass.
      await syncEntryTags(
        ctx,
        entry.userId,
        entry._id,
        entry.deletedAt === null ? entry.tagIds : []
      )
    }

    // Only at the very end. The flag is what unblocks tag deletion, and it must
    // not be set while any page is still uncovered.
    if (page.isDone) await markEntryTagsBackfilled(ctx)

    return {
      cursor: page.continueCursor,
      isDone: page.isDone,
      scanned: page.page.length,
    }
  },
})

/**
 * The operator's entry point — loops `backfillEntryTags` to the end.
 *
 *   npx convex run migrations:runEntryTagsBackfill
 *
 * An action rather than a mutation because the loop must span transactions;
 * each page is its own atomic write.
 */
export const runEntryTagsBackfill = internalAction({
  args: {
    numItems: v.optional(v.number()),
    /** Resume point. An action has a wall-clock ceiling, and without this a run
     *  that hit it on a large deployment could only start again from row zero.
     *  Take it from the last `backfillEntryTags` result in the logs. */
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({ pages: v.number(), scanned: v.number() }),
  handler: async (ctx, args) => {
    let cursor: string | null = args.cursor ?? null
    let pages = 0
    let scanned = 0

    for (;;) {
      // Annotated, not inferred. This action calls a mutation in its OWN module,
      // so `internal.migrations` depends on this handler's return type, which
      // depends on this call — TS7022, a circularity tsc reports as `any`.
      const result: BackfillPage = await ctx.runMutation(
        internal.migrations.backfillEntryTags,
        { cursor, numItems: args.numItems }
      )
      pages += 1
      scanned += result.scanned
      if (result.isDone) return { pages, scanned }
      cursor = result.cursor
    }
  },
})
