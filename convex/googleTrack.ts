import { v } from "convex/values"
import { internalMutation, mutation } from "./_generated/server"
import { requireUserId } from "./auth"
import { createImpl, startImpl } from "./entries"
import { traceError } from "./errors"
import { isTrackable } from "./googleEvents"
import { MAX_DURATION_MS } from "./lib/duration"
import type { MutationCtx, QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

/*
 * Google Calendar: the write side.
 *
 * The one place in this feature that creates a `timeEntries` row. `google.ts`
 * beside it is the read/mirror side and creates none — the split is what makes
 * "which code can put a number on an invoice" answerable by looking at one file.
 */

/**
 * The dedupe key, and the durable link between an entry and its meeting.
 *
 * `clientKey` already exists for exactly this — the schema calls it what "makes
 * a create idempotent" — and `by_user_clientKey` is already indexed. So "have I
 * made an entry for this meeting?" is one indexed read, the live switch and the
 * backfill cannot both create one, and the link SURVIVES `googleEventTracking`
 * being wrong or absent. A random UUID would have none of those properties.
 *
 * A recurring meeting is a series of instances and Google gives each instance
 * its own `eventId`, so daily standups do not collide.
 */
export function meetingClientKey(calendarId: string, eventId: string): string {
  return `gcal:${calendarId}:${eventId}`
}

/**
 * The inverse, which is what lets undo find a meeting from its entry.
 *
 * Splitting from the RIGHT, not the left: a Google calendar id is an address,
 * and while a colon in one would be strange it is not forbidden, whereas the
 * event id is Google's own base32hex and cannot contain one. Taking the last
 * segment as the event id is therefore always right; taking the second segment
 * as the calendar id would only usually be.
 */
export function parseMeetingClientKey(
  clientKey: string
): { calendarId: string; eventId: string } | null {
  const parts = clientKey.split(":")
  if (parts.length < 3) return null
  if (parts[0] !== "gcal") return null
  const eventId = parts[parts.length - 1]
  const calendarId = parts.slice(1, -1).join(":")
  if (calendarId === "" || eventId === "") return null
  return { calendarId, eventId }
}

export async function trackingRow(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  calendarId: string,
  eventId: string
): Promise<Doc<"googleEventTracking"> | null> {
  return await ctx.db
    .query("googleEventTracking")
    .withIndex("by_user_calendar_event", (q) =>
      q.eq("userId", userId).eq("calendarId", calendarId).eq("eventId", eventId)
    )
    .unique()
}

/**
 * Upsert of our facts about an event.
 *
 * Separate from `googleEvents` on purpose, and the schema says why: that table
 * holds Google's facts and is replaceable at any sync, this one holds the
 * user's and is never pruned. A tick therefore survives its meeting drifting
 * out of the mirror window.
 */
export async function upsertTracking(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  eventId: string,
  patch: Partial<
    Pick<
      Doc<"googleEventTracking">,
      "trackOnStart" | "entryId" | "interruptedEntryId"
    >
  >
): Promise<Id<"googleEventTracking">> {
  const now = Date.now()
  const existing = await trackingRow(ctx, userId, calendarId, eventId)
  if (existing !== null) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt: now })
    return existing._id
  }
  return await ctx.db.insert("googleEventTracking", {
    userId,
    calendarId,
    eventId,
    trackOnStart: patch.trackOnStart ?? false,
    entryId: patch.entryId ?? null,
    interruptedEntryId: patch.interruptedEntryId ?? null,
    updatedAt: now,
  })
}

export type MaterialiseMode = "live" | "completed"

export type Materialised = {
  entryId: Id<"timeEntries">
  /** What the switch closed, so undo can reopen it. Always null for
   *  "completed", which closes nothing. */
  interruptedEntryId: Id<"timeEntries"> | null
}

/**
 * Turns a meeting into an entry. The only function that does.
 *
 * `live` closes the running entry at the meeting's start instant and opens a
 * running entry there — one gesture, one transaction, no window in which two
 * timers run or none do. `completed` writes a closed entry over the meeting's
 * own window and does not touch the timer at all.
 *
 * Returns `null` when the meeting cannot become an entry. That is a skip, not a
 * failure: a batch that threw here would take every later meeting in the page
 * down with it.
 */
