import { v } from "convex/values"
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { internal } from "./_generated/api"
import { createAuth, requireUserId } from "./auth"
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
import { mapGoogleEvent, isDrawable } from "./googleEvents"
import { googleConnectionFields } from "./schema"
import { getOwned } from "./owned"
import { traceError } from "./errors"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"

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
    /** Whether this page is the last of the run — `nextPageToken === null`.
     *  Separate from `nextSyncToken` because Google can end a run without
     *  issuing one, and "the pages are exhausted" and "here is a token" are
     *  then two different facts. */
    lastPage: v.boolean(),
    /** Whether this run carried NO `syncToken`, i.e. it re-read the whole
     *  mirror window rather than a delta. Only such a run may stamp
     *  `fullSyncedAt` — see `FULL_RESYNC_TTL_MS`. */
    windowFetch: v.boolean(),
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
        // Stamped only when a WINDOW fetch reached its last page. A truncated
        // window fetch must not claim one, or the TTL would declare the
        // calendar converged on the strength of a run that stopped early —
        // the same reasoning as `nextSyncToken` above.
        ...(args.windowFetch && args.lastPage
          ? { fullSyncedAt: args.nowMs }
          : {}),
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
    /** Omit when `tokenFailed` is true: that path decides `status` itself
     *  from the accumulated count, so the caller has nothing correct to pass. */
    status: v.optional(v.union(v.literal("ok"), v.literal("reauth"))),
    nowMs: v.number(),
    error: v.optional(v.string()),
    calendarsRefreshed: v.optional(v.boolean()),
    /** True ONLY on a run that actually finished syncing. What stamps
     *  `lastSyncedAt` — see the handler. */
    synced: v.optional(v.boolean()),
    /** True exactly on a `getAccessToken` token-exchange failure — see
     *  `TOKEN_FAILURE_LIMIT`. Every other call site omits this, which is what
     *  resets the counter: it measures CONSECUTIVE token-exchange failures,
     *  not lifetime ones. */
    tokenFailed: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("googleConnections")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique()
    if (row === null) return null

    const tokenFailures =
      args.tokenFailed === true ? (row.tokenFailures ?? 0) + 1 : 0
    // Below the limit, status stays "ok" so `connectionsToSync` still picks
    // this account up next run — the whole point of counting instead of
    // flagging on the first failure.
    const status =
      args.tokenFailed === true
        ? tokenFailures >= TOKEN_FAILURE_LIMIT
          ? "reauth"
          : "ok"
        : (args.status ?? row.status)

    /*
     * `lastSyncedAt` MEANS "DATA LAST ARRIVED", and this is the line that
     * makes it true.
     *
     * It used to be stamped on any `status === "ok"`, which the transient-error
     * handler and the below-limit token-failure path BOTH pass — they pass it
     * so the account keeps being picked up next run, not because anything
     * synced. A connection 429-ing or 5xx-ing every fifteen minutes therefore
     * showed a freshly-updated "Last synced" in Settings while the mirror
     * rotted, which is the exact opposite of what that field is surfaced for.
     * A failed run now leaves it alone, so the displayed time keeps telling
     * the truth about when meetings last came in.
     *
     * A synced run also CLEARS the recorded error. Settings shows a "syncing
     * is failing" line off `lastError`, and an error that outlives the failure
     * it describes is the same lie in the other direction.
     */
    const synced = args.synced === true
    await ctx.db.patch(row._id, {
      status,
      tokenFailures,
      ...(synced
        ? { lastSyncedAt: args.nowMs, lastError: undefined, lastErrorAt: null }
        : {
            lastErrorAt: args.error === undefined ? row.lastErrorAt : args.nowMs,
            ...(args.error === undefined ? {} : { lastError: args.error }),
          }),
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
 * How long a calendar may go without re-reading its whole mirror window.
 *
 * WHAT IT BUYS IS CONVERGENCE. `mirrorWindow(nowMs)` is recomputed every run
 * but only reaches Google on the `syncToken === null` branch; once a token
 * exists every request is a pure delta, and `clearSyncToken` fires only on a
 * 410. Two things are then permanently lost with nothing in the logs:
 *
 *  - an event whose `start`/`end` will not parse is skipped by
 *    `mapGoogleEvent`, and Google will never mention it again until somebody
 *    edits it. Absent from the grid forever, on a healthy-looking cron.
 *  - anything lost to `MAX_PAGES` truncation keeps the old token and
 *    re-truncates identically every 15 minutes — a loop that cannot converge.
 *
 * A delta stream has no way to say "and here is what you missed". Only a
 * window fetch re-states the truth, so one is forced periodically. STORED PER
 * CALENDAR (`googleCalendars.fullSyncedAt`) rather than run off a second
 * cron, for the reason `CALENDAR_LIST_TTL_MS` is: the interval is then a fact
 * in the data, readable from a row, rather than a schedule nobody can see.
 *
 * THE COST IS ONE FULL FETCH PER CALENDAR PER PERIOD — a handful of pages for
 * a busy diary, against 672 delta polls in the same week. Seven days rather
 * than one because the failures it repairs are rare and not urgent: a
 * mis-parsed event is a block missing from a plan, not a number missing from
 * an invoice, and nothing in this phase writes a `timeEntries` row.
 */
export const FULL_RESYNC_TTL_MS = 7 * 24 * 60 * 60 * 1_000

/**
 * Consecutive `getAccessToken` failures a connection tolerates before
 * `markConnection` flags it `reauth`.
 *
 * A single failure cannot tell a revoked grant from a network blip reaching
 * Google's token endpoint. Better Auth's `getValidAccessToken`
 * (node_modules/better-auth/dist/api/routes/account.mjs) wraps EVERY failure
 * from `provider.refreshAccessToken` — a revoked refresh token and a flaky
 * network alike — in the same shape: an `APIError` with `status:
 * "BAD_REQUEST"` / `statusCode: 400`, `body.code:
 * "FAILED_TO_GET_ACCESS_TOKEN"`, and no `cause` (the original error is
 * discarded, not attached). A revoked grant and a blip arrive identically, so
 * no amount of inspecting one error tells them apart.
 *
 * Persistence is the signal that does. The cron runs every 15 minutes, so 3
 * consecutive failures means the problem has lasted about 45 minutes, which
 * no ordinary network blip does — while a revoked grant fails every single
 * time and so reaches this limit within the same window. Below the limit
 * `markConnection` leaves `status: "ok"` so the next run retries; a run that
 * succeeds, or fails a different way, resets the count to 0 — see
 * `markConnection`'s `tokenFailed` handling — so this measures CONSECUTIVE
 * failures, not lifetime ones.
 *
 * Getting this wrong in one direction costs a user a pointless trip through
 * Google's consent screen for something that would have healed itself on its
 * own; getting it wrong in the other means an account whose grant is truly
 * gone keeps retrying for 45 minutes before it stops. Both are bounded costs,
 * unlike the single-failure guess this replaced.
 */
export const TOKEN_FAILURE_LIMIT = 3

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
      // `markConnection` decides `status` itself from the consecutive count —
      // see `TOKEN_FAILURE_LIMIT` — so this must not guess `reauth` from one
      // failure. `error` is still recorded so a persistent problem is visible
      // in Settings before it reaches the limit.
      await ctx.runMutation(internal.google.markConnection, {
        userId: args.userId,
        nowMs,
        error: `Could not get an access token: ${String(error)}`,
        tokenFailed: true,
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
        /*
         * THE PERIODIC FULL REFETCH — see `FULL_RESYNC_TTL_MS`.
         *
         * The token is cleared BEFORE the loop rather than simply passing
         * `null` into the first fetch, so the intent survives a crash: a run
         * that dies mid-window would otherwise leave the old token in place
         * and the calendar would go another full period without converging.
         * A row with no `fullSyncedAt` at all — every row written before the
         * field existed — reads as "never", which is the safe answer.
         */
        const fullDue =
          calendar.fullSyncedAt === undefined ||
          nowMs - calendar.fullSyncedAt >= FULL_RESYNC_TTL_MS
        if (fullDue && calendar.syncToken !== null) {
          await ctx.runMutation(internal.google.clearSyncToken, {
            userId: args.userId,
            calendarId: calendar.googleId,
            nowMs,
          })
        }

        let pageToken: string | null = null
        let syncToken = fullDue ? null : calendar.syncToken
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
          // Read BEFORE the fetch, because the `gone` branch below nulls
          // `syncToken` mid-loop: after a 410 restart every remaining page of
          // this run genuinely is part of a window fetch, and reading it
          // afterwards would say so about the delta page that failed too.
          const windowFetch = syncToken === null

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
            lastPage: page.nextPageToken === null,
            windowFetch,
            nowMs,
          })

          pageToken = page.nextPageToken
          if (pageToken === null) break
        }

        /*
         * TRUNCATED AT `MAX_PAGES`, with pages still owing.
         *
         * On a delta run this was unrecoverable: the old token survived, so
         * the next run asked the same question, got the same oversized answer
         * and stopped in the same place, every 15 minutes, forever. Clearing
         * the token makes the next run a window fetch, which re-states the
         * whole window from the start instead of resuming a stream that is
         * already ahead of us.
         *
         * Logged rather than thrown, on `listMeetings`' argument: a partial
         * mirror is better than a failed run, but this product does not
         * silently truncate.
         */
        if (pageToken !== null) {
          console.error("google sync truncated at MAX_PAGES.", {
            userId: args.userId,
            calendarId: calendar.googleId,
            pages,
          })
          await ctx.runMutation(internal.google.clearSyncToken, {
            userId: args.userId,
            calendarId: calendar.googleId,
            nowMs,
          })
        }
      }

      await ctx.runMutation(internal.google.pruneEvents, {
        userId: args.userId,
        fromMs: window.fromMs,
        toMs: window.toMs,
      })

      // The ONE call site that reached the end of a run, and so the one
      // allowed to stamp `lastSyncedAt`.
      await ctx.runMutation(internal.google.markConnection, {
        userId: args.userId,
        status: "ok",
        nowMs,
        calendarsRefreshed: stale,
        synced: true,
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

    /*
     * The backfill rides the sync's tail rather than having a cron of its own.
     *
     * It can only do anything when the mirror has just changed, which is
     * exactly here — and a separate schedule would race this one for the same
     * rows. Scheduled rather than awaited so that a backfill which throws
     * cannot fail a sync that has already committed its rows and its token.
     */
    await ctx.scheduler.runAfter(0, internal.googleBackfill.backfillUser, {
      userId: args.userId,
    })

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

/**
 * How many SHOWN calendars either reader will look at.
 *
 * Assumes no user shows more than this. A user past the bound has their
 * 51st-and-later shown calendars silently skipped — no error, no log, just
 * events that never arrive for a calendar they believe is on, and meetings
 * that never draw for it.
 *
 * Named once and exported because BOTH readers must agree: `shownCalendars`
 * decides what the cron fetches and `listMeetingsImpl` decides what the grid
 * reads, and if those two bounds ever drifted apart a calendar would be
 * mirrored and never drawn, or drawn from a mirror nothing refreshes. It was
 * an unnamed `50` in both places.
 */
export const SHOWN_CALENDARS_LIMIT = 50

export const shownCalendars = internalQuery({
  args: { userId: v.string() },
  returns: v.array(googleCalendarDoc),
  handler: async (ctx, args) =>
    await ctx.db
      .query("googleCalendars")
      .withIndex("by_user_show", (q) =>
        q.eq("userId", args.userId).eq("show", true)
      )
      .take(SHOWN_CALENDARS_LIMIT),
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

/*
 * The calendar settings surface and the meetings query.
 *
 * Everything below reads or writes the mirror on the grid's behalf, rather
 * than syncing it. `listMeetings` is what the calendar view reads; the
 * `setCalendar*` mutations are what Settings writes.
 */

/** A mirrored event plus what this app knows about it. The grid needs both in
 *  one read: `entryId` is what suppresses a ghost whose hour is already drawn as
 *  a real entry. */
const meetingDoc = v.object({
  ...googleEventDoc.fields,
  trackOnStart: v.boolean(),
  entryId: v.union(v.id("timeEntries"), v.null()),
})

/** The most meetings one CALENDAR's range read returns. A week of one busy
 *  calendar is tens of events; this is a backstop against a runaway read, not
 *  a count real usage should ever reach — and because it is per calendar
 *  rather than per account, hitting it can only cost that one calendar its
 *  overflow, never a sibling calendar's meetings. */
export const MEETINGS_PER_CALENDAR_LIMIT = 250

async function listMeetingsImpl(
  ctx: QueryCtx,
  userId: string,
  fromMs: number,
  toMs: number
) {
  // `show` is read per calendar rather than joined per event: a diary has a
  // handful of calendars and hundreds of events, so this is the cheap direction.
  const calendars = await ctx.db
    .query("googleCalendars")
    .withIndex("by_user_show", (q) => q.eq("userId", userId).eq("show", true))
    .take(SHOWN_CALENDARS_LIMIT)
  if (calendars.length === 0) return []

  // Read PER SHOWN CALENDAR through `by_user_calendar_started`, rather than one
  // whole-account read through `by_user_started` filtered down afterward. The
  // whole-account read let a row on a HIDDEN calendar, or an all-day row (a
  // subscribed holidays/birthdays calendar, commonly all-day and commonly
  // present in a real Google account), consume the shared cap before a real
  // timed meeting on a shown calendar was even read — a plausible-looking but
  // silently incomplete week, with no error and no truncation indicator.
  // Scoping the read to each shown calendar means a hidden calendar costs
  // nothing and cannot consume any budget, and an all-day flood on one shown
  // calendar can only crowd out THAT calendar's own timed meetings.
  const rows = []
  for (const calendar of calendars) {
    const page = await ctx.db
      .query("googleEvents")
      .withIndex("by_user_calendar_started", (q) =>
        // Half-open, matching `dayWindow` and every other range in the product.
        q
          .eq("userId", userId)
          .eq("calendarId", calendar.googleId)
          .gte("startedAt", fromMs)
          .lt("startedAt", toMs)
      )
      .take(MEETINGS_PER_CALENDAR_LIMIT)
    if (page.length === MEETINGS_PER_CALENDAR_LIMIT) {
      // A full page means this calendar's read is silently incomplete. This
      // product does not silently truncate data people bill from — the same
      // device `CalendarPanel` uses when the drawn range disagrees with the
      // requested one. `console.error`, not a throw: a partial grid is better
      // than a blank page.
      console.error("listMeetings truncated a calendar's range read.", {
        userId,
        calendarId: calendar.googleId,
        fromMs,
        toMs,
      })
    }
    rows.push(...page)
  }

  // `rows` is grouped by calendar, and within each group ordered by
  // `startedAt` — NOT one `startedAt`-ordered sequence across the whole range.
  // That is enough for this caller: the grid positions every block by its OWN
  // `startedAt`/`endedAt`, never by its position in this array, so nothing
  // downstream depends on cross-calendar order. A caller that read only the
  // first N of this array would not be so lucky.
  const meetings = []
  for (const row of rows) {
    // All-day events have no clock and the grid has no rail for them.
    if (!isDrawable(row)) continue

    const tracking = await ctx.db
      .query("googleEventTracking")
      .withIndex("by_user_calendar_event", (q) =>
        q
          .eq("userId", userId)
          .eq("calendarId", row.calendarId)
          .eq("eventId", row.eventId)
      )
      .unique()

    meetings.push({
      ...row,
      trackOnStart: tracking?.trackOnStart ?? false,
      entryId: tracking?.entryId ?? null,
    })
  }
  return meetings
}

export const listMeetings = query({
  args: { fromMs: v.number(), toMs: v.number() },
  returns: v.array(meetingDoc),
  handler: async (ctx, args) =>
    await listMeetingsImpl(
      ctx,
      await requireUserId(ctx),
      args.fromMs,
      args.toMs
    ),
})

export const listMeetingsForUser = internalQuery({
  args: { userId: v.string(), fromMs: v.number(), toMs: v.number() },
  returns: v.array(meetingDoc),
  handler: async (ctx, args) =>
    await listMeetingsImpl(ctx, args.userId, args.fromMs, args.toMs),
})

async function listCalendarsImpl(ctx: QueryCtx, userId: string) {
  return await ctx.db
    .query("googleCalendars")
    .withIndex("by_user_googleId", (q) => q.eq("userId", userId))
    .take(250)
}

export const listCalendars = query({
  args: {},
  returns: v.array(googleCalendarDoc),
  handler: async (ctx) =>
    await listCalendarsImpl(ctx, await requireUserId(ctx)),
})

/** One page of a hidden calendar's mirror, deleted. Bounded for the same
 *  reason `DISCONNECT_PAGE` is: the mirror window (`MIRROR_BACK_DAYS` /
 *  `MIRROR_FORWARD_DAYS`) can hold more rows than one transaction should
 *  delete for a calendar with heavy recurring expansion, so a full page
 *  reschedules a continuation — `dropCalendarEvents` — rather than risking
 *  the transaction write limit. */
export const HIDE_DRAIN_PAGE = 500

/** Deletes one bounded page of `calendarId`'s mirrored events and, if the page
 *  came back full, schedules `dropCalendarEvents` to continue in a fresh
 *  transaction. Shared by the hide path's first page and by the continuation
 *  itself, since both are the identical bounded-page-then-reschedule step. */
async function dropCalendarEventsPage(
  ctx: MutationCtx,
  userId: string,
  calendarId: string
) {
  // Only this calendar's rows, through the index rather than by filtering a page
  // of the user's whole mirror.
  const rows = await ctx.db
    .query("googleEvents")
    .withIndex("by_user_calendar_started", (q) =>
      q.eq("userId", userId).eq("calendarId", calendarId)
    )
    .take(HIDE_DRAIN_PAGE)
  for (const row of rows) await ctx.db.delete(row._id)
  if (rows.length === HIDE_DRAIN_PAGE) {
    await ctx.scheduler.runAfter(0, internal.google.dropCalendarEvents, {
      userId,
      calendarId,
    })
  }
}

/**
 * Continuation of hiding a calendar, for when a drain page comes back full.
 * See `setCalendarShowImpl`'s "HIDING DELETES THE MIRRORED EVENTS" doc.
 *
 * RACE: if the calendar is shown again while this is still draining,
 * `setCalendarShowImpl`'s show path has already cleared `syncToken` and
 * scheduled a fresh `syncAccount`, which refetches the whole window from
 * Google. This continuation may then delete rows that sync just wrote back
 * in — wasted work racing a fresh sync, not silent data loss, because the
 * sync that was just scheduled (or the next cron tick) refetches and
 * restores whatever this deletes. The loop itself cannot run forever: it
 * stops the moment a page comes back under `HIDE_DRAIN_PAGE`, i.e. once
 * nothing with this `calendarId` is left to delete, whether or not a
 * re-show raced it.
 */
export const dropCalendarEvents = internalMutation({
  args: { userId: v.string(), calendarId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await dropCalendarEventsPage(ctx, args.userId, args.calendarId)
    return null
  },
})

/**
 * Show or hide a calendar.
 *
 * SHOWING CLEARS THE `syncToken`. A hidden calendar was not being fetched, so
 * its token describes "changes since" a point with an unfetched gap after it —
 * reusing it would silently skip everything that happened while the calendar was
 * hidden, and the mirror would look healthy while missing a fortnight.
 *
 * HIDING DELETES THE MIRRORED EVENTS, ONE BOUNDED PAGE AT A TIME. Leaving them
 * would draw a calendar that is no longer syncing, which is worse than drawing
 * nothing: the blocks are stale and nothing on screen says so. A calendar with
 * heavy recurring expansion across the mirror window can hold more than one
 * page, so a full first page schedules `dropCalendarEvents` to keep going
 * rather than leaving the remainder undeleted forever.
 */
async function setCalendarShowImpl(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  show: boolean
) {
  const nowMs = Date.now()
  const calendar = await calendarRow(ctx, userId, calendarId)
  if (calendar === null) {
    traceError("NOT_FOUND", "That calendar is not on this account.")
  }

  await ctx.db.patch(calendar._id, {
    show,
    syncToken: show ? null : calendar.syncToken,
    updatedAt: nowMs,
  })

  if (show) {
    await ctx.scheduler.runAfter(0, internal.google.syncAccount, { userId })
    return null
  }

  await dropCalendarEventsPage(ctx, userId, calendarId)
  return null
}

export const setCalendarShow = mutation({
  args: { calendarId: v.string(), show: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setCalendarShowImpl(
      ctx,
      await requireUserId(ctx),
      args.calendarId,
      args.show
    ),
})

export const setCalendarShowForUser = internalMutation({
  args: { userId: v.string(), calendarId: v.string(), show: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setCalendarShowImpl(ctx, args.userId, args.calendarId, args.show),
})

/** The project entries made from this calendar's meetings are classified as.
 *  `null` clears it, which is a normal state: an unclassified entry is already
 *  normal everywhere else in the product. */
async function setCalendarProjectImpl(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  projectId: Id<"projects"> | null
) {
  const calendar = await calendarRow(ctx, userId, calendarId)
  if (calendar === null) {
    traceError("NOT_FOUND", "That calendar is not on this account.")
  }
  // Through `getOwned`, so a project id belonging to someone else is NOT_FOUND
  // rather than quietly stored — the same guard every other classifier write in
  // this product goes through.
  if (projectId !== null) await getOwned(ctx, userId, "projects", projectId)

  await ctx.db.patch(calendar._id, {
    ...(projectId === null
      ? { defaultProjectId: undefined }
      : { defaultProjectId: projectId }),
    updatedAt: Date.now(),
  })
  return null
}

export const setCalendarProject = mutation({
  args: {
    calendarId: v.string(),
    projectId: v.union(v.id("projects"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setCalendarProjectImpl(
      ctx,
      await requireUserId(ctx),
      args.calendarId,
      args.projectId
    ),
})

export const setCalendarProjectForUser = internalMutation({
  args: {
    userId: v.string(),
    calendarId: v.string(),
    projectId: v.union(v.id("projects"), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setCalendarProjectImpl(
      ctx,
      args.userId,
      args.calendarId,
      args.projectId
    ),
})

const connectionStatus = v.object({
  connected: v.boolean(),
  status: googleConnectionFields.status,
  lastSyncedAt: googleConnectionFields.lastSyncedAt,
  /*
   * WHAT THE SETTINGS SECTION SAYS OUT LOUD WHEN SYNCING IS FAILING.
   *
   * `status` cannot carry this: a connection that is 429-ing every run is
   * still `"ok"` — deliberately, so `connectionsToSync` keeps picking it up —
   * so with `lastSyncedAt` no longer moving on a failed run there was NO
   * signal at all on that screen. The section had a stale timestamp and no
   * explanation for it.
   *
   * `v.union(v.string(), v.null())` rather than
   * `googleConnectionFields.lastError`'s `v.optional`: the stored field is
   * optional because a connection that has never failed simply has no
   * opinion, but a RETURN shape with an absent key makes every caller write
   * `?? null` for itself. Normalised once, here.
   */
  lastError: v.union(v.string(), v.null()),
  lastErrorAt: googleConnectionFields.lastErrorAt,
})

async function connectionStatusImpl(ctx: QueryCtx, userId: string) {
  const row = await ctx.db
    .query("googleConnections")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique()
  // "Not connected" is a valid state the settings page renders, not an error.
  if (row === null) {
    return {
      connected: false,
      status: "ok" as const,
      lastSyncedAt: null,
      lastError: null,
      lastErrorAt: null,
    }
  }
  return {
    connected: true,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError ?? null,
    lastErrorAt: row.lastErrorAt,
  }
}

export const connection = query({
  args: {},
  returns: connectionStatus,
  handler: async (ctx) =>
    await connectionStatusImpl(ctx, await requireUserId(ctx)),
})

export const connectionForUser = internalQuery({
  args: { userId: v.string() },
  returns: connectionStatus,
  handler: async (ctx, args) => await connectionStatusImpl(ctx, args.userId),
})

async function connectImpl(ctx: MutationCtx, userId: string) {
  const nowMs = Date.now()
  const existing = await ctx.db
    .query("googleConnections")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique()

  if (existing === null) {
    await ctx.db.insert("googleConnections", {
      userId,
      status: "ok",
      // null, so the first sync fetches the calendar list immediately rather
      // than waiting out the TTL against a timestamp nobody earned.
      calendarsRefreshedAt: null,
      lastSyncedAt: null,
      lastErrorAt: null,
      updatedAt: nowMs,
    })
  } else {
    // Re-consenting clears the flag. This is the ONLY thing that does.
    await ctx.db.patch(existing._id, { status: "ok", updatedAt: nowMs })
  }

  // Don't make the user wait 15 minutes to see their calendars.
  await ctx.scheduler.runAfter(0, internal.google.syncAccount, { userId })
  return null
}

/** Called by the client once `linkSocial` has returned. The OAuth grant itself
 *  is Better Auth's; this records that Chroneli should now be syncing. */
export const connect = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => await connectImpl(ctx, await requireUserId(ctx)),
})

export const connectForUser = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await connectImpl(ctx, args.userId),
})

/**
 * Disconnect: the mirror goes, the ticks go, the entries STAY.
 *
 * Everything mirrored from Google is Google's and is deleted — leaving a stale
 * mirror behind would draw meetings that no longer sync. Entries already
 * materialised from meetings are the user's own tracked time and are NOT
 * touched: they may already be on an invoice, and a disconnect is not a request
 * to delete a week of work.
 *
 * `googleEventTracking` DOES go here, unlike everywhere else in this feature.
 * Its rows survive a prune and a cancellation because the event may come back;
 * they do not survive a disconnect, because the account they describe is gone
 * and a tick that outlives its calendar would fire against a reconnected
 * account the user never re-armed.
 */
/** One drain page. Bounded because a disconnect on a full mirror is a few
 *  thousand rows — more than one transaction should write — so it continues over
 *  scheduled calls rather than risking a rollback that undoes the whole thing. */
export const DISCONNECT_PAGE = 500

async function disconnectImpl(ctx: MutationCtx, userId: string) {
  /*
   * The three tables are drained in SEPARATE blocks rather than a loop over table
   * names. `ctx.db.query(table)` with a union of names gives the builder a union
   * of document types and the index names differ between the tables, so the loop
   * form does not typecheck — and the cast that would make it compile is exactly
   * the cast that hides a wrong index next time one of them changes.
   *
   * All three drains share one rule: the connection row is deleted LAST, and only
   * once every table it owns is empty. If the connection row were deleted earlier
   * and a table drain was incomplete, stale rows would survive with nothing
   * declaring the account still connected, and the disconnect would report success.
   */
  const events = await ctx.db
    .query("googleEvents")
    .withIndex("by_user_started", (q) => q.eq("userId", userId))
    .take(DISCONNECT_PAGE)
  for (const row of events) await ctx.db.delete(row._id)
  if (events.length === DISCONNECT_PAGE) {
    await ctx.scheduler.runAfter(0, internal.google.disconnectForUser, { userId })
    return null
  }

  const tracking = await ctx.db
    .query("googleEventTracking")
    .withIndex("by_user_calendar_event", (q) => q.eq("userId", userId))
    .take(DISCONNECT_PAGE)
  for (const row of tracking) await ctx.db.delete(row._id)
  if (tracking.length === DISCONNECT_PAGE) {
    await ctx.scheduler.runAfter(0, internal.google.disconnectForUser, { userId })
    return null
  }

  const calendars = await ctx.db
    .query("googleCalendars")
    .withIndex("by_user_googleId", (q) => q.eq("userId", userId))
    .take(DISCONNECT_PAGE)
  for (const calendar of calendars) await ctx.db.delete(calendar._id)
  if (calendars.length === DISCONNECT_PAGE) {
    await ctx.scheduler.runAfter(0, internal.google.disconnectForUser, { userId })
    return null
  }

  const connectionRow = await ctx.db
    .query("googleConnections")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique()
  if (connectionRow !== null) await ctx.db.delete(connectionRow._id)

  return null
}

export const disconnect = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => await disconnectImpl(ctx, await requireUserId(ctx)),
})

export const disconnectForUser = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await disconnectImpl(ctx, args.userId),
})
