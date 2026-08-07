import { v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { assertOwned, getOwned } from "./owned"
import { traceError } from "./errors"
import { entryTimes } from "./lib/entryTimes"
import type { Doc, Id } from "./_generated/dataModel"
import type { MutationCtx, QueryCtx } from "./_generated/server"

/** A start timestamp further ahead than this is treated as a wrong clock. */
const CLOCK_SKEW_TOLERANCE_MS = 60_000
const MAX_TAGS_PER_ENTRY = 10
const MAX_TITLE_LENGTH = 500
const MAX_NOTE_LENGTH = 2_000

/*
 * Structure note.
 *
 * Each operation is a plain `*Impl` function taking an explicit `userId`, with
 * two thin wrappers: a public one that derives the userId from the session, and
 * an internal one that accepts it directly.
 *
 * The public wrapper is the ONLY way a client reaches any of this, and `userId`
 * never appears in a public args validator — so a caller cannot name a user
 * they are not. The internal variants exist because `internal.*` functions are
 * unreachable from clients, and they are what lets the domain logic be tested
 * for real (atomic handoff, idempotency, cross-user isolation) without wiring a
 * whole auth component into the test harness. They will also be what a cron
 * calls when the runaway-timer sweep lands.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Every entry currently running for a user.
 *
 * Returns a list, not a single row, and reads with `.collect()` rather than
 * `.unique()`. `.unique()` throws when two rows match — which would mean that
 * the moment a second running row appeared from any cause (an import, a restore
 * bug, a future split), the user could never stop their timer again, because
 * stop would throw before it could patch anything. There is no worse outcome in
 * a product whose first rule is "never lose time", and it would be reached from
 * the code written to protect it. Degrade, repair, and carry on.
 */
async function runningEntries(
  ctx: QueryCtx | MutationCtx,
  userId: string
): Promise<Array<Doc<"timeEntries">>> {
  const rows = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_ended", (q) => q.eq("userId", userId).eq("endedAt", null))
    .collect()
  // A soft-deleted row is never "running", whatever its endedAt says.
  return rows.filter((row) => row.deletedAt === null)
}

/** Dedupes, sorts, caps, and proves the caller owns every tag. */
async function normaliseTagIds(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  tagIds: Array<Id<"tags">> | undefined
): Promise<Array<Id<"tags">>> {
  if (tagIds === undefined || tagIds.length === 0) return []

  const unique = [...new Set(tagIds)].sort()
  if (unique.length > MAX_TAGS_PER_ENTRY) {
    traceError("TOO_MANY_TAGS", `An entry can carry at most ${MAX_TAGS_PER_ENTRY} tags.`)
  }
  for (const tagId of unique) {
    await assertOwned(ctx, userId, "tags", tagId)
  }
  return unique
}

function checkTitle(title: string | undefined): void {
  if (title !== undefined && title.length > MAX_TITLE_LENGTH) {
    traceError("TOO_LONG", "That title is too long.")
  }
}

export function checkNote(note: string | undefined): void {
  if (note !== undefined && note.length > MAX_NOTE_LENGTH) {
    traceError("TOO_LONG", `A note can be at most ${MAX_NOTE_LENGTH} characters.`)
  }
}

/** Closes an entry at `endedAt`, never before its own start. */
async function closeEntry(
  ctx: MutationCtx,
  entry: Doc<"timeEntries">,
  endedAt: number,
  now: number,
  extra?: { deletedAt: number }
): Promise<boolean> {
  const safeEnd = Math.max(endedAt, entry.startedAt + 1)
  const times = entryTimes(entry.startedAt, safeEnd)
  if (!times.ok) return false // unreachable given the clamp above
  await ctx.db.patch(entry._id, {
    endedAt: times.times.endedAt,
    durationMs: times.times.durationMs,
    updatedAt: now,
    ...(extra ?? {}),
  })
  return true
}

// ---------------------------------------------------------------------------
// getRunning
// ---------------------------------------------------------------------------

/**
 * The running entry, or null.
 *
 * Deliberately does NOT return elapsed time. `Date.now()` inside a query
 * resolves to the transaction's timestamp and creates no subscription to the
 * passage of time, so any elapsed value returned here would be fixed at its
 * first evaluation and never invalidate — a clock that silently stops. Elapsed
 * is derived on the client from `startedAt`, on every render.
 */
// The return type is annotated rather than inferred. Without it TypeScript
// reads `running[0]` as always present (noUncheckedIndexedAccess is off), so
// the inferred type claimed this never returns null — and every client reading
// `running.title` would have typechecked and then crashed on an idle timer.
async function getRunningImpl(
  ctx: QueryCtx,
  userId: string
): Promise<Doc<"timeEntries"> | null> {
  const running = await runningEntries(ctx, userId)
  // Newest wins if the invariant was ever violated; the next start or stop
  // repairs the rest.
  running.sort((a, b) => b.startedAt - a.startedAt)
  return running[0] ?? null
}

export const getRunning = query({
  args: {},
  handler: async (ctx) => await getRunningImpl(ctx, await requireUserId(ctx)),
})

export const getRunningAs = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await getRunningImpl(ctx, args.userId),
})