export async function materialiseMeeting(
  ctx: MutationCtx,
  userId: string,
  event: Doc<"googleEvents">,
  mode: MaterialiseMode
): Promise<Materialised | null> {
  const clientKey = meetingClientKey(event.calendarId, event.eventId)

  /*
   * The calendar's default project, and through it the project's billable flag.
   *
   * Read here rather than passed in because both jobs need the same answer and
   * neither has a reason to know how classification works. A calendar row that
   * is missing — hidden and drained, say — is not an error: an unclassified
   * entry is a normal state everywhere else in this product.
   */
  const calendar = await ctx.db
    .query("googleCalendars")
    .withIndex("by_user_googleId", (q) =>
      q.eq("userId", userId).eq("googleId", event.calendarId)
    )
    .unique()
  const projectId = calendar?.defaultProjectId

  if (mode === "live") {
    const started = await startImpl(ctx, userId, {
      clientKey,
      title: event.title,
      startedAt: event.startedAt,
      projectId,
      source: "calendar",
    })
    const interruptedEntryId = started.stoppedEntryIds[0] ?? null
    await upsertTracking(ctx, userId, event.calendarId, event.eventId, {
      entryId: started.entryId,
      // A replay must not overwrite a real interruption with null. `replayed`
      // is exactly the signal that this transaction closed nothing.
      ...(started.replayed ? {} : { interruptedEntryId }),
    })
    return {
      entryId: started.entryId,
      interruptedEntryId: started.replayed ? null : interruptedEntryId,
    }
  }

  /*
   * THE CEILING IS CHECKED HERE, not left to `createImpl`.
   *
   * `createImpl` applies the 24-hour policy ceiling to typed durations and
   * throws when it is exceeded — correct there, because a person typed it and
   * can see the refusal. Nobody is watching a cron, so a 30-hour event (rare,
   * but legal and not all-day) would kill the batch. Skipping is the honest
   * outcome: the meeting stays ghosted and tickable, and nothing is recorded
   * that the user cannot account for.
   */
  if (event.endedAt - event.startedAt > MAX_DURATION_MS) return null
  if (event.endedAt <= event.startedAt) return null

  const created = await createImpl(ctx, userId, {
    clientKey,
    title: event.title,
    startedAt: event.startedAt,
    endedAt: event.endedAt,
    projectId,
    source: "calendar",
  })
  await upsertTracking(ctx, userId, event.calendarId, event.eventId, {
    entryId: created.entryId,
  })
  return { entryId: created.entryId, interruptedEntryId: null }
}

/** Test-only. Named `*ForTest` so the audit "what can reach my data" reads
 *  honestly: this is internal, so it is unreachable from a client. */
