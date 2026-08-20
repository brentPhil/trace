import { v } from "convex/values"
import { internalMutation } from "./_generated/server"
import { createImpl, startImpl } from "./entries"
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