// ---------------------------------------------------------------------------
// listRange
// ---------------------------------------------------------------------------

/**
 * Entries whose START falls in a half-open instant range, newest first.
 *
 * Ranges on `startedAt` because there is no stored day key — see the plan §2.1.
 * The caller converts a local date to instants with convex/lib/day.ts, so the
 * log and the recap resolve days through the same function and cannot disagree.
 *
 * Attribution is by START. An entry running from 23:00 to 01:30 belongs wholly
 * to the day it began, and Split is the manual correction — the same rule Toggl
 * uses, kept because the alternative silently divides one piece of work across
 * two invoices.
 */
async function listRangeImpl(
  ctx: QueryCtx,
  userId: string,
  fromMs: number,
  toMs: number,
  limit: number
): Promise<Array<Doc<"timeEntries">>> {
  const rows = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_started", (q) =>
      q.eq("userId", userId).gte("startedAt", fromMs).lt("startedAt", toMs)
    )
    .order("desc")
    .take(limit)
  return rows.filter((row) => row.deletedAt === null)
}

const listRangeArgs = {
  fromMs: v.number(),
  toMs: v.number(),
  limit: v.optional(v.number()),
}

export const listRange = query({
  args: listRangeArgs,
  handler: async (ctx, args) =>
    await listRangeImpl(
      ctx,
      await requireUserId(ctx),
      args.fromMs,
      args.toMs,
      args.limit ?? 500
    ),
})

export const listRangeAs = internalQuery({
  args: { ...listRangeArgs, userId: v.string() },
  handler: async (ctx, args) =>
    await listRangeImpl(ctx, args.userId, args.fromMs, args.toMs, args.limit ?? 500),
})

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

const startArgs = {
  /** UUIDv7 minted by the client. Replaying it returns the original row. */
  clientKey: v.string(),
  title: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  projectId: v.optional(v.id("projects")),
  tagIds: v.optional(v.array(v.id("tags"))),
  billable: v.optional(v.boolean()),
}

const startReturns = v.object({
  entryId: v.id("timeEntries"),
  stoppedEntryIds: v.array(v.id("timeEntries")),
  /** The clock-skew source. Taken from a mutation rather than a query because a
   *  mutation genuinely re-evaluates on every call. */
  serverNow: v.number(),
  replayed: v.boolean(),
})

type StartArgs = {
  clientKey: string
  title?: string
  startedAt?: number
  projectId?: Id<"projects">
  tagIds?: Array<Id<"tags">>
  billable?: boolean
}

/**
 * Starts tracking. Never refuses.
 *
 * Three things happen atomically, which is the whole reason this is one
 * mutation rather than a stop followed by a start: any running entry is closed
 * at exactly the new entry's start instant, so there is no gap and no overlap,
 * and no window in which a crash leaves two timers running or none.
 *
 * The absence of error paths is deliberate. Nothing is required — no title, no
 * project, no tags — and a start arriving with an impossible timestamp is
 * CLAMPED rather than rejected. A phone whose clock is a minute behind a laptop
 * that started something ten seconds ago would otherwise be told to go and stop
 * a timer on another device, which is exactly the friction that makes people
 * abandon a tracker.
 */
async function startImpl(ctx: MutationCtx, userId: string, args: StartArgs) {
  const now = Date.now()

  const replay = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_clientKey", (q) =>
      q.eq("userId", userId).eq("clientKey", args.clientKey)
    )
    .first()
  if (replay !== null) {
    return { entryId: replay._id, stoppedEntryIds: [], serverNow: now, replayed: true }
  }

  checkTitle(args.title)

  let startedAt = args.startedAt ?? now
  // A start far in the future is a wrong clock, not an intention.
  if (startedAt > now + CLOCK_SKEW_TOLERANCE_MS) startedAt = now

  const running = await runningEntries(ctx, userId)
  // Clamp forward past every running entry so the handoff is strictly ordered.
  // One millisecond, not one second: this is a boundary, not a gap.
  for (const entry of running) {
    if (startedAt <= entry.startedAt) startedAt = entry.startedAt + 1
  }

  const stoppedEntryIds: Array<Id<"timeEntries">> = []
  for (const entry of running) {
    if (await closeEntry(ctx, entry, startedAt, now)) stoppedEntryIds.push(entry._id)
  }

  const project =
    args.projectId === undefined
      ? null
      : await getOwned(ctx, userId, "projects", args.projectId)
  const tagIds = await normaliseTagIds(ctx, userId, args.tagIds)

  const entryId = await ctx.db.insert("timeEntries", {
    userId,
    clientKey: args.clientKey,
    title: args.title ?? "",
    startedAt,
    endedAt: null,
    durationMs: null,
    projectId: args.projectId,
    tagIds,
    // Inherited from the project unless the caller said otherwise, so a
    // billable client's work is billable without the user remembering.
    billable: args.billable ?? project?.billableByDefault ?? false,
    source: "web",
    updatedAt: now,
    deletedAt: null,
  })

  return { entryId, stoppedEntryIds, serverNow: now, replayed: false }
}