export const materialiseForTest = internalMutation({
  args: {
    userId: v.string(),
    calendarId: v.string(),
    eventId: v.string(),
    mode: v.union(v.literal("live"), v.literal("completed")),
  },
  returns: v.union(
    v.object({
      entryId: v.id("timeEntries"),
      interruptedEntryId: v.union(v.id("timeEntries"), v.null()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("googleEvents")
      .withIndex("by_user_calendar_event", (q) =>
        q
          .eq("userId", args.userId)
          .eq("calendarId", args.calendarId)
          .eq("eventId", args.eventId)
      )
      .unique()
    if (event === null) return null
    return await materialiseMeeting(ctx, args.userId, event, args.mode)
  },
})

/**
 * The mirrored meeting a user-facing mutation was aimed at, or a refusal.
 *
 * The eligibility gate lives HERE rather than in `materialiseMeeting`, which
 * filters nothing: the jobs that call that function have already chosen their
 * work from an index, whereas everything below arrives from a client naming a
 * calendar and an event, and a client can name anything.
 */
async function eventRowOrThrow(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  eventId: string
): Promise<Doc<"googleEvents">> {
  const event = await ctx.db
    .query("googleEvents")
    .withIndex("by_user_calendar_event", (q) =>
      q.eq("userId", userId).eq("calendarId", calendarId).eq("eventId", eventId)
    )
    .unique()
  // NOT_FOUND rather than a silent no-op: the client just drew a checkbox for
  // this meeting, so a miss means the mirror and the grid disagree, and the
  // user should be told rather than left ticking a box that does nothing.
  if (event === null) {
    traceError("NOT_FOUND", "That meeting is not on this account.")
  }
  if (!isTrackable(event)) {
    traceError("NOT_TRACKABLE", "That meeting cannot be tracked.")
  }
  return event
}

async function setTrackOnStartImpl(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  eventId: string,
  track: boolean
) {
  await eventRowOrThrow(ctx, userId, calendarId, eventId)
  /*
   * The tick only ever governs a FUTURE switch.
   *
   * Unticking a meeting that already produced an entry deletes nothing: that
   * entry is recorded time, and this product does not remove recorded time on
   * the user's behalf anywhere else either. The ghost stays suppressed because
   * `entryId` is untouched.
   */
  await upsertTracking(ctx, userId, calendarId, eventId, {
    trackOnStart: track,
  })
  return null
}

export const setTrackOnStart = mutation({
  args: { calendarId: v.string(), eventId: v.string(), track: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setTrackOnStartImpl(
      ctx,
      await requireUserId(ctx),
      args.calendarId,
      args.eventId,
      args.track
    ),
})

export const setTrackOnStartForUser = internalMutation({
  args: {
    userId: v.string(),
    calendarId: v.string(),
    eventId: v.string(),
    track: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setTrackOnStartImpl(
      ctx,
      args.userId,
      args.calendarId,
      args.eventId,
      args.track
    ),
})

const trackNowReturns = v.union(
  v.object({ entryId: v.id("timeEntries") }),
  v.null()
)

/**
 * **Track this** — the same materialisation the backfill runs, on demand.
 *
 * The path for a meeting that has already started or already finished, where a
 * tick has nothing left to fire. A meeting still in progress becomes the
 * running entry, dated from its own start; one that has ended becomes a
 * completed entry over its own window. Both are idempotent through `clientKey`,
 * so a double press returns the entry that already exists.
 */
async function trackNowImpl(
  ctx: MutationCtx,
  userId: string,
  calendarId: string,
  eventId: string
) {
  const event = await eventRowOrThrow(ctx, userId, calendarId, eventId)
  const mode = event.endedAt <= Date.now() ? "completed" : "live"
  const result = await materialiseMeeting(ctx, userId, event, mode)
  return result === null ? null : { entryId: result.entryId }
}

export const trackNow = mutation({
  args: { calendarId: v.string(), eventId: v.string() },
  returns: trackNowReturns,
  handler: async (ctx, args) =>
    await trackNowImpl(
      ctx,
      await requireUserId(ctx),
      args.calendarId,
      args.eventId
    ),
})

export const trackNowForUser = internalMutation({
  args: { userId: v.string(), calendarId: v.string(), eventId: v.string() },
  returns: trackNowReturns,
  handler: async (ctx, args) =>
    await trackNowImpl(ctx, args.userId, args.calendarId, args.eventId),
})

/**
 * How long the way back stays open.
 *
 * Long enough to notice a wrong interruption, short enough that the offer is
 * not still on screen an hour into the call. The client uses the same number to
 * decide whether to OFFER; this one decides whether to ALLOW, so a stale tab
 * cannot reverse a switch from this morning.
 */
export const UNDO_WINDOW_MS = 5 * 60 * 1_000

/**
 * Reverses one switch: delete the meeting entry, reopen what it closed.
 *
 * The switch is the one write in this feature that happens at a moment the user
 * did not choose, so it is the one that gets a way back. Everything it needs is
 * derivable from the entry itself — `clientKey` names the meeting and the
 * tracking row names what was interrupted — so the client passes an entry id
 * and nothing else it could get wrong.
 */
async function undoSwitchImpl(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"timeEntries">
) {
  const entry = await ctx.db.get(entryId)
  if (entry === null || entry.userId !== userId) {
    traceError("NOT_FOUND", "That entry is not on this account.")
  }
  if (entry.source !== "calendar") {
    traceError("NOT_A_SWITCH", "That entry did not come from a meeting.")
  }
  const key = parseMeetingClientKey(entry.clientKey)
  if (key === null) {
    traceError("NOT_A_SWITCH", "That entry did not come from a meeting.")
  }
  if (Date.now() - entry.startedAt > UNDO_WINDOW_MS) {
    traceError("UNDO_EXPIRED", "That switch is too old to undo.")
  }

  /*
   * The interruption is read from the TRACKING row, not from the entry.
   *
   * `materialiseMeeting` omits `interruptedEntryId` on a replay rather than
   * writing null, so the row still names what the FIRST switch closed however
   * many times the cron re-ran the same minute. Recomputing it here from
   * anything else would lose exactly that.
   */
  const tracking = await trackingRow(ctx, userId, key.calendarId, key.eventId)
  const interrupted =
    tracking === null || tracking.interruptedEntryId === null
      ? null
      : await ctx.db.get(tracking.interruptedEntryId)

  // A HARD delete, not the soft one `remove` uses. This entry is being un-made
  // rather than removed: it records nothing the user did, and leaving it in the
  // trash would put a meeting they never tracked into their restore list.
  await ctx.db.delete(entry._id)

  if (interrupted !== null && interrupted.userId === userId) {
    await ctx.db.patch(interrupted._id, {
      endedAt: null,
      durationMs: null,
      updatedAt: Date.now(),
    })
  }

  if (tracking !== null) {
    await ctx.db.patch(tracking._id, {
      entryId: null,
      interruptedEntryId: null,
      trackOnStart: false,
      updatedAt: Date.now(),
    })
  }
  return null
}

export const undoSwitch = mutation({
  args: { entryId: v.id("timeEntries") },
  returns: v.null(),
  handler: async (ctx, args) =>
    await undoSwitchImpl(ctx, await requireUserId(ctx), args.entryId),
})

export const undoSwitchForUser = internalMutation({
  args: { userId: v.string(), entryId: v.id("timeEntries") },
  returns: v.null(),
  handler: async (ctx, args) =>
    await undoSwitchImpl(ctx, args.userId, args.entryId),
})
