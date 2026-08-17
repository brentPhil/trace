import { v } from "convex/values"
import { internalQuery } from "./_generated/server"
import { googleEventDoc, googleEventTrackingDoc } from "./lib/docs"

/*
 * Google Calendar: the read side.
 *
 * Nothing in this file writes a `timeEntries` row. That is Phase 2, and keeping
 * it out is what makes this phase unable to put a wrong number on an invoice.
 */

/** Test-only. Named `*ForTest` so the audit "what can reach my data" reads
 *  honestly: this is internal, so it is unreachable from a client. */
export const allEventsForTest = internalQuery({
  args: { userId: v.string() },
  returns: v.array(googleEventDoc),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleEvents")
      .withIndex("by_user_started", (q) => q.eq("userId", args.userId))
      .take(100),
})

export const allTrackingForTest = internalQuery({
  args: { userId: v.string() },
  returns: v.array(googleEventTrackingDoc),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleEventTracking")
      .withIndex("by_user_calendar_event", (q) => q.eq("userId", args.userId))
      .take(100),
})
