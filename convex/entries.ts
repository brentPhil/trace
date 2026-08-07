import { v } from "convex/values"
import { paginationOptsValidator } from "convex/server"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { assertOwned, getOwned, getOwnedIncludingDeleted } from "./owned"
import { traceError } from "./errors"
import { applyTimeEdit, assertEnteredDuration, entryTimes } from "./lib/entryTimes"
import type { EntryTimes, TimeEdit, TimesResult } from "./lib/entryTimes"
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

/**
 * Turns a refusal from the pure time domain into a thrown ConvexError.
 *
 * The domain returns a result rather than throwing so it stays testable without
 * a backend; the boundary is here, in exactly one place, so no caller can
 * accidentally write a row from a `!ok` result.
 */
function unwrapTimes(result: TimesResult): EntryTimes {
  if (result.ok) return result.times
  switch (result.code) {
    case "END_NOT_AFTER_START":
      return traceError("END_NOT_AFTER_START", "An entry has to end after it starts.")
    case "DURATION_TOO_LONG":
      return traceError(
        "DURATION_TOO_LONG",
        "That is longer than a day. Split it into two entries."
      )
    case "INVALID_DURATION":
      return traceError("INVALID_DURATION", "That is not a length of time.")
  }
}

/**
 * An empty note is an ABSENT note, not a stored empty string.
 *
 * Both would render the same today, but "has a note" is the field the recap
 * selects on and the day header counts, so two representations of nothing would
 * eventually disagree. `undefined` deletes the field in a Convex patch.
 */
function normaliseNote(note: string | undefined): string | undefined {
  if (note === undefined) return undefined
  checkNote(note)
  const trimmed = note.trim()
  return trimmed === "" ? undefined : trimmed
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
// listPage / rangeSummary — the history view
// ---------------------------------------------------------------------------

/**
 * A page of entries in a range, newest first.
 *
 * Paginated because history is unbounded in principle. The filters that can be
 * expressed as an index prefix (the date range) are applied here; project,
 * billable, text and the preset chips are applied on the client over what is
 * loaded — see the plan §3 on why a search index is the wrong MVP trade.
 *
 * Soft-deleted rows are filtered AFTER the page is taken, which makes pages
 * ragged. That is correct rather than convenient: the alternative is a second
 * index on deletedAt whose only purpose is to make page sizes tidy.
 */
export const listPage = query({
  args: {
    fromMs: v.number(),
    toMs: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx)
    const result = await ctx.db
      .query("timeEntries")
      .withIndex("by_user_started", (q) =>
        q.eq("userId", userId).gte("startedAt", args.fromMs).lt("startedAt", args.toMs)
      )
      .order("desc")
      .paginate(args.paginationOpts)

    return {
      ...result,
      page: result.page.filter((row) => row.deletedAt === null),
    }
  },
})

const summaryReturns = v.object({
  totalMs: v.number(),
  billableMs: v.number(),
  /** COMPLETED entries only — see below. */
  count: v.number(),
  /** Entries still running, which the totals deliberately exclude. */
  runningCount: v.number(),
  /** True when the range holds more entries than this scan looked at. */
  truncated: v.boolean(),
})

/** Above this, the summary stops being exact and says so. */
const SUMMARY_SCAN_LIMIT = 5_000

/**
 * Exact totals for a whole range, independent of how much of it is paginated
 * into view.
 *
 * Deliberately NOT derived from the loaded pages. A totals line that silently
 * means "of the fifty rows fetched so far" is precisely the number that ends up
 * on an invoice understated, and nothing on screen would reveal it. When the
 * range is genuinely too large to total, `truncated` says so and the UI stops
 * claiming a figure rather than showing a wrong one.
 */
