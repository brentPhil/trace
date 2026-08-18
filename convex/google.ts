import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"
import {
  googleCalendarDoc,
  googleEventDoc,
  googleEventTrackingDoc,
} from "./lib/docs"
import { mapGoogleEvent } from "./googleEvents"
import type { MutationCtx } from "./_generated/server"

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

/**
 * How much of the calendar is mirrored, and therefore how much detail about
 * other people is at rest in this deployment.
 *
 * A WINDOW rather than everything, and the bound is the point: the popover
 * exists to show attendees and agendas, which means other people's names and
 * addresses are stored. 60 days back covers "what was that meeting I worked
 * through last month" for a tracker people invoice from; 90 forward covers a
 * quarter of planning. Anything outside is pruned on every sync.
 */
export const MIRROR_BACK_DAYS = 60
export const MIRROR_FORWARD_DAYS = 90
const DAY_MS = 86_400_000

/** The mirrored window around an instant. Half-open, like every other range in
 *  this product. */
export function mirrorWindow(nowMs: number): { fromMs: number; toMs: number } {
  return {
    fromMs: nowMs - MIRROR_BACK_DAYS * DAY_MS,
    toMs: nowMs + MIRROR_FORWARD_DAYS * DAY_MS,
  }
}

export const allCalendarsForTest = internalQuery({
  args: { userId: v.string() },
  returns: v.array(googleCalendarDoc),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleCalendars")
      .withIndex("by_user_googleId", (q) => q.eq("userId", args.userId))
      .take(100),
})

async function calendarRow(ctx: MutationCtx, userId: string, googleId: string) {
  return await ctx.db
    .query("googleCalendars")
    .withIndex("by_user_googleId", (q) =>
      q.eq("userId", userId).eq("googleId", googleId)
    )
    .unique()
}

/**
 * A page of `events.list`, applied.
 *
 * THE ROWS AND THE `syncToken` COMMIT TOGETHER, and that is the one ordering in
 * this feature that can lose data with no error anywhere. Advance the token in
 * its own mutation and crash before writing the rows, and Google will never
 * mention those changes again — a meeting permanently missing from the mirror,
 * with a healthy-looking cron and nothing in the logs. One transaction, always.
 *
 * `items` is `v.array(v.any())` because it is raw Google JSON crossing a
 * function boundary; `mapGoogleEvent` is what narrows it, and it treats every
 * field as `unknown`.
 */
export const applySyncPage = internalMutation({
  args: {
    userId: v.string(),
    calendarId: v.string(),
    items: v.array(v.any()),
    /** Present only on the LAST page of a run. Google issues it once the pages
     *  are exhausted, and storing it earlier would declare covered a page that
     *  was never fetched. */
    nextSyncToken: v.union(v.string(), v.null()),
    nowMs: v.number(),
  },
  returns: v.object({ upserted: v.number(), deleted: v.number() }),
  handler: async (ctx, args) => {
    let upserted = 0
    let deleted = 0

    for (const raw of args.items) {
      const item = mapGoogleEvent(raw, args.calendarId)
      if (item === null) continue

      const existing = await ctx.db
        .query("googleEvents")
        .withIndex("by_user_calendar_event", (q) =>
          q
            .eq("userId", args.userId)
            .eq("calendarId", args.calendarId)
            .eq("eventId", item.kind === "delete" ? item.eventId : item.row.eventId)
        )
        .unique()

      if (item.kind === "delete") {
        // The MIRROR row goes; the tracking row beside it stays. A cancelled
        // meeting must vanish from the grid, and a tick the user set must
        // survive the event leaving and coming back.
        if (existing !== null) {
          await ctx.db.delete(existing._id)
          deleted += 1
        }
        continue
      }

      const row = {
        userId: args.userId,
        ...item.row,
        updatedAt: args.nowMs,
      }
      if (existing === null) {
        await ctx.db.insert("googleEvents", row)
      } else {
        // `replace`, not `patch`: this table holds ONLY Google's facts, so a
        // field Google has stopped sending must disappear rather than linger as
        // a stale value from three syncs ago.
        await ctx.db.replace(existing._id, row)
      }
      upserted += 1
    }

    const calendar = await calendarRow(ctx, args.userId, args.calendarId)
    if (calendar !== null) {
      await ctx.db.patch(calendar._id, {
        ...(args.nextSyncToken === null ? {} : { syncToken: args.nextSyncToken }),
        lastSyncedAt: args.nowMs,
        updatedAt: args.nowMs,
      })
    }

    return { upserted, deleted }
  },
})

