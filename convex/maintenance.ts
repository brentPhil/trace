import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { components } from "./_generated/api"

/**
 * Deletes the stored JWKS so Better Auth regenerates it on the next request.
 *
 * Run this after BETTER_AUTH_SECRET changes. The JWKS private key is encrypted
 * with that secret, so a new secret leaves the existing key undecryptable and
 * every call to /api/auth/convex/token fails with:
 *
 *   BetterAuthError: Failed to decrypt private key.
 *
 * Sign-in still succeeds when this happens — the session cookie is unaffected —
 * but the client never receives a Convex token, so an app using
 * `expectAuth: true` waits indefinitely rather than erroring.
 *
 * Safe to run: the keypair is derived state, not user data. Sessions, accounts
 * and users are untouched. Outstanding Convex tokens stop verifying, so clients
 * fetch a fresh one.
 *
 *   npx convex run maintenance:clearJwks
 */
export const clearJwks = internalMutation({
  args: {},
  handler: async (ctx) => {
    // deleteMany is paginated. A JWKS holds a handful of keys at most, so one
    // page is enough; this is not a general-purpose bulk delete.
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: { model: "jwks" },
      paginationOpts: { cursor: null, numItems: 100 },
    })
    return { cleared: true }
  },
})

/**
 * Deletes every domain row belonging to a user, permanently.
 *
 * Internal only, and deliberately not reachable from any client. Two real uses:
 * clearing test data out of a dev deployment, and the account-deletion cascade
 * when that ships.
 *
 * Bounded per call rather than unbounded: a Convex mutation has a write ceiling,
 * so a user with years of history would fail atomically and repair nothing.
 * Returns what remains so the caller can loop.
 */
export const purgeUser = internalMutation({
  args: { userId: v.string(), limit: v.optional(v.number()) },
  returns: v.object({ deleted: v.number(), remaining: v.number() }),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 500
    let deleted = 0

    // entryTags first, and by INDEX rather than by filter.
    //
    // First, because it is derived from the other three: draining it ahead of
    // them means a purge that runs out of budget partway leaves the index
    // describing rows that still exist rather than rows that are gone.
    //
    // By index, because it is the only one of the four that has a userId index
    // and also the one that can dwarf the others — up to ten rows per entry. A
    // `.filter()` here would scan the whole table looking for one user's rows,
    // on every call of a loop the caller runs until it reports nothing left.
    const joins = await ctx.db
      .query("entryTags")
      .withIndex("by_user_tag", (q) => q.eq("userId", args.userId))
      .take(limit)
    for (const row of joins) {
      await ctx.db.delete(row._id)
      deleted++
    }

    for (const table of ["timeEntries", "projects", "tags"] as const) {
      const rows = await ctx.db
        .query(table)
        .filter((q) => q.eq(q.field("userId"), args.userId))
        .take(limit - deleted)
      for (const row of rows) {
        await ctx.db.delete(row._id)
        deleted++
      }
      if (deleted >= limit) break
    }

    const remaining = (
      await ctx.db
        .query("timeEntries")
        .filter((q) => q.eq(q.field("userId"), args.userId))
        .take(1)
    ).length

    return { deleted, remaining }
  },
})