async function rangeSummaryImpl(
  ctx: QueryCtx,
  userId: string,
  fromMs: number,
  toMs: number
) {
  const rows = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_started", (q) =>
      q.eq("userId", userId).gte("startedAt", fromMs).lt("startedAt", toMs)
    )
    .take(SUMMARY_SCAN_LIMIT + 1)

  const truncated = rows.length > SUMMARY_SCAN_LIMIT
  const live = rows.slice(0, SUMMARY_SCAN_LIMIT).filter((row) => row.deletedAt === null)

  /*
   * A RUNNING entry is counted separately and contributes nothing to the total.
   *
   * It has no duration yet, and a query cannot supply one: `Date.now()` inside
   * a Convex query resolves to the transaction timestamp and creates no
   * subscription to the passage of time, so any elapsed value computed here
   * would freeze at its first evaluation.
   *
   * Silently treating it as 0 was worse than excluding it. The day header
   * beneath this sentence derives its total on the CLIENT and does include the
   * live elapsed time, so the two numbers described the same rows and
   * disagreed — with the smaller one labelled as the exact figure. The caller
   * now has what it needs to say so out loud.
   */
  let totalMs = 0
  let billableMs = 0
  let count = 0
  let runningCount = 0

  for (const row of live) {
    if (row.durationMs === null) {
      runningCount += 1
      continue
    }
    count += 1
    totalMs += row.durationMs
    if (row.billable) billableMs += row.durationMs
  }

  return { totalMs, billableMs, count, runningCount, truncated }
}

const rangeSummaryArgs = { fromMs: v.number(), toMs: v.number() }

export const rangeSummary = query({
  args: rangeSummaryArgs,
  returns: summaryReturns,
  handler: async (ctx, args) =>
    await rangeSummaryImpl(ctx, await requireUserId(ctx), args.fromMs, args.toMs),
})

export const rangeSummaryAs = internalQuery({
  args: { ...rangeSummaryArgs, userId: v.string() },
  returns: summaryReturns,
  handler: async (ctx, args) =>
    await rangeSummaryImpl(ctx, args.userId, args.fromMs, args.toMs),
})

// ---------------------------------------------------------------------------
// titleSuggestions
// ---------------------------------------------------------------------------

/** How far back autocomplete looks. Recent work is what gets repeated. */
const SUGGESTION_SCAN = 400

const suggestion = v.object({
  title: v.string(),
  projectId: v.optional(v.id("projects")),
  tagIds: v.array(v.id("tags")),
  billable: v.boolean(),
  lastUsedAt: v.number(),
  count: v.number(),
})

/**
 * Previous titles, with the classification each one last carried.
 *
 * Returns project, tags and billable — and deliberately NOT the note. The note
 * describes what happened during one specific interval; copying it onto a new
 * block of time would put a false account on work nobody has done yet, in the
 * user's own voice, indistinguishable from something they wrote.
 *
 * This is EXACTLY the set `resume` inherits, and that is the point. Toggl's
 * autocomplete and its resume button inherit different sets from each other —
 * tags come along on one path and not the other — so a user who notices cannot
 * trust either, and a user who does not notice silently loses tags.
 *
 * Ranked by recency rather than frequency: the thing you did an hour ago is a
 * better guess than the thing you did forty times last quarter.
 */