/**
 * The calendar list, reconciled.
 *
 * A NEW CALENDAR ARRIVES HIDDEN (`show: false`). A calendar appearing on the
 * grid because Google added one — a shared team calendar, a subscribed holiday
 * feed — is a surprise, and on this page a surprise costs the user attention
 * they are spending on work. Existing rows keep their `show` and their
 * `defaultProjectId`; only the name is refreshed.
 *
 * A calendar Google no longer reports is DELETED, along with its mirrored
 * events. Its tracking rows are left alone, on the same argument as a
 * cancellation tombstone.
 */
export const upsertCalendars = internalMutation({
  args: {
    userId: v.string(),
    calendars: v.array(
      v.object({ googleId: v.string(), summary: v.string() })
    ),
    nowMs: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const seen = new Set<string>()

    for (const calendar of args.calendars) {
      seen.add(calendar.googleId)
      const existing = await calendarRow(ctx, args.userId, calendar.googleId)
      if (existing === null) {
        await ctx.db.insert("googleCalendars", {
          userId: args.userId,
          googleId: calendar.googleId,
          summary: calendar.summary,
          show: false,
          syncToken: null,
          lastSyncedAt: null,
          updatedAt: args.nowMs,
        })
      } else if (existing.summary !== calendar.summary) {
        await ctx.db.patch(existing._id, {
          summary: calendar.summary,
          updatedAt: args.nowMs,
        })
      }
    }

    const rows = await ctx.db
      .query("googleCalendars")
      .withIndex("by_user_googleId", (q) => q.eq("userId", args.userId))
      .take(250)
    for (const row of rows) {
      if (seen.has(row.googleId)) continue
      // Through `by_user_calendar_started`, so this reads only the orphaned
      // calendar's own rows. Filtering a page of every event by `calendarId`
      // would read the whole mirror once per orphan.
      //
      // Bounded at 500, and unlike `pruneEvents`'s bound this one is NOT
      // self-draining: nothing re-invokes this cleanup on a timer for a
      // calendar that is already gone. A calendar mirrored with more than 500
      // events in the window is deleted here while its excess event rows
      // survive, pointing at a `calendarId` that no longer has a calendar row.
      // Those survivors self-heal only if the same calendar reappears in a
      // later `calendars` list and is fully re-synced.
      const orphans = await ctx.db
        .query("googleEvents")
        .withIndex("by_user_calendar_started", (q) =>
          q.eq("userId", args.userId).eq("calendarId", row.googleId)
        )
        .take(500)
      for (const orphan of orphans) await ctx.db.delete(orphan._id)
      await ctx.db.delete(row._id)
    }

    return null
  },
})

/**
 * Mirror rows outside the window, deleted.
 *
 * Bounded at 500 rows a run, and deliberately not self-rescheduling: the cron
 * runs every 15 minutes and the window moves by 15 minutes, so a backlog can
 * only exist right after the window narrows. Draining it over a few runs is
 * cheaper than a mutation that can hit the transaction limit and roll back the
 * whole page.
 */
export const pruneEvents = internalMutation({
  args: { userId: v.string(), fromMs: v.number(), toMs: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    let removed = 0

    const before = await ctx.db
      .query("googleEvents")
      .withIndex("by_user_started", (q) =>
        q.eq("userId", args.userId).lt("startedAt", args.fromMs)
      )
      .take(250)
    const after = await ctx.db
      .query("googleEvents")
      .withIndex("by_user_started", (q) =>
        q.eq("userId", args.userId).gte("startedAt", args.toMs)
      )
      .take(250)

    for (const row of [...before, ...after]) {
      await ctx.db.delete(row._id)
      removed += 1
    }
    return removed
  },
})
