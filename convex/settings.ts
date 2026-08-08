import { v } from "convex/values"
import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { requireUserId } from "./auth"
import { traceError } from "./errors"
import { isValidTimeZone } from "./lib/day"
import type { MutationCtx, QueryCtx } from "./_generated/server"

/**
 * Defaults for a user who has never opened settings.
 *
 * Timezone is deliberately UTC here rather than a guess: `ensure` seeds the
 * real one from the browser on first authed load. A wrong stored zone silently
 * files entries under the wrong day, so the default has to be the one value
 * that is obviously provisional.
 */
export type Settings = {
  timezone: string
  weekStartDay: number
  /** Declared as the full union, not inferred from the default — otherwise the
   *  type narrows to the one literal the default happens to use. */
  durationDisplay: "hms" | "decimal"
  timeFormat: "12" | "24"
  runawayThresholdMs: number
  tabTitleClock: boolean
  recapMinuteLocal: number
}

export const SETTINGS_DEFAULTS: Settings = {
  timezone: "UTC",
  weekStartDay: 1, // Monday. Assuming Sunday is wrong for most of the world.
  durationDisplay: "hms",
  timeFormat: "24",
  runawayThresholdMs: 8 * 60 * 60 * 1000,
  tabTitleClock: true,
  recapMinuteLocal: 17 * 60 + 30,
}

async function readSettings(ctx: QueryCtx | MutationCtx, userId: string) {
  return await ctx.db
    .query("userSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first()
}

const settingsReturns = v.object({
  timezone: v.string(),
  weekStartDay: v.number(),
  durationDisplay: v.union(v.literal("hms"), v.literal("decimal")),
  timeFormat: v.union(v.literal("12"), v.literal("24")),
  runawayThresholdMs: v.number(),
  tabTitleClock: v.boolean(),
  recapMinuteLocal: v.number(),
})

async function getImpl(ctx: QueryCtx, userId: string): Promise<Settings> {
  const row = await readSettings(ctx, userId)
  if (row === null) return SETTINGS_DEFAULTS
  return {
    timezone: row.timezone,
    weekStartDay: row.weekStartDay,
    durationDisplay: row.durationDisplay,
    timeFormat: row.timeFormat,
    runawayThresholdMs: row.runawayThresholdMs,
    tabTitleClock: row.tabTitleClock,
    recapMinuteLocal: row.recapMinuteLocal,
  }
}

export const get = query({
  args: {},
  returns: settingsReturns,
  handler: async (ctx) => await getImpl(ctx, await requireUserId(ctx)),
})

export const getAs = internalQuery({
  args: { userId: v.string() },
  returns: settingsReturns,
  handler: async (ctx, args) => await getImpl(ctx, args.userId),
})

/**
 * Creates the settings row on first authed load, seeding the timezone from the
 * browser.
 *
 * MUST BE CALLED FROM THE CLIENT, and only from the client. It is invoked by
 * `useEnsureSettings` in a `useEffect`, which is the one place in a TanStack
 * Start app guaranteed not to run on the server.
 *
 * The plan originally specified `beforeLoad` on the authed layout, reasoning
 * that loaders run in PARALLEL across matched routes while `beforeLoad` chains.
 * That reasoning is correct and the conclusion is still wrong, because
 * `beforeLoad` also runs on the SERVER during SSR — where
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` is the SERVER's zone, not
 * the user's. Combined with the idempotency below, the first render would file
 * every future day boundary under the deployment region's clock and nothing
 * would ever correct it. Silent, permanent, and invisible to anyone who happens
 * to deploy in their own timezone.
 *
 * Idempotent, and never overwrites a zone the user has already got — a laptop
 * carried to another country must not silently re-file last month's invoice.
 * That property is what makes the seeding call safe to repeat, and also what
 * makes getting the FIRST one right non-negotiable.
 */
async function ensureImpl(ctx: MutationCtx, userId: string, suggested?: string) {
  if ((await readSettings(ctx, userId)) !== null) return null

  const timezone =
    suggested !== undefined && isValidTimeZone(suggested)
      ? suggested
      : SETTINGS_DEFAULTS.timezone

  await ctx.db.insert("userSettings", {
    userId,
    ...SETTINGS_DEFAULTS,
    timezone,
    updatedAt: Date.now(),
  })
  return null
}

export const ensure = mutation({
  args: { suggestedTimezone: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) =>
    await ensureImpl(ctx, await requireUserId(ctx), args.suggestedTimezone),
})

export const ensureAs = internalMutation({
  args: { suggestedTimezone: v.optional(v.string()), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) =>
    await ensureImpl(ctx, args.userId, args.suggestedTimezone),
})

const updateArgs = {
  timezone: v.optional(v.string()),
  weekStartDay: v.optional(v.number()),
  durationDisplay: v.optional(v.union(v.literal("hms"), v.literal("decimal"))),
  timeFormat: v.optional(v.union(v.literal("12"), v.literal("24"))),
  runawayThresholdMs: v.optional(v.number()),
  tabTitleClock: v.optional(v.boolean()),
  recapMinuteLocal: v.optional(v.number()),
}

type UpdateArgs = {
  timezone?: string
  weekStartDay?: number
  durationDisplay?: "hms" | "decimal"
  timeFormat?: "12" | "24"
  runawayThresholdMs?: number
  tabTitleClock?: boolean
  recapMinuteLocal?: number
}

async function updateImpl(ctx: MutationCtx, userId: string, args: UpdateArgs) {
  if (args.timezone !== undefined && !isValidTimeZone(args.timezone)) {
    traceError("INVALID_TIMEZONE", `"${args.timezone}" is not a timezone I know.`)
  }
  if (
    args.weekStartDay !== undefined &&
    (!Number.isInteger(args.weekStartDay) ||
      args.weekStartDay < 0 ||
      args.weekStartDay > 6)
  ) {
    traceError("INVALID_TIMEZONE", "Week start day must be 0-6.")
  }

  const row = await readSettings(ctx, userId)
  const patch = { ...args, updatedAt: Date.now() }
  if (row === null) {
    await ctx.db.insert("userSettings", { userId, ...SETTINGS_DEFAULTS, ...patch })
  } else {
    await ctx.db.patch(row._id, patch)
  }
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
