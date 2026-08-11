import { v } from "convex/values"
import { internalAction, internalMutation } from "./_generated/server"
import { internal } from "./_generated/api"
import {
  entryTagsBackfilled,
  markEntryTagsBackfilled,
  readEntryTagsCursor,
  saveEntryTagsCursor,
  syncEntryTags,
} from "./entryTags"

/**
 * One-off data migrations.
 *
 * Hand-rolled rather than `@convex-dev/migrations`, because this project has
 * only ever needed a couple of them and adding a component for that would be a
 * larger change than the migrations are.
 */

// ---------------------------------------------------------------------------
// clearInvoiceStatus — DELETE THIS SECTION once it has been run in production.
// ---------------------------------------------------------------------------

/**
 * Clears `invoices.status` on every invoice of every user.
 *
 *   npx convex run migrations:clearInvoiceStatus
 *
 * SAFE TO DELETE, along with this whole section, once that has been run against
 * production — it exists to unblock one commit and nothing calls it.
 *
 * WHY IT HAS TO EXIST AT ALL. There is no draft/issued/paid workflow any more,
 * so `status` is dead, and Convex validates every EXISTING document against the
 * schema on push: simply deleting the field from `invoiceFields` would fail the
 * DEPLOY on the rows that still carry it. So the field is `v.optional` for one
 * commit (see the TODO on it in convex/schema.ts), this clears the column, and
 * a follow-up commit removes the field and this code together.
 *
 * `undefined` REMOVES the column — the same device `invoices.update` uses to
 * clear an emptied `purchaseOrder`. It is not a second spelling of a status.
 *
 * Paginated, and the cursor is the CALLER'S here rather than checkpointed in
 * `migrationState` the way the backfill below insists on. The difference is
 * what depends on coverage: that one gates tag deletion, so a run that skipped
 * rows and still declared itself complete would destroy data. Nothing gates on
 * this one. Its check is the follow-up schema push, which refuses to deploy
 * while a single row still holds the field — a missed page fails loudly and
 * safely, and re-running is a no-op on rows already cleared.
 *
 * Unindexed on purpose: this must reach every row of every user, and an index
 * could only narrow it.
 */
export const clearInvoiceStatus = internalMutation({
  args: {
    /** Omitted on the first call. Pass back the `continueCursor` of a page that
     *  reported `isDone: false` — which one invoice in the table means never. */
    cursor: v.optional(v.union(v.string(), v.null())),
    /** A page is a read and a one-field patch each, so 500 is nowhere near a
     *  transaction's ceiling. Its own number rather than `BACKFILL_PAGE` below:
     *  that one is sized for up to ten inserts per row, and two migrations
     *  sharing a constant is two reasons pinned to one number. */
    numItems: v.optional(v.number()),
  },
  returns: v.object({
    isDone: v.boolean(),
    continueCursor: v.string(),
    cleared: v.number(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("invoices").paginate({
      cursor: args.cursor ?? null,
      numItems: args.numItems ?? 500,
    })

    let cleared = 0
    for (const invoice of page.page) {
      if (invoice.status === undefined) continue
      await ctx.db.patch(invoice._id, { status: undefined })
      cleared += 1
    }

    return { isDone: page.isDone, continueCursor: page.continueCursor, cleared }
  },
})

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
  isDone: boolean
  scanned: number
}

/**
 * Fills `entryTags` from the `tagIds` already on every entry.
 *
 * One call is one page and one bounded transaction, so a deployment with years
 * of history does not fail atomically and repair nothing. `runEntryTagsBackfill`
 * below is the loop.
 *
 * Where to resume is read from and written to `migrationState`, in the same
 * transaction as the page itself — NOT taken as an argument. A caller-supplied
 * cursor decides coverage: start from the middle and every earlier entry goes
 * unreconciled, while the run still reaches the end and marks itself complete.
 * The gate would then vouch for an index covering part of history, which is the
 * exact failure it exists to prevent.
 *
 * Idempotent twice over: `syncEntryTags` reconciles rather than inserts, so a
 * page redone after a failed transaction is a no-op, and a completed migration
 * short-circuits instead of walking the table again.
 *
 * Paginates the table unindexed and on purpose: this has to reach EVERY entry
 * of every user, and an index would only narrow it.
 */
export const backfillEntryTags = internalMutation({
  args: { numItems: v.optional(v.number()) },
  returns: v.object({
    isDone: v.boolean(),
    scanned: v.number(),
  }),
  handler: async (ctx, args) => {
    // Already finished: do not walk the table again, and do not reopen a
    // checkpoint that has been closed.
    if (await entryTagsBackfilled(ctx)) return { isDone: true, scanned: 0 }

    const page = await ctx.db.query("timeEntries").paginate({
      cursor: await readEntryTagsCursor(ctx),
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
    else await saveEntryTagsCursor(ctx, page.continueCursor)

    // The cursor is deliberately NOT returned. It is not the caller's to hold,
    // and handing it back is how it ends up being handed in again.
    return { isDone: page.isDone, scanned: page.page.length }
  },
})

/**
 * The operator's entry point — loops `backfillEntryTags` to the end.
 *
 *   npx convex run migrations:runEntryTagsBackfill
 *
 * An action rather than a mutation because the loop must span transactions;
 * each page is its own atomic write.
 *
 * Safe to run again if it dies partway — an action has a wall-clock ceiling,
 * and hitting it leaves the checkpoint in the database, so a second run picks
 * up where the first stopped. That is why there is no resume argument: the
 * migration already knows, and asking the operator would mean trusting them to
 * be right about how much has been covered.
 */
export const runEntryTagsBackfill = internalAction({
  args: { numItems: v.optional(v.number()) },
  returns: v.object({ pages: v.number(), scanned: v.number() }),
  handler: async (ctx, args) => {
    let pages = 0
    let scanned = 0

    for (;;) {
      // Annotated, not inferred. This action calls a mutation in its OWN module,
      // so `internal.migrations` depends on this handler's return type, which
      // depends on this call — TS7022, a circularity tsc reports as `any`.
      const result: BackfillPage = await ctx.runMutation(
        internal.migrations.backfillEntryTags,
        { numItems: args.numItems }
      )
      pages += 1
      scanned += result.scanned
      if (result.isDone) return { pages, scanned }
    }
  },
})
