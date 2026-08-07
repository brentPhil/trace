import { v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { SETTINGS_DEFAULTS } from "./settings"
import { dayWindow, parseDayString } from "./lib/day"
import { assembleRecap, suggestBlocked } from "./lib/recap"
import type { RecapDoc, RecapEntry } from "./lib/recap"
import type { MutationCtx, QueryCtx } from "./_generated/server"

const MAX_FIELD_LENGTH = 500

/*
 * The recap.
 *
 * The BODY is never stored. It is a pure function of the day's entries, so
 * storing it would create an invalidation problem with a branch for every way
 * an entry can change â€” edit a note at 18:00 and a stored recap from 17:30 is
 * silently wrong, with nothing to say so.
 *
 * The only things persisted are the two strings the user types that are not
 * already entries: `next` and `blocked`. Hence recapDays holding exactly those.
 */

async function readSettings(ctx: QueryCtx | MutationCtx, userId: string) {
  const row = await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first()
  return {
    timezone: row?.timezone ?? SETTINGS_DEFAULTS.timezone,
    weekStartDay: row?.weekStartDay ?? SETTINGS_DEFAULTS.weekStartDay,
  }
}

/**
 * "Thu 6 Aug".
 *
 * Formatted on the server because the day label has to match the day the
 * entries were selected by, and both come from the stored timezone. Deriving it
 * on the client from a different clock is how a recap ends up headed with
 * yesterday's date.
 */
function labelFor(day: string, timeZone: string): string {
  const { fromMs } = dayWindow(day, timeZone)
  // Noon, not midnight: a DST transition at midnight can push the formatter
  // onto the adjacent date, and no zone shifts at noon.
  const noon = fromMs + 12 * 3_600_000
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(noon))
}

async function buildImpl(
  ctx: QueryCtx,
  userId: string,
  day: string
): Promise<RecapDoc> {
  // Throws on a malformed day string rather than silently returning an empty
  // recap, which would read as "you did nothing today".
  parseDayString(day)

  const settings = await readSettings(ctx, userId)
  const { fromMs, toMs } = dayWindow(day, settings.timezone)

  const rows = await ctx.db
    .query("timeEntries")
    .withIndex("by_user_started", (q) =>
      q.eq("userId", userId).gte("startedAt", fromMs).lt("startedAt", toMs)
    )
    .collect()

  const entries: Array<RecapEntry> = rows
    .filter((row) => row.deletedAt === null)
    // A running entry is excluded: it has no duration yet, and a recap line
    // reading "(0m)" for work in progress is worse than its absence. It appears
    // the moment it is stopped.
    .filter((row) => row.endedAt !== null && row.durationMs !== null)
    .map((row) => ({
      id: row._id,
      title: row.title,
      note: row.note,
      projectId: row.projectId,
      startedAt: row.startedAt,
      durationMs: row.durationMs ?? 0,
      billable: row.billable,
    }))

  const projectRows = await ctx.db
    .query("projects")
    .withIndex("by_user_archived_name", (q) => q.eq("userId", userId))
    .collect()

  const stored = await ctx.db
    .query("recapDays")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", day))
    .first()

  return assembleRecap({
    day,
    dayLabel: labelFor(day, settings.timezone),
    entries,
    projects: projectRows
      .filter((p) => p.deletedAt === null)
      .map((p) => ({ id: p._id, name: p.name, color: p.color })),
    next: stored?.next,
    // Only ever a PREFILL, and only when the user has not written their own.
    // Overwriting what they typed with a guess drawn from their notes would be
    // the single most alarming thing this product could do.
    // `?? ` rather than `||`: a stored "" is the tombstone written when the
    // user cleared the field, and it must SUPPRESS the suggestion rather than
    // fall through to it.
    blocked: stored?.blocked ?? suggestBlocked(entries),
    // The UI says "suggested from your last note" beside this field, and it
    // must only say so when that is true.
    blockedIsSuggestion: stored?.blocked === undefined,
  })
}

export const get = query({
  args: { day: v.string() },
  handler: async (ctx, args) => await buildImpl(ctx, await requireUserId(ctx), args.day),
})

export const getAs = internalQuery({
  args: { day: v.string(), userId: v.string() },
  handler: async (ctx, args) => await buildImpl(ctx, args.userId, args.day),
})

// ---------------------------------------------------------------------------

const setFieldsArgs = {
  day: v.string(),
  next: v.optional(v.union(v.string(), v.null())),
  blocked: v.optional(v.union(v.string(), v.null())),
}

type SetFieldsArgs = {
  day: string
  next?: string | null
  blocked?: string | null
}

/**
 * Stores `Next` / `Blocked` for a day.
 *
 * `null` clears; absent leaves alone. Without the distinction there is no way
 * to remove a Blocked line once written â€” and the prefill would then reappear
 * every time, which reads as the app arguing with you.
 */
async function setFieldsImpl(ctx: MutationCtx, userId: string, args: SetFieldsArgs) {
  parseDayString(args.day)

  const clip = (text: string | null | undefined) => {
    if (text === undefined) return undefined
    if (text === null) return null
    const trimmed = text.trim().slice(0, MAX_FIELD_LENGTH)
    return trimmed === "" ? null : trimmed
  }

  const next = clip(args.next)
  const blocked = clip(args.blocked)
  const now = Date.now()

  const existing = await ctx.db
    .query("recapDays")
    .withIndex("by_user_day", (q) => q.eq("userId", userId).eq("day", args.day))
    .first()

  if (existing === null) {
    // A clear on a day with no row still has to be RECORDED, not skipped â€”
    // otherwise there is nothing to distinguish it from never having written
    // one, and the prefill comes back. `next` has no prefill, so nothing needs
    // storing when it is merely absent.
    if (next == null && blocked === undefined) return null
    await ctx.db.insert("recapDays", {
      userId,
      day: args.day,
      next: next ?? undefined,
      blocked: tombstone(blocked),
      updatedAt: now,
    })
    return null
  }

  await ctx.db.patch(existing._id, {
    ...(next !== undefined ? { next: next ?? undefined } : {}),
    ...(blocked !== undefined ? { blocked: tombstone(blocked) } : {}),
    updatedAt: now,
  })
  return null
}

/**
 * An empty string is a TOMBSTONE: "the user cleared this".
 *
 * Deleting the field instead â€” the obvious implementation â€” makes "cleared"
 * indistinguishable from "never set", and the read path falls through to
 * `suggestBlocked` and puts the sentence the user just deleted straight back
 * into the field. They then delete it again, and it returns again. There is no
 * gesture in the UI that can remove it.
 *
 * `assembleRecap` already normalises "" to undefined via `blank()`, so a
 * tombstone renders as nothing without any change downstream.
 */
function tombstone(value: string | null | undefined): string | undefined {
  if (value === undefined) return undefined
  return value ?? ""
}

export const setFields = mutation({
  args: setFieldsArgs,
  returns: v.null(),
  handler: async (ctx, args) => await setFieldsImpl(ctx, await requireUserId(ctx), args),
})

export const setFieldsAs = internalMutation({
  args: { ...setFieldsArgs, userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, ...args }) => await setFieldsImpl(ctx, userId, args),
})

