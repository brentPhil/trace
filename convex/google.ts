import { v } from "convex/values"
import { internalAction, internalMutation, internalQuery } from "./_generated/server"
import { internal } from "./_generated/api"
import { createAuth } from "./auth"
import { APIError } from "better-auth/api"
import {
  GoogleAuthError,
  GoogleTransientError,
  fetchCalendarList,
  fetchEventsPage,
} from "./googleApi"
import {
  googleCalendarDoc,
  googleConnectionDoc,
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

/** How many accounts one cron run picks up. A page, not the world: the cron
 *  fires every 15 minutes and each account's work is scheduled separately, so a
 *  slow or failing account cannot starve the others. */
const SYNC_PAGE_SIZE = 100

export const allConnectionsForTest = internalQuery({
  args: { userId: v.string() },
  returns: v.array(googleConnectionDoc),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(10),
})

/**
 * Which accounts are due a sync.
 *
 * `status: "ok"` only. An account flagged `reauth` is skipped entirely until a
 * human consents again — see the schema comment on that field. Read through
 * `by_status`, which is the one index in this feature not led by `userId`,
 * because this caller has no user to scope to.
 */
export const connectionsToSync = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    userIds: v.array(v.string()),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("googleConnections")
      .withIndex("by_status", (q) => q.eq("status", "ok"))
      .paginate({ numItems: SYNC_PAGE_SIZE, cursor: args.cursor })
    return {
      userIds: page.page.map((row) => row.userId),
      cursor: page.isDone ? null : page.continueCursor,
    }
  },
})

export const markConnection = internalMutation({
  args: {
    userId: v.string(),
    status: v.union(v.literal("ok"), v.literal("reauth")),
    nowMs: v.number(),
    error: v.optional(v.string()),
    calendarsRefreshed: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique()
    if (row === null) return null

    await ctx.db.patch(row._id, {
      status: args.status,
      lastSyncedAt: args.status === "ok" ? args.nowMs : row.lastSyncedAt,
      lastErrorAt: args.error === undefined ? row.lastErrorAt : args.nowMs,
      ...(args.error === undefined ? {} : { lastError: args.error }),
      ...(args.calendarsRefreshed === true
        ? { calendarsRefreshedAt: args.nowMs }
        : {}),
      updatedAt: args.nowMs,
    })
    return null
  },
})

/** How stale the calendar LIST may get. Events are polled every 15 minutes;
 *  the set of calendars changes about never, and refetching it every run is
 *  a quota call spent on an answer that has not moved. */
const CALENDAR_LIST_TTL_MS = 24 * 60 * 60 * 1_000

/** A hard stop on pages per calendar per run. A full window fetch of a busy
 *  calendar is a handful of pages; a hundred means something is wrong with the
 *  loop, and an unbounded `while` in an action is how a quota gets burned in
 *  one afternoon. */
const MAX_PAGES = 20

/**
 * Whether a `getAccessToken` failure means the grant is dead, versus
 * transient — a network blip reaching Google's token endpoint, or an
 * unrelated bug in `createAuth(ctx)`.
 *
 * Better Auth's `getValidAccessToken` (node_modules/better-auth/dist/api/
 * routes/account.mjs) wraps EVERY failure from `provider.refreshAccessToken`
 * — a revoked refresh token and a flaky network alike — in the same shape: an
 * `APIError` with `status: "BAD_REQUEST"` / `statusCode: 400`, `body.code:
 * "FAILED_TO_GET_ACCESS_TOKEN"`, and no `cause` (the original error is
 * discarded, not attached). So an `APIError` with statusCode 400 or 401 IS
 * the token-exchange-failure signal — that is as fine-grained as this call
 * lets us see period, not a simplification we chose.
 *
 * Getting this wrong in one direction costs a user a pointless trip through
 * Google's consent screen for something that would have healed itself in 15
 * minutes; getting it wrong in the other means an account whose grant is
 * truly gone sits `status: "ok"` and silently stops syncing forever, because
 * nothing ever asks `markConnection` to flag it.
 */
export function isDeadGrant(error: unknown): boolean {
  if (error instanceof APIError) {
    return error.statusCode === 400 || error.statusCode === 401
  }
  return false
}