export const start = mutation({
  args: startArgs,
  returns: startReturns,
  handler: async (ctx, args) => await startImpl(ctx, await requireUserId(ctx), args),
})

export const startAs = internalMutation({
  args: { ...startArgs, userId: v.string() },
  returns: startReturns,
  handler: async (ctx, { userId, ...args }) => await startImpl(ctx, userId, args),
})

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

const stopReturns = v.object({
  stoppedEntryIds: v.array(v.id("timeEntries")),
  serverNow: v.number(),
})

/**
 * Stops whatever is running. Never refuses, and is a no-op when nothing is.
 *
 * Two tabs both pressing S within a second must not produce an error in the
 * second one — the user's intent was satisfied either way. An empty
 * `stoppedEntryIds` is the signal that there was nothing to do.
 *
 * A runaway timer left over a weekend produces an entry longer than a day. That
 * is real recorded time and it stops normally; the 24-hour ceiling applies to
 * durations a user TYPES, not to a clock that genuinely ran. Refusing here
 * would make the timer permanently unstoppable.
 */
async function stopImpl(ctx: MutationCtx, userId: string, endedAt: number | undefined) {
  const now = Date.now()
  const running = await runningEntries(ctx, userId)

  const stoppedEntryIds: Array<Id<"timeEntries">> = []
  for (const entry of running) {
    if (await closeEntry(ctx, entry, endedAt ?? now, now)) {
      stoppedEntryIds.push(entry._id)
    }
  }
  return { stoppedEntryIds, serverNow: now }
}

export const stop = mutation({
  args: { endedAt: v.optional(v.number()) },
  returns: stopReturns,
  handler: async (ctx, args) =>
    await stopImpl(ctx, await requireUserId(ctx), args.endedAt),
})

export const stopAs = internalMutation({
  args: { userId: v.string(), endedAt: v.optional(v.number()) },
  returns: stopReturns,
  handler: async (ctx, args) => await stopImpl(ctx, args.userId, args.endedAt),
})

// ---------------------------------------------------------------------------
// setTitle
// ---------------------------------------------------------------------------

const setTitleArgs = {
  entryId: v.id("timeEntries"),
  title: v.string(),
}

/**
 * Retitles an entry.
 *
 * Its own mutation rather than a field on a general update, because it is the
 * single highest-frequency write in the product — the user types into the timer
 * bar while the clock runs — and it must stay a cheap, last-write-wins patch. A
 * general update carrying optimistic-concurrency checks would fight a debounced
 * editor and surface a conflict dialog in the middle of typing.
 */
async function setTitleImpl(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"timeEntries">,
  title: string
) {
  checkTitle(title)
  const entry = await getOwned(ctx, userId, "timeEntries", entryId)
  await ctx.db.patch(entry._id, { title, updatedAt: Date.now() })
  return null
}

export const setTitle = mutation({
  args: setTitleArgs,
  returns: v.null(),
  handler: async (ctx, args) =>
    await setTitleImpl(ctx, await requireUserId(ctx), args.entryId, args.title),
})

export const setTitleAs = internalMutation({
  args: { ...setTitleArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await setTitleImpl(ctx, args.userId, args.entryId, args.title),
})

// ---------------------------------------------------------------------------
// discardRunning
// ---------------------------------------------------------------------------

const discardReturns = v.object({
  discardedEntryIds: v.array(v.id("timeEntries")),
})

/**
 * Throws away the running entry.
 *
 * A separate verb from delete, because killing a timer started by accident and
 * destroying recorded history are different intents carrying different risk.
 * Toggl conflates them behind one three-dot Delete.
 *
 * Soft-deletes with a real end time rather than a zero duration, so the row in
 * the trash is a valid interval and restoring it yields something usable rather
 * than a ghost.
 */
async function discardRunningImpl(ctx: MutationCtx, userId: string) {
  const now = Date.now()
  const running = await runningEntries(ctx, userId)

  const discardedEntryIds: Array<Id<"timeEntries">> = []
  for (const entry of running) {
    if (await closeEntry(ctx, entry, now, now, { deletedAt: now })) {
      discardedEntryIds.push(entry._id)
    }
  }
  return { discardedEntryIds }
}

export const discardRunning = mutation({
  args: {},
  returns: discardReturns,
  handler: async (ctx) => await discardRunningImpl(ctx, await requireUserId(ctx)),
})

export const discardRunningAs = internalMutation({
  args: { userId: v.string() },
  returns: discardReturns,
  handler: async (ctx, args) => await discardRunningImpl(ctx, args.userId),
})