async function titleSuggestionsImpl(
  ctx: QueryCtx,
  userId: string,
  prefix: string,
  limit: number
) {
  const rows = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_started", (q) => q.eq("userId", userId))
    .order("desc")
    .take(SUGGESTION_SCAN)

  const needle = prefix.trim().toLowerCase()
  const seen = new Map<
    string,
    {
      title: string
      projectId?: Id<"projects">
      tagIds: Array<Id<"tags">>
      billable: boolean
      lastUsedAt: number
      count: number
    }
  >()

  for (const row of rows) {
    if (row.deletedAt !== null) continue
    const title = row.title.trim()
    if (title === "") continue
    if (needle !== "" && !title.toLowerCase().includes(needle)) continue

    // Case-insensitive key so "Standup" and "standup" are one suggestion, but
    // the FIRST spelling seen wins — and rows arrive newest first, so that is
    // the most recent spelling rather than an arbitrary one.
    const key = title.toLowerCase()
    const existing = seen.get(key)
    if (existing === undefined) {
      seen.set(key, {
        title,
        projectId: row.projectId,
        tagIds: row.tagIds,
        billable: row.billable,
        lastUsedAt: row.startedAt,
        count: 1,
      })
    } else {
      existing.count += 1
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, limit)
}

const titleSuggestionsArgs = {
  prefix: v.optional(v.string()),
  limit: v.optional(v.number()),
}

export const titleSuggestions = query({
  args: titleSuggestionsArgs,
  returns: v.array(suggestion),
  handler: async (ctx, args) =>
    await titleSuggestionsImpl(
      ctx,
      await requireUserId(ctx),
      args.prefix ?? "",
      args.limit ?? 6
    ),
})

export const titleSuggestionsAs = internalQuery({
  args: { ...titleSuggestionsArgs, userId: v.string() },
  returns: v.array(suggestion),
  handler: async (ctx, args) =>
    await titleSuggestionsImpl(ctx, args.userId, args.prefix ?? "", args.limit ?? 6),
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

// ---------------------------------------------------------------------------
// setNote
// ---------------------------------------------------------------------------

const setNoteArgs = {
  entryId: v.id("timeEntries"),
  note: v.string(),
}

/**
 * Writes the note — the field this product exists for.
 *
 * Split from `update` for the same reason `setTitle` is: it is written from the
 * stop sheet under a fifteen-second budget, and it must be a cheap
 * last-write-wins patch that cannot fail for a reason unrelated to the note.
 *
 * Works on a RUNNING entry too. The note is a description of the work, not of
 * the interval, and a user who knows what they are doing at 10:04 should not
 * have to wait until they stop to write it down.
 */
async function setNoteImpl(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"timeEntries">,
  note: string
) {
  const entry = await getOwned(ctx, userId, "timeEntries", entryId)
  await ctx.db.patch(entry._id, { note: normaliseNote(note), updatedAt: Date.now() })
  return null
}

export const setNote = mutation({
  args: setNoteArgs,
  returns: v.null(),
  handler: async (ctx, args) =>
    await setNoteImpl(ctx, await requireUserId(ctx), args.entryId, args.note),
})

export const setNoteAs = internalMutation({
  args: { ...setNoteArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => await setNoteImpl(ctx, args.userId, args.entryId, args.note),
})

// ---------------------------------------------------------------------------
// update — the non-time fields
// ---------------------------------------------------------------------------

const updateArgs = {
  entryId: v.id("timeEntries"),
  title: v.optional(v.string()),
  note: v.optional(v.string()),
  // v.null() is "clear the project", absent is "leave it alone". Without the
  // distinction there is no way to express unassigning one.
  projectId: v.optional(v.union(v.id("projects"), v.null())),
  tagIds: v.optional(v.array(v.id("tags"))),
  billable: v.optional(v.boolean()),
}

type UpdateArgs = {
  entryId: Id<"timeEntries">
  title?: string
  note?: string
  projectId?: Id<"projects"> | null
  tagIds?: Array<Id<"tags">>
  billable?: boolean
}

/**
 * Edits the fields that are not times.
 *
 * Every field is optional and absent means "unchanged", so the inline editor
 * sends only what the user touched. Two people editing different fields of the
 * same row therefore do not overwrite each other, which a whole-document write
 * would do.
 *
 * Changing the project does NOT re-inherit `billable`. Inheritance is a
 * convenience at creation time; re-applying it here would silently reverse a
 * decision the user made deliberately on this specific entry.
 */
async function updateImpl(ctx: MutationCtx, userId: string, args: UpdateArgs) {
  const entry = await getOwned(ctx, userId, "timeEntries", args.entryId)
  checkTitle(args.title)

  const patch: Partial<Doc<"timeEntries">> = { updatedAt: Date.now() }

  if (args.title !== undefined) patch.title = args.title
  if (args.note !== undefined) patch.note = normaliseNote(args.note)
  if (args.billable !== undefined) patch.billable = args.billable

  if (args.projectId !== undefined) {
    if (args.projectId !== null) {
      await assertOwned(ctx, userId, "projects", args.projectId)
      patch.projectId = args.projectId
    } else {
      patch.projectId = undefined
    }
  }

  if (args.tagIds !== undefined) {
    patch.tagIds = await normaliseTagIds(ctx, userId, args.tagIds)
  }

  await ctx.db.patch(entry._id, patch)
  return null
}

export const update = mutation({
  args: updateArgs,
  returns: v.null(),
  handler: async (ctx, args) => await updateImpl(ctx, await requireUserId(ctx), args),
})

export const updateAs = internalMutation({
  args: { ...updateArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, ...args }) => await updateImpl(ctx, userId, args),
})

// ---------------------------------------------------------------------------
// editTime
// ---------------------------------------------------------------------------

const editTimeArgs = {
  entryId: v.id("timeEntries"),
  field: v.union(v.literal("start"), v.literal("end"), v.literal("duration")),
  /** An instant for start/end, a length in ms for duration. */
  value: v.number(),
}

const editTimeReturns = v.object({
  startedAt: v.number(),
  endedAt: v.union(v.number(), v.null()),
  durationMs: v.union(v.number(), v.null()),
})

/**
 * Moves exactly one of start, end, or duration.
 *
 * The reconciliation rule — which of the other two follows — lives entirely in
 * `applyTimeEdit`, so the client cannot decide it and the two sides of the wire
 * cannot disagree. See convex/lib/entryTimes.ts for the rule itself.
 *
 * Giving a running entry an end time is a stop, and it is the ordinary fix for
 * "I finished twenty minutes ago and forgot". It is allowed here rather than
 * pushed to `stop`, because the user is looking at the row, not the timer bar.
 */
async function editTimeImpl(
  ctx: MutationCtx,
  userId: string,
  entryId: Id<"timeEntries">,
  edit: TimeEdit
) {
  const now = Date.now()
  const entry = await getOwned(ctx, userId, "timeEntries", entryId)

  // A running entry whose start is in the future would read 0:00:00 and stay
  // there — a stopped-looking clock that is actually running. Clamp rather than
  // refuse, matching `start`: the intent is legible, only the number is wrong.
  const clamped =
    edit.field === "start" && entry.endedAt === null && edit.value > now
      ? ({ field: "start", value: now } as const)
      : edit

  const times = unwrapTimes(
    applyTimeEdit(
      { startedAt: entry.startedAt, endedAt: entry.endedAt, durationMs: entry.durationMs },
      clamped,
      now
    )
  )

  await ctx.db.patch(entry._id, {
    startedAt: times.startedAt,
    endedAt: times.endedAt,
    durationMs: times.durationMs,
    updatedAt: now,
  })
  return times
}

export const editTime = mutation({
  args: editTimeArgs,
  returns: editTimeReturns,
  handler: async (ctx, args) =>
    await editTimeImpl(ctx, await requireUserId(ctx), args.entryId, {
      field: args.field,
      value: args.value,
    } as TimeEdit),
})

export const editTimeAs = internalMutation({
  args: { ...editTimeArgs, userId: v.string() },
  returns: editTimeReturns,
  handler: async (ctx, args) =>
    await editTimeImpl(ctx, args.userId, args.entryId, {
      field: args.field,
      value: args.value,
    } as TimeEdit),
})

// ---------------------------------------------------------------------------
// remove / restore
// ---------------------------------------------------------------------------

const removeReturns = v.object({
  /** Empty when the entry was already deleted — remove is idempotent. */
  removedEntryIds: v.array(v.id("timeEntries")),
})

/**
 * Soft-deletes an entry.
 *
 * Soft, because the undo toast has to be able to bring it back, and because
 * "never lose time" is the first rule. A hard delete is a maintenance sweep,
 * not a user gesture.
 *
 * Deleting a RUNNING entry closes it first, so the row in the trash is a valid
 * interval. Restoring a row with `endedAt: null` would otherwise resurrect a
 * second running timer hours later, violating the one-running invariant from a
 * gesture the user has already forgotten making.
 */
async function removeImpl(ctx: MutationCtx, userId: string, entryId: Id<"timeEntries">) {
  const now = Date.now()
  const entry = await getOwnedIncludingDeleted(ctx, userId, "timeEntries", entryId)

  if (entry.deletedAt !== null) return { removedEntryIds: [] }

  if (entry.endedAt === null) {
    await closeEntry(ctx, entry, now, now, { deletedAt: now })
  } else {
    await ctx.db.patch(entry._id, { deletedAt: now, updatedAt: now })
  }
  return { removedEntryIds: [entry._id] }
}

export const remove = mutation({
  args: { entryId: v.id("timeEntries") },
  returns: removeReturns,
  handler: async (ctx, args) =>
    await removeImpl(ctx, await requireUserId(ctx), args.entryId),
})

export const removeAs = internalMutation({
  args: { entryId: v.id("timeEntries"), userId: v.string() },
  returns: removeReturns,
  handler: async (ctx, args) => await removeImpl(ctx, args.userId, args.entryId),
})

/**
 * Undo.
 *
 * Restores as a COMPLETED entry whatever the stored `endedAt` says. `remove`
 * always closes a running row on the way out, but an import or an older row
 * could still carry a null end, and restoring that would hand the user a second
 * running timer they did not start. Ending it at its own updatedAt is the
 * honest reading: that is the last instant the row was known to be live.
 */
async function restoreImpl(ctx: MutationCtx, userId: string, entryId: Id<"timeEntries">) {
  const now = Date.now()
  const entry = await getOwnedIncludingDeleted(ctx, userId, "timeEntries", entryId)

  if (entry.deletedAt === null) return { restoredEntryIds: [] }

  if (entry.endedAt === null) {
    const times = unwrapTimes(
      entryTimes(entry.startedAt, Math.max(entry.updatedAt, entry.startedAt + 1))
    )
    await ctx.db.patch(entry._id, { ...times, deletedAt: null, updatedAt: now })
  } else {
    await ctx.db.patch(entry._id, { deletedAt: null, updatedAt: now })
  }
  return { restoredEntryIds: [entry._id] }
}

const restoreReturns = v.object({
  restoredEntryIds: v.array(v.id("timeEntries")),
})

export const restore = mutation({
  args: { entryId: v.id("timeEntries") },
  returns: restoreReturns,
  handler: async (ctx, args) =>
    await restoreImpl(ctx, await requireUserId(ctx), args.entryId),
})

export const restoreAs = internalMutation({
  args: { entryId: v.id("timeEntries"), userId: v.string() },
  returns: restoreReturns,
  handler: async (ctx, args) => await restoreImpl(ctx, args.userId, args.entryId),
})

// ---------------------------------------------------------------------------
// create — manual entry
// ---------------------------------------------------------------------------

const createArgs = {
  clientKey: v.string(),
  title: v.optional(v.string()),
  note: v.optional(v.string()),
  startedAt: v.number(),
  endedAt: v.number(),
  projectId: v.optional(v.id("projects")),
  tagIds: v.optional(v.array(v.id("tags"))),
  billable: v.optional(v.boolean()),
}

const createReturns = v.object({
  entryId: v.id("timeEntries"),
  replayed: v.boolean(),
})

type CreateArgs = {
  clientKey: string
  title?: string
  note?: string
  startedAt: number
  endedAt: number
  projectId?: Id<"projects">
  tagIds?: Array<Id<"tags">>
  billable?: boolean
}

/**
 * Creates a completed entry from typed times.
 *
 * Unlike `start`, this one REFUSES bad input rather than clamping it. Both
 * timestamps came from a keyboard, so an end before its start is a typo the
 * user can see and fix — clamping it would silently record a length they did
 * not mean. `start` clamps because the wrong value there comes from a device
 * clock the user cannot see or correct.
 *
 * Idempotent on `clientKey`, like `start`, so a retried submit cannot produce a
 * duplicate day's work.
 */
async function createImpl(ctx: MutationCtx, userId: string, args: CreateArgs) {
  const now = Date.now()

  const replay = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_clientKey", (q) =>
      q.eq("userId", userId).eq("clientKey", args.clientKey)
    )
    .first()
  if (replay !== null) return { entryId: replay._id, replayed: true }

  checkTitle(args.title)
  const note = normaliseNote(args.note)

  // Consistency first, then the policy ceiling — these times were typed, so the
  // 24-hour limit applies here in a way it never does to a clock that ran.
  const times = unwrapTimes(entryTimes(args.startedAt, args.endedAt))
  const entered = assertEnteredDuration(times.durationMs ?? 0)
  if (!entered.ok) unwrapTimes(entered)

  const project =
    args.projectId === undefined
      ? null
      : await getOwned(ctx, userId, "projects", args.projectId)
  const tagIds = await normaliseTagIds(ctx, userId, args.tagIds)

  const entryId = await ctx.db.insert("timeEntries", {
    userId,
    clientKey: args.clientKey,
    title: args.title ?? "",
    note,
    ...times,
    projectId: args.projectId,
    tagIds,
    billable: args.billable ?? project?.billableByDefault ?? false,
    source: "manual",
    updatedAt: now,
    deletedAt: null,
  })

  return { entryId, replayed: false }
}

export const create = mutation({
  args: createArgs,
  returns: createReturns,
  handler: async (ctx, args) => await createImpl(ctx, await requireUserId(ctx), args),
})

export const createAs = internalMutation({
  args: { ...createArgs, userId: v.string() },
  returns: createReturns,
  handler: async (ctx, { userId, ...args }) => await createImpl(ctx, userId, args),
})
