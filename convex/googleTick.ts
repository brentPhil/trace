import { v } from "convex/values"
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server"
import { internal } from "./_generated/api"
import { materialiseMeeting } from "./googleTrack"
import { isDueForSwitch, isTrackable, pickSwitch } from "./googleEvents"
import type { Doc } from "./_generated/dataModel"

/*
 * The switch, once a minute.
 *
 * DELIBERATELY A CRON READING THE MIRROR, not a `scheduler.runAt` per meeting.
 * A per-meeting job goes stale the moment the meeting moves in Google, needs
 * cancellation bookkeeping when it is unticked, and leaves orphans behind when
 * a calendar is disconnected. A cron that asks "is a ticked meeting starting?"
 * holds no state, so there is nothing to get out of step — it is self-healing
 * by construction.
 *
 * THE WRITE MAY LAND UP TO SIXTY SECONDS LATE AND THE RECORD IS STILL EXACT,
 * because both instants come from the event rather than from `Date.now()`.
 * What is late is the screen, not the data.
 */

/** A page of users, bounded so one cron minute cannot run unboundedly long. */
export const TICK_USERS_LIMIT = 200

/** Ticked-but-unmaterialised meetings read per user. The set shrinks every time
 *  one is materialised, so it is naturally small; the bound is here because
 *  "naturally small" is not a guarantee. */
export const TICK_CANDIDATES_LIMIT = 100

/**
 * Who has work this minute.
 *
 * ONE RANGE READ OVER PENDING TICKS, and the index it uses exists for this.
 *
 * `by_user_track_entry` cannot answer it: that index leads with `userId`, and a
 * Convex key range must begin at the first field, so "every pending row across
 * all users" is not expressible against it. The first version of this walked
 * the distinct users instead — one read to find the next `userId` in the index,
 * one exact-key probe to ask whether that user had anything pending.
 *
 * That was correct and unboundedly expensive. The loop's guard counted users
 * COLLECTED, not users EXAMINED, so a user with tracking rows and nothing
 * pending advanced the cursor without advancing the bound — and since this
 * table is never pruned, every user who has ever ticked a meeting stays in it
 * forever. Two reads each, every sixty seconds, growing with the user base
 * while the answer stays a handful of rows.
 *
 * `by_track_entry_user` is led by the two filters, so `(true, null)` is an
 * exact key range whose size is the number of pending ticks in the world.
 */
export const dueUsers = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("googleEventTracking")
      .withIndex("by_track_entry_user", (q) =>
        q.eq("trackOnStart", true).eq("entryId", null)
      )
      .take(TICK_USERS_LIMIT)

    if (rows.length === TICK_USERS_LIMIT) {
      // `console.error`, not a throw — the same device `google.ts` uses for a
      // truncated page read. Some users being a minute late is recoverable
      // (the next minute catches them); a cron that throws is not. But this
      // product does not silently truncate, so it is said out loud.
      console.error("googleTick read a full page of pending ticks.", {
        limit: TICK_USERS_LIMIT,
      })
    }
    // Deduplicated: one user with four ticked meetings is one switch, and
    // `switchUser` picks between them itself.
    return [...new Set(rows.map((row) => row.userId))]
  },
})

/**
 * One user's switch, in one transaction.
 *
 * Reads the candidates and writes the switch atomically, which is what removes
 * the race against the user pressing stop at 09:59:58: the tick either sees the
 * running entry and replaces it, or sees nothing running and simply opens the
 * meeting entry. There is no interleaving in which both happen.
 */
export const switchUser = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const now = Date.now()

    const pending = await ctx.db
      .query("googleEventTracking")
      .withIndex("by_user_track_entry", (q) =>
        q.eq("userId", userId).eq("trackOnStart", true).eq("entryId", null)
      )
      .take(TICK_CANDIDATES_LIMIT)
    if (pending.length === 0) return null

    /*
     * `materialiseMeeting` does no eligibility filtering — it materialises
     * whatever it is handed. The three rules that decide whether a ticked
     * meeting may take the timer are applied HERE, and all three are refusals
     * rather than errors: the meeting stays ticked, stays a ghost, and either
     * the backfill or a later minute deals with it.
     */
    const candidates: Array<{
      eventId: string
      startedAt: number
      event: Doc<"googleEvents">
    }> = []

    for (const row of pending) {
      const event = await ctx.db
        .query("googleEvents")
        .withIndex("by_user_calendar_event", (q) =>
          q
            .eq("userId", userId)
            .eq("calendarId", row.calendarId)
            .eq("eventId", row.eventId)
        )
        .unique()
      // A ticked meeting whose mirror row is gone — pruned, or deleted in
      // Google — is not an error. The tick survives in `googleEventTracking`,
      // which is never pruned, so if the event comes back so does the switch.
      if (event === null) continue
      if (!isTrackable(event)) continue
      if (!isDueForSwitch(event.startedAt, now)) continue
      candidates.push({
        eventId: event.eventId,
        startedAt: event.startedAt,
        event,
      })
    }

    // ONE running entry, always. Everything else due this minute stays a ghost
    // and falls to backfill, which records it over its own window instead.
    const winner = pickSwitch(candidates)
    if (winner === null) return null

    await materialiseMeeting(ctx, userId, winner.event, "live")
    return null
  },
})

/**
 * The cron's entry point.
 *
 * One mutation per user rather than one for everybody: a transaction that
 * touched every user's timer would contend with every user's own writes, and an
 * OCC retry would redo all of it. Scheduled rather than awaited in a loop, so
 * one slow user cannot starve the rest of the minute.
 */
export const tickAll = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const users = await ctx.runQuery(internal.googleTick.dueUsers, {})
    for (const userId of users) {
      await ctx.scheduler.runAfter(0, internal.googleTick.switchUser, {
        userId,
      })
    }
    return null
  },
})
