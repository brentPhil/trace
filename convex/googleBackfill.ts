import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { materialiseMeeting } from "./googleTrack"
import { isTrackable, overlapsWindow } from "./googleEvents"
import type { MutationCtx } from "./_generated/server"

/*
 * The meetings the live switch never got.
 *
 * Two situations produce them and they are really one situation: nothing was
 * listening at the moment the meeting started. A meeting ticked after it had
 * already passed, and a switch missed while the deployment was down or while
 * the meeting was newer than the sync interval.
 *
 * These become COMPLETED entries over their own window rather than running
 * ones. A meeting that ended at eleven must not take the timer at three.
 */

/**
 * Seven days, and the bound exists for one specific accident.
 *
 * A `410 GONE` on a sync token drops the whole window and refetches it — sixty
 * days back — so without a bound the first full resync after a ticked meeting
 * would materialise two months of history as new entries, all at once, into
 * somebody's invoice. Seven days is longer than any outage worth recovering
 * from and shorter than any billing period.
 */
export const BACKFILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000

export const BACKFILL_PER_USER_LIMIT = 100

async function backfillUserImpl(ctx: MutationCtx, userId: string) {
  const now = Date.now()

  const pending = await ctx.db
    .query("googleEventTracking")
    .withIndex("by_user_track_entry", (q) =>
      q.eq("userId", userId).eq("trackOnStart", true).eq("entryId", null)
    )
    .take(BACKFILL_PER_USER_LIMIT)
  if (pending.length === 0) return null
  if (pending.length === BACKFILL_PER_USER_LIMIT) {
    // Said out loud, not thrown: the tail simply waits for the next sync, and
    // throwing would lose the meetings this run CAN materialise. Same device
    // `google.ts` uses for a truncated page read.
    console.error("googleBackfill read a full page of pending ticks.", {
      userId,
      limit: BACKFILL_PER_USER_LIMIT,
    })
  }

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
    if (event === null) continue
    if (!isTrackable(event)) continue

    // Only meetings that have ENDED. One still in progress belongs to the tick,
    // which will switch to it live and make it the running entry.
    if (event.endedAt > now) continue
    if (now - event.endedAt > BACKFILL_WINDOW_MS) continue

    /*
     * THE OVERLAP RULE, and this is the only place it applies.
     *
     * The live switch needs no such test because it CLOSES the running entry
     * and so cannot produce an overlap. Here there is no such guarantee: the
     * user may have tracked the meeting by hand, or worked straight through it
     * on something else, and either way their own record of the hour beats the
     * calendar's plan for it.
     *
     * The scan starts a backfill window before the meeting, which is far enough
     * back to catch a long entry that opened before it and is still open now —
     * `overlapsWindow` is what decides, and it treats a running entry as
     * spanning up to `now`.
     */
    const nearby = await ctx.db
      .query("timeEntries")
      .withIndex("by_user_started", (q) =>
        q
          .eq("userId", userId)
          .gte("startedAt", event.startedAt - BACKFILL_WINDOW_MS)
      )
      .collect()
    const covered = nearby.some(
      (entry) =>
        entry.deletedAt === null &&
        overlapsWindow(entry, event.startedAt, event.endedAt, now)
    )
    if (covered) continue

    await materialiseMeeting(ctx, userId, event, "completed")
  }
  return null
}

export const backfillUser = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => await backfillUserImpl(ctx, userId),
})