export const syncAccount = internalAction({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const nowMs = Date.now()

    // The access token comes from Better Auth, which refreshes it from the
    // stored refresh token. One token store — so revoking access in a Google
    // account page actually stops this, rather than stopping it whenever a copy
    // we cached happened to expire.
    let accessToken: string
    try {
      const auth = createAuth(ctx)
      const result = await auth.api.getAccessToken({
        body: { providerId: "google", userId: args.userId },
      })
      accessToken = result.accessToken
    } catch (error) {
      if (isDeadGrant(error)) {
        await ctx.runMutation(internal.google.markConnection, {
          userId: args.userId,
          status: "reauth",
          nowMs,
          error: `Could not get an access token: ${String(error)}`,
        })
        return null
      }
      // Not a dead grant, so this must not stop syncing: leave `status: "ok"`
      // and let the next cron tick retry. `error` is still recorded through
      // `markConnection` so a persistent problem is visible in Settings
      // instead of failing silently.
      await ctx.runMutation(internal.google.markConnection, {
        userId: args.userId,
        status: "ok",
        nowMs,
        error: `Could not get an access token: ${String(error)}`,
      })
      return null
    }

    try {
      const connection = await ctx.runQuery(
        internal.google.connectionForSync,
        { userId: args.userId }
      )
      if (connection === null) return null

      const stale =
        connection.calendarsRefreshedAt === null ||
        nowMs - connection.calendarsRefreshedAt > CALENDAR_LIST_TTL_MS
      if (stale) {
        const calendars = await fetchCalendarList(fetch, accessToken)
        await ctx.runMutation(internal.google.upsertCalendars, {
          userId: args.userId,
          calendars,
          nowMs,
        })
      }

      const window = mirrorWindow(nowMs)
      const shown = await ctx.runQuery(internal.google.shownCalendars, {
        userId: args.userId,
      })

      for (const calendar of shown) {
        let pageToken: string | null = null
        let syncToken = calendar.syncToken
        let pages = 0

        // `while (pages < MAX_PAGES)` with explicit `break`s, not a
        // `do/while`: this loop's real bound is the page count and its real
        // exits are "no more pages" and "gone twice in a row", and a
        // `do/while`'s `continue` jumps straight to the condition check —
        // which, right after a `gone` branch sets `pageToken = null`, would
        // exit the loop instead of re-entering it. That silently skipped the
        // rest of this calendar's sync for the whole run, with the restart
        // only happening on the NEXT cron tick 15 minutes later.
        while (pages < MAX_PAGES) {
          const page = await fetchEventsPage(fetch, accessToken, {
            calendarId: calendar.googleId,
            syncToken,
            timeMinMs: window.fromMs,
            timeMaxMs: window.toMs,
            pageToken,
          })
          pages += 1

          if (page.gone) {
            // Routine: the stored syncToken aged out. Clear it and loop again
            // with syncToken and pageToken both null, which makes the next
            // fetch a full WINDOW fetch rather than an incremental one. A
            // window fetch carries no syncToken, so it cannot itself come
            // back `gone` — that is what makes this restart terminate rather
            // than alternate forever, with MAX_PAGES as the backstop if
            // Google still misbehaves.
            await ctx.runMutation(internal.google.clearSyncToken, {
              userId: args.userId,
              calendarId: calendar.googleId,
              nowMs,
            })
            syncToken = null
            pageToken = null
            continue
          }

          await ctx.runMutation(internal.google.applySyncPage, {
            userId: args.userId,
            calendarId: calendar.googleId,
            items: page.items,
            // Stored ONLY on the last page. Google issues it when the pages are
            // exhausted, and storing it earlier would declare covered a page
            // that was never fetched.
            nextSyncToken: page.nextPageToken === null ? page.nextSyncToken : null,
            nowMs,
          })

          pageToken = page.nextPageToken
          if (pageToken === null) break
        }
      }

      await ctx.runMutation(internal.google.pruneEvents, {
        userId: args.userId,
        fromMs: window.fromMs,
        toMs: window.toMs,
      })

      await ctx.runMutation(internal.google.markConnection, {
        userId: args.userId,
        status: "ok",
        nowMs,
        calendarsRefreshed: stale,
      })
    } catch (error) {
      if (error instanceof GoogleAuthError) {
        await ctx.runMutation(internal.google.markConnection, {
          userId: args.userId,
          status: "reauth",
          nowMs,
          error: error.message,
        })
        return null
      }
      if (error instanceof GoogleTransientError) {
        // Stale-but-present is the whole reason there is a mirror. Record it and
        // let the next run try; no backoff state to get wrong.
        await ctx.runMutation(internal.google.markConnection, {
          userId: args.userId,
          status: "ok",
          nowMs,
          error: error.message,
        })
        return null
      }
      throw error
    }

    return null
  },
})

export const syncAll = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    let cursor: string | null = null
    do {
      const due: { userIds: Array<string>; cursor: string | null } =
        await ctx.runQuery(internal.google.connectionsToSync, { cursor })
      for (const userId of due.userIds) {
        // One scheduled action per account, so a slow or failing account cannot
        // starve the rest — and so a thrown error is scoped to one user.
        await ctx.scheduler.runAfter(0, internal.google.syncAccount, { userId })
      }
      cursor = due.cursor
    } while (cursor !== null)
    return null
  },
})

export const connectionForSync = internalQuery({
  args: { userId: v.string() },
  returns: v.union(googleConnectionDoc, v.null()),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique(),
})

export const shownCalendars = internalQuery({
  args: { userId: v.string() },
  returns: v.array(googleCalendarDoc),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleCalendars")
      .withIndex("by_user_show", (q) =>
        q.eq("userId", args.userId).eq("show", true)
      )
      // Assumes no user shows more than 50 calendars. A user past that bound
      // has their 51st-and-later shown calendars silently skipped by every
      // sync — no error, no log, just events that never arrive for a
      // calendar the user believes is on — with no signal here that the read
      // was truncated.
      .take(50),
})

export const clearSyncToken = internalMutation({
  args: { userId: v.string(), calendarId: v.string(), nowMs: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const calendar = await calendarRow(ctx, args.userId, args.calendarId)
    if (calendar !== null) {
      await ctx.db.patch(calendar._id, {
        syncToken: null,
        updatedAt: args.nowMs,
      })
    }
    return null
  },
})
